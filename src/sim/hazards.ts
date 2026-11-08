// Level objects and hazards: runtime state, kinematics, kill checks, plates and gates.
import {
  U,
  type Box, type CrusherObj, type DoorObj, type DropperObj, type GateObj, type LaserObj, type LevelObject,
  type PlateObj, type PlatformObj, type PopupObj, type Pt, type SignObj, type TileGlyph,
} from './types';
import {
  CRUSHER_HOLD, CRUSHER_RISE, CRUSHER_SLAM, DOOR_RUN, DOOR_SIGHT, DROPPER_G, DROPPER_MAX, DROPPER_SHAKE,
  DROPPER_V0, GATE_SPEED, GRAVITY, PUSH_SPEED, SLAB_H, SPIKE_DEPTH, SPIKE_INSET, tps,
} from './constants';
import { blocked, overlaps, overlapX, sweepX, sweepY, type Solid } from './physics';
import { pinCorpse, type DeathInfo } from './corpse';
import type { World } from './world';

export const PLATE_H = 12;
export const PLATFORM_H = 60;
export const BEAM_W = 72;
export const DOOR_W = 192;
const HOP_TICKS = 30;
const HOP_V = 45;
const HOP_G = 3;
const HOP_TRIGGER = 60;

export interface RtDropper extends Box { def: DropperObj; id: string; homeY: number; state: 'idle' | 'shake' | 'armed' | 'fall' | 'gone'; t: number; vy: number }
export interface RtCrusher extends Box { def: CrusherObj; id: string; homeY: number; state: 'idle' | 'slam' | 'hold' | 'rise'; t: number }
export interface RtPlate extends Box { def: PlateObj; id: string; weight: number; pressed: boolean; changed: boolean }
export interface RtGate extends Box { def: GateObj; id: string; open: number; toggled: boolean; target: boolean }
export interface RtPlatform extends Box { def: PlatformObj; id: string; pts: Pt[]; seg: number; active: boolean; done: boolean; dx: number; dy: number }
export interface RtMover { cells: Array<{ cx: number; cy: number; g: TileGlyph }>; ox: number; oy: number; pts: Pt[]; seg: number; speed: number; done: boolean }
export interface RtLaser { def: LaserObj; id: string; mode: 'on' | 'off' | 'blink' | 'plate'; blinkStart: number; active: boolean; beam: Box; emitterBox: Box | null; wasActive: boolean }
export interface RtDoor extends Box { def: DoorObj; id: string; vy: number; vx: number; state: 'idle' | 'run' | 'tremble' | 'hop' | 'path'; hopT: number; path: Pt[]; seg: number; speed: number; cooldown: number; facing: -1 | 1 }
export interface RtPopup { def: PopupObj; id: string; up: boolean }
export interface RtSign { def: SignObj; id: string; override: string | null }

export class ObjectState {
  droppers: RtDropper[] = [];
  crushers: RtCrusher[] = [];
  plates: RtPlate[] = [];
  gates: RtGate[] = [];
  platforms: RtPlatform[] = [];
  movers: RtMover[] = [];
  lasers: RtLaser[] = [];
  doors: RtDoor[] = [];
  popups: RtPopup[] = [];
  signs: RtSign[] = [];
  byId = new Map<string, unknown>();

  get<T>(id: string): T | undefined { return this.byId.get(id) as T | undefined; }

  /** Solid boxes contributed by objects this tick. */
  dynamicSolids(): Solid[] {
    const out: Solid[] = [];
    for (const d of this.droppers) if (d.state === 'idle' || d.state === 'shake' || d.state === 'armed') out.push({ x: d.x, y: d.y, w: d.w, h: d.h, kind: 'dropper', oneWay: false, id: d.id });
    for (const c of this.crushers) out.push({ x: c.x, y: c.y, w: c.w, h: c.h, kind: 'crusher', oneWay: false, id: c.id });
    for (const p of this.plates) out.push({ x: p.x, y: p.y, w: p.w, h: p.h, kind: 'plate', oneWay: false, id: p.id });
    for (const g of this.gates) { const b = gateBox(g); if (b.h > 0) out.push({ ...b, kind: 'gate', oneWay: false, id: g.id }); }
    for (const p of this.platforms) out.push({ x: p.x, y: p.y, w: p.w, h: p.h, kind: 'platform', oneWay: !!p.def.oneWay, id: p.id });
    this.movers.forEach((m, i) => {
      for (const c of m.cells) if (c.g === '#' || c.g === '=') out.push({ x: c.cx * U + m.ox, y: c.cy * U + m.oy, w: U, h: U, kind: 'mover', oneWay: false, id: `mover${i}` });
    });
    for (const l of this.lasers) if (l.emitterBox) out.push({ ...l.emitterBox, kind: 'emitter', oneWay: false, id: l.id });
    return out;
  }
}

