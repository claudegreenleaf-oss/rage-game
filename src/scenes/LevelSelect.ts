// Chambers (quick play): one row of four cards per act. Each card shows name, lock state and best (fewest) deaths.
import Phaser from 'phaser';
import { Menu, UI, type Focusable } from '../render/ui';
import { ATLAS } from '../render/pixel/sprites';
import { ptext } from '../render/pixel/font';
import { panelTex } from '../render/pixel/uitex';
import { ACT_PAL, KEY } from '../render/pixel/pal';
import { LEVELS } from '../levels';
import { progress } from '../progress';
import { audio } from '../audio/sfx';
import { music } from '../audio/music';
import { ACTS, startLevel } from './Game';
import type { Backdrop } from './Backdrop';
import type { Overlay } from './Overlay';

const ROWS = Math.max(1, Math.ceil(LEVELS.length / 4));
const CW = 70, CH = ROWS > 3 ? 36 : 44; // UI pixels
const ROW_GAP = ROWS > 3 ? 124 : 162;
const ROW_Y = ROWS > 3 ? 180 : 214;

class Card extends Phaser.GameObjects.Container implements Focusable {
  focused = false;
  private bg: Phaser.GameObjects.Image;
  private band: Phaser.GameObjects.Image;
  private baseY: number;
  constructor(scene: Phaser.Scene, x: number, y: number, private idx: number, private onPick: (i: number) => void) {
    super(scene, x, y);
    this.baseY = y;
    const lvl = LEVELS[idx];
    const unlocked = this.unlocked;
    const best = lvl ? progress.get().best[lvl.id] : undefined;
    this.bg = scene.add.image(0, 0, panelTex(scene, CW, CH, unlocked ? 'paper' : 'slotEmpty')).setScale(UI);
    this.band = scene.add.image(0, -(CH / 2 - 5) * UI, ATLAS, 'p1').setDisplaySize((CW - 4) * UI, 4 * UI).setTint((ACT_PAL[Math.floor(idx / 4) + 1] ?? ACT_PAL[4]!).accent);
    this.add([this.bg, this.band]);
    this.add(ptext(scene, -(CW / 2 - 5) * UI, -(CH / 2 - 11) * UI, String(idx + 1).padStart(2, '0'), { scale: 3, color: unlocked ? KEY.k! : 0x9a8f9e, origin: [0, 0.5] }));
    if (lvl && unlocked) {
      this.add(ptext(scene, 0, (CH > 40 ? 2 : 1) * UI, lvl.name, { scale: 3, origin: [0.5, 0.5], align: 'center', wrap: (CW - 8) * UI }));
      if (best !== undefined) {
        this.add(scene.add.image(-6 * UI, (CH / 2 - 8) * UI, ATLAS, 'skull').setScale(2));
        this.add(ptext(scene, -1 * UI, (CH / 2 - 8) * UI, `${best}`, { scale: 2, origin: [0, 0.5] }));
        this.add(scene.add.image((CW / 2 - 8) * UI, -(CH / 2 - 11) * UI, ATLAS, 'check').setScale(UI));
      } else this.add(ptext(scene, 0, (CH / 2 - 8) * UI, 'new', { scale: 2, color: 0x9a8f9e, origin: [0.5, 0.5] }));
    } else this.add(scene.add.image(0, 3 * UI, ATLAS, 'lock').setScale(UI));
    this.setSize(CW * UI, CH * UI);
    this.setInteractive({ useHandCursor: unlocked });
    this.on('pointerover', () => this.emit('focusme'));
    this.on('pointerup', () => this.activate());
    scene.add.existing(this);
  }
  get unlocked(): boolean { return progress.isUnlocked(this.idx) && !!LEVELS[this.idx]; }
  setFocus(f: boolean): void {
    if (f === this.focused) return;
    this.focused = f;
    if (f) audio.play('menu', 1 + (this.idx % 4) * 0.05, 0.7);
    this.redraw();
  }
  activate(): void {
    if (!this.unlocked) { audio.play('tock', 0.6); this.scene.tweens.add({ targets: this, x: this.x + 2 * UI, duration: 40, yoyo: true, repeat: 3 }); return; }
    audio.play('select');
    this.onPick(this.idx);
  }
  redraw(): void {
    this.bg.setTexture(panelTex(this.scene, CW, CH, !this.unlocked ? 'slotEmpty' : this.focused ? 'btnHot' : 'paper'));
    this.y = this.baseY - (this.focused ? UI * 2 : 0);
  }
}

export class LevelSelect extends Phaser.Scene {
  constructor() { super('LevelSelect'); }

  create(): void {
    (this.scene.get('Backdrop') as Backdrop).setMood(0);
    music.play(0);
    ptext(this, 640, 64, 'Chambers', { scale: 6, bold: true, color: 0xfff4e4, origin: [0.5, 0.5] });
    const cards: Card[] = [];
    for (let row = 0; row < ROWS; row++) {
      const a = ACTS[row];
      const y = ROW_Y + row * ROW_GAP;
      ptext(this, 148, y - (ROWS > 3 ? 30 : 18), `ACT ${a?.n ?? row + 1}`, { scale: 2, outline: true, color: KEY.z!, origin: [0.5, 0.5] });
      if (a) ptext(this, 148, y + (ROWS > 3 ? 4 : 10), a.name, { scale: 3, outline: true, color: 0xfff4e4, origin: [0.5, 0.5], align: 'center', wrap: 240 });
      for (let col = 0; col < 4; col++) {
        const idx = row * 4 + col;
        if (idx >= LEVELS.length) break;
        const c = new Card(this, 390 + col * 234, y, idx, (i) => this.pick(i));
        c.setAlpha(0);
        this.tweens.add({ targets: c, alpha: 1, duration: 240, delay: 60 + idx * 35, ease: 'Stepped', easeParams: [3] });
        cards.push(c);
      }
    }
    const menu = new Menu(this, cards, 4);
    menu.focus(Math.max(0, Math.min(progress.get().unlocked, LEVELS.length - 1)));
    const back = ptext(this, 28, 690, '← esc  back', { scale: 3, outline: true, color: 0xfff4e4, origin: [0, 0.5] }).setInteractive({ useHandCursor: true });
    back.on('pointerup', () => this.back());
    this.input.keyboard?.on('keydown-ESC', () => this.back());
    this.input.keyboard?.on('keydown-BACKSPACE', () => this.back());
    (this.scene.get('Overlay') as Overlay).irisOpen(640, 360, 600);
  }

  private back(): void {
    audio.play('menu', 0.8);
    (this.scene.get('Overlay') as Overlay).irisClose(640, 360, 400, () => this.scene.start('Title'));
  }

  private pick(i: number): void {
    (this.scene.get('Overlay') as Overlay).irisClose(640, 360, 450, () => startLevel(this, i));
  }
}
