// Bakes a level's static terrain into canvas textures, pixel by pixel, in the abandoned-lab style:
// beveled steel plating with seams, rivets and glowing trim (some lights dead), vents, hazard panels,
// cracks, dents and stains; moss and ivy on exposed edges, roots in the seams and vines hanging from
// ceilings; a tiled lab back wall with screens, cables and grime, shaded by ambient occlusion.
// All decay is chosen by a seeded hash, so a level always looks the same. Baked once per level (and
// again only when an event changes the tiles), so drawing it costs nothing per frame.
import Phaser from 'phaser';
import { KEY, actPal, hash2, mix, type ActPal } from './pal';

export const T = 16; // pixels per tile

export type SolidFn = (cx: number, cy: number) => boolean;

/** RGBA pixel buffer written straight into a canvas with one putImageData. */
export class Buf {
  readonly data: Uint8ClampedArray;
  constructor(readonly w: number, readonly h: number) { this.data = new Uint8ClampedArray(w * h * 4); }
  set(x: number, y: number, c: number, a = 1): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    this.data[i] = (c >> 16) & 255; this.data[i + 1] = (c >> 8) & 255; this.data[i + 2] = c & 255; this.data[i + 3] = Math.round(a * 255);
  }
  /** Read back a pixel's colour (alpha ignored). */
  get(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    const i = (y * this.w + x) * 4;
    return (this.data[i]! << 16) | (this.data[i + 1]! << 8) | this.data[i + 2]!;
  }
  alpha(x: number, y: number): number { if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0; return this.data[(y * this.w + x) * 4 + 3]!; }
  clear(x: number, y: number): void { if (x < 0 || y < 0 || x >= this.w || y >= this.h) return; this.data[(y * this.w + x) * 4 + 3] = 0; }
  blit(ctx: CanvasRenderingContext2D, x = 0, y = 0): void { ctx.putImageData(new ImageData(this.data as unknown as Uint8ClampedArray<ArrayBuffer>, this.w, this.h), x, y); }
}

const SOLIDS = new Set(['#', 'X', '=', '}', '{']);
export const isSolidGlyph = (g: string | undefined): boolean => g !== undefined && SOLIDS.has(g);

const K = () => KEY.k!;

