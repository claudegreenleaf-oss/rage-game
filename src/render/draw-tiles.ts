// Static terrain layer: rounded charcoal blocks with a dark outline and a lighter top edge, plus spikes.
import type Phaser from 'phaser';
import type { TileGlyph } from '../sim/types';
import { C, TILE } from './palette';

const SOLID_LOOK = new Set<TileGlyph>(['#', '=', 'X', '}', '{']);
const R = 9;
const O = 3; // outline thickness

export interface TerrainSource {
  W: number;
  H: number;
  tileAt(cx: number, cy: number): TileGlyph;
}

/** Cells that should render as terrain even though the sim doesn't hold a tile there (idle droppers). */
export type ExtraSolids = Set<number>;
export const cellKey = (cx: number, cy: number): number => cy * 1000 + cx;

function hash(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h ^ (h >>> 16)) / 4294967296;
}

export function looksSolid(src: TerrainSource, extra: ExtraSolids | null, cx: number, cy: number): boolean {
  if (cx < 0 || cy < 0 || cx >= src.W) return true;
  if (cy >= src.H) return false;
  if (extra?.has(cellKey(cx, cy))) return true;
  return SOLID_LOOK.has(src.tileAt(cx, cy));
}

/** One terrain block at (x,y) in px given which neighbours are solid. Used for terrain, droppers and movers. */
export function drawBlock(g: Phaser.GameObjects.Graphics, x: number, y: number, n: boolean, s: boolean, e: boolean, w: boolean, seed = 0): void {
  const r = { tl: !n && !w ? R : 0, tr: !n && !e ? R : 0, bl: !s && !w ? R : 0, br: !s && !e ? R : 0 };
  // Outline pass: grow on exposed sides only so neighbouring blocks merge into one shape.
  const ox = w ? 0 : O, oy = n ? 0 : O, ow = (e ? 0 : O) + ox, oh = (s ? 0 : O) + oy;
  g.fillStyle(C.outline, 1);
  g.fillRoundedRect(x - ox, y - oy, TILE + ow, TILE + oh, { tl: r.tl ? R + O : 0, tr: r.tr ? R + O : 0, bl: r.bl ? R + O : 0, br: r.br ? R + O : 0 });
  g.fillStyle(C.solid, 1);
  g.fillRoundedRect(x, y, TILE, TILE, r);
  if (!s) {
    g.fillStyle(C.solidShade, 1);
    g.fillRoundedRect(x + (w ? 0 : 2), y + TILE - 7, TILE - (w ? 0 : 2) - (e ? 0 : 2), 7, { tl: 0, tr: 0, bl: r.bl ? R - 2 : 0, br: r.br ? R - 2 : 0 });
  }
  if (!n) {
    g.fillStyle(C.solidTop, 1);
    g.fillRoundedRect(x + (w ? 0 : 2), y, TILE - (w ? 0 : 2) - (e ? 0 : 2), 7, { tl: r.tl ? R - 2 : 0, tr: r.tr ? R - 2 : 0, bl: 0, br: 0 });
    g.fillStyle(C.solidHi, 1);
    g.fillRoundedRect(x + (w ? 0 : 7), y + 2, TILE - (w ? 0 : 7) - (e ? 0 : 7), 2.5, w && e ? 0 : 1.2);
  }
  // Interior cells get soft rounded stones so big walls have depth.
  if (n && s && e && w) {
    const row = Math.floor(y / TILE);
    g.fillStyle(C.solidShade, 0.45);
    if (row % 2 === 0) g.fillRoundedRect(x + 3, y + 4, TILE - 6, TILE - 9, 7);
    else {
      g.fillRoundedRect(x, y + 4, TILE / 2 - 3, TILE - 9, { tl: 0, bl: 0, tr: 7, br: 7 });
      g.fillRoundedRect(x + TILE / 2 + 3, y + 4, TILE / 2 - 3, TILE - 9, { tl: 7, bl: 7, tr: 0, br: 0 });
    }
  }
  // A few soft specks so big walls don't look flat.
  const h = hash(x + seed, y);
  if (n && h < 0.45) {
    g.fillStyle(C.solidTop, 0.55);
    g.fillCircle(x + 8 + h * 50 % 24, y + 10 + (h * 977) % 18, 2.2);
    if (h < 0.18) g.fillCircle(x + 26 - h * 40, y + 28 - h * 30, 1.6);
  }
}

