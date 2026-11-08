// Pixel parallax backdrop behind every scene: the abandoned lab, rendered at 320×180 and scaled ×4.
//   base  – the far wall: paneling, overgrown windows with light shafts (emergency lamps in Act 3)
//   far   – server racks, specimen tanks (some shattered), pipes and sagging cables
//   mid   – broken tanks, consoles with dead screens, moss and roots; flooding in Act 2, bones in Act 3
// plus floating spores and a few flickering lights. One mood per act; all baked once at low resolution.
import Phaser from 'phaser';
import { ACT_PAL, KEY, hash2, mix, type ActPal } from '../render/pixel/pal';
import { Buf } from '../render/pixel/terrain';

const W = 1280, H = 720, S = 4, LW = W / S, LH = H / S;

interface Light { img: Phaser.GameObjects.Image; ph: number; kind: 'flicker' | 'pulse' }
interface Layer { root: Phaser.GameObjects.Container; far: Phaser.GameObjects.TileSprite; mid: Phaser.GameObjects.TileSprite; lights: Light[] }

function tex(scene: Phaser.Scene, key: string, w: number, h: number, paint: (b: Buf) => void): void {
  if (scene.textures.exists(key)) return;
  const t = scene.textures.createCanvas(key, w, h)!;
  const b = new Buf(w, h);
  paint(b);
  b.blit(t.getContext());
  t.refresh();
}

type Paint = { b: Buf; set(x: number, y: number, c: number, a?: number): void; rect(x: number, y: number, w: number, h: number, c: number, a?: number): void };
function painter(b: Buf, wrap: boolean): Paint {
  const set = (x: number, y: number, c: number, a = 1) => { const xx = wrap ? ((x % b.w) + b.w) % b.w : x; b.set(xx, y, c, a); };
  return { b, set, rect: (x, y, w, h, c, a = 1) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) set(x + i, y + j, c, a); } };
}

