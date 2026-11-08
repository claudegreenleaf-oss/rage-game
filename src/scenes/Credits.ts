// Fallback credits roll (used only if the playable credits level is missing).
import Phaser from 'phaser';
import { ptext } from '../render/pixel/font';
import type { Overlay } from './Overlay';

const LINES = ['DIE TRYING', '', 'Design & code', 'the signs', '', 'Directed by', 'the signs', '', 'Starring', 'Pip', 'and Pip', 'and Pip', '', 'Thanks for playing'];

export class Credits extends Phaser.Scene {
  constructor() { super('Credits'); }
  create(): void {
    const c = this.add.container(640, 760);
    LINES.forEach((l, i) => c.add(ptext(this, 0, i * 54, l, { scale: i === 0 ? 8 : 4, outline: true, color: 0xfff4e4, origin: [0.5, 0.5] })));
    this.tweens.add({ targets: c, y: -LINES.length * 54, duration: 14000, onComplete: () => this.done() });
    this.input.keyboard?.once('keydown', () => this.done());
    (this.scene.get('Overlay') as Overlay).irisOpen(640, 360, 600);
  }
  private done(): void { (this.scene.get('Overlay') as Overlay).irisClose(640, 360, 500, () => this.scene.start('End')); }
}
