// Turn any picture into a small-palette pixel image for a level (PixelArt in src/sim/types.ts).
// Pure functions (median-cut palette, Floyd–Steinberg dithering, base64 packing) plus a couple of
// browser helpers for loading and previewing.
import type { PixelArt } from '../sim/types';

export const TRANSPARENT = 255;
export const MAX_COLORS = 32;

export interface Quantized { palette: string[]; indices: Uint8Array }

const hex2 = (n: number) => n.toString(16).padStart(2, '0');
export const rgbHex = (r: number, g: number, b: number) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;
export function hexRgb(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Median-cut palette of up to `n` colours from the opaque pixels. */
export function medianCut(rgba: ArrayLike<number>, n: number): Array<[number, number, number]> {
  const px: Array<[number, number, number]> = [];
  for (let i = 0; i < rgba.length; i += 4) if (rgba[i + 3]! >= 128) px.push([rgba[i]!, rgba[i + 1]!, rgba[i + 2]!]);
  if (!px.length) return [[0, 0, 0]];
  let boxes: Array<Array<[number, number, number]>> = [px];
  const target = Math.max(1, Math.min(MAX_COLORS, n));
  while (boxes.length < target) {
    // Split the box with the widest channel range.
    let bi = -1, bc = 0, br = -1;
    boxes.forEach((b, i) => {
      if (b.length < 2) return;
      for (let c = 0; c < 3; c++) {
        let lo = 255, hi = 0;
        for (const p of b) { if (p[c]! < lo) lo = p[c]!; if (p[c]! > hi) hi = p[c]!; }
        if (hi - lo > br) { br = hi - lo; bi = i; bc = c; }
      }
    });
    if (bi < 0 || br <= 0) break;
    const b = boxes[bi]!.slice().sort((p, q) => p[bc]! - q[bc]!);
    const mid = b.length >> 1;
    boxes = [...boxes.slice(0, bi), b.slice(0, mid), b.slice(mid), ...boxes.slice(bi + 1)];
  }
  return boxes.map((b) => {
    let r = 0, g = 0, bl = 0;
    for (const p of b) { r += p[0]; g += p[1]; bl += p[2]; }
    return [Math.round(r / b.length), Math.round(g / b.length), Math.round(bl / b.length)] as [number, number, number];
  });
}

function nearest(pal: Array<[number, number, number]>, r: number, g: number, b: number): number {
  let best = 0, bd = Infinity;
  for (let i = 0; i < pal.length; i++) {
    const p = pal[i]!;
    // Weighted distance (eyes care more about green).
    const d = (p[0] - r) ** 2 * 0.3 + (p[1] - g) ** 2 * 0.59 + (p[2] - b) ** 2 * 0.11;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

/** Map an RGBA image (already at the target size) onto `n` colours. */
export function quantize(rgba: ArrayLike<number>, w: number, h: number, n: number, dither: boolean): Quantized {
  const pal = medianCut(rgba, n);
  const out = new Uint8Array(w * h);
  const err = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (rgba[i * 4 + 3]! < 128) { out[i] = TRANSPARENT; continue; }
      const r = clamp(rgba[i * 4]! + err[i * 3]!), g = clamp(rgba[i * 4 + 1]! + err[i * 3 + 1]!), b = clamp(rgba[i * 4 + 2]! + err[i * 3 + 2]!);
      const k = nearest(pal, r, g, b);
      out[i] = k;
      if (!dither) continue;
      const p = pal[k]!;
      const er = r - p[0], eg = g - p[1], eb = b - p[2];
      const spread = (dx: number, dy: number, f: number) => {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) return;
        const j = (yy * w + xx) * 3;
        err[j] = err[j]! + er * f; err[j + 1] = err[j + 1]! + eg * f; err[j + 2] = err[j + 2]! + eb * f;
      };
      spread(1, 0, 7 / 16); spread(-1, 1, 3 / 16); spread(0, 1, 5 / 16); spread(1, 1, 1 / 16);
    }
  return { palette: pal.map(([r, g, b]) => rgbHex(r, g, b)), indices: out };
}

const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

export function encodeIndices(a: Uint8Array): string {
  let s = '';
  for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode(...a.subarray(i, i + 0x8000));
  return btoa(s);
}

export function decodeIndices(b64: string): Uint8Array {
  const s = atob(b64);
  const a = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
  return a;
}

export function makeArt(id: string, x: number, y: number, w: number, h: number, q: Quantized, layer: 'bg' | 'fg'): PixelArt {
  return { id, x, y, w, h, palette: q.palette, data: encodeIndices(q.indices), layer, parallax: 1, opacity: 1 };
}

/** Back to RGBA (for previews and tests). */
export function artToRgba(art: PixelArt): Uint8ClampedArray {
  const idx = decodeIndices(art.data);
  const pal = art.palette.map(hexRgb);
  const out = new Uint8ClampedArray(art.w * art.h * 4);
  for (let i = 0; i < art.w * art.h; i++) {
    const k = idx[i] ?? TRANSPARENT;
    if (k === TRANSPARENT || !pal[k]) continue;
    const [r, g, b] = pal[k]!;
    out[i * 4] = r; out[i * 4 + 1] = g; out[i * 4 + 2] = b; out[i * 4 + 3] = 255;
  }
  return out;
}

// --- browser helpers ---------------------------------------------------------

export function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('not an image')); };
    img.src = url;
  });
}

/** Draw a crop of an image scaled to w×h pixels and read it back. Crop is in source fractions 0..1. */
export function sampleImage(img: CanvasImageSource & { width: number; height: number }, w: number, h: number, crop = { x: 0, y: 0, w: 1, h: 1 }): Uint8ClampedArray {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, crop.x * img.width, crop.y * img.height, crop.w * img.width, crop.h * img.height, 0, 0, w, h);
  return g.getImageData(0, 0, w, h).data;
}

export function artCanvas(art: PixelArt): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = art.w; c.height = art.h;
  const g = c.getContext('2d')!;
  g.putImageData(new ImageData(artToRgba(art) as unknown as Uint8ClampedArray<ArrayBuffer>, art.w, art.h), 0, 0);
  return c;
}
