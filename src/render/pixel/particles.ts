// Pooled pixel particles: small atlas frames moved in whole pixels. No Graphics redraws.
import Phaser from 'phaser';
import { ATLAS } from './sprites';
import { KEY } from './pal';
import { rng } from '../rng';

interface P {
  img: Phaser.GameObjects.Image;
  x: number; y: number; vx: number; vy: number;
  g: number; drag: number; life: number; max: number;
  frames: string[] | null; spin: boolean; fade: boolean;
}

export class Pixels {
  private pool: P[] = [];
  private live: P[] = [];
  constructor(private scene: Phaser.Scene, private layer: Phaser.GameObjects.Container, private cap = 260) {}

  private get(): P | null {
    let p = this.pool.pop();
    if (!p) {
      if (this.live.length >= this.cap) return null;
      const img = this.scene.add.image(0, 0, ATLAS, 'p1').setOrigin(0.5);
      this.layer.add(img);
      p = { img, x: 0, y: 0, vx: 0, vy: 0, g: 0, drag: 0, life: 0, max: 1, frames: null, spin: false, fade: true };
    }
    p.img.setVisible(true).setAlpha(1).setAngle(0).setScale(1);
    this.live.push(p);
    return p;
  }

  spawn(x: number, y: number, o: { frame?: string; frames?: string[]; tint?: number; vx?: number; vy?: number; g?: number; drag?: number; life?: number; spin?: boolean; fade?: boolean; alpha?: number }): void {
    const p = this.get();
    if (!p) return;
    p.x = x; p.y = y; p.vx = o.vx ?? 0; p.vy = o.vy ?? 0; p.g = o.g ?? 0; p.drag = o.drag ?? 0;
    p.life = p.max = o.life ?? 0.6; p.frames = o.frames ?? null; p.spin = !!o.spin; p.fade = o.fade ?? true;
    p.img.setFrame(o.frames ? o.frames[0]! : o.frame ?? 'p1');
    p.img.setTint(o.tint ?? 0xffffff);
    p.img.setAlpha(o.alpha ?? 1);
  }

  update(dt: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i]!;
      p.life -= dt;
      if (p.life <= 0) { p.img.setVisible(false); this.live.splice(i, 1); this.pool.push(p); continue; }
      p.vy += p.g * dt;
      const d = Math.exp(-p.drag * dt);
      p.vx *= d; p.vy *= d;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.img.setPosition(Math.round(p.x), Math.round(p.y));
      const k = 1 - p.life / p.max;
      if (p.frames) p.img.setFrame(p.frames[Math.min(p.frames.length - 1, Math.floor(k * p.frames.length))]!);
      if (p.spin) p.img.setAngle(Math.round((p.vx * k * 4) / 90) * 90);
      if (p.fade && k > 0.6) p.img.setAlpha(Math.max(0, (1 - k) / 0.4));
    }
  }

  clear(): void { for (const p of this.live) { p.img.setVisible(false); this.pool.push(p); } this.live = []; }

  // --- presets (world pixel coordinates) ---------------------------------------

  dust(x: number, y: number, n = 5, tint = 0xf2e6d6): void {
    for (let i = 0; i < n; i++) this.spawn(x + rng.range(-4, 4), y - 1, { frame: rng.next() < 0.5 ? 'p2' : 'p1', tint, vx: rng.range(-28, 28), vy: rng.range(-18, -4), g: 30, drag: 3, life: rng.range(0.25, 0.5) });
  }
  puff(x: number, y: number, n = 6, spread = 6, tint = 0xffffff): void {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rng.range(-0.3, 0.3);
      this.spawn(x + Math.cos(a) * 2, y + Math.sin(a) * 2, { frames: ['puff1', 'puff0', 'puff2', 'puff3'], tint, vx: Math.cos(a) * spread * 5, vy: Math.sin(a) * spread * 4 - 6, drag: 5, life: rng.range(0.35, 0.55), fade: false });
    }
  }
  sparkle(x: number, y: number, n = 5, tint = 0xffffff): void {
    for (let i = 0; i < n; i++) this.spawn(x + rng.range(-8, 8), y + rng.range(-8, 4), { frames: ['spark', 'p3', 'p1'], tint, vy: rng.range(-20, -6), life: rng.range(0.3, 0.6), fade: false });
  }
  sparks(x: number, y: number, n = 14, tint = KEY.x!): void {
    for (let i = 0; i < n; i++) { const a = rng.range(0, Math.PI * 2), s = rng.range(30, 110); this.spawn(x, y, { frame: rng.next() < 0.3 ? 'p2' : 'p1', tint, vx: Math.cos(a) * s, vy: Math.sin(a) * s, g: 90, drag: 2, life: rng.range(0.2, 0.5) }); }
  }
  bones(x: number, y: number, n = 6): void {
    for (let i = 0; i < n; i++) this.spawn(x + rng.range(-5, 5), y, { frame: 'bonebit', vx: rng.range(-60, 60), vy: rng.range(-110, -50), g: 320, life: rng.range(0.5, 0.9), spin: true });
  }
  debris(x: number, y: number, n = 8): void {
    for (let i = 0; i < n; i++) this.spawn(x + rng.range(-7, 7), y, { frame: rng.next() < 0.5 ? 'debris' : 'p2', tint: rng.next() < 0.5 ? 0xffffff : 0x9a8fae, vx: rng.range(-70, 70), vy: rng.range(-120, -40), g: 360, life: rng.range(0.4, 0.8), spin: true });
  }
  splash(x: number, y: number, n = 12): void {
    for (let i = 0; i < n; i++) this.spawn(x + rng.range(-5, 5), y, { frame: 'drop', vx: rng.range(-55, 55), vy: rng.range(-150, -60), g: 400, life: rng.range(0.4, 0.8) });
    this.puff(x, y - 2, 4, 4, KEY.a!);
  }
  confetti(x: number, y: number, n = 30): void {
    const cols = [KEY.r!, KEY.z!, KEY.j!, KEY.x!, KEY.c!, KEY.p!];
    for (let i = 0; i < n; i++) this.spawn(x + rng.range(-6, 6), y, { frame: rng.next() < 0.5 ? 'p2' : 'p1', tint: rng.pick(cols), vx: rng.range(-90, 90), vy: rng.range(-170, -60), g: 160, drag: 1.2, life: rng.range(0.9, 1.6), fade: true });
  }
  motes(x: number, y: number, tint: number): void {
    this.spawn(x, y, { frame: 'p1', tint, vx: rng.range(-3, 3), vy: rng.range(-10, -4), life: rng.range(1, 2), alpha: 0.8 });
  }
}
