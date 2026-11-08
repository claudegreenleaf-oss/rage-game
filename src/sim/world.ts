// The deterministic simulation. One call to `step(input)` advances exactly one 60 Hz tick.
import {
  Btn, U,
  type Box, type Corpse, type DeathType, type LevelData, type Player, type SimEvent, type TileGlyph,
} from './types';
import {
  GRAVITY, GRAVITY_CUT, HITSTOP, JUMP_V, MAX_FALL, PIP_H, PIP_W, PIP_WEIGHT, RESPAWN_DELAY, RUN_SPEED, STAGE_WEIGHT,
} from './constants';
import { FREE_SPOT_OFFSETS, overlaps, overlapX, sweptRegion, xOverlapLen, type Solid } from './physics';
import { updatePlayer } from './player';
import { spawnCorpse, updateCorpses, type DeathInfo } from './corpse';
import {
  buildObjects, carryRiders, hazardChecks, updateGates, updateKinematics, updatePlates,
  type ObjectState,
} from './hazards';
import { EventEngine } from './triggers';
import { cloneLevel, isSolidGlyph } from './level';

/** What an entity is resting on. */
export type Support =
  | { kind: 'tile'; cx: number; cy: number; glyph: TileGlyph }
  | { kind: 'obj'; id: string }
  | { kind: 'corpse'; id: number }
  | { kind: 'pip' };

export { isSolidGlyph } from './level';

export interface WorldOptions {
  /** Shared set of collected relic ids. */
  collected?: Set<string>;
  /** Spawn here (top-left of Pip) instead of at the level's spawn; also becomes the checkpoint. */
  entry?: { x: number; y: number };
  /** Pip's velocity on entry (keeps momentum through room transitions). */
  velocity?: { vx: number; vy: number };
}

/** Wall-slide/jump is on in exploration zones and off in puzzle chambers unless a level says otherwise. */
export const canWallJump = (l: LevelData): boolean => l.abilities?.wallJump ?? l.kind === 'zone';

export class World {
  readonly level: LevelData;
  readonly W: number;
  readonly H: number;
  tiles: TileGlyph[][] = [];
  tick = 0;
  /** Ticks since the current life started (drives timers, blink patterns, periodic crushers). */
  lifeTick = 0;
  pip!: Player;
  pipAlive = true;
  corpses: Corpse[] = [];
  deathCount = 0;
  /** Deaths since the level was (re)started with R. */
  deathsSinceRestart = 0;
  won = false;
  hitstop = 0;
  respawnTimer = 0;
  pendingDeath: DeathInfo | null = null;
  lastDeath: DeathType | null = null;
  current = { dir: 1 as -1 | 1, speed: 0 };
  /** Pip's actual displacement over the previous tick (includes being carried). */
  pipDx = 0;
  obj!: ObjectState;
  /** Hidden lasers that have fired at least once (survives respawn, cleared by R). */
  revealed = new Set<string>();
  events: EventEngine;
  supports = new Map<number, Support>(); // key: corpse id, or -1 for Pip
  fx: SimEvent[] = [];
  /** Respawn point override: a touched bench, or where Pip entered this room in the connected world. */
  checkpoint: { x: number; y: number } | null = null;
  /** Relics collected this run (shared across rooms by the campaign). */
  collected: Set<string>;
  /** Exit Pip walked into this tick (the campaign moves Pip to the linked room). */
  exitHit: string | null = null;
  /** Ticks after entering a room during which exits are ignored (so Pip doesn't bounce straight back). */
  exitGrace = 0;
  /** Movement constants after the level's rule multipliers. */
  readonly tune: { run: number; jump: number; gravity: number; gravityCut: number; maxFall: number };
  private lastBench: string | null = null;
  private prevInput = 0;
  private nextCorpseId = 1;
  private bornCounter = 0;

