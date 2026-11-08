// Title: bouncing logo, Pip bobbing, corpses tumbling onto a pile, a rotating taunt sign, menu.
import Phaser from 'phaser';
import { C, FONT, hex } from '../render/palette';
import { Button, Menu, SignBubble, textStyle, dpr } from '../render/ui';
import { drawBlock } from '../render/draw-tiles';
import { defaultPose, drawPip } from '../render/draw-player';
import { drawCorpse } from '../render/draw-corpse';
import { Particles } from '../render/fx';
import { rng } from '../render/rng';
import { audio } from '../audio/sfx';
import { music } from '../audio/music';
import { progress } from '../progress';
import { LEVELS } from '../levels';
import { decodeLevel } from '../editor/share';
import { startLevel, type GameData } from './Game';
import { promptModal } from './dom';
import { drawSpeaker } from './Hud';
import type { Backdrop } from './Backdrop';
import type { Overlay } from './Overlay';
import type { Stage } from '../sim/types';

const W = 1280;
const GROUND = 640;

const TAUNTS = [
  'Death is just a shortcut.', 'Bring a friend. Then bring their body.', 'Everything here is safe. Probably.',
  'The floor is lying to you.', "I'm keeping the bodies.", 'Trust the signs. Or don\'t.', 'Every level is fair. Eventually.',
];

interface Tumbler { x: number; y: number; vy: number; vx: number; rot: number; vr: number; stage: Stage; landed: boolean; sq: number; id: number }

export class Title extends Phaser.Scene {
  private g!: Phaser.GameObjects.Graphics;
  private ground!: Phaser.GameObjects.Graphics;
  private fxG!: Phaser.GameObjects.Graphics;
  private fxAdd!: Phaser.GameObjects.Graphics;
  private particles = new Particles();
  private t = 0;
  private tumblers: Tumbler[] = [];
  private nextDrop = 1.2;
  private sign!: SignBubble;
  private tauntIdx = 0;
  private blink = 0;
  private speaker!: Phaser.GameObjects.Graphics;
  private nextId = 1;
  private cleared: { name: string; deaths: number } | null = null;

  constructor() { super('Title'); }

  init(d: { cleared?: { name: string; deaths: number } }): void { this.cleared = d?.cleared ?? null; this.tumblers = []; this.t = 0; }

  create(): void {
    (this.scene.get('Backdrop') as Backdrop).setMood(0);
    music.play(0);
    history.replaceState(null, '', location.pathname + location.search);

    this.ground = this.add.graphics();
    for (let cx = -1; cx < 34; cx++) {
      drawBlock(this.ground, cx * 40, GROUND, false, true, true, true, cx);
      drawBlock(this.ground, cx * 40, GROUND + 40, true, true, true, true, cx);
    }
    this.g = this.add.graphics();
    this.fxG = this.add.graphics();
    this.fxAdd = this.add.graphics().setBlendMode(Phaser.BlendModes.ADD);

    this.makeLogo();

    // taunt sign
    const post = this.add.graphics();
    post.fillStyle(C.outline, 1); post.fillRoundedRect(165, GROUND - 46, 10, 46, 3);
    post.fillStyle(C.woodDark, 1); post.fillRoundedRect(168, GROUND - 44, 4, 44, 2);
    // Left of the menu so long taunts never run under the buttons.
    this.sign = new SignBubble(this, 20, 270);
    this.sign.setPosition(170, GROUND - 96);
    this.sign.setContent(TAUNTS[0]!);
    this.time.delayedCall(900, () => this.sign.show());
    this.time.addEvent({ delay: 3800, loop: true, callback: () => this.nextTaunt() });

    // menu
    const unlocked = progress.editorUnlocked();
    const editorScene = !!this.game.scene.keys['Editor'];
    const buttons = [
      new Button(this, W / 2, 308, progress.get().unlocked > 0 ? 'Continue' : 'Play', () => this.play(), { color: C.hazard, w: 290, h: 64, size: 30 }),
      new Button(this, W / 2, 396, 'Levels', () => this.go(() => this.scene.start('LevelSelect'))),
      new Button(this, W / 2, 472, unlocked ? 'Editor' : 'Editor  🔒', () => this.openEditor(editorScene), { locked: !unlocked, color: C.rot }),
      new Button(this, W / 2, 548, 'Paste code', () => void this.paste(), { color: C.paper }),
    ];
    buttons.forEach((b, i) => { b.setAlpha(0).setY(b.y + 30); this.tweens.add({ targets: b, alpha: 1, y: b.y - 30, duration: 420, delay: 500 + i * 80, ease: 'Back.easeOut' }); });
    (this as unknown as { menu: Menu }).menu = new Menu(this, buttons);

    if (!unlocked) this.add.text(W / 2 + 160, 472, 'beat Act 1', textStyle(15, C.ink)).setOrigin(0, 0.5).setAlpha(0.55).setResolution(dpr());

    this.speaker = this.add.graphics();
    const hit = this.add.zone(W - 44, 42, 48, 48).setInteractive({ useHandCursor: true });
    hit.on('pointerdown', () => { void audio.unlock(); audio.toggleMute(); });
    const unsub = audio.onMute(() => this.drawSpeaker());
    this.events.once('shutdown', () => unsub());
    this.drawSpeaker();
    this.input.keyboard?.on('keydown-M', () => audio.toggleMute());

    const total = progress.get().totalDeaths;
    this.add.text(24, 700, total > 0 ? `Total deaths: ${total}` : 'Arrows / WASD to move · Space to jump · R to restart', textStyle(16, C.paper)).setOrigin(0, 1).setAlpha(0.75).setResolution(dpr());
    this.add.text(W - 24, 700, 'a puzzle-platformer about dying usefully', textStyle(16, C.paper)).setOrigin(1, 1).setAlpha(0.6).setResolution(dpr());

    if (this.cleared) this.showCleared(this.cleared);
    (this.scene.get('Overlay') as Overlay).irisOpen(W / 2, 360, 700);
  }