/** One 16×16 lab panel at (ox, oy); `solid` tells it which neighbours are solid. */
export function drawPanel(b: Buf, ox: number, oy: number, cx: number, cy: number, solid: SolidFn, pal: ActPal, decay = true): void {
  const n = solid(cx, cy - 1), s = solid(cx, cy + 1), w = solid(cx - 1, cy), e = solid(cx + 1, cy);
  const nw = solid(cx - 1, cy - 1), ne = solid(cx + 1, cy - 1), sw = solid(cx - 1, cy + 1), se = solid(cx + 1, cy + 1);
  const deep = n && s && w && e && nw && ne && sw && se;
  const r = (k: number) => hash2(cx, cy, k);
  const v = r(1);
  const variant = deep ? (v < 0.1 ? 'root' : v < 0.14 ? 'crack' : 'plain') :
    v < 0.12 ? 'vent' : v < 0.2 ? 'hazard' : v < 0.34 ? 'crack' : v < 0.46 ? 'stain' : v < 0.54 ? 'dent' : 'plain';
  const base = deep ? mix(pal.plate, pal.plateDark, 0.4) : pal.plate;
  for (let j = 0; j < T; j++) for (let i = 0; i < T; i++) {
    let c = base;
    if (deep) {
      // Buried plating: one big mass with faint 2×2-tile seams.
      const gx = cx * T + i, gy = cy * T + j;
      if (gx % 32 === 0 || gy % 32 === 0) c = mix(base, pal.plateDark, 0.5);
      else if (gx % 32 === 1 || gy % 32 === 1) c = mix(base, pal.plateLight, 0.12);
    } else if (j === 0 || i === 0) c = (n && j === 0) || (w && i === 0) ? pal.plateDark : c;
    else if (j === 1 || i === 1) c = mix(base, pal.plateLight, 0.55);
    else if (j === T - 1 || i === T - 1) c = mix(base, pal.plateDark, 0.6);
    // Brushed-metal streaks.
    if (c === base && hash2(cx * T + i, cy * 3 + (j >> 2), 4) < 0.05) c = mix(base, pal.plateLight, 0.3);
    if (variant === 'vent' && i >= 4 && i <= 11 && j >= 6 && j <= 11) c = j % 2 === 0 ? pal.plateDark : mix(pal.plateDark, base, 0.5);
    if (variant === 'hazard' && j >= 10 && j <= 13 && i >= 2 && i <= 13) c = ((i + j) >> 1) % 2 === 0 ? KEY.z! : K();
    if (variant === 'stain') { const d = Math.hypot(i - 9 - r(2) * 3, j - 9); if (d < 4.5 && hash2(cx * T + i, cy * T + j, 6) < 0.8) c = mix(c, pal.stain, d < 2.5 ? 0.55 : 0.3); }
    if (variant === 'dent' && Math.abs(Math.hypot(i - 8, j - 8) - 3) < 0.6) c = j < 8 ? pal.plateDark : pal.plateLight;
    // Rivets near the corners of visible plates.
    if (!deep && (i === 3 || i === T - 4) && (j === 3 || j === T - 4)) c = pal.plateHi;
    // Exposed edges: outline, with a light rim on top/left and shadow bottom/right.
    if (!w && i === 1) c = pal.plateLight;
    if (!e && i === T - 2) c = pal.plateDark;
    if (!s && j === T - 2) c = pal.plateDark;
    if (!n && j === 1) c = pal.plateHi;
    if ((!w && i === 0) || (!e && i === T - 1) || (!n && j === 0) || (!s && j === T - 1)) c = K();
    b.set(ox + i, oy + j, c);
  }
  // Glowing trim strip under exposed tops (a few lights are dead or dimmed).
  if (!n) for (let i = 3; i < T - 3; i++) b.set(ox + i, oy + 4, r(8) < 0.18 ? pal.plateDark : hash2(cx * T + i, cy, 9) < 0.08 ? mix(pal.trim, pal.plate, 0.6) : pal.trim);
  if (!s && r(10) < 0.5) for (let i = 4; i < T - 4; i++) b.set(ox + i, oy + T - 4, mix(pal.trim, pal.plate, 0.45));
  if (variant === 'crack') {
    let x = 3 + Math.floor(r(11) * 9), y = 2;
    for (let k = 0; k < 12 && y < T - 2; k++) {
      b.set(ox + x, oy + y, K()); b.set(ox + x + 1, oy + y, pal.plateLight);
      y++; if (hash2(cx, cy * 31 + k, 12) < 0.4) x += hash2(cx, k, 13) < 0.5 ? -1 : 1;
      x = Math.max(2, Math.min(T - 3, x));
    }
  }
  if (variant === 'root' && decay) {
    let x = Math.floor(r(14) * T);
    for (let j = 0; j < T; j++) { b.set(ox + x, oy + j, pal.root); if (j % 3 === 0) x = Math.max(0, Math.min(T - 1, x + (hash2(cx, j, 15) < 0.5 ? -1 : 1))); }
  }
  // Rounded convex corners and inner-corner notches.
  const corner = (x0: number, y0: number, dx: number, dy: number) => {
    b.clear(ox + x0, oy + y0);
    b.set(ox + x0 + dx, oy + y0, K()); b.set(ox + x0, oy + y0 + dy, K()); b.set(ox + x0 + dx, oy + y0 + dy, K());
  };
  if (!n && !w) corner(0, 0, 1, 1);
  if (!n && !e) corner(T - 1, 0, -1, 1);
  if (!s && !w) corner(0, T - 1, 1, -1);
  if (!s && !e) corner(T - 1, T - 1, -1, -1);
  if (n && w && !nw) b.set(ox, oy, K());
  if (n && e && !ne) b.set(ox + T - 1, oy, K());
  if (s && w && !sw) b.set(ox, oy + T - 1, K());
  if (s && e && !se) b.set(ox + T - 1, oy + T - 1, K());
  if (!decay) return;
  // Moss on exposed tops: a lumpy cushion with tufts above and strands over the front.
  if (!n) {
    for (let i = 0; i < T; i++) {
      if ((i === 0 && !w) || (i === T - 1 && !e)) continue;
      const gx = cx * T + i;
      const lump = hash2(gx, cy, 21);
      b.set(ox + i, oy, K());
      b.set(ox + i, oy + 1, pal.moss);
      b.set(ox + i, oy + 2, lump < 0.55 ? pal.mossDark : pal.moss);
      if (lump < 0.35) { b.set(ox + i, oy - 1, pal.moss); b.set(ox + i, oy - 2, K()); } else b.set(ox + i, oy - 1, K());
      if (lump < 0.1) { b.set(ox + i, oy - 2, pal.mossLight); b.set(ox + i, oy - 3, K()); }
      if (hash2(gx, cy, 22) < 0.07) b.set(ox + i, oy + 1, pal.mossLight);
      const len = hash2(gx, cy, 23) < 0.18 ? 2 + Math.floor(hash2(gx, cy, 24) * 5) : 0;
      for (let k = 0; k < len; k++) b.set(ox + i, oy + 3 + k, k === len - 1 ? pal.mossLight : pal.mossDark);
    }
  }
  // Ivy creeping up exposed sides.
  for (const side of [w ? -1 : 0, e ? -1 : T - 1]) {
    if (side < 0 || r(30 + side) > 0.35) continue;
    const top = Math.floor(r(32 + side) * 8);
    for (let j = top; j < T; j++) {
      b.set(ox + side, oy + j, j % 3 === 0 ? pal.mossLight : pal.moss);
      if (j % 4 === 1) b.set(ox + side + (side === 0 ? 1 : -1), oy + j, pal.mossDark);
    }
  }
}

