// Shared colours and sizes. The pixel-art palettes live in ./pixel/pal.ts; these remain for the editor
// overlays and DOM panels.
export const C = {
  outline: 0x2b2433,
  ink: 0x2b2433,
  cream: 0xfbf3e4,
  paper: 0xfff8ec,
  solid: 0x3a3346,
  solidTop: 0x5a4e6b,
  solidHi: 0x75688a,
  solidShade: 0x322b3d,
  hazard: 0xff5d5d,
  hazardHi: 0xff9a8a,
  hazardDark: 0xc93f4f,
  laser: 0xff3fa4,
  laserCore: 0xffe3f3,
  water: 0x3fb8b0,
  waterDeep: 0x23848a,
  waterHi: 0xa6f0e2,
  pip: 0xffc9a3,
  pipShade: 0xf0a47f,
  pipLight: 0xffe4cf,
  blush: 0xff8fa3,
  pink: 0xff9fb4,
  wood: 0xc98b52,
  woodDark: 0x96602f,
  woodLight: 0xe6ad72,
  rot: 0xa9c79a,
  rotShade: 0x7f9f73,
  rotLight: 0xcde3bf,
  bone: 0xf6f0e3,
  boneShade: 0xd8ccb6,
  plateOn: 0x7fd38e,
  metal: 0x8d849c,
  metalDark: 0x5e566d,
  gold: 0xffd166,
  white: 0xffffff,
} as const;

export const hex = (n: number): string => '#' + n.toString(16).padStart(6, '0');

export const FONT = '"Pixelify Sans", "Silkscreen", ui-monospace, monospace';

/** World pixels per tile; sim units -> px factor. */
export const TILE = 16;
export const PX = TILE / 240;

export interface Mood {
  name: string;
  skyTop: number;
  skyBottom: number;
  far: number;
  mid: number;
  dot: number;
  mote: number;
  vignette: number;
}

/** Backdrop moods: Act 1 warm cream/peach, Act 2 dusky teal/sage, Act 3 lilac/bone at dusk. */
export const MOODS: Record<number, Mood> = {
  0: { name: 'menu', skyTop: 0xfff3e2, skyBottom: 0xf9dcc4, far: 0xf4d2b9, mid: 0xeec2a6, dot: 0xf6e3cc, mote: 0xffffff, vignette: 0x9c6b5a },
  1: { name: 'Fresh Meat', skyTop: 0xfff5e6, skyBottom: 0xfbdcc2, far: 0xf6d3b8, mid: 0xefc1a2, dot: 0xf8e6d0, mote: 0xffffff, vignette: 0xa66a55 },
  2: { name: 'Rot', skyTop: 0xe4f1e6, skyBottom: 0xbcd8cf, far: 0xa9cbbf, mid: 0x8fb9ad, dot: 0xd3e8dc, mote: 0xeafff0, vignette: 0x2f5b5a },
  3: { name: 'Bare Bones', skyTop: 0xf2e6f3, skyBottom: 0xd6c3dd, far: 0xc6b0cf, mid: 0xb39bbf, dot: 0xe7dbe9, mote: 0xfff7ea, vignette: 0x4b3561 },
};
