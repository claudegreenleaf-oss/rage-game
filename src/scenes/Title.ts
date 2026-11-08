// Title: bouncing pixel logo, Pip bobbing, corpses tumbling onto a pile (the 3-body cap in miniature),
// a rotating taunt sign and the menu.
import Phaser from 'phaser';
import { C } from '../render/palette';
import { Button, Menu, SignBubble, UI } from '../render/ui';
import { ATLAS, corpseFrame } from '../render/pixel/sprites';
import { glyphRows, ptext } from '../render/pixel/font';
import { KEY, ACT_PAL, hash2, mix } from '../render/pixel/pal';
import { Buf, T, drawStone } from '../render/pixel/terrain';
import { Pixels } from '../render/pixel/particles';
import { rng } from '../render/rng';
import { audio } from '../audio/sfx';
import { music } from '../audio/music';
import { progress } from '../progress';
import { LEVELS } from '../levels';
import { decodeLevel } from '../editor/share';
import { startLevel, type GameData } from './Game';
import { promptModal } from './dom';
import type { Backdrop } from './Backdrop';
import type { Overlay } from './Overlay';
import type { Stage } from '../sim/types';

const W = 1280, H = 720, S = 4;
const GROUND = 160; // in 1/4-scale pixels (640 on screen)

const TAUNTS = [
  'Death is just a shortcut.', 'Bring a friend. Then bring their body.', 'Everything here is safe. Probably.',
  'The floor is lying to you.', "I'm keeping the bodies.", "Trust the signs. Or don't.", 'Every level is fair. Eventually.',
];

interface Tumbler { img: Phaser.GameObjects.Image; x: number; y: number; vy: number; vx: number; stage: Stage; landed: boolean; sq: number }

/** "DIE TRYING" as a bolted lab sign: beveled letters on a steel plate, half swallowed by moss. */
export function labLogo(scene: Phaser.Scene, key: string): void {
  if (scene.textures.exists(key)) return;
  const word = 'DIE TRYING';
  const px = 2; // logo pixels per font pixel
  const glyphs = [...word].map((ch) => (ch === ' ' ? null : glyphRows(ch, true)));
  const textW = glyphs.reduce((w, g) => w + (g ? (g[0]!.length + 1) * px : 4 * px), 0) - px;
  const padX = 10, padTop = 10, padBot = 12;
  const w = textW + padX * 2, h = 7 * px + padTop + padBot;
  const b = new Buf(w + 2, h + 20);
  const B = { set: (x: number, y: number, c: number) => b.set(x + 1, y + 5, c), get: (x: number, y: number) => b.get(x + 1, y + 5) };
  const pal = ACT_PAL[0]!;
  // Steel plate with bevel, rivets and a hazard stripe along the bottom.
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1;
    let c = edge ? KEY.k! : y === 1 || x === 1 ? pal.plateHi : y === h - 2 || x === w - 2 ? pal.plateDark : pal.plate;
    if (!edge && y >= h - 7 && y <= h - 4) c = ((x + y) >> 1) % 2 ? KEY.z! : KEY.k!;
    if (!edge && y === h - 8) c = pal.trim;
    if ((x === 4 || x === w - 5) && (y === 4 || y === h - 10)) c = pal.plateHi;
    if (!edge && c === pal.plate && hash2(x, y, 5) < 0.04) c = pal.plateLight;
    B.set(x, y, c);
  }
  // Letters: DIE in hazard coral, TRYING in white steel, beveled, with an ink outline.
  const fill = new Map<number, number>();
  let x0 = padX;
  glyphs.forEach((g, gi) => {
    if (!g) { x0 += 4 * px; return; }
    const coral = gi < 3;
    g.forEach((row, j) => { for (let i = 0; i < row.length; i++) if (row[i] === '#') for (let dy = 0; dy < px; dy++) for (let dx = 0; dx < px; dx++) {
      const X = x0 + i * px + dx, Y = padTop + j * px + dy;
      const top = j === 0 || g[j - 1]![i] !== '#';
      const bot = j === g.length - 1 || g[j + 1]?.[i] !== '#';
      let c = coral ? KEY.r! : 0xeef2f6;
      if (top && dy === 0) c = coral ? KEY.y! : 0xffffff;
      if (bot && dy === px - 1) c = coral ? KEY.R! : 0xa9b4c2;
      fill.set(Y * 10000 + X, c);
    } });
    x0 += (g[0]!.length + 1) * px;
  });
  for (const [k] of fill) { const X = k % 10000, Y = Math.floor(k / 10000); for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!fill.has((Y + dy) * 10000 + X + dx)) B.set(X + dx, Y + dy, KEY.k!); }
  for (const [k, c] of fill) B.set(k % 10000, Math.floor(k / 10000), c);
  // Moss swallowing the left half: cushions on the plate top and letter tops, vines hanging over.
  for (let x = 0; x < w; x++) {
    const reach = 1 - x / (w * 0.72);
    if (reach <= 0 || hash2(x, 1, 7) > reach + 0.15) continue;
    const thick = 1 + Math.floor(hash2(x, 2, 7) * 3 * Math.max(0.3, reach));
    for (let k = -thick; k < 2; k++) B.set(x, k + 1, k === -thick ? KEY.k! : k < 0 ? pal.moss : pal.mossDark);
    if (hash2(x, 3, 7) < 0.3 * reach) B.set(x, -thick, pal.mossLight);
    if (hash2(x, 4, 7) < 0.22 * reach) { const len = 4 + Math.floor(hash2(x, 5, 7) * (h * 0.9)); let vx = x; for (let j = 2; j < 2 + len; j++) { B.set(vx, j, j % 4 ? pal.mossDark : pal.moss); if (j % 5 === 0) vx += hash2(x, j, 8) < 0.5 ? -1 : 1; } B.set(vx, 2 + len, pal.mossLight); }
  }
  // Grime in the lower-right corner.
  for (let y = h - 12; y < h - 1; y++) for (let x = w - 30; x < w - 1; x++) if (hash2(x, y, 9) < 0.25) B.set(x, y, mix(B.get(x, y), pal.stain, 0.4));
  const t = scene.textures.createCanvas(key, b.w, b.h)!;
  b.blit(t.getContext());
  t.refresh();
}