/** Kept for callers that draw single blocks (title floor). */
export const drawStone = drawPanel;

/** Lab back wall for an empty interior cell, with decor and ambient occlusion next to solids. */
function drawWall(b: Buf, ox: number, oy: number, cx: number, cy: number, solid: SolidFn, pal: ActPal, act: number): void {
  const n = solid(cx, cy - 1), w = solid(cx - 1, cy), e = solid(cx + 1, cy), s = solid(cx, cy + 1), nw = solid(cx - 1, cy - 1), ne = solid(cx + 1, cy - 1);
  const r = (k: number) => hash2(cx, cy, 40 + k);
  for (let j = 0; j < T; j++) for (let i = 0; i < T; i++) {
    const gx = cx * T + i, gy = cy * T + j;
    let c = gx % 8 === 7 || gy % 8 === 7 ? pal.wallDark : pal.wall;
    if (c === pal.wall && hash2(gx >> 3, gy >> 3, 41) < 0.12) c = mix(pal.wall, pal.wallDark, 0.35);
    if (c === pal.wall && hash2(gx, gy, 42) < 0.015) c = pal.wallHi;
    b.set(ox + i, oy + j, c);
  }
  const d = r(0);
  const put = (x: number, y: number, c: number, a = 1) => b.set(ox + x, oy + y, c, a);
  if (d < 0.025) {
    for (let j = 4; j < 10; j++) for (let i = 4; i < 12; i++) put(i, j, j === 4 || j === 9 || i === 4 || i === 11 ? pal.plateDark : mix(KEY.k!, pal.glow, r(1) < 0.4 ? 0.3 : 0.1));
    put(6, 6, pal.glow); put(8, 10, KEY.K!); put(7, 10, KEY.K!);
  } else if (d < 0.1) {
    for (let j = 5; j < 11; j++) for (let i = 3; i < 13; i++) put(i, j, j % 2 ? pal.wallDark : mix(pal.wallDark, KEY.K!, 0.4));
  } else if (d < 0.16) {
    let x = 2 + Math.floor(r(3) * 10);
    for (let j = 1; j < 14; j++) { put(x, j, pal.wallDark); if (j % 3 === 0) x += r(4 + j) < 0.5 ? -1 : 1; }
  } else if (d < 0.26 && act === 3) {
    for (let i = 5; i < 11; i++) { put(i, 3, KEY.K!); put(i, 4, pal.trim); put(i, 5, mix(pal.trim, pal.wall, 0.5)); }
  } else if (d < 0.3 && act === 3) {
    for (const [x, y] of [[4, 11], [5, 12], [6, 12], [7, 12], [8, 12], [9, 12], [10, 11], [4, 13], [10, 13]] as const) put(x, y, KEY.o!);
  }
  // Cable runs span whole rows, sagging between brackets every few tiles.
  if (hash2(0, cy, 47) < 0.3) {
    const y = 2 + Math.floor(hash2(1, cy, 47) * 10);
    for (let i = 0; i < T; i++) {
      const gx = cx * T + i, sag = Math.round(Math.sin(((gx % 48) / 48) * Math.PI) * 2);
      put(i, y + sag, KEY.K!); put(i, y + sag + 1, mix(KEY.K!, pal.wallDark, 0.5));
      if (gx % 48 === 0) { put(i, y - 1, pal.plateDark); put(i, y, pal.plateDark); }
    }
  }
  // Moss creeping up from floors, water stains under ceilings in the flooded wing.
  const growth = act === 2 ? 0.5 : act === 3 ? 0.35 : 0.18;
  if (s) for (let i = 0; i < T; i++) { const hgt = hash2(cx * T + i, cy, 43) < growth ? 1 + Math.floor(hash2(cx * T + i, cy, 44) * 4) : 0; for (let k = 0; k < hgt; k++) put(i, T - 1 - k, k === hgt - 1 ? pal.mossLight : pal.moss, 0.85); }
  if (act === 2 && n) for (let i = 0; i < T; i++) if (hash2(cx * T + i, cy, 45) < 0.25) { const len = 2 + Math.floor(hash2(cx * T + i, cy, 46) * 8); for (let k = 0; k < len; k++) put(i, k, mix(pal.wallDark, pal.stain, 0.5), 0.6); }
  for (let j = 0; j < T; j++) for (let i = 0; i < T; i++) {
    let ao = 0;
    if (n) ao = Math.max(ao, j < 2 ? 0.6 : j < 4 ? 0.32 : j < 7 ? 0.12 : 0);
    if (w) ao = Math.max(ao, i < 1 ? 0.5 : i < 3 ? 0.22 : 0);
    if (e) ao = Math.max(ao, i > T - 2 ? 0.5 : i > T - 4 ? 0.22 : 0);
    if (!n && nw && i < 2 && j < 2) ao = Math.max(ao, 0.3);
    if (!n && ne && i > T - 3 && j < 2) ao = Math.max(ao, 0.3);
    if (ao > 0) b.set(ox + i, oy + j, mix(b.get(ox + i, oy + j), pal.plateDark, ao * 0.6));
  }
}