  private makeLogo(): void {
    const word = 'DIE TRYING';
    const size = 104;
    const letters: Phaser.GameObjects.Text[] = [];
    const style = (fill: number) => ({ fontFamily: FONT, fontSize: `${size}px`, fontStyle: '700', color: hex(fill), stroke: '#2b2433', strokeThickness: 16 });
    const measure = this.add.text(0, 0, word, style(C.pip)).setVisible(false);
    const totalW = measure.width - 16 * 0.0;
    measure.destroy();
    let x = W / 2 - totalW / 2;
    [...word].forEach((ch, i) => {
      if (ch === ' ') { x += size * 0.34; return; }
      const fill = i < 3 ? C.hazard : C.pip;
      const shadow = this.add.text(x + 4, 150 + 9, ch, { ...style(C.outline), color: '#2b2433' }).setOrigin(0, 0.5).setResolution(dpr());
      const t = this.add.text(x, 150, ch, style(fill)).setOrigin(0, 0.5).setResolution(dpr());
      t.setShadow(0, 0, '#ffffff', 0);
      x += t.width - 14;
      letters.push(t);
      shadow.setAlpha(0.25);
      for (const o of [t, shadow]) {
        o.setY(o.y - 260);
        this.tweens.add({ targets: o, y: o.y + 260, duration: 700, delay: 80 + i * 55, ease: 'Bounce.easeOut' });
      }
      this.tweens.add({ targets: t, angle: { from: -4, to: 4 }, duration: 1400 + i * 40, yoyo: true, repeat: -1, ease: 'Sine.easeInOut', delay: 900 + i * 90 });
    });
    const tag = this.add.text(W / 2, 228, 'your corpses are your tools', textStyle(22, C.ink, { fontStyle: '600' })).setOrigin(0.5).setAlpha(0).setResolution(dpr());
    this.tweens.add({ targets: tag, alpha: 0.7, duration: 600, delay: 900 });
  }

  private drawSpeaker(): void { this.speaker.clear(); drawSpeaker(this.speaker, W - 44, 42, audio.muted); }

  private nextTaunt(): void {
    this.sign.hide();
    this.time.delayedCall(220, () => {
      this.tauntIdx = (this.tauntIdx + 1) % TAUNTS.length;
      this.sign.setContent(TAUNTS[this.tauntIdx]!);
      this.sign.show();
      audio.play('tock', 1.1, 0.6);
    });
  }

  private go(fn: () => void): void {
    (this.scene.get('Overlay') as Overlay).irisClose(W / 2, 360, 450, fn);
  }

  private play(): void {
    const idx = Math.min(progress.get().unlocked, LEVELS.length - 1);
    this.go(() => startLevel(this, idx, true));
  }

