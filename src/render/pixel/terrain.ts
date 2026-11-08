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
  /** Optional colour remap applied by set() (used to make playfield art pop). */
  filter: ((c: number) => number) | null = null;
  constructor(readonly w: number, readonly h: number) { this.data = new Uint8ClampedArray(w * h * 4); }
  set(x: number, y: number, c: number, a = 1): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    if (this.filter) c = this.filter(c);
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

// ---------------------------------------------------------------------------
// Figure and ground. Anything you can stand on or that can kill you pops (brighter, more saturated,
// thick ink outline, lit top edge); scenery recedes (darker, desaturated, low contrast).
// ---------------------------------------------------------------------------
const lum = (c: number) => ((c >> 16) & 255) * 0.3 + ((c >> 8) & 255) * 0.59 + (c & 255) * 0.11;
const grey = (v: number) => { const g = Math.max(0, Math.min(255, Math.round(v))); return (g << 16) | (g << 8) | g; };

/** The tone the background recedes toward, per act. */
export function bgTone(pal: ActPal): number { return mix(mix(pal.deep2, pal.far, 0.5), KEY.k!, 0.7); }

/** Push one background colour back: desaturate, compress contrast toward the act's tone, darken. */
export function recede(c: number, tone: number): number {
  const d = mix(c, grey(lum(c)), 0.62);
  return mix(d, tone, 0.68);
}

/** Recede every opaque pixel of a buffer region in place. */
export function recedeBuf(b: Buf, tone: number, x0 = 0, y0 = 0, x1 = b.w, y1 = b.h): void {
  const cache = new Map<number, number>();
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * b.w + x) * 4;
    if (b.data[i + 3] === 0) continue;
    const c = (b.data[i]! << 16) | (b.data[i + 1]! << 8) | b.data[i + 2]!;
    let r = cache.get(c);
    if (r === undefined) { r = recede(c, tone); cache.set(c, r); }
    b.data[i] = (r >> 16) & 255; b.data[i + 1] = (r >> 8) & 255; b.data[i + 2] = r & 255;
  }
}

/** Make a playfield colour pop: more saturated and a little brighter (ink stays ink). */
export function pop(c: number): number {
  if (c === KEY.k || c === KEY.K) return c;
  const l = lum(c);
  const r = (c >> 16) & 255, g = (c >> 8) & 255, bl = c & 255;
  // Dark palettes get lifted more, so solids are always lighter than the receded back wall.
  const lift = 14 + Math.max(0, 80 - l * 0.5);
  const sat = (v: number) => Math.max(0, Math.min(255, Math.round(l + (v - l) * 1.35 + lift)));
  return (sat(r) << 16) | (sat(g) << 8) | sat(bl);
}