/** Vines (and, deep down, roots) hanging from an exposed ceiling into the cell below. */
function drawVines(b: Buf, ox: number, oy: number, cx: number, cy: number, pal: ActPal, act: number): void {
  const chance = act === 1 ? 0.12 : act === 2 ? 0.3 : 0.2;
  for (let i = 1; i < T - 1; i++) {
    const gx = cx * T + i;
    if (hash2(gx, cy, 50) > chance) continue;
    const len = 2 + Math.floor(hash2(gx, cy, 51) * (act === 1 ? 6 : 12));
    let x = i;
    for (let k = 0; k < len; k++) {
      b.set(ox + x, oy + k, act === 3 && hash2(gx, k, 52) < 0.5 ? pal.root : pal.mossDark);
      if (k % 3 === 2) b.set(ox + x + (k % 2 ? 1 : -1), oy + k, pal.moss);
      if (k % 5 === 4) x += hash2(gx, k, 53) < 0.5 ? -1 : 1;
    }
    b.set(ox + x, oy + len, pal.mossLight);
  }
}

// Hazard spikes pointing up: coral teeth on a black-and-yellow striped base (sim hitbox = bottom 0.4 tile).
const TEETH = [
  '..k...k...k...k.',
  '.kyk.kyk.kyk.kyk',
  '.kyrkkyrkkyrkkyr',
  'kyrrRkyrRkyrRkyr',
  'kkkkkkkkkkkkkkkk',
  'zzkkzzkkzzkkzzkk',
  'kkkkkkkkkkkkkkkk',
];