export function gateBox(g: RtGate): Box {
  return { x: g.x, y: g.y, w: g.w, h: Math.round(g.h * (1 - g.open)) };
}

export function buildObjects(w: World): ObjectState {
  const s = new ObjectState();
  for (const o of w.level.objects as LevelObject[]) {
    switch (o.type) {
      case 'dropper': {
        const d: RtDropper = { def: o, id: o.id, x: o.x * U, y: o.y * U, w: U, h: U, homeY: o.y * U, state: 'idle', t: 0, vy: 0 };
        s.droppers.push(d); s.byId.set(o.id, d); break;
      }
      case 'crusher': {
        const c: RtCrusher = { def: o, id: o.id, x: o.x * U, y: o.y * U, w: o.w * U, h: o.h * U, homeY: o.y * U, state: 'idle', t: 0 };
        s.crushers.push(c); s.byId.set(o.id, c); break;
      }
      case 'plate': {
        const p: RtPlate = { def: o, id: o.id, x: o.x * U, y: (o.y + 1) * U - PLATE_H, w: o.w * U, h: PLATE_H, weight: 0, pressed: false, changed: false };
        s.plates.push(p); s.byId.set(o.id, p); break;
      }
      case 'gate': {
        const g: RtGate = { def: o, id: o.id, x: o.x * U + 60, y: o.y * U, w: 120, h: o.h * U, open: 0, toggled: false, target: false };
        s.gates.push(g); s.byId.set(o.id, g); break;
      }
      case 'platform': {
        const pts = (o.path.length ? o.path : [{ x: o.x, y: o.y }]).map((p) => ({ x: p.x * U, y: p.y * U }));
        const p: RtPlatform = { def: o, id: o.id, x: pts[0]!.x, y: pts[0]!.y, w: o.w * U, h: PLATFORM_H, pts, seg: 1, active: o.start === 'always', done: false, dx: 0, dy: 0 };
        s.platforms.push(p); s.byId.set(o.id, p); break;
      }
      case 'laser': {
        const l: RtLaser = { def: o, id: o.id, mode: o.mode, blinkStart: 0, active: false, beam: { x: 0, y: 0, w: 0, h: 0 }, emitterBox: o.emitter ? { x: o.x * U, y: o.y * U, w: U, h: U } : null, wasActive: false };
        s.lasers.push(l); s.byId.set(o.id, l); break;
      }
      case 'door': {
        const d: RtDoor = { def: o, id: o.id, x: o.x * U + ((U - DOOR_W) >> 1), y: o.y * U, w: DOOR_W, h: U, vx: 0, vy: 0, state: 'idle', hopT: 0, path: [], seg: 0, speed: 0, cooldown: 0, facing: -1 };
        s.doors.push(d); s.byId.set(o.id, d); break;
      }
      case 'popup': { const p: RtPopup = { def: o, id: o.id, up: false }; s.popups.push(p); s.byId.set(o.id, p); break; }
      case 'sign': { const g: RtSign = { def: o, id: o.id, override: null }; s.signs.push(g); s.byId.set(o.id, g); break; }
      default: break;
    }
  }
  return s;
}

/** Current text of a sign: an event override, else the entry for the highest death count reached. */
export function signText(w: World, sign: RtSign): string {
  if (sign.override !== null) return sign.override;
  let best = -1;
  let text = '';
  for (const [k, v] of Object.entries(sign.def.text)) {
    const n = Number(k);
    if (n <= w.deathCount && n > best) { best = n; text = v; }
  }
  return text;
}