/** The far wall: dithered gradient, paneling, windows and light shafts (or emergency lamps). */
function base(b: Buf, pal: ActPal, act: number): Array<{ x: number; y: number; kind: 'flicker' | 'pulse'; color: number }> {
  const p = painter(b, false);
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
    const t = y / b.h;
    const dither = t > 0.66 || (t > 0.33 && (x + y) % 2 === 0);
    let c = dither ? pal.deep2 : pal.deep;
    if (x % 40 === 0 || y % 60 === 0) c = mix(c, pal.far, 0.35);
    if (hash2(x, y, 3) < 0.01) c = mix(c, pal.farHi, 0.4);
    p.set(x, y, c);
  }
  const lights: Array<{ x: number; y: number; kind: 'flicker' | 'pulse'; color: number }> = [];
  if (act === 4) {
    // The core: a cracked reactor column glowing from within, broken containment rings, heat from below.
    for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) { const t = y / b.h; if (t > 0.55 && (x * 3 + y * 7) % 5 < (t - 0.55) * 9) p.set(x, y, mix(b.get(x, y), pal.glow, 0.12 + (t - 0.55) * 0.25)); }
    const cx = Math.floor(b.w / 2), rw = 44;
    for (let y = 6; y < b.h; y++) for (let i = -rw / 2; i < rw / 2; i++) {
      const edge = Math.abs(i) > rw / 2 - 3;
      const shade = 1 - Math.abs(i) / (rw / 2);
      p.set(cx + i, y, edge ? pal.far : mix(pal.deep2, pal.farHi, shade * 0.5));
    }
    // The glowing seam down the middle, split by cracks.
    for (let y = 10; y < b.h; y++) {
      const wob = Math.round(Math.sin(y * 0.21) * 1.5);
      for (let i = -3; i <= 3; i++) p.set(cx + i + wob, y, mix(pal.glow, 0xffffff, i === 0 ? 0.55 : Math.abs(i) < 2 ? 0.2 : 0), Math.abs(i) === 3 ? 0.5 : 1);
      if (hash2(y, 0, 41) < 0.08) { let x = cx + wob, dir = hash2(y, 1, 41) < 0.5 ? -1 : 1; for (let k = 0; k < 14; k++) { x += dir; p.set(x, y + (k >> 2), pal.glow, 0.8); } }
    }
    // Containment rings, two of them snapped open.
    for (const [ry, broken] of [[34, false], [70, true], [108, true], [146, false]] as const) {
      for (let i = -rw / 2 - 6; i < rw / 2 + 6; i++) {
        if (broken && i > 4 && i < 16) continue;
        p.rect(cx + i, ry, 1, 5, i % 6 === 0 ? pal.farHi : pal.mid);
        p.set(cx + i, ry, pal.farHi);
      }
      lights.push({ x: cx - rw / 2 - 4, y: ry + 2, kind: 'pulse', color: pal.light });
    }
    lights.push({ x: cx, y: 60, kind: 'pulse', color: pal.glow }, { x: cx, y: 130, kind: 'pulse', color: pal.glow });
    // Heavy roots forced through the ceiling and down the walls.
    for (let k = 0; k < 16; k++) {
      let rx = Math.floor(hash2(k, 2, 42) * b.w); const len = 40 + Math.floor(hash2(k, 3, 42) * 120), th = 1 + Math.floor(hash2(k, 4, 42) * 3);
      for (let j = 0; j < len; j++) { for (let t = 0; t < th; t++) p.set(rx + t, j, t === 0 ? mix(pal.root, 0xffffff, 0.15) : pal.root); if (j % 5 === 0) rx += hash2(k, j, 43) < 0.5 ? -1 : 1; }
    }
  } else if (act !== 3) {
    // Tall windows, overgrown, throwing light shafts down and to the right.
    for (const wx of [40, 150, 260]) {
      const wy = 18, ww = 28, wh = 46;
      p.rect(wx - 2, wy - 2, ww + 4, wh + 4, pal.far);
      for (let j = 0; j < wh; j++) for (let i = 0; i < ww; i++) p.set(wx + i, wy + j, mix(pal.shaft, pal.deep, 0.15 + j / wh * 0.35));
      p.rect(wx + ww / 2 - 1, wy, 2, wh, pal.far); p.rect(wx, wy + wh / 2, ww, 2, pal.far);
      for (let k = 0; k < 7; k++) { const vx = wx + Math.floor(hash2(wx, k, 4) * ww); const len = 6 + Math.floor(hash2(wx, k, 5) * 22); for (let j = 0; j < len; j++) p.set(vx + (j % 6 < 3 ? 0 : 1), wy + j, j % 4 ? pal.mossDark : pal.moss); }
      for (let i = -2; i < ww + 2; i++) if (hash2(wx + i, 1, 6) < 0.6) p.set(wx + i, wy - 3, pal.moss);
      // Shaft: a dithered diagonal band.
      for (let j = wy + wh; j < b.h; j++) for (let i = 0; i < ww; i++) { const x = wx + i + Math.floor((j - wy - wh) * 0.45); if ((x + j) % 3 === 0) p.set(x, j, mix(b.get(x, j), pal.shaft, 0.35)); }
    }
  } else {
    // Deep containment: no windows, just red and amber emergency lamps over hazard stripes.
    for (let x = 0; x < b.w; x++) for (let y = 70; y < 74; y++) p.set(x, y, ((x + y) >> 2) % 2 ? mix(pal.glow, pal.deep, 0.65) : pal.deep2);
    for (const lx of [30, 110, 190, 270]) { p.rect(lx - 3, 30, 7, 5, KEY.k!); p.rect(lx - 2, 31, 5, 3, mix(pal.light, pal.deep, 0.3)); lights.push({ x: lx, y: 32, kind: 'pulse', color: pal.light }); }
  }
  // A few wall monitors that flicker.
  for (const [mx, my] of [[100, 96], [210, 104], [292, 88]] as const) { p.rect(mx - 6, my - 4, 12, 9, KEY.k!); p.rect(mx - 5, my - 3, 10, 6, mix(pal.glow, pal.deep2, 0.7)); lights.push({ x: mx, y: my, kind: 'flicker', color: pal.glow }); }
  return lights;
}

