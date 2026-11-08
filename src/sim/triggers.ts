// The troll engine: level events = { trigger, actions, once }. Everything re-arms on respawn.
import { Btn, U, type Action, type Box, type CmpOp, type Condition, type DeathType, type LevelEvent, type Zone } from './types';
import { overlaps } from './physics';
import {
  fireCrusher, moveDoor, plateOf, startDropper,
  type RtCrusher, type RtDoor, type RtDropper, type RtGate, type RtLaser, type RtPlatform, type RtPopup, type RtSign,
} from './hazards';
import { PIP_H, PIP_W, tps } from './constants';
import { tuneFor, type World } from './world';
import { gadgetOp } from './gadgets';
import type { RtGadget } from './hazards';

const zoneBox = (z: Zone) => ({ x: z.x * U, y: z.y * U, w: z.w * U, h: z.h * U });

const cmp = (a: number, op: CmpOp, b: number): boolean => {
  switch (op) {
    case '==': return a === b;
    case '!=': return a !== b;
    case '<': return a < b;
    case '<=': return a <= b;
    case '>': return a > b;
    case '>=': return a >= b;
  }
};

/** Test a condition against the current world state (event `if`s, `becomes`, gadget `when`). */
export function evalCondition(w: World, c: Condition): boolean {
  switch (c.type) {
    case 'var': return cmp(w.getVar(c.name), c.op, c.value);
    case 'pressed': return (w.obj.plates.find((p) => p.id === c.plate)?.pressed ?? false) === c.is;
    case 'deaths': return cmp(w.deathCount, c.op, c.value);
    case 'gadgetOn': { const g = w.obj.get<RtGadget>(c.target); return (!!g && g.on && !g.gone) === c.is; }
    case 'collected': {
      const g = w.obj.get<RtGadget>(c.target);
      const got = g ? g.gone && g.def.effect.kind === 'collect' : w.collected.has(c.target);
      return got === c.is;
    }
    case 'inZone': {
      const z = w.level.zones.find((x) => x.id === c.zone);
      return (!!z && w.pipAlive && overlaps(w.pip, zoneBox(z))) === c.is;
    }
    case 'bodies': return cmp(w.corpses.filter((k) => k.kind !== 'crate').length, c.op, c.value);
  }
}

/** Boxes of whatever object/zone/crate has this id (for touch triggers). */
function boxesOf(w: World, id: string): Box[] {
  const z = w.level.zones.find((x) => x.id === id);
  if (z) return [zoneBox(z)];
  const crates = w.corpses.filter((c) => c.kind === 'crate' && c.crateId === id);
  if (crates.length) return crates;
  const rt = w.obj.get<Record<string, unknown>>(id);
  if (rt) {
    if (Array.isArray(rt.pts) && rt.def && (rt.def as { type?: string }).type === 'vine') return (rt.pts as Array<{ x: number; y: number }>).map((p) => ({ x: p.x - 12, y: p.y - 12, w: 24, h: 24 }));
    if (typeof rt.x === 'number' && typeof rt.w === 'number' && typeof rt.h === 'number' && !(rt as { gone?: boolean }).gone) return [rt as unknown as Box];
  }
  const o = w.level.objects.find((x) => x.id === id) as ({ x: number; y: number; w?: number; h?: number } & { type: string }) | undefined;
  if (o && !(o.type === 'relic' && w.collected.has(id))) return [{ x: o.x * U, y: o.y * U, w: (o.w ?? 1) * U, h: (o.h ?? 1) * U }];
  return [];
}

const BTN = { jump: Btn.Jump, down: Btn.Down, left: Btn.Left, right: Btn.Right } as const;

export class EventEngine {
  private fired = new Set<number>();
  private scheduled: Array<{ at: number; action: Action }> = [];
  private playerZones = new Set<string>();
  private corpseZones = new Map<string, Set<number>>();
  private playerOnPrev = new Set<string>();
  private touchPrev = new Set<string>();
  private becomesPrev = new Map<number, boolean>();
  private depth = 0;

  constructor(private readonly w: World) {}

  private get list(): LevelEvent[] { return this.w.level.events; }

