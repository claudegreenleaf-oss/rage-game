// Layered parallax backdrop behind every scene: gradient sky, light rays, distant rounded silhouettes,
// a faint large-dot pattern, drifting motes and a soft vignette. Each act has its own mood.
import Phaser from 'phaser';
import { MOODS, type Mood } from '../render/palette';
import { Rng } from '../render/rng';

const W = 1280, H = 720;

interface Layer { root: Phaser.GameObjects.Container; far: Phaser.GameObjects.TileSprite; mid: Phaser.GameObjects.TileSprite; dots: Phaser.GameObjects.TileSprite; rays: Phaser.GameObjects.Image[] }

export class Backdrop extends Phaser.Scene {
  private layers = new Map<number, Layer>();
  private mood = -1;
  private motes!: Phaser.GameObjects.Particles.ParticleEmitter;
  private vignette!: Phaser.GameObjects.Image;
  private t = 0;
  /** -1..1 parallax hint from the game (Pip's position). */
  parallax = { x: 0, y: 0 };
  private px = 0;
  private py = 0;

  constructor() { super('Backdrop'); }

  create(): void {
    this.motes = this.add.particles(0, 0, 'soft', {
      x: { min: 0, max: W }, y: { min: H * 0.2, max: H + 20 },
      lifespan: 9000, speedY: { min: -22, max: -8 }, speedX: { min: -6, max: 10 },
      scale: { start: 0.25, end: 0 }, alpha: { start: 0.0, end: 0.0, ease: 'Sine.easeInOut' },
      frequency: 260, blendMode: 'ADD',
      emitCallback: (p: Phaser.GameObjects.Particles.Particle) => { p.alpha = 0; },
    });
    this.motes.setDepth(5);
    this.motes.addParticleProcessor({
      update: (p: Phaser.GameObjects.Particles.Particle) => { const k = p.lifeCurrent / p.life; p.alpha = Math.sin(k * Math.PI) * 0.55; p.x += Math.sin((p.lifeCurrent + p.y) * 0.002) * 0.15; },
    } as unknown as Phaser.GameObjects.Particles.ParticleProcessor);
    this.vignette = this.add.image(W / 2, H / 2, 'vignette').setDisplaySize(W, H).setDepth(10).setAlpha(0.32);
    this.setMood(0, true);
  }