function drawSpikes(b: Buf, ox: number, oy: number, kind: string): void {
  for (let j = 0; j < TEETH.length; j++) for (let i = 0; i < T; i++) {
    const ch = TEETH[j]![i]!;
    if (ch === '.') continue;
    const c = KEY[ch]!;
    const fy = T - TEETH.length + j;
    let x = i, y = fy;
    if (kind === 'v') y = T - 1 - fy;
    else if (kind === '>') { x = T - 1 - fy; y = i; }
    else if (kind === '<') { x = fy; y = i; }
    b.set(ox + x, oy + y, c);
  }
}

/** Sample-belt housing: steel with rollers and a hazard edge. */
function drawConveyorHousing(b: Buf, ox: number, oy: number, pal: ActPal): void {
  for (let j = 0; j < T; j++) for (let i = 0; i < T; i++) {
    let c = j < 5 ? KEY.K! : j === 5 ? KEY.k! : pal.plate;
    if (j === 6) c = pal.plateLight;
    if (j >= 12 && j <= 13) c = ((i + j) >> 1) % 2 ? KEY.z! : KEY.k!;
    if (j > 6 && j < 11 && (i === 4 || i === 11)) c = Math.abs(j - 8.5) < 1.6 ? pal.plateHi : pal.plateDark;
    if (j === T - 1 || i === 0 || i === T - 1) c = KEY.k!;
    b.set(ox + i, oy + j, c);
  }
}

export interface TerrainSource {
  W: number;
  H: number;
  act?: number;
  tileAt(cx: number, cy: number): string;
  /** Extra cells to treat as solid for autotiling (idle droppers). */
  extraSolid?: Set<number>;
}

export const cellKey = (cx: number, cy: number): number => cy * 1000 + cx;

export function solidFn(src: TerrainSource): SolidFn {
  return (cx, cy) => {
    if (cx < 0 || cy < 0 || cx >= src.W || cy >= src.H) return cy >= 0;
    return isSolidGlyph(src.tileAt(cx, cy)) || !!src.extraSolid?.has(cellKey(cx, cy));
  };
}

/** Draw the whole terrain into a canvas texture (created or redrawn in place). */
export function bakeTerrain(scene: Phaser.Scene, key: string, src: TerrainSource): void {
  const w = src.W * T, h = src.H * T;
  let tex = scene.textures.exists(key) ? (scene.textures.get(key) as Phaser.Textures.CanvasTexture) : null;
  if (tex && (tex.width !== w || tex.height !== h)) { scene.textures.remove(key); tex = null; }
  if (!tex) tex = scene.textures.createCanvas(key, w, h)!;
  const b = new Buf(w, h);
  const act = src.act || 1;
  const pal = actPal(src.act);
  const solid = solidFn(src);
  const each = (fn: (cx: number, cy: number, g: string) => void) => { for (let cy = 0; cy < src.H; cy++) for (let cx = 0; cx < src.W; cx++) fn(cx, cy, src.tileAt(cx, cy)); };
  each((cx, cy, g) => { if (!isSolidGlyph(g)) drawWall(b, cx * T, cy * T, cx, cy, solid, pal, act); });
  each((cx, cy, g) => { if (!isSolidGlyph(g) && cy > 0 && solid(cx, cy - 1)) drawVines(b, cx * T, cy * T, cx, cy, pal, act); });
  each((cx, cy, g) => {
    if (g === '}' || g === '{') drawConveyorHousing(b, cx * T, cy * T, pal);
    else if (isSolidGlyph(g)) drawPanel(b, cx * T, cy * T, cx, cy, solid, pal);
  });
  each((cx, cy, g) => { if (g === '^' || g === 'v' || g === '>' || g === '<') drawSpikes(b, cx * T, cy * T, g); });
  b.blit(tex.getContext());
  tex.refresh();
}

/** Ceiling spots where water drips (exposed panel bottoms), chosen deterministically. */
export function dripPoints(src: TerrainSource, max = 6): Array<{ x: number; y: number }> {
  const solid = solidFn(src);
  const out: Array<{ x: number; y: number; k: number }> = [];
  for (let cy = 1; cy < src.H - 1; cy++) for (let cx = 1; cx < src.W - 1; cx++) {
    if (!solid(cx, cy) || solid(cx, cy + 1)) continue;
    out.push({ x: cx * T + 3 + Math.floor(hash2(cx, cy, 60) * 10), y: (cy + 1) * T, k: hash2(cx, cy, 61) });
  }
  return out.sort((a, b) => a.k - b.k).slice(0, max);
}

