// Lightweight particle system drawn into Graphics (one normal layer, one additive glow layer).
import type Phaser from 'phaser';
import { C } from './palette';
import { rng } from './rng';

type Shape = 'circle' | 'square' | 'tri' | 'bone' | 'ring' | 'spark' | 'star' | 'puff' | 'drop';

interface P {
  x: number; y: number; vx: number; vy: number;
  g: number; drag: number;
  life: number; max: number;
  s0: number; s1: number;
  color: number; outline: boolean;
  shape: Shape; rot: number; vr: number;
  add: boolean; a0: number;
  floor: number | null;
}

export class Particles {
  private ps: P[] = [];

  emit(p: Partial<P> & { x: number; y: number }): void {
    if (this.ps.length > 900) this.ps.shift();
    this.ps.push({
      vx: 0, vy: 0, g: 0, drag: 0.98, life: 0, max: 0.6, s0: 4, s1: 0, color: C.white, outline: false,
      shape: 'circle', rot: 0, vr: 0, add: false, a0: 1, floor: null, ...p,
    });
  }

  update(dt: number): void {
    for (const p of this.ps) {
      p.life += dt;
      p.vy += p.g * dt;
      const d = Math.pow(p.drag, dt * 60);
      p.vx *= d; p.vy *= d;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.rot += p.vr * dt;
      if (p.floor !== null && p.y > p.floor) { p.y = p.floor; p.vy *= -0.35; p.vx *= 0.7; p.vr *= 0.5; }
    }
    this.ps = this.ps.filter((p) => p.life < p.max);
  }

  draw(g: Phaser.GameObjects.Graphics, add: Phaser.GameObjects.Graphics): void {
    for (const p of this.ps) {
      const k = p.life / p.max;
      const s = p.s0 + (p.s1 - p.s0) * k;
      const a = p.a0 * (1 - k * k);
      const gg = p.add ? add : g;
      if (s <= 0.05 || a <= 0.01) continue;
      switch (p.shape) {
        case 'circle':
          if (p.outline) { gg.fillStyle(C.outline, a); gg.fillCircle(p.x, p.y, s + 2); }
          gg.fillStyle(p.color, a); gg.fillCircle(p.x, p.y, s); break;
        case 'puff':
          gg.fillStyle(C.outline, a * 0.9); gg.fillCircle(p.x, p.y, s + 2.2);
          gg.fillStyle(p.color, a); gg.fillCircle(p.x, p.y, s);
          gg.fillStyle(C.white, a * 0.6); gg.fillCircle(p.x - s * 0.3, p.y - s * 0.3, s * 0.4); break;
        case 'square':
          gg.save(); gg.translateCanvas(p.x, p.y); gg.rotateCanvas(p.rot);
          if (p.outline) { gg.fillStyle(C.outline, a); gg.fillRect(-s - 1.5, -s - 1.5, s * 2 + 3, s * 2 + 3); }
          gg.fillStyle(p.color, a); gg.fillRect(-s, -s, s * 2, s * 2); gg.restore(); break;
        case 'tri':
          gg.save(); gg.translateCanvas(p.x, p.y); gg.rotateCanvas(p.rot);
          gg.fillStyle(p.color, a); gg.fillTriangle(-s, s, s, s, 0, -s); gg.restore(); break;
        case 'bone':
          gg.save(); gg.translateCanvas(p.x, p.y); gg.rotateCanvas(p.rot);
          gg.fillStyle(C.outline, a); gg.fillRoundedRect(-s - 2, -2.8, s * 2 + 4, 5.6, 2.8);
          gg.fillCircle(-s, -1.6, 3.2); gg.fillCircle(-s, 1.6, 3.2); gg.fillCircle(s, -1.6, 3.2); gg.fillCircle(s, 1.6, 3.2);
          gg.fillStyle(C.bone, a); gg.fillRoundedRect(-s, -1.4, s * 2, 2.8, 1.4);
          gg.fillCircle(-s, -1.5, 1.8); gg.fillCircle(-s, 1.5, 1.8); gg.fillCircle(s, -1.5, 1.8); gg.fillCircle(s, 1.5, 1.8);
          gg.restore(); break;
        case 'ring':
          gg.lineStyle(Math.max(1, 3 * (1 - k)), p.color, a); gg.strokeEllipse(p.x, p.y, s * 2, s * 0.7); break;
        case 'spark': {
          const len = s * 3;
          const ang = Math.atan2(p.vy, p.vx);
          gg.lineStyle(Math.max(1, s * 0.7), p.color, a);
          gg.lineBetween(p.x, p.y, p.x - Math.cos(ang) * len, p.y - Math.sin(ang) * len); break;
        }
        case 'star':
          gg.save(); gg.translateCanvas(p.x, p.y); gg.rotateCanvas(p.rot);
          gg.fillStyle(p.color, a);
          gg.fillTriangle(-s * 0.3, 0, s * 0.3, 0, 0, -s); gg.fillTriangle(-s * 0.3, 0, s * 0.3, 0, 0, s);
          gg.fillTriangle(0, -s * 0.3, 0, s * 0.3, -s, 0); gg.fillTriangle(0, -s * 0.3, 0, s * 0.3, s, 0);
          gg.restore(); break;
        case 'drop':
          if (p.outline) { gg.fillStyle(C.outline, a); gg.fillCircle(p.x, p.y, s + 1.6); }
          gg.fillStyle(p.color, a); gg.fillCircle(p.x, p.y, s);
          gg.fillStyle(C.white, a * 0.7); gg.fillCircle(p.x - s * 0.3, p.y - s * 0.3, s * 0.35); break;
      }
    }
  }