/** One 16×16 lab panel at (ox, oy); `solid` tells it which neighbours are solid. */
export function drawPanel(b: Buf, ox: number, oy: number, cx: number, cy: number, solid: SolidFn, pal: ActPal, decay = true, grip = false): void {
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
  // Thick outline: a second ink pixel just outside every exposed edge.
  for (let k = 0; k < T; k++) {
    if (!w && !((k === 0 && !n) || (k === T - 1 && !s))) b.set(ox - 1, oy + k, K());
    if (!e && !((k === 0 && !n) || (k === T - 1 && !s))) b.set(ox + T, oy + k, K());
    if (!s && !((k === 0 && !w) || (k === T - 1 && !e))) b.set(ox + k, oy + T, K());
    if (!n && !((k === 0 && !w) || (k === T - 1 && !e))) b.set(ox + k, oy - 1, K());
  }
  // Lit top edge.
  if (!n) for (let i = 1; i < T - 1; i++) { b.set(ox + i, oy + 1, pal.plateHi); b.set(ox + i, oy + 2, mix(pal.plateHi, pal.plateLight, 0.5)); }
  // Grip faces (rooms with wall-jump): a bright mossy edge stripe and carved handholds.
  if (grip) for (const [open, edge, dir] of [[!w, 1, 1], [!e, T - 2, -1]] as const) {
    if (!open) continue;
    for (let j = 0; j < T; j++) {
      if ((j < 2 && !n) || (j > T - 3 && !s)) continue;
      b.set(ox + edge, oy + j, (cy * T + j) % 3 === 0 ? pal.mossLight : 0x9cf26a);
      b.set(ox + edge + dir, oy + j, (cy * T + j) % 4 === 0 ? pal.moss : 0x6fd14d);
    }
    for (let j = 3; j < T - 2; j += 5) {
      const x = ox + edge + dir * 3;
      b.set(x, oy + j - 1, pal.plateHi); b.set(x + dir, oy + j - 1, pal.plateHi);
      b.set(x, oy + j, K()); b.set(x + dir, oy + j, K()); b.set(x + dir * 2, oy + j, pal.plateDark);
    }
  }
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
    if (c === pal.wall && hash2(gx >> 3, gy >> 3, 41) < 0.08) c = mix(pal.wall, pal.wallDark, 0.3);
    b.set(ox + i, oy + j, c);
  }
  const d = r(0);
  const put = (x: number, y: number, c: number, a = 1) => b.set(ox + x, oy + y, c, a);
  if (d < 0.025) {
    for (let j = 4; j < 10; j++) for (let i = 4; i < 12; i++) put(i, j, j === 4 || j === 9 || i === 4 || i === 11 ? pal.plateDark : mix(KEY.k!, pal.glow, r(1) < 0.4 ? 0.3 : 0.1));
    put(6, 6, pal.glow); put(8, 10, KEY.K!); put(7, 10, KEY.K!);
  } else if (d < 0.05) {
    for (let j = 5; j < 11; j++) for (let i = 3; i < 13; i++) put(i, j, j % 2 ? pal.wallDark : mix(pal.wallDark, KEY.K!, 0.4));
  } else if (d < 0.08) {
    let x = 2 + Math.floor(r(3) * 10);
    for (let j = 1; j < 14; j++) { put(x, j, pal.wallDark); if (j % 3 === 0) x += r(4 + j) < 0.5 ? -1 : 1; }
  } else if (d < 0.12 && act >= 3) {
    for (let i = 5; i < 11; i++) { put(i, 3, KEY.K!); put(i, 4, pal.trim); put(i, 5, mix(pal.trim, pal.wall, 0.5)); }
  } else if (d < 0.14 && act >= 3) {
    for (const [x, y] of [[4, 11], [5, 12], [6, 12], [7, 12], [8, 12], [9, 12], [10, 11], [4, 13], [10, 13]] as const) put(x, y, KEY.o!);
  }
  // Cable runs span whole rows, sagging between brackets every few tiles.
  if (hash2(0, cy, 47) < 0.12) {
    const y = 2 + Math.floor(hash2(1, cy, 47) * 10);
    for (let i = 0; i < T; i++) {
      const gx = cx * T + i, sag = Math.round(Math.sin(((gx % 48) / 48) * Math.PI) * 2);
      put(i, y + sag, KEY.K!); put(i, y + sag + 1, mix(KEY.K!, pal.wallDark, 0.5));
      if (gx % 48 === 0) { put(i, y - 1, pal.plateDark); put(i, y, pal.plateDark); }
    }
  }
  // Moss creeping up from floors, water stains under ceilings in the flooded wing.
  const growth = act === 2 ? 0.5 : act === 3 ? 0.35 : act === 4 ? 0.3 : 0.18;
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
  const chance = act === 1 ? 0.12 : act === 2 ? 0.3 : act === 4 ? 0.34 : 0.2;
  for (let i = 1; i < T - 1; i++) {
    const gx = cx * T + i;
    if (hash2(gx, cy, 50) > chance) continue;
    const len = 2 + Math.floor(hash2(gx, cy, 51) * (act === 1 ? 6 : 12));
    let x = i;
    for (let k = 0; k < len; k++) {
      b.set(ox + x, oy + k, (act === 3 && hash2(gx, k, 52) < 0.5) || (act === 4 && hash2(gx, k, 52) < 0.8) ? pal.root : pal.mossDark);
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
  /** Editor bg decor grid (chars index `decorIds`). */
  decorBg?: string[];
  decorIds?: readonly string[];
  /** Wall-jump room: exposed vertical faces get a grip texture. */
  grip?: boolean;
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
  if (src.decorBg && src.decorIds) each((cx, cy) => {
    const i = 'abcdefghijklmnopqrstuvwxyzABCDEF'.indexOf(src.decorBg![cy]?.[cx] ?? '.');
    if (i >= 0) paintDecor(b, cx * T, cy * T, src.decorIds![i]!, pal, cx, cy);
  });
  // Everything so far is scenery: push it back.
  recedeBuf(b, bgTone(pal));
  b.filter = pop;
  each((cx, cy, g) => {
    if (g === '}' || g === '{') drawConveyorHousing(b, cx * T, cy * T, pal);
    else if (isSolidGlyph(g)) drawPanel(b, cx * T, cy * T, cx, cy, solid, pal, true, !!src.grip);
  });
  each((cx, cy, g) => { if (g === '^' || g === 'v' || g === '>' || g === '<') drawSpikes(b, cx * T, cy * T, g); });
  b.filter = null;
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
  b.filter = pop;
  drawPanel(b, 0, 3, cx, cy, solid, actPal(src.act), true, !!src.grip);
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

// ---------------------------------------------------------------------------
// Crumbling floor ('%'): a cracked, chipped panel with a hazard corner, drawn as its own sprite
// so it can tremble and break away.
// ---------------------------------------------------------------------------

export function crumbleTexture(scene: Phaser.Scene, key: string, act: number | undefined): void {
  if (scene.textures.exists(key)) return;
  const pal = actPal(act);
  const b = new Buf(T, T);
  const base = mix(pal.plate, pal.plateHi, 0.28);
  for (let j = 0; j < T; j++) for (let i = 0; i < T; i++) {
    let c = j === 1 ? pal.plateHi : j >= T - 2 ? mix(base, pal.plateDark, 0.6) : base;
    if (i === 0 || i === T - 1 || j === 0 || j === T - 1) c = KEY.k!;
    b.set(i, j, c);
  }
  // Dense cracks and chipped corners.
  for (const [x0, len, dir] of [[3, 9, 1], [8, 12, -1], [12, 7, -1]] as const) {
    let x = x0;
    for (let y = 2; y < 2 + len && y < T - 1; y++) { b.set(x, y, KEY.k!); if (y % 2 === 0) x += dir; }
  }
  for (const [x, y] of [[1, 0], [2, 0], [1, 1], [14, 0], [13, 0], [6, 0]] as const) b.clear(x, y);
  b.set(1, 2, KEY.k!); b.set(13, 1, KEY.k!);
  for (let i = 0; i < 3; i++) for (let j = 0; j <= i; j++) b.set(T - 3 - j, T - 5 + i, i === 2 ? KEY.k! : KEY.z!);
  const t = scene.textures.createCanvas(key, T, T)!;
  b.blit(t.getContext());
  t.refresh();
}

// ---------------------------------------------------------------------------
// Decor tiles for the editor's bg/fg layers (DECOR_IDS), painted in the lab style.
// ---------------------------------------------------------------------------

type DecorPaint = (p: (x: number, y: number, c: number, a?: number) => void, pal: ActPal, r: (k: number) => number) => void;
const rect = (p: (x: number, y: number, c: number, a?: number) => void, x: number, y: number, w: number, h: number, c: number, a = 1) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) p(x + i, y + j, c, a); };
const box = (p: (x: number, y: number, c: number, a?: number) => void, x: number, y: number, w: number, h: number, fill: number, edge = KEY.k!) => { rect(p, x, y, w, h, edge); rect(p, x + 1, y + 1, w - 2, h - 2, fill); };