// ---------------------------------------------------------------------------
// Carrying
// ---------------------------------------------------------------------------

/** Move entity `key` (-1 = Pip) with collision; things resting on it come along. */
export function carryRiders(w: World, key: number, dx: number, dy: number, depth: number, ignorePip = false): { dx: number; dy: number } {
  const box = w.entityBox(key);
  if (!box) return { dx: 0, dy: 0 };
  const solids = w.solidsAround(box, dx, dy, key, key !== -1 && !ignorePip);
  const rx = dx !== 0 ? sweepX(box, dx, solids).d : 0;
  box.x += rx;
  const ry = dy !== 0 ? sweepY(box, dy, solids).d : 0;
  box.y += ry;
  if ((rx !== 0 || ry !== 0) && depth < 8 && key !== -1) {
    for (const r of w.ridersOf((s) => s.kind === 'corpse' && s.id === key)) carryRiders(w, r, rx, ry, depth + 1);
  }
  return { dx: rx, dy: ry };
}

function carryObjectRiders(w: World, id: string, dx: number, dy: number): void {
  if (dx === 0 && dy === 0) return;
  for (const r of w.ridersOf((s) => s.kind === 'obj' && s.id === id)) carryRiders(w, r, dx, dy, 0);
}

const stepToward = (from: number, to: number, sp: number): number => Math.max(-sp, Math.min(sp, to - from));

// ---------------------------------------------------------------------------
// Kinematics
// ---------------------------------------------------------------------------

export function updateKinematics(w: World): void {
  const o = w.obj;

  // Moving platforms.
  for (const p of o.platforms) {
    p.dx = 0; p.dy = 0;
    if (!p.active && p.def.start === 'touch') {
      const s = w.supports.get(-1);
      if (s?.kind === 'obj' && s.id === p.id) p.active = true;
    }
    if (!p.active || p.done || p.pts.length < 2) continue;
    const sp = tps(p.def.speed);
    const t = p.pts[p.seg]!;
    const dx = stepToward(p.x, t.x, sp), dy = stepToward(p.y, t.y, sp);
    p.x += dx; p.y += dy; p.dx = dx; p.dy = dy;
    carryObjectRiders(w, p.id, dx, dy);
    if (p.x === t.x && p.y === t.y) {
      if (p.seg < p.pts.length - 1) p.seg++;
      else if (p.def.loop) p.seg = 0;
      else p.done = true;
    }
  }

  // Tile groups moved by events.
  o.movers.forEach((m, i) => {
    if (m.done) return;
    const t = m.pts[m.seg]!;
    const dx = stepToward(m.ox, t.x, m.speed), dy = stepToward(m.oy, t.y, m.speed);
    m.ox += dx; m.oy += dy;
    carryObjectRiders(w, `mover${i}`, dx, dy);
    if (m.ox === t.x && m.oy === t.y) { if (m.seg < m.pts.length - 1) m.seg++; else m.done = true; }
  });

  updateDroppers(w);
  updateCrushers(w);
  updateDoors(w);
  updateLasers(w);
}

