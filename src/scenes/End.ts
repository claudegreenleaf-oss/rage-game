// End screen: total deaths, best deaths per level, and a word from your bodies.
import Phaser from 'phaser';
import { Button, Menu, UI } from '../render/ui';
import { ATLAS } from '../render/pixel/sprites';
import { ptext } from '../render/pixel/font';
import { panelTex } from '../render/pixel/uitex';
import { KEY } from '../render/pixel/pal';
import { Pixels } from '../render/pixel/particles';
import { LEVELS } from '../levels';
import { progress } from '../progress';
import { music } from '../audio/music';
import type { Backdrop } from './Backdrop';
import type { Overlay } from './Overlay';

export class End extends Phaser.Scene {
  private pixels!: Pixels;
  constructor() { super('End'); }

  create(): void {
    (this.scene.get('Backdrop') as Backdrop).setMood(3);
    music.play(4);
    const p = progress.get();
    const title = ptext(this, 640, 86, 'Your bodies would like a word.', { scale: 4, bold: true, color: 0xfff4e4, origin: [0.5, 0.5] }).setAlpha(0);
    this.tweens.add({ targets: title, alpha: 1, y: { from: 60, to: 86 }, duration: 500, ease: 'Back.easeOut' });
    this.add.image(640, 362, panelTex(this, 248, 132, 'paper')).setScale(UI);
    this.add.image(560, 200, ATLAS, 'skull').setScale(4);
    ptext(this, 590, 200, `${p.totalDeaths} total deaths`, { scale: 4, origin: [0, 0.5] });
    LEVELS.forEach((l, i) => {
      const col = i % 2, row = Math.floor(i / 2);
      const x = 300 + col * 360, y = 262 + row * 40;
      const best = p.best[l.id];
      ptext(this, x, y, `${String(i + 1).padStart(2, '0')}  ${l.name}`, { scale: 3, origin: [0, 0.5] });
      ptext(this, x + 320, y, best === undefined ? '-' : `${best}`, { scale: 3, color: KEY.R!, origin: [1, 0.5] });
    });
    const btn = new Button(this, 640, 640, 'Back to title', () => (this.scene.get('Overlay') as Overlay).irisClose(640, 360, 500, () => this.scene.start('Title')));
    new Menu(this, [btn]);
    const layer = this.add.container(0, 0).setScale(4);
    this.pixels = new Pixels(this, layer, 200);
    this.time.addEvent({ delay: 700, loop: true, callback: () => this.pixels.confetti(Phaser.Math.Between(40, 280), 0, 16) });
    (this.scene.get('Overlay') as Overlay).irisOpen(640, 360, 800);
  }

  override update(_t: number, dms: number): void { this.pixels.update(dms / 1000); }
}
