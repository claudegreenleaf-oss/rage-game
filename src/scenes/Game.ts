// Runs a level or the connected world: fixed 60 Hz sim stepping, input, a follow camera at a close
// integer zoom, room transitions, juice, and the win/death flow.
import Phaser from 'phaser';
import { Btn, U, type LevelData } from '../sim/types';
import { World } from '../sim/world';
import { Campaign, type CampaignSave, type WorldDef } from '../sim/campaign';
import { LevelView } from '../render/level-view';
import { C, TILE } from '../render/palette';
import { audio } from '../audio/sfx';
import { music } from '../audio/music';
import { progress } from '../progress';
import { ACTS as LEVEL_ACTS, CREDITS_LEVEL, LEVELS, type ActInfo } from '../levels';
import * as levelIndex from '../levels';
import type { Backdrop } from './Backdrop';
import type { Overlay } from './Overlay';

export type GameMode = 'play' | 'playtest' | 'shared' | 'credits' | 'world';

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
  /** World mode: the world definition, its rooms, and a save to resume. */
  worldDef?: WorldDef;
  worldLevels?: LevelData[];
  save?: CampaignSave | null;
}

/** Acts, with Act 4 filled in if the level index doesn't list it yet. */
export const ACTS: ActInfo[] = LEVEL_ACTS.some((a) => a.n === 4) || LEVELS.length <= 12 ? LEVEL_ACTS
  : [...LEVEL_ACTS, { n: 4, name: 'The Core', line: 'Nothing down here was meant to be found. Or survived.', first: 12 }];
export const actOf = (index: number): ActInfo => [...ACTS].reverse().find((a) => index >= a.first) ?? ACTS[0]!;

/** Music slot for an act or zone: 0 title, 1–3 acts, 4 credits, 5–7 Ogives (zones; Act 4 takes 7). */
export function musicFor(level: LevelData | null, act: number): number {
  if (level?.audio?.music !== undefined) return level.audio.music;
  if (level?.credits) return 4;
  if (level?.kind === 'zone') return 5 + ((Math.max(1, level.biome ?? act) - 1) % 3);
  return act === 4 ? 7 : Math.max(0, Math.min(3, act));
}

/** The connected world, if the world designer's export exists yet. */
export function worldData(): { def: WorldDef; levels: LevelData[] } | null {
  const m = levelIndex as unknown as { WORLD?: WorldDef; WORLD_LEVELS?: LevelData[] };
  return m.WORLD && m.WORLD_LEVELS?.length ? { def: m.WORLD, levels: m.WORLD_LEVELS } : null;
}

const STEP_MS = 1000 / 60;
const W = 1280, H = 720;
/** World pixels per screen pixel: ~20 tiles across at 1280×720. */
const ZOOM = 4;

export class Game extends Phaser.Scene {
  private solo!: World;
  campaign: Campaign | null = null;
  view!: LevelView;
  data_!: GameData;
  private acc = 0;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private trauma = 0;
  private ended = false;
  private shakeT = 0;
  private lastDeaths = 0;
  private roomRev = -1;
  private cam = { x: 0, y: 0, look: 0, ready: false };
  private saveT = 0;
  private relicTotals: { notes: number; jars: number; kinds: Map<string, 'note' | 'jar'> } | null = null;

  constructor() { super('Game'); }

  /** The world currently being played (the campaign's room in world mode). */
  get world(): World { return this.campaign ? this.campaign.room : this.solo; }

  init(data: GameData): void {
    this.data_ = data;
    this.acc = 0;
    this.ended = false;
    this.trauma = 0;
    this.roomRev = -1;
    this.cam.ready = false;
    this.campaign = null;
  }

