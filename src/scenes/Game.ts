// Runs one level: fixed 60 Hz sim stepping, input, camera fit + juice, win/death flow.
import Phaser from 'phaser';
import { Btn, U, type LevelData } from '../sim/types';
import { World } from '../sim/world';
import { LevelView } from '../render/level-view';
import { C, TILE } from '../render/palette';
import { audio } from '../audio/sfx';
import { music } from '../audio/music';
import { progress } from '../progress';
import { ACTS, CREDITS_LEVEL, LEVELS, actOf } from '../levels';
import type { Backdrop } from './Backdrop';
import type { Overlay } from './Overlay';

export type GameMode = 'play' | 'playtest' | 'shared' | 'credits';

export interface GameResult { won: boolean; deaths: number }

export interface GameData {
  level: LevelData;
  mode: GameMode;
  /** Index into LEVELS when playing the campaign. */
  index?: number;
  /** Called when the scene exits (Esc in playtest, or after a playtest win). The caller resumes itself. */
  onExit?: (result: GameResult) => void;
  /** Called the moment the level is beaten (e.g. so the editor can mark it Verified). */
  onWon?: (deaths: number) => void;
}

const STEP_MS = 1000 / 60;
const W = 1280, H = 720;

export class Game extends Phaser.Scene {
  world!: World;
  view!: LevelView;
  data_!: GameData;
  private acc = 0;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private baseZoom = 1;
  private baseScroll = { x: 0, y: 0 };
  private trauma = 0;
  private punchV = 0;
  private punch = 0;
  private ended = false;
  private shakeT = 0;
  private lastDeaths = 0;

  constructor() { super('Game'); }

  init(data: GameData): void {
    this.data_ = data;
    this.acc = 0;
    this.ended = false;
    this.trauma = 0;
    this.punch = 0;
    this.punchV = 0;
  }

  create(): void {
    const d = this.data_;
    this.world = new World(d.level);
    // Test hook: a script armed for this level starts on its very first tick.
    const armed = pendingScript.get(d.level.id);
    if (armed) { this.scripted = [...armed]; pendingScript.delete(d.level.id); }
    this.lastDeaths = 0;
    const cam = this.cameras.main;
    cam.setBackgroundColor('rgba(0,0,0,0)');
    this.view = new LevelView(this, this.world, {
      shake: (a) => { this.trauma = Math.min(1, this.trauma + a); },
      punch: (a) => { this.punchV += a * 28; },
      flash: () => (this.scene.get('Overlay') as Overlay).flash(),
    });
    this.fitCamera();

    const kb = this.input.keyboard!;
    this.keys = kb.addKeys({
      left: 'LEFT', right: 'RIGHT', up: 'UP', down: 'DOWN', a: 'A', d: 'D', w: 'W', s: 'S', space: 'SPACE', r: 'R',
    }, false) as Record<string, Phaser.Input.Keyboard.Key>;
    kb.on('keydown-ESC', this.onEsc, this);
    kb.on('keydown-P', this.onEsc, this);
    kb.on('keydown-M', () => audio.toggleMute());
    kb.addCapture('SPACE,UP,DOWN,LEFT,RIGHT');
    this.game.events.on(Phaser.Core.Events.BLUR, this.onBlur, this);
    this.events.once('shutdown', () => {
      kb.off('keydown-ESC', this.onEsc, this);
      kb.off('keydown-P', this.onEsc, this);
      kb.removeAllListeners('keydown-M');
      this.game.events.off(Phaser.Core.Events.BLUR, this.onBlur, this);
      this.view.destroy();
    });

    const act = d.mode === 'play' && d.index !== undefined ? actOf(d.index).n : d.level.act ?? 1;
    (this.scene.get('Backdrop') as Backdrop).setMood(d.mode === 'credits' ? 0 : act);
    music.play(d.mode === 'credits' ? 0 : act);

    this.scene.launch('Hud', { game: this });
    this.scene.bringToTop('Hud');
    const ov = this.scene.get('Overlay') as Overlay;
    this.scene.bringToTop('Overlay');
    const sp = this.toScreen(this.world.pip.x + this.world.pip.w / 2, this.world.pip.y + this.world.pip.h / 2);
    ov.irisOpen(sp.x, sp.y, 750);
  }

  /** Fit the whole level on screen with a little room for the HUD. */
  private fitCamera(): void {
    const cam = this.cameras.main;
    const wpx = this.world.W * TILE, hpx = this.world.H * TILE;
    const z = Math.min((W - 48) / wpx, (H - 120) / hpx, 2.6);
    this.baseZoom = z;
    cam.setZoom(z);
    cam.centerOn(wpx / 2, hpx / 2 - 16 / z);
    this.baseScroll = { x: cam.scrollX, y: cam.scrollY };
    this.view.setZoom(z);
  }

  toScreen(ux: number, uy: number): { x: number; y: number } {
    const cam = this.cameras.main;
    const wx = (ux / U) * TILE, wy = (uy / U) * TILE;
    return { x: (wx - cam.midPoint.x) * cam.zoom + W / 2, y: (wy - cam.midPoint.y) * cam.zoom + H / 2 };
  }

  /** Scripted input (tests and attract mode): one mask per tick, consumed before the keyboard. */
  scripted: number[] | null = null;

  private readInput(): number {
    if (this.scripted) { const m = this.scripted.shift(); if (this.scripted.length === 0) this.scripted = null; return m ?? 0; }
    const k = this.keys;
    let m = 0;
    if (k.left!.isDown || k.a!.isDown) m |= Btn.Left;
    if (k.right!.isDown || k.d!.isDown) m |= Btn.Right;
    if (k.space!.isDown || k.up!.isDown || k.w!.isDown) m |= Btn.Jump;
    if (k.down!.isDown || k.s!.isDown) m |= Btn.Down;
    if (k.r!.isDown) m |= Btn.Restart;
    return m;
  }

