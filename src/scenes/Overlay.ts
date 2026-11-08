// Top-most scene for screen transitions: a chunky pixel iris (rendered at 1/4 resolution) and hit flashes.
import Phaser from 'phaser';
import { KEY } from '../render/pixel/pal';

const W = 1280, H = 720, S = 4;

export class Overlay extends Phaser.Scene {
  private rt!: Phaser.GameObjects.RenderTexture;
  private hole!: Phaser.GameObjects.Graphics;
  private ring!: Phaser.GameObjects.Graphics;
  private state = { r: 2000, x: W / 2, y: H / 2 };
  private active = false;
  private flashRect!: Phaser.GameObjects.Rectangle;

  constructor() { super('Overlay'); }

  create(): void {
    this.rt = this.add.renderTexture(0, 0, W / S, H / S).setOrigin(0).setScale(S).setVisible(false);
    this.hole = this.make.graphics({}, false);
    this.ring = this.make.graphics({}, false);
    this.flashRect = this.add.rectangle(0, 0, W, H, 0xffffff, 0).setOrigin(0);
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

  /** White hit-flash over everything (two frames, pixel-art style). */
  flash(alpha = 0.7, duration = 140): void {
    this.tweens.killTweensOf(this.flashRect);
    this.flashRect.setFillStyle(0xfff6ea, alpha);
    this.tweens.add({ targets: this.flashRect, fillAlpha: 0, duration, ease: 'Stepped', easeParams: [3] });
  }

  cover(): void { this.active = true; this.state.r = 0; }

  override update(): void {
    this.rt.setVisible(this.active);
    if (!this.active) return;
    const x = Math.round(this.state.x / S), y = Math.round(this.state.y / S);
    const r = Math.max(0, Math.round(this.state.r / S));
    this.rt.clear();
    this.rt.fill(KEY.k!, 1);
    if (r > 0) {
      this.hole.clear().fillStyle(0xffffff, 1).fillCircle(x, y, r);
      this.rt.erase(this.hole);
      this.ring.clear().lineStyle(2, KEY.z!, 1).strokeCircle(x, y, r + 1).lineStyle(1, 0xffffff, 0.5).strokeCircle(x, y, r + 3);
      this.rt.draw(this.ring);
    }
  }
}