  private buildLayer(k: number, m: Mood): Layer {
    const root = this.add.container(0, 0).setDepth(0);
    const sky = this.add.image(W / 2, H / 2, `sky${k}`).setDisplaySize(W, H);
    const rays = [0, 1, 2].map((i) => this.add.image(260 + i * 380, -20, 'ray').setOrigin(0.5, 0).setDisplaySize(160 + i * 40, 820).setAngle(-18 + i * 4).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.18));
    this.makeSilhouettes(`far${k}`, m.far, k, 0.55, 1);
    this.makeSilhouettes(`mid${k}`, m.mid, k, 0.35, 2);
    const far = this.add.tileSprite(W / 2, H - 230, W + 200, 460, `far${k}`).setAlpha(0.8);
    const mid = this.add.tileSprite(W / 2, H - 150, W + 240, 300, `mid${k}`).setAlpha(0.75);
    const dots = this.add.tileSprite(W / 2, H / 2, W + 200, H + 200, 'dots').setTint(m.dot).setAlpha(0.55);
    root.add([sky, ...rays, far, dots, mid]);
    return { root, far, mid, dots, rays };
  }

  /** Rounded distant shapes: town towers (act 1), drippy caverns (act 2), bone arches (act 3). */
  private makeSilhouettes(key: string, color: number, act: number, _scale: number, seed: number): void {
    if (this.textures.exists(key)) return;
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    const w = 1280, h = seed === 1 ? 460 : 300;
    // Draw three copies offset by the texture width so the tile sprite wraps seamlessly.
    for (const ox of [-w, 0, w]) {
    const r = new Rng(seed * 977 + act * 131);
    g.save();
    g.translateCanvas(ox, 0);
    g.fillStyle(color, 1);
    if (act === 2) {
      // drippy cave ceiling + mossy mounds
      for (let x = -40; x < w + 40; x += r.range(70, 130)) { const rw = r.range(80, 160); g.fillEllipse(x, h - r.range(20, 60), rw * 1.6, r.range(90, 180)); }
      if (seed === 1) for (let x = 0; x < w; x += r.range(60, 120)) { const len = r.range(40, 140); g.fillRoundedRect(x, 0, r.range(18, 34), len, 14); g.fillCircle(x + 12, len, 12); }
    } else if (act === 3) {
      // bone arches, gravestones, a big moon-ish disc
      if (seed === 1) g.fillCircle(980, 120, 70);
      for (let x = 0; x < w; x += r.range(160, 260)) {
        const aw = r.range(90, 150), ah = r.range(120, 220), y = h;
        g.fillRoundedRect(x, y - ah, 26, ah, 13); g.fillRoundedRect(x + aw, y - ah, 26, ah, 13);
        g.lineStyle(26, color, 1); g.beginPath(); g.arc(x + 13 + aw / 2, y - ah, aw / 2, Math.PI, 0); g.strokePath();
        g.fillCircle(x + 13, y - ah, 18); g.fillCircle(x + aw + 13, y - ah, 18);
      }
      for (let x = 30; x < w; x += r.range(90, 170)) { const gw = r.range(30, 50); g.fillRoundedRect(x, h - r.range(40, 80), gw, 120, { tl: gw / 2, tr: gw / 2, bl: 0, br: 0 }); }
    } else {
      // rolling hills and round-topped towers
      for (let x = -60; x < w + 60; x += r.range(140, 240)) { const tw = r.range(50, 90), th = r.range(140, 300); g.fillRoundedRect(x, h - th, tw, th + 10, { tl: tw / 2, tr: tw / 2, bl: 0, br: 0 }); if (r.next() < 0.6) g.fillCircle(x + tw / 2, h - th - 10, tw * 0.28); }
      for (let x = -80; x < w + 80; x += r.range(120, 200)) g.fillEllipse(x, h, r.range(240, 380), r.range(140, 220));
    }
    g.restore();
    }
    g.generateTexture(key, w, h);
    g.destroy();
  }

  setMood(act: number, instant = false): void {
    if (act === this.mood) return;
    const m = MOODS[act] ?? MOODS[0]!;
    let layer = this.layers.get(act);
    if (!layer) { layer = this.buildLayer(act, m); this.layers.set(act, layer); }
    const prevMood = this.mood;
    this.mood = act;
    for (const [k, l] of this.layers) {
      this.tweens.killTweensOf(l.root);
      if (k === act) { l.root.setDepth(1); if (instant) l.root.setAlpha(1); else { l.root.setAlpha(prevMood < 0 ? 1 : 0); this.tweens.add({ targets: l.root, alpha: 1, duration: 900, ease: 'Sine.easeInOut' }); } }
      else { l.root.setDepth(0); }
    }
    this.motes.setParticleTint(m.mote);
    this.vignette.setTint(m.vignette);
  }

  override update(_t: number, dms: number): void {
    const dt = dms / 1000;
    this.t += dt;
    this.px += (this.parallax.x - this.px) * Math.min(1, dt * 3);
    this.py += (this.parallax.y - this.py) * Math.min(1, dt * 3);
    const l = this.layers.get(this.mood);
    if (!l) return;
    l.far.tilePositionX = this.t * 4 + this.px * 18;
    l.mid.tilePositionX = this.t * 9 + this.px * 40;
    l.far.y = H - 230 + this.py * 6;
    l.mid.y = H - 150 + this.py * 12;
    l.dots.tilePositionX = this.t * 6 + this.px * 10;
    l.dots.tilePositionY = this.t * 4;
    l.rays.forEach((r, i) => { r.setAlpha(0.13 + Math.sin(this.t * 0.5 + i * 1.7) * 0.06); r.setAngle(-18 + i * 4 + Math.sin(this.t * 0.2 + i) * 2); });
  }
}