  /** Called when a life starts (level load, respawn, restart). */
  onLifeStart(): void {
    this.fired.clear();
    this.scheduled = [];
    this.playerZones.clear();
    this.playerOnPrev.clear();
    // Bodies already lying in a zone don't count as "entering" it.
    this.corpseZones.clear();
    for (const z of this.w.level.zones) {
      const set = new Set<number>();
      const zb = zoneBox(z);
      for (const c of this.w.corpses) if (overlaps(c, zb)) set.add(c.id);
      this.corpseZones.set(z.id, set);
    }
    this.touchPrev.clear();
    this.becomesPrev.clear();
    this.list.forEach((ev, i) => {
      if (ev.trigger.type === 'deathCountAtLeast' && this.w.deathCount >= ev.trigger.n) this.fire(i);
      else if (ev.trigger.type === 'start') this.fire(i);
    });
    // A condition that already holds at the start isn't "becoming" true.
    this.list.forEach((ev, i) => { if (ev.trigger.type === 'becomes') this.becomesPrev.set(i, evalCondition(this.w, ev.trigger.cond)); });
  }

  /** Pip died (called from the death path, before the respawn). */
  onPlayerDies(cause: DeathType): void {
    this.list.forEach((ev, i) => {
      if (ev.trigger.type === 'playerDies' && (!ev.trigger.cause || ev.trigger.cause === cause)) this.fire(i);
    });
  }

  /** Fire every event waiting on this signal (chains are capped at 16 deep). */
  signal(name: string): void {
    if (this.depth >= 16) return;
    this.depth++;
    try {
      this.list.forEach((ev, i) => { if (ev.trigger.type === 'signal' && ev.trigger.name === name) this.fire(i); });
    } finally { this.depth--; }
  }

  runScheduled(): void {
    if (!this.scheduled.length) return;
    const due = this.scheduled.filter((s) => s.at <= this.w.lifeTick);
    if (!due.length) return;
    this.scheduled = this.scheduled.filter((s) => s.at > this.w.lifeTick);
    for (const s of due) applyAction(this.w, s.action);
  }

  evaluate(pressed = 0): void {
    const w = this.w;
    // Player zones.
    const nowZones = new Set<string>();
    if (w.pipAlive) for (const z of w.level.zones) if (overlaps(w.pip, zoneBox(z))) nowZones.add(z.id);
    // Corpse zones.
    const corpseEntered = new Set<string>();
    for (const z of w.level.zones) {
      const prev = this.corpseZones.get(z.id) ?? new Set<number>();
      const now = new Set<number>();
      const zb = zoneBox(z);
      for (const c of w.corpses) if (overlaps(c, zb)) { now.add(c.id); if (!prev.has(c.id)) corpseEntered.add(z.id); }
      this.corpseZones.set(z.id, now);
    }
    // What Pip stands on.
    const onNow = new Set<string>();
    if (w.pipAlive) {
      const plate = plateOf(w, w.rootSupport(-1));
      if (plate) onNow.add(plate.id);
      for (const s of w.supportChain(-1)) {
        if (s.kind === 'obj') onNow.add(s.id);
        if (s.kind === 'corpse') {
          onNow.add('@corpse');
          if (w.corpseById(s.id)?.floating) onNow.add('@raft');
        }
      }
    }

    // Touch edges (Pip / bodies against an object, gadget, crate, zone...), computed once per target.
    const touchNow = new Set<string>();
    const touchCache = new Map<string, boolean>();
    const touching = (kind: 'p' | 'b', target: string): boolean => {
      const key = kind + ':' + target;
      let v = touchCache.get(key);
      if (v === undefined) {
        const boxes = boxesOf(w, target);
        if (kind === 'p') {
          const pb = { x: w.pip.x - 1, y: w.pip.y, w: w.pip.w + 2, h: w.pip.h + 1 };
          v = w.pipAlive && (w.pip.hang?.vine === target || boxes.some((b) => overlaps(pb, b)));
        } else {
          v = w.corpses.some((c) => !(c.kind === 'crate' && c.crateId === target) && boxes.some((b) => b !== c && overlaps({ x: c.x - 1, y: c.y, w: c.w + 2, h: c.h + 1 }, b)));
        }
        touchCache.set(key, v);
        if (v) touchNow.add(key);
      }
      return v;
    };

    this.list.forEach((ev, i) => {
      const t = ev.trigger;
      let hit = false;
      switch (t.type) {
        case 'playerEnters': hit = nowZones.has(t.zone) && !this.playerZones.has(t.zone); break;
        case 'corpseEnters': hit = corpseEntered.has(t.zone); break;
        case 'plateDown': { const p = w.obj.plates.find((x) => x.id === t.plate); hit = !!p && p.changed && p.pressed; break; }
        case 'plateUp': { const p = w.obj.plates.find((x) => x.id === t.plate); hit = !!p && p.changed && !p.pressed; break; }
        case 'timer': hit = w.lifeTick === t.ticks; break;
        case 'deathCountAtLeast': break; // checked at life start
        case 'playerOn': hit = onNow.has(t.target) && !this.playerOnPrev.has(t.target); break;
        case 'start': case 'playerDies': case 'signal': break; // fired directly
        case 'every': hit = t.ticks > 0 && w.lifeTick >= (t.phase ?? t.ticks) && (w.lifeTick - (t.phase ?? t.ticks)) % t.ticks === 0; break;
        case 'playerLeaves': hit = w.pipAlive && this.playerZones.has(t.zone) && !nowZones.has(t.zone); break;
        case 'touch': hit = touching('p', t.target) && !this.touchPrev.has('p:' + t.target); break;
        case 'bodyTouch': hit = touching('b', t.target) && !this.touchPrev.has('b:' + t.target); break;
        case 'collect': hit = w.pickups.includes(t.target); break;
        case 'key': hit = (pressed & BTN[t.key]) !== 0; break;
        case 'becomes': {
          const now = evalCondition(w, t.cond);
          hit = now && !this.becomesPrev.get(i);
          this.becomesPrev.set(i, now);
          break;
        }
      }
      if (hit) this.fire(i);
    });
    // Edges for triggers that weren't polled this tick (so a target nobody asked about doesn't linger).
    for (const ev of this.list) {
      if (ev.trigger.type === 'touch') touching('p', ev.trigger.target);
      else if (ev.trigger.type === 'bodyTouch') touching('b', ev.trigger.target);
    }
    this.touchPrev = touchNow;
    if (w.pipAlive) this.playerZones = nowZones;
    this.playerOnPrev = onNow;
  }