export const DECOR: Record<string, DecorPaint> = {
  panel: (p, pal) => { box(p, 0, 0, 16, 16, pal.plate); rect(p, 1, 1, 14, 1, pal.plateLight); p(3, 3, pal.plateHi); p(12, 3, pal.plateHi); p(3, 12, pal.plateHi); p(12, 12, pal.plateHi); },
  panelDark: (p, pal) => { box(p, 0, 0, 16, 16, pal.plateDark); rect(p, 1, 1, 14, 1, pal.plate); },
  panelCracked: (p, pal) => { box(p, 0, 0, 16, 16, pal.plate); let x = 5; for (let y = 1; y < 15; y++) { p(x, y, KEY.k!); if (y % 3 === 0) x++; } },
  window: (p, pal) => { box(p, 1, 1, 14, 14, mix(pal.shaft, pal.deep, 0.25), pal.plateDark); rect(p, 7, 2, 2, 12, pal.plateDark); rect(p, 2, 7, 12, 2, pal.plateDark); p(3, 3, KEY.w!); },
  windowBroken: (p, pal) => { box(p, 1, 1, 14, 14, mix(pal.shaft, pal.deep, 0.5), pal.plateDark); for (const [x, y] of [[4, 3], [5, 4], [6, 6], [9, 5], [10, 8], [11, 10]] as const) p(x, y, KEY.k!); p(7, 6, KEY.w!); },
  monitor: (p, pal) => { box(p, 2, 3, 12, 9, mix(KEY.k!, pal.glow, 0.45), pal.plateDark); rect(p, 4, 5, 6, 1, pal.glow); rect(p, 4, 7, 4, 1, pal.glow); rect(p, 7, 12, 2, 2, pal.plateDark); rect(p, 5, 14, 6, 1, pal.plateDark); },
  monitorDead: (p, pal) => { box(p, 2, 3, 12, 9, KEY.K!, pal.plateDark); p(10, 5, KEY.w!, 0.5); rect(p, 7, 12, 2, 2, pal.plateDark); },
  server: (p, pal) => { box(p, 3, 0, 10, 16, pal.plateDark); for (let y = 2; y < 15; y += 3) { rect(p, 4, y, 8, 1, KEY.k!); p(10, y + 1, y % 2 ? pal.glow : pal.light); } },
  tank: (p, pal) => { box(p, 3, 0, 10, 16, mix(pal.glow, pal.deep, 0.55), pal.plateDark); rect(p, 4, 1, 1, 14, KEY.w!, 0.6); p(8, 6, KEY.w!); p(9, 10, KEY.w!); rect(p, 2, 0, 12, 2, pal.plateDark); rect(p, 2, 14, 12, 2, pal.plateDark); },
  tankBroken: (p, pal) => { rect(p, 2, 14, 12, 2, pal.plateDark); for (let y = 6; y < 14; y++) { p(3, y, pal.plateHi); p(12, y, pal.plateHi); } p(4, 5, pal.plateHi); p(11, 7, pal.plateHi); rect(p, 4, 13, 8, 1, pal.moss); },
  pipeH: (p, pal) => { rect(p, 0, 5, 16, 6, KEY.k!); rect(p, 0, 6, 16, 4, pal.plate); rect(p, 0, 6, 16, 1, pal.plateHi); rect(p, 7, 4, 2, 8, pal.plateDark); },
  pipeV: (p, pal) => { rect(p, 5, 0, 6, 16, KEY.k!); rect(p, 6, 0, 4, 16, pal.plate); rect(p, 6, 0, 1, 16, pal.plateHi); rect(p, 4, 7, 8, 2, pal.plateDark); },
  cable: (p) => { for (let i = 0; i < 16; i++) { const y = 3 + Math.round(Math.sin((i / 15) * Math.PI) * 6); p(i, y, KEY.k!); p(i, y + 1, KEY.K!); } },
  vent: (p, pal) => { box(p, 2, 4, 12, 8, pal.plateDark); for (let y = 6; y < 11; y += 2) rect(p, 3, y, 10, 1, KEY.k!); },
  grate: (p, pal) => { box(p, 0, 0, 16, 16, pal.plateDark); for (let i = 2; i < 15; i += 3) { rect(p, i, 1, 1, 14, KEY.k!); rect(p, 1, i, 14, 1, KEY.k!); } },
  lamp: (p, pal) => { rect(p, 7, 0, 2, 5, KEY.k!); box(p, 4, 5, 8, 4, pal.plateDark); rect(p, 5, 9, 6, 1, pal.light); for (let j = 10; j < 16; j++) rect(p, 6 - (j - 10) / 2, j, 4 + (j - 10), 1, pal.light, 0.12); },
  vine: (p, pal, r) => { let x = 7; for (let y = 0; y < 16; y++) { p(x, y, pal.mossDark); if (y % 3 === 1) p(x + (y % 2 ? 1 : -1), y, pal.moss); if (y % 5 === 4) x += r(y) < 0.5 ? -1 : 1; } },
  ivy: (p, pal, r) => { for (let j = 0; j < 16; j++) for (let i = 0; i < 16; i++) if (r(j * 16 + i) < 0.28) p(i, j, r(j + i * 3) < 0.5 ? pal.moss : pal.mossDark); },
  moss: (p, pal, r) => { for (let i = 0; i < 16; i++) { const h = 2 + Math.floor(r(i) * 5); for (let k = 0; k < h; k++) p(i, 15 - k, k === h - 1 ? pal.mossLight : pal.moss); } },
  fern: (p, pal) => { for (let k = 0; k < 5; k++) { for (let i = 0; i < 6; i++) { p(8 + i, 12 - k * 2 - Math.floor(i / 2), pal.moss); p(7 - i, 12 - k * 2 - Math.floor(i / 2), pal.mossDark); } } rect(p, 7, 4, 2, 12, pal.mossDark); },
  roots: (p, pal, r) => { for (let k = 0; k < 3; k++) { let x = 3 + k * 5; for (let y = 0; y < 16; y++) { p(x, y, pal.root); if (y % 3 === 0) x += r(k * 20 + y) < 0.5 ? -1 : 1; } } },
  mushroom: (p, pal) => { rect(p, 7, 10, 2, 6, KEY.W!); box(p, 3, 6, 10, 5, pal.light); p(5, 7, KEY.w!); p(9, 8, KEY.w!); },
  puddle: (p) => { rect(p, 2, 14, 12, 2, 0x2c9a8c, 0.85); rect(p, 4, 14, 4, 1, 0x9ff0d8); },
  bones: (p) => { for (const [x, y] of [[3, 13], [4, 14], [5, 14], [6, 14], [7, 14], [8, 13], [10, 12], [11, 12], [12, 13], [11, 14]] as const) p(x, y, KEY.o!); p(11, 13, KEY.k!); },
  crate: (p, pal) => { box(p, 1, 3, 14, 13, pal.plate); rect(p, 2, 4, 12, 1, pal.plateHi); rect(p, 5, 8, 6, 4, KEY.z!); p(7, 9, KEY.k!); p(8, 10, KEY.k!); },
  barrel: (p, pal) => { box(p, 3, 2, 10, 14, pal.light); rect(p, 4, 5, 8, 1, KEY.k!); rect(p, 4, 12, 8, 1, KEY.k!); rect(p, 6, 7, 4, 4, KEY.z!); },
  console: (p, pal) => { box(p, 1, 8, 14, 8, pal.plateDark); box(p, 3, 3, 10, 6, mix(KEY.k!, pal.glow, 0.5)); for (let i = 3; i < 13; i += 2) p(i, 10, i % 4 ? KEY.r! : KEY.j!); },
  hazardStripe: (p) => { for (let j = 6; j < 10; j++) for (let i = 0; i < 16; i++) p(i, j, ((i + j) >> 1) % 2 ? KEY.z! : KEY.k!); },
  poster: (p) => { box(p, 3, 2, 10, 12, KEY.W!); rect(p, 5, 4, 6, 2, KEY.r!); rect(p, 5, 7, 6, 1, KEY.K!); rect(p, 5, 9, 4, 1, KEY.K!); p(12, 13, KEY.O!); },
  sign: (p) => { box(p, 2, 4, 12, 8, KEY.z!); rect(p, 7, 5, 2, 4, KEY.k!); p(7, 10, KEY.k!); p(8, 10, KEY.k!); },
  chain: (p) => { for (let y = 0; y < 16; y++) { p(7, y, y % 4 < 2 ? KEY.m! : KEY.k!); p(8, y, y % 4 < 2 ? KEY.k! : KEY.l!); } },
  debris: (p, pal, r) => { for (let k = 0; k < 7; k++) { const x = Math.floor(r(k) * 13), y = 12 + Math.floor(r(k + 9) * 3); rect(p, x, y, 2 + Math.floor(r(k + 3) * 2), 2, k % 2 ? pal.plate : pal.plateDark); } },
};