  create(): void {
    const d = this.data_;
    if (d.mode === 'world' && d.worldDef && d.worldLevels) {
      this.campaign = new Campaign(d.worldDef, d.worldLevels, d.save ?? undefined);
      this.relicTotals = countRelics(d.worldLevels);
    } else {
      this.solo = new World(d.level);
    }
    const armed = pendingScript.get(this.world.level.id);
    if (armed) { this.scripted = [...armed]; pendingScript.delete(this.world.level.id); }
    this.lastDeaths = 0;
    this.cameras.main.setBackgroundColor('rgba(0,0,0,0)').setRoundPixels(true).setZoom(ZOOM);
    this.buildView();
    this.updateCamera(0);

    const kb = this.input.keyboard!;
    this.keys = kb.addKeys({
      left: 'LEFT', right: 'RIGHT', up: 'UP', down: 'DOWN', a: 'A', d: 'D', w: 'W', s: 'S', space: 'SPACE', r: 'R',
    }, false) as Record<string, Phaser.Input.Keyboard.Key>;
    kb.on('keydown-ESC', this.onEsc, this);
    kb.on('keydown-P', this.onEsc, this);
    window.addEventListener('keydown', this.onTab);
    kb.on('keydown-N', () => audio.toggleMute());
    kb.addCapture('SPACE,UP,DOWN,LEFT,RIGHT,TAB');
    this.game.events.on(Phaser.Core.Events.BLUR, this.onBlur, this);
    this.events.once('shutdown', () => {
      kb.off('keydown-ESC', this.onEsc, this);
      kb.off('keydown-P', this.onEsc, this);
      window.removeEventListener('keydown', this.onTab);
      kb.removeAllListeners('keydown-N');
      this.game.events.off(Phaser.Core.Events.BLUR, this.onBlur, this);
      this.saveWorld();
      this.view.destroy();
    });

    (this.scene.get('Backdrop') as Backdrop).setRecede(true);
    this.events.once('shutdown', () => (this.scene.get('Backdrop') as Backdrop).setRecede(false));
    this.scene.launch('Hud', { game: this });
    this.scene.bringToTop('Hud');
    const ov = this.scene.get('Overlay') as Overlay;
    this.scene.bringToTop('Overlay');
    const sp = this.toScreen(this.world.pip.x + this.world.pip.w / 2, this.world.pip.y + this.world.pip.h / 2);
    ov.irisOpen(sp.x, sp.y, 750);
  }

  /** (Re)build the level view for the current room, and set its mood and music. */
  private buildView(): void {
    this.view?.destroy();
    const w = this.world;
    this.view = new LevelView(this, w, {
      shake: (a) => { this.trauma = Math.min(1, this.trauma + a * 1.2); },
      punch: () => {},
      flash: () => (this.scene.get('Overlay') as Overlay).flash(),
    }, { atmosphere: !w.level.credits });
    this.roomRev = this.campaign?.roomRev ?? 0;
    const d = this.data_;
    const lvl = w.level;
    const mood = d.mode === 'credits' ? 0 : lvl.palette ?? lvl.biome ?? (d.mode === 'play' && d.index !== undefined ? actOf(d.index).n : lvl.act ?? 1);
    (this.scene.get('Backdrop') as Backdrop).setMood(mood);
    // Level audio overrides (custom sounds and theme), falling back to the act music.
    const a = audio as unknown as { setLevelOverrides?: (s?: Record<string, number[]>) => void };
    if (typeof a.setLevelOverrides === 'function') a.setLevelOverrides(lvl.audio?.sfx);
    const m = music as unknown as { playCustom?: (s: unknown) => void };
    if (lvl.audio?.theme && typeof m.playCustom === 'function') m.playCustom(lvl.audio.theme);
    else music.play(d.mode === 'credits' ? 4 : musicFor(lvl, mood));
  }

  toScreen(ux: number, uy: number): { x: number; y: number } {
    const cam = this.cameras.main;
    const wx = (ux / U) * TILE, wy = (uy / U) * TILE;
    return { x: (wx - cam.scrollX - W / 2) * cam.zoom + W / 2, y: (wy - cam.scrollY - H / 2) * cam.zoom + H / 2 };
  }

