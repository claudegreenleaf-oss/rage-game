// Settings (from the title): music and effects volume, mute, and the controls at a glance.
import Phaser from 'phaser';
import { Button, Menu, UI, type Focusable } from '../render/ui';
import { ptext } from '../render/pixel/font';
import { panelTex } from '../render/pixel/uitex';
import { KEY } from '../render/pixel/pal';
import { audio } from '../audio/sfx';
import { volumeControls } from './volume';
import type { Backdrop } from './Backdrop';
import type { Overlay } from './Overlay';

const CONTROLS: Array<[string, string]> = [
  ['Move', 'arrows / A D'], ['Jump', 'space / up / W'], ['Drop, drag a body', 'down / S'], ['Restart', 'R'],
  ['Map (in the facility)', 'M'], ['Pause', 'Esc / P'], ['Mute', 'N'],
];

export class Settings extends Phaser.Scene {
  private leaving = false;
  constructor() { super('Settings'); }

  create(): void {
    this.leaving = false;
    (this.scene.get('Backdrop') as Backdrop).setMood(0);
    ptext(this, 640, 70, 'Settings', { scale: 6, bold: true, color: 0xfff4e4, origin: [0.5, 0.5] });
    this.add.image(640, 250, panelTex(this, 160, 76, 'paper')).setScale(UI);
    const vol = volumeControls(this, 640, 180, 70);
    const back = new Button(this, 640, 650, 'Back', () => this.back(), { w: 240 });
    const items: Focusable[] = [...vol.items, back];
    new Menu(this, items);
    // Controls card.
    this.add.image(640, 480, panelTex(this, 160, 66, 'dark')).setScale(UI);
    CONTROLS.forEach(([what, key], i) => {
      const y = 404 + i * 26;
      ptext(this, 420, y, what, { scale: 2, color: 0xfff4e4, origin: [0, 0.5] });
      ptext(this, 860, y, key, { scale: 2, color: KEY.z!, origin: [1, 0.5] });
    });
    this.input.keyboard?.on('keydown-ESC', () => this.back());
    this.input.keyboard?.on('keydown-BACKSPACE', () => this.back());
    this.input.keyboard?.on('keydown-N', () => audio.toggleMute());
    (this.scene.get('Overlay') as Overlay).irisOpen(640, 360, 500);
  }

  private back(): void {
    if (this.leaving) return;
    this.leaving = true;
    audio.play('menu', 0.8);
    (this.scene.get('Overlay') as Overlay).irisClose(640, 360, 380, () => this.scene.start('Title'));
  }
}
