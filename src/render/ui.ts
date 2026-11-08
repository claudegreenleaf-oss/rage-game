// Shared pixel UI pieces: chunky buttons, keyboard/mouse menus, wooden sign bubbles.
import Phaser from 'phaser';
import { C, FONT, hex } from './palette';
import { audio } from '../audio/sfx';
import { ptext } from './pixel/font';
import { PHOSPHOR, panelTex, type PanelStyle } from './pixel/uitex';
import { KEY } from './pixel/pal';

/** Screen pixels per UI pixel. */
export const UI = 3;

/** Kept for DOM-free callers that still want a CSS font style. */
export function textStyle(size: number, color: number = C.ink, extra: Phaser.Types.GameObjects.Text.TextStyle = {}): Phaser.Types.GameObjects.Text.TextStyle {
  return { fontFamily: FONT, fontSize: `${size}px`, color: hex(color), ...extra };
}

export function dpr(): number { return 1; }

export interface ButtonOpts {
  w?: number;
  h?: number;
  size?: number;
  color?: number;
  locked?: boolean;
  icon?: string;
}

const styleFor = (color: number | undefined): PanelStyle =>
  color === C.hazard ? 'btnRed' : color === C.rot ? 'btnGreen' : color === C.paper ? 'paper' : 'btn';

/** Chunky pixel button: lifts a pixel and turns gold when focused, sinks when pressed. */
export class Button extends Phaser.GameObjects.Container {
  private bg: Phaser.GameObjects.Image;
  private label: Phaser.GameObjects.BitmapText;
  private uw: number;
  private uh: number;
  private style: PanelStyle;
  focused = false;
  locked: boolean;
  private pressed = false;
  private baseY: number;

  constructor(scene: Phaser.Scene, x: number, y: number, text: string, public onClick: () => void, opts: ButtonOpts = {}) {
    super(scene, Math.round(x), Math.round(y));
    this.baseY = Math.round(y);
    this.uw = Math.round((opts.w ?? 264) / UI);
    this.uh = Math.round((opts.h ?? 57) / UI);
    this.style = styleFor(opts.color);
    this.locked = !!opts.locked;
    this.bg = scene.add.image(0, 0, panelTex(scene, this.uw, this.uh, this.style)).setScale(UI).setOrigin(0.5, 0.5);
    const scale = Math.max(2, Math.round((opts.size ?? 26) / 9));
    this.label = ptext(scene, 0, 0, text, { scale, color: KEY.k!, origin: [0.5, 0.5] });
    this.add([this.bg, this.label]);
    this.setSize(this.uw * UI, this.uh * UI);
    this.setInteractive({ useHandCursor: true });
    this.on('pointerover', () => this.emit('focusme'));
    this.on('pointerdown', () => { this.pressed = true; this.redraw(); });
    this.on('pointerup', () => this.activate());
    this.on('pointerout', () => { this.pressed = false; this.redraw(); });
    this.redraw();
    scene.add.existing(this);
  }

  override setY(y: number): this { this.baseY = Math.round(y); super.setY(Math.round(y)); return this; }
  setText(t: string): this { this.label.setText(t); return this; }

  setFocus(f: boolean): void {
    if (f === this.focused) return;
    this.focused = f;
    if (f) audio.play('menu', 1, 0.8);
    this.redraw();
  }

  activate(): void {
    this.pressed = false;
    this.redraw();
    if (this.locked) {
      audio.play('tock', 0.6);
      this.scene.tweens.add({ targets: this, x: this.x + UI * 2, duration: 40, yoyo: true, repeat: 3 });
      return;
    }
    audio.play('select');
    this.pressed = true;
    this.redraw();
    this.scene.time.delayedCall(90, () => { this.pressed = false; this.redraw(); this.onClick(); });
  }

  redraw(): void {
    const st: PanelStyle = this.locked ? 'btnLocked' : this.focused ? 'btnHot' : this.style;
    this.bg.setTexture(panelTex(this.scene, this.uw, this.uh, st));
    const lift = this.pressed ? UI : this.focused ? -UI : 0;
    this.bg.y = lift;
    this.label.y = lift - UI;
    this.label.setTint(this.locked ? 0x7d7287 : KEY.k!);
    super.setY(this.baseY);
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
    this.buttons.forEach((b, j) => { if (silent && j === this.index) { b.focused = true; b.redraw(); } else b.setFocus(j === this.index); });
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

/** A wooden speech board with wrapped pixel text; pops with an overshoot. */
export class SignBubble extends Phaser.GameObjects.Container {
  private panel: Phaser.GameObjects.Image;
  private t: Phaser.GameObjects.BitmapText;
  private current = '';
  private s: number;
  shown = false;

  constructor(scene: Phaser.Scene, screenSize: number, private maxW: number) {
    super(scene, 0, 0);
    this.s = Math.max(2, Math.round(screenSize / 7));
    this.panel = scene.add.image(0, 0, panelTex(scene, 20, 10, 'crt', true)).setOrigin(0.5, 1).setScale(this.s);
    this.t = scene.add.bitmapText(0, 0, 'pf', '', this.s).setOrigin(0.5, 0.5).setCenterAlign().setTint(PHOSPHOR);
    this.add([this.panel, this.t]);
    this.setScale(0);
    this.setVisible(false);
    scene.add.existing(this);
  }

  setContent(text: string, _zoom = 1): void {
    if (text === this.current) return;
    this.current = text;
    this.t.setMaxWidth(this.maxW).setText(text);
    const uw = Math.round(this.t.width / this.s) + 12, uh = Math.round(this.t.height / this.s) + 8;
    this.panel.setTexture(panelTex(this.scene, uw | 1, uh, 'crt', true));
    this.t.setY(-Math.round((uh / 2 + 4) * this.s) + this.s);
  }

  show(): void {
    if (this.shown) return;
    this.shown = true;
    this.setVisible(true);
    this.scene.tweens.killTweensOf(this);
    this.scene.tweens.add({ targets: this, scale: 1, duration: 280, ease: 'Back.easeOut', easeParams: [2.2] });
  }

  hide(): void {
    if (!this.shown) return;
    this.shown = false;
    this.scene.tweens.killTweensOf(this);
    this.scene.tweens.add({ targets: this, scale: 0, duration: 140, ease: 'Quad.easeIn', onComplete: () => this.setVisible(false) });
  }

  wobble(): void {
    this.scene.tweens.add({ targets: this, y: this.y - this.s * 2, duration: 90, yoyo: true, ease: 'Quad.easeOut' });
  }
}

/** A pixel panel image of a given screen size (rounded to UI pixels). */
export function panel(scene: Phaser.Scene, x: number, y: number, w: number, h: number, style: PanelStyle = 'paper', scale = UI): Phaser.GameObjects.Image {
  return scene.add.image(Math.round(x), Math.round(y), panelTex(scene, Math.round(w / scale), Math.round(h / scale), style)).setScale(scale);
}
