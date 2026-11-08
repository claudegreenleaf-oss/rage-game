// Gadgets (editor-made mechanics) as pixel art: a baked texture per distinct look (panel, round, spikes,
// art, field), pooled one sprite per gadget, plus a soft glow. Readability first: every effect has a
// default colour and a small white-on-ink icon, so the player can tell what a thing does at a glance.
import Phaser from 'phaser';
import { U, type GadgetEffect, type GadgetEffectKind, type GadgetObj, type PixelArt } from '../sim/types';
import type { RtGadget } from '../sim/hazards';
import type { World } from '../sim/world';
import { Buf, pixelArtTexture } from './pixel/terrain';
import { clean, glyphRows } from './pixel/font';
import { ATLAS } from './pixel/sprites';
import { KEY, mix } from './pixel/pal';
import type { Pixels } from './pixel/particles';
import { rng } from './rng';

const P = (u: number) => u / (U / 16);
const R = Math.round;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const INK = KEY.k!;
const WHITE = 0xfffdf2;

/** Default colour per effect (the lab palette, a little saturated so interactables pop). */
export const GADGET_COLOR: Record<GadgetEffectKind, number> = {
  none: 0x8f87a3,
  kill: 0xff5a5a,
  bounce: 0x5fdc84,
  launch: 0xff9a3c,
  force: 0xbff4ff,
  gravity: 0xa98bff,
  teleport: 0xff3fa0,
  slow: 0x3db7ae,
  conveyor: 0xf2b134,
  checkpoint: 0xffd35c,
  collect: 0xffe84a,
  win: 0x7fffc8,
};

type Dir = 'up' | 'down' | 'left' | 'right';

// 7x7 icons ('#' on). Arrows are authored pointing up and rotated.
const ARROW_UP = ['...#...', '..###..', '.#.#.#.', '...#...', '...#...', '...#...', '...#...'];
const SPRING = ['...#...', '..###..', '.#.#.#.', '...#...', '..#....', '...#...', '..#....'];
const LAUNCH = ['...#...', '..#.#..', '.#...#.', '...#...', '..#.#..', '.#...#.', '.......'];
const SWIRL = ['..###..', '.#...#.', '#..#..#', '#.#.#.#', '#..##.#', '.#....#', '..####.'];
const SKULL = ['..###..', '.#####.', '##.#.##', '#######', '.#####.', '..#.#..', '.......'];
const GLASS = ['#####..', '#...#..', '.#.#...', '..#....', '.#.#...', '#.#.#..', '#####..'];
const FLAG = ['##.....', '####...', '#####..', '####...', '#......', '#......', '#......'];
const GEM = ['...#...', '..###..', '.#####.', '#######', '.#####.', '..###..', '...#...'];
const STAR = ['...#...', '...#...', '#######', '.#####.', '..###..', '.##.##.', '.#...#.'];
const CHEV = ['...#...', '..#.#..', '.#...#.', '#.....#', '.......', '.......', '.......'];

function rotate(rows: string[], dir: Dir): string[] {
  if (dir === 'up') return rows;
  const n = rows.length, m = rows[0]!.length;
  if (dir === 'down') return [...rows].reverse().map((r) => [...r].reverse().join(''));
  const out: string[] = [];
  // 90 degrees clockwise (right) or counter-clockwise (left); icons are square.
  for (let y = 0; y < m; y++) {
    let s = '';
    for (let x = 0; x < n; x++) s += dir === 'right' ? rows[n - 1 - x]![y] : rows[x]![m - 1 - y];
    out.push(s);
  }
  return out;
}

const dirOf = (x: number, y: number): Dir => (Math.abs(x) >= Math.abs(y) ? (x >= 0 ? 'right' : 'left') : y >= 0 ? 'down' : 'up');

/** The default icon for an effect, or null for none. */
function defaultIcon(e: GadgetEffect): string[] | null {
  switch (e.kind) {
    case 'kill': return SKULL;
    case 'bounce': return SPRING;
    case 'launch': return rotate(LAUNCH, dirOf(e.vx, e.vy));
    case 'force': return rotate(ARROW_UP, dirOf(e.ax, e.ay));
    case 'gravity': return rotate(ARROW_UP, e.scale < 1 ? 'up' : 'down');
    case 'teleport': return SWIRL;
    case 'slow': return GLASS;
    case 'conveyor': return rotate(CHEV, e.speed >= 0 ? 'right' : 'left');
    case 'checkpoint': return FLAG;
    case 'collect': return GEM;
    case 'win': return STAR;
    default: return null;
  }
}

