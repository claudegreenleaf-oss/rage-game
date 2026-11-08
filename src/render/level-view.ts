// Draws a World as pixel art: baked terrain, pooled sprites for objects, corpses, Pip and particles.
// Purely a reader of sim state; reacts to world.fx for juice and sound. Nothing is redrawn per frame:
// sprites are only moved and re-framed, and the terrain is re-baked only when the tiles change.
import Phaser from 'phaser';
import { U, type Corpse, type DeathType, type SimEvent } from '../sim/types';
import type { World } from '../sim/world';
import { SIGN_RANGE } from '../sim/constants';
import { gateBox, signText, type RtCrusher, type RtDoor, type RtPlate } from '../sim/hazards';
import { audio } from '../audio/sfx';
import { ATLAS, corpseFrame, type Look } from './pixel/sprites';
import { T, bakeTerrain, bakeWater, cellKey, crusherTexture, dripPoints, stoneTexture, type TerrainSource } from './pixel/terrain';
import { KEY, actPal } from './pixel/pal';
import { Pixels } from './pixel/particles';
import { ptext } from './pixel/font';
import { PHOSPHOR, panelTex } from './pixel/uitex';
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

interface Board { root: Phaser.GameObjects.Container; panel: Phaser.GameObjects.Image; text: Phaser.GameObjects.BitmapText; content: string; shown: boolean }
interface CorpseSpr { img: Phaser.GameObjects.Image; flies: Phaser.GameObjects.Image[]; squash: number; pop: number; seed: number }
interface Pos { x: number; y: number }

let viewSerial = 0;
let dragHintShown = false;

export class LevelView {
  readonly root: Phaser.GameObjects.Container;
  private readonly id = ++viewSerial;
  private terrainKey: string;
  private waterKey: string;
  private terrain: Phaser.GameObjects.Image;
  private back: Phaser.GameObjects.Container;
  private ents: Phaser.GameObjects.Container;
  private front: Phaser.GameObjects.Container;
  private fxLayer: Phaser.GameObjects.Container;
  private top: Phaser.GameObjects.Container;
  readonly particles: Pixels;

  private pip: Phaser.GameObjects.Image;
  private pipShadow: Phaser.GameObjects.Image;
  private corpses = new Map<number, CorpseSpr>();
  private doors = new Map<string, { img: Phaser.GameObjects.Image; halo: Phaser.GameObjects.Image; smirk: Phaser.GameObjects.Image }>();
  private droppers = new Map<string, Phaser.GameObjects.Image>();
  private crushers = new Map<string, Phaser.GameObjects.Image>();
  private pistons = new Map<string, Phaser.GameObjects.TileSprite>();
  private posts: Phaser.GameObjects.Image[] = [];
  private drips: Array<{ x: number; y: number; t: number }> = [];
  private plates = new Map<string, { btns: Phaser.GameObjects.Image[]; pips: Phaser.GameObjects.Image[] }>();
  private gates = new Map<string, { bars: Phaser.GameObjects.TileSprite; tip: Phaser.GameObjects.Image }>();
  private platforms = new Map<string, Phaser.GameObjects.TileSprite>();
  private lasers = new Map<string, { beam: Phaser.GameObjects.TileSprite; emitter: Phaser.GameObjects.Image | null; vertical: boolean }>();
  private popups = new Map<string, { img: Phaser.GameObjects.Image; t: number }>();
  private movers: Phaser.GameObjects.Image[][] = [];
  private belts: Array<{ belt: Phaser.GameObjects.TileSprite; chev: Phaser.GameObjects.TileSprite; dir: number }> = [];
  private waves: Phaser.GameObjects.TileSprite[] = [];
  private boards = new Map<string, Board>();
  private taunt: Board;
  private tauntT = 0;
  private prev = new Map<string, Pos>();
  private t = 0;
  private terrainDirty = false;
  private pipAnim = { land: 0, blinkT: 2, runDist: 0, pop: 1, pushT: 0, pullT: 0 };
  private deadAt: Pos | null = null;
  private stuckTicks = 0;
  private humT = 0;
  /** A one-off hint the HUD should show (consumed by the HUD). */
  hint: string | null = null;

