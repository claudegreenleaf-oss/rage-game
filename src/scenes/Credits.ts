// Fallback credits roll (used only if the playable credits level is missing).
import Phaser from 'phaser';
import { C } from '../render/palette';
import { textStyle, dpr } from '../render/ui';
import type { Overlay } from './Overlay';

const LINES = ['DIE TRYING', '', 'Design & code', 'the signs', '', 'Directed by', 'the signs', '', 'Starring', 'Pip', 'and Pip', 'and Pip', '', 'Thanks for playing'];

export class Credits extends Phaser.Scene {
  constructor() { super('Credits'); }
  create(): void {
    const c = this.add.container(640, 760);
    LINES.forEach((l, i) => c.add(this.add.text(0, i * 52, l, textStyle(i === 0 ? 56 : 30, C.ink, { fontStyle: i % 3 === 0 ? '700' : '500', stroke: '#fbf3e4', strokeThickness: 8 })).setOrigin(0.5).setResolution(dpr())));
    this.tweens.add({ targets: c, y: -LINES.length * 52, duration: 14000, onComplete: () => this.done() });
    this.input.keyboard?.once('keydown', () => this.done());
    (this.scene.get('Overlay') as Overlay).irisOpen(640, 360, 600);
  }
  private done(): void { (this.scene.get('Overlay') as Overlay).irisClose(640, 360, 500, () => this.scene.start('End')); }
}