/** Draw `rows` at (x, y), white with a 1 px ink outline. */
function drawBits(b: Buf, rows: string[], x: number, y: number, s: number): void {
  const on = (cx: number, cy: number): boolean => {
    const gx = Math.floor((cx - x) / s), gy = Math.floor((cy - y) / s);
    return gy >= 0 && gy < rows.length && gx >= 0 && gx < rows[gy]!.length && rows[gy]![gx] === '#';
  };
  const w = rows[0]!.length * s, h = rows.length * s;
  for (let cy = y - 1; cy <= y + h; cy++) for (let cx = x - 1; cx <= x + w; cx++) {
    if (on(cx, cy)) continue;
    if (on(cx - 1, cy) || on(cx + 1, cy) || on(cx, cy - 1) || on(cx, cy + 1)) b.set(cx, cy, INK);
  }
  for (let cy = y; cy < y + h; cy++) for (let cx = x; cx < x + w; cx++) if (on(cx, cy)) b.set(cx, cy, WHITE);
}

/** A custom glyph string through the pixel font, as rows of '#'. */
function glyphText(text: string): string[] | null {
  const chars = [...clean(text.trim())].slice(0, 4);
  if (!chars.length) return null;
  const rows = Array.from({ length: 9 }, () => '');
  chars.forEach((ch, i) => {
    const g = glyphRows(ch);
    for (let y = 0; y < 9; y++) rows[y] += (i ? '.' : '') + (g[y] ?? '.'.repeat(g[0]!.length));
  });
  while (rows.length > 1 && /^\.*$/.test(rows[rows.length - 1]!)) rows.pop();
  return rows;
}

interface Look { color: number; shape: 'box' | 'round' | 'spikes' | 'field' | 'none'; art?: string; glyph?: string; glow: boolean }

function lookOf(d: GadgetObj): Look {
  const l = d.look ?? {};
  const k = d.effect.kind;
  const color = l.color && /^#?[0-9a-f]{6}$/i.test(l.color) ? parseInt(l.color.replace('#', ''), 16) : GADGET_COLOR[k];
  const field = k === 'force' || k === 'gravity' || k === 'slow';
  const shape = l.shape ?? (field && d.solid !== 'solid' ? 'field' : k === 'collect' || k === 'teleport' ? 'round' : 'box');
  return { color, shape, art: l.art, glyph: l.glyph, glow: !!l.glow };
}

function paintShape(b: Buf, look: Look, w: number, h: number, solid: boolean, kill: boolean): void {
  const c = look.color;
  const edge = mix(c, INK, 0.7), hi = mix(c, WHITE, 0.5), shade = mix(c, INK, 0.28);
  const fillA = solid ? 1 : 0.82;
  if (look.shape === 'round') {
    const cx = w / 2, cy = h / 2, rx = w / 2, ry = h / 2;
    const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!inside(x, y)) continue;
      const rim = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
      if (rim) { b.set(x, y, edge); continue; }
      const nx = (x + 0.5 - cx) / rx, ny = (y + 0.5 - cy) / ry;
      const s = nx + ny;
      b.set(x, y, s < -0.85 ? hi : s > 0.85 ? shade : c, fillA);
    }
    return;
  }
  if (look.shape === 'spikes') {
    const th = Math.min(h, Math.max(5, Math.min(8, Math.round(h * 0.7)))), tw = 4;
    const baseTop = th - 1;
    for (let y = baseTop + 1; y < h; y++) for (let x = 0; x < w; x++) b.set(x, y, y === h - 1 || x === 0 || x === w - 1 ? edge : shade);
    for (let x0 = 0; x0 < w; x0 += tw) {
      for (let y = 0; y < th; y++) {
        const half = Math.min(tw / 2, 1 + Math.floor((y * tw) / 2 / Math.max(1, th - 1)));
        const l = Math.floor(x0 + tw / 2 - half), r = Math.min(w, Math.floor(x0 + tw / 2 + half));
        for (let x = Math.max(0, l); x < r; x++) b.set(x, y, x === l || x === r - 1 && r - l > 1 ? (x === l ? hi : shade) : c);
      }
    }
    // Ink outline around the teeth.
    const snap = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) snap[y * w + x] = b.alpha(x, y) > 0 ? 1 : 0;
    for (let y = 0; y < Math.min(h, th + 1); y++) for (let x = 0; x < w; x++) {
      if (snap[y * w + x]) continue;
      const n = (xx: number, yy: number) => xx >= 0 && yy >= 0 && xx < w && yy < h && snap[yy * w + xx];
      if (n(x - 1, y) || n(x + 1, y) || n(x, y + 1) || n(x, y - 1)) b.set(x, y, INK);
    }
    return;
  }
  // Panel.
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const rim = x === 0 || y === 0 || x === w - 1 || y === h - 1;
    if (rim) { b.set(x, y, edge); continue; }
    let col = c;
    if (y === 1 || x === 1) col = hi;
    else if (y === h - 2 || x === w - 2) col = shade;
    else if (kill && ((x + y) >> 2) % 2 === 0) col = shade;
    b.set(x, y, col, fillA);
  }
  if (solid && w >= 8 && h >= 8) for (const [x, y] of [[2, 2], [w - 3, 2], [2, h - 3], [w - 3, h - 3]] as const) b.set(x, y, edge);
}

