// Draws a World as pixel art: baked terrain, pooled sprites for objects, corpses, Pip and particles,
// plus atmosphere (dynamic lighting, fog, rain, caustics) and a cosmetic ragdoll on death.
// Purely a reader of sim state; reacts to world.fx for juice and sound. Nothing heavy is redrawn per
// frame: sprites are moved and re-framed, terrain is re-baked only when the tiles change, and the
// darkness layer is one render-texture fill plus a few light stamps.
import Phaser from 'phaser';
import { DECOR_IDS, U, type Corpse, type DeathType, type LevelObject, type SimEvent } from '../sim/types';
import type { World } from '../sim/world';
import { PIP_H, PIP_W, SIGN_RANGE } from '../sim/constants';
import { gateBox, signText, type RtCrusher, type RtDoor, type RtPlate } from '../sim/hazards';
import { audio } from '../audio/sfx';
import { ATLAS, corpseFrame, type Look } from './pixel/sprites';
import {
  T, bakeDecorLayer, bakeTerrain, bakeWater, cellKey, crumbleTexture, crusherTexture, dripPoints, isSolidGlyph,
  pixelArtTexture, stoneTexture, type TerrainSource,
} from './pixel/terrain';
import { KEY, actPal } from './pixel/pal';
import { Pixels } from './pixel/particles';
import { ptext } from './pixel/font';
import { rng } from './rng';

const TAUNTS: Array<[number, string]> = [
  [1, 'Oops.'], [3, 'Again? Bold.'], [5, 'Have you tried not dying?'], [10, "I'm keeping these, by the way."],
  [20, "Your family's here. All of them."], [50, 'I could watch this all day. I do.'],
];
export function tauntFor(deaths: number): string | null {
  let t: string | null = null;
  for (const [n, s] of TAUNTS) if (deaths >= n) t = s;
  return t;
}

const SHAKE: Record<DeathType, number> = { spike: 0.55, crusher: 1, dropper: 0.75, water: 0.3, pit: 0.15, laser: 0.6 };

/** Sim units -> world pixels. */
const P = (u: number) => u / (U / T);
const R = Math.round;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export interface ViewHooks {
  shake(amount: number): void;
  punch(amount: number): void;
  flash(): void;
}

export interface ViewOptions {
  /** Darkness, lights, fog and rain (the game turns this on; the editor preview leaves it off). */
  atmosphere?: boolean;
}

/** The single message the HUD should show right now. */
export interface ViewMessage { key: string; text: string; kind: 'lore' | 'stuck' | 'sign' | 'taunt' }

interface CorpseSpr { img: Phaser.GameObjects.Image; flies: Phaser.GameObjects.Image[]; squash: number; pop: number; seed: number; hideUntil: number }
interface Pos { x: number; y: number }
interface RagPt { x: number; y: number; px: number; py: number }
interface Ragdoll { pts: RagPt[]; t: number; head: Phaser.GameObjects.Image; limbs: Phaser.GameObjects.Image[]; target: Pos | null }
interface LightSpot { x: number; y: number; r: number; flicker?: number }

let viewSerial = 0;

export class LevelView {
  readonly root: Phaser.GameObjects.Container;
  private readonly id = ++viewSerial;
  private readonly act: number;
  private terrainKey: string;
  private waterKey: string;
  private terrain: Phaser.GameObjects.Image;
  private bgArt: Phaser.GameObjects.Container;
  private back: Phaser.GameObjects.Container;
  private ents: Phaser.GameObjects.Container;
  private front: Phaser.GameObjects.Container;
  private fgArt: Phaser.GameObjects.Container;
  private fxLayer: Phaser.GameObjects.Container;
  private glowLayer: Phaser.GameObjects.Container;
  private top: Phaser.GameObjects.Container;
  readonly particles: Pixels;

  private pip: Phaser.GameObjects.Image;
  private pipShadow: Phaser.GameObjects.Image;
  private corpses = new Map<number, CorpseSpr>();
  private doors = new Map<string, { img: Phaser.GameObjects.Image; halo: Phaser.GameObjects.Image; smirk: Phaser.GameObjects.Image }>();
  private droppers = new Map<string, Phaser.GameObjects.Image>();
  private crushers = new Map<string, Phaser.GameObjects.Image>();
  private pistons = new Map<string, Phaser.GameObjects.TileSprite>();
  private posts = new Map<string, Phaser.GameObjects.Image>();
  private drips: Array<{ x: number; y: number; t: number }> = [];
  private plates = new Map<string, { btns: Phaser.GameObjects.Image[]; pips: Phaser.GameObjects.Image[] }>();
  private gates = new Map<string, { bars: Phaser.GameObjects.TileSprite; tip: Phaser.GameObjects.Image }>();
  private platforms = new Map<string, Phaser.GameObjects.TileSprite>();
  private lasers = new Map<string, { beam: Phaser.GameObjects.TileSprite; emitter: Phaser.GameObjects.Image | null; vertical: boolean }>();
  private popups = new Map<string, { img: Phaser.GameObjects.Image; t: number }>();
  private movers: Phaser.GameObjects.Image[][] = [];
  private belts: Array<{ belt: Phaser.GameObjects.TileSprite; chev: Phaser.GameObjects.TileSprite; dir: number }> = [];
  private waves: Phaser.GameObjects.TileSprite[] = [];
  private caustics: Phaser.GameObjects.TileSprite[] = [];
  private vines = new Map<string, { segs: Phaser.GameObjects.Image[]; leaves: Phaser.GameObjects.Image[] }>();
  private crumbles = new Map<number, Phaser.GameObjects.Image>();
  private benches: Array<{ o: Extract<LevelObject, { type: 'bench' }>; img: Phaser.GameObjects.Image; glow: Phaser.GameObjects.Image }> = [];
  private relics: Array<{ o: Extract<LevelObject, { type: 'relic' }>; img: Phaser.GameObjects.Image }> = [];
  private lamps: Array<{ o: Extract<LevelObject, { type: 'light' }>; glow: Phaser.GameObjects.Image; color: number }> = [];
  private arrows: Array<{ img: Phaser.GameObjects.Image; x: number; y: number; dx: number; dy: number }> = [];
  private parallaxArt: Array<{ img: Phaser.GameObjects.Image; x: number; y: number; p: number }> = [];
  private fgCover: boolean[][] | null = null;
  private fogs: Phaser.GameObjects.TileSprite[] = [];
  private rainCols: number[] = [];
  private dark: Phaser.GameObjects.RenderTexture | null = null;
  /** The room's darkness with every steady light already erased (baked once). */
  private darkStatic: Phaser.GameObjects.Image | null = null;
  private brush: Phaser.GameObjects.Image | null = null;
  private darkAlpha = 0;
  /** Additive halos are toned down on the bright walls of the upper wings. */
  private haloK = 1;
  private staticLights: LightSpot[] = [];
  private rags: Ragdoll[] = [];
  private prev = new Map<string, Pos>();
  private t = 0;
  private terrainDirty = false;
  private pipAnim = { land: 0, blinkT: 2, runDist: 0, pop: 1, pushT: 0, pullT: 0, kick: 0 };
  private deadAt: Pos | null = null;
  private stuckTicks = 0;
  private humT = 0;
  // Messages.
  private signLinger = new Map<string, number>();
  private tauntT = 0;
  private tauntText = '';
  private lore: { text: string; t: number; key: string } | null = null;
  /** This view draws level.decor and level.images itself (the editor skips its own preview copy). */
  readonly drawsCustomArt = true;
  /** A one-off hint the HUD may show (once per save; consumed by the HUD). */
  hint: string | null = null;
  /** Relic just collected (consumed by the HUD for its counter animation). */
  collected: { kind: 'note' | 'jar' } | null = null;