  private fire(i: number): void {
    const ev = this.list[i];
    if (!ev || ev.enabled === false) return;
    if (ev.if && !ev.if.every((c) => evalCondition(this.w, c))) return;
    if (ev.once) { if (this.fired.has(i)) return; this.fired.add(i); }
    for (const a of ev.actions) {
      if (a.delay && a.delay > 0) this.scheduled.push({ at: this.w.lifeTick + a.delay, action: a });
      else applyAction(this.w, a);
    }
  }
}

function cellsIn(w: World, r: { x: number; y: number; w: number; h: number }): Array<{ cx: number; cy: number }> {
  const out: Array<{ cx: number; cy: number }> = [];
  for (let cy = r.y; cy < r.y + r.h; cy++) for (let cx = r.x; cx < r.x + r.w; cx++) if (cx >= 0 && cy >= 0 && cx < w.W && cy < w.H) out.push({ cx, cy });
  return out;
}

/** Push Pip/corpses out of solids after the terrain changes under them. */
function resolveOverlaps(w: World): void {
  for (const c of w.corpses) {
    if (c.pin) continue;
    if (!w.isFree(c, c.id)) { const s = w.findFreeSpot(c, c.id); if (s) { c.x = s.x; c.y = s.y; } }
  }
  if (w.pipAlive && !w.isFree(w.pip, -1)) { const s = w.findFreeSpot(w.pip, -1); if (s) { w.pip.x = s.x; w.pip.y = s.y; } }
}