  /** Relic counts for the HUD and map (world mode). */
  relicCounts(): { notes: number; jars: number; notesTotal: number; jarsTotal: number } {
    const t = this.relicTotals;
    if (!t || !this.campaign) return { notes: 0, jars: 0, notesTotal: 0, jarsTotal: 0 };
    let notes = 0, jars = 0;
    for (const id of this.campaign.collected) { const k = t.kinds.get(id); if (k === 'note') notes++; else if (k === 'jar') jars++; }
    return { notes, jars, notesTotal: t.notes, jarsTotal: t.jars };
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

  /** M (or Tab) toggles the map. A window listener, so it works while this scene is paused under the map or pause menu. */
  private onTab = (e: KeyboardEvent): void => {
    if ((e.key !== 'Tab' && e.key !== 'm' && e.key !== 'M') || !this.campaign || this.ended) return;
    e.preventDefault();
    if (e.repeat) return;
    const sm = this.scene.manager;
    if (sm.isActive('Map')) (this.scene.get('Map') as unknown as { close(): void }).close();
    else if (sm.isActive('Pause')) { this.scene.stop('Pause'); this.openMap(true); }
    else this.openMap();
  };

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

  /** Open the map over the game. `alreadyPaused`: coming from the pause menu, so the game stays paused as is. */
  openMap(alreadyPaused = false): void {
    if (!this.campaign) return;
    if (!alreadyPaused) { if (!this.scene.isActive()) return; this.scene.pause(); }
    this.scene.launch('Map', { game: this });
    this.scene.bringToTop('Map');
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

  /** Fast travel to a visited room (from the map). */
  travel(id: string): boolean {
    if (!this.campaign?.travelTo(id)) return false;
    this.changeRoom();
    return true;
  }

  saveWorld(): void {
    if (this.campaign) progress.setWorldSave(this.campaign.save());
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
        const input = this.readInput();
        if (this.campaign) {
          this.campaign.step(input);
          if (this.campaign.roomRev !== this.roomRev) { this.changeRoom(); this.acc -= STEP_MS; steps++; continue; }
          this.view.onEvents(this.campaign.fx);
          if (this.campaign.fx.some((e) => e.t === 'collect' || e.t === 'checkpoint')) this.saveWorld();
        } else {
          this.world.step(input);
          this.view.onEvents(this.world.fx);
        }
        this.acc -= STEP_MS;
        steps++;
        const dc = this.world.deathCount;
        if (dc > this.lastDeaths) {
          if (this.data_.mode === 'play' || this.data_.mode === 'world') for (let i = this.lastDeaths; i < dc; i++) progress.addDeath();
          this.lastDeaths = dc;
          if (this.campaign) this.saveWorld();
        }
        if (!this.campaign && this.world.won) { this.onWin(); break; }
      }
      if (steps >= 6) this.acc = 0;
    }
    this.saveT += dt;
    if (this.campaign && this.saveT > 6) { this.saveT = 0; this.saveWorld(); }
    // Camera first, so the view-sized lighting texture lines up with this frame's scroll.
    this.updateCamera(dt);
    this.view.render(this.ended ? 1 : this.acc / STEP_MS, dt);
    const bd = this.scene.get('Backdrop') as Backdrop;
    const p = this.world.pip;
    bd.parallax.x = (p.x / (this.world.W * U)) * 2 - 1;
    bd.parallax.y = (p.y / (this.world.H * U)) * 2 - 1;
  }

  /** The campaign moved Pip to another room: rebuild the view and slide the new room in. */
  private changeRoom(): void {
    const ch = this.campaign!.lastChange;
    this.lastDeaths = 0;
    this.buildView();
    this.view.onEvents(this.campaign!.fx);
    // Keep the camera's offset from Pip so the new room slides in from the edge Pip came through.
    const side = ch?.side ?? 'start';
    const off = { x: 0, y: 0 };
    const vw = W / ZOOM, vh = H / ZOOM;
    if (side === 'left') off.x = -vw * 0.3; else if (side === 'right') off.x = vw * 0.3;
    else if (side === 'top') off.y = -vh * 0.3; else if (side === 'bottom') off.y = vh * 0.3;
    this.cam.ready = false;
    this.updateCamera(0);
    this.cam.x += off.x; this.cam.y += off.y;
    (this.scene.get('Overlay') as Overlay).wipe(side, 260);
    audio.play('exit');
    this.saveWorld();
  }