  constructor(private scene: Phaser.Scene, public world: World, private hooks: ViewHooks, opts: ViewOptions = {}) {
    const add = scene.add;
    const lvl = world.level;
    this.act = lvl.credits ? 0 : lvl.palette ?? lvl.biome ?? lvl.act ?? 1;
    this.root = add.container(0, 0);
    this.terrainKey = `terrain_${this.id}`;
    this.waterKey = `water_${this.id}`;
    bakeTerrain(scene, this.terrainKey, this.terrainSource());
    this.terrain = add.image(0, 0, this.terrainKey).setOrigin(0);
    this.bgArt = add.container(0, 0);
    this.back = add.container(0, 0);
    this.ents = add.container(0, 0);
    this.front = add.container(0, 0);
    this.fgArt = add.container(0, 0);
    this.fxLayer = add.container(0, 0);
    this.glowLayer = add.container(0, 0);
    this.top = add.container(0, 0);
    this.root.add([this.terrain, this.bgArt, this.back, this.ents, this.front, this.fgArt, this.fxLayer]);
    this.particles = new Pixels(scene, this.fxLayer, 320);
    this.particles.solid = (x, y) => isSolidGlyph(this.world.tileAt(Math.floor(x / T), Math.floor(y / T))) || this.world.tileAt(Math.floor(x / T), Math.floor(y / T)) === '%';

    this.buildObjects();
    this.buildWorldObjects();
    this.buildArt();
    this.drips = dripPoints(this.terrainSource(), 7).map((d, i) => ({ ...d, t: 0.5 + i * 0.37 }));
    this.pipShadow = add.image(0, 0, ATLAS, 'shadow').setOrigin(0.5, 0.5);
    this.pip = add.image(0, 0, ATLAS, 'pip_idle0').setOrigin(0.5, 1);
    this.ents.add([this.pipShadow, this.pip]);

    // Coolant pools, their animated surface and caustics sit in front of bodies.
    const src = this.terrainSource();
    const surfaces = bakeWater(scene, this.waterKey, src);
    if (surfaces.length) {
      this.front.add(add.image(0, 0, this.waterKey).setOrigin(0));
      for (const s of surfaces) {
        let depth = 0;
        while (world.tileAt(Math.floor(s.x / T), Math.floor(s.y / T) + depth) === '~') depth++;
        const c = add.tileSprite(s.x, s.y + 3, s.w, Math.max(4, depth * T - 3), ATLAS, 'caustic0').setOrigin(0).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.5);
        this.caustics.push(c);
        const wv = add.tileSprite(s.x, s.y - 1, s.w, 4, ATLAS, 'wave0').setOrigin(0);
        this.waves.push(wv);
        this.front.add([c, wv]);
      }
    }

    // Labels (credits): centred on (x, y) in tiles, `size` is a scale.
    for (const o of lvl.objects) {
      if (o.type !== 'label') continue;
      const s = Math.max(1, Math.round(o.size ?? 1));
      this.top.add(ptext(scene, o.x * T, o.y * T, o.text, { scale: s, outline: true, color: 0xfff4e4, origin: [0.5, 0.5] }));
    }