  constructor(private scene: Phaser.Scene, public world: World, private hooks: ViewHooks) {
    const add = scene.add;
    this.root = add.container(0, 0);
    this.terrainKey = `terrain_${this.id}`;
    this.waterKey = `water_${this.id}`;
    bakeTerrain(scene, this.terrainKey, this.terrainSource());
    this.terrain = add.image(0, 0, this.terrainKey).setOrigin(0);
    this.back = add.container(0, 0);
    this.ents = add.container(0, 0);
    this.front = add.container(0, 0);
    this.fxLayer = add.container(0, 0);
    this.top = add.container(0, 0);
    this.root.add([this.terrain, this.back, this.ents, this.front, this.fxLayer, this.top]);
    this.particles = new Pixels(scene, this.fxLayer);

    this.buildObjects();
    this.drips = dripPoints(this.terrainSource(), 7).map((d, i) => ({ ...d, t: 0.5 + i * 0.37 }));
    this.pipShadow = add.image(0, 0, ATLAS, 'shadow').setOrigin(0.5, 0.5);
    this.pip = add.image(0, 0, ATLAS, 'pip_idle0').setOrigin(0.5, 1);
    this.ents.add([this.pipShadow, this.pip]);

    // Water and its animated surface sit in front of bodies.
    const surfaces = bakeWater(scene, this.waterKey, this.terrainSource());
    if (surfaces.length) {
      this.front.add(add.image(0, 0, this.waterKey).setOrigin(0));
      for (const s of surfaces) {
        const wv = add.tileSprite(s.x, s.y - 1, s.w, 4, ATLAS, 'wave0').setOrigin(0);
        this.waves.push(wv);
        this.front.add(wv);
      }
    }

    // Labels (credits): centred on (x, y) in tiles, `size` is a scale.
    for (const o of world.level.objects) {
      if (o.type !== 'label') continue;
      const s = Math.max(1, Math.round(o.size ?? 1));
      const t = ptext(scene, o.x * T, o.y * T, o.text, { scale: s, outline: true, color: 0xfff4e4, origin: [0.5, 0.5] });
      this.top.add(t);
    }

    this.taunt = this.makeBoard();
    this.snapshot();
    this.render(1, 0);
  }

  private terrainSource(): TerrainSource {
    const w = this.world;
    const extra = new Set<number>();
    for (const d of w.obj.droppers) if (d.state !== 'gone' && d.state !== 'fall') extra.add(cellKey(d.def.x, d.def.y));
    return { W: w.W, H: w.H, act: w.level.credits ? 0 : w.level.act ?? 1, tileAt: (cx, cy) => w.tileAt(cx, cy), extraSolid: extra };
  }

  setZoom(_z: number): void { /* pixel art renders at integer zoom; nothing to rescale */ }

  destroy(): void {
    this.root.destroy(true);
    for (const k of [this.terrainKey, this.waterKey]) if (this.scene.textures.exists(k)) this.scene.textures.remove(k);
    for (const img of this.droppers.values()) { const k = img.texture.key; img.destroy(); if (this.scene.textures.exists(k)) this.scene.textures.remove(k); }
  }

  // ---------------------------------------------------------------------------
  // Object sprites
  // ---------------------------------------------------------------------------

