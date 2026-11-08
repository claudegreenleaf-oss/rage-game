// Corpses: creation from a death, aging and the 3-body cap, physics, pushing, rafts.
import { U, type Corpse, type DeathType, type Stage } from './types';
import {
  CONVEYOR_SPEED, CORPSE_W, GRAVITY, LEDGE_H, MAX_CORPSES, MAX_FALL, PIN_FLOOR_H, SHIVER_TICKS,
  SKELETON_FRICTION, SLAB_H, STAGE_H, tps,
} from './constants';
import { sweepX, sweepY, xOverlapLen, overlapX } from './physics';
import type { World } from './world';

/** Where a wall-spike ledge sits inside its tile. */
export const LEDGE_TOP = 24;

export interface DeathInfo {
  kind: DeathType;
  /** Pip's centre x and bottom y at death. */
  x: number;
  bottom: number;
  pin?: { kind: 'floor' | 'wall'; cx: number; cy: number };
  slab?: boolean;
  /** Water surface y for drownings. */
  water?: number;
}

export function shapeHeight(c: Pick<Corpse, 'stage' | 'shape' | 'pin'>): number {
  if (c.pin?.kind === 'floor') return PIN_FLOOR_H;
  if (c.pin?.kind === 'wall') return LEDGE_H[c.stage];
  if (c.shape === 'slab') return SLAB_H;
  return STAGE_H[c.stage];
}

/** Re-fit a corpse's box after a stage change, keeping the edge it rests on. */
function refit(c: Corpse): void {
  const h = shapeHeight(c);
  if (c.pin?.kind === 'wall') { c.h = h; return; } // ledges keep their top
  c.y += c.h - h; // everything else keeps its bottom
  c.h = h;
}

/** Pin a corpse over a spike tile. */
export function pinCorpse(w: World, c: Corpse, kind: 'floor' | 'wall', pcx: number, pcy: number): void {
  c.pin = { kind, cx: pcx, cy: pcy };
  c.floating = false;
  c.vx = 0; c.vy = 0;
  c.x = pcx * U;
  c.w = CORPSE_W;
  c.h = shapeHeight(c);
  c.y = kind === 'floor' ? (pcy + 1) * U - c.h : pcy * U + LEDGE_TOP;
  w.fx.push({ t: 'pin', id: c.id });
}

/** A death that leaves a body: age everyone, enforce the cap, then add the fresh body. */
export function spawnCorpse(w: World, info: DeathInfo): void {
  if (info.kind === 'pit' || info.kind === 'laser') return; // no body, no aging

  const aging = w.level.rules?.aging !== false;
  for (const c of aging ? [...w.corpses].filter((k) => k.kind !== 'crate').sort((a, b) => a.born - b.born) : []) {
    const next = (c.stage + 1) as number;
    if (next > 2) {
      w.corpses = w.corpses.filter((o) => o !== c);
      w.fx.push({ t: 'dust', id: c.id, x: c.x + (c.w >> 1), y: c.y + (c.h >> 1) });
    } else {
      c.stage = next as Stage;
      c.shiver = SHIVER_TICKS;
      refit(c);
      w.fx.push({ t: 'age', id: c.id, stage: c.stage });
    }
  }
  // Belt and braces: the stage rule already guarantees the cap.
  const cap = Math.max(1, Math.min(6, w.level.rules?.maxCorpses ?? MAX_CORPSES));
  while (w.corpses.filter((k) => k.kind !== 'crate').length >= cap) {
    const oldest = w.corpses.filter((k) => k.kind !== 'crate').reduce((a, b) => (a.born < b.born ? a : b));
    w.corpses = w.corpses.filter((o) => o !== oldest);
    w.fx.push({ t: 'dust', id: oldest.id, x: oldest.x + (oldest.w >> 1), y: oldest.y + (oldest.h >> 1) });
  }

  const c: Corpse = {
    id: w.newCorpseId(), born: w.newBorn(), stage: 0,
    shape: info.slab ? 'slab' : 'body', pin: null, floating: false,
    x: info.x - (CORPSE_W >> 1), y: 0, w: CORPSE_W, h: 0, vx: 0, vy: 0, px: 0, py: 0, shiver: 0, grounded: false,
  };
  c.h = shapeHeight(c);
  c.y = info.bottom - c.h;
  if (info.water !== undefined) { c.floating = true; c.y = info.water - c.h; }

  if (info.pin) {
    pinCorpse(w, c, info.pin.kind, info.pin.cx, info.pin.cy);
    w.fx.pop(); // the corpse event below covers it
  } else {
    if (c.x < 0) c.x = 0;
    if (c.x + c.w > w.W * U) c.x = w.W * U - c.w;
    const spot = w.findFreeSpot(c, c.id);
    if (spot) { c.x = spot.x; c.y = spot.y; }
  }
  c.px = c.x; c.py = c.y;
  w.corpses.push(c);
  w.fx.push({ t: 'corpse', id: c.id });
}

