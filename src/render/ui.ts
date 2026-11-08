// Shared UI pieces: text styles, chunky buttons, wooden sign bubbles.
import Phaser from 'phaser';
import { C, FONT, hex } from './palette';
import { audio } from '../audio/sfx';

export function textStyle(size: number, color: number = C.ink, extra: Phaser.Types.GameObjects.Text.TextStyle = {}): Phaser.Types.GameObjects.Text.TextStyle {
  return { fontFamily: FONT, fontSize: `${size}px`, color: hex(color), fontStyle: '600', ...extra };
}

export function dpr(): number {
  return Math.min(2, (globalThis.devicePixelRatio as number | undefined) ?? 1);
}

export interface ButtonOpts {
  w?: number;
  h?: number;
  size?: number;
  color?: number;
  locked?: boolean;
  icon?: string;
}

/** Chunky rounded button with hover/press tweens and a drop "shelf" shadow. */
export class Button extends Phaser.GameObjects.Container {
  private bg: Phaser.GameObjects.Graphics;
  private label: Phaser.GameObjects.Text;
  private bw: number;
  private bh: number;
  private color: number;
  focused = false;
  locked: boolean;
  private pressT = 0;

  constructor(scene: Phaser.Scene, x: number, y: number, text: string, public onClick: () => void, opts: ButtonOpts = {}) {
    super(scene, x, y);
    this.bw = opts.w ?? 260;
    this.bh = opts.h ?? 58;
    this.color = opts.color ?? C.pip;
    this.locked = !!opts.locked;
    this.bg = scene.add.graphics();
    this.label = scene.add.text(0, -2, text, textStyle(opts.size ?? 26, C.ink, { fontStyle: '700' })).setOrigin(0.5).setResolution(dpr());
    this.add([this.bg, this.label]);
    this.setSize(this.bw, this.bh + 8);
    this.setInteractive({ useHandCursor: true });
    this.on('pointerover', () => this.emit('focusme'));
    this.on('pointerdown', () => { this.pressT = 1; this.redraw(); });
    this.on('pointerup', () => this.activate());
    this.on('pointerout', () => { this.pressT = 0; this.redraw(); });
    this.redraw();
    scene.add.existing(this);
  }

  setText(t: string): this { this.label.setText(t); return this; }

  setFocus(f: boolean): void {
    if (f === this.focused) return;
    this.focused = f;
    this.scene.tweens.add({ targets: this, scale: f ? 1.06 : 1, duration: 160, ease: 'Back.easeOut' });
    if (f) audio.play('menu', 1, 0.8);
    this.redraw();
  }

  activate(): void {
    this.pressT = 0;
    this.redraw();
    if (this.locked) {
      audio.play('tock', 0.6);
      this.scene.tweens.add({ targets: this, x: this.x + 6, duration: 50, yoyo: true, repeat: 3 });
      return;
    }
    audio.play('select');
    this.scene.tweens.add({ targets: this, scaleX: 1.12, scaleY: 0.9, duration: 70, yoyo: true, ease: 'Quad.easeOut', onComplete: () => this.onClick() });
  }

  redraw(): void {
    const g = this.bg, w = this.bw, h = this.bh;
    const press = this.pressT ? 4 : 0;
    g.clear();
    g.fillStyle(C.outline, 1);
    g.fillRoundedRect(-w / 2 - 3, -h / 2 - 3 + press, w + 6, h + 6 + 6 - press, 20);
    const fill = this.locked ? 0xd9cfc4 : this.focused ? C.gold : this.color;
    g.fillStyle(fill, 1);
    g.fillRoundedRect(-w / 2, -h / 2 + press, w, h, 17);
    g.fillStyle(0xffffff, this.locked ? 0.25 : 0.45);
    g.fillRoundedRect(-w / 2 + 10, -h / 2 + 5 + press, w - 20, 9, 5);
    g.fillStyle(0x000000, 0.08);
    g.fillRoundedRect(-w / 2 + 4, h / 2 - 12 + press, w - 8, 8, 5);
    this.label.setY(-2 + press);
    this.label.setColor(hex(this.locked ? 0x8d8296 : C.ink));
  }
}

export interface Focusable extends Phaser.GameObjects.Container {
  focused: boolean;
  setFocus(f: boolean): void;
  activate(): void;
  redraw(): void;
}