  private buildObjects(): void {
    const s = this.scene, add = s.add, w = this.world, o = w.obj;
    const src = this.terrainSource();
    const lvl = w.level;

    // Conveyor belts: one scrolling strip per run of conveyor tiles.
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
      this.posts.push(post);
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
            fx.puff(x, y, 7, 6);
            audio.play('squish', 1, e.kind === 'crusher' ? 1.2 : 0.8);
            if (e.kind === 'crusher' || e.kind === 'dropper') fx.debris(x, y + 4, 8);
          }
          break;
        }
        case 'corpse': {
          const c = w.corpseById(e.id);
          this.deadAt = null;
          if (c) { fx.puff(P(c.x + c.w / 2), P(c.y + c.h / 2), 6, 5); const cs = this.corpseSprite(c); cs.pop = 0.25; }
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
        case 'respawn':
          this.pipAnim.pop = 0;
          fx.puff(P(e.x), P(e.y) - 6, 10, 7);
          fx.sparkle(P(e.x), P(e.y) - 8, 4, KEY.z!);
          audio.play('pop');
          this.showTaunt();
          this.terrainDirty = true;
          break;
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
        case 'sign': {
          const b = this.boards.get(e.id);
          if (b) { b.content = ''; }
          audio.play('tock');
          break;
        }
        case 'doorHop': audio.play('boing', 1.4); audio.play('scurry'); break;
        case 'doorScurry': audio.play('scurry'); break;
        case 'shake': this.hooks.shake(Math.min(1, e.strength)); break;
        case 'sfx': if (e.name === 'jingle') audio.jingle(); else audio.play(e.name); break;
        case 'win':
          fx.confetti(P(e.x), P(e.y) - 4, 46);
          fx.sparkle(P(e.x), P(e.y), 12, KEY.z!);
          audio.jingle();
          break;
        case 'step': break;
      }
    }
  }

  private showTaunt(): void {
    const s = tauntFor(this.world.deathCount);
    if (!s) return;
    this.setBoard(this.taunt, s);
    this.tauntT = 2.6;
  }

  // ---------------------------------------------------------------------------
  // Boards (sign speech)
  // ---------------------------------------------------------------------------

  private makeBoard(): Board {
    const s = this.scene;
    const panel = s.add.image(0, 0, ATLAS, 'p1').setOrigin(0.5, 1);
    const text = s.add.bitmapText(0, 0, 'pf', '', 1).setOrigin(0.5, 0.5).setCenterAlign().setTint(PHOSPHOR).setMaxWidth(118);
    const root = s.add.container(0, 0, [panel, text]).setVisible(false).setScale(0);
    this.top.add(root);
    return { root, panel, text, content: '', shown: false };
  }

  private setBoard(b: Board, content: string): void {
    if (b.content === content) return;
    b.content = content;
    b.text.setText(content);
    const bw = Math.max(18, b.text.width + 12), bh = b.text.height + 8;
    b.panel.setTexture(panelTex(this.scene, R(bw) | 1, R(bh), 'crt', true));
    b.text.setPosition(0, -R(bh / 2) - 4 + 1);
  }

  private showBoard(b: Board, show: boolean): void {
    if (b.shown === show) return;
    b.shown = show;
    this.scene.tweens.killTweensOf(b.root);
    if (show) {
      b.root.setVisible(true);
      this.scene.tweens.add({ targets: b.root, scale: 1, duration: 260, ease: 'Back.easeOut', easeParams: [2.4] });
      audio.play('tock', 1, 0.6);
    } else {
      this.scene.tweens.add({ targets: b.root, scale: 0, duration: 120, ease: 'Quad.easeIn', onComplete: () => b.root.setVisible(false) });
    }
  }

  private placeBoard(b: Board, x: number, y: number): void {
    const half = R((b.panel.width || 20) / 2);
    const cx = Math.max(half + 1, Math.min(this.world.W * T - half - 1, x));
    b.root.setPosition(R(cx), R(Math.max(b.panel.height + 1, y)));
  }

  // ---------------------------------------------------------------------------
  // Corpses
  // ---------------------------------------------------------------------------

  private corpseSprite(c: Corpse): CorpseSpr {
    let cs = this.corpses.get(c.id);
    if (!cs) {
      const img = this.scene.add.image(0, 0, ATLAS, corpseFrame(c.stage, 'body')).setOrigin(0.5, 1);
      cs = { img, flies: [], squash: 0, pop: 0, seed: rng.range(0, 100) };
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

  private drawCorpses(alpha: number, dt: number): void {
    const w = this.world;
    const alive = new Set<number>();
    for (const c of w.corpses) {
      alive.add(c.id);
      const cs = this.corpseSprite(c);
      const look: Look = c.pin?.kind === 'floor' ? 'floor' : c.pin?.kind === 'wall' ? 'wall' : c.shape === 'slab' ? 'slab' : 'body';
      cs.img.setFrame(corpseFrame(c.stage, look));
      const x = P(lerp(c.px, c.x, alpha) + c.w / 2);
      const top = P(lerp(c.py, c.y, alpha));
      const bot = P(lerp(c.py, c.y, alpha) + c.h);
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
      // Flies orbit Rot bodies.
      const want = c.stage === 1 ? 2 : 0;
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

    // Belts and water.
    const beltPx = R(this.t * 30) % 16;
    for (const b of this.belts) b.chev.tilePositionX = -b.dir * beltPx;
    const wf = `wave${Math.floor(this.t * 6) % 4}`;
    for (const wv of this.waves) { wv.setFrame(wf); wv.tilePositionX = R(this.t * 6); }

    // Droppers & crushers & platforms & movers.
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
      const box = gateBox(g);
      const h = R(P(box.h));
      v.bars.setVisible(h > 0).setSize(T, Math.max(1, h));
      v.bars.tilePositionY = -h;
      v.tip.setVisible(h > 0).setPosition(g.def.x * T, g.def.y * T + h - 1);
    }

    // Pop-ups.
    for (const p of o.popups) {
      const v = this.popups.get(p.id);
      if (!v) continue;
      v.img.setVisible(p.up);
      if (p.up) { v.t += dt; v.img.setFrame(`pop${Math.min(3, Math.floor(v.t * 40))}`); }
      else v.t = 0;
    }

    // Lasers.
    const bf = Math.floor(this.t * 24) % 3;
    this.humT -= dt;
    for (const l of o.lasers) {
      // Security beams hum quietly when they switch on, or while Pip is close to a live one.
      if (l.active && this.humT <= 0 && l.beam.w > 0 && !(l.def.hidden && !w.revealed.has(l.id))) {
        const p = w.pip, near = w.pipAlive && Math.abs(p.x + p.w / 2 - (l.beam.x + l.beam.w / 2)) < l.beam.w / 2 + 2 * U && Math.abs(p.y + p.h / 2 - (l.beam.y + l.beam.h / 2)) < l.beam.h / 2 + 2 * U;
        if (near || !l.wasActive) { audio.play('hum', 1, near ? 0.35 : 0.25); this.humT = 1.1; }
      }
      const v = this.lasers.get(l.id);
      if (!v) continue;
      const bx = l.beam;
      const hiddenNow = !!l.def.hidden && !w.revealed.has(l.id);
      if (bx.w <= 0 || hiddenNow) { v.beam.setVisible(false); continue; }
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

    // Doors.
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
      const pulse = 0.55 + Math.sin(this.t * 3) * 0.2;
      v.halo.setPosition(cx, by - 8).setAlpha(pulse);
      if (rng.next() < dt * 3) this.particles.motes(cx + rng.range(-6, 6), by - rng.range(0, 14), KEY.j!);
    }

    this.drawCorpses(alpha, dt);
    this.drawPip(alpha, dt);
    this.drawSigns(dt);
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
    // Movers vanish on respawn (the sim rebuilds its object state).
    for (let i = o.movers.length; i < this.movers.length; i++) { for (const img of this.movers[i]!) img.destroy(); }
    this.movers.length = Math.min(this.movers.length, o.movers.length);
  }

  private drawPip(alpha: number, dt: number): void {
    const w = this.world, p = w.pip, a = this.pipAnim;
    a.land = Math.max(0, a.land - dt);
    a.pushT = Math.max(0, a.pushT - dt);
    a.pullT = Math.max(0, a.pullT - dt);
    a.pop = Math.min(1, a.pop + dt / 0.3);
    if (!w.pipAlive) {
      this.pipShadow.setVisible(false);
      if (this.deadAt && w.hitstop > 0) {
        this.pip.setVisible(true).setFrame('pip_dead').setPosition(R(this.deadAt.x), R(this.deadAt.y)).setScale(1, 1);
      } else this.pip.setVisible(false);
      return;
    }
    const x = P(lerp(p.px, p.x, alpha) + p.w / 2);
    const y = P(lerp(p.py, p.y, alpha) + p.h);
    let frame = 'pip_idle0';
    const moving = Math.abs(p.vx) > 2;
    if (!p.grounded) frame = p.vy < 0 ? 'pip_jump' : 'pip_fall';
    else if (a.land > 0) frame = 'pip_land';
    else if (a.pullT > 0) frame = 'pip_pull';
    else if (a.pushT > 0) frame = 'pip_push';
    else if (moving) {
      a.runDist += Math.abs(p.vx) * dt * 60;
      frame = `pip_run${Math.floor(a.runDist / 70) % 4}`;
    } else {
      a.blinkT -= dt;
      const bob = Math.floor(this.t * 2) % 2;
      if (a.blinkT < 0) { frame = bob ? 'pip_blink1' : 'pip_blink'; if (a.blinkT < -0.12) a.blinkT = 2 + rng.range(0, 2.5); }
      else frame = bob ? 'pip_idle1' : 'pip_idle0';
    }
    // Pushing into something that won't budge: suggest dragging (once).
    this.checkStuckPush();
    const s = a.pop < 1 ? Phaser.Math.Easing.Back.Out(a.pop, 2.5) : 1;
    this.pip.setVisible(true).setFrame(frame).setFlipX(p.facing < 0).setPosition(R(x), R(y)).setScale(s);
    this.pipShadow.setVisible(p.grounded).setPosition(R(x), R(y));
  }

  private checkStuckPush(): void {
    if (dragHintShown) return;
    const w = this.world, p = w.pip;
    if (!p.grounded || p.vx !== 0) { this.stuckTicks = Math.max(0, this.stuckTicks - 1); return; }
    const dir = p.facing;
    const touching = w.corpses.find((c) => !c.pin && c.stage !== 2 && Math.abs(c.y + c.h - (p.y + p.h)) < 4 &&
      (dir > 0 ? Math.abs(c.x - (p.x + p.w)) <= 1 : Math.abs(c.x + c.w - p.x) <= 1));
    if (!touching) { this.stuckTicks = 0; return; }
    const beyond = { x: dir > 0 ? touching.x + touching.w + 1 : touching.x - 2, y: touching.y + 2, w: 1, h: Math.max(1, touching.h - 4) };
    if (w.isFree(beyond, touching.id)) { this.stuckTicks = 0; return; }
    if (++this.stuckTicks > 45) { dragHintShown = true; this.hint = '↓ + walk away: drag a body'; }
  }

  private drawSigns(dt: number): void {
    const w = this.world, p = w.pip;
    const px = p.x + p.w / 2, py = p.y + p.h / 2;
    let best: { id: string; d: number } | null = null;
    if (w.pipAlive) for (const s of w.obj.signs) {
      const sx = s.def.x * U + U / 2, sy = s.def.y * U + U / 2;
      const d = Math.hypot(px - sx, py - sy);
      if (d < SIGN_RANGE && (!best || d < best.d)) best = { id: s.id, d };
    }
    for (const s of w.obj.signs) {
      let b = this.boards.get(s.id);
      if (!b) { b = this.makeBoard(); this.boards.set(s.id, b); }
      const on = best?.id === s.id;
      if (on || b.shown) {
        this.setBoard(b, signText(w, s));
        this.placeBoard(b, s.def.x * T + 8, s.def.y * T + 4);
      }
      this.showBoard(b, on && b.content.length > 0);
    }
    // The spawn taunt (and the softlock nudge, which stays up while it applies).
    const stuck = !!(w as unknown as { suggestRestart?: boolean }).suggestRestart;
    if (stuck && w.pipAlive) { this.setBoard(this.taunt, 'Stuck? R clears the bodies.'); this.tauntT = Math.max(this.tauntT, 0.5); }
    this.tauntT -= dt;
    const sp = w.spawnPoint();
    const near = best && this.boards.get(best.id)?.shown;
    this.placeBoard(this.taunt, P(sp.x + w.pip.w / 2), P(sp.y) - 6);
    this.showBoard(this.taunt, this.tauntT > 0 && !(near && !stuck));
    // Floating spores, dripping coolant and flickering monitors.
    if (rng.next() < dt * 2.5) this.particles.motes(rng.range(T, (w.W - 1) * T), rng.range(T, (w.H - 1) * T), actPal(w.level.act).mossLight);
    for (const d of this.drips) {
      d.t -= dt;
      if (d.t <= 0) { d.t = 1.6 + rng.range(0, 2.2); this.particles.spawn(d.x, d.y + 1, { frame: 'drop', vy: 10, g: 260, life: 0.7, fade: true }); }
    }
    for (let i = 0; i < this.posts.length; i++) this.posts[i]!.setFrame(Math.sin(this.t * 13 + i * 5) > 0.93 || Math.sin(this.t * 2.3 + i) > 0.97 ? 'signpost1' : 'signpost0');
  }
}