export function applyAction(w: World, a: Action): void {
  const o = w.obj;
  switch (a.type) {
    case 'dropTiles': {
      const cells = cellsIn(w, a.rect).filter(({ cx, cy }) => w.tileAt(cx, cy) !== '.');
      for (const { cx, cy } of cells) w.setTile(cx, cy, '.');
      w.fx.push({ t: 'tilesDrop', cells: cells.map(({ cx, cy }) => ({ x: cx, y: cy })) });
      w.fx.push({ t: 'tiles' });
      break;
    }
    case 'removeTiles':
      for (const { cx, cy } of cellsIn(w, a.rect)) w.setTile(cx, cy, '.');
      w.fx.push({ t: 'tiles' });
      break;
    case 'addTiles':
      for (const { cx, cy } of cellsIn(w, a.rect)) w.setTile(cx, cy, a.tile ?? '#');
      resolveOverlaps(w);
      w.fx.push({ t: 'tiles' });
      break;
    case 'moveTiles': {
      const cells = cellsIn(w, a.rect).map(({ cx, cy }) => ({ cx, cy, g: w.tileAt(cx, cy) })).filter((c) => c.g !== '.');
      for (const c of cells) w.setTile(c.cx, c.cy, '.');
      o.movers.push({ cells, ox: 0, oy: 0, pts: a.path.map((p) => ({ x: p.x * U, y: p.y * U })), seg: 0, speed: tps(a.speed), done: a.path.length === 0 });
      w.fx.push({ t: 'tiles' });
      break;
    }
    case 'popSpike': {
      const p = o.get<RtPopup>(a.target);
      if (p && !p.up) { p.up = true; w.fx.push({ t: 'popSpike', id: p.id }); }
      break;
    }
    case 'fireCrusher': { const c = o.get<RtCrusher>(a.target); if (c) fireCrusher(c); break; }
    case 'fireDropper': { const d = o.get<RtDropper>(a.target); if (d) startDropper(w, d); break; }
    case 'toggleGate': { const g = o.get<RtGate>(a.target); if (g) g.toggled = !g.toggled; break; }
    case 'moveDoor': { const d = o.get<RtDoor>(a.target); if (d) moveDoor(d, a.path, a.speed); break; }
    case 'setCurrent': w.current = { dir: a.dir, speed: a.speed }; break;
    case 'laser': {
      const l = o.get<RtLaser>(a.target);
      if (l) { l.mode = a.mode; l.blinkStart = w.lifeTick; }
      break;
    }
    case 'sign': {
      const s = o.get<RtSign>(a.target);
      if (s) { s.override = a.text; w.fx.push({ t: 'sign', id: s.id }); }
      break;
    }
    case 'startPlatform': { const p = o.get<RtPlatform>(a.target); if (p) p.active = true; break; }
    case 'shake': w.fx.push({ t: 'shake', strength: a.strength }); break;
    case 'sfx': w.fx.push({ t: 'sfx', name: a.name }); break;
    case 'setVar': w.setVar(a.name, a.op, a.value); break;
    case 'signal': w.events.signal(a.name); break;
    case 'kill': if (w.pipAlive) w.killPipBy(a.cause ?? 'spike'); break;
    case 'teleport':
      if (w.pipAlive) {
        const p = w.pip;
        p.x = Math.round(a.to.x * U + ((U - PIP_W) >> 1)); p.y = Math.round((a.to.y + 1) * U - PIP_H);
        p.px = p.x; p.py = p.y; p.hang = null; p.grounded = false;
      }
      break;
    case 'launch':
      if (w.pipAlive) {
        const p = w.pip;
        p.vx = tps(a.vx); p.vy = tps(a.vy); p.grounded = false; p.jumping = false; p.coyote = 0; p.hang = null;
        if (Math.abs(p.vx) > w.tune.run) w.momentum = 24;
      }
      break;
    case 'setSpawn': w.checkpoint = { x: Math.round(a.to.x * U + ((U - PIP_W) >> 1)), y: Math.round((a.to.y + 1) * U - PIP_H) }; break;
    case 'setRule': {
      const rules = { ...w.level.rules, [a.rule]: a.value };
      const t = tuneFor(rules);
      if (a.rule === 'gravity') { w.tune.gravity = t.gravity; w.tune.gravityCut = t.gravityCut; }
      else if (a.rule === 'jump') w.tune.jump = t.jump;
      else if (a.rule === 'speed') w.tune.run = t.run;
      else w.tune.bounce = t.bounce;
      break;
    }
    case 'ability':
      if (a.wallJump !== undefined) w.abil.wallJump = a.wallJump;
      if (a.airJumps !== undefined) { w.abil.airJumps = Math.max(0, Math.min(3, Math.round(a.airJumps))); w.airLeft = w.abil.airJumps; }
      break;
    case 'gadget': { const g = o.get<RtGadget>(a.target); if (g) gadgetOp(w, g, a.op); break; }
    case 'spawnCrate': w.spawnCrateAt(a.at.x, a.at.y); break;
    case 'message': w.fx.push({ t: 'message', text: a.text, seconds: a.seconds ?? 3 }); break;
    case 'music': w.fx.push({ t: 'music', slot: a.slot }); break;
    case 'win': if (w.pipAlive) w.winNow(); break;
  }
}