/**
 * Push a corpse sideways (by Pip or a chain of corpses). Bodies in the way are pushed too.
 * Returns how far it actually moved.
 */
export function pushCorpse(w: World, c: Corpse, dx: number, depth = 0): number {
  if (c.pin || dx === 0) return 0;
  let solids = w.solidsAround(c, dx, 0, c.id, false);
  let { d, hit } = sweepX(c, dx, solids);
  if (hit && d !== dx && hit.kind === 'corpse' && depth < 3) {
    const o = w.corpseById(hit.id as number);
    if (o && !o.pin) {
      pushCorpse(w, o, dx - d, depth + 1);
      solids = w.solidsAround(c, dx, 0, c.id, false);
      ({ d } = sweepX(c, dx, solids));
    }
  }
  if (d === 0) return 0;
  return w.moveEntity(c.id, d, 0).dx;
}

export function updateCorpses(w: World): void {
  // Bottom-most first so stacks settle in one tick.
  const order = [...w.corpses].sort((a, b) => b.y + b.h - (a.y + a.h) || a.id - b.id);
  for (const c of order) {
    if (!w.corpses.includes(c)) continue;
    if (c.shiver > 0) c.shiver--;
    if (c.pin) continue;

    if (c.floating) {
      const col = Math.floor((c.x + (c.w >> 1)) / U);
      const surface = w.waterSurfaceAt(col, c.y + c.h);
      if (surface === null) {
        c.floating = false;
      } else {
        c.vy = 0;
        if (c.y + c.h !== surface) w.moveEntity(c.id, 0, surface - (c.y + c.h));
        const v = w.current.dir * tps(w.current.speed);
        if (v !== 0) w.moveEntity(c.id, v, 0);
        continue;
      }
    }

    // Gravity (plain sweep: whatever rides on us falls by itself).
    c.vy = Math.min(c.vy + GRAVITY, MAX_FALL);
    const solids = w.solidsAround(c, 0, c.vy, c.id, true);
    const { d, hit } = sweepY(c, c.vy, solids);
    c.y += d;
    if (hit) {
      if (!c.grounded && c.vy > 9) w.fx.push({ t: 'land', x: c.x + (c.w >> 1), y: c.y + c.h, impact: c.vy });
      c.vy = 0;
      c.grounded = true;
    } else c.grounded = false;

    // Falling into water turns a body into a raft.
    const col = Math.floor((c.x + (c.w >> 1)) / U);
    const surface = w.waterSurfaceAt(col, c.y + c.h - 1);
    if (surface !== null && c.y + c.h > surface + 24) {
      c.floating = true;
      c.vy = 0;
      c.y = surface - c.h;
      const spot = w.findFreeSpot(c, c.id);
      if (spot) { c.x = spot.x; c.y = spot.y; }
      w.fx.push({ t: 'splash', x: c.x + (c.w >> 1), y: surface });
      continue;
    }

    // Skeletons slide when kicked.
    if (c.vx !== 0) {
      const moved = w.moveEntity(c.id, c.vx, 0).dx;
      if (moved !== c.vx) c.vx = 0;
      else c.vx = c.vx > 0 ? Math.max(0, c.vx - SKELETON_FRICTION) : Math.min(0, c.vx + SKELETON_FRICTION);
    }

    if (!c.grounded) continue;

    // Conveyors carry bodies.
    const sup = w.supports.get(c.id);
    if (sup?.kind === 'tile' && (sup.glyph === '}' || sup.glyph === '{')) {
      w.moveEntity(c.id, sup.glyph === '}' ? CONVEYOR_SPEED : -CONVEYOR_SPEED, 0);
    }

    topple(w, c);
  }
}

/** A body whose centre hangs over nothing slides off toward the empty side (so it drops into 1-wide wells). */
function topple(w: World, c: Corpse): void {
  const probe = { x: c.x, y: c.y + c.h, w: c.w, h: 1 };
  const under = w.solidsIn(probe, c.id, true).filter((s) => s.y === c.y + c.h && overlapX(probe, s));
  if (under.length === 0) return;
  const mid = c.x + (c.w >> 1);
  if (under.some((s) => s.x <= mid && s.x + s.w > mid)) return;
  const leftOv = under.filter((s) => s.x + s.w <= mid).reduce((m, s) => Math.max(m, xOverlapLen(probe, s)), 0);
  const rightOv = under.filter((s) => s.x > mid).reduce((m, s) => Math.max(m, xOverlapLen(probe, s)), 0);
  if (leftOv > 0 && rightOv > 0) return;
  const dir = leftOv > 0 ? 1 : -1;
  const amount = Math.min(24, Math.max(leftOv, rightOv));
  // Slide toward the drop even if Pip is pressed against us (we fall clear next tick).
  const solids = w.solidsAround(c, dir * amount, 0, c.id, false);
  const moved = sweepX(c, dir * amount, solids).d;
  if (moved !== 0) w.moveEntity(c.id, moved, 0, 0, true);
}
