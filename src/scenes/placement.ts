// Where on-screen text may go: scores a screen rectangle by what it would cover (Pip, hazards,
// doors, pads, exits, solid tiles). Used by the HUD for sign bubbles and the reading panel.
import type { Game } from './Game';
import { TILE } from '../render/palette';
import { U } from '../sim/types';

export interface Rect { x: number; y: number; w: number; h: number }

export const overlapArea = (a: Rect, b: Rect): number => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
};
export const hits = (a: Rect, b: Rect): boolean => overlapArea(a, b) > 0;

export interface Cover {
  /** Pip's box, padded, in screen pixels (null when Pip is gone). */
  pip: Rect | null;
  /** Things that must stay readable, in screen pixels. */
  crucial: Rect[];
  /** Score a candidate rectangle: lower is better; >= 1000 means it covers Pip. */
  score(r: Rect): number;
}

/** Snapshot of what is on screen right now. */
export function coverMap(g: Game): Cover {
  const w = g.world, cam = g.cameras.main;
  const box = (b: { x: number; y: number; w: number; h: number }, pad = 0): Rect => {
    const a = g.toScreen(b.x, b.y), c = g.toScreen(b.x + b.w, b.y + b.h);
    return { x: a.x - pad, y: a.y - pad, w: c.x - a.x + pad * 2, h: c.y - a.y + pad * 2 };
  };
  const o = w.obj;
  const crucial: Rect[] = [];
  for (const d of o.droppers) if (d.state !== 'gone') crucial.push(box(d, 6));
  for (const c of o.crushers) crucial.push(box(c, 6));
  for (const l of o.lasers) { crucial.push(box(l.beam, 6)); if (l.emitterBox) crucial.push(box(l.emitterBox, 4)); }
  for (const d of o.doors) crucial.push(box(d, 6));
  for (const p of o.plates) crucial.push(box(p, 6));
  for (const gt of o.gates) crucial.push(box(gt, 4));
  for (const p of o.platforms) crucial.push(box(p, 4));
  for (const gd of o.gadgets) if (!gd.gone) crucial.push(box(gd, 4));
  for (const e of w.level.exits ?? []) crucial.push(box({ x: e.x * U, y: e.y * U, w: e.w * U, h: e.h * U }, 4));
  for (const ob of w.level.objects) {
    if (ob.type === 'relic' || ob.type === 'bench' || ob.type === 'crate') crucial.push(box({ x: ob.x * U, y: ob.y * U, w: U, h: U }, 4));
  }
  const p = w.pip;
  const pip = w.pipAlive ? box(p, 22) : null;
  const score = (r: Rect): number => {
    let s = 0;
    if (pip) s += overlapArea(r, pip) > 0 ? 1000 : 0;
    for (const c of crucial) if (hits(r, c)) s += 80;
    // Sample the tiles under the rectangle: hazards cost most, solid ground costs a little.
    const k = cam.zoom, step = Math.max(16, (TILE * k) / 2);
    let cells = 0, cost = 0;
    for (let sx = r.x + step / 2; sx < r.x + r.w; sx += step) {
      for (let sy = r.y + step / 2; sy < r.y + r.h; sy += step) {
        cells++;
        const cx = Math.floor(((sx - 640) / k + cam.scrollX + 640) / TILE), cy = Math.floor(((sy - 360) / k + cam.scrollY + 360) / TILE);
        if (cx < 0 || cy < 0 || cx >= w.W || cy >= w.H) continue;
        const gl = w.tileAt(cx, cy);
        if (gl === '.') continue;
        cost += gl === '^' || gl === 'v' || gl === '>' || gl === '<' || gl === '~' || gl === 'X' ? 3 : 1;
      }
    }
    if (cells) s += (cost / cells) * 60;
    return s;
  };
  return { pip, crucial, score };
}