  constructor(level: LevelData, opts: WorldOptions = {}) {
    this.level = cloneLevel(level);
    this.W = level.width;
    this.H = level.height;
    this.collected = opts.collected ?? new Set();
    const r = level.rules ?? {};
    const k = (v: number | undefined) => Math.max(0.5, Math.min(2, v ?? 1));
    this.tune = {
      run: Math.round(RUN_SPEED * k(r.speed)), jump: Math.round(JUMP_V * k(r.jump)),
      gravity: Math.max(1, Math.round(GRAVITY * k(r.gravity))), gravityCut: Math.max(2, Math.round(GRAVITY_CUT * k(r.gravity))), maxFall: MAX_FALL,
    };
    if (opts.entry) { this.checkpoint = opts.entry; this.exitGrace = 20; }
    this.events = new EventEngine(this);
    this.resetLevel();
    this.spawnPip();
    if (opts.velocity) { this.pip.vx = opts.velocity.vx; this.pip.vy = opts.velocity.vy; this.pip.facing = opts.velocity.vx < 0 ? -1 : 1; }
    this.events.onLifeStart();
  }

  // ---------------------------------------------------------------------------
  // Main loop
  // ---------------------------------------------------------------------------

  step(input: number): void {
    this.fx = [];
    this.exitHit = null;
    const pressed = input & ~this.prevInput;
    this.prevInput = input;
    this.tick++;
    if (pressed & Btn.Restart) { this.restart(); return; }
    if (this.won) return;
    if (this.hitstop > 0) {
      this.hitstop--;
      if (this.hitstop === 0) this.finishDeath();
      return;
    }
    this.lifeTick++;
    this.savePrev();
    this.events.runScheduled();
    updateKinematics(this);
    if (this.pipAlive) updatePlayer(this, input, pressed);
    if (this.exitGrace > 0) this.exitGrace--;
    if (this.pipAlive) this.checkExitsAndPickups();
    updateCorpses(this);
    hazardChecks(this);
    this.computeSupports();
    updatePlates(this);
    updateGates(this);
    this.events.evaluate();
    if (this.pipAlive && !this.won) this.checkWin();
    if (!this.pipAlive && this.hitstop === 0 && this.respawnTimer > 0) {
      this.respawnTimer--;
      if (this.respawnTimer === 0) this.respawn();
    }
  }

  private savePrev(): void {
    this.pipDx = this.pip.x - this.pip.px;
    this.pip.px = this.pip.x; this.pip.py = this.pip.y;
    for (const c of this.corpses) { c.px = c.x; c.py = c.y; }
  }

  // ---------------------------------------------------------------------------
  // Level lifecycle
  // ---------------------------------------------------------------------------

  /** Restore every level object to its start state. Corpses are untouched. */
  resetLevel(): void {
    this.tiles = this.level.tiles.map((row) => row.split('') as TileGlyph[]);
    this.current = { dir: this.level.current?.dir ?? 1, speed: this.level.current?.speed ?? 0 };
    this.obj = buildObjects(this);
    this.lifeTick = 0;
    this.resetCrates();
  }

  /** Crates are level objects: back to their start positions on every reset. */
  private resetCrates(): void {
    this.corpses = this.corpses.filter((c) => c.kind !== 'crate');
    for (const o of this.level.objects) {
      if (o.type !== 'crate') continue;
      const c: Corpse = {
        id: this.newCorpseId(), born: -1, stage: 0, shape: 'body', pin: null, floating: false, kind: 'crate', crateId: o.id,
        x: o.x * U, y: o.y * U, w: U, h: U, vx: 0, vy: 0, px: o.x * U, py: o.y * U, shiver: 0, grounded: false,
      };
      this.corpses.push(c);
    }
  }

  private checkExitsAndPickups(): void {
    const p = this.pip;
    if (this.exitGrace === 0)
      for (const e of this.level.exits ?? []) {
        if (overlaps(p, { x: e.x * U, y: e.y * U, w: e.w * U, h: e.h * U })) { this.exitHit = e.id; this.fx.push({ t: 'exit', id: e.id }); return; }
      }
    for (const o of this.level.objects) {
      if (o.type === 'bench') {
        const box = { x: o.x * U, y: o.y * U, w: U, h: U };
        if (this.lastBench !== o.id && overlaps(p, box)) {
          this.lastBench = o.id;
          this.checkpoint = { x: o.x * U + ((U - PIP_W) >> 1), y: o.y * U + U - PIP_H };
          this.fx.push({ t: 'checkpoint', id: o.id });
        }
      } else if (o.type === 'relic' && !this.collected.has(o.id)) {
        const box = { x: o.x * U + 40, y: o.y * U + 40, w: U - 80, h: U - 80 };
        if (overlaps(p, box)) { this.collected.add(o.id); this.fx.push({ t: 'collect', id: o.id, kind: o.kind }); }
      }
    }
  }

