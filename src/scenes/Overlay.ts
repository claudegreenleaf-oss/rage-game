// Top-most scene for screen transitions: a chunky pixel iris (rendered at 1/4 resolution) and hit flashes.
import Phaser from 'phaser';
import { KEY } from '../render/pixel/pal';

const W = 1280, H = 720, S = 4;

export type WipeSide = 'left' | 'right' | 'top' | 'bottom' | 'door' | 'start';

export class Overlay extends Phaser.Scene {
  private rt!: Phaser.GameObjects.RenderTexture;
  private hole!: Phaser.GameObjects.Graphics;
  private ring!: Phaser.GameObjects.Graphics;
  private state = { r: 2000, x: W / 2, y: H / 2 };
  private active = false;
  private flashRect!: Phaser.GameObjects.Rectangle;
  private wipeState = { p: 1, side: 'left' as WipeSide };
  private wiping = false;

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

  /** Room transition: start covered and reveal from the edge Pip came through, with a stepped edge. */
  wipe(side: WipeSide, duration = 260): void {
    this.scene.bringToTop();
    if (side === 'door' || side === 'start') { this.irisOpen(W / 2, H / 2, duration + 200); return; }
    this.tweens.killTweensOf(this.wipeState);
    this.wipeState.side = side; this.wipeState.p = 0;
    this.wiping = true;
    this.tweens.add({ targets: this.wipeState, p: 1, duration, ease: 'Quad.easeOut', onComplete: () => { this.wiping = false; } });
  }

  cover(): void { this.active = true; this.state.r = 0; }

  override update(): void {
    this.rt.setVisible(this.active || this.wiping);
    if (this.wiping && !this.active) { this.drawWipe(); return; }
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

  private drawWipe(): void {
    const w = W / S, h = H / S, { p, side } = this.wipeState;
    this.rt.clear();
    const g = this.hole.clear();
    const horiz = side === 'left' || side === 'right';
    const len = horiz ? w : h, across = horiz ? h : w;
    const edge = p * (len + 24);
    // Cover everything past the moving edge (with a stepped, 4-px-tall sawtooth for a pixel look).
    g.fillStyle(KEY.k!, 1);
    for (let i = 0; i < across; i += 4) {
      const jag = ((i / 4) % 3) * 4 + (((i / 4) * 7) % 5);
      const e = Math.round(edge - jag);
      if (e >= len) continue;
      const a = Math.max(0, e);
      if (side === 'left') g.fillRect(a, i, w - a, 4);
      else if (side === 'right') g.fillRect(0, i, w - a, 4);
      else if (side === 'top') g.fillRect(i, a, 4, h - a);
      else g.fillRect(i, 0, 4, h - a);
    }
    this.rt.draw(g);
  }
}
