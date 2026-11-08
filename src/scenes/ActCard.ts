// Act title card: iris wipe, the act name bouncing in letter by letter, one line from the sign.
import Phaser from 'phaser';
import { C, FONT, MOODS, hex } from '../render/palette';
import { SignBubble, textStyle, dpr } from '../render/ui';
import { defaultPose, drawPip } from '../render/draw-player';
import { LEVELS, type ActInfo } from '../levels';
import { audio } from '../audio/sfx';
import { music } from '../audio/music';
import type { GameData } from './Game';
import type { Backdrop } from './Backdrop';
import type { Overlay } from './Overlay';

const NUM = ['ZERO', 'ONE', 'TWO', 'THREE'];

export class ActCard extends Phaser.Scene {
  private act!: ActInfo;
  private index = 0;
  private leaving = false;
  private pip!: Phaser.GameObjects.Graphics;
  private t = 0;
  constructor() { super('ActCard'); }

  init(d: { act: ActInfo; index: number }): void { this.act = d.act; this.index = d.index; this.leaving = false; this.t = 0; }

  create(): void {
    (this.scene.get('Backdrop') as Backdrop).setMood(this.act.n);
    music.play(this.act.n);
    const mood = MOODS[this.act.n]!;
    const dim = this.add.rectangle(640, 360, 1280, 720, C.outline, 0.35);
    void dim;
    const disc = this.add.graphics();
    disc.fillStyle(mood.skyTop, 1); disc.fillCircle(640, 330, 290);
    disc.lineStyle(10, C.outline, 1); disc.strokeCircle(640, 330, 290);
    disc.lineStyle(4, C.gold, 1); disc.strokeCircle(640, 330, 302);
    disc.setScale(0);
    this.tweens.add({ targets: disc, scale: 1, duration: 700, ease: 'Back.easeOut', delay: 150 });

    const small = this.add.text(640, 210, `ACT ${NUM[this.act.n]}`, textStyle(28, C.ink, { fontStyle: '700' })).setOrigin(0.5).setAlpha(0).setResolution(dpr());
    this.tweens.add({ targets: small, alpha: 0.75, y: 200, duration: 500, delay: 450 });

    const word = this.act.name.toUpperCase();
    let size = 92;
    const style = (sz: number) => ({ fontFamily: FONT, fontSize: `${sz}px`, fontStyle: '700', color: hex(C.pip), stroke: '#2b2433', strokeThickness: Math.round(sz / 6) });
    const probe = this.add.text(0, 0, word, style(size)).setVisible(false);
    if (probe.width > 500) size = Math.floor(size * 500 / probe.width);
    probe.destroy();
    const st = style(size);
    const meas = this.add.text(0, 0, word, st).setVisible(false);
    let x = 640 - (meas.width - word.length * 6) / 2;
    meas.destroy();
    [...word].forEach((ch, i) => {
      if (ch === ' ') { x += size * 0.3; return; }
      const t = this.add.text(x, 300, ch, { ...st, color: hex(this.act.n === 1 ? C.hazard : this.act.n === 2 ? 0x6fbf8f : 0xb48cd1) }).setOrigin(0, 0.5).setResolution(dpr());
      x += t.width - 6;
      t.setScale(0).setAngle(-20);
      this.tweens.add({ targets: t, scale: 1, angle: 0, duration: 650, delay: 600 + i * 70, ease: 'Back.easeOut', easeParams: [3], onStart: () => audio.play('pop', 1 + i * 0.06, 0.5) });
      this.tweens.add({ targets: t, y: 290, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut', delay: 1400 + i * 90 });
    });

    const sign = new SignBubble(this, 22, 460);
    sign.setPosition(640, 430);
    sign.setContent(this.act.line);
    this.time.delayedCall(1300, () => { sign.show(); audio.play('tock'); });

    this.pip = this.add.graphics();
    const lvl = LEVELS[this.index];
    this.add.text(640, 668, lvl ? `Level ${this.index + 1} · ${lvl.name}` : '', textStyle(20, C.paper, { fontStyle: '600' })).setOrigin(0.5).setAlpha(0.8).setResolution(dpr());
    this.add.text(640, 698, 'press any key', textStyle(15, C.paper)).setOrigin(0.5).setAlpha(0.5).setResolution(dpr());

    (this.scene.get('Overlay') as Overlay).irisOpen(640, 330, 700);
    this.time.delayedCall(3800, () => this.leave());
    this.time.delayedCall(500, () => {
      this.input.keyboard?.once('keydown', () => this.leave());
      this.input.once('pointerdown', () => this.leave());
    });
  }

  override update(_t: number, dms: number): void {
    this.t += dms / 1000;
    const g = this.pip;
    g.clear();
    const p = defaultPose();
    const x = -60 + ((this.t * 150) % 1400);
    p.run = this.t * 22; p.runAmt = 1; p.lean = 0.12; p.lookX = 1;
    g.save(); g.translateCanvas(x, 620); g.scaleCanvas(1.6, 1.6);
    drawPip(g, 0, 0, p);
    g.restore();
  }

  private leave(): void {
    if (this.leaving) return;
    this.leaving = true;
    const level = LEVELS[this.index];
    if (!level) { this.scene.start('Title'); return; }
    (this.scene.get('Overlay') as Overlay).irisClose(640, 330, 500, () => this.scene.start('Game', { level, mode: 'play', index: this.index } satisfies GameData));
  }
}