/** The room's back wall: a soft paper panel with a faint pattern and ambient occlusion along the walls. */
function drawRoom(g: Phaser.GameObjects.Graphics, src: TerrainSource, extra: ExtraSolids | null, tint: number): void {
  g.fillStyle(tint, 0.55);
  g.fillRect(0, 0, src.W * TILE, src.H * TILE);
  for (let cy = 0; cy < src.H; cy++)
    for (let cx = 0; cx < src.W; cx++) {
      if (looksSolid(src, extra, cx, cy)) continue;
      const x = cx * TILE, y = cy * TILE;
      // wallpaper: alternating soft diamonds
      if ((cx + cy) % 2 === 0) {
        g.fillStyle(C.outline, 0.035);
        g.fillTriangle(x + 20, y + 10, x + 30, y + 20, x + 20, y + 30);
        g.fillTriangle(x + 20, y + 10, x + 10, y + 20, x + 20, y + 30);
      }
      // ambient occlusion next to solid neighbours
      const S = (dx: number, dy: number) => looksSolid(src, extra, cx + dx, cy + dy);
      for (let i = 0; i < 4; i++) {
        const a = 0.07 * (1 - i / 4), d = i * 4;
        g.fillStyle(C.outline, a);
        if (S(0, -1)) g.fillRect(x, y + d, TILE, 4);
        if (S(-1, 0)) g.fillRect(x + d, y, 4, TILE);
        if (S(1, 0)) g.fillRect(x + TILE - d - 4, y, 4, TILE);
      }
      if (S(0, 1)) { g.fillStyle(C.outline, 0.06); g.fillRect(x, y + TILE - 5, TILE, 5); }
    }
}

export function drawTerrain(g: Phaser.GameObjects.Graphics, src: TerrainSource, extra: ExtraSolids | null, roomTint: number = C.paper): void {
  g.clear();
  drawRoom(g, src, extra, roomTint);
  for (let cy = 0; cy < src.H; cy++)
    for (let cx = 0; cx < src.W; cx++) {
      if (!looksSolid(src, extra, cx, cy)) continue;
      const S = (dx: number, dy: number) => looksSolid(src, extra, cx + dx, cy + dy);
      drawBlock(g, cx * TILE, cy * TILE, S(0, -1), S(0, 1), S(1, 0), S(-1, 0));
    }
  for (let cy = 0; cy < src.H; cy++)
    for (let cx = 0; cx < src.W; cx++) {
      const t = src.tileAt(cx, cy);
      if (t === '^' || t === 'v' || t === '>' || t === '<') drawSpikes(g, cx * TILE, cy * TILE, t, 1);
    }
}

/** Three coral spikes in a tile. `rise` (0..1) scales them out of their base (pop-ups). */
export function drawSpikes(g: Phaser.GameObjects.Graphics, x: number, y: number, kind: '^' | 'v' | '>' | '<', rise: number): void {
  const H = 19 * rise;
  if (H <= 0.5) return;
  const n = 3, wEach = TILE / n;
  const pts: Array<[number, number, number, number, number, number]> = [];
  for (let i = 0; i < n; i++) {
    const a = i * wEach + 1.5, b = (i + 1) * wEach - 1.5, m = (a + b) / 2;
    switch (kind) {
      case '^': pts.push([x + a, y + TILE, x + b, y + TILE, x + m, y + TILE - H]); break;
      case 'v': pts.push([x + a, y, x + b, y, x + m, y + H]); break;
      case '>': pts.push([x, y + a, x, y + b, x + H, y + m]); break;
      case '<': pts.push([x + TILE, y + a, x + TILE, y + b, x + TILE - H, y + m]); break;
    }
  }
  g.lineStyle(3, C.outline, 1);
  for (const p of pts) {
    g.fillStyle(C.hazard, 1);
    g.fillTriangle(...p);
    // highlight on one face
    g.fillStyle(C.hazardHi, 0.9);
    const [x1, y1, , , x3, y3] = p;
    g.fillTriangle(x1, y1, (p[0] + p[2]) / 2, (p[1] + p[3]) / 2, x3, y3);
    g.fillStyle(C.hazard, 1);
    g.fillTriangle((p[0] + p[2]) / 2 + (kind === '^' || kind === 'v' ? 1.5 : 0), (p[1] + p[3]) / 2 + (kind === '>' || kind === '<' ? 1.5 : 0), p[2], p[3], x3, y3);
    g.strokeTriangle(...p);
  }
}
