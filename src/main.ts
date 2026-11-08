// Entry point: boots Phaser with every scene and exposes a small hook for browser tests.
import Phaser from 'phaser';
import { Boot } from './scenes/Boot';
import { Backdrop } from './scenes/Backdrop';
import { Overlay } from './scenes/Overlay';
import { Title } from './scenes/Title';
import { LevelSelect } from './scenes/LevelSelect';
import { ActCard } from './scenes/ActCard';
import { Game, pendingScript, worldGameData, worldData, type GameData } from './scenes/Game';
import { WorldMap } from './scenes/Map';
import { Settings } from './scenes/Settings';
import type { WorldDef } from './sim/campaign';
import type { LevelData } from './sim/types';
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

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game',
  width: 1280,
  height: 720,
  backgroundColor: '#2b2433',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  render: { antialias: false, pixelArt: true, roundPixels: true, powerPreference: 'high-performance' },
  fps: { target: 60, smoothStep: false },
  input: { keyboard: true, mouse: true, touch: false, gamepad: false },
  scene: [Boot, Backdrop, Title, LevelSelect, ActCard, Game, Hud, Pause, WorldMap, Settings, Credits, End, ...extraScenes, Overlay],
};

let game = new Phaser.Game(config);

// Some GPU backends (seen with ANGLE on Vulkan) reject the first framebuffers of a cold WebGL
// process, and Phaser's renderer then fails to boot. If that happens, rebuild the game once the
// backend is warm instead of leaving a blank screen.
let bootRetries = 0;
const onBootError = (e: ErrorEvent): void => {
  if (!/Framebuffer status/.test(String(e.message)) || bootRetries >= 2) return;
  e.preventDefault();
  bootRetries++;
  const broken = game;
  setTimeout(() => {
    try { broken.destroy(true); } catch { /* already gone */ }
    game = new Phaser.Game(config);
    if (window.__dt) window.__dt.game = game;
  }, 200);
};
window.addEventListener('error', onBootError);
setTimeout(() => window.removeEventListener('error', onBootError), 20000);

declare global {
  interface Window { __dt?: { game: Phaser.Game; getWorld(): World | null; startLevel(id: string): void; runScript(src: string): void; armScript(id: string, src: string): void; goto(key: string, data?: object): void; startWorld(fresh?: boolean, def?: WorldDef, levels?: LevelData[]): boolean } }
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
  /** Arm a solution script to start on tick 1 of the next time level `id` starts. */
  armScript(id: string, src: string): void {
    pendingScript.set(id, unrle(compileScript(src)));
  },
  /** Start the connected world (or a test world passed in). */
  startWorld(fresh = true, def?: WorldDef, levels?: LevelData[]): boolean {
    const data = def && levels ? { def, levels } : worldData();
    if (!data) return false;
    for (const s of game.scene.getScenes(true)) if (!['Backdrop', 'Overlay'].includes(s.scene.key)) s.scene.stop();
    const d = worldGameData(fresh, data);
    setTimeout(() => d && game.scene.start('Game', d), 50);
    return true;
  },
  runScript(src: string): void {
    const g = game.scene.getScene('Game') as Game | null;
    if (g) g.scripted = unrle(compileScript(src));
  },
};
