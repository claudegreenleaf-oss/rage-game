// Act title card: iris wipe, the act name bouncing in letter by letter, one line from the sign,
// and Pip scampering across the floor.
import Phaser from 'phaser';
import { SignBubble, UI } from '../render/ui';
import { ATLAS } from '../render/pixel/sprites';
import { ptext } from '../render/pixel/font';
import { panelTex } from '../render/pixel/uitex';
import { ACT_PAL, KEY } from '../render/pixel/pal';
import { LEVELS, type ActInfo } from '../levels';
import { audio } from '../audio/sfx';
import { music } from '../audio/music';
import { groundTexture } from './Title';
import { musicFor, type GameData } from './Game';
import type { Backdrop } from './Backdrop';
import type { Overlay } from './Overlay';

const NUM = ['ZERO', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE'];
const S = 4;

export class ActCard extends Phaser.Scene {
  private act!: ActInfo;
  private index = 0;
  private leaving = false;
  private pip!: Phaser.GameObjects.Image;
  private t = 0;
  constructor() { super('ActCard'); }

  init(d: { act: ActInfo; index: number }): void { this.act = d.act; this.index = d.index; this.leaving = false; this.t = 0; }

  create(): void {
    (this.scene.get('Backdrop') as Backdrop).setMood(this.act.n);
    music.play(musicFor(LEVELS[this.index] ?? null, this.act.n));
    const pal = ACT_PAL[this.act.n] ?? ACT_PAL[3]!;
    groundTexture(this, 'titleGround', 21);
    this.add.image(0, 640 - 3 * S, 'titleGround').setOrigin(0).setScale(S);

    const card = this.add.image(640, 300, panelTex(this, 150, 70, 'paper')).setScale(UI).setScale(0);
    this.tweens.add({ targets: card, scale: UI, duration: 420, ease: 'Back.easeOut', delay: 150 });
    const small = ptext(this, 640, 222, `ACT ${NUM[this.act.n]}`, { scale: 3, color: 0x8a7a8f, origin: [0.5, 0.5] }).setAlpha(0);
    this.tweens.add({ targets: small, alpha: 1, duration: 300, delay: 450, ease: 'Stepped', easeParams: [3] });

    const word = this.act.name.toUpperCase();
    const scale = word.length > 5 ? 7 : 9;
    const adv = 8 * scale;
    let x = 640 - ((word.length - 1) * adv + 7 * scale) / 2;
    [...word].forEach((ch, i) => {
      if (ch === ' ') { x += adv; return; }
      const t = ptext(this, x, 292, ch, { scale, bold: true, color: pal.accent, origin: [0, 0.5] });
      const y0 = t.y;
      t.y = y0 - 260; t.setAlpha(0);
      this.tweens.add({ targets: t, y: y0, alpha: 1, duration: 600, delay: 600 + i * 70, ease: 'Bounce.easeOut', onStart: () => audio.play('pop', 1 + i * 0.06, 0.5) });
      this.tweens.add({ targets: t, y: y0 - scale, duration: 400, yoyo: true, repeat: -1, ease: 'Stepped', easeParams: [1], delay: 1600 + i * 110, repeatDelay: 1100 });
      x += adv;
    });

    const sign = new SignBubble(this, 21, 470);
    sign.setPosition(640, 470);
    sign.setContent(this.act.line);
    this.time.delayedCall(1300, () => { sign.show(); audio.play('tock'); });

    this.pip = this.add.image(-40, 640 - 3 * S, ATLAS, 'pip_run0').setOrigin(0.5, 1).setScale(S);
    const lvl = LEVELS[this.index];
    ptext(this, 640, 676, lvl ? `level ${this.index + 1} · ${lvl.name}` : '', { scale: 3, outline: true, color: 0xfff4e4, origin: [0.5, 0.5] });
    const any = ptext(this, 640, 704, 'press any key', { scale: 2, outline: true, color: KEY.z!, origin: [0.5, 0.5] });
    this.tweens.add({ targets: any, alpha: 0.3, duration: 500, yoyo: true, repeat: -1, ease: 'Stepped', easeParams: [1] });

    (this.scene.get('Overlay') as Overlay).irisOpen(640, 300, 700);
    this.time.delayedCall(3800, () => this.leave());
    this.time.delayedCall(500, () => {
      this.input.keyboard?.once('keydown', () => this.leave());
      this.input.once('pointerdown', () => this.leave());
    });
  }

  override update(_t: number, dms: number): void {
    this.t += dms / 1000;
    const x = -40 + ((this.t * 220) % 1400);
    this.pip.setPosition(Math.round(x / S) * S, 640 - 3 * S).setFrame(`pip_run${Math.floor(this.t * 12) % 4}`);
  }

  private leave(): void {
    if (this.leaving) return;
    this.leaving = true;
    const level = LEVELS[this.index];
    if (!level) { this.scene.start('Title'); return; }
    (this.scene.get('Overlay') as Overlay).irisClose(640, 300, 500, () => this.scene.start('Game', { level, mode: 'play', index: this.index } satisfies GameData));
  }
}
