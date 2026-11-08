// The troll engine: level events = { trigger, actions, once }. Everything re-arms on respawn.
import { U, type Action, type LevelEvent, type Zone } from './types';
import { overlaps } from './physics';
import {
  fireCrusher, moveDoor, startDropper,
  type RtCrusher, type RtDoor, type RtDropper, type RtGate, type RtLaser, type RtPlatform, type RtPopup, type RtSign,
} from './hazards';
import { tps } from './constants';
import type { World } from './world';

const zoneBox = (z: Zone) => ({ x: z.x * U, y: z.y * U, w: z.w * U, h: z.h * U });

export class EventEngine {
  private fired = new Set<number>();
  private scheduled: Array<{ at: number; action: Action }> = [];
  private playerZones = new Set<string>();
  private corpseZones = new Map<string, Set<number>>();
  private playerOnPrev = new Set<string>();

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
    this.list.forEach((ev, i) => {
      if (ev.trigger.type === 'deathCountAtLeast' && this.w.deathCount >= ev.trigger.n) this.fire(i);
    });
  }

  runScheduled(): void {
    if (!this.scheduled.length) return;
    const due = this.scheduled.filter((s) => s.at <= this.w.lifeTick);
    if (!due.length) return;
    this.scheduled = this.scheduled.filter((s) => s.at > this.w.lifeTick);
    for (const s of due) applyAction(this.w, s.action);
  }

  evaluate(): void {
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
      for (const s of w.supportChain(-1)) {
        if (s.kind === 'obj') onNow.add(s.id);
        if (s.kind === 'corpse') {
          onNow.add('@corpse');
          if (w.corpseById(s.id)?.floating) onNow.add('@raft');
        }
      }
    }

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
      }
      if (hit) this.fire(i);
    });
    this.playerZones = nowZones;
    this.playerOnPrev = onNow;
  }

  private fire(i: number): void {
    const ev = this.list[i];
    if (!ev) return;
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
  }
}
