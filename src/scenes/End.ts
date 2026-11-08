// End screen: total deaths, best deaths per level, and a word from your bodies.
import Phaser from 'phaser';
import { C } from '../render/palette';
import { Button, Menu, textStyle, dpr } from '../render/ui';
import { LEVELS } from '../levels';
import { progress } from '../progress';
import { Particles } from '../render/fx';
import { drawSkull } from './Hud';
import { music } from '../audio/music';
import type { Backdrop } from './Backdrop';
import type { Overlay } from './Overlay';

export class End extends Phaser.Scene {
  private particles = new Particles();
  private fx!: Phaser.GameObjects.Graphics;
  private fxa!: Phaser.GameObjects.Graphics;
  constructor() { super('End'); }

  create(): void {
    (this.scene.get('Backdrop') as Backdrop).setMood(3);
    music.play(0);
    const p = progress.get();
    const title = this.add.text(640, 90, 'Your bodies would like a word.', textStyle(46, C.ink, { fontStyle: '700', stroke: '#fbf3e4', strokeThickness: 10 })).setOrigin(0.5).setResolution(dpr());
    title.setScale(0.6).setAlpha(0);
    this.tweens.add({ targets: title, scale: 1, alpha: 1, duration: 700, ease: 'Back.easeOut' });

    const panel = this.add.graphics();
    panel.fillStyle(C.outline, 1); panel.fillRoundedRect(270, 160, 740, 400, 30);
    panel.fillStyle(C.cream, 1); panel.fillRoundedRect(276, 166, 728, 388, 26);
    const sk = this.add.graphics();
    drawSkull(sk, 560, 214, 16);
    this.add.text(590, 214, `${p.totalDeaths} total deaths`, textStyle(34, C.ink, { fontStyle: '700' })).setOrigin(0, 0.5).setResolution(dpr());
    LEVELS.forEach((l, i) => {
      const col = i % 2, row = Math.floor(i / 2);
      const x = 320 + col * 350, y = 270 + row * 44;
      const best = p.best[l.id];
      this.add.text(x, y, `${String(i + 1).padStart(2, '0')}  ${l.name}`, textStyle(21, C.ink)).setOrigin(0, 0.5).setResolution(dpr());
      this.add.text(x + 300, y, best === undefined ? '—' : `${best}`, textStyle(21, C.ink, { fontStyle: '700' })).setOrigin(1, 0.5).setResolution(dpr());
    });
    const btn = new Button(this, 640, 625, 'Back to title', () => (this.scene.get('Overlay') as Overlay).irisClose(640, 360, 500, () => this.scene.start('Title')));
    new Menu(this, [btn]);
    this.fx = this.add.graphics();
    this.fxa = this.add.graphics().setBlendMode(Phaser.BlendModes.ADD);
    this.time.addEvent({ delay: 900, loop: true, callback: () => this.particles.confetti(Phaser.Math.Between(200, 1080), 0, 18) });
    (this.scene.get('Overlay') as Overlay).irisOpen(640, 360, 800);
  }

  override update(_t: number, dms: number): void {
    this.particles.update(dms / 1000);
    this.fx.clear(); this.fxa.clear();
    this.particles.draw(this.fx, this.fxa);
  }
}