function far(b: Buf, pal: ActPal, act: number): void {
  const p = painter(b, true);
  const h = b.h, col = pal.far, hi = pal.farHi;
  // Pipes along the top with sagging cables.
  p.rect(0, 4, b.w, 4, col); p.rect(0, 5, b.w, 1, hi);
  for (let x = 0; x < b.w; x += 48) { p.rect(x, 2, 3, 8, col); }
  for (let k = 0; k < 6; k++) {
    const x0 = Math.floor(hash2(k, 1, 20) * b.w), span = 30 + Math.floor(hash2(k, 2, 20) * 40), sag = 6 + Math.floor(hash2(k, 3, 20) * 14);
    for (let i = 0; i <= span; i++) { const t = i / span; p.set(x0 + i, 8 + Math.round(Math.sin(t * Math.PI) * sag), KEY.K!); }
  }
  let x = 4;
  while (x < b.w) {
    const kind = hash2(x, 7, 21);
    if (kind < 0.45) {
      // Server rack with blinking LEDs.
      const rw = 18, rh = 50 + Math.floor(hash2(x, 8, 21) * 30);
      p.rect(x, h - rh, rw, rh, col); p.rect(x, h - rh, 1, rh, hi);
      for (let j = h - rh + 4; j < h - 4; j += 5) { p.rect(x + 2, j, rw - 4, 1, mix(col, KEY.k!, 0.4)); if (hash2(x, j, 22) < 0.5) p.set(x + 3 + Math.floor(hash2(x, j, 23) * 10), j + 2, hash2(x, j, 24) < 0.5 ? pal.glow : mix(pal.light, col, 0.3)); }
      x += rw + 6;
    } else {
      // Specimen tank: a glass capsule with glowing fluid (or shattered and empty).
      const tw = 22, th = 56 + Math.floor(hash2(x, 9, 21) * 20), broken = hash2(x, 10, 21) < 0.4;
      const top = h - th;
      p.rect(x - 2, top - 4, tw + 4, 5, col); p.rect(x - 2, h - 8, tw + 4, 8, col);
      for (let j = top + 1; j < h - 8; j++) for (let i = 0; i < tw; i++) {
        const fluid = !broken && j > top + 6;
        let c = mix(pal.deep, pal.farHi, 0.35);
        if (fluid) c = mix(pal.glow, pal.deep, 0.55);
        if (i === 2 || i === 3) c = mix(c, 0xffffff, 0.35);
        if (broken && j < top + 14 && hash2(x + i, j, 25) < (top + 14 - j) / 14) continue;
        p.set(x + i, j, c);
      }
      if (!broken) for (let k = 0; k < 4; k++) p.set(x + 6 + Math.floor(hash2(x, k, 26) * 12), top + 10 + Math.floor(hash2(x, k, 27) * 30), mix(pal.glow, 0xffffff, 0.5));
      x += tw + 10;
    }
  }
  // Vines from the pipes.
  for (let k = 0; k < 18; k++) { const vx = Math.floor(hash2(k, 4, 28) * b.w), len = 6 + Math.floor(hash2(k, 5, 28) * (act === 1 ? 14 : 34)); for (let j = 0; j < len; j++) p.set(vx + (j % 8 < 4 ? 0 : 1), 8 + j, j % 3 ? mix(pal.mossDark, col, 0.3) : mix(pal.moss, col, 0.3)); }
}

