// Pause menu over the game: Resume · Restart · (Map) · Chambers/Title · Sound.
import Phaser from 'phaser';
import type { Game } from './Game';
import { C } from '../render/palette';
import { Button, Menu, UI } from '../render/ui';
import { ptext } from '../render/pixel/font';
import { panelTex } from '../render/pixel/uitex';
import { KEY } from '../render/pixel/pal';
import { audio } from '../audio/sfx';

export class Pause extends Phaser.Scene {
  private game_!: Game;
  constructor() { super('Pause'); }
  init(d: { game: Game }): void { this.game_ = d.game; }

  create(): void {
    const dim = this.add.rectangle(640, 360, 1280, 720, KEY.k!, 0).setInteractive();
    this.tweens.add({ targets: dim, fillAlpha: 0.6, duration: 160, ease: 'Stepped', easeParams: [3] });
    const g = this.game_;
    const world = !!g.campaign;
    const n = world ? 5 : 4;
    const panel = this.add.container(640, world ? 400 : 380);
    panel.add(this.add.image(0, 0, panelTex(this, 128, 24 + n * 24 + 24, 'paper')).setScale(UI));
    const top = -((n - 1) * 72) / 2;
    panel.add(ptext(this, 0, -((24 + n * 24 + 24) * UI) / 2 - 40, 'Paused', { scale: 6, bold: true, color: 0xfff4e4, origin: [0.5, 0.5] }));
    const resume = () => this.close();
    const muteLabel = () => (audio.muted ? 'Sound: off' : 'Sound: on');
    const toTitle = () => { g.saveWorld(); this.scene.stop('Hud'); this.scene.stop('Game'); this.scene.stop(); this.scene.start('Title'); };
    const items: Array<[string, () => void, number?]> = [
      ['Resume', resume],
      ['Restart (R)', () => { this.close(); g.restartLevel(); }],
    ];
    if (world) items.push(['Map (Tab)', () => { this.scene.stop(); g.openMap(true); }, C.paper]);
    if (g.data_.mode === 'play') items.push(['Chambers', () => { this.scene.stop('Hud'); this.scene.stop('Game'); this.scene.stop(); this.scene.start('LevelSelect'); }, C.paper]);
    else items.push(['Title', toTitle, C.paper]);
    const btns = items.map(([label, fn, color], i) => new Button(this, 0, top + i * 72, label, fn, color !== undefined ? { color } : undefined));
    const mute = new Button(this, 0, top + items.length * 72, muteLabel(), () => { audio.toggleMute(); mute.setText(muteLabel()); }, { color: C.paper });
    btns.push(mute);
    panel.add(btns);
    panel.setScale(0.5).setAlpha(0);
    this.tweens.add({ targets: panel, scale: 1, alpha: 1, duration: 220, ease: 'Back.easeOut' });
    new Menu(this, btns);
    this.input.keyboard?.on('keydown-ESC', resume);
    this.input.keyboard?.on('keydown-P', resume);
    this.input.keyboard?.on('keydown-R', () => { this.close(); this.game_.restartLevel(); });
    this.input.keyboard?.on('keydown-M', () => { audio.toggleMute(); mute.setText(muteLabel()); });
  }

  private close(): void {
    this.scene.stop();
    this.scene.resume('Game');
  }
}