  spawnPoint(): { x: number; y: number } {
    if (this.checkpoint) return { ...this.checkpoint };
    const s = this.level.objects.find((o) => o.type === 'spawn');
    const sx = s ? s.x : 1;
    const sy = s ? s.y : 1;
    return { x: sx * U + ((U - PIP_W) >> 1), y: sy * U + U - PIP_H };
  }

  private spawnPip(): void {
    const p = this.spawnPoint();
    this.pip = {
      x: p.x, y: p.y, w: PIP_W, h: PIP_H, vx: 0, vy: 0, px: p.x, py: p.y, facing: 1,
      grounded: false, coyote: 0, jumpBuffer: 0, jumpHeld: false, jumping: false, bouncing: false,
      airTicks: 0, dropThrough: 0, wallDir: 0, wallCoyote: 0, wallLock: 0, hang: null, regrab: 0,
    };
    this.pipAlive = true;
    // Never spawn inside a corpse: stand on top of it instead.
    const spot = this.findFreeSpot(this.pip, -1);
    if (spot) { this.pip.x = spot.x; this.pip.y = spot.y; this.pip.px = spot.x; this.pip.py = spot.y; }
  }

  private respawn(): void {
    this.resetLevel();
    // Reset tiles may now overlap corpses: push each up to the nearest free spot.
    for (const c of [...this.corpses].sort((a, b) => b.y - a.y)) {
      if (c.pin) continue;
      const spot = this.findFreeSpot(c, c.id);
      if (spot) { c.x = spot.x; c.y = spot.y; c.px = c.x; c.py = c.y; }
    }
    this.spawnPip();
    this.computeSupports();
    updatePlates(this, true);
    updateGates(this, true);
    this.events.onLifeStart();
    this.fx.push({ t: 'respawn', x: this.pip.x + (PIP_W >> 1), y: this.pip.y + PIP_H });
  }

  restart(): void {
    this.deathsSinceRestart = 0;
    this.corpses = [];
    this.revealed.clear();
    this.won = false;
    this.hitstop = 0;
    this.respawnTimer = 0;
    this.pendingDeath = null;
    this.resetLevel();
    this.spawnPip();
    this.computeSupports();
    updatePlates(this, true);
    updateGates(this, true);
    this.events.onLifeStart();
    this.fx.push({ t: 'restart' });
  }

  // ---------------------------------------------------------------------------
  // Death
  // ---------------------------------------------------------------------------

  killPip(info: DeathInfo): void {
    if (!this.pipAlive || this.won) return;
    this.pipAlive = false;
    this.deathCount++;
    this.deathsSinceRestart++;
    this.lastDeath = info.kind;
    this.pendingDeath = info;
    this.hitstop = HITSTOP;
    this.pip.vx = 0; this.pip.vy = 0;
    this.fx.push({ t: 'death', kind: info.kind, x: this.pip.x + (PIP_W >> 1), y: this.pip.y + (PIP_H >> 1) });
  }

  private finishDeath(): void {
    const info = this.pendingDeath;
    this.pendingDeath = null;
    if (info) spawnCorpse(this, info);
    this.respawnTimer = RESPAWN_DELAY;
  }

  /**
   * The player has probably painted themselves into a corner: well past the level's par since the last R,
   * or a long stretch without a death or a win after dying at least once. The UI shows an R prompt.
   */
  get suggestRestart(): boolean {
    if (this.won || this.deathsSinceRestart === 0) return false;
    const par = this.level.par ?? 3;
    return this.deathsSinceRestart >= par + 2 || (this.pipAlive && this.lifeTick > 40 * 60);
  }

  newCorpseId(): number { return this.nextCorpseId++; }
  newBorn(): number { return this.bornCounter++; }

  // ---------------------------------------------------------------------------
  // Win
  // ---------------------------------------------------------------------------