/** A strip of lab floor panels for the title floor. */
export function groundTexture(scene: Phaser.Scene, key: string, tilesW: number): void {
  if (scene.textures.exists(key)) return;
  const b = new Buf(tilesW * T, 2 * T + 3);
  const solid = (_cx: number, cy: number) => cy >= 1;
  for (let cx = 0; cx < tilesW; cx++) for (let cy = 1; cy < 3; cy++) drawStone(b, cx * T, (cy - 1) * T + 3, cx, cy, solid, ACT_PAL[0]!);
  const t = scene.textures.createCanvas(key, b.w, b.h)!;
  b.blit(t.getContext());
  t.refresh();
}

export class Title extends Phaser.Scene {
  private world!: Phaser.GameObjects.Container; // 1/4-scale layer for sprites
  private pixels!: Pixels;
  private pip!: Phaser.GameObjects.Image;
  private post!: Phaser.GameObjects.Image;
  private t = 0;
  private tumblers: Tumbler[] = [];
  private nextDrop = 1.2;
  private sign!: SignBubble;
  private tauntIdx = 0;
  private blink = 2;
  private speaker!: Phaser.GameObjects.Image;
  private cleared: { name: string; deaths: number } | null = null;

  constructor() { super('Title'); }

  init(d: { cleared?: { name: string; deaths: number } }): void { this.cleared = d?.cleared ?? null; this.tumblers = []; this.t = 0; this.nextDrop = 1.2; }