function updateDroppers(w: World): void {
  const p = w.pip;
  for (const d of w.obj.droppers) {
    if (d.state === 'idle') {
      const by = d.def.by ?? ['player'];
      let fire = false;
      if (by.includes('player') && w.pipAlive && p.y > d.y + d.h && clearBelow(w, d, p.y)) {
        const fall = fallTicks(p.y - (d.y + d.h));
        const T = DROPPER_SHAKE + fall;
        const vx = p.vx; // own walking speed: riding a platform only sets it off by being under it
        const predicted = { x: p.x + vx * T, y: p.y, w: p.w, h: p.h };
        const zone = { x: d.x + 24, y: d.y, w: d.w - 48, h: 1 };
        // Aim where a walking Pip will be when it lands; an airborne Pip only sets it off directly.
        if (overlapX(p, zone) || (p.grounded && overlapX(predicted, zone))) fire = true;
      }
      if (fire) startDropper(w, d);
      else if (by.includes('door') && w.obj.doors.some((door) => overlapX(door, d) && door.y > d.y)) {
        // The door "calls for help": the dropper rattles, then drops on Pip as Pip arrives (or after 2 s).
        d.state = 'armed';
        d.t = 120;
        w.fx.push({ t: 'dropperShake', id: d.id });
      }
    } else if (d.state === 'armed') {
      let drop = --d.t <= 0;
      if (!drop && w.pipAlive && p.y > d.y + d.h) {
        const T = fallTicks(p.y - (d.y + d.h));
        const predicted = { x: p.x + p.vx * T, y: p.y, w: p.w, h: p.h };
        const zone = { x: d.x + 24, y: d.y, w: d.w - 48, h: 1 };
        drop = overlapX(p, zone) || (p.grounded && overlapX(predicted, zone));
      }
      if (drop && d.t < 105) { d.state = 'fall'; d.vy = DROPPER_V0; w.fx.push({ t: 'dropperFall', id: d.id }); }
    } else if (d.state === 'shake') {
      if (--d.t <= 0) { d.state = 'fall'; d.vy = DROPPER_V0; w.fx.push({ t: 'dropperFall', id: d.id }); }
    } else if (d.state === 'fall') {
      d.vy = Math.min(d.vy + DROPPER_G, DROPPER_MAX);
      const solids = w.solidsAround(d, 0, d.vy, -999, false).filter((s) => !(s.kind === 'dropper' && s.id === d.id));
      const { d: moved, hit } = sweepY(d, d.vy, solids);
      // Whatever it passes through on the way down gets bonked.
      const region = { x: d.x, y: d.y, w: d.w, h: d.h + moved };
      if (w.pipAlive && overlaps(region, p)) {
        w.killPip({ kind: 'dropper', x: p.x + (p.w >> 1), bottom: p.y + p.h });
        d.state = 'gone';
        w.fx.push({ t: 'dropperBreak', id: d.id, x: d.x + (d.w >> 1), y: p.y });
        continue;
      }
      d.y += moved;
      if (hit || d.y > w.H * U + U) {
        d.state = 'gone';
        w.fx.push({ t: 'dropperBreak', id: d.id, x: d.x + (d.w >> 1), y: d.y + d.h });
      }
    }
  }
}

export function startDropper(w: World, d: RtDropper): void {
  if (d.state !== 'idle') return;
  d.state = 'shake';
  d.t = DROPPER_SHAKE;
  w.fx.push({ t: 'dropperShake', id: d.id });
}

function fallTicks(dist: number): number {
  let v = DROPPER_V0, y = 0, t = 0;
  while (y < dist && t < 200) { v = Math.min(v + DROPPER_G, DROPPER_MAX); y += v; t++; }
  return t;
}

/** No solid tile between the dropper and Pip's head. */
function clearBelow(w: World, d: RtDropper, targetY: number): boolean {
  const c0 = Math.floor((d.x + 24) / U), c1 = Math.floor((d.x + d.w - 25) / U);
  const r0 = Math.floor((d.y + d.h) / U), r1 = Math.floor((targetY - 1) / U);
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
    const g = w.tileAt(c, r);
    if (g === '#' || g === '=' || g === '}' || g === '{') return false;
  }
  return true;
}

function updateCrushers(w: World): void {
  for (const c of w.obj.crushers) {
    const period = c.def.period ?? 0;
    if (c.state === 'idle' && period > 0 && w.lifeTick >= (c.def.phase ?? 0) && (w.lifeTick - (c.def.phase ?? 0)) % period === 0) c.state = 'slam';
    if (c.state === 'slam') slamCrusher(w, c);
    else if (c.state === 'hold') { if (--c.t <= 0) c.state = 'rise'; }
    else if (c.state === 'rise') {
      const dy = Math.max(-CRUSHER_RISE, c.homeY - c.y);
      c.y += dy;
      carryObjectRiders(w, c.id, 0, dy);
      if (c.y === c.homeY) c.state = 'idle';
    }
  }
}

export function fireCrusher(c: RtCrusher): void {
  if (c.state === 'idle') c.state = 'slam';
}