  private onEsc(): void {
    if (this.ended) return;
    if (this.data_.mode === 'playtest') { this.exit({ won: false, deaths: this.world.deathCount }); return; }
    this.openPause();
  }

  private onBlur(): void {
    if (this.ended || this.data_.mode === 'playtest' || !this.scene.isActive()) return;
    this.openPause();
  }

  openPause(): void {
    if (!this.scene.isActive()) return;
    this.scene.pause();
    this.scene.launch('Pause', { game: this });
    this.scene.bringToTop('Pause');
  }

  /** Restart from scratch (pause menu): same as pressing R. */
  restartLevel(): void { this.world.step(Btn.Restart); this.view.onEvents(this.world.fx); this.world.step(0); }

  exit(result: GameResult): void {
    this.ended = true;
    this.scene.stop('Hud');
    const cb = this.data_.onExit;
    this.scene.stop();
    cb?.(result);
  }

  override update(_time: number, _delta: number): void {
    // Use the raw frame time: Phaser's smoothed delta would slow the sim on slow frames.
    const delta = this.game.loop.rawDelta;
    const dt = Math.min(delta, 100) / 1000;
    if (!this.ended) {
      this.acc += Math.min(delta, 250);
      let steps = 0;
      while (this.acc >= STEP_MS && steps < 6) {
        this.view.snapshot();
        this.world.step(this.readInput());
        this.view.onEvents(this.world.fx);
        this.acc -= STEP_MS;
        steps++;
        if (this.world.deathCount > this.lastDeaths) {
          if (this.data_.mode === 'play') for (let i = this.lastDeaths; i < this.world.deathCount; i++) progress.addDeath();
          this.lastDeaths = this.world.deathCount;
        }
        if (this.world.won) { this.onWin(); break; }
      }
      if (steps >= 6) this.acc = 0;
    }
    this.view.render(this.ended ? 1 : this.acc / STEP_MS, dt);
    this.updateCamera(dt);
    const bd = this.scene.get('Backdrop') as Backdrop;
    const p = this.world.pip;
    bd.parallax.x = (p.x / (this.world.W * U)) * 2 - 1;
    bd.parallax.y = (p.y / (this.world.H * U)) * 2 - 1;
  }

  private updateCamera(dt: number): void {
    const cam = this.cameras.main;
    this.shakeT += dt;
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    const s = this.trauma * this.trauma;
    const ox = (Math.sin(this.shakeT * 53) + Math.sin(this.shakeT * 31.7) * 0.6) * 9 * s;
    const oy = (Math.cos(this.shakeT * 47) + Math.sin(this.shakeT * 27.1) * 0.6) * 7 * s;
    // punch zoom: critically-damped-ish spring
    this.punchV += -this.punch * 240 * dt;
    this.punchV *= Math.exp(-dt * 14);
    this.punch += this.punchV * dt;
    cam.setZoom(this.baseZoom * (1 + this.punch));
    cam.setRotation(Math.sin(this.shakeT * 41) * 0.012 * s);
    const wpx = this.world.W * TILE, hpx = this.world.H * TILE;
    cam.centerOn(wpx / 2 + ox / cam.zoom, hpx / 2 - 16 / this.baseZoom + oy / cam.zoom);
    void this.baseScroll;
  }

  private onWin(): void {
    if (this.ended) return;
    this.ended = true;
    const d = this.data_;
    const deaths = this.world.deathCount;
    d.onWon?.(deaths);
    let newBest = false;
    if (d.mode === 'play' && d.index !== undefined) newBest = progress.recordWin(d.level.id, d.index, deaths).newBest;
    const door = this.world.obj.doors[0];
    const target = door ? this.toScreen(door.x + door.w / 2, door.y + door.h / 2) : { x: W / 2, y: H / 2 };
    this.events.emit('won', { deaths, newBest });
    // zoom on the door, then iris
    this.tweens.add({ targets: this, baseZoom: this.baseZoom * 1.18, duration: 900, ease: 'Sine.easeInOut' });
    this.time.delayedCall(700, () => {
      const t2 = door ? this.toScreen(door.x + door.w / 2, door.y + door.h / 2) : target;
      (this.scene.get('Overlay') as Overlay).irisClose(t2.x, t2.y, 650, () => this.afterWin(deaths));
    });
  }

  private afterWin(deaths: number): void {
    const d = this.data_;
    if (d.mode === 'playtest') { this.exit({ won: true, deaths }); return; }
    this.scene.stop('Hud');
    if (d.mode === 'credits') { this.scene.start('End'); return; }
    if (d.mode === 'shared') { this.scene.start('Title', { cleared: { name: d.level.name, deaths } }); return; }
    const next = (d.index ?? -1) + 1;
    if (next >= LEVELS.length) {
      if (CREDITS_LEVEL) this.scene.start('Game', { level: CREDITS_LEVEL, mode: 'credits' } satisfies GameData);
      else this.scene.start('Credits');
      return;
    }
    startLevel(this, next);
  }
}

/** Start campaign level `index`, with the act card first if it opens an act. */
/** Input scripts waiting for a level to start (Playwright/dev hook). */
export const pendingScript = new Map<string, number[]>();

export function startLevel(scene: Phaser.Scene, index: number, forceCard = false): void {
  const level = LEVELS[index];
  if (!level) return;
  const act = ACTS.find((a) => a.first === index);
  if (act || forceCard) scene.scene.start('ActCard', { act: act ?? actOf(index), index });
  else scene.scene.start('Game', { level, mode: 'play', index } satisfies GameData);
}

export const INK = C.ink;