  clear(): void { this.ps = []; }

  // ---- presets (world px) -------------------------------------------------

  dust(x: number, y: number, n = 6, dir = 0, color: number = C.paper): void {
    for (let i = 0; i < n; i++)
      this.emit({ x: x + rng.range(-8, 8), y: y - 2, vx: rng.range(-50, 50) + dir * rng.range(20, 70), vy: rng.range(-50, -10), g: 60, drag: 0.9, max: rng.range(0.35, 0.6), s0: rng.range(3, 5.5), s1: 0.5, color, shape: 'puff' });
  }
  puff(x: number, y: number, n = 10, r = 14, color: number = C.paper): void {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rng.range(-0.3, 0.3);
      this.emit({ x: x + Math.cos(a) * r * 0.3, y: y + Math.sin(a) * r * 0.3, vx: Math.cos(a) * rng.range(40, 110), vy: Math.sin(a) * rng.range(40, 100) - 20, drag: 0.88, max: rng.range(0.4, 0.7), s0: rng.range(5, 8), s1: 1, color, shape: 'puff' });
    }
  }
  bones(x: number, y: number, n = 6): void {
    for (let i = 0; i < n; i++)
      this.emit({ x, y, vx: rng.range(-140, 140), vy: rng.range(-260, -120), g: 900, drag: 0.99, max: rng.range(0.7, 1.1), s0: rng.range(3, 5), s1: rng.range(3, 5), shape: 'bone', rot: rng.range(0, 6), vr: rng.range(-14, 14), floor: y + 6 });
  }
  splash(x: number, y: number, n = 14): void {
    for (let i = 0; i < n; i++)
      this.emit({ x: x + rng.range(-10, 10), y, vx: rng.range(-120, 120), vy: rng.range(-280, -100), g: 900, drag: 0.99, max: rng.range(0.45, 0.8), s0: rng.range(2.5, 4.5), s1: 1.5, color: C.waterHi, outline: true, shape: 'drop' });
    for (let i = 0; i < 3; i++) this.emit({ x, y, max: 0.7 + i * 0.2, s0: 6 + i * 4, s1: 34 + i * 10, color: C.white, shape: 'ring', a0: 0.9 });
  }
  sparks(x: number, y: number, n = 10, color: number = C.laserCore): void {
    for (let i = 0; i < n; i++) {
      const a = rng.range(0, Math.PI * 2), sp = rng.range(120, 320);
      this.emit({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 500, drag: 0.93, max: rng.range(0.2, 0.45), s0: rng.range(1.5, 2.6), s1: 0.5, color, shape: 'spark', add: true });
    }
  }
  debris(x: number, y: number, n = 10, color: number = C.solidTop): void {
    for (let i = 0; i < n; i++)
      this.emit({ x: x + rng.range(-16, 16), y, vx: rng.range(-170, 170), vy: rng.range(-260, -60), g: 1000, drag: 0.99, max: rng.range(0.5, 0.9), s0: rng.range(2, 4), s1: 1.5, color, outline: true, shape: 'square', rot: rng.range(0, 6), vr: rng.range(-12, 12), floor: y + 2 });
  }
  sparkle(x: number, y: number, n = 8, color: number = C.gold): void {
    for (let i = 0; i < n; i++) {
      const a = rng.range(0, Math.PI * 2), sp = rng.range(30, 140);
      this.emit({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 30, drag: 0.92, max: rng.range(0.5, 0.9), s0: rng.range(4, 7), s1: 0, color, shape: 'star', rot: rng.range(0, 3), vr: rng.range(-4, 4), add: true });
    }
  }
  confetti(x: number, y: number, n = 40): void {
    const cols = [C.hazard, C.gold, C.plateOn, C.water, C.blush, C.pip];
    for (let i = 0; i < n; i++)
      this.emit({ x, y, vx: rng.range(-260, 260), vy: rng.range(-420, -150), g: 600, drag: 0.97, max: rng.range(0.9, 1.6), s0: rng.range(2.5, 4), s1: 2, color: rng.pick(cols), shape: 'square', rot: rng.range(0, 6), vr: rng.range(-16, 16) });
  }
  trickle(x: number, y: number): void {
    this.emit({ x: x + rng.range(-16, 16), y, vy: rng.range(20, 60), g: 400, max: 0.5, s0: rng.range(1.2, 2.2), s1: 0.8, color: C.solidTop, shape: 'square', rot: rng.range(0, 3) });
  }
  motes(x: number, y: number, color: number): void {
    this.emit({ x, y, vx: rng.range(-8, 8), vy: rng.range(-20, -6), drag: 1, max: rng.range(1.5, 3), s0: rng.range(1, 2.2), s1: 0, color, shape: 'circle', add: true, a0: 0.7 });
  }
}