  create(): void {
    (this.scene.get('Backdrop') as Backdrop).setMood(0);
    music.play(0);
    history.replaceState(null, '', location.pathname + location.search);

    groundTexture(this, 'titleGround', 21);
    this.add.image(0, GROUND * S - 3 * S, 'titleGround').setOrigin(0).setScale(S);
    this.world = this.add.container(0, 0).setScale(S);
    this.pixels = new Pixels(this, this.world, 120);

    this.makeLogo();

    // Taunt sign on a post, left of the menu.
    this.post = this.add.image(44, GROUND, ATLAS, 'signpost0').setOrigin(0.5, 1);
    this.world.add(this.post);
    this.sign = new SignBubble(this, 21, 300);
    this.sign.setPosition(44 * S, (GROUND - 15) * S);
    this.sign.setContent(TAUNTS[0]!);
    this.time.delayedCall(900, () => this.sign.show());
    this.time.addEvent({ delay: 3800, loop: true, callback: () => this.nextTaunt() });

    // Pip.
    this.world.add(this.add.image(80, GROUND, ATLAS, 'shadow').setOrigin(0.5, 0.5));
    this.pip = this.add.image(80, GROUND, ATLAS, 'pip_idle0').setOrigin(0.5, 1);
    this.world.add(this.pip);

    // Menu.
    const unlocked = progress.editorUnlocked();
    const editorScene = !!this.game.scene.keys['Editor'];
    const buttons = [
      new Button(this, W / 2, 330, progress.get().unlocked > 0 ? 'Continue' : 'Play', () => this.play(), { color: C.hazard, w: 300, h: 66, size: 30 }),
      new Button(this, W / 2, 414, 'Levels', () => this.go(() => this.scene.start('LevelSelect'))),
      new Button(this, W / 2, 486, unlocked ? 'Editor' : 'Editor', () => this.openEditor(editorScene), { locked: !unlocked, color: C.rot }),
      new Button(this, W / 2, 558, 'Paste code', () => void this.paste(), { color: C.paper }),
    ];
    buttons.forEach((b, i) => { b.setAlpha(0); this.tweens.add({ targets: b, alpha: 1, duration: 300, delay: 500 + i * 90, ease: 'Stepped', easeParams: [3] }); });
    new Menu(this, buttons);
    if (!unlocked) {
      this.add.image(W / 2 + 112, 486 - 3, ATLAS, 'lock').setScale(UI);
      ptext(this, W / 2 + 150, 486 - 3, 'beat act 1', { scale: 2, outline: true, color: 0xfff4e4, origin: [0, 0.5] });
    }

    this.speaker = this.add.image(W - 40, 34, ATLAS, 'speaker').setScale(UI).setInteractive({ useHandCursor: true });
    this.speaker.on('pointerdown', () => { void audio.unlock(); audio.toggleMute(); });
    const unsub = audio.onMute(() => this.speaker.setFrame(audio.muted ? 'speakerOff' : 'speaker'));
    this.events.once('shutdown', () => unsub());
    this.speaker.setFrame(audio.muted ? 'speakerOff' : 'speaker');
    this.input.keyboard?.on('keydown-M', () => audio.toggleMute());

    const total = progress.get().totalDeaths;
    ptext(this, 18, H - 14, total > 0 ? `total deaths: ${total}` : 'arrows / wasd move · space jump · r restart', { scale: 2, outline: true, color: 0xfff4e4, origin: [0, 1] });
    ptext(this, W - 18, H - 14, 'a puzzle-platformer about dying usefully', { scale: 2, outline: true, color: 0xfff4e4, origin: [1, 1] }).setAlpha(0.85);

    if (this.cleared) this.showCleared(this.cleared);
    (this.scene.get('Overlay') as Overlay).irisOpen(W / 2, 360, 700);
  }

  private makeLogo(): void {
    labLogo(this, 'labLogo');
    const logo = this.add.image(W / 2, 150, 'labLogo').setScale(5).setOrigin(0.5);
    const y0 = logo.y;
    logo.y = y0 - 260;
    this.tweens.add({ targets: logo, y: y0, duration: 700, delay: 80, ease: 'Bounce.easeOut' });
    // The sign hangs a little crooked and sways by whole pixels.
    this.tweens.add({ targets: logo, y: y0 + 5, duration: 1600, yoyo: true, repeat: -1, ease: 'Stepped', easeParams: [1], delay: 900 });
    const tag = ptext(this, W / 2, 250, 'your corpses are your tools', { scale: 3, outline: true, color: 0xfff4e4, origin: [0.5, 0.5] }).setAlpha(0);
    this.tweens.add({ targets: tag, alpha: 1, duration: 400, delay: 900, ease: 'Stepped', easeParams: [3] });
  }

  private nextTaunt(): void {
    this.sign.hide();
    this.time.delayedCall(200, () => {
      this.tauntIdx = (this.tauntIdx + 1) % TAUNTS.length;
      this.sign.setContent(TAUNTS[this.tauntIdx]!);
      this.sign.show();
      audio.play('tock', 1.1, 0.6);
    });
  }