function paintField(b: Buf, color: number, w: number, h: number): void {
  const lt = mix(color, WHITE, 0.4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const rim = x === 0 || y === 0 || x === w - 1 || y === h - 1;
    if (!rim) { b.set(x, y, color, 0.15); continue; }
    // Dashed border, so a field reads as a zone rather than a wall.
    const t = x === 0 || x === w - 1 ? y : x;
    if (Math.floor(t / 3) % 2 === 0) b.set(x, y, lt, 0.8);
  }
  for (const [x, y] of [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]] as const) b.set(x, y, lt, 1);
}

/** A 16x16 drifting pattern for a field, in the direction the field pushes. */
function paintPattern(b: Buf, color: number, kind: GadgetEffectKind, dir: Dir): void {
  const lt = mix(color, WHITE, 0.55);
  if (kind === 'force' || kind === 'gravity') {
    const rows = rotate(['..#..', '.#.#.', '#...#', '.....', '.....'], dir);
    for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) if (rows[y]![x] === '#') { b.set(x + 5, y + 5, lt, 0.9); }
    return;
  }
  for (const [x, y] of [[3, 2], [11, 7], [6, 12], [14, 14]] as const) b.set(x, y, lt, 0.85);
}

interface View {
  id: string;
  d: GadgetObj;
  img: Phaser.GameObjects.Image;
  glow: Phaser.GameObjects.Image | null;
  glowK: number;
  flow: Phaser.GameObjects.TileSprite | null;
  flowDir: [number, number];
  a: number;
  pulse: number;
  w: number; h: number;
  kind: GadgetEffectKind;
  color: number;
  sparkle: boolean;
  bob: boolean;
}

export interface GadgetLayerOpts {
  scene: Phaser.Scene;
  world: World;
  viewId: number;
  /** Solid gadgets read as foreground plating; the rest are overlays. */
  back: Phaser.GameObjects.Container;
  front: Phaser.GameObjects.Container;
  glow: Phaser.GameObjects.Container;
  particles: Pixels;
  /** Scale on additive halos (toned down on bright walls). */
  haloK: number;
}

export class GadgetLayer {
  private views = new Map<string, View>();
  private keys = new Set<string>();
  private t = 0;
  private readonly scene: Phaser.Scene;
  private readonly world: World;
  private readonly particles: Pixels;

  constructor(private o: GadgetLayerOpts) {
    this.scene = o.scene; this.world = o.world; this.particles = o.particles;
    const images = o.world.level.images ?? [];
    for (const g of o.world.obj.gadgets) this.build(g, images);
  }

  get count(): number { return this.views.size; }

  private tex(sig: string, w: number, h: number, paint: (b: Buf) => void): string {
    const key = `gad_${this.o.viewId}_${sig}`;
    if (this.keys.has(key)) return key;
    const b = new Buf(w, h);
    paint(b);
    const t = this.scene.textures.createCanvas(key, w, h)!;
    b.blit(t.getContext());
    t.refresh();
    this.keys.add(key);
    return key;
  }

