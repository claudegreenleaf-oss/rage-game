// Pause menu over the game: Resume · Restart · Level select · Mute.
import Phaser from 'phaser';
import type { Game } from './Game';
import { C } from '../render/palette';
import { Button, Menu, textStyle, dpr } from '../render/ui';
import { audio } from '../audio/sfx';

export class Pause extends Phaser.Scene {
  private game_!: Game;
  constructor() { super('Pause'); }
  init(d: { game: Game }): void { this.game_ = d.game; }

  create(): void {
    const dim = this.add.rectangle(640, 360, 1280, 720, C.outline, 0).setInteractive();
    this.tweens.add({ targets: dim, fillAlpha: 0.55, duration: 200 });
    const panel = this.add.container(640, 380);
    const g = this.add.graphics();
    g.fillStyle(C.outline, 1); g.fillRoundedRect(-200, -210, 400, 430, 32);
    g.fillStyle(C.cream, 1); g.fillRoundedRect(-194, -204, 388, 412, 28);
    g.fillStyle(0xffffff, 0.5); g.fillRoundedRect(-176, -194, 352, 10, 5);
    const title = this.add.text(0, -160, 'Paused', textStyle(46, C.ink, { fontStyle: '700' })).setOrigin(0.5).setResolution(dpr());
    panel.add([g, title]);
    const resume = () => this.close();
    const muteLabel = () => (audio.muted ? 'Sound: off' : 'Sound: on');
    const btns = [
      new Button(this, 0, -80, 'Resume', resume),
      new Button(this, 0, -8, 'Restart (R)', () => { this.close(); this.game_.restartLevel(); }),
      new Button(this, 0, 64, 'Level select', () => { this.scene.stop('Hud'); this.scene.stop('Game'); this.scene.stop(); this.scene.start('LevelSelect'); }, { color: C.paper }),
    ];
    const mute = new Button(this, 0, 136, muteLabel(), () => { audio.toggleMute(); mute.setText(muteLabel()); }, { color: C.paper });
    btns.push(mute);
    if (this.game_.data_.mode !== 'play') btns[2]!.setText('Title');
    if (this.game_.data_.mode !== 'play') btns[2]!.onClick = () => { this.scene.stop('Hud'); this.scene.stop('Game'); this.scene.stop(); this.scene.start('Title'); };
    panel.add(btns);
    panel.setScale(0.7).setAlpha(0);
    this.tweens.add({ targets: panel, scale: 1, alpha: 1, duration: 280, ease: 'Back.easeOut' });
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