  private go(fn: () => void): void { (this.scene.get('Overlay') as Overlay).irisClose(W / 2, 360, 450, fn); }

  private play(): void {
    const idx = Math.min(progress.get().unlocked, LEVELS.length - 1);
    this.go(() => startLevel(this, idx, true));
  }

  private openEditor(exists: boolean): void {
    if (!exists) { this.toast('The editor is warming up.'); return; }
    this.go(() => this.scene.start('Editor'));
  }

  private async paste(): Promise<void> {
    const v = await promptModal({
      title: 'Play a shared level', text: 'Paste a share code or link.', placeholder: 'https://…#lvl=… or the code itself', ok: 'Play',
      validate: (s) => (decodeLevel(s) ? null : "That code doesn't decode to a level."),
    });
    if (!v) return;
    const level = decodeLevel(v);
    if (level) this.go(() => this.scene.start('Game', { level, mode: 'shared' } satisfies GameData));
  }

  private toast(msg: string): void {
    const t = ptext(this, W / 2, 612, msg, { scale: 3, outline: true, color: KEY.z!, origin: [0.5, 0.5] });
    this.time.delayedCall(2200, () => t.destroy());
  }

  private showCleared(c: { name: string; deaths: number }): void {
    const b = new SignBubble(this, 21, 520);
    b.setPosition(W / 2, 630);
    b.setContent(`Cleared "${c.name}" with ${c.deaths} death${c.deaths === 1 ? '' : 's'}.`);
    this.time.delayedCall(700, () => b.show());
    this.time.delayedCall(5000, () => b.hide());
  }

  override update(_t: number, dms: number): void {
    const dt = Math.min(dms, 50) / 1000;
    this.t += dt;

    // Tumbling corpses pile up, age, and the oldest turns to dust.
    this.nextDrop -= dt;
    if (this.nextDrop <= 0) {
      this.nextDrop = 2.6;
      for (const tb of this.tumblers) { tb.stage = Math.min(3, tb.stage + 1) as Stage; tb.sq = 0.2; }
      for (const d of this.tumblers.filter((tb) => tb.stage > 2)) { this.pixels.bones(d.x, d.y - 2, 5); this.pixels.puff(d.x, d.y - 3, 8, 5, KEY.o!); audio.play('poof', 1, 0.4); d.img.destroy(); }
      this.tumblers = this.tumblers.filter((tb) => tb.stage <= 2);
      const slots = [220, 240, 260, 280];
      const free = slots.filter((s) => !this.tumblers.some((tb) => Math.abs(tb.x - s) < 8));
      const x = free.length ? rng.pick(free) : 250;
      const img = this.add.image(0, 0, ATLAS, corpseFrame(0, 'body')).setOrigin(0.5, 1);
      this.world.add(img);
      this.tumblers.push({ img, x, y: -20, vy: 0, vx: rng.range(-6, 6), stage: 0, landed: false, sq: 0 });
    }
    for (const tb of this.tumblers) {
      if (!tb.landed) {
        tb.vy += 380 * dt; tb.y += tb.vy * dt; tb.x += tb.vx * dt;
        if (tb.y >= GROUND) { tb.y = GROUND; tb.landed = true; tb.sq = 0.15; this.pixels.dust(tb.x, GROUND, 6); audio.play('land', 0.8, 0.35); }
      }
      tb.sq = Math.max(0, tb.sq - dt);
      tb.img.setFrame(corpseFrame(tb.stage, 'body')).setPosition(Math.round(tb.x), Math.round(tb.y)).setScale(1, tb.sq > 0.08 ? 0.75 : 1);
      tb.img.setAngle(tb.landed ? 0 : Math.round((tb.vx * this.t) / 20) * 90);
    }

    // Pip bobbing and blinking.
    this.blink -= dt;
    const bob = Math.floor(this.t * 2) % 2;
    let frame = bob ? 'pip_idle1' : 'pip_idle0';
    if (this.blink < 0) { frame = bob ? 'pip_blink1' : 'pip_blink'; if (this.blink < -0.12) this.blink = 2 + Math.random() * 2.5; }
    this.pip.setFrame(frame).setFlipX(Math.sin(this.t * 0.5) < -0.6);
    this.post.setFrame(Math.sin(this.t * 11) > 0.95 ? 'signpost1' : 'signpost0');
    this.pixels.update(dt);
  }
}