function slamCrusher(w: World, c: RtCrusher): void {
  const region = { x: c.x, y: c.y + c.h, w: c.w, h: CRUSHER_SLAM };
  // Flatten every body in the column below as soon as the press reaches any of them.
  const column = w.corpses.filter((k) => overlapX(k, c) && k.y + k.h > c.y + c.h);
  if (column.some((k) => overlaps(k, region))) {
    let any = false;
    for (const k of column) {
      if (k.shape === 'slab' || (k.pin && k.h <= SLAB_H)) continue;
      const bottom = k.y + k.h;
      k.shape = 'slab';
      if (!k.pin || k.pin.kind === 'floor') { k.h = SLAB_H; k.y = bottom - SLAB_H; }
      any = true;
      w.fx.push({ t: 'flatten', id: k.id });
    }
    if (any) {
      // Let the slabs settle so the press lands on the top one.
      for (const k of [...column].sort((a, b) => b.y - a.y)) {
        if (k.pin) continue;
        const s = w.solidsAround(k, 0, 4 * U, k.id, false);
        k.y += sweepY(k, 4 * U, s).d;
        k.vy = 0;
      }
    }
  }
  let pipHit = false;
  if (w.pipAlive && overlaps(region, w.pip)) {
    const p = w.pip;
    w.killPip({ kind: 'crusher', x: p.x + (p.w >> 1), bottom: p.y + p.h, slab: true });
    pipHit = true;
  }
  const solids = w.solidsAround(c, 0, CRUSHER_SLAM, -999, false, false).filter((s) => s.id !== c.id);
  for (const k of w.corpses) if ((k.shape === 'slab' || k.pin) && overlapX(k, c) && k.y >= c.y + c.h) solids.push({ x: k.x, y: k.y, w: k.w, h: k.h, kind: 'corpse', oneWay: false, id: k.id });
  if (pipHit) solids.push({ x: w.pip.x, y: w.pip.y, w: w.pip.w, h: w.pip.h, kind: 'pip', oneWay: false, id: -1 });
  const { d, hit } = sweepY(c, CRUSHER_SLAM, solids);
  c.y += d;
  if (hit && hit.kind !== 'pip') {
    c.state = 'hold';
    c.t = CRUSHER_HOLD;
    w.fx.push({ t: 'crusherSlam', id: c.id });
  } else if (!hit && c.y > w.H * U) {
    c.state = 'hold';
    c.t = CRUSHER_HOLD;
  }
}

// ---------------------------------------------------------------------------
// Doors
// ---------------------------------------------------------------------------

function doorSolids(w: World, d: RtDoor, dx: number, dy: number): Solid[] {
  // Fresh and Rot bodies block doors; skeletons don't.
  return w.solidsAround(d, dx, dy, -999, false).filter((s) => s.kind !== 'corpse' || !s.oneWay);
}

function kickSkeletonsAside(w: World, d: RtDoor, dir: number): void {
  for (const c of w.corpses) {
    if (c.stage !== 2 || c.pin || c.floating) continue;
    if (overlaps(c, d)) c.vx = dir * PUSH_SPEED[2];
  }
}

