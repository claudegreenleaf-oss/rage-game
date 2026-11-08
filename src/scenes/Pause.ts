// Pause menu over the game: Resume · Restart · (Map) · (Chambers) · Main menu (Back to editor in playtest) · Music · Effects · Sound.
import Phaser from 'phaser';
import type { Game } from './Game';
import { C } from '../render/palette';
import { Button, Menu, UI, type Focusable } from '../render/ui';
import { volumeControls } from './volume';
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
    const resume = () => this.close();
    const toTitle = () => { g.saveWorld(); this.scene.stop('Hud'); this.scene.stop('Game'); this.scene.stop(); this.scene.start('Title'); };
    const items: Array<[string, () => void, number?]> = [
      ['Resume', resume],
      ['Restart (R)', () => { this.close(); g.restartLevel(); }],
    ];
    if (world) items.push(['Map (M)', () => { this.scene.stop(); g.openMap(true); }, C.paper]);
    if (g.data_.mode === 'play') items.push(['Chambers', () => { this.scene.stop('Hud'); this.scene.stop('Game'); this.scene.stop(); this.scene.start('LevelSelect'); }, C.paper]);
    // Every mode can leave for the main menu; a playtest goes back to the editor it came from.
    if (g.data_.mode === 'playtest') items.push(['Back to editor', () => { this.scene.stop(); g.exit({ won: false, deaths: g.world.deathCount }); }, C.paper]);
    else items.push(['Main menu', toTitle, C.paper]);
    const GAP = 64, n = items.length + 3;
    const panelH = Math.round((n * GAP + 48) / UI);
    const panel = this.add.container(640, 392);
    panel.add(this.add.image(0, 0, panelTex(this, 156, panelH, 'paper')).setScale(UI));
    const top = -((n - 1) * GAP) / 2;
    panel.add(ptext(this, 0, -(panelH * UI) / 2 - 34, 'Paused', { scale: 6, bold: true, color: 0xfff4e4, origin: [0.5, 0.5] }));
    const btns: Focusable[] = items.map(([label, fn, color], i) => new Button(this, 0, top + i * GAP, label, fn, { w: 420, ...(color !== undefined ? { color } : {}) }));
    const vol = volumeControls(this, 0, top + items.length * GAP, GAP);
    btns.push(...vol.items);
    panel.add(btns);
    panel.setScale(0.5).setAlpha(0);
    this.tweens.add({ targets: panel, scale: 1, alpha: 1, duration: 220, ease: 'Back.easeOut' });
    new Menu(this, btns);
    this.input.keyboard?.on('keydown-ESC', resume);
    this.input.keyboard?.on('keydown-P', resume);
    this.input.keyboard?.on('keydown-R', () => { this.close(); this.game_.restartLevel(); });
    this.input.keyboard?.on('keydown-N', () => audio.toggleMute());
  }

  private close(): void {
    this.scene.stop();
    this.scene.resume('Game');
  }
}