  /** Follow camera: dead zone, look-ahead, smooth vertical framing, clamped to the room. */
  private updateCamera(dt: number): void {
    const cam = this.cameras.main;
    const w = this.world, p = w.pip;
    const vw = W / ZOOM, vh = H / ZOOM;
    const roomW = w.W * TILE, roomH = w.H * TILE;
    const px = ((p.x + p.w / 2) / U) * TILE, py = ((p.y + p.h / 2) / U) * TILE;
    // Look ahead in the facing direction (eased so turning doesn't snap).
    const lookTarget = w.pipAlive ? p.facing * TILE * 2.5 : 0;
    this.cam.look += (lookTarget - this.cam.look) * Math.min(1, dt * 2.5);
    let tx = px + this.cam.look;
    let ty = py - TILE * 0.8;
    if (!this.cam.ready) { this.cam.x = tx; this.cam.y = ty; this.cam.ready = true; }
    // Dead zone: only follow once Pip leaves a box around the centre.
    const dzx = TILE * 1.5, dzy = TILE * 1.2;
    if (tx > this.cam.x + dzx) tx -= dzx; else if (tx < this.cam.x - dzx) tx += dzx; else tx = this.cam.x;
    if (ty > this.cam.y + dzy) ty -= dzy; else if (ty < this.cam.y - dzy) ty += dzy; else ty = this.cam.y;
    // Clamp the target to the room (small rooms centre); the camera eases toward it, so a room
    // transition's initial offset glides back in.
    const clamp = (v: number, size: number, view: number) => (size <= view ? size / 2 : Math.max(view / 2, Math.min(size - view / 2, v)));
    tx = clamp(tx, roomW, vw); ty = clamp(ty, roomH, vh);
    if (dt === 0) { this.cam.x = tx; this.cam.y = ty; }
    const kx = 1 - Math.exp(-dt * 6), ky = 1 - Math.exp(-dt * (p.vy > 30 ? 9 : 4));
    this.cam.x += (tx - this.cam.x) * kx;
    this.cam.y += (ty - this.cam.y) * ky;
    let cx = this.cam.x, cy = this.cam.y;
    // Whole-pixel shake.
    this.shakeT += dt;
    this.trauma = Math.max(0, this.trauma - dt * 1.8);
    const s = this.trauma * this.trauma;
    cx += Math.round((Math.sin(this.shakeT * 53) + Math.sin(this.shakeT * 31.7) * 0.6) * 3 * s);
    cy += Math.round((Math.cos(this.shakeT * 47) + Math.sin(this.shakeT * 27.1) * 0.6) * 2.5 * s);
    // Snap to screen pixels so sprites stay crisp while the camera glides.
    cam.setZoom(ZOOM);
    cam.centerOn(Math.round(cx * ZOOM) / ZOOM, Math.round(cy * ZOOM) / ZOOM);
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
    this.events.emit('won', { deaths, newBest });
    this.time.delayedCall(700, () => {
      const t2 = door ? this.toScreen(door.x + door.w / 2, door.y + door.h / 2) : { x: W / 2, y: H / 2 };
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

function countRelics(levels: LevelData[]): { notes: number; jars: number; kinds: Map<string, 'note' | 'jar'> } {
  const kinds = new Map<string, 'note' | 'jar'>();
  for (const l of levels) for (const o of l.objects) if (o.type === 'relic') kinds.set(o.id, o.kind);
  let notes = 0, jars = 0;
  for (const k of kinds.values()) if (k === 'note') notes++; else jars++;
  return { notes, jars, kinds };
}

/** Input scripts waiting for a level to start (Playwright/dev hook). */
export const pendingScript = new Map<string, number[]>();

/** Start campaign level `index`, with the act card first if it opens an act. */
export function startLevel(scene: Phaser.Scene, index: number, forceCard = false): void {
  const level = LEVELS[index];
  if (!level) return;
  const act = ACTS.find((a) => a.first === index);
  if (act || forceCard) scene.scene.start('ActCard', { act: act ?? actOf(index), index });
  else scene.scene.start('Game', { level, mode: 'play', index } satisfies GameData);
}

/** Game data for starting (or continuing) the connected world. */
export function worldGameData(fresh: boolean, data = worldData()): GameData | null {
  if (!data) return null;
  if (fresh) progress.setWorldSave(null);
  const save = fresh ? null : progress.worldSave();
  const start = data.levels.find((l) => l.id === (save?.room ?? data.def.start.room)) ?? data.levels[0]!;
  return { level: start, mode: 'world', worldDef: data.def, worldLevels: data.levels, save };
}

/** Start (or continue) the connected world from `scene`. */
export function startWorld(scene: Phaser.Scene, fresh: boolean, data = worldData()): boolean {
  const d = worldGameData(fresh, data);
  if (d) scene.scene.start('Game', d);
  return !!d;
}

export const INK = C.ink;