  private openEditor(exists: boolean): void {
    if (!exists) { this.toast('The editor is warming up. Check back soon.'); return; }
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
    const t = this.add.text(W / 2, 590, msg, textStyle(20, C.paper, { fontStyle: '600', backgroundColor: '#2b2433', padding: { x: 16, y: 8 } })).setOrigin(0.5).setResolution(dpr()).setAlpha(0);
    this.tweens.add({ targets: t, alpha: 1, y: 580, duration: 200, yoyo: true, hold: 1800, onComplete: () => t.destroy() });
  }

  private showCleared(c: { name: string; deaths: number }): void {
    const b = new SignBubble(this, 22, 420);
    b.setPosition(W / 2, 600);
    b.setContent(`Cleared "${c.name}" with ${c.deaths} death${c.deaths === 1 ? '' : 's'}.`);
    this.time.delayedCall(700, () => b.show());
    this.time.delayedCall(5000, () => b.hide());
  }

  override update(_t: number, dms: number): void {
    const dt = Math.min(dms, 50) / 1000;
    this.t += dt;
    const g = this.g;
    g.clear();

    // tumbling corpses: they pile up, age, and the oldest turns to dust (the cap, in miniature)
    this.nextDrop -= dt;
    if (this.nextDrop <= 0) {
      this.nextDrop = 2.6;
      for (const tb of this.tumblers) {
        tb.stage = Math.min(3, tb.stage + 1) as Stage;
        tb.sq = 1;
      }
      const dead = this.tumblers.filter((tb) => tb.stage > 2);
      for (const d of dead) { this.particles.bones(d.x, d.y, 5); this.particles.puff(d.x, d.y - 6, 10, 14, C.bone); }
      this.tumblers = this.tumblers.filter((tb) => tb.stage <= 2);
      const slots = [880, 960, 1040, 1120];
      const free = slots.filter((s) => !this.tumblers.some((tb) => Math.abs(tb.x - s) < 30));
      const x = free.length ? rng.pick(free) : 960;
      this.tumblers.push({ x, y: -40, vy: 0, vx: rng.range(-20, 20), rot: rng.range(-1, 1), vr: rng.range(-6, 6), stage: 0, landed: false, sq: 0, id: this.nextId++ });
    }
    for (const tb of this.tumblers) {
      if (!tb.landed) {
        tb.vy += 1500 * dt; tb.y += tb.vy * dt; tb.x += tb.vx * dt; tb.rot += tb.vr * dt;
        if (tb.y >= GROUND) { tb.y = GROUND; tb.landed = true; tb.sq = 1; tb.rot = 0; this.particles.dust(tb.x, GROUND, 8); audio.play('land', 0.8, 0.4); }
      }
      tb.sq = Math.max(0, tb.sq - dt * 3);
      const hh = [32, 18, 8][tb.stage]!;
      const sq = Math.sin(tb.sq * Math.PI) * 0.3 * tb.sq;
      g.fillStyle(C.outline, 0.16);
      g.fillEllipse(tb.x, GROUND - 1, 40, 6);
      g.save();
      g.translateCanvas(tb.x, tb.y);
      g.rotateCanvas(tb.rot);
      g.scaleCanvas(1.6 * (1 + sq), 1.6 * (1 - sq));
      drawCorpse(g, -20, -hh, 40, hh, tb.stage, 'body', this.t, tb.id * 13, tb.id % 2 === 0);
      g.restore();
    }

    // Pip bobbing, looking around
    this.blink -= dt;
    const pose = defaultPose();
    pose.sy = 1 + Math.sin(this.t * 3) * 0.04;
    pose.sx = 1 - Math.sin(this.t * 3) * 0.03;
    pose.lookX = Math.sin(this.t * 0.7) > 0 ? 1 : -0.4;
    pose.lag = Math.sin(this.t * 3) * 0.3;
    pose.blink = this.blink < 0 ? 1 : 0;
    if (this.blink < -0.12) this.blink = 2 + Math.random() * 2.5;
    g.fillStyle(C.outline, 0.18);
    g.fillEllipse(300, GROUND - 1, 54, 9);
    g.save();
    g.translateCanvas(300, GROUND);
    g.scaleCanvas(1.9, 1.9);
    drawPip(g, 0, 0, pose);
    g.restore();

    this.particles.update(dt);
    this.fxG.clear(); this.fxAdd.clear();
    this.particles.draw(this.fxG, this.fxAdd);
  }
}