/** Paint one decor tile at (ox, oy). */
export function paintDecor(b: Buf, ox: number, oy: number, id: string, pal: ActPal, cx: number, cy: number): void {
  const f = DECOR[id];
  if (!f) return;
  f((x, y, c, a = 1) => { if (x >= 0 && y >= 0 && x < T && y < T) b.set(ox + x, oy + y, c, a); }, pal, (k) => hash2(cx * 37 + k, cy, 80));
}

/** Bake an fg decor layer to its own canvas; returns which cells are covered (for fading near Pip). */
export function bakeDecorLayer(scene: Phaser.Scene, key: string, grid: string[], w: number, h: number, act: number | undefined, ids: readonly string[]): boolean[][] {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const b = new Buf(w * T, h * T);
  const pal = actPal(act);
  const cover: boolean[][] = [];
  for (let cy = 0; cy < h; cy++) {
    cover.push([]);
    for (let cx = 0; cx < w; cx++) {
      const ch = grid[cy]?.[cx] ?? '.';
      const i = 'abcdefghijklmnopqrstuvwxyzABCDEF'.indexOf(ch);
      cover[cy]!.push(i >= 0);
      if (i >= 0) paintDecor(b, cx * T, cy * T, ids[i]!, pal, cx, cy);
    }
  }
  const t = scene.textures.createCanvas(key, b.w, b.h)!;
  b.blit(t.getContext());
  t.refresh();
  return cover;
}

/** Decode an editor PixelArt into a texture. */
export function pixelArtTexture(scene: Phaser.Scene, key: string, art: { w: number; h: number; palette: string[]; data: string }): boolean {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  try {
    const bin = atob(art.data);
    if (bin.length < art.w * art.h || art.w <= 0 || art.h <= 0 || art.w > 1024 || art.h > 1024) return false;
    const b = new Buf(art.w, art.h);
    const cols = art.palette.map((c) => parseInt(c.replace('#', ''), 16));
    for (let i = 0; i < art.w * art.h; i++) {
      const idx = bin.charCodeAt(i);
      if (idx === 255 || cols[idx] === undefined || Number.isNaN(cols[idx]!)) continue;
      b.set(i % art.w, Math.floor(i / art.w), cols[idx]!);
    }
    const t = scene.textures.createCanvas(key, art.w, art.h)!;
    b.blit(t.getContext());
    t.refresh();
    return true;
  } catch { return false; }
}
