// A hand-made proportional pixel font (5×7 caps, lowercase with descenders), generated at boot into a
// texture and registered as Phaser bitmap fonts: 'pf' (plain white, tint it) and 'pfo' (white with a
// baked 1 px ink outline). Use ptext() to place text at an integer pixel scale.
import Phaser from 'phaser';
import { KEY } from './pal';

// Rows top→bottom; '#' = on. 7-row glyphs sit on the baseline; 9-row glyphs have descenders.
const G: Record<string, string> = {
  A: '.###.|#...#|#...#|#####|#...#|#...#|#...#',
  B: '####.|#...#|#...#|####.|#...#|#...#|####.',
  C: '.###.|#...#|#....|#....|#....|#...#|.###.',
  D: '####.|#...#|#...#|#...#|#...#|#...#|####.',
  E: '#####|#....|#....|####.|#....|#....|#####',
  F: '#####|#....|#....|####.|#....|#....|#....',
  G: '.###.|#...#|#....|#.###|#...#|#...#|.####',
  H: '#...#|#...#|#...#|#####|#...#|#...#|#...#',
  I: '###|.#.|.#.|.#.|.#.|.#.|###',
  J: '..###|...#.|...#.|...#.|#..#.|#..#.|.##..',
  K: '#...#|#..#.|#.#..|##...|#.#..|#..#.|#...#',
  L: '#....|#....|#....|#....|#....|#....|#####',
  M: '#...#|##.##|#.#.#|#.#.#|#...#|#...#|#...#',
  N: '#...#|##..#|#.#.#|#..##|#...#|#...#|#...#',
  O: '.###.|#...#|#...#|#...#|#...#|#...#|.###.',
  P: '####.|#...#|#...#|####.|#....|#....|#....',
  Q: '.###.|#...#|#...#|#...#|#.#.#|#..#.|.##.#',
  R: '####.|#...#|#...#|####.|#.#..|#..#.|#...#',
  S: '.####|#....|#....|.###.|....#|....#|####.',
  T: '#####|..#..|..#..|..#..|..#..|..#..|..#..',
  U: '#...#|#...#|#...#|#...#|#...#|#...#|.###.',
  V: '#...#|#...#|#...#|#...#|#...#|.#.#.|..#..',
  W: '#...#|#...#|#...#|#.#.#|#.#.#|##.##|#...#',
  X: '#...#|#...#|.#.#.|..#..|.#.#.|#...#|#...#',
  Y: '#...#|#...#|.#.#.|..#..|..#..|..#..|..#..',
  Z: '#####|....#|...#.|..#..|.#...|#....|#####',
  a: '.....|.....|.###.|....#|.####|#...#|.####',
  b: '#....|#....|####.|#...#|#...#|#...#|####.',
  c: '....|....|.###|#...|#...|#...|.###',
  d: '....#|....#|.####|#...#|#...#|#...#|.####',
  e: '.....|.....|.###.|#...#|#####|#....|.###.',
  f: '..##|.#..|####|.#..|.#..|.#..|.#..',
  g: '.....|.....|.####|#...#|#...#|#...#|.####|....#|.###.',
  h: '#....|#....|####.|#...#|#...#|#...#|#...#',
  i: '#|.|#|#|#|#|#',
  j: '..#|...|..#|..#|..#|..#|..#|#.#|.#.',
  k: '#...|#...|#..#|#.#.|##..|#.#.|#..#',
  l: '#.|#.|#.|#.|#.|#.|.#',
  m: '.....|.....|##.#.|#.#.#|#.#.#|#.#.#|#.#.#',
  n: '....|....|###.|#..#|#..#|#..#|#..#',
  o: '.....|.....|.###.|#...#|#...#|#...#|.###.',
  p: '....|....|###.|#..#|#..#|#..#|###.|#...|#...',
  q: '....|....|.###|#..#|#..#|#..#|.###|...#|...#',
  r: '....|....|#.##|##..|#...|#...|#...',
  s: '....|....|.###|#...|.##.|...#|###.',
  t: '.#..|.#..|###.|.#..|.#..|.#..|..##',
  u: '....|....|#..#|#..#|#..#|#..#|.###',
  v: '.....|.....|#...#|#...#|#...#|.#.#.|..#..',
  w: '.....|.....|#...#|#...#|#.#.#|#.#.#|.#.#.',
  x: '.....|.....|#...#|.#.#.|..#..|.#.#.|#...#',
  y: '....|....|#..#|#..#|#..#|#..#|.###|...#|###.',
  z: '....|....|####|..#.|.#..|#...|####',
  '0': '.###.|#...#|#..##|#.#.#|##..#|#...#|.###.',
  '1': '.#.|##.|.#.|.#.|.#.|.#.|###',
  '2': '.###.|#...#|....#|...#.|..#..|.#...|#####',
  '3': '####.|....#|....#|.###.|....#|....#|####.',
  '4': '...#.|..##.|.#.#.|#..#.|#####|...#.|...#.',
  '5': '#####|#....|####.|....#|....#|#...#|.###.',
  '6': '.###.|#....|#....|####.|#...#|#...#|.###.',
  '7': '#####|....#|...#.|..#..|.#...|.#...|.#...',
  '8': '.###.|#...#|#...#|.###.|#...#|#...#|.###.',
  '9': '.###.|#...#|#...#|.####|....#|....#|.###.',
  ' ': '...|...|...|...|...|...|...',
  '.': '.|.|.|.|.|.|#',
  ',': '..|..|..|..|..|..|.#|#.',
  '!': '#|#|#|#|#|.|#',
  '?': '.###.|#...#|....#|...#.|..#..|.....|..#..',
  "'": '#|#|.|.|.|.|.',
  '’': '#|#|.|.|.|.|.',
  '"': '#.#|#.#|...|...|...|...|...',
  ':': '.|.|#|.|.|#|.',
  ';': '..|..|.#|..|..|.#|#.',
  '-': '....|....|....|####|....|....|....',
  '+': '.....|..#..|..#..|#####|..#..|..#..|.....',
  '=': '....|....|####|....|####|....|....',
  '/': '....#|....#|...#.|..#..|.#...|#....|#....',
  '\\': '#....|#....|.#...|..#..|...#.|....#|....#',
  '(': '.#|#.|#.|#.|#.|#.|.#',
  ')': '#.|.#|.#|.#|.#|.#|#.',
  '[': '##|#.|#.|#.|#.|#.|##',
  ']': '##|.#|.#|.#|.#|.#|##',
  '<': '...#|..#.|.#..|#...|.#..|..#.|...#',
  '>': '#...|.#..|..#.|...#|..#.|.#..|#...',
  '#': '.#.#.|.#.#.|#####|.#.#.|#####|.#.#.|.#.#.',
  '%': '##..#|##..#|...#.|..#..|.#...|#..##|#..##',
  '&': '.##..|#..#.|#.#..|.#...|#.#.#|#..#.|.##.#',
  '*': '.....|#.#.#|.###.|#####|.###.|#.#.#|.....',
  _: '....|....|....|....|....|....|####',
  '@': '.###.|#...#|#.###|#.#.#|#.###|#....|.###.',
  '→': '.....|..#..|...#.|#####|...#.|..#..|.....',
  '←': '.....|..#..|.#...|#####|.#...|..#..|.....',
  '↑': '..#..|.###.|#.#.#|..#..|..#..|..#..|.....',
  '↓': '.....|..#..|..#..|..#..|#.#.#|.###.|..#..',
  '·': '.|.|.|#|.|.|.',
  '…': '.....|.....|.....|.....|.....|.....|#.#.#',
  '—': '......|......|......|######|......|......|......',
  '–': '....|....|....|####|....|....|....',
  '●': '.....|.###.|#####|#####|#####|.###.|.....',
  '○': '.....|.###.|#...#|#...#|#...#|.###.|.....',
  '✓': '.....|....#|...#.|#.#..|.#...|.....|.....',
  '×': '.....|#...#|.#.#.|..#..|.#.#.|#...#|.....',
  '♥': '.....|.#.#.|#####|#####|.###.|..#..|.....',
  '☠': '.###.|#####|#.#.#|#####|.###.|.#.#.|.....',
};