/** Keyboard + mouse navigation over a vertical/horizontal list of buttons. */
export class Menu {
  index = 0;
  constructor(private scene: Phaser.Scene, public buttons: Focusable[], private cols = 1) {
    buttons.forEach((b, i) => b.on('focusme', () => this.focus(i)));
    this.focus(0, true);
    const kb = scene.input.keyboard;
    kb?.on('keydown', this.onKey, this);
    scene.events.once('shutdown', () => kb?.off('keydown', this.onKey, this));
  }
  focus(i: number, silent = false): void {
    this.index = (i + this.buttons.length) % this.buttons.length;
    this.buttons.forEach((b, j) => { if (silent && j === this.index) { b.focused = true; b.setScale(1.06); b.redraw(); } else b.setFocus(j === this.index); });
  }
  private onKey(e: KeyboardEvent): void {
    if (!this.scene.scene.isActive()) return;
    const k = e.key;
    if (k === 'ArrowDown' || k === 's' || k === 'S') this.focus(this.index + this.cols);
    else if (k === 'ArrowUp' || k === 'w' || k === 'W') this.focus(this.index - this.cols);
    else if ((k === 'ArrowRight' || k === 'd' || k === 'D') && this.cols > 1) this.focus(this.index + 1);
    else if ((k === 'ArrowLeft' || k === 'a' || k === 'A') && this.cols > 1) this.focus(this.index - 1);
    else if (k === 'Enter' || k === ' ') this.buttons[this.index]?.activate();
  }
}

/** Draws a wooden sign board (rounded, outlined, with grain) centred on (0,0). */
export function drawBoard(g: Phaser.GameObjects.Graphics, w: number, h: number, tail = true): void {
  g.clear();
  g.fillStyle(0x000000, 0.14);
  g.fillRoundedRect(-w / 2 + 3, -h / 2 + 6, w, h, 12);
  if (tail) {
    g.fillStyle(C.outline, 1);
    g.fillTriangle(-9, h / 2 - 2, 9, h / 2 - 2, 0, h / 2 + 12);
  }
  g.fillStyle(C.outline, 1);
  g.fillRoundedRect(-w / 2 - 3, -h / 2 - 3, w + 6, h + 6, 13);
  g.fillStyle(C.wood, 1);
  g.fillRoundedRect(-w / 2, -h / 2, w, h, 10);
  if (tail) {
    g.fillStyle(C.wood, 1);
    g.fillTriangle(-5.5, h / 2 - 3, 5.5, h / 2 - 3, 0, h / 2 + 7);
  }
  g.fillStyle(C.woodLight, 1);
  g.fillRoundedRect(-w / 2 + 5, -h / 2 + 4, w - 10, 5, 3);
  g.fillStyle(C.woodDark, 0.35);
  for (let y = -h / 2 + 15; y < h / 2 - 6; y += 11) g.fillRoundedRect(-w / 2 + 10, y, w - 20, 1.6, 1);
  g.fillStyle(C.woodDark, 1);
  g.fillCircle(-w / 2 + 8, 0, 2.2);
  g.fillCircle(w / 2 - 8, 0, 2.2);
}

/** A wooden speech board with wrapped text; pops with an overshoot tween. */
export class SignBubble extends Phaser.GameObjects.Container {
  private g: Phaser.GameObjects.Graphics;
  private t: Phaser.GameObjects.Text;
  private current = '';
  shown = false;

  constructor(scene: Phaser.Scene, private screenSize: number, private maxW: number) {
    super(scene, 0, 0);
    this.g = scene.add.graphics();
    this.t = scene.add.text(0, 0, '', textStyle(screenSize, C.ink, { fontStyle: '600', align: 'center' })).setOrigin(0.5);
    this.add([this.g, this.t]);
    this.setScale(0);
    this.setVisible(false);
    scene.add.existing(this);
  }

  /** `zoom` lets world-space bubbles keep a constant on-screen size. */
  setContent(text: string, zoom = 1): void {
    if (text === this.current && this.t.style.resolution === zoom * dpr()) return;
    this.current = text;
    const size = this.screenSize / zoom;
    this.t.setFontSize(size).setResolution(zoom * dpr());
    this.t.setWordWrapWidth(this.maxW / zoom, true).setText(text);
    const pad = 12 / zoom;
    const w = Math.max(this.t.width + pad * 2.2, 40 / zoom), h = this.t.height + pad * 1.5;
    this.g.setScale(1 / zoom);
    drawBoard(this.g, w * zoom, h * zoom);
    this.t.setY(-1 / zoom);
  }

  show(): void {
    if (this.shown) return;
    this.shown = true;
    this.setVisible(true);
    this.scene.tweens.killTweensOf(this);
    this.scene.tweens.add({ targets: this, scale: 1, duration: 320, ease: 'Back.easeOut', easeParams: [2.2] });
  }

  hide(): void {
    if (!this.shown) return;
    this.shown = false;
    this.scene.tweens.killTweensOf(this);
    this.scene.tweens.add({ targets: this, scale: 0, duration: 160, ease: 'Back.easeIn', onComplete: () => this.setVisible(false) });
  }

  wobble(): void {
    this.scene.tweens.add({ targets: this, angle: { from: -6, to: 0 }, duration: 380, ease: 'Elastic.easeOut' });
  }
}