/** Static coolant pools: murky teal with algae flecks (drawn in front of everything, translucent). */
export function bakeWater(scene: Phaser.Scene, key: string, src: TerrainSource): Array<{ x: number; y: number; w: number }> {
  const w = src.W * T, h = src.H * T;
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const tex = scene.textures.createCanvas(key, w, h)!;
  const b = new Buf(w, h);
  const surfaces: Array<{ x: number; y: number; w: number }> = [];
  for (let cy = 0; cy < src.H; cy++) {
    let run: { x: number; y: number; w: number } | null = null;
    for (let cx = 0; cx < src.W; cx++) {
      const isW = src.tileAt(cx, cy) === '~';
      const top = isW && src.tileAt(cx, cy - 1) !== '~';
      if (isW) for (let j = 0; j < T; j++) for (let i = 0; i < T; i++) {
        const gx = cx * T + i, gy = cy * T + j;
        const depth = top ? j : j + T;
        let c = depth < 5 ? 0x2c9a8c : depth < 12 ? 0x1f7570 : 0x175a58;
        if (hash2(gx >> 1, gy >> 1, 70) < 0.05) c = 0x5aa95a;
        if (hash2(gx, gy, 71) < 0.01) c = 0x9ff0d8;
        b.set(gx, gy, c, 0.84);
      }
      if (top) { if (run) run.w += T; else run = { x: cx * T, y: cy * T, w: T }; }
      else if (run) { surfaces.push(run); run = null; }
    }
    if (run) surfaces.push(run);
  }
  b.blit(tex.getContext());
  tex.refresh();
  return surfaces;
}

/** A single panel as its own texture (loose ceiling panels and moved tile groups). */
export function stoneTexture(scene: Phaser.Scene, key: string, src: TerrainSource, cx: number, cy: number, isolated = false): void {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const tex = scene.textures.createCanvas(key, T, T + 3)!;
  const b = new Buf(T, T + 3);
  const solid = isolated ? ((x: number, y: number) => x === cx && y === cy) : solidFn(src);
  drawPanel(b, 0, 3, cx, cy, solid, actPal(src.act), true);
  b.blit(tex.getContext());
  tex.refresh();
}

/** Hydraulic press head: steel with warning chevrons and teeth along the bottom. */
export function crusherTexture(scene: Phaser.Scene, key: string, wTiles: number, hTiles: number): void {
  if (scene.textures.exists(key)) return;
  const w = wTiles * T, h = hTiles * T;
  const tex = scene.textures.createCanvas(key, w, h)!;
  const b = new Buf(w, h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    let c = KEY.m!;
    if (j < 2) c = KEY.l!;
    if (j >= h - 10 && j <= h - 6) c = Math.floor((i + (h - j)) / 3) % 2 === 0 ? KEY.z! : KEY.k!;
    if ((i % 16 === 3 || i % 16 === 12) && j % 16 === 4) c = KEY.l!;
    if ((i % 16 === 3 || i % 16 === 12) && j % 16 === 5) c = KEY.M!;
    if (j === h - 11 || j === h - 5) c = KEY.k!;
    if (i === 0 || i === w - 1 || j === 0) c = KEY.k!;
    if (i === w - 2 && j > 0 && j < h - 11) c = KEY.M!;
    b.set(i, j, c);
  }
  for (let i = 0; i < w; i++) {
    const t = i % 4, tooth = t === 1 || t === 2;
    b.set(i, h - 4, KEY.k!);
    if (tooth) { b.set(i, h - 3, t === 1 ? KEY.l! : KEY.M!); b.set(i, h - 2, t === 1 ? KEY.l! : KEY.M!); b.set(i, h - 1, KEY.k!); }
    else { b.set(i, h - 3, KEY.k!); b.clear(i, h - 2); b.clear(i, h - 1); }
  }
  b.blit(tex.getContext());
  tex.refresh();
}