function mid(b: Buf, pal: ActPal, act: number): void {
  const p = painter(b, true);
  const h = b.h, col = pal.mid, hi = pal.midHi;
  let x = 0;
  while (x < b.w) {
    const kind = hash2(x, 1, 30);
    if (kind < 0.5) {
      // Console desk with a monitor.
      const dw = 34;
      p.rect(x, h - 22, dw, 22, col); p.rect(x, h - 22, dw, 1, hi);
      p.rect(x + 8, h - 38, 16, 12, col); p.rect(x + 10, h - 36, 12, 8, mix(pal.glow, col, hash2(x, 2, 30) < 0.5 ? 0.55 : 0.85));
      p.rect(x + 15, h - 26, 2, 4, col);
      for (let i = 0; i < dw; i++) if (hash2(x + i, 3, 30) < 0.5) p.set(x + i, h - 23, pal.mossDark);
      x += dw + 14;
    } else {
      // Big broken tank on a base, half its glass gone.
      const tw = 30, th = 70;
      p.rect(x - 3, h - 12, tw + 6, 12, col); p.rect(x - 3, h - 12, tw + 6, 1, hi);
      for (let j = h - th; j < h - 12; j++) {
        const jag = Math.floor(hash2(x, j, 31) * 6);
        p.set(x + jag % 3, j, hi); p.set(x + tw - 1 - (jag % 2), j, hi);
        if (j < h - th + 20) continue;
        if (hash2(x, j, 32) < 0.4) p.set(x + 1 + jag, j, mix(hi, col, 0.4));
      }
      p.rect(x - 3, h - th - 3, tw + 6, 4, col);
      x += tw + 18;
    }
  }
  // Moss mounds along the floor, roots in Act 3, a flood line in Act 2.
  for (let i = 0; i < b.w; i++) { const y = h - 4 - Math.round(Math.sin(i * 0.09) * 2 + hash2(i, 5, 33) * 2); for (let j = y; j < h; j++) p.set(i, j, j === y ? pal.moss : mix(pal.mossDark, col, 0.4)); }
  if (act === 2) for (let i = 0; i < b.w; i++) { for (let j = h - 9; j < h; j++) p.set(i, j, j === h - 9 ? 0x6fd4c2 : mix(0x1f6d68, col, 0.3), 0.85); }
  if (act === 4) for (let i = 0; i < b.w; i++) { const y = h - 3 - Math.round(hash2(i, 9, 37) * 2); for (let j = y; j < h; j++) p.set(i, j, mix(col, pal.glow, 0.35 + (j - y) * 0.15)); }
  if (act >= 3) {
    for (let k = 0; k < (act === 4 ? 18 : 10); k++) { let rx = Math.floor(hash2(k, 6, 34) * b.w); for (let j = 0; j < 30 + hash2(k, 7, 34) * 40; j++) { p.set(rx, j, pal.root); if (j % 4 === 0) rx += hash2(k, j, 35) < 0.5 ? -1 : 1; } }
    for (let k = 0; k < 8; k++) { const bx = Math.floor(hash2(k, 8, 36) * b.w); p.rect(bx, h - 6, 5, 1, KEY.o!); p.set(bx - 1, h - 7, KEY.o!); p.set(bx + 5, h - 7, KEY.o!); }
  }
}

export class Backdrop extends Phaser.Scene {
  private layers = new Map<number, Layer>();
  private mood = -1;
  private motes: Array<{ img: Phaser.GameObjects.Image; x: number; y: number; v: number; ph: number }> = [];
  private t = 0;
  /** -1..1 parallax hint from the game (Pip's position). */
  parallax = { x: 0, y: 0 };
  private px = 0;
  private py = 0;

  constructor() { super('Backdrop'); }

  private veil!: Phaser.GameObjects.Rectangle;

  create(): void {
    this.setMood(0, true);
    // During play the backdrop recedes behind the playfield (darker, lower contrast).
    this.veil = this.add.rectangle(0, 0, W, H, 0x0c0a12, 0).setOrigin(0).setDepth(4);
    for (let i = 0; i < 30; i++) {
      const img = this.add.image(0, 0, 'atlas', i % 4 ? 'p1' : 'p2').setScale(S).setDepth(5);
      this.motes.push({ img, x: Math.random() * LW, y: Math.random() * LH, v: 1.5 + Math.random() * 4, ph: Math.random() * 6 });
    }
  }