    if (opts.atmosphere) this.buildAtmosphere();
    this.root.add([this.glowLayer, this.top]);
    this.snapshot();
    this.render(1, 0);
  }

  private terrainSource(): TerrainSource {
    const w = this.world;
    const extra = new Set<number>();
    for (const d of w.obj.droppers) if (d.state !== 'gone' && d.state !== 'fall') extra.add(cellKey(d.def.x, d.def.y));
    return {
      W: w.W, H: w.H, act: this.act, tileAt: (cx, cy) => w.tileAt(cx, cy), extraSolid: extra,
      decorBg: w.level.decor?.bg, decorIds: DECOR_IDS,
    };
  }

  setZoom(_z: number): void { /* pixel art renders at integer zoom; nothing to rescale */ }

  destroy(): void {
    this.root.destroy(true);
    this.brush?.destroy();
    this.darkStatic?.destroy();
    for (const k of [this.terrainKey, this.waterKey, `fg_${this.id}`, `dark_${this.id}`]) if (this.scene.textures.exists(k)) this.scene.textures.remove(k);
    for (const img of this.droppers.values()) { const k = img.texture.key; if (this.scene.textures.exists(k)) this.scene.textures.remove(k); }
    for (const a of this.parallaxArt) { const k = a.img.texture.key; if (this.scene.textures.exists(k)) this.scene.textures.remove(k); }
  }

  // ---------------------------------------------------------------------------
  // Object sprites
  // ---------------------------------------------------------------------------

  private buildObjects(): void {
    const s = this.scene, add = s.add, w = this.world, o = w.obj;
    const src = this.terrainSource();
    const lvl = w.level;

    // Sample belts: one scrolling strip per run of conveyor tiles.
    for (let cy = 0; cy < w.H; cy++) {
      let start = -1, glyph = '';
      for (let cx = 0; cx <= w.W; cx++) {
        const g = cx < w.W ? lvl.tiles[cy]![cx]! : '.';
        const conv = g === '}' || g === '{';
        if (conv && start < 0) { start = cx; glyph = g; }
        if ((!conv || g !== glyph) && start >= 0) {
          const len = (cx - start) * T;
          const belt = add.tileSprite(start * T, cy * T, len, 5, ATLAS, 'belt').setOrigin(0);
          const chev = add.tileSprite(start * T, cy * T + 1, len, 3, ATLAS, 'chevron').setOrigin(0);
          if (glyph === '{') chev.setFlipX(true);
          this.belts.push({ belt, chev, dir: glyph === '}' ? 1 : -1 });
          this.back.add([belt, chev]);
          start = conv ? cx : -1; glyph = g;
        }
      }
    }
    for (const sg of o.signs) {
      const post = add.image(sg.def.x * T + 8, sg.def.y * T + T, ATLAS, 'signpost0').setOrigin(0.5, 1);
      this.posts.set(sg.id, post);
      this.back.add(post);
    }
    for (const pl of o.plates) {
      const btns: Phaser.GameObjects.Image[] = [];
      for (let i = 0; i < pl.def.w; i++) {
        const x = (pl.def.x + i) * T, y = (pl.def.y + 1) * T;
        btns.push(add.image(x + 1, y - 3, ATLAS, 'plateBtnOff').setOrigin(0, 1));
        this.back.add(add.image(x, y, ATLAS, 'plateBase').setOrigin(0, 1));
      }
      this.back.add(btns);
      const pips: Phaser.GameObjects.Image[] = [];
      const n = Math.min(9, pl.def.need);
      const cx = (pl.def.x + pl.def.w / 2) * T;
      for (let i = 0; i < n; i++) pips.push(add.image(R(cx - (n * 4 - 1) / 2 + i * 4), (pl.def.y + 1) * T - 9, ATLAS, 'pipOff').setOrigin(0, 0));
      this.top.add(pips);
      this.plates.set(pl.id, { btns, pips });
    }
    for (const g of o.gates) {
      const bars = add.tileSprite(g.def.x * T, g.def.y * T, T, 1, ATLAS, 'gateBars').setOrigin(0);
      const tip = add.image(g.def.x * T, 0, ATLAS, 'gateTip').setOrigin(0);
      this.back.add([bars, tip]);
      this.gates.set(g.id, { bars, tip });
    }
    for (const p of o.platforms) {
      const ts = add.tileSprite(0, 0, R(P(p.w)), 4, ATLAS, p.def.oneWay ? 'bonePlank' : 'plank').setOrigin(0);
      this.back.add(ts);
      this.platforms.set(p.id, ts);
    }
    for (const c of o.crushers) {
      const key = `crusher_${c.def.w}x${c.def.h}`;
      crusherTexture(s, key, c.def.w, c.def.h);
      const rod = add.tileSprite(0, 0, 8, 8, ATLAS, 'piston').setOrigin(0).setVisible(false);
      const img = add.image(0, 0, key).setOrigin(0);
      this.back.add([rod, img]);
      this.crushers.set(c.id, img);
      this.pistons.set(c.id, rod);
    }
    for (const d of o.droppers) {
      const key = `dropper_${this.id}_${d.id}`;
      stoneTexture(s, key, src, d.def.x, d.def.y);
      const img = add.image(0, 0, key).setOrigin(0, 0);
      this.back.add(img);
      this.droppers.set(d.id, img);
    }
    for (const l of o.lasers) {
      const vertical = l.def.dir === 'up' || l.def.dir === 'down';
      const beam = add.tileSprite(0, 0, 16, 16, ATLAS, vertical ? 'beam0' : 'beamh0').setOrigin(0).setVisible(false);
      let emitter: Phaser.GameObjects.Image | null = null;
      if (l.def.emitter) {
        emitter = add.image(l.def.x * T + 8, l.def.y * T + 8, ATLAS, 'emitter').setOrigin(0.5);
        emitter.setAngle({ down: 0, left: 90, up: 180, right: 270 }[l.def.dir]);
      }
      this.front.add(beam);
      if (emitter) this.back.add(emitter);
      this.lasers.set(l.id, { beam, emitter, vertical });
    }
    for (const p of o.popups) {
      const img = add.image(p.def.x * T, p.def.y * T, ATLAS, 'pop0').setOrigin(0).setVisible(false);
      this.back.add(img);
      this.popups.set(p.id, { img, t: 0 });
    }
    for (const d of o.doors) {
      const halo = add.image(0, 0, ATLAS, 'halo').setOrigin(0.5).setAlpha(0.8).setTint(KEY.j!);
      const img = add.image(0, 0, ATLAS, d.def.runaway ? 'doorLegs_stand' : 'door').setOrigin(0.5, 1);
      const smirk = add.image(0, 0, ATLAS, 'doorSmirk').setOrigin(0.5).setVisible(false);
      this.back.add([halo, img, smirk]);
      this.doors.set(d.id, { img, halo, smirk });
    }
  }

  /** Connected-world objects: vines, crumbling floors, benches, relics, lights and exits. */
  private buildWorldObjects(): void {
    const s = this.scene, add = s.add, w = this.world, lvl = w.level;
    for (const v of w.obj.vines) {
      const cable = this.act >= 3 && v.id.charCodeAt(v.id.length - 1) % 2 === 0;
      const segs = v.pts.slice(1).map(() => add.image(0, 0, ATLAS, cable ? 'cableSeg' : 'vineSeg').setOrigin(0.5, 0));
      const leaves = cable ? [] : v.pts.filter((_, i) => i % 2 === 1).map(() => add.image(0, 0, ATLAS, 'leaf').setOrigin(0.5));
      this.ents.add([...segs, ...leaves]);
      this.vines.set(v.id, { segs, leaves });
    }
    crumbleTexture(s, `crumble${this.act}`, this.act);
    for (let cy = 0; cy < w.H; cy++) for (let cx = 0; cx < w.W; cx++) if (lvl.tiles[cy]![cx] === '%') {
      const img = add.image(cx * T, cy * T, `crumble${this.act}`).setOrigin(0);
      this.back.add(img);
      this.crumbles.set(cellKey(cx, cy), img);
    }
    for (const o of lvl.objects) {
      if (o.type === 'bench') {
        const glow = add.image(o.x * T + 8, o.y * T + 6, ATLAS, 'halo').setTint(KEY.j!).setAlpha(0);
        const img = add.image(o.x * T + 8, (o.y + 1) * T, ATLAS, 'bench0').setOrigin(0.5, 1);
        this.back.add([glow, img]);
        this.benches.push({ o, img, glow });
      } else if (o.type === 'relic') {
        const img = add.image(o.x * T + 8, o.y * T + 8, ATLAS, o.kind === 'note' ? 'note' : 'jar').setOrigin(0.5);
        this.back.add(img);
        this.relics.push({ o, img });
      } else if (o.type === 'light') {
        const color = o.color ? parseInt(o.color.replace('#', ''), 16) : actPal(this.act).light;
        const glow = add.image(o.x * T + 8, o.y * T + 8, ATLAS, 'halo').setTint(color).setBlendMode(Phaser.BlendModes.ADD).setScale((o.radius ?? 4) / 2.5).setAlpha(0.35);
        this.glowLayer.add(glow);
        const above = isSolidGlyph(w.tileAt(o.x, o.y - 1));
        if (above) this.back.add(add.image(o.x * T + 8, o.y * T, ATLAS, 'lamp').setOrigin(0.5, 0));
        this.lamps.push({ o, glow, color });
      }
    }
    for (const e of lvl.exits ?? []) {
      const side = e.x <= 0 ? 'left' : e.x + e.w >= w.W ? 'right' : e.y <= 0 ? 'top' : 'bottom';
      const cx = (e.x + e.w / 2) * T, cy = (e.y + e.h / 2) * T;
      const [x, y, dx, dy, ang] = side === 'left' ? [10, cy, -1, 0, 180] : side === 'right' ? [w.W * T - 10, cy, 1, 0, 0] : side === 'top' ? [cx, 10, 0, -1, 270] : [cx, w.H * T - 10, 0, 1, 90];
      const img = add.image(x, y, ATLAS, 'arrow').setAngle(ang).setAlpha(0.7);
      this.top.add(img);
      this.arrows.push({ img, x, y, dx, dy });
    }
  }

  /** Editor art layers: fg decor and pixel-art images. */
  private buildArt(): void {
    const s = this.scene, lvl = this.world.level;
    if (lvl.decor?.fg?.some((r) => /[^.]/.test(r))) {
      this.fgCover = bakeDecorLayer(s, `fg_${this.id}`, lvl.decor.fg, this.world.W, this.world.H, this.act, DECOR_IDS);
      this.fgArt.add(s.add.image(0, 0, `fg_${this.id}`).setOrigin(0));
    }
    (lvl.images ?? []).forEach((art, i) => {
      const key = `art_${this.id}_${i}`;
      if (!pixelArtTexture(s, key, art)) return;
      const img = s.add.image(R(art.x * T), R(art.y * T), key).setOrigin(0).setAlpha(art.opacity ?? 1);
      (art.layer === 'fg' ? this.fgArt : this.bgArt).add(img);
      this.parallaxArt.push({ img, x: R(art.x * T), y: R(art.y * T), p: art.parallax ?? 1 });
    });
  }

  private buildAtmosphere(): void {
    const s = this.scene, w = this.world, lvl = w.level;
    const pal = actPal(this.act);
    this.darkAlpha = lvl.credits ? 0 : this.act === 4 ? 0.7 : this.act === 3 ? 0.62 : this.act === 2 ? 0.42 : 0.22;
    // Static light: trim strips along open floors and ceilings, sign monitors, lamps.
    const solid = (cx: number, cy: number) => isSolidGlyph(w.tileAt(cx, cy));
    for (let cy = 1; cy < w.H; cy++) for (let cx = 1; cx < w.W - 1; cx += 2) {
      if (solid(cx, cy) && !solid(cx, cy - 1)) this.staticLights.push({ x: cx * T + 8, y: cy * T + 4, r: 12 });
    }
    for (const sg of w.obj.signs) this.staticLights.push({ x: sg.def.x * T + 8, y: sg.def.y * T + 9, r: 16, flicker: 1 });
    for (const o of lvl.objects) {
      if (o.type === 'light') this.staticLights.push({ x: o.x * T + 8, y: o.y * T + 8, r: (o.radius ?? 4) * T * (this.act <= 2 ? 0.62 : 0.8), flicker: o.flicker ? 2 : 0 });
    }
    this.haloK = this.act <= 2 ? 0.45 : 0.8;
    if (this.darkAlpha > 0) {
      this.brush = s.make.image({ key: ATLAS, frame: 'light' }, false);
      // Bake the steady lights once (on a canvas) into a room-sized darkness map; each frame only copies
      // the visible part into a view-sized texture and erases the moving lights (Pip, doors, lasers...).
      const key = `dark_${this.id}`;
      if (s.textures.exists(key)) s.textures.remove(key);
      const tex = s.textures.createCanvas(key, w.W * T, w.H * T)!;
      const ctx = tex.getContext();
      const k = KEY.k!;
      ctx.fillStyle = `rgba(${k >> 16},${(k >> 8) & 255},${k & 255},${this.darkAlpha})`;
      ctx.fillRect(0, 0, w.W * T, w.H * T);
      ctx.globalCompositeOperation = 'destination-out';
      for (const l of this.staticLights) {
        if (l.flicker) continue;
        // Banded falloff, so the light reads as pixel art rather than a smooth airbrush.
        const g = ctx.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.r);
        g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.35, 'rgba(0,0,0,1)');
        g.addColorStop(0.36, 'rgba(0,0,0,0.7)'); g.addColorStop(0.62, 'rgba(0,0,0,0.7)');
        g.addColorStop(0.63, 'rgba(0,0,0,0.38)'); g.addColorStop(0.85, 'rgba(0,0,0,0.38)');
        g.addColorStop(0.86, 'rgba(0,0,0,0.15)'); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(l.x - l.r, l.y - l.r, l.r * 2, l.r * 2);
      }
      tex.refresh();
      this.darkStatic = s.make.image({ x: 0, y: 0, key }, false).setOrigin(0);
      this.makeDarkRT();
    }
    // Fog bands in the wetter, deeper wings.
    if (this.act >= 2) for (let i = 0; i < 2; i++) {
      const y = R(w.H * T * (0.35 + i * 0.35));
      const f = s.add.tileSprite(0, y, w.W * T, 20, ATLAS, 'fog').setOrigin(0).setAlpha(this.act === 3 ? 0.18 : 0.24).setTint(pal.mote);
      this.fogs.push(f);
      this.front.add(f);
    }
    // Rain/drips through broken roofs: open cells in the top row.
    for (let cx = 1; cx < w.W - 1; cx++) if (!solid(cx, 0) && w.tileAt(cx, 0) !== '%') this.rainCols.push(cx);
  }

  // ---------------------------------------------------------------------------
  // Interpolation
  // ---------------------------------------------------------------------------

  /** Record object positions before a sim step (for interpolation). */
  snapshot(): void {
    const o = this.world.obj;
    for (const d of o.droppers) this.prev.set(d.id, { x: d.x, y: d.y });
    for (const c of o.crushers) this.prev.set(c.id, { x: c.x, y: c.y });
    for (const p of o.platforms) this.prev.set(p.id, { x: p.x, y: p.y });
    for (const d of o.doors) this.prev.set(d.id, { x: d.x, y: d.y });
    o.movers.forEach((m, i) => this.prev.set(`mover${i}`, { x: m.ox, y: m.oy }));
  }

  private ip(id: string, x: number, y: number, a: number): Pos {
    const p = this.prev.get(id);
    if (!p) return { x, y };
    return { x: lerp(p.x, x, a), y: lerp(p.y, y, a) };
  }

  // ---------------------------------------------------------------------------
  // Sim events -> juice
  // ---------------------------------------------------------------------------

  onEvents(events: readonly SimEvent[]): void {
    const w = this.world;
    const fx = this.particles;
    for (const e of events) {
      switch (e.t) {
        case 'jump':
          fx.dust(P(e.x), P(e.y), 4);
          audio.play('jump', 1 + rng.range(-0.06, 0.06));
          break;
        case 'land': {
          const near = w.pipAlive && Math.abs(e.x - (w.pip.x + w.pip.w / 2)) < 40 && Math.abs(e.y - (w.pip.y + w.pip.h)) < 8;
          const k = Math.min(1, e.impact / 60);
          fx.dust(P(e.x), P(e.y), near ? 3 + Math.round(4 * k) : 4);
          if (near) {
            this.pipAnim.land = 0.09 + k * 0.06;
            audio.play('land', 1, 0.5 + k * 0.6);
            const sup = w.supports.get(-1);
            if (sup?.kind === 'corpse') {
              const cs = this.corpses.get(sup.id);
              if (cs) cs.squash = 0.12;
              if (w.corpseById(sup.id)?.stage === 2) audio.play('clack');
            }
          } else audio.play('land', 0.8, 0.5);
          break;
        }
        case 'bounce': {
          const cs = this.corpses.get(e.corpse);
          if (cs) cs.squash = 0.2;
          fx.puff(P(e.x), P(e.y), 6, 6, KEY.h!);
          audio.play('boing'); audio.play('blorp', 1.2, 0.6);
          break;
        }
        case 'push': {
          const c = w.corpseById(e.corpse);
          if (c) {
            const away = w.pip.vx !== 0 && Math.sign(w.pip.vx) !== Math.sign(c.x + c.w / 2 - (w.pip.x + w.pip.w / 2));
            if (away) this.pipAnim.pullT = 0.2; else this.pipAnim.pushT = 0.2;
            fx.dust(P(c.x + (w.pip.x < c.x ? 0 : c.w)), P(c.y + c.h), 2);
            audio.play('push');
          }
          break;
        }
        case 'death': {
          this.deadAt = { x: P(w.pip.x + w.pip.w / 2), y: P(w.pip.y + w.pip.h) };
          this.hooks.flash();
          this.hooks.shake(SHAKE[e.kind]);
          this.hooks.punch(e.kind === 'pit' ? 0 : 0.07);
          const x = P(e.x), y = P(e.y);
          audio.play('squeak', 1 + rng.range(-0.08, 0.08));
          if (e.kind === 'laser') { fx.sparks(x, y, 22); fx.sparks(x, y, 10, 0xffffff); fx.puff(x, y, 8, 6, KEY.X!); audio.play('zap'); }
          else if (e.kind === 'water') { fx.splash(x, y); audio.play('splash'); }
          else if (e.kind === 'pit') audio.play('whistle');
          else {
            fx.sparkle(x, y - 4, 6);
            audio.play('squish', 1, e.kind === 'crusher' ? 1.2 : 0.8);
            if (e.kind === 'crusher' || e.kind === 'dropper') fx.debris(x, y + 4, 8);
            if (e.kind !== 'crusher') this.spawnRagdoll(x, y, e.kind === 'spike' ? -110 : -150);
            else fx.puff(x, y, 7, 6);
          }
          break;
        }
        case 'corpse': {
          const c = w.corpseById(e.id);
          this.deadAt = null;
          if (c) {
            const cs = this.corpseSprite(c);
            const rag = this.rags.find((r) => !r.target);
            if (rag && c.kind !== 'crate') {
              rag.target = { x: P(c.x + c.w / 2), y: P(c.y + c.h / 2) };
              cs.hideUntil = this.t + Math.max(0.05, 0.42 - rag.t);
            } else { fx.puff(P(c.x + c.w / 2), P(c.y + c.h / 2), 6, 5); cs.pop = 0.25; }
          }
          break;
        }
        case 'age': {
          const c = w.corpseById(e.id);
          if (c) {
            fx.puff(P(c.x + c.w / 2), P(c.y + c.h / 2), 7, 5, e.stage === 1 ? KEY.h! : KEY.o!);
            const cs = this.corpses.get(e.id);
            if (cs) cs.pop = 0.2;
          }
          audio.play(e.stage === 1 ? 'blorp' : 'clack');
          break;
        }
        case 'dust':
          fx.bones(P(e.x), P(e.y), 6);
          fx.puff(P(e.x), P(e.y), 10, 8, KEY.o!);
          audio.play('poof');
          this.dropCorpse(e.id);
          break;
        case 'vaporize':
          fx.sparks(P(e.x), P(e.y), 20);
          fx.puff(P(e.x), P(e.y), 8, 7, KEY.X!);
          audio.play('zap', 0.8);
          this.dropCorpse(e.id);
          break;
        case 'pin': audio.play('pin'); break;
        case 'flatten': {
          const c = w.corpseById(e.id);
          if (c) fx.puff(P(c.x + c.w / 2), P(c.y + c.h), 8, 7);
          audio.play('squish', 0.8);
          break;
        }
        case 'splash': fx.splash(P(e.x), P(e.y), 10); audio.play('splash', 1.1, 0.7); break;
        case 'respawn': {
          this.pipAnim.pop = 0;
          fx.puff(P(e.x), P(e.y) - 6, 10, 7);
          fx.sparkle(P(e.x), P(e.y) - 8, 4, KEY.z!);
          audio.play('pop');
          const taunt = tauntFor(w.deathCount);
          if (taunt) { this.tauntText = taunt; this.tauntT = 2.2; }
          this.terrainDirty = true;
          break;
        }
        case 'restart':
          for (const id of [...this.corpses.keys()]) this.dropCorpse(id);
          fx.puff(P(w.pip.x + w.pip.w / 2), P(w.pip.y + w.pip.h) - 6, 10, 7);
          this.pipAnim.pop = 0;
          this.terrainDirty = true;
          audio.play('poof');
          break;
        case 'plate': audio.play('click', e.down ? 1 : 0.8); break;
        case 'gate': audio.play('gate', e.open ? 1 : 0.85); break;
        case 'popSpike': {
          const p = this.popups.get(e.id);
          if (p) { p.t = 0; fx.dust(p.img.x + 8, p.img.y + T, 6); }
          audio.play('shing');
          break;
        }
        case 'dropperShake': audio.play('rumble'); break;
        case 'dropperFall': audio.play('whistle', 0.7, 0.6); this.terrainDirty = true; break;
        case 'dropperBreak':
          fx.debris(P(e.x), P(e.y), 12);
          fx.dust(P(e.x), P(e.y), 8);
          this.hooks.shake(0.35);
          audio.play('slam', 1.3, 0.6);
          break;
        case 'crusherSlam': {
          const c = w.obj.get<RtCrusher>(e.id);
          if (c) { fx.debris(P(c.x + c.w / 2), P(c.y + c.h), 10); fx.dust(P(c.x + c.w / 2), P(c.y + c.h), 10); }
          this.hooks.shake(0.6);
          audio.play('slam');
          break;
        }
        case 'laserZap': break;
        case 'laserReveal': this.hooks.shake(0.3); this.hooks.flash(); audio.play('zap', 1.2); break;
        case 'tiles': this.terrainDirty = true; break;
        case 'tilesDrop':
          for (const c of e.cells) fx.debris(c.x * T + 8, c.y * T + 8, 5);
          this.hooks.shake(0.4);
          audio.play('slam', 0.8, 0.6);
          break;
        case 'crumble':
          for (const c of e.cells) { fx.debris(c.x * T + 8, c.y * T + 6, 6); fx.puff(c.x * T + 8, c.y * T + 8, 4, 4, 0xd9d2c2); }
          audio.play('crumble');
          break;
        case 'sign': audio.play('tock'); break;
        case 'doorHop': audio.play('boing', 1.4); audio.play('scurry'); break;
        case 'doorScurry': audio.play('scurry'); break;
        case 'shake': this.hooks.shake(Math.min(1, e.strength)); break;
        case 'sfx': if (e.name === 'jingle') audio.jingle(); else audio.play(e.name); break;
        case 'win':
          fx.confetti(P(e.x), P(e.y) - 4, 46);
          fx.sparkle(P(e.x), P(e.y), 12, KEY.z!);
          audio.jingle();
          break;
        case 'wallSlide':
          if (rng.next() < 0.5) fx.spawn(P(e.x), P(e.y) - rng.range(2, 10), { frame: 'p1', tint: 0xe8e2d6, vx: rng.range(-8, 8), vy: rng.range(-14, -4), life: 0.3 });
          break;
        case 'wallJump':
          this.pipAnim.kick = 0.12;
          fx.puff(P(e.x), P(e.y), 5, 5);
          for (let i = 0; i < 4; i++) fx.spawn(P(e.x), P(e.y) + rng.range(-4, 4), { frame: 'p2', tint: 0xe8e2d6, vx: -e.dir * rng.range(20, 50), vy: rng.range(-20, 10), drag: 4, life: 0.35 });
          audio.play('wallJump');
          break;
        case 'grab': audio.play('grab'); break;
        case 'release': break;
        case 'checkpoint': {
          const b = this.benches.find((x) => x.o.id === e.id);
          if (b) { fx.sparkle(b.img.x, b.img.y - 10, 12, KEY.j!); fx.puff(b.img.x, b.img.y - 6, 8, 6, KEY.j!); this.scene.tweens.add({ targets: b.glow, alpha: { from: 1, to: 0.55 }, duration: 600 }); }
          audio.play('checkpoint');
          break;
        }
        case 'collect': {
          const r = this.relics.find((x) => x.o.id === e.id);
          if (r) { fx.sparkle(r.img.x, r.img.y, 14, e.kind === 'jar' ? KEY.c! : 0xffffff); fx.puff(r.img.x, r.img.y, 6, 5, KEY.z!); }
          if (e.kind === 'note' && r?.o.text) this.lore = { text: r.o.text, t: 7, key: `lore:${e.id}` };
          this.collected = { kind: e.kind };
          audio.play('collect');
          break;
        }
        case 'exit': break;
        case 'step': break;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Messages: one at a time; the HUD shows it in a caption bar away from the playfield action.
  // ---------------------------------------------------------------------------

  message(): ViewMessage | null {
    const w = this.world;
    if (this.lore) return { key: this.lore.key, text: this.lore.text, kind: 'lore' };
    if (w.suggestRestart && w.pipAlive) return { key: 'stuck', text: 'Stuck? Press R to clear the bodies and restart.', kind: 'stuck' };
    for (const [id, t] of this.signLinger) {
      if (t < 0.4) continue;
      const s = w.obj.signs.find((x) => x.id === id);
      const text = s ? signText(w, s) : '';
      if (text) return { key: `sign:${id}:${text}`, text, kind: 'sign' };
    }
    if (this.tauntT > 0 && this.tauntText) return { key: `taunt:${w.deathCount}`, text: this.tauntText, kind: 'taunt' };
    return null;
  }

  // ---------------------------------------------------------------------------
  // Corpses and ragdolls
  // ---------------------------------------------------------------------------

  private corpseSprite(c: Corpse): CorpseSpr {
    let cs = this.corpses.get(c.id);
    if (!cs) {
      const img = this.scene.add.image(0, 0, ATLAS, c.kind === 'crate' ? 'crate' : corpseFrame(c.stage, 'body')).setOrigin(0.5, 1);
      cs = { img, flies: [], squash: 0, pop: 0, seed: rng.range(0, 100), hideUntil: 0 };
      this.ents.addAt(img, 0);
      this.corpses.set(c.id, cs);
    }
    return cs;
  }

  private dropCorpse(id: number): void {
    const cs = this.corpses.get(id);
    if (!cs) return;
    cs.img.destroy();
    for (const f of cs.flies) f.destroy();
    this.corpses.delete(id);
  }

  /** A cosmetic 4-point verlet ragdoll that tumbles before the real body appears. */
  private spawnRagdoll(x: number, y: number, pop: number): void {
    const vx = rng.range(-60, 60);
    const mk = (dx: number, dy: number): RagPt => ({ x: x + dx, y: y + dy, px: x + dx - vx / 60, py: y + dy - pop / 60 });
    const head = this.scene.add.image(x, y, ATLAS, 'ragHead');
    const limbs = [0, 1, 2].map(() => this.scene.add.image(x, y, ATLAS, 'ragLimb'));
    this.ents.add([...limbs, head]);
    this.rags.push({ pts: [mk(0, -9), mk(0, -4), mk(-3, 0), mk(3, 0)], t: 0, head, limbs, target: null });
  }

  private updateRagdolls(dt: number): void {
    const solid = this.particles.solid!;
    const LINKS: Array<[number, number, number]> = [[0, 1, 5], [1, 2, 5], [1, 3, 5], [2, 3, 6], [0, 2, 9], [0, 3, 9]];
    for (let k = this.rags.length - 1; k >= 0; k--) {
      const r = this.rags[k]!;
      r.t += dt;
      const steer = r.target && r.t > 0.25 ? Math.min(1, (r.t - 0.25) / 0.2) : 0;
      for (const p of r.pts) {
        const vx = (p.x - p.px) * 0.99, vy = (p.y - p.py) * 0.99;
        p.px = p.x; p.py = p.y;
        let nx = p.x + vx, ny = p.y + vy + 520 * dt * dt;
        if (solid(nx, ny)) { if (solid(nx, p.y)) { nx = p.x; p.px = p.x + vx * 0.5; } if (solid(p.x, ny)) { ny = p.y; p.py = p.y + vy * 0.4; } }
        if (steer && r.target) { nx = lerp(nx, r.target.x, steer * 0.25); ny = lerp(ny, r.target.y, steer * 0.25); }
        p.x = nx; p.y = ny;
      }
      for (let it = 0; it < 3; it++) for (const [a, b, len] of LINKS) {
        const A = r.pts[a]!, B = r.pts[b]!;
        const dx = B.x - A.x, dy = B.y - A.y, d = Math.hypot(dx, dy) || 1, f = (d - len) / d / 2;
        A.x += dx * f; A.y += dy * f; B.x -= dx * f; B.y -= dy * f;
      }
      const [h, b, f1, f2] = r.pts as [RagPt, RagPt, RagPt, RagPt];
      r.head.setPosition(R(h.x), R(h.y)).setRotation(Math.round((Math.atan2(h.y - b.y, h.x - b.x) + Math.PI / 2) / (Math.PI / 4)) * (Math.PI / 4));
      r.limbs[0]!.setPosition(R(b.x), R(b.y));
      r.limbs[1]!.setPosition(R(f1.x), R(f1.y));
      r.limbs[2]!.setPosition(R(f2.x), R(f2.y));
      const done = r.target ? r.t > 0.45 : r.t > 1.4;
      if (done) {
        if (r.target) this.particles.puff(r.target.x, r.target.y, 6, 5);
        r.head.destroy(); r.limbs.forEach((l) => l.destroy());
        this.rags.splice(k, 1);
      }
    }
  }

  private drawCorpses(alpha: number, dt: number): void {
    const w = this.world;
    const alive = new Set<number>();
    for (const c of w.corpses) {
      alive.add(c.id);
      const cs = this.corpseSprite(c);
      const x = P(lerp(c.px, c.x, alpha) + c.w / 2);
      const top = P(lerp(c.py, c.y, alpha));
      const bot = P(lerp(c.py, c.y, alpha) + c.h);
      cs.img.setVisible(this.t >= cs.hideUntil);
      if (cs.hideUntil > 0 && this.t >= cs.hideUntil) { cs.hideUntil = 0; cs.pop = 0.25; }
      if (c.kind === 'crate') { cs.img.setFrame('crate').setOrigin(0.5, 1).setPosition(R(x), R(bot)); continue; }
      const look: Look = c.pin?.kind === 'floor' ? 'floor' : c.pin?.kind === 'wall' ? 'wall' : c.shape === 'slab' ? 'slab' : 'body';
      cs.img.setFrame(corpseFrame(c.stage, look));
      let jx = 0;
      if (c.shiver > 0) jx = (Math.floor(this.t * 60) % 2) * 2 - 1;
      cs.squash = Math.max(0, cs.squash - dt);
      cs.pop = Math.max(0, cs.pop - dt);
      const pop = cs.pop > 0 ? 1 + Math.sin((cs.pop / 0.25) * Math.PI) * 0.25 : 1;
      if (look === 'wall') {
        const leftWall = w.tileAt(c.pin!.cx, c.pin!.cy) === '>';
        cs.img.setOrigin(0.5, 0).setFlipX(!leftWall).setPosition(R(x) + jx, R(top) - 1);
      } else {
        cs.img.setOrigin(0.5, 1).setFlipX(false).setPosition(R(x) + jx, R(bot) + (cs.squash > 0 ? 1 : 0));
      }
      cs.img.setScale(pop, cs.squash > 0 ? 0.8 : pop);
      const want = c.stage === 1 && cs.img.visible ? 2 : 0;
      while (cs.flies.length < want) { const f = this.scene.add.image(0, 0, ATLAS, 'fly0'); this.ents.add(f); cs.flies.push(f); }
      while (cs.flies.length > want) cs.flies.pop()!.destroy();
      cs.flies.forEach((f, i) => {
        const a = this.t * (2.2 + i * 0.7) + cs.seed + i * 2.6;
        f.setPosition(R(x + Math.cos(a) * (6 + i * 2)), R(top - 4 - Math.abs(Math.sin(a * 1.3)) * 4));
        f.setFrame(Math.floor(this.t * 20 + i) % 2 ? 'fly0' : 'fly1');
      });
    }
    for (const id of [...this.corpses.keys()]) if (!alive.has(id)) this.dropCorpse(id);
  }

  // ---------------------------------------------------------------------------
  // Frame
  // ---------------------------------------------------------------------------

  render(alpha: number, dt: number): void {
    this.t += dt;
    const w = this.world, o = w.obj;
    if (this.terrainDirty) {
      bakeTerrain(this.scene, this.terrainKey, this.terrainSource());
      this.terrainDirty = false;
    }
    this.particles.update(dt);
    this.updateRagdolls(dt);

    // Belts, water, caustics, fog.
    const beltPx = R(this.t * 30) % 16;
    for (const b of this.belts) b.chev.tilePositionX = -b.dir * beltPx;
    const wf = `wave${Math.floor(this.t * 6) % 4}`;
    for (const wv of this.waves) { wv.setFrame(wf); wv.tilePositionX = R(this.t * 6); }
    for (const c of this.caustics) { c.setFrame(Math.floor(this.t * 3) % 2 ? 'caustic1' : 'caustic0'); c.tilePositionX = R(this.t * 5); c.tilePositionY = R(Math.sin(this.t) * 3); }
    this.fogs.forEach((f, i) => { f.tilePositionX = R(this.t * (4 + i * 3)); });

    // Droppers, crushers, platforms, movers.
    for (const d of o.droppers) {
      const img = this.droppers.get(d.id);
      if (!img) continue;
      img.setVisible(d.state !== 'gone');
      const p = this.ip(d.id, d.x, d.y, alpha);
      const shaking = d.state === 'shake' || d.state === 'armed';
      const jx = shaking ? (Math.floor(this.t * 40) % 2) * 2 - 1 : 0;
      img.setPosition(R(P(p.x)) + jx, R(P(p.y)) - 3);
      if (shaking && rng.next() < dt * 20) this.particles.spawn(P(d.x) + rng.range(2, 14), P(d.y + d.h), { frame: 'p1', tint: 0xcbbca8, vy: 30, g: 80, life: 0.4 });
    }
    for (const c of o.crushers) {
      const img = this.crushers.get(c.id);
      if (!img) continue;
      const p = this.ip(c.id, c.x, c.y, alpha);
      img.setPosition(R(P(p.x)), R(P(p.y)));
      const rod = this.pistons.get(c.id);
      const len = R(P(p.y - c.homeY));
      if (rod) rod.setVisible(len > 0).setPosition(R(P(p.x + c.w / 2)) - 4, R(P(c.homeY))).setSize(8, Math.max(1, len + 1));
    }
    for (const p of o.platforms) {
      const ts = this.platforms.get(p.id);
      if (!ts) continue;
      const q = this.ip(p.id, p.x, p.y, alpha);
      ts.setPosition(R(P(q.x)), R(P(q.y)));
    }
    this.drawMovers(alpha);

    // Plates and gates.
    for (const pl of o.plates as RtPlate[]) {
      const v = this.plates.get(pl.id);
      if (!v) continue;
      for (const b of v.btns) { b.setFrame(pl.pressed ? 'plateBtnOn' : 'plateBtnOff'); b.y = (pl.def.y + 1) * T - (pl.pressed ? 2 : 3); }
      v.pips.forEach((pp, i) => pp.setFrame(i < pl.weight ? 'pipOn' : 'pipOff'));
    }
    for (const g of o.gates) {
      const v = this.gates.get(g.id);
      if (!v) continue;
      const h = R(P(gateBox(g).h));
      v.bars.setVisible(h > 0).setSize(T, Math.max(1, h));
      v.bars.tilePositionY = -h;
      v.tip.setVisible(h > 0).setPosition(g.def.x * T, g.def.y * T + h - 1);
    }

    for (const p of o.popups) {
      const v = this.popups.get(p.id);
      if (!v) continue;
      v.img.setVisible(p.up);
      if (p.up) { v.t += dt; v.img.setFrame(`pop${Math.min(3, Math.floor(v.t * 40))}`); }
      else v.t = 0;
    }

    // Lasers (with a quiet hum).
    const bf = Math.floor(this.t * 24) % 3;
    this.humT -= dt;
    for (const l of o.lasers) {
      const v = this.lasers.get(l.id);
      if (!v) continue;
      const bx = l.beam;
      const hiddenNow = !!l.def.hidden && !w.revealed.has(l.id);
      if (bx.w <= 0 || hiddenNow) { v.beam.setVisible(false); continue; }
      if (l.active && this.humT <= 0) {
        const p = w.pip, near = w.pipAlive && Math.abs(p.x + p.w / 2 - (bx.x + bx.w / 2)) < bx.w / 2 + 2 * U && Math.abs(p.y + p.h / 2 - (bx.y + bx.h / 2)) < bx.h / 2 + 2 * U;
        if (near || !l.wasActive) { audio.play('hum', 1, near ? 0.35 : 0.25); this.humT = 1.1; }
      }
      const x = R(P(bx.x)), y = R(P(bx.y)), bw = R(P(bx.w)), bh = R(P(bx.h));
      if (v.vertical) v.beam.setPosition(x - 6, y).setSize(16, bh);
      else v.beam.setPosition(x, y - 6).setSize(bw, 16);
      v.beam.setVisible(true);
      v.beam.setFrame(l.active ? (v.vertical ? `beam${bf}` : `beamh${bf}`) : v.vertical ? 'beamOffV' : 'beamOffH');
      if (v.vertical) v.beam.tilePositionY = l.active ? R(this.t * 40) % 16 : 0;
      else v.beam.tilePositionX = l.active ? R(this.t * 40) % 16 : 0;
      if (v.emitter) v.emitter.setTint(l.active ? 0xffffff : 0xb7aec6);
      if (l.active && rng.next() < dt * 6) this.particles.spawn(x + rng.range(0, Math.max(1, bw)), y + rng.range(0, Math.max(1, bh)), { frame: 'p1', tint: KEY.X!, vy: rng.range(-12, 12), vx: rng.range(-12, 12), life: 0.3 });
    }

    for (const d of o.doors as RtDoor[]) {
      const v = this.doors.get(d.id);
      if (!v) continue;
      const p = this.ip(d.id, d.x, d.y, alpha);
      const cx = R(P(p.x + d.w / 2)), by = R(P(p.y + d.h));
      let frame = 'door', jx = 0;
      if (d.def.runaway) {
        if (d.state === 'run') frame = Math.floor(this.t * 14) % 2 ? 'doorLegs_runA' : 'doorLegs_runB';
        else if (d.state === 'hop') frame = 'doorLegs_hop';
        else frame = 'doorLegs_stand';
        if (d.state === 'tremble') jx = (Math.floor(this.t * 30) % 2) * 2 - 1;
        v.img.setFlipX(d.facing === 1);
      }
      v.img.setFrame(frame).setPosition(cx + jx, by);
      v.smirk.setVisible(d.state === 'hop').setPosition(cx, by - 9);
      v.halo.setPosition(cx, by - 8).setAlpha(0.55 + Math.sin(this.t * 3) * 0.2);
      if (rng.next() < dt * 3) this.particles.motes(cx + rng.range(-6, 6), by - rng.range(0, 14), KEY.j!);
    }

    this.drawWorldObjects(dt);
    this.drawCorpses(alpha, dt);
    this.drawPip(alpha, dt);
    this.drawArt();
    this.updateSigns(dt);
    this.updateAmbience(dt);
    this.drawLighting();
  }

  private drawWorldObjects(dt: number): void {
    const w = this.world;
    for (const v of w.obj.vines) {
      const s = this.vines.get(v.id);
      if (!s) continue;
      for (let i = 0; i < s.segs.length; i++) {
        const a = v.pts[i]!, b = v.pts[i + 1]!;
        const ax = P(a.x), ay = P(a.y), bx = P(b.x), by = P(b.y);
        const len = Math.max(1, Math.hypot(bx - ax, by - ay));
        s.segs[i]!.setPosition(R(ax), R(ay)).setRotation(Math.atan2(by - ay, bx - ax) - Math.PI / 2).setScale(1, (len + 1) / 6);
      }
      s.leaves.forEach((lf, k) => {
        const p = v.pts[k * 2 + 1]!;
        lf.setPosition(R(P(p.x)) + (k % 2 ? 2 : -2), R(P(p.y))).setFlipX(k % 2 === 1);
      });
    }
    for (const [k, img] of this.crumbles) {
      const cx = k % 1000, cy = Math.floor(k / 1000);
      const here = w.tileAt(cx, cy) === '%';
      img.setVisible(here);
      if (!here) continue;
      const t = w.obj.crumble.get(k) ?? 0;
      const jx = t > 0 ? (Math.floor(this.t * 50 + cx) % 3) - 1 : 0;
      img.setPosition(cx * T + jx, cy * T + (t > 20 ? 1 : 0));
      if (t > 0 && rng.next() < dt * 25) this.particles.spawn(cx * T + rng.range(1, 15), (cy + 1) * T, { frame: 'p1', tint: 0xcfc6b8, vy: 20, g: 200, life: 0.5, hit: 'die' });
    }
    const cp = w.checkpoint;
    for (const b of this.benches) {
      const active = !!cp && cp.x === b.o.x * U + ((U - PIP_W) >> 1) && cp.y === b.o.y * U + U - PIP_H;
      b.img.setFrame(active && Math.sin(this.t * 9) > -0.8 ? 'bench1' : 'bench0');
      if (active) b.glow.setAlpha(Math.max(b.glow.alpha * 0.98, 0.45 + Math.sin(this.t * 2.5) * 0.12));
      else b.glow.setAlpha(0);
    }
    for (const r of this.relics) {
      const got = w.collected.has(r.o.id);
      r.img.setVisible(!got);
      if (got) continue;
      r.img.setY(r.o.y * T + 8 + R(Math.sin(this.t * 2.4 + r.o.x) * 1.5));
      if (rng.next() < dt * 2) this.particles.spawn(r.img.x + rng.range(-5, 5), r.img.y + rng.range(-5, 5), { frames: ['spark', 'p3', 'p1'], tint: r.o.kind === 'jar' ? KEY.a! : KEY.z!, vy: -6, life: 0.6, fade: false });
    }
    for (const l of this.lamps) {
      const f = l.o.flicker ? (Math.sin(this.t * 23 + l.o.x) > 0.85 ? 0.12 : 0.35) : 0.32 + Math.sin(this.t * 1.7 + l.o.y) * 0.04;
      l.glow.setAlpha(f * this.haloK);
    }
    for (const a of this.arrows) {
      const k = Math.floor(this.t * 3) % 2;
      a.img.setPosition(a.x + a.dx * k, a.y + a.dy * k).setAlpha(0.45 + k * 0.3);
    }
  }

  private drawArt(): void {
    const cam = this.scene.cameras.main;
    for (const a of this.parallaxArt) if (a.p !== 1) a.img.setPosition(R(a.x + cam.scrollX * (1 - a.p)), R(a.y + cam.scrollY * (1 - a.p)));
    if (this.fgCover) {
      const p = this.world.pip;
      const c0 = Math.floor(P(p.x) / T) - 1, c1 = Math.floor(P(p.x + p.w) / T) + 1, r0 = Math.floor(P(p.y) / T) - 1, r1 = Math.floor(P(p.y + p.h) / T) + 1;
      let near = false;
      for (let cy = r0; cy <= r1 && !near; cy++) for (let cx = c0; cx <= c1; cx++) if (this.fgCover[cy]?.[cx]) { near = true; break; }
      const target = near ? 0.35 : 1;
      this.fgArt.setAlpha(lerp(this.fgArt.alpha, target, 0.15));
    }
  }

  private drawMovers(alpha: number): void {
    const o = this.world.obj;
    o.movers.forEach((m, i) => {
      let imgs = this.movers[i];
      if (!imgs) {
        imgs = m.cells.filter((c) => c.g === '#' || c.g === '=' || c.g === 'X').map((c) => {
          const key = `mv_${this.id}_${c.cx}_${c.cy}`;
          if (!this.scene.textures.exists(key)) stoneTexture(this.scene, key, this.terrainSource(), c.cx, c.cy, true);
          const img = this.scene.add.image(0, 0, key).setOrigin(0);
          img.setData('cx', c.cx).setData('cy', c.cy);
          this.back.add(img);
          return img;
        });
        this.movers[i] = imgs;
      }
      const p = this.ip(`mover${i}`, m.ox, m.oy, alpha);
      for (const img of imgs) img.setPosition(R(img.getData('cx') * T + P(p.x)), R(img.getData('cy') * T + P(p.y)) - 3);
    });
    for (let i = o.movers.length; i < this.movers.length; i++) { for (const img of this.movers[i]!) img.destroy(); }
    this.movers.length = Math.min(this.movers.length, o.movers.length);
  }

  private drawPip(alpha: number, dt: number): void {
    const w = this.world, p = w.pip, a = this.pipAnim;
    a.land = Math.max(0, a.land - dt);
    a.pushT = Math.max(0, a.pushT - dt);
    a.pullT = Math.max(0, a.pullT - dt);
    a.kick = Math.max(0, a.kick - dt);
    a.pop = Math.min(1, a.pop + dt / 0.3);
    if (!w.pipAlive) {
      this.pipShadow.setVisible(false);
      // The ragdoll takes over; only show the flattened pose for deaths without one.
      if (this.deadAt && w.hitstop > 0 && !this.rags.length) this.pip.setVisible(true).setFrame('pip_dead').setPosition(R(this.deadAt.x), R(this.deadAt.y)).setScale(1).setRotation(0);
      else this.pip.setVisible(false);
      return;
    }
    const x = P(lerp(p.px, p.x, alpha) + p.w / 2);
    const y = P(lerp(p.py, p.y, alpha) + p.h);
    let frame = 'pip_idle0';
    let rot = 0;
    let flip = p.facing < 0;
    const moving = Math.abs(p.vx) > 2;
    if (p.hang) {
      frame = 'pip_hang';
      const v = w.obj.vines.find((x) => x.id === p.hang!.vine);
      const s = p.hang.seg;
      if (v && v.pts[s] && v.pts[s + 1]) rot = Math.max(-0.6, Math.min(0.6, Math.atan2(v.pts[s + 1]!.x - v.pts[s]!.x, v.pts[s + 1]!.y - v.pts[s]!.y) * -1));
    } else if (!p.grounded && p.wallDir !== 0 && p.vy > 0) { frame = 'pip_wall'; flip = p.wallDir < 0; }
    else if (!p.grounded) frame = a.kick > 0 || p.vy < 0 ? 'pip_jump' : 'pip_fall';
    else if (a.land > 0) frame = 'pip_land';
    else if (a.pullT > 0) frame = 'pip_pull';
    else if (a.pushT > 0) frame = 'pip_push';
    else if (moving) { a.runDist += Math.abs(p.vx) * dt * 60; frame = `pip_run${Math.floor(a.runDist / 70) % 4}`; }
    else {
      a.blinkT -= dt;
      const bob = Math.floor(this.t * 2) % 2;
      if (a.blinkT < 0) { frame = bob ? 'pip_blink1' : 'pip_blink'; if (a.blinkT < -0.12) a.blinkT = 2 + rng.range(0, 2.5); }
      else frame = bob ? 'pip_idle1' : 'pip_idle0';
    }
    this.checkStuckPush();
    const s = a.pop < 1 ? Phaser.Math.Easing.Back.Out(a.pop, 2.5) : 1;
    this.pip.setVisible(true).setFrame(frame).setFlipX(flip).setPosition(R(x), R(y)).setScale(s).setRotation(rot);
    this.pipShadow.setVisible(p.grounded).setPosition(R(x), R(y));
  }

  private checkStuckPush(): void {
    if (this.hint) return;
    const w = this.world, p = w.pip;
    if (!p.grounded || p.vx !== 0) { this.stuckTicks = Math.max(0, this.stuckTicks - 1); return; }
    const dir = p.facing;
    const touching = w.corpses.find((c) => c.kind !== 'crate' && !c.pin && c.stage !== 2 && Math.abs(c.y + c.h - (p.y + p.h)) < 4 &&
      (dir > 0 ? Math.abs(c.x - (p.x + p.w)) <= 1 : Math.abs(c.x + c.w - p.x) <= 1));
    if (!touching) { this.stuckTicks = 0; return; }
    const beyond = { x: dir > 0 ? touching.x + touching.w + 1 : touching.x - 2, y: touching.y + 2, w: 1, h: Math.max(1, touching.h - 4) };
    if (w.isFree(beyond, touching.id)) { this.stuckTicks = 0; return; }
    if (++this.stuckTicks > 45) this.hint = 'drag';
  }

  /** Track how long Pip has lingered by each sign; the nearest one in range speaks. */
  private updateSigns(dt: number): void {
    const w = this.world, p = w.pip;
    const px = p.x + p.w / 2, py = p.y + p.h / 2;
    let best: { id: string; d: number } | null = null;
    if (w.pipAlive) for (const s of w.obj.signs) {
      const d = Math.hypot(px - (s.def.x * U + U / 2), py - (s.def.y * U + U / 2));
      if (d < SIGN_RANGE && (!best || d < best.d)) best = { id: s.id, d };
    }
    for (const s of w.obj.signs) {
      const on = best?.id === s.id;
      this.signLinger.set(s.id, on ? (this.signLinger.get(s.id) ?? 0) + dt : 0);
      const post = this.posts.get(s.id);
      if (post) {
        const talking = on && (this.signLinger.get(s.id) ?? 0) >= 0.4;
        post.setFrame(talking ? (Math.floor(this.t * 8) % 4 ? 'signpost1' : 'signpost0') : Math.sin(this.t * 13 + s.def.x * 5) > 0.93 ? 'signpost1' : 'signpost0');
      }
    }
    this.tauntT -= dt;
    if (this.lore) { this.lore.t -= dt; if (this.lore.t <= 0) this.lore = null; }
  }

  private updateAmbience(dt: number): void {
    const w = this.world;
    const pal = actPal(this.act);
    if (rng.next() < dt * 2.5) this.particles.motes(rng.range(T, (w.W - 1) * T), rng.range(T, (w.H - 1) * T), pal.mossLight);
    for (const d of this.drips) {
      d.t -= dt;
      if (d.t <= 0) { d.t = 1.6 + rng.range(0, 2.2); this.particles.spawn(d.x, d.y + 1, { frame: 'drop', vy: 10, g: 260, life: 1.2, fade: true, hit: 'die' }); }
    }
    if (this.rainCols.length && rng.next() < dt * this.rainCols.length * 0.8) {
      const cx = this.rainCols[Math.floor(rng.next() * this.rainCols.length)]!;
      this.particles.spawn(cx * T + rng.range(0, 16), 0, { frame: 'drop', tint: 0xd8f6ff, vy: 140, g: 300, life: 2, hit: 'die', alpha: 0.7 });
    }
  }

  /** The view-sized darkness texture (recreated if the zoom changes; resizing a live one misplaces draws). */
  private makeDarkRT(): void {
    const cam = this.scene.cameras.main;
    this.dark?.destroy();
    this.dark = this.scene.add.renderTexture(0, 0, Math.ceil(cam.width / cam.zoom) + 4, Math.ceil(cam.height / cam.zoom) + 4).setOrigin(0);
    this.glowLayer.addAt(this.dark, 0);
  }

  /** Darkness: copy the visible part of the baked map into a view-sized texture, then erase moving lights. */
  private drawLighting(): void {
    const rt = this.dark, brush = this.brush, base = this.darkStatic;
    if (!rt || !brush || !base) return;
    const w = this.world, cam = this.scene.cameras.main;
    const vw = Math.ceil(cam.width / cam.zoom) + 4, vh = Math.ceil(cam.height / cam.zoom) + 4;
    if (rt.width !== vw || rt.height !== vh) { this.makeDarkRT(); return; }
    const vx = Math.floor(cam.scrollX + cam.width / 2 - cam.width / (2 * cam.zoom)) - 2;
    const vy = Math.floor(cam.scrollY + cam.height / 2 - cam.height / (2 * cam.zoom)) - 2;
    rt.setPosition(vx, vy);
    rt.clear();
    // Outside the room stays dark too.
    if (vx < 0 || vy < 0 || vx + vw > w.W * T || vy + vh > w.H * T) { rt.fill(KEY.k!, this.darkAlpha); rt.erase(base, -vx, -vy); }
    rt.draw(base, -vx, -vy);
    const stamp = (x: number, y: number, r: number) => {
      if (x + r < vx || y + r < vy || x - r > vx + vw || y - r > vy + vh) return;
      brush.setScale(r / 24); rt.erase(brush, R(x - vx), R(y - vy));
    };
    if (w.pipAlive) stamp(P(w.pip.x + w.pip.w / 2), P(w.pip.y + w.pip.h / 2), 44);
    for (const l of this.staticLights) if (l.flicker) stamp(l.x, l.y, Math.sin(this.t * 19 + l.x) > 0.9 ? l.r * 0.6 : l.r);
    for (const d of w.obj.doors) stamp(P(d.x + d.w / 2), P(d.y + d.h / 2), 30);
    for (const b of this.benches) stamp(b.img.x, b.img.y - 8, b.glow.alpha > 0 ? 34 : 18);
    for (const r of this.relics) if (r.img.visible) stamp(r.img.x, r.img.y, 14);
    for (const l of w.obj.lasers) {
      if (!l.active || l.beam.w <= 0) continue;
      const bx = P(l.beam.x), by = P(l.beam.y), bw = P(l.beam.w), bh = P(l.beam.h);
      const n = Math.max(1, Math.round(Math.max(bw, bh) / 14));
      for (let i = 0; i <= n; i++) stamp(bx + (bw * i) / n, by + (bh * i) / n, 14);
    }
    for (const r of this.rags) stamp(r.pts[0]!.x, r.pts[0]!.y, 22);
  }
}