  private build(g: RtGadget, images: PixelArt[]): void {
    const d = g.def;
    const w = Math.max(2, R(P(g.w))), h = Math.max(2, R(P(g.h)));
    const look = lookOf(d);
    const e = d.effect;
    const solid = d.solid === 'solid' || d.solid === 'oneWay';
    let img: Phaser.GameObjects.Image;
    let flow: Phaser.GameObjects.TileSprite | null = null;
    let flowDir: [number, number] = [0, 0];
    const art = look.art ? images.find((a) => a.id === look.art) : undefined;
    const hex = (c: number) => c.toString(16);
    if (art) {
      const key = `gad_${this.o.viewId}_art_${art.id}`;
      if (!this.keys.has(key)) { if (pixelArtTexture(this.scene, key, art)) this.keys.add(key); }
      img = this.scene.add.image(0, 0, this.keys.has(key) ? key : ATLAS, this.keys.has(key) ? undefined : 'p1').setOrigin(0).setDisplaySize(w, h);
    } else if (look.shape === 'none') {
      img = this.scene.add.image(0, 0, ATLAS, 'p1').setOrigin(0).setVisible(false);
    } else if (look.shape === 'field') {
      const key = this.tex(`field_${w}x${h}_${hex(look.color)}`, w, h, (b) => paintField(b, look.color, w, h));
      img = this.scene.add.image(0, 0, key).setOrigin(0);
      // Drifting motes/chevrons inside the field, moving the way it pushes.
      let dir: Dir = 'up';
      if (e.kind === 'force') { dir = dirOf(e.ax, e.ay); flowDir = [e.ax, e.ay]; }
      else if (e.kind === 'gravity') { dir = e.scale < 1 ? 'up' : 'down'; flowDir = [0, e.scale < 1 ? -1 : 1]; }
      else if (e.kind === 'slow') flowDir = [0.1, -0.1];
      else flowDir = [0, -0.5];
      const pk = this.tex(`pat_${e.kind}_${dir}_${hex(look.color)}`, 16, 16, (b) => paintPattern(b, look.color, e.kind, dir));
      flow = this.scene.add.tileSprite(1, 1, Math.max(1, w - 2), Math.max(1, h - 2), pk).setOrigin(0).setAlpha(0.8);
    } else {
      const icon = look.glyph ? glyphText(look.glyph) : look.shape === 'spikes' ? null : defaultIcon(e);
      const sig = `${look.shape}_${w}x${h}_${hex(look.color)}_${solid ? 's' : 'o'}_${e.kind === 'kill' ? 'k' : ''}_${look.glyph ?? e.kind}_${icon ? icon.join('').length : 0}_${e.kind === 'launch' ? (e.vx > 0) + '' + (e.vy > 0) : e.kind === 'force' ? dirOf(e.ax, e.ay) : e.kind === 'gravity' ? e.scale < 1 : e.kind === 'conveyor' ? e.speed >= 0 : ''}`;
      const key = this.tex(sig, w, h, (b) => {
        paintShape(b, look, w, h, solid, e.kind === 'kill');
        if (icon) {
          const iw = icon[0]!.length, ih = icon.length;
          const s = Math.max(1, Math.min(3, Math.floor((Math.min(w, h) - 4) / Math.max(iw, ih))));
          if (iw * s + 2 <= w && ih * s + 2 <= h && Math.min(w, h) >= 9) drawBits(b, icon, Math.floor((w - iw * s) / 2), Math.floor((h - ih * s) / 2), s);
        }
      });
      img = this.scene.add.image(0, 0, key).setOrigin(0);
    }
    // Spikes and solids sit behind Pip like plating; everything else is an overlay in front.
    const layer = solid || look.shape === 'spikes' ? this.o.back : this.o.front;
    layer.add(flow ? [img, flow] : [img]);
    const strong = look.glow;
    const natural = e.kind === 'collect' || e.kind === 'checkpoint' || e.kind === 'win' || e.kind === 'teleport' || e.kind === 'bounce' || look.shape === 'field';
    let glow: Phaser.GameObjects.Image | null = null;
    if ((strong || natural) && look.shape !== 'none') {
      glow = this.scene.add.image(0, 0, ATLAS, 'halo').setOrigin(0.5).setTint(look.color).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0);
      glow.setScale(Math.max(1.1, (Math.max(w, h) * (strong ? 2.1 : 1.5)) / 32));
      this.o.glow.add(glow);
    }
    this.views.set(g.id, {
      id: g.id, d, img, glow, glowK: strong ? 0.55 : 0.24, flow, flowDir, a: g.on ? 1 : 0.35, pulse: 0, w, h, kind: e.kind, color: look.color,
      sparkle: e.kind === 'collect' || e.kind === 'checkpoint' || e.kind === 'win' || e.kind === 'teleport',
      bob: e.kind === 'collect' && !d.path?.length,
    });
  }

  /** A little squash on the gadget (a spring that was just used). */
  poke(id: string): void { const v = this.views.get(id); if (v) v.pulse = 0.18; }

  centerOf(id: string): { x: number; y: number } | null {
    const g = this.world.obj.get<RtGadget>(id);
    return g ? { x: P(g.x + g.w / 2), y: P(g.y + g.h / 2) } : null;
  }

  colorOf(id: string): number { return this.views.get(id)?.color ?? 0xffffff; }

  /** Steady lights for dark rooms: lit gadgets with a glow. */
  lights(): Array<{ x: number; y: number; r: number; a: number }> {
    const out: Array<{ x: number; y: number; r: number; a: number }> = [];
    for (const g of this.world.obj.gadgets) {
      const v = this.views.get(g.id);
      if (!v?.glow || g.gone || !g.on) continue;
      out.push({ x: P(g.x + g.w / 2), y: P(g.y + g.h / 2), r: Math.max(14, Math.max(v.w, v.h) * 0.9 + 8), a: v.glowK > 0.4 ? 0.9 : 0.55 });
    }
    return out;
  }

  update(alpha: number, dt: number): void {
    this.t += dt;
    for (const g of this.world.obj.gadgets) {
      const v = this.views.get(g.id);
      if (!v) continue;
      const hidden = g.gone || v.d.look?.shape === 'none' && !v.d.look.art;
      v.pulse = Math.max(0, v.pulse - dt);
      v.a = lerp(v.a, g.on ? 1 : 0.35, Math.min(1, dt * 12));
      const x = lerp(g.px, g.x, alpha), y = lerp(g.py, g.y, alpha);
      let px = R(P(x)), py = R(P(y));
      if (v.bob) py += R(Math.sin(this.t * 2.6 + g.x * 0.01) * 1.5);
      v.img.setVisible(!g.gone && !(v.d.look?.shape === 'none' && !v.d.look.art));
      if (!hidden) {
        const sq = v.pulse > 0 ? 1 - Math.sin((v.pulse / 0.18) * Math.PI) * 0.22 : 1;
        v.img.setAlpha(v.a);
        if (sq !== 1) { v.img.setScale(1 + (1 - sq) * 0.5, sq).setPosition(px - R((v.img.displayWidth - v.w) / 2), py + v.h - R(v.h * sq)); }
        else { v.img.setScale(v.d.look?.art ? v.img.scaleX : 1, v.d.look?.art ? v.img.scaleY : 1); v.img.setPosition(px, py); }
      }
      if (v.flow) {
        v.flow.setVisible(!hidden).setPosition(px + 1, py + 1).setAlpha(0.8 * v.a);
        const sp = v.kind === 'slow' ? 5 : 16;
        const m = (c: number) => (v.kind === 'force' ? Math.min(1.8, 0.6 + Math.abs(c) / 40) : 1) * Math.sign(c);
        v.flow.tilePositionX = R(this.t * sp * m(v.flowDir[0]));
        v.flow.tilePositionY = R(this.t * sp * m(v.flowDir[1]));
      }
      if (v.glow) {
        const on = !hidden && g.on;
        const k = on ? v.glowK * (0.8 + Math.sin(this.t * 2.4 + g.x * 0.01) * 0.2) : 0;
        v.glow.setPosition(px + v.w / 2, py + v.h / 2).setAlpha(lerp(v.glow.alpha, k * this.o.haloK * 2.2, 0.2));
        v.glow.setVisible(!hidden);
      }
      if (v.sparkle && !hidden && g.on && rng.next() < dt * 1.6) {
        const cx = px + v.w / 2, cy = py + v.h / 2;
        this.particles.spawn(cx + rng.range(-v.w / 2, v.w / 2), cy + rng.range(-v.h / 2, v.h / 2), { frames: ['spark', 'p3', 'p1'], tint: mix(v.color, WHITE, 0.4), vy: -7, life: 0.7, fade: false });
      }
    }
  }

  destroy(): void {
    for (const v of this.views.values()) { v.img.destroy(); v.flow?.destroy(); v.glow?.destroy(); }
    this.views.clear();
    for (const k of this.keys) if (this.scene.textures.exists(k)) this.scene.textures.remove(k);
    this.keys.clear();
  }
}