  private buildLayer(act: number): Layer {
    const pal = ACT_PAL[act] ?? ACT_PAL[1]!;
    let lightSpots: ReturnType<typeof base> = [];
    tex(this, `bdBase${act}`, LW, LH, (b) => { lightSpots = base(b, pal, act); });
    if (!lightSpots.length) { const tmp = new Buf(LW, LH); lightSpots = base(tmp, pal, act); }
    tex(this, `bdFar${act}`, LW, 120, (b) => far(b, pal, act));
    tex(this, `bdMid${act}`, LW, 90, (b) => mid(b, pal, act));
    const root = this.add.container(0, 0).setDepth(0);
    const s = this.add.image(0, 0, `bdBase${act}`).setOrigin(0).setScale(S);
    const lights: Light[] = lightSpots.map((l) => ({
      img: this.add.image(l.x * S, l.y * S, 'atlas', 'halo').setScale(l.kind === 'pulse' ? S : 2).setTint(l.color).setAlpha(0.5),
      ph: hash2(l.x, l.y, 9) * 6, kind: l.kind,
    }));
    const farL = this.add.tileSprite(0, H - 120 * S, LW, 120, `bdFar${act}`).setOrigin(0).setScale(S);
    const midL = this.add.tileSprite(0, H - 90 * S, LW, 90, `bdMid${act}`).setOrigin(0).setScale(S);
    root.add([s, ...lights.map((l) => l.img), farL, midL]);
    return { root, far: farL, mid: midL, lights };
  }

  /** Push the backdrop back (in play) or bring it forward (menus). */
  setRecede(on: boolean): void {
    this.tweens.killTweensOf(this.veil);
    this.tweens.add({ targets: this.veil, fillAlpha: on ? 0.55 : 0, duration: 300 });
  }

  setMood(act: number, instant = false): void {
    if (act === this.mood) return;
    let layer = this.layers.get(act);
    if (!layer) { layer = this.buildLayer(act); this.layers.set(act, layer); }
    const first = this.mood < 0;
    this.mood = act;
    for (const [k, l] of this.layers) {
      this.tweens.killTweensOf(l.root);
      if (k === act) {
        l.root.setDepth(1).setVisible(true);
        if (instant || first) l.root.setAlpha(1);
        else { l.root.setAlpha(0); this.tweens.add({ targets: l.root, alpha: 1, duration: 600, ease: 'Stepped', easeParams: [6] }); }
      } else l.root.setDepth(0);
    }
    const pal = ACT_PAL[act] ?? ACT_PAL[1]!;
    for (const m of this.motes) m.img.setTint(pal.mote);
  }

  override update(_t: number, dms: number): void {
    const dt = Math.min(dms, 50) / 1000;
    this.t += dt;
    this.px += (this.parallax.x - this.px) * Math.min(1, dt * 3);
    this.py += (this.parallax.y - this.py) * Math.min(1, dt * 3);
    const l = this.layers.get(this.mood);
    if (l) {
      l.far.tilePositionX = Math.round(this.t * 0.5 + this.px * 6);
      l.mid.tilePositionX = Math.round(this.t * 1.2 + this.px * 14);
      l.far.y = H - 120 * S + Math.round(this.py * 2) * S;
      l.mid.y = H - 90 * S + Math.round(this.py * 4) * S;
      for (const lt of l.lights) {
        if (lt.kind === 'pulse') lt.img.setAlpha(0.25 + Math.max(0, Math.sin(this.t * 3 + lt.ph)) * 0.55);
        else lt.img.setAlpha(Math.sin(this.t * 17 + lt.ph * 7) > 0.8 || Math.sin(this.t * 1.3 + lt.ph) > 0.95 ? 0.15 : 0.45);
      }
    }
    for (const m of this.motes) {
      m.y -= m.v * dt;
      m.x += Math.sin(this.t * 0.7 + m.ph) * dt * 4;
      if (m.y < -2) { m.y = LH + 2; m.x = Math.random() * LW; }
      m.img.setPosition(Math.round(m.x) * S, Math.round(m.y) * S).setAlpha(0.3 + Math.sin(this.t * 2 + m.ph) * 0.25);
    }
  }
}
