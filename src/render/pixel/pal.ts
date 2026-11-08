// The pixel-art palette: one shared set of character colours plus a small palette per act.
// Every sprite is authored against these keys so the whole game stays on a limited palette.

/** Single-character palette keys used by ASCII sprite definitions ('.' = transparent). */
export const KEY: Record<string, number> = {
  k: 0x241c2e, // ink outline
  K: 0x3b3046, // soft outline / dark shade
  w: 0xffffff,
  W: 0xe8e2ee, // off-white
  // Pip
  p: 0xffc59c,
  P: 0xe5916c,
  q: 0xffe6d0,
  b: 0xff8aa0, // blush / inner ear
  n: 0xe0577a, // nose / mouth
  T: 0xff6b8b, // tongue
  // Rot
  g: 0xa8c88f,
  G: 0x6f9468,
  h: 0xd3e8b8,
  f: 0x4e6b4e, // fly / deep rot
  // Bone
  o: 0xf5efe0,
  O: 0xcdbfa4,
  // Hazard coral
  r: 0xff5a5a,
  R: 0xb83a4c,
  y: 0xffa08c,
  // Wood
  u: 0xc78550,
  U: 0x8c5a34,
  v: 0xe9b27a,
  // Metal
  m: 0x8f87a3,
  M: 0x5b5470,
  l: 0xc4bdd2,
  // Gold
  z: 0xffd35c,
  Z: 0xd9962f,
  // Laser
  x: 0xff3fa0,
  X: 0xffd8ef,
  // Water
  c: 0x3db7ae,
  C: 0x1f7a80,
  a: 0xa4f2e0,
  // Plate on
  j: 0x76d68a,
  J: 0x3f9a5b,
};

/** Per-act palette for the abandoned-lab look. */
export interface ActPal {
  /** Lab plating: base, seams/shade, bevel light, specular/rivets, glowing trim strip. */
  plate: number; plateDark: number; plateLight: number; plateHi: number; trim: number;
  /** Overgrowth. */
  moss: number; mossDark: number; mossLight: number; root: number; stain: number;
  /** Interior back wall (lighter than the plating so the play space reads clearly). */
  wall: number; wallDark: number; wallHi: number;
  /** Backdrop: interior base, far and mid silhouettes, glow (tanks/monitors), light shafts, spores. */
  deep: number; deep2: number; far: number; farHi: number; mid: number; midHi: number; glow: number; shaft: number; mote: number;
  /** Emergency/accent light and UI accent. */
  light: number; accent: number;
}

const MOSS = { moss: 0x78bf5c, mossDark: 0x447f43, mossLight: 0xaee07e, root: 0x6b4a36, stain: 0xa79f86 };

export const ACT_PAL: Record<number, ActPal> = {
  // Menus: the lab lobby.
  0: {
    plate: 0x5c6880, plateDark: 0x353c50, plateLight: 0x8b97ad, plateHi: 0xc8d0dc, trim: 0x63e6ff, ...MOSS,
    wall: 0xe4e9ef, wallDark: 0xcbd3dd, wallHi: 0xf5f8fb,
    deep: 0xc9d4de, deep2: 0xb3c0cd, far: 0x9eacbc, farHi: 0xbcc8d5, mid: 0x7d8ca0, midHi: 0x98a7b9, glow: 0x8ff0ff, shaft: 0xffffff, mote: 0xffffff,
    light: 0x63e6ff, accent: 0xff5a5a,
  },
  // Act 1 Fresh Meat: a bright, sterile wing, barely overgrown.
  1: {
    plate: 0x64728c, plateDark: 0x3a4258, plateLight: 0x97a3b9, plateHi: 0xd6dde8, trim: 0x70f0ff, ...MOSS,
    wall: 0xf0f3f7, wallDark: 0xd8dee6, wallHi: 0xffffff,
    deep: 0xdde5ed, deep2: 0xc6d1dc, far: 0xb0bdcb, farHi: 0xd0d9e3, mid: 0x8f9eb1, midHi: 0xadbacb, glow: 0x9ff6ff, shaft: 0xffffff, mote: 0xffffff,
    light: 0x70f0ff, accent: 0xff5a5a,
  },
  // Act 2 Rot: a flooded, mossy bio-lab in green and teal.
  2: {
    plate: 0x3d5a5c, plateDark: 0x213538, plateLight: 0x5f807b, plateHi: 0x9bbcae, trim: 0x7dffb2,
    moss: 0x6fb757, mossDark: 0x3c7a3e, mossLight: 0xa6dc7a, root: 0x5e4632, stain: 0x6f8a6a,
    wall: 0xc4dacd, wallDark: 0xa6c2b4, wallHi: 0xd9eae0,
    deep: 0x4f7c72, deep2: 0x3c665e, far: 0x2f5650, farHi: 0x467268, mid: 0x223f3c, midHi: 0x36605a, glow: 0x9dffd0, shaft: 0xd6ffe9, mote: 0xd5ffc8,
    light: 0x7dffb2, accent: 0x6fbf8f,
  },
  // Act 3 Bare Bones: deep containment, roots and bones, purple and amber emergency light.
  3: {
    plate: 0x3d3550, plateDark: 0x211b2f, plateLight: 0x5d5277, plateHi: 0x8e83ac, trim: 0xffb03f,
    moss: 0x6c8c55, mossDark: 0x425f3b, mossLight: 0x98b877, root: 0x5c3a2c, stain: 0x6a5a5a,
    wall: 0x9c90b2, wallDark: 0x83789a, wallHi: 0xb3a9c6,
    deep: 0x2b2340, deep2: 0x221b33, far: 0x3a2f52, farHi: 0x4f426b, mid: 0x1c1629, midHi: 0x2f2645, glow: 0xffb03f, shaft: 0xc8a2ff, mote: 0xffd59a,
    light: 0xff4d6d, accent: 0xb48cd1,
  },
};

export const actPal = (act: number | undefined): ActPal => ACT_PAL[act ?? 1] ?? ACT_PAL[1]!;

export const css = (c: number, a = 1): string =>
  a >= 1 ? `#${c.toString(16).padStart(6, '0')}` : `rgba(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255},${a})`;

/** Deterministic hash noise for texture variation (no Math.random in art generation). */
export function hash2(x: number, y: number, s = 0): number {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function mix(a: number, b: number, t: number): number {
  const r = Math.round(((a >> 16) & 255) * (1 - t) + ((b >> 16) & 255) * t);
  const g = Math.round(((a >> 8) & 255) * (1 - t) + ((b >> 8) & 255) * t);
  const bl = Math.round((a & 255) * (1 - t) + (b & 255) * t);
  return (r << 16) | (g << 8) | bl;
}
