// Top-most scene for screen transitions: iris wipes (circle closing on a point) and fades.
import Phaser from 'phaser';
import { C } from '../render/palette';

const W = 1280, H = 720;

export class Overlay extends Phaser.Scene {
  private g!: Phaser.GameObjects.Graphics;
  private state = { r: 2000, x: W / 2, y: H / 2, a: 0 };
  private active = false;

  constructor() { super('Overlay'); }

  create(): void {
    this.g = this.add.graphics();
    this.scene.bringToTop();
  }

  /** Close the iris onto (x, y), then call `done`. */
  irisClose(x: number, y: number, duration = 650, done?: () => void): void {
    this.scene.bringToTop();
    this.tweens.killTweensOf(this.state);
    this.state.x = x; this.state.y = y;
    if (!this.active) this.state.r = Math.hypot(W, H);
    this.active = true;
    this.tweens.add({ targets: this.state, r: 0, duration, ease: 'Cubic.easeIn', onComplete: () => done?.() });
  }

  /** Open the iris from (x, y). */
  irisOpen(x: number, y: number, duration = 700, done?: () => void): void {
    this.scene.bringToTop();
    this.tweens.killTweensOf(this.state);
    this.state.x = x; this.state.y = y; this.state.r = 0;
    this.active = true;
    this.tweens.add({ targets: this.state, r: Math.hypot(W, H) * 1.05, duration, ease: 'Cubic.easeOut', onComplete: () => { this.active = false; done?.(); } });
  }

  /** Soft white hit-flash over everything. */
  flash(alpha = 0.6, duration = 160): void {
    const r = this.add.rectangle(W / 2, H / 2, W, H, 0xfffaf2, alpha).setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({ targets: r, alpha: 0, duration, ease: 'Quad.easeOut', onComplete: () => r.destroy() });
  }

  /** Close fully if needed (used between scenes when no iris point is known). */
  cover(): void { this.active = true; this.state.r = 0; }

  override update(): void {
    const g = this.g;
    g.clear();
    if (!this.active) return;
    const { x, y } = this.state;
    const r = Math.max(0, this.state.r);
    if (r <= 0.5) { g.fillStyle(C.outline, 1); g.fillRect(0, 0, W, H); return; }
    // Keyhole polygon: screen rectangle with a circular hole (earcut handles the bridge).
    const pts: Phaser.Types.Math.Vector2Like[] = [{ x: -10, y: -10 }, { x: W + 10, y: -10 }, { x: W + 10, y: H + 10 }, { x: -10, y: H + 10 }, { x: -10, y }, { x: x - r, y }];
    const n = 64;
    for (let i = 0; i <= n; i++) { const a = Math.PI - (i / n) * Math.PI * 2; pts.push({ x: x + Math.cos(a) * r, y: y - Math.sin(a) * r }); }
    pts.push({ x: x - r, y: y + 0.01 }, { x: -10, y: y + 0.01 });
    g.fillStyle(C.outline, 1);
    g.fillPoints(pts, true);
    g.lineStyle(6, C.gold, 0.9);
    g.strokeCircle(x, y, r + 3);
    g.lineStyle(3, C.white, 0.35);
    g.strokeCircle(x, y, r + 8);
  }
}