  private checkWin(): void {
    for (const d of this.obj.doors) {
      if (d.state === 'hop') continue;
      // Pip's centre has to be inside the doorway.
      const mid = this.pip.x + (this.pip.w >> 1);
      if (mid >= d.x && mid < d.x + d.w && this.pip.y < d.y + d.h && this.pip.y + this.pip.h > d.y) {
        this.won = true;
        this.fx.push({ t: 'win', x: d.x + (d.w >> 1), y: d.y + (d.h >> 1) });
        return;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Tiles & solids
  // ---------------------------------------------------------------------------

  tileAt(cx: number, cy: number): TileGlyph {
    if (cx < 0 || cx >= this.W) return '#';
    if (cy < 0) return '#';
    if (cy >= this.H) return '.';
    return this.tiles[cy]![cx]!;
  }

  setTile(cx: number, cy: number, g: TileGlyph): void {
    if (cx < 0 || cx >= this.W || cy < 0 || cy >= this.H) return;
    this.tiles[cy]![cx] = g;
  }

  /**
   * Solids that could touch `region`.
   * @param self corpse id to exclude, or -1 for Pip.
   * @param withPip include Pip as a solid (corpses rest on Pip).
   * @param withCorpses include corpses.
   */
  solidsIn(region: Box, self: number, withPip: boolean, withCorpses = true): Solid[] {
    const out: Solid[] = [];
    const c0 = Math.floor(region.x / U), c1 = Math.floor((region.x + region.w) / U);
    const r0 = Math.floor(region.y / U), r1 = Math.floor((region.y + region.h) / U);
    for (let cy = r0; cy <= r1; cy++)
      for (let cxx = c0; cxx <= c1; cxx++) {
        const g = this.tileAt(cxx, cy);
        if (!isSolidGlyph(g)) continue;
        const conv = g === '}' ? 1 : g === '{' ? -1 : undefined;
        out.push({ x: cxx * U, y: cy * U, w: U, h: U, kind: conv ? 'conveyor' : 'tile', oneWay: false, id: cy * 1000 + cxx, conveyor: conv });
      }
    for (const s of this.obj.dynamicSolids()) if (overlaps(s, region)) out.push(s);
    const selfFloating = self > 0 && !!this.corpseById(self)?.floating;
    if (withCorpses)
      for (const c of this.corpses) {
        if (c.id === self) continue;
        if (!overlaps(c, region)) continue;
        // Skeletons are one-way, except that rafts bump into each other so they pile up.
        const oneWay = c.stage === 2 && !(c.floating && selfFloating);
        out.push({ x: c.x, y: c.y, w: c.w, h: c.h, kind: 'corpse', oneWay, id: c.id });
      }
    if (withPip && this.pipAlive && self !== -1 && overlaps(this.pip, region))
      out.push({ x: this.pip.x, y: this.pip.y, w: this.pip.w, h: this.pip.h, kind: 'pip', oneWay: false, id: -1 });
    return out;
  }

  solidsAround(box: Box, dx: number, dy: number, self: number, withPip: boolean, withCorpses = true): Solid[] {
    return this.solidsIn(sweptRegion(box, dx, dy), self, withPip, withCorpses);
  }

  /** Is `box` free of non-one-way solids (and of Pip, if asked)? */
  isFree(box: Box, self: number, withPip = false): boolean {
    for (const s of this.solidsIn(box, self, withPip)) if (!s.oneWay && overlaps(box, s)) return false;
    return true;
  }

  /** Nearest position (prefers straight up) where `box` doesn't overlap anything solid. */
  findFreeSpot(box: Box, self: number): { x: number; y: number } | null {
    const probe = { x: box.x, y: box.y, w: box.w, h: box.h };
    for (const [dx, dy] of FREE_SPOT_OFFSETS) {
      probe.x = box.x + dx; probe.y = box.y + dy;
      if (probe.x < 0 || probe.x + probe.w > this.W * U) continue;
      if (this.isFree(probe, self, self !== -1)) return { x: probe.x, y: probe.y };
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Supports, weights
  // ---------------------------------------------------------------------------

  /** Work out what every entity rests on (used for carrying, plates and playerOn). */
  computeSupports(): void {
    this.supports.clear();
    const entities: Array<{ key: number; box: Box }> = [];
    if (this.pipAlive) entities.push({ key: -1, box: this.pip });
    for (const c of this.corpses) if (!c.pin) entities.push({ key: c.id, box: c });
    for (const { key, box } of entities) {
      const probe = { x: box.x, y: box.y + box.h, w: box.w, h: 1 };
      let best: Support | null = null;
      let bestOverlap = 0;
      for (const s of this.solidsIn(probe, key, key !== -1)) {
        if (s.y !== box.y + box.h) continue;
        if (!overlapX(probe, s)) continue;
        const ov = xOverlapLen(probe, s);
        if (ov <= bestOverlap) continue;
        bestOverlap = ov;
        if (s.kind === 'tile' || s.kind === 'conveyor') {
          const scx = Math.floor(s.x / U), scy = Math.floor(s.y / U);
          best = { kind: 'tile', cx: scx, cy: scy, glyph: this.tileAt(scx, scy) };
        } else if (s.kind === 'corpse') best = { kind: 'corpse', id: s.id as number };
        else if (s.kind === 'pip') best = { kind: 'pip' };
        else best = { kind: 'obj', id: String(s.id) };
      }
      if (best) this.supports.set(key, best);
    }
  }

  /** The non-entity object at the bottom of an entity's support chain (if any). */
  rootSupport(key: number): Support | null {
    let k = key;
    for (let guard = 0; guard < 16; guard++) {
      const s = this.supports.get(k);
      if (!s) return null;
      if (s.kind === 'corpse') { k = s.id; continue; }
      if (s.kind === 'pip') { k = -1; continue; }
      return s;
    }
    return null;
  }

  /** Every entity key in the support chain below `key` (excluding itself). */
  supportChain(key: number): Support[] {
    const out: Support[] = [];
    let k = key;
    for (let guard = 0; guard < 16; guard++) {
      const s = this.supports.get(k);
      if (!s) break;
      out.push(s);
      if (s.kind === 'corpse') k = s.id;
      else if (s.kind === 'pip') k = -1;
      else break;
    }
    return out;
  }

  weightOf(key: number): number {
    if (key === -1) return this.pipAlive ? PIP_WEIGHT : 0;
    const c = this.corpseById(key);
    return c ? STAGE_WEIGHT[c.stage] : 0;
  }

  /** Entities resting directly on the given support. */
  ridersOf(match: (s: Support) => boolean): number[] {
    const out: number[] = [];
    for (const [k, s] of this.supports) if (match(s)) out.push(k);
    return out;
  }

  corpseById(id: number): Corpse | undefined {
    return this.corpses.find((c) => c.id === id);
  }

  entityBox(key: number): Box | undefined {
    return key === -1 ? (this.pipAlive ? this.pip : undefined) : this.corpseById(key);
  }

  /** Move an entity by (dx, dy) with collision, carrying whatever rests on it. Returns the actual move. */
  moveEntity(key: number, dx: number, dy: number, depth = 0, ignorePip = false): { dx: number; dy: number } {
    return carryRiders(this, key, dx, dy, depth, ignorePip);
  }

  // ---------------------------------------------------------------------------
  // Water
  // ---------------------------------------------------------------------------

  /** Y (units) of the water surface for the water body under column `cxx` that overlaps rows around `y`, or null. */
  waterSurfaceAt(cxx: number, y: number): number | null {
    const cy = Math.floor(y / U);
    if (this.tileAt(cxx, cy) !== '~') return null;
    let top = cy;
    while (top > 0 && this.tileAt(cxx, top - 1) === '~') top--;
    return top * U;
  }

  /** Water surface under a box (checks the column under its centre, then its edges). */
  waterUnder(box: Box): number | null {
    const probeY = box.y + box.h - 1;
    const cols = [Math.floor((box.x + (box.w >> 1)) / U), Math.floor((box.x + 1) / U), Math.floor((box.x + box.w - 2) / U)];
    for (const col of cols) {
      const s = this.waterSurfaceAt(col, probeY);
      if (s !== null) return s;
    }
    return null;
  }

  get maxFall(): number { return MAX_FALL; }
}
