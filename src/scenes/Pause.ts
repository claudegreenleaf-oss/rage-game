// Pause menu over the game: Resume · Restart · Level select · Mute.
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
    const panel = this.add.container(640, 380);
    panel.add(this.add.image(0, 0, panelTex(this, 128, 144, 'paper')).setScale(UI));
    panel.add(ptext(this, 0, -170, 'Paused', { scale: 6, bold: true, color: 0xfff4e4, origin: [0.5, 0.5] }));
    const resume = () => this.close();
    const muteLabel = () => (audio.muted ? 'Sound: off' : 'Sound: on');
    const btns = [
      new Button(this, 0, -92, 'Resume', resume),
      new Button(this, 0, -20, 'Restart (R)', () => { this.close(); this.game_.restartLevel(); }),
      new Button(this, 0, 52, 'Level select', () => { this.scene.stop('Hud'); this.scene.stop('Game'); this.scene.stop(); this.scene.start('LevelSelect'); }, { color: C.paper }),
    ];
    const mute = new Button(this, 0, 124, muteLabel(), () => { audio.toggleMute(); mute.setText(muteLabel()); }, { color: C.paper });
    btns.push(mute);
    if (this.game_.data_.mode !== 'play') {
      btns[2]!.setText('Title');
      btns[2]!.onClick = () => { this.scene.stop('Hud'); this.scene.stop('Game'); this.scene.stop(); this.scene.start('Title'); };
    }
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