const ALIAS: Record<string, string> = { '“': '"', '”': '"', '‘': "'", 'é': 'e', 'è': 'e', 'à': 'a', '🔒': '#' };

const CELL_H = 9;
/** Line height in font pixels. */
export const LINE_H = 11;

interface Glyph { ch: string; rows: string[]; w: number }

function glyphs(): Glyph[] {
  return Object.entries(G).map(([ch, s]) => { const rows = s.split('|'); return { ch, rows, w: rows[0]!.length }; });
}

/** Build both fonts into one canvas texture and register them. Call once at boot. */
export function makeFonts(scene: Phaser.Scene): void {
  if (scene.cache.bitmapFont.exists('pf')) return;
  const list = glyphs();
  // Layout: plain glyphs on row 0, outlined glyphs (with 1 px border) below.
  const pad = 2;
  let totalW = 0;
  for (const g of list) totalW += g.w + 2 + pad;
  const texW = Math.min(2048, totalW + 8);
  const rowsNeeded = Math.ceil(totalW / (texW - 8)) + 1;
  const texH = (CELL_H + 2 + pad) * rowsNeeded * 3 + 12;
  const tex = scene.textures.createCanvas('fontsheet', texW, texH)!;
  const ctx = tex.getContext();
  const ink = KEY.k!;
  const inkCss = `#${ink.toString(16).padStart(6, '0')}`;

  const place = (outlined: boolean, y0: number, bold = false) => {
    const chars: Record<number, unknown> = {};
    let x = 2, y = y0;
    for (const g0 of list) {
      // Bold: every stroke one pixel wider (used for big titles).
      const g = bold ? { ...g0, w: g0.w + 1, rows: g0.rows.map((r) => [...r + '.'].map((c, i) => (c === '#' || (i > 0 && r[i - 1] === '#') ? '#' : '.')).join('')) } : g0;
      const cw = g.w + (outlined ? 2 : 0), ch = CELL_H + (outlined ? 2 : 0);
      if (x + cw + 2 > texW) { x = 2; y += CELL_H + 2 + pad; }
      const ox = outlined ? 1 : 0;
      if (outlined) {
        ctx.fillStyle = inkCss;
        g.rows.forEach((r, ry) => { for (let rx = 0; rx < r.length; rx++) if (r[rx] === '#') for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) ctx.fillRect(x + ox + rx + dx, y + ox + ry + dy, 1, 1); });
      }
      ctx.fillStyle = '#ffffff';
      g.rows.forEach((r, ry) => { for (let rx = 0; rx < r.length; rx++) if (r[rx] === '#') ctx.fillRect(x + ox + rx, y + ox + ry, 1, 1); });
      chars[g.ch.codePointAt(0)!] = {
        x, y, width: cw, height: ch, centerX: Math.floor(cw / 2), centerY: Math.floor(ch / 2),
        xOffset: outlined ? -1 : 0, yOffset: outlined ? -1 : 0, xAdvance: g.w + (outlined ? 2 : 1),
        data: {}, kerning: {},
        u0: x / texW, v0: y / texH, u1: (x + cw) / texW, v1: (y + ch) / texH,
      };
      x += cw + pad;
    }
    return { chars, end: y + CELL_H + 2 + pad };
  };
  const plain = place(false, 2);
  const outl = place(true, plain.end + 2);
  const bold = place(true, outl.end + 2, true);
  tex.refresh();
  for (const [key, set] of [['pf', plain.chars], ['pfo', outl.chars], ['pfb', bold.chars]] as const) {
    scene.cache.bitmapFont.add(key, { data: { font: key, size: 1, lineHeight: LINE_H, retroFont: false, chars: set }, texture: 'fontsheet', frame: null });
  }
}