function updateDoors(w: World): void {
  const p = w.pip;
  for (const d of w.obj.doors) {
    if (d.cooldown > 0) d.cooldown--;
    if (d.state === 'path') {
      const t = d.path[d.seg];
      if (!t) { d.state = 'idle'; continue; }
      const sp = d.speed;
      const dx = stepToward(d.x, t.x, sp), dy = stepToward(d.y, t.y, sp);
      const solids = doorSolids(w, d, dx, dy);
      const rx = sweepX(d, dx, solids);
      d.x += rx.d;
      const ry = sweepY(d, dy, solids);
      d.y += ry.d;
      if (dx !== 0) kickSkeletonsAside(w, d, Math.sign(dx));
      if (d.x === t.x && d.y === t.y) { d.seg++; if (d.seg >= d.path.length) d.state = 'idle'; }
      continue;
    }

    if (d.state === 'hop') {
      d.hopT++;
      d.vy += HOP_G;
      const solids = w.solidsAround(d, d.vx, d.vy, -999, false, false);
      d.x += sweepX(d, d.vx, solids).d;
      const ry = sweepY(d, d.vy, solids);
      d.y += ry.d;
      if (ry.hit && d.vy > 0) { d.state = 'run'; d.vy = 0; d.vx = 0; d.cooldown = 12; }
      else if (ry.hit) d.vy = 0;
      continue;
    }

    if (!d.def.runaway) continue;

    // Gravity for the legged door.
    d.vy = Math.min(d.vy + GRAVITY, 72);
    const gs = doorSolids(w, d, 0, d.vy);
    const gy = sweepY(d, d.vy, gs);
    d.y += gy.d;
    if (gy.hit) d.vy = 0;

    if (!w.pipAlive) { d.state = 'idle'; continue; }
    const dxp = p.x + (p.w >> 1) - (d.x + (d.w >> 1));
    const near = Math.abs(dxp) < DOOR_SIGHT && Math.abs(p.y + p.h - (d.y + d.h)) < 2 * U;
    if (!near) { if (d.state !== 'tremble') d.state = 'idle'; else d.state = 'idle'; continue; }
    const dir: -1 | 1 = dxp > 0 ? -1 : 1;
    d.facing = dir;
    // A body lying across the doorway pins it in place.
    if (w.corpses.some((c) => c.stage !== 2 && overlaps(c, d))) {
      if (d.state !== 'tremble') w.fx.push({ t: 'doorScurry', id: d.id });
      d.state = 'tremble';
      continue;
    }
    const gap = dxp > 0 ? p.x - (d.x + d.w) : d.x - (p.x + p.w);
    const solids = doorSolids(w, d, dir * DOOR_RUN, 0);
    const r = sweepX(d, dir * DOOR_RUN, solids);
    d.x += r.d;
    kickSkeletonsAside(w, d, dir);
    if (r.hit && r.hit.kind === 'corpse') {
      if (d.state !== 'tremble') w.fx.push({ t: 'doorScurry', id: d.id });
      d.state = 'tremble';
      continue;
    }
    if (d.state !== 'run') w.fx.push({ t: 'doorScurry', id: d.id });
    d.state = 'run';
    if (gap <= HOP_TRIGGER && d.cooldown === 0) startHop(w, d, dir);
  }
}

/** Hop over Pip, landing on the far side. */
function startHop(w: World, d: RtDoor, fleeDir: -1 | 1): void {
  const p = w.pip;
  let target = fleeDir === 1 ? p.x - d.w - Math.round(1.5 * U) : p.x + p.w + Math.round(1.5 * U);
  // Pull the landing spot in until it's inside the room and free.
  for (let i = 0; i < 12; i++) {
    const box = { x: target, y: d.y, w: d.w, h: d.h };
    if (box.x >= 0 && box.x + box.w <= w.W * U && !blocked(box, doorSolids(w, d, target - d.x, 0).filter((s) => overlaps(s, box)))) break;
    target += fleeDir * 24;
  }
  d.state = 'hop';
  d.hopT = 0;
  d.vx = Math.round((target - d.x) / HOP_TICKS);
  d.vy = -HOP_V;
  w.fx.push({ t: 'doorHop', id: d.id });
}

export function moveDoor(d: RtDoor, path: Pt[], speed: number): void {
  d.state = 'path';
  d.path = path.map((pt) => ({ x: pt.x * U + ((U - DOOR_W) >> 1), y: pt.y * U }));
  d.seg = 0;
  d.speed = tps(speed);
}

// ---------------------------------------------------------------------------
// Lasers
// ---------------------------------------------------------------------------

