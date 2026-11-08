// Entry point: boots Phaser with every scene and exposes a small hook for browser tests.
import Phaser from 'phaser';
import { Boot } from './scenes/Boot';
import { Backdrop } from './scenes/Backdrop';
import { Overlay } from './scenes/Overlay';
import { Title } from './scenes/Title';
import { LevelSelect } from './scenes/LevelSelect';
import { ActCard } from './scenes/ActCard';
import { Game, type GameData } from './scenes/Game';
import { Hud } from './scenes/Hud';
import { Pause } from './scenes/Pause';
import { Credits } from './scenes/Credits';
import { End } from './scenes/End';
import { CREDITS_LEVEL, LEVELS } from './levels';
import type { World } from './sim/world';
import { compileScript, unrle } from './sim/replay';

const extraScenes: Phaser.Types.Scenes.SceneType[] = [];
const editorMods = import.meta.glob<{ Editor?: Phaser.Types.Scenes.SceneType }>('./editor/Editor.ts', { eager: true });
for (const m of Object.values(editorMods)) if (m.Editor) extraScenes.push(m.Editor);

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: 1280,
  height: 720,
  backgroundColor: '#2b2433',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  render: { antialias: true, pixelArt: false, roundPixels: false, powerPreference: 'high-performance' },
  fps: { target: 60, smoothStep: false },
  input: { keyboard: true, mouse: true, touch: false, gamepad: false },
  scene: [Boot, Backdrop, Title, LevelSelect, ActCard, Game, Hud, Pause, Credits, End, ...extraScenes, Overlay],
});

declare global {
  interface Window { __dt?: { game: Phaser.Game; getWorld(): World | null; startLevel(id: string): void; runScript(src: string): void; goto(key: string, data?: object): void } }
}

window.__dt = {
  game,
  getWorld(): World | null {
    const g = game.scene.getScene('Game') as Game | null;
    return g && game.scene.isActive('Game') ? g.world : null;
  },
  startLevel(id: string): void {
    const index = LEVELS.findIndex((l) => l.id === id);
    const level = LEVELS[index];
    if (!level) return;
    for (const s of game.scene.getScenes(true)) if (!['Backdrop', 'Overlay'].includes(s.scene.key)) s.scene.stop();
    setTimeout(() => game.scene.start('Game', { level, mode: 'play', index } satisfies GameData), 50);
  },
  /** Jump to any scene (`credits` starts the playable credits). */
  goto(key: string, data?: object): void {
    for (const s of game.scene.getScenes(true)) if (!['Backdrop', 'Overlay'].includes(s.scene.key)) s.scene.stop();
    setTimeout(() => {
      if (key === 'credits' && CREDITS_LEVEL) game.scene.start('Game', { level: CREDITS_LEVEL, mode: 'credits' } satisfies GameData);
      else game.scene.start(key, data);
    }, 50);
  },
  /** Feed a solution script (see src/solutions) to the running level. */
  runScript(src: string): void {
    const g = game.scene.getScene('Game') as Game | null;
    if (g) g.scripted = unrle(compileScript(src));
  },
};