/** Replace characters the font doesn't have. */
export function clean(text: string): string {
  let out = '';
  for (const ch of text) {
    if (G[ch] || ch === '\n') out += ch;
    else if (ALIAS[ch]) out += ALIAS[ch];
    else if (G[ch.toUpperCase()]) out += ch.toUpperCase();
    else out += '?';
  }
  return out;
}

export interface PTextOpts {
  /** Integer pixel scale. */
  scale?: number;
  color?: number;
  outline?: boolean;
  /** Bold outlined variant for big titles. */
  bold?: boolean;
  origin?: [number, number];
  align?: 'left' | 'center' | 'right';
  /** Wrap width in screen pixels (after scale). */
  wrap?: number;
}

/** Pixel text. Positions are rounded to whole pixels. */
export function ptext(scene: Phaser.Scene, x: number, y: number, text: string, o: PTextOpts = {}): Phaser.GameObjects.BitmapText {
  const s = o.scale ?? 3;
  const t = scene.add.bitmapText(Math.round(x), Math.round(y), o.bold ? 'pfb' : o.outline ? 'pfo' : 'pf', '', s);
  if (o.wrap) t.setMaxWidth(o.wrap);
  t.setText(clean(text));
  if (o.align === 'center') t.setCenterAlign();
  else if (o.align === 'right') t.setRightAlign();
  t.setTint(o.color ?? KEY.k!);
  const [ox, oy] = o.origin ?? [0, 0];
  t.setOrigin(ox, oy);
  return t;
}

/** Measure text width in font pixels (unscaled). */
export function textWidth(text: string): number {
  let w = 0;
  for (const ch of clean(text)) { const g = G[ch]; if (g) w += g.split('|')[0]!.length + 1; }
  return Math.max(0, w - 1);
}

/** Raw glyph rows ('#' = on), optionally bold (every stroke one pixel wider). */
export function glyphRows(ch: string, bold = false): string[] {
  const rows = (G[ch] ?? G['?']!).split('|');
  if (!bold) return rows;
  return rows.map((r) => [...r + '.'].map((c, i) => (c === '#' || (i > 0 && r[i - 1] === '#') ? '#' : '.')).join(''));
}
