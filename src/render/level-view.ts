// Draws a World every frame: terrain, objects, corpses, Pip, water, lasers, particles, signs.
// Purely a reader of sim state; reacts to world.fx for juice and sound.
import Phaser from 'phaser';
import { U, type Corpse, type DeathType, type SimEvent, type Stage } from '../sim/types';
import type { World } from '../sim/world';
import { SIGN_RANGE } from '../sim/constants';
import { gateBox, signText, type RtDoor } from '../sim/hazards';
import { C, PX, TILE } from './palette';
import { cellKey, drawBlock, drawSpikes, drawTerrain, type ExtraSolids } from './draw-tiles';
import { defaultPose, drawPip, type PipPose } from './draw-player';
import { drawCorpse, type CorpseLook } from './draw-corpse';
import { Particles } from './fx';
import { rng } from './rng';
import { SignBubble, textStyle, dpr } from './ui';
import { audio } from '../audio/sfx';

const TAUNTS: Array<[number, string]> = [
  [1, 'Oops.'], [3, 'Again? Bold.'], [5, 'Have you tried not dying?'], [10, "I'm keeping these, by the way."],
  [20, "Your family's here. All of them."], [50, 'I could watch this all day. I do.'],
];
export function tauntFor(deaths: number): string | null {
  let t: string | null = null;
  for (const [n, s] of TAUNTS) if (deaths >= n) t = s;
  return t;
}

const ROOM_TINT: Record<number, number> = { 1: 0xfff6ea, 2: 0xeef7ef, 3: 0xf6eef6 };

const SHAKE: Record<DeathType, number> = { spike: 0.55, crusher: 1, dropper: 0.75, water: 0.3, pit: 0.15, laser: 0.6 };

interface CorpseAnim { seed: number; pop: number; squash: number; rattle: number; lastStage: Stage }
interface Pos { x: number; y: number }

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const ux = (u: number) => u * PX;

export interface ViewHooks {
  shake(amount: number): void;
  punch(amount: number): void;
  flash(): void;
}

export class LevelView {
  readonly root: Phaser.GameObjects.Container;
  private terrain: Phaser.GameObjects.Graphics;
  private shadows: Phaser.GameObjects.Graphics;
  private back: Phaser.GameObjects.Graphics;
  private ents: Phaser.GameObjects.Graphics;
  private front: Phaser.GameObjects.Graphics;
  private glow: Phaser.GameObjects.Graphics;
  private fxG: Phaser.GameObjects.Graphics;
  private fxAdd: Phaser.GameObjects.Graphics;
  private signLayer: Phaser.GameObjects.Container;
  readonly particles = new Particles();
  private pose: PipPose = defaultPose();
  private poseV = { sx: 0, sy: 0 };
  private corpseAnim = new Map<number, CorpseAnim>();
  private prev = new Map<string, Pos>();
  private bubbles = new Map<string, SignBubble>();
  private taunt: SignBubble;
  private tauntT = 0;
  private labels: Phaser.GameObjects.Text[] = [];
  private labelLayer: Phaser.GameObjects.Text[] = [];
  private doorGlows = new Map<string, Phaser.GameObjects.Image>();
  private t = 0;
  private blinkT = 2;
  private plateSink = new Map<string, number>();
  private popRise = new Map<string, number>();
  private stepTick = 0;
  private terrainDirty = true;
  private zoom = 1;
  private deadPose: Pos | null = null;
  private revealFlash = new Map<string, number>();
  private gateBounce = new Map<string, number>();
  private lightPool: Phaser.GameObjects.Image | null = null;

  constructor(private scene: Phaser.Scene, public world: World, private hooks: ViewHooks) {
    const add = scene.add;
    this.root = add.container(0, 0);
    this.shadows = add.graphics();
    this.terrain = add.graphics();
    this.back = add.graphics();
    this.ents = add.graphics();
    this.front = add.graphics();
    this.glow = add.graphics().setBlendMode(Phaser.BlendModes.ADD);
    this.fxG = add.graphics();
    this.fxAdd = add.graphics().setBlendMode(Phaser.BlendModes.ADD);
    this.signLayer = add.container(0, 0);
    for (const d of world.obj.doors) {
      const img = add.image(0, 0, 'glow').setBlendMode(Phaser.BlendModes.ADD).setTint(C.gold).setAlpha(0.55).setScale(1.1);
      this.doorGlows.set(d.id, img);
    }
    const wpx = world.W * TILE, hpx = world.H * TILE;
    const pool = add.image(wpx * 0.35, hpx * 0.1, 'glow').setBlendMode(Phaser.BlendModes.ADD).setDisplaySize(wpx * 0.9, hpx * 1.4).setTint(0xffd9a8).setAlpha(0.1);
    this.lightPool = pool;
    this.root.add([this.terrain, pool, this.shadows, ...this.doorGlows.values(), this.back, this.ents, this.front, this.glow, this.fxG, this.fxAdd, this.signLayer]);
    this.taunt = new SignBubble(scene, 17, 220);
    this.signLayer.add(this.taunt);
    for (const o of world.level.objects) {
      if (o.type === 'label') {
        // (x, y) is the text centre in tiles; size is a scale multiplier (1 ≈ 18px world text).
        const k = o.size ?? 1;
        const t = add.text(o.x * TILE, o.y * TILE, o.text, textStyle(Math.round(18 * k), C.cream, { fontStyle: '700', stroke: '#2b2433', strokeThickness: Math.max(4, Math.round(6 * k)) })).setOrigin(0.5).setResolution(2 * dpr());
        this.labels.push(t);
        this.labelLayer.push(t);
      }
    }
    for (const l of this.labelLayer) this.root.add(l);
    this.snapshot();
  }

  setZoom(z: number): void {
    this.zoom = z;
    for (const l of this.labels) l.setResolution(z * dpr());
  }

