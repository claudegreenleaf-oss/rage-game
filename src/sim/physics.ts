// AABB helpers and swept collision against a list of solids. Integer units only.
import type { Box } from './types';

export type SolidKind =
  | 'tile' | 'conveyor' | 'plate' | 'gate' | 'platform' | 'mover'
  | 'crusher' | 'dropper' | 'emitter' | 'corpse' | 'pip';

export interface Solid extends Box {
  kind: SolidKind;
  /** Solid only from above (skeletons). */
  oneWay: boolean;
  /** Object id (string), corpse id (number) or tile index. */
  id: string | number;
  /** Conveyor direction for conveyor tiles. */
  conveyor?: -1 | 1;
}

export const overlapX = (a: Box, b: Box): boolean => a.x < b.x + b.w && b.x < a.x + a.w;
export const overlapY = (a: Box, b: Box): boolean => a.y < b.y + b.h && b.y < a.y + a.h;
export const overlaps = (a: Box, b: Box): boolean => overlapX(a, b) && overlapY(a, b);
export const xOverlapLen = (a: Box, b: Box): number => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
export const cx = (b: Box): number => b.x + (b.w >> 1);
export const bottom = (b: Box): number => b.y + b.h;
export const right = (b: Box): number => b.x + b.w;

export interface SweepResult { d: number; hit: Solid | null }

/**
 * Move `box` vertically by `dy`, stopping at the first solid in the way.
 * Solids already overlapping the box are ignored so things never get stuck.
 * One-way solids only stop downward motion that starts at or above their top.
 */
export function sweepY(box: Box, dy: number, solids: readonly Solid[], ignoreOneWay = false): SweepResult {
  let d = dy;
  let hit: Solid | null = null;
  if (dy > 0) {
    const b = box.y + box.h;
    for (const s of solids) {
      if (s.oneWay && ignoreOneWay) continue;
      if (!overlapX(box, s)) continue;
      if (s.y < b) continue; // top above our bottom: already overlapping/passed
      const gap = s.y - b;
      if (gap < d || (gap === d && hit === null)) { d = gap; hit = s; }
    }
  } else if (dy < 0) {
    for (const s of solids) {
      if (s.oneWay) continue;
      if (!overlapX(box, s)) continue;
      const sb = s.y + s.h;
      if (sb > box.y) continue;
      const gap = sb - box.y; // <= 0
      if (gap > d || (gap === d && hit === null)) { d = gap; hit = s; }
    }
  }
  return { d, hit };
}

/** Horizontal sweep. One-way solids never block sideways. */
export function sweepX(box: Box, dx: number, solids: readonly Solid[]): SweepResult {
  let d = dx;
  let hit: Solid | null = null;
  if (dx > 0) {
    const r = box.x + box.w;
    for (const s of solids) {
      if (s.oneWay || !overlapY(box, s)) continue;
      if (s.x < r) continue;
      const gap = s.x - r;
      if (gap < d || (gap === d && hit === null)) { d = gap; hit = s; }
    }
  } else if (dx < 0) {
    for (const s of solids) {
      if (s.oneWay || !overlapY(box, s)) continue;
      const sr = s.x + s.w;
      if (sr > box.x) continue;
      const gap = sr - box.x;
      if (gap > d || (gap === d && hit === null)) { d = gap; hit = s; }
    }
  }
  return { d, hit };
}

/** True if `box` overlaps any non-one-way solid. */
export function blocked(box: Box, solids: readonly Solid[]): boolean {
  for (const s of solids) if (!s.oneWay && overlaps(box, s)) return true;
  return false;
}

/** Union of a box and the same box moved by (dx, dy): the region a sweep can touch. */
export function sweptRegion(box: Box, dx: number, dy: number): Box {
  const x0 = Math.min(box.x, box.x + dx);
  const y0 = Math.min(box.y, box.y + dy);
  return { x: x0 - 1, y: y0 - 1, w: box.w + Math.abs(dx) + 2, h: box.h + Math.abs(dy) + 2 };
}

/** Candidate offsets for "nearest free spot", cheapest first (prefers straight up). */
export const FREE_SPOT_OFFSETS: ReadonlyArray<readonly [number, number]> = (() => {
  const out: Array<[number, number, number]> = [];
  for (let dy = 0; dy >= -720; dy -= 12)
    for (let dx = -240; dx <= 240; dx += 12) out.push([dx, dy, Math.abs(dx) + Math.abs(dy) * 0.5]);
  out.sort((a, b) => a[2] - b[2] || a[1] - b[1] || a[0] - b[0]);
  return out.map(([dx, dy]) => [dx, dy] as const);
})();
