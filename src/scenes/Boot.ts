// Boot: generate the sprite atlas and pixel font, then route (share link -> level, else title).
import Phaser from 'phaser';
import { buildAtlas } from '../render/pixel/sprites';
import { makeFonts } from '../render/pixel/font';
import { decodeLevel } from '../editor/share';
import { audio } from '../audio/sfx';
import { music } from '../audio/music';
import type { GameData } from './Game';

export class Boot extends Phaser.Scene {
  constructor() { super('Boot'); }

  async create(): Promise<void> {
    // All art and the pixel font are generated in code here.
    buildAtlas(this);
    makeFonts(this);
    await Promise.resolve();
    const boot = document.getElementById('boot');
    if (boot) { boot.style.opacity = '0'; setTimeout(() => boot.remove(), 500); }

    // Browsers only allow audio after a user gesture.
    const unlock = () => { void audio.unlock().then(() => music.refresh()); };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);

    this.scene.launch('Backdrop');
    this.scene.launch('Overlay');
    this.scene.sendToBack('Backdrop');

    const shared = location.hash.startsWith('#lvl=') ? decodeLevel(location.hash) : null;
    if (shared) this.scene.start('Game', { level: shared, mode: 'shared' } satisfies GameData);
    else this.scene.start('Title');
  }
}