  destroy(): void { this.root.destroy(true); }

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
    this.stepTick++;
    const w = this.world;
    for (const e of events) {
      switch (e.t) {
        case 'jump':
          this.poseV.sy += 6; this.pose.sy = 1.18; this.pose.sx = 0.84;
          this.particles.dust(ux(e.x), ux(e.y), 5, 0);
          audio.play('jump', 1 + rng.range(-0.06, 0.06));
          break;
        case 'land': {
          const near = w.pipAlive && Math.abs(e.x - (w.pip.x + w.pip.w / 2)) < 40 && Math.abs(e.y - (w.pip.y + w.pip.h)) < 8;
          const k = Math.min(1, e.impact / 60);
          if (near) {
            this.pose.sx = 1 + 0.32 * k; this.pose.sy = 1 - 0.3 * k;
            this.particles.dust(ux(e.x), ux(e.y), 3 + Math.round(5 * k), 0);
            audio.play('land', 1, 0.5 + k * 0.6);
            const sup = w.supports.get(-1);
            if (sup?.kind === 'corpse') {
              const c = w.corpseById(sup.id);
              const a = this.corpseAnim.get(sup.id);
              if (a) { a.squash = 0.6; if (c?.stage === 2) { a.rattle = 1; audio.play('clack'); } }
            }
          } else {
            this.particles.dust(ux(e.x), ux(e.y), 4, 0);
            audio.play('land', 0.8, 0.5);
          }
          break;
        }
        case 'bounce': {
          this.pose.sy = 1.42; this.pose.sx = 0.7;
          const a = this.corpseAnim.get(e.corpse);
          if (a) a.squash = 1;
          this.particles.puff(ux(e.x), ux(e.y), 6, 10, C.rotLight);
          audio.play('boing'); audio.play('blorp', 1.2, 0.6);
          break;
        }
        case 'push': {
          const c = w.corpseById(e.corpse);
          if (c) { this.particles.dust(ux(c.x + (w.pip.x < c.x ? 0 : c.w)), ux(c.y + c.h), 2, 0); audio.play('push'); }
          break;
        }
        case 'death': {
          this.deadPose = { x: ux(w.pip.x + w.pip.w / 2), y: ux(w.pip.y + w.pip.h) };
          this.hooks.flash();
          this.hooks.shake(SHAKE[e.kind]);
          this.hooks.punch(e.kind === 'pit' ? 0 : 0.07);
          const x = ux(e.x), y = ux(e.y);
          audio.play('squeak', 1 + rng.range(-0.08, 0.08));
          if (e.kind === 'laser') { this.particles.sparks(x, y, 22, C.laser); this.particles.sparks(x, y, 12); this.particles.puff(x, y, 10, 12, 0xffd9ec); audio.play('zap'); }
          else if (e.kind === 'water') { this.particles.splash(x, y); audio.play('splash'); }
          else if (e.kind === 'pit') { audio.play('whistle'); }
          else {
            this.particles.sparkle(x, y - 6, 7, C.white);
            this.particles.puff(x, y, 8, 12);
            audio.play('squish', 1, e.kind === 'crusher' ? 1.2 : 0.8);
            if (e.kind === 'crusher' || e.kind === 'dropper') this.particles.debris(x, y + 12, 8);
          }
          break;
        }
        case 'corpse': {
          const c = w.corpseById(e.id);
          this.corpseAnim.set(e.id, { seed: rng.range(0, 100), pop: 0, squash: 0, rattle: 0, lastStage: 0 });
          if (c) this.particles.puff(ux(c.x + c.w / 2), ux(c.y + c.h / 2), 6, 10);
          this.deadPose = null;
          break;
        }
        case 'age': {
          const c = w.corpseById(e.id);
          const a = this.corpseAnim.get(e.id);
          if (a) a.lastStage = e.stage;
          if (c) {
            setTimeout(() => {
              this.particles.puff(ux(c.x + c.w / 2), ux(c.y + c.h / 2), 7, 10, e.stage === 1 ? C.rotLight : C.bone);
              if (a) a.squash = 0.8;
            }, 150);
          }
          audio.play(e.stage === 1 ? 'blorp' : 'clack');
          break;
        }
        case 'dust':
          this.particles.bones(ux(e.x), ux(e.y), 6);
          this.particles.puff(ux(e.x), ux(e.y), 12, 16, C.bone);
          audio.play('poof');
          this.corpseAnim.delete(e.id);
          break;
        case 'vaporize':
          this.particles.sparks(ux(e.x), ux(e.y), 20, C.laser);
          this.particles.puff(ux(e.x), ux(e.y), 10, 14, 0xffd9ec);
          audio.play('zap', 0.8);
          this.corpseAnim.delete(e.id);
          break;
        case 'pin': audio.play('pin'); break;
        case 'flatten': {
          const c = w.corpseById(e.id);
          if (c) this.particles.puff(ux(c.x + c.w / 2), ux(c.y + c.h), 8, 14);
          audio.play('squish', 0.8);
          break;
        }
        case 'splash': this.particles.splash(ux(e.x), ux(e.y), 10); audio.play('splash', 1.1, 0.7); break;
        case 'respawn':
          this.pose = { ...defaultPose(), pop: 0, facing: 1 };
          this.scene.tweens.add({ targets: this.pose, pop: 1, duration: 350, ease: 'Back.easeOut', easeParams: [2.5] });
          this.particles.puff(ux(e.x), ux(e.y) - 14, 12, 14);
          this.particles.sparkle(ux(e.x), ux(e.y) - 18, 5, C.gold);
          audio.play('pop');
          this.showTaunt();
          this.terrainDirty = true;
          break;
        case 'restart':
          this.corpseAnim.clear();
          this.particles.puff(ux(w.pip.x + w.pip.w / 2), ux(w.pip.y + w.pip.h) - 14, 12, 14);
          this.pose = { ...defaultPose(), pop: 0 };
          this.scene.tweens.add({ targets: this.pose, pop: 1, duration: 300, ease: 'Back.easeOut' });
          this.terrainDirty = true;
          audio.play('poof');
          break;
        case 'plate':
          audio.play('click', e.down ? 1 : 0.8);
          this.plateSink.set(e.id, e.down ? -3 : 3);
          break;
        case 'gate':
          audio.play('gate', e.open ? 1 : 0.85);
          this.gateBounce.set(e.id, 1);
          break;
        case 'popSpike': {
          this.popRise.set(e.id, 0);
          const p = w.obj.get<{ def: { x: number; y: number } }>(e.id);
          if (p) this.particles.dust(p.def.x * TILE + 20, p.def.y * TILE + TILE, 6);
          audio.play('shing');
          break;
        }
        case 'dropperShake': audio.play('rumble'); this.terrainDirty = true; break;
        case 'dropperFall': audio.play('whistle', 0.7, 0.6); break;
        case 'dropperBreak':
          this.particles.debris(ux(e.x), ux(e.y), 12);
          this.particles.dust(ux(e.x), ux(e.y), 8);
          this.hooks.shake(0.35);
          audio.play('slam', 1.3, 0.6);
          break;
        case 'crusherSlam': {
          const c = w.obj.get<{ x: number; y: number; w: number; h: number }>(e.id);
          if (c) { this.particles.debris(ux(c.x + c.w / 2), ux(c.y + c.h), 10); this.particles.dust(ux(c.x + c.w / 2), ux(c.y + c.h), 10); }
          this.hooks.shake(0.6);
          audio.play('slam');
          break;
        }
        case 'laserZap': break;
        case 'laserReveal': {
          this.revealFlash.set(e.id, 1);
          this.hooks.shake(0.3);
          audio.play('zap', 1.2);
          break;
        }
        case 'tiles': this.terrainDirty = true; break;
        case 'tilesDrop':
          for (const c of e.cells) this.particles.debris(c.x * TILE + 20, c.y * TILE + 20, 5);
          this.hooks.shake(0.4);
          audio.play('slam', 0.8, 0.6);
          break;
        case 'sign': {
          const b = this.bubbles.get(e.id);
          if (b) b.wobble();
          audio.play('tock');
          break;
        }
        case 'doorHop': audio.play('boing', 1.4); audio.play('scurry'); break;
        case 'doorScurry': audio.play('scurry'); break;
        case 'shake': this.hooks.shake(Math.min(1, e.strength)); break;
        case 'sfx': if (e.name === 'jingle') audio.jingle(); else audio.play(e.name); break;
        case 'win': {
          this.particles.confetti(ux(e.x), ux(e.y) - 10, 46);
          this.particles.sparkle(ux(e.x), ux(e.y), 14);
          audio.jingle();
          break;
        }
        case 'step': break;
      }
    }
  }

  private showTaunt(): void {
    const s = tauntFor(this.world.deathCount);
    if (!s) return;
    this.taunt.setContent(s, this.zoom);
    this.tauntT = 2.6;
    this.taunt.show();
  }

  // ---------------------------------------------------------------------------
  // Frame
  // ---------------------------------------------------------------------------

  render(alpha: number, dt: number): void {
    this.t += dt;
    const w = this.world;
    if (this.terrainDirty) {
      const extra: ExtraSolids = new Set();
      for (const d of w.obj.droppers) if (d.state === 'idle') extra.add(cellKey(Math.floor(d.x / U), Math.floor(d.homeY / U)));
      drawTerrain(this.terrain, w, extra, ROOM_TINT[w.level.act ?? 1] ?? C.paper);
      this.terrainDirty = false;
    }
    this.particles.update(dt);
    this.updatePose(dt);
    if (this.lightPool) this.lightPool.setAlpha(0.1 + Math.sin(this.t * 0.6) * 0.025);

    const sh = this.shadows, b = this.back, e = this.ents, f = this.front, gl = this.glow;
    sh.clear(); b.clear(); e.clear(); f.clear(); gl.clear();

    this.drawConveyors(b);
    this.drawObjectsBack(b, gl, alpha, dt);
    this.drawCorpses(e, sh, alpha, dt);
    this.drawPlayer(e, sh, alpha);
    this.drawWater(f);
    this.drawLasers(f, gl);
    this.drawSigns(dt);
    this.fxG.clear(); this.fxAdd.clear();
    this.particles.draw(this.fxG, this.fxAdd);
    // ambient motes near the door
    if (Math.random() < dt * 4) for (const d of w.obj.doors) this.particles.motes(ux(d.x + d.w / 2) + rng.range(-14, 14), ux(d.y + d.h) - rng.range(0, 30), C.gold);
  }

  private updatePose(dt: number): void {
    const w = this.world, p = this.pose, pip = w.pip;
    // spring squash/stretch back to 1 with a little overshoot
    const k = 260, damp = Math.exp(-dt * 16);
    this.poseV.sx = (this.poseV.sx + (1 - p.sx) * k * dt) * damp;
    this.poseV.sy = (this.poseV.sy + (1 - p.sy) * k * dt) * damp;
    p.sx += this.poseV.sx * dt; p.sy += this.poseV.sy * dt;
    if (!w.pipAlive) return;
    const vx = pip.vx / 28;
    if (pip.vx !== 0) p.facing = pip.vx > 0 ? 1 : -1;
    else p.facing = pip.facing;
    p.runAmt = lerp(p.runAmt, pip.grounded && Math.abs(vx) > 0.2 ? Math.abs(vx) : 0, Math.min(1, dt * 14));
    p.run += dt * 22 * Math.abs(vx);
    const leanTarget = pip.grounded ? vx * 0.14 : vx * 0.08 + (pip.vy / 72) * 0.05 * p.facing;
    p.lean = lerp(p.lean, leanTarget, Math.min(1, dt * 12));
    p.lag = lerp(p.lag, Phaser.Math.Clamp(-vx * 0.8 * p.facing + pip.vy / 60, -1, 1), Math.min(1, dt * 8));
    p.lookX = lerp(p.lookX, Math.abs(vx) > 0.1 ? 1 : 0.35, Math.min(1, dt * 10));
    p.lookY = lerp(p.lookY, Phaser.Math.Clamp(pip.vy / 50, -1, 1), Math.min(1, dt * 10));
    if (!pip.grounded) { const st = Phaser.Math.Clamp(-pip.vy / 66, -0.4, 1); p.sy = lerp(p.sy, 1 + st * 0.12, dt * 10); p.sx = lerp(p.sx, 1 - st * 0.08, dt * 10); }
    this.blinkT -= dt;
    if (this.blinkT < 0) { p.blink = 1; if (this.blinkT < -0.12) { p.blink = 0; this.blinkT = 2 + Math.random() * 3; } }
    else p.blink = 0;
    p.hurt = false;
  }

  private groundBelow(xpx: number, ypx: number): number | null {
    const w = this.world;
    const cx = Math.floor(xpx / TILE);
    for (let cy = Math.floor(ypx / TILE); cy < Math.min(w.H, Math.floor(ypx / TILE) + 8); cy++) {
      const g = w.tileAt(cx, cy);
      if (g === '#' || g === '=' || g === 'X' || g === '}' || g === '{') return Math.max(ypx, cy * TILE);
      if (g === '~') return cy * TILE;
    }
    return null;
  }

  private shadow(sh: Phaser.GameObjects.Graphics, x: number, y: number, wpx: number): void {
    const gy = this.groundBelow(x, y - 1);
    if (gy === null) return;
    const d = Math.max(0, gy - y);
    const k = Math.max(0, 1 - d / 160);
    if (k <= 0) return;
    sh.fillStyle(C.outline, 0.18 * k);
    sh.fillEllipse(x, gy - 1, wpx * (0.6 + 0.4 * k), 6 * (0.6 + 0.4 * k));
  }

  private drawPlayer(e: Phaser.GameObjects.Graphics, sh: Phaser.GameObjects.Graphics, a: number): void {
    const w = this.world, pip = w.pip;
    if (w.pipAlive) {
      const x = ux(lerp(pip.px, pip.x, a) + pip.w / 2), y = ux(lerp(pip.py, pip.y, a) + pip.h);
      this.shadow(sh, x, y, 26);
      drawPip(e, x, y + 0.5, this.pose);
    } else if (w.hitstop > 0 && this.deadPose) {
      const p = { ...this.pose, hurt: true, sx: 1.15, sy: 0.88, pop: 1 };
      drawPip(e, this.deadPose.x + rng.range(-1.5, 1.5), this.deadPose.y, p);
    }
  }

  private corpseLook(c: Corpse): CorpseLook {
    if (c.pin?.kind === 'floor') return 'floor';
    if (c.pin?.kind === 'wall') return 'wall';
    if (c.shape === 'slab') return 'slab';
    if (c.floating) return 'raft';
    return 'body';
  }

  private drawCorpses(e: Phaser.GameObjects.Graphics, sh: Phaser.GameObjects.Graphics, alpha: number, dt: number): void {
    const w = this.world;
    for (const c of w.corpses) {
      let a = this.corpseAnim.get(c.id);
      if (!a) { a = { seed: (c.id * 37) % 100, pop: 1, squash: 0, rattle: 0, lastStage: c.stage }; this.corpseAnim.set(c.id, a); }
      a.pop = Math.min(1, a.pop + dt * 5);
      a.squash = Math.max(0, a.squash - dt * 3.5);
      a.rattle = Math.max(0, a.rattle - dt * 3);
      let x = ux(lerp(c.px, c.x, alpha)), y = ux(lerp(c.py, c.y, alpha));
      const wpx = ux(c.w), hpx = ux(c.h);
      if (c.shiver > 0) x += Math.sin(this.t * 90) * 2.2;
      if (a.rattle > 0) x += Math.sin(this.t * 70) * 1.5 * a.rattle;
      if (c.floating) y += Math.sin(this.t * 3 + a.seed) * 1.3;
      const look = this.corpseLook(c);
      if (look === 'body' || look === 'raft' || look === 'slab') this.shadow(sh, x + wpx / 2, y + hpx, wpx * 0.9);
      // squash on landings / bounces, pop on appearance
      const sq = Math.sin(a.squash * Math.PI) * 0.35 * a.squash;
      const pop = Phaser.Math.Easing.Back.Out(a.pop);
      const sxk = (1 + sq) * pop, syk = (1 - sq) * pop;
      const bx = x + wpx / 2, by = y + hpx;
      const flip = c.pin?.kind === 'wall' ? w.tileAt(c.pin.cx, c.pin.cy) === '<' : (c.id % 2 === 1);
      e.save();
      e.translateCanvas(bx, by);
      e.scaleCanvas(sxk, syk);
      drawCorpse(e, -wpx / 2, -hpx, wpx, hpx, c.stage, look, this.t, a.seed, flip);
      e.restore();
    }
  }

  private drawConveyors(b: Phaser.GameObjects.Graphics): void {
    const w = this.world;
    for (let cy = 0; cy < w.H; cy++)
      for (let cx = 0; cx < w.W; cx++) {
        const g = w.tileAt(cx, cy);
        if (g !== '}' && g !== '{') continue;
        const x = cx * TILE, y = cy * TILE, dir = g === '}' ? 1 : -1;
        b.fillStyle(C.outline, 1);
        b.fillRect(x, y - 2, TILE, 12);
        b.fillStyle(C.metalDark, 1);
        b.fillRect(x, y + 1, TILE, 7);
        const off = ((this.t * 48 * dir) % 10 + 10) % 10;
        b.fillStyle(C.gold, 0.9);
        for (let i = -1; i < 5; i++) {
          const sx = x + i * 10 + off;
          if (sx < x - 2 || sx > x + TILE - 4) continue;
          b.fillTriangle(sx, y + 2, sx, y + 7, sx + 4 * dir, y + 4.5);
        }
        b.fillStyle(C.metal, 1);
        b.fillCircle(x + 6, y + 18, 3); b.fillCircle(x + 34, y + 18, 3);
      }
  }

  private drawObjectsBack(b: Phaser.GameObjects.Graphics, gl: Phaser.GameObjects.Graphics, a: number, dt: number): void {
    const w = this.world, o = w.obj;

    // sign posts
    for (const s of o.signs) {
      const x = s.def.x * TILE + 20, y = s.def.y * TILE + TILE;
      b.fillStyle(C.outline, 1);
      b.fillRoundedRect(x - 4.5, y - 22, 9, 22, 3);
      b.fillStyle(C.woodDark, 1);
      b.fillRoundedRect(x - 2, y - 20, 4, 20, 2);
      b.fillStyle(C.outline, 1);
      b.fillRoundedRect(x - 14, y - 34, 28, 18, 6);
      b.fillStyle(C.wood, 1);
      b.fillRoundedRect(x - 11.5, y - 31.5, 23, 13, 4);
      b.fillStyle(C.woodLight, 1);
      b.fillRoundedRect(x - 9, y - 30, 18, 3, 1.5);
      b.fillStyle(C.outline, 1);
      b.fillCircle(x - 5, y - 23.5, 1.6); b.fillCircle(x, y - 23.5, 1.6); b.fillCircle(x + 5, y - 23.5, 1.6);
    }

    // plates
    for (const p of o.plates) {
      const sinkT = this.plateSink.get(p.id) ?? 0;
      const sink = p.pressed ? 4 : 0;
      const x = ux(p.x), y = ux(p.y + p.h), wpx = ux(p.w);
      const bump = sinkT !== 0 ? Math.sin(this.t * 30) * 0 : 0;
      b.fillStyle(C.outline, 1);
      b.fillRoundedRect(x + 1, y - 5, wpx - 2, 7, 3);
      b.fillRoundedRect(x + 4, y - 10 + sink + bump, wpx - 8, 9, 4);
      b.fillStyle(p.pressed ? C.plateOn : C.hazard, 1);
      b.fillRoundedRect(x + 6.5, y - 7.5 + sink, wpx - 13, 5, 2.5);
      b.fillStyle(0xffffff, 0.55);
      b.fillRoundedRect(x + 9, y - 7 + sink, wpx - 22, 1.6, 1);
      // required weight pips + live weight
      const need = p.def.need, have = Math.min(p.weight, need);
      const r = 4, gap = 11, cx0 = x + wpx / 2 - ((need - 1) * gap) / 2, py = y - 20;
      b.fillStyle(C.outline, 0.9);
      b.fillRoundedRect(cx0 - r - 5, py - r - 4, (need - 1) * gap + r * 2 + 10, r * 2 + 8, r + 4);
      for (let i = 0; i < need; i++) {
        b.fillStyle(i < have ? (p.pressed ? C.plateOn : C.gold) : C.solidTop, 1);
        b.fillCircle(cx0 + i * gap, py, r);
        if (i < have) { b.fillStyle(0xffffff, 0.6); b.fillCircle(cx0 + i * gap - 1.2, py - 1.2, 1.3); }
      }
      if (p.weight > need) {
        b.fillStyle(C.plateOn, 1);
        b.fillCircle(cx0 + need * gap + 2, py, 2.4);
      }
      if (sinkT !== 0) this.plateSink.set(p.id, sinkT * Math.exp(-dt * 10));
    }

    // gates
    for (const g of o.gates) {
      const box = gateBox(g);
      const bounce = this.gateBounce.get(g.id) ?? 0;
      const over = Math.sin(bounce * Math.PI * 3) * bounce * 4;
      const x = ux(g.x), y = ux(g.y), full = ux(g.h), hpx = Math.max(0, ux(box.h) + (g.open > 0 && g.open < 1 ? 0 : over));
      // frame caps
      b.fillStyle(C.outline, 1);
      b.fillRoundedRect(x - 7, y - 3, 34, 9, 4);
      b.fillRoundedRect(x - 7, y + full - 5, 34, 7, 3);
      b.fillStyle(C.metal, 1);
      b.fillRoundedRect(x - 4.5, y - 0.5, 29, 4.5, 2);
      b.fillRoundedRect(x - 4.5, y + full - 3, 29, 3, 1.5);
      if (hpx > 1) {
        for (let i = 0; i < 3; i++) {
          const bx = x + 1 + i * 8.5;
          b.fillStyle(C.outline, 1);
          b.fillRoundedRect(bx - 1.5, y, 7, hpx + 1.5, 3);
          b.fillStyle(C.metalDark, 1);
          b.fillRoundedRect(bx, y, 4, hpx, 2);
          b.fillStyle(C.metal, 1);
          b.fillRect(bx + 0.8, y, 1.4, hpx - 2);
        }
        b.fillStyle(C.outline, 1);
        b.fillRoundedRect(x - 3, y + hpx - 7, 26, 8, 3);
        b.fillStyle(C.hazard, 1);
        b.fillRoundedRect(x - 1, y + hpx - 5, 22, 4, 2);
      }
      if (bounce > 0) this.gateBounce.set(g.id, Math.max(0, bounce - dt * 1.6));
    }

    // platforms
    for (const p of o.platforms) {
      const pos = this.ip(p.id, p.x, p.y, a);
      const x = ux(pos.x), y = ux(pos.y), wpx = ux(p.w), hpx = ux(p.h);
      b.fillStyle(C.outline, 1);
      b.fillRoundedRect(x - 2.5, y - 2.5, wpx + 5, (p.def.oneWay ? 6 : hpx) + 5, 6);
      if (p.def.oneWay) {
        // Drop-through: a thin bone plank with a dashed underside.
        b.fillStyle(C.bone, 1);
        b.fillRoundedRect(x, y, wpx, 6, 3);
        b.fillStyle(C.boneShade, 1);
        b.fillRect(x + 3, y + 4, wpx - 6, 2);
        b.fillStyle(C.outline, 1);
        for (const kx of [x + 1, x + wpx - 1]) { b.fillCircle(kx, y + 1.5, 4.2); b.fillCircle(kx, y + 4.5, 4.2); }
        b.fillStyle(C.bone, 1);
        for (const kx of [x + 1, x + wpx - 1]) { b.fillCircle(kx, y + 1.5, 2.6); b.fillCircle(kx, y + 4.5, 2.6); }
        b.fillStyle(C.outline, 0.35);
        for (let i = 4; i < wpx - 6; i += 9) b.fillRect(x + i, y + hpx - 1, 5, 2);
      } else {
        b.fillStyle(C.wood, 1);
        b.fillRoundedRect(x, y, wpx, hpx, 4);
        b.fillStyle(C.woodLight, 1);
        b.fillRoundedRect(x + 3, y + 1.5, wpx - 6, 2.5, 1.2);
        b.fillStyle(C.woodDark, 1);
        b.fillCircle(x + 6, y + hpx / 2 + 1, 1.8); b.fillCircle(x + wpx - 6, y + hpx / 2 + 1, 1.8);
      }
      // little wheels when moving
      if (p.active && !p.done) {
        b.fillStyle(C.gold, 0.9);
        b.fillCircle(x + wpx / 2, y + hpx + 4 + Math.sin(this.t * 20) * 0.6, 2.4);
      }
    }

    // tile movers
    o.movers.forEach((m, i) => {
      const pos = this.ip(`mover${i}`, m.ox, m.oy, a);
      const set = new Set(m.cells.filter((c) => c.g === '#' || c.g === '=' || c.g === 'X').map((c) => cellKey(c.cx, c.cy)));
      for (const c of m.cells) {
        if (!set.has(cellKey(c.cx, c.cy))) continue;
        const S = (dx: number, dy: number) => set.has(cellKey(c.cx + dx, c.cy + dy));
        drawBlock(b, c.cx * TILE + ux(pos.x), c.cy * TILE + ux(pos.y), S(0, -1), S(0, 1), S(1, 0), S(-1, 0));
      }
    });

    // droppers (idle ones are part of the terrain)
    for (const d of o.droppers) {
      if (d.state === 'idle' || d.state === 'gone') continue;
      const pos = this.ip(d.id, d.x, d.y, a);
      let x = ux(pos.x), y = ux(pos.y);
      if (d.state === 'shake' || d.state === 'armed') { x += Math.sin(this.t * 80) * 1.8; y += Math.cos(this.t * 60) * 0.8; if (Math.random() < 0.5) this.particles.trickle(x + 20, y + TILE); }
      drawBlock(b, x, y, false, false, false, false, 7);
      if (d.state === 'fall') {
        b.fillStyle(C.white, 0.35);
        b.fillRoundedRect(x + 6, y - 18, 3, 14, 1.5); b.fillRoundedRect(x + 31, y - 22, 3, 18, 1.5);
      }
    }

    // crushers
    for (const c of o.crushers) {
      const pos = this.ip(c.id, c.x, c.y, a);
      const x = ux(pos.x), y = ux(pos.y), wpx = ux(c.w), hpx = ux(c.h), home = ux(c.homeY);
      if (y > home + 1) {
        b.fillStyle(C.outline, 1);
        b.fillRoundedRect(x + wpx / 2 - 7, home - 2, 14, y - home + 6, 4);
        b.fillStyle(C.metal, 1);
        b.fillRoundedRect(x + wpx / 2 - 4, home, 8, y - home + 3, 3);
        b.fillStyle(C.white, 0.35);
        b.fillRect(x + wpx / 2 - 2.5, home, 1.6, y - home);
      }
      b.fillStyle(C.outline, 1);
      b.fillRoundedRect(x - 3, y - 3, wpx + 6, hpx + 6, 9);
      b.fillStyle(C.metalDark, 1);
      b.fillRoundedRect(x, y, wpx, hpx, 7);
      b.fillStyle(C.metal, 1);
      b.fillRoundedRect(x + 3, y + 3, wpx - 6, 6, 3);
      // hazard stripes along the bottom
      const sy = y + hpx - 11;
      b.fillStyle(C.gold, 1);
      b.fillRect(x + 3, sy, wpx - 6, 8);
      b.fillStyle(C.outline, 1);
      for (let sx = x + 3; sx < x + wpx - 10; sx += 12) { b.fillTriangle(sx, sy + 8, sx + 5, sy, sx + 9, sy); b.fillTriangle(sx, sy + 8, sx + 9, sy, sx + 4, sy + 8); }
      b.fillStyle(C.outline, 1);
      b.fillCircle(x + 8, y + 16, 2.2); b.fillCircle(x + wpx - 8, y + 16, 2.2);
      if (c.state === 'slam' || c.state === 'hold') { b.fillStyle(C.hazard, 0.9); b.fillCircle(x + wpx / 2, y + 16, 3.5); }
    }

    // laser emitters
    for (const l of o.lasers) {
      if (!l.emitterBox) continue;
      const x = ux(l.emitterBox.x), y = ux(l.emitterBox.y);
      b.fillStyle(C.outline, 1);
      b.fillRoundedRect(x + 3, y + 3, 34, 34, 9);
      b.fillStyle(C.solidTop, 1);
      b.fillRoundedRect(x + 6, y + 6, 28, 28, 7);
      const dir = l.def.dir;
      const lx = x + 20 + (dir === 'left' ? -10 : dir === 'right' ? 10 : 0), ly = y + 20 + (dir === 'up' ? -10 : dir === 'down' ? 10 : 0);
      b.fillStyle(C.outline, 1); b.fillCircle(lx, ly, 7);
      b.fillStyle(l.active ? C.laser : 0x7a4a68, 1); b.fillCircle(lx, ly, 5);
      b.fillStyle(0xffffff, 0.8); b.fillCircle(lx - 1.5, ly - 1.5, 1.6);
      if (l.active) { gl.fillStyle(C.laser, 0.35); gl.fillCircle(lx, ly, 11 + Math.sin(this.t * 20) * 1.5); }
    }

    // pop-up spikes
    for (const p of o.popups) {
      if (!p.up) continue;
      let r = this.popRise.get(p.id) ?? 1;
      r = Math.min(1, r + dt * 9);
      this.popRise.set(p.id, r);
      drawSpikes(b, p.def.x * TILE, p.def.y * TILE, '^', Phaser.Math.Easing.Back.Out(r));
    }

    // doors
    for (const d of o.doors) this.drawDoor(b, d, a);
  }

  private drawDoor(b: Phaser.GameObjects.Graphics, d: RtDoor, a: number): void {
    const pos = this.ip(d.id, d.x, d.y, a);
    let x = ux(pos.x), y = ux(pos.y);
    const wpx = ux(d.w), hpx = ux(d.h);
    const runaway = !!d.def.runaway;
    if (d.state === 'tremble') x += Math.sin(this.t * 70) * 1.6;
    const glow = this.doorGlows.get(d.id);
    if (glow) { glow.setPosition(x + wpx / 2, y + hpx * 0.55); glow.setScale(0.9 + Math.sin(this.t * 2.5) * 0.06); }
    const legLift = runaway ? 7 : 0;
    const bodyY = y - legLift;
    if (runaway) {
      const ph = d.state === 'run' || d.state === 'hop' ? this.t * 26 : 0;
      for (const [lx, s] of [[x + 9, 1], [x + wpx - 9, -1]] as const) {
        const off = Math.sin(ph) * 3 * s;
        b.lineStyle(5, C.outline, 1); b.lineBetween(lx, bodyY + hpx - 2, lx + off, y + hpx - 1);
        b.lineStyle(2.4, C.woodDark, 1); b.lineBetween(lx, bodyY + hpx - 2, lx + off, y + hpx - 1);
        b.fillStyle(C.outline, 1); b.fillEllipse(lx + off + 2 * d.facing, y + hpx - 1, 9, 5);
      }
    } else {
      b.fillStyle(C.outline, 0.25);
      b.fillEllipse(x + wpx / 2, y + hpx + 1, wpx + 10, 6);
    }
    // frame + door
    b.fillStyle(C.outline, 1);
    b.fillRoundedRect(x - 3, bodyY - 3, wpx + 6, hpx + 3, { tl: wpx / 2 + 3, tr: wpx / 2 + 3, bl: 3, br: 3 });
    b.fillStyle(C.woodDark, 1);
    b.fillRoundedRect(x, bodyY, wpx, hpx - 1, { tl: wpx / 2, tr: wpx / 2, bl: 2, br: 2 });
    b.fillStyle(C.wood, 1);
    b.fillRoundedRect(x + 4, bodyY + 4, wpx - 8, hpx - 6, { tl: wpx / 2 - 4, tr: wpx / 2 - 4, bl: 1, br: 1 });
    b.fillStyle(C.woodLight, 1);
    b.fillRoundedRect(x + 8, bodyY + 9, wpx / 2 - 10, hpx - 16, { tl: 6, tr: 2, bl: 2, br: 2 });
    b.fillStyle(C.woodDark, 0.5);
    b.fillRect(x + wpx / 2 - 0.8, bodyY + 6, 1.6, hpx - 8);
    b.fillStyle(C.outline, 1); b.fillCircle(x + wpx - 9, bodyY + hpx * 0.58, 3.4);
    b.fillStyle(C.gold, 1); b.fillCircle(x + wpx - 9, bodyY + hpx * 0.58, 2.2);
    if (runaway) {
      // a face: eyes, and a smirk when hopping / worry when trembling
      const ex = x + wpx / 2 + d.facing * -1, ey = bodyY + 14;
      b.fillStyle(C.white, 1); b.fillEllipse(ex - 5, ey, 7, 8); b.fillEllipse(ex + 5, ey, 7, 8);
      b.fillStyle(C.outline, 1); b.fillCircle(ex - 5 - d.facing * 1.4, ey + 0.5, 2); b.fillCircle(ex + 5 - d.facing * 1.4, ey + 0.5, 2);
      b.lineStyle(1.8, C.outline, 1);
      b.beginPath();
      if (d.state === 'hop') { b.moveTo(ex - 5, ey + 8); b.lineTo(ex + 1, ey + 10); b.lineTo(ex + 6, ey + 6); }
      else if (d.state === 'tremble') { b.moveTo(ex - 5, ey + 10); b.lineTo(ex - 2, ey + 8); b.lineTo(ex + 1, ey + 10); b.lineTo(ex + 4, ey + 8); }
      else { b.moveTo(ex - 3, ey + 8); b.lineTo(ex + 3, ey + 8); }
      b.strokePath();
      if (d.state === 'tremble') { b.fillStyle(C.water, 0.9); b.fillEllipse(x + wpx - 4, bodyY + 6 + ((this.t * 40) % 10), 3, 5); }
    }
  }

  private drawWater(f: Phaser.GameObjects.Graphics): void {
    const w = this.world;
    for (let cx = 0; cx < w.W; cx++) {
      for (let cy = 0; cy < w.H; cy++) {
        if (w.tileAt(cx, cy) !== '~') continue;
        const x = cx * TILE, y = cy * TILE;
        const surface = w.tileAt(cx, cy - 1) !== '~';
        if (surface) {
          const pts: Phaser.Types.Math.Vector2Like[] = [];
          for (let i = 0; i <= 8; i++) {
            const px = x + (i / 8) * TILE;
            pts.push({ x: px, y: y + 5 + Math.sin(this.t * 3 + px * 0.09) * 2 + Math.sin(this.t * 1.7 + px * 0.05) * 1.2 });
          }
          pts.push({ x: x + TILE, y: y + TILE }, { x, y: y + TILE });
          f.fillStyle(C.water, 0.82);
          f.fillPoints(pts, true);
          f.lineStyle(3, C.waterHi, 0.95);
          f.beginPath();
          f.moveTo(pts[0]!.x, pts[0]!.y);
          for (let i = 1; i <= 8; i++) f.lineTo(pts[i]!.x, pts[i]!.y);
          f.strokePath();
        } else {
          f.fillStyle(C.waterDeep, 0.85);
          f.fillRect(x, y, TILE, TILE);
        }
        // caustics + current streaks
        f.fillStyle(C.waterHi, 0.22);
        const ph = this.t * (w.current.speed ? w.current.dir * w.current.speed * 0.6 : 0.3);
        for (let i = 0; i < 2; i++) {
          const sx = x + (((ph * 30 + i * 21 + cy * 13) % TILE) + TILE) % TILE;
          f.fillRoundedRect(sx - 6, y + 14 + i * 12 + Math.sin(this.t * 2 + i + cx) * 2, 12, 2.2, 1);
        }
      }
    }
  }

  private drawLasers(f: Phaser.GameObjects.Graphics, gl: Phaser.GameObjects.Graphics): void {
    const w = this.world;
    for (const l of w.obj.lasers) {
      const bm = l.beam;
      if (bm.w <= 0 || bm.h <= 0) continue;
      const hidden = l.def.hidden && !w.revealed.has(l.id);
      if (hidden) continue;
      const x = ux(bm.x), y = ux(bm.y), wpx = ux(bm.w), hpx = ux(bm.h);
      const vertical = hpx > wpx;
      const cxp = x + wpx / 2, cyp = y + hpx / 2;
      const flash = this.revealFlash.get(l.id) ?? 0;
      if (flash > 0) this.revealFlash.set(l.id, Math.max(0, flash - 0.02));
      if (l.active) {
        const fl = 1 + Math.sin(this.t * 37) * 0.12 + Math.sin(this.t * 13) * 0.08 + flash * 1.5;
        const glowW = 22 * fl, mid = 9, core = 3.5;
        gl.fillStyle(C.laser, 0.28);
        if (vertical) gl.fillRoundedRect(cxp - glowW / 2, y, glowW, hpx, glowW / 2); else gl.fillRoundedRect(x, cyp - glowW / 2, wpx, glowW, glowW / 2);
        gl.fillStyle(C.laser, 0.35);
        if (vertical) gl.fillRect(cxp - glowW / 4, y, glowW / 2, hpx); else gl.fillRect(x, cyp - glowW / 4, wpx, glowW / 2);
        f.fillStyle(C.laser, 0.95);
        if (vertical) f.fillRect(cxp - mid / 2, y, mid, hpx); else f.fillRect(x, cyp - mid / 2, wpx, mid);
        f.fillStyle(C.laserCore, 1);
        if (vertical) f.fillRect(cxp - core / 2, y, core, hpx); else f.fillRect(x, cyp - core / 2, wpx, core);
        // travelling sparkles along the beam
        const len = vertical ? hpx : wpx;
        for (let i = 0; i < Math.max(2, len / 24); i++) {
          const p = ((this.t * 160 + i * 47) % len);
          gl.fillStyle(0xffffff, 0.6);
          if (vertical) gl.fillCircle(cxp + Math.sin(i + this.t * 9) * 2, y + p, 1.6); else gl.fillCircle(x + p, cyp + Math.sin(i + this.t * 9) * 2, 1.6);
        }
        if (Math.random() < 0.15) this.particles.sparks(vertical ? cxp : x + wpx, vertical ? y + hpx : cyp, 1, C.laser);
      } else {
        // switched off: a faint dashed guide so the hazard stays readable
        f.fillStyle(C.laser, 0.28);
        const len = vertical ? hpx : wpx;
        for (let p = 0; p < len; p += 12) { if (vertical) f.fillRect(cxp - 1, y + p, 2, 6); else f.fillRect(x + p, cyp - 1, 6, 2); }
      }
    }
  }

  private drawSigns(dt: number): void {
    const w = this.world;
    const px = w.pip.x + w.pip.w / 2, py = w.pip.y + w.pip.h / 2;
    // Only the nearest sign in range talks, so neighbouring boards never overlap.
    let nearest: string | null = null, best = Infinity;
    if (w.pipAlive) for (const s of w.obj.signs) {
      const d = Math.hypot(px - (s.def.x * U + U / 2), py - (s.def.y * U + U / 2));
      if (d <= SIGN_RANGE && d < best && signText(w, s)) { best = d; nearest = s.id; }
    }
    for (const s of w.obj.signs) {
      let bub = this.bubbles.get(s.id);
      if (!bub) { bub = new SignBubble(this.scene, 17, 250); this.bubbles.set(s.id, bub); this.signLayer.add(bub); }
      const near = s.id === nearest;
      const text = signText(w, s);
      bub.setContent(text, this.zoom);
      const half = (bub.list[1] as Phaser.GameObjects.Text).width / 2 + 20 / this.zoom;
      bub.setPosition(Phaser.Math.Clamp(s.def.x * TILE + 20, half + 6, w.W * TILE - half - 6), 0);
      bub.y = s.def.y * TILE + TILE - 40 - (bub.list[1] as Phaser.GameObjects.Text).height / 2 - 14 / this.zoom;
      if (near && text) { if (!bub.shown) audio.play('tock', 1 + rng.range(-0.05, 0.05)); bub.show(); }
      else bub.hide();
    }
    if (this.tauntT > 0) {
      this.tauntT -= dt;
      const sp = w.spawnPoint();
      const bw = (this.taunt.list[1] as Phaser.GameObjects.Text).width / 2 + 22 / this.zoom;
      const tx = Phaser.Math.Clamp(ux(sp.x + 90), TILE + bw, w.W * TILE - TILE - bw);
      this.taunt.setPosition(tx, ux(sp.y) - 78 - (this.taunt.list[1] as Phaser.GameObjects.Text).height / 2);
      if (this.tauntT <= 0) this.taunt.hide();
    }
  }
}
