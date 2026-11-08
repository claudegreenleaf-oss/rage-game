// Level select: 3 acts x 4 levels. Each card shows name, lock state and best (fewest) deaths.
import Phaser from 'phaser';
import { C, hex } from '../render/palette';
import { Menu, textStyle, dpr, type Focusable } from '../render/ui';
import { ACTS, LEVELS } from '../levels';
import { progress } from '../progress';
import { audio } from '../audio/sfx';
import { music } from '../audio/music';
import { startLevel } from './Game';
import { drawSkull } from './Hud';
import type { Backdrop } from './Backdrop';
import type { Overlay } from './Overlay';

const ACT_COL = [C.pip, C.rot, 0xc9b2d6];
const CW = 216, CH = 132;

class Card extends Phaser.GameObjects.Container implements Focusable {
  focused = false;
  private bg: Phaser.GameObjects.Graphics;
  constructor(scene: Phaser.Scene, x: number, y: number, private idx: number, private onPick: (i: number) => void) {
    super(scene, x, y);
    const lvl = LEVELS[idx];
    const unlocked = progress.isUnlocked(idx);
    const best = lvl ? progress.get().best[lvl.id] : undefined;
    this.bg = scene.add.graphics();
    this.add(this.bg);
    const num = scene.add.text(-CW / 2 + 30, -CH / 2 + 30, String(idx + 1), textStyle(28, C.ink, { fontStyle: '700' })).setOrigin(0.5).setResolution(dpr());
    this.add(num);
    if (lvl && unlocked) {
      this.add(scene.add.text(0, 6, lvl.name, textStyle(23, C.ink, { fontStyle: '700', align: 'center', wordWrap: { width: CW - 24 } })).setOrigin(0.5).setResolution(dpr()));
      const sk = scene.add.graphics();
      if (best !== undefined) {
        drawSkull(sk, -18, CH / 2 - 26, 8);
        this.add(sk);
        this.add(scene.add.text(-4, CH / 2 - 26, `${best}`, textStyle(20, C.ink, { fontStyle: '700' })).setOrigin(0, 0.5).setResolution(dpr()));
        const star = scene.add.text(CW / 2 - 22, -CH / 2 + 28, '✓', textStyle(22, 0x3d8f4e, { fontStyle: '700' })).setOrigin(0.5).setResolution(dpr());
        this.add(star);
      } else {
        this.add(scene.add.text(0, CH / 2 - 26, 'new', textStyle(17, C.ink)).setOrigin(0.5).setAlpha(0.5).setResolution(dpr()));
      }
    } else {
      const lock = scene.add.graphics();
      lock.fillStyle(C.outline, 1); lock.fillRoundedRect(-17, -2, 34, 28, 6);
      lock.lineStyle(6, C.outline, 1); lock.beginPath(); lock.arc(0, -2, 11, Math.PI, 0); lock.strokePath();
      lock.fillStyle(0xbdb2c4, 1); lock.fillRoundedRect(-13.5, 1.5, 27, 21, 4);
      lock.fillStyle(C.outline, 1); lock.fillCircle(0, 10, 3.5);
      this.add(lock);
      num.setAlpha(0.4);
    }
    this.setSize(CW, CH);
    this.setInteractive({ useHandCursor: unlocked });
    this.on('pointerover', () => this.emit('focusme'));
    this.on('pointerup', () => this.activate());
    this.redraw();
    scene.add.existing(this);
  }
  get unlocked(): boolean { return progress.isUnlocked(this.idx) && !!LEVELS[this.idx]; }
  setFocus(f: boolean): void {
    if (f === this.focused) return;
    this.focused = f;
    this.scene.tweens.add({ targets: this, scale: f ? 1.07 : 1, angle: f ? (this.idx % 2 ? 1.2 : -1.2) : 0, duration: 200, ease: 'Back.easeOut' });
    if (f) audio.play('menu', 1 + (this.idx % 4) * 0.05, 0.7);
    this.redraw();
  }
  activate(): void {
    if (!this.unlocked) { audio.play('tock', 0.6); this.scene.tweens.add({ targets: this, x: this.x + 6, duration: 45, yoyo: true, repeat: 3 }); return; }
    audio.play('select');
    this.onPick(this.idx);
  }
  redraw(): void {
    const g = this.bg, act = Math.floor(this.idx / 4);
    g.clear();
    g.fillStyle(0x000000, 0.12); g.fillRoundedRect(-CW / 2 + 4, -CH / 2 + 9, CW, CH, 22);
    g.fillStyle(C.outline, 1); g.fillRoundedRect(-CW / 2 - 3, -CH / 2 - 3, CW + 6, CH + 6, 24);
    g.fillStyle(this.unlocked ? C.paper : 0xe3d9cf, 1); g.fillRoundedRect(-CW / 2, -CH / 2, CW, CH, 21);
    g.fillStyle(this.focused ? C.gold : ACT_COL[act]!, this.unlocked ? 1 : 0.5);
    g.fillRoundedRect(-CW / 2, -CH / 2, CW, 18, { tl: 21, tr: 21, bl: 0, br: 0 });
    g.fillStyle(C.outline, 1); g.fillCircle(-CW / 2 + 30, -CH / 2 + 30, 21);
    g.fillStyle(this.focused ? C.gold : ACT_COL[act]!, 1); g.fillCircle(-CW / 2 + 30, -CH / 2 + 30, 18);
    if (this.focused) { g.lineStyle(4, C.gold, 1); g.strokeRoundedRect(-CW / 2 - 9, -CH / 2 - 9, CW + 18, CH + 18, 28); }
  }
}

export class LevelSelect extends Phaser.Scene {
  constructor() { super('LevelSelect'); }

  create(): void {
    (this.scene.get('Backdrop') as Backdrop).setMood(0);
    music.play(0);
    const title = this.add.text(640, 62, 'Pick your poison', textStyle(48, C.ink, { fontStyle: '700', stroke: '#fbf3e4', strokeThickness: 10 })).setOrigin(0.5).setResolution(dpr());
    title.setScale(0.7); this.tweens.add({ targets: title, scale: 1, duration: 420, ease: 'Back.easeOut' });
    const cards: Card[] = [];
    ACTS.forEach((a, row) => {
      const y = 200 + row * 168;
      const label = this.add.text(150, y - 14, `ACT ${a.n}`, textStyle(18, C.ink, { fontStyle: '700' })).setOrigin(0.5).setAlpha(0.6).setResolution(dpr());
      const name = this.add.text(150, y + 14, a.name, textStyle(26, hex(ACT_COL[row]!) === '' ? C.ink : C.ink, { fontStyle: '700', align: 'center', wordWrap: { width: 170 } })).setOrigin(0.5).setResolution(dpr());
      void label; void name;
      for (let col = 0; col < 4; col++) {
        const idx = row * 4 + col;
        const c = new Card(this, 382 + col * 240, y, idx, (i) => this.pick(i));
        c.setAlpha(0).setY(y + 40);
        this.tweens.add({ targets: c, alpha: 1, y, duration: 420, delay: 80 + idx * 40, ease: 'Back.easeOut' });
        cards.push(c);
      }
    });
    const menu = new Menu(this, cards, 4);
    const firstOpen = Math.min(progress.get().unlocked, LEVELS.length - 1);
    menu.focus(Math.max(0, firstOpen));
    const back = this.add.text(40, 680, '← Esc  back', textStyle(20, C.ink, { fontStyle: '600' })).setOrigin(0, 0.5).setAlpha(0.7).setResolution(dpr()).setInteractive({ useHandCursor: true });
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