const DIRS: Record<string, readonly [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

function computeBeam(w: World, l: LaserObj): Box {
  const [ddx, ddy] = DIRS[l.dir]!;
  let cxx = l.x + (l.emitter ? ddx : 0), cyy = l.y + (l.emitter ? ddy : 0);
  const max = l.len && l.len > 0 ? l.len : 64;
  let n = 0;
  const x0 = cxx, y0 = cyy;
  while (n < max) {
    const g = w.tileAt(cxx, cyy);
    if (g === '#' || g === '=' || g === '}' || g === '{' || cyy >= w.H) break;
    n++; cxx += ddx; cyy += ddy;
  }
  if (n === 0) return { x: 0, y: 0, w: 0, h: 0 };
  const half = (U - BEAM_W) >> 1;
  if (ddx !== 0) {
    const xs = ddx > 0 ? x0 : x0 - n + 1;
    return { x: xs * U, y: y0 * U + half, w: n * U, h: BEAM_W };
  }
  const ys = ddy > 0 ? y0 : y0 - n + 1;
  return { x: x0 * U + half, y: ys * U, w: BEAM_W, h: n * U };
}

function updateLasers(w: World): void {
  for (const l of w.obj.lasers) {
    l.beam = computeBeam(w, l.def);
    l.wasActive = l.active;
    if (l.def.hidden && !w.revealed.has(l.id)) {
      // Dormant and invisible until something touches the beam: then it fires for real.
      const touched = (w.pipAlive && overlaps(w.pip, l.beam)) || w.corpses.some((c) => overlaps(c, l.beam));
      if (!touched) { l.active = false; continue; }
      w.revealed.add(l.id);
      l.blinkStart = w.lifeTick;
      w.fx.push({ t: 'laserReveal', id: l.id });
    }
    switch (l.mode) {
      case 'on': l.active = true; break;
      case 'off': l.active = false; break;
      case 'plate': {
        const p = l.def.plate ? w.obj.get<RtPlate>(l.def.plate) : undefined;
        l.active = !(p?.pressed ?? false);
        break;
      }
      case 'blink': {
        const on = l.def.on ?? 60, off = l.def.off ?? 60;
        const t = w.lifeTick - l.blinkStart + (l.def.phase ?? 0);
        l.active = ((t % (on + off)) + (on + off)) % (on + off) < on;
        break;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Kill checks & corpse/world interactions
// ---------------------------------------------------------------------------

type SpikeKind = 'floor' | 'ceiling' | 'lwall' | 'rwall';

export function spikeBox(kind: SpikeKind, cxx: number, cyy: number): Box {
  const x = cxx * U, y = cyy * U;
  switch (kind) {
    case 'floor': return { x: x + SPIKE_INSET, y: y + U - SPIKE_DEPTH, w: U - 2 * SPIKE_INSET, h: SPIKE_DEPTH };
    case 'ceiling': return { x: x + SPIKE_INSET, y, w: U - 2 * SPIKE_INSET, h: SPIKE_DEPTH };
    case 'lwall': return { x, y: y + SPIKE_INSET, w: SPIKE_DEPTH, h: U - 2 * SPIKE_INSET };
    case 'rwall': return { x: x + U - SPIKE_DEPTH, y: y + SPIKE_INSET, w: SPIKE_DEPTH, h: U - 2 * SPIKE_INSET };
  }
}

/** Spike kind at a cell, including raised pop-ups. */
export function spikeAt(w: World, cxx: number, cyy: number): SpikeKind | null {
  const g = w.tileAt(cxx, cyy);
  if (g === '^') return 'floor';
  if (g === 'v') return 'ceiling';
  if (g === '>') return 'lwall';
  if (g === '<') return 'rwall';
  for (const p of w.obj.popups) if (p.up && p.def.x === cxx && p.def.y === cyy) return 'floor';
  return null;
}

export function spikeCovered(w: World, cxx: number, cyy: number): boolean {
  return w.corpses.some((c) => c.pin && c.pin.cx === cxx && c.pin.cy === cyy);
}

interface SpikeHit { kind: SpikeKind; cx: number; cy: number; overlap: number }

function spikesTouching(w: World, box: Box): SpikeHit[] {
  const out: SpikeHit[] = [];
  const c0 = Math.floor(box.x / U), c1 = Math.floor((box.x + box.w - 1) / U);
  const r0 = Math.floor(box.y / U), r1 = Math.floor((box.y + box.h - 1) / U);
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
    const kind = spikeAt(w, c, r);
    if (!kind || spikeCovered(w, c, r)) continue;
    const sb = spikeBox(kind, c, r);
    if (!overlaps(box, sb)) continue;
    const ov = Math.min(box.x + box.w, sb.x + sb.w) - Math.max(box.x, sb.x);
    out.push({ kind, cx: c, cy: r, overlap: ov });
  }
  const pri: Record<SpikeKind, number> = { floor: 0, lwall: 1, rwall: 1, ceiling: 2 };
  out.sort((a, b) => pri[a.kind] - pri[b.kind] || b.overlap - a.overlap || a.cx - b.cx);
  return out;
}

export function hazardChecks(w: World): void {
  if (w.pipAlive) {
    const p = w.pip;
    const base = { x: p.x + (p.w >> 1), bottom: p.y + p.h };
    const spikes = spikesTouching(w, p);
    const s = spikes[0];
    let death: DeathInfo | null = null;
    if (s) {
      if (s.kind === 'floor') death = { kind: 'spike', ...base, pin: { kind: 'floor', cx: s.cx, cy: s.cy } };
      else if (s.kind === 'ceiling') death = { kind: 'spike', ...base };
      else death = { kind: 'spike', ...base, pin: { kind: 'wall', cx: s.cx, cy: s.cy } };
    }
    if (!death) for (const l of w.obj.lasers) if (l.active && overlaps(p, l.beam)) { death = { kind: 'laser', ...base }; w.fx.push({ t: 'laserZap', id: l.id }); break; }
    if (!death) {
      const surface = w.waterUnder(p);
      if (surface !== null && p.y + p.h > surface + 48) death = { kind: 'water', ...base, water: surface };
    }
    if (!death && p.y > w.H * U + U) death = { kind: 'pit', ...base };
    if (death) {
      if (death.kind === 'water') w.fx.push({ t: 'splash', x: base.x, y: death.water! });
      w.killPip(death);
    }
  }

  for (const c of [...w.corpses]) {
    for (const l of w.obj.lasers) {
      if (l.active && overlaps(c, l.beam)) {
        w.corpses = w.corpses.filter((o) => o !== c);
        w.fx.push({ t: 'vaporize', id: c.id, x: c.x + (c.w >> 1), y: c.y + (c.h >> 1) });
        w.fx.push({ t: 'laserZap', id: l.id });
        break;
      }
    }
    if (!w.corpses.includes(c)) continue;
    if (c.y > w.H * U + U) { w.corpses = w.corpses.filter((o) => o !== c); continue; }
    if (c.pin || c.floating) continue;
    const hits = spikesTouching(w, c).filter((h) => h.kind !== 'ceiling');
    const h = hits[0];
    if (h) pinCorpse(w, c, h.kind === 'floor' ? 'floor' : 'wall', h.cx, h.cy);
  }
}

// ---------------------------------------------------------------------------
// Plates & gates
// ---------------------------------------------------------------------------

export function updatePlates(w: World, silent = false): void {
  for (const p of w.obj.plates) {
    let weight = 0;
    for (const key of w.supports.keys()) {
      const root = w.rootSupport(key);
      if (root?.kind === 'obj' && root.id === p.id) weight += w.weightOf(key);
    }
    p.weight = weight;
    const pressed = weight >= p.def.need;
    p.changed = !silent && pressed !== p.pressed;
    if (p.changed) w.fx.push({ t: 'plate', id: p.id, down: pressed });
    p.pressed = pressed;
  }
}

export function updateGates(w: World, instant = false): void {
  for (const g of w.obj.gates) {
    const linked = g.def.plate ? (w.obj.get<RtPlate>(g.def.plate)?.pressed ?? false) : false;
    const target = linked !== g.toggled;
    if (target !== g.target && !instant) w.fx.push({ t: 'gate', id: g.id, open: target });
    g.target = target;
    if (instant) { g.open = target ? 1 : 0; continue; }
    if (target) g.open = Math.min(1, g.open + GATE_SPEED);
    else if (g.open > 0) {
      const next = Math.max(0, g.open - GATE_SPEED);
      const box = { x: g.x, y: g.y, w: g.w, h: Math.round(g.h * (1 - next)) };
      const hitsEntity = (w.pipAlive && overlaps(box, w.pip)) || w.corpses.some((c) => overlaps(box, c));
      if (!hitsEntity) g.open = next;
    }
  }
}
