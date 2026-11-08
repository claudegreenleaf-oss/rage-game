// HUD overlay: corpse slots with stage icons, bouncing death counter, level name, mute toggle.
import Phaser from 'phaser';
import type { Game } from './Game';
import { C } from '../render/palette';
import { drawCorpseIcon } from '../render/draw-corpse';
import { textStyle, dpr } from '../render/ui';
import { audio } from '../audio/sfx';
import type { Stage } from '../sim/types';

const W = 1280;

export function drawSkull(g: Phaser.GameObjects.Graphics, x: number, y: number, r: number): void {
  g.fillStyle(C.outline, 1);
  g.fillCircle(x, y, r + 2.5);
  g.fillRoundedRect(x - r * 0.6 - 2.5, y + r * 0.3 - 2.5, r * 1.2 + 5, r * 0.8 + 5, 3);
  g.fillStyle(C.bone, 1);
  g.fillCircle(x, y, r);
  g.fillRoundedRect(x - r * 0.6, y + r * 0.3, r * 1.2, r * 0.8, 2);
  g.fillStyle(C.outline, 1);
  g.fillCircle(x - r * 0.38, y, r * 0.3);
  g.fillCircle(x + r * 0.38, y, r * 0.3);
  g.fillRect(x - 1, y + r * 0.55, 2, r * 0.5);
}

export function drawSpeaker(g: Phaser.GameObjects.Graphics, x: number, y: number, muted: boolean): void {
  g.fillStyle(C.outline, 1);
  g.fillRoundedRect(x - 22, y - 22, 44, 44, 13);
  g.fillStyle(C.paper, 1);
  g.fillRoundedRect(x - 19, y - 19, 38, 38, 11);
  g.fillStyle(C.outline, 1);
  g.fillRect(x - 10, y - 4, 6, 8);
  g.fillTriangle(x - 6, y - 4, x + 3, y - 11, x + 3, y + 11);
  g.fillTriangle(x - 6, y + 4, x + 3, y - 11, x + 3, y + 11);
  g.lineStyle(2.6, C.outline, 1);
  if (muted) { g.lineBetween(x + 6, y - 6, x + 13, y + 6); g.lineBetween(x + 13, y - 6, x + 6, y + 6); }
  else { g.beginPath(); g.arc(x + 4, y, 6, -0.9, 0.9); g.strokePath(); g.beginPath(); g.arc(x + 4, y, 11, -0.9, 0.9); g.strokePath(); }
}

export class Hud extends Phaser.Scene {
  private game_!: Game;
  private panel!: Phaser.GameObjects.Graphics;
  private icons!: Phaser.GameObjects.Graphics;
  private slotPop = [0, 0, 0];
  private lastSlots: string[] = ['', '', ''];
  private deathText!: Phaser.GameObjects.Text;
  private deathGroup!: Phaser.GameObjects.Container;
  private lastDeaths = 0;
  private speaker!: Phaser.GameObjects.Graphics;
  private t = 0;
  private unsub: (() => void) | null = null;

  constructor() { super('Hud'); }

  init(data: { game: Game }): void { this.game_ = data.game; this.lastDeaths = 0; this.lastSlots = ['', '', '']; }

  create(): void {
    const g = this.game_;
    this.panel = this.add.graphics();
    this.icons = this.add.graphics();
    // death counter
    const skull = this.add.graphics();
    drawSkull(skull, 0, -2, 11);
    this.deathText = this.add.text(20, 0, '0', textStyle(28, C.ink, { fontStyle: '700' })).setOrigin(0, 0.5).setResolution(dpr());
    this.deathGroup = this.add.container(232, 42, [skull, this.deathText]);

    // level name
    const lvl = g.data_.level;
    const title = this.add.text(W / 2, 54, lvl.name, textStyle(40, C.ink, { fontStyle: '700', stroke: '#fbf3e4', strokeThickness: 10 })).setOrigin(0.5).setResolution(dpr());
    const sub = this.add.text(W / 2, 92, g.data_.mode === 'playtest' ? 'PLAYTEST · Esc to edit' : g.data_.mode === 'shared' ? 'SHARED LEVEL' : g.data_.mode === 'credits' ? '' : `Level ${lvl.id.replace('L', '')}`, textStyle(18, C.ink, { stroke: '#fbf3e4', strokeThickness: 6 })).setOrigin(0.5).setResolution(dpr());
    title.setScale(0.6).setAlpha(0);
    this.tweens.add({ targets: title, scale: 1, alpha: 1, duration: 420, ease: 'Back.easeOut', delay: 250 });
    this.tweens.add({ targets: sub, alpha: { from: 0, to: 1 }, duration: 300, delay: 450 });
    this.tweens.add({ targets: [title, sub], alpha: 0, y: '-=14', duration: 600, delay: 2300, ease: 'Sine.easeIn' });

    // controls hint
    const hint = this.add.text(W - 24, 700, '←→ move · Space jump · ↓ drop · R restart · Esc pause', textStyle(15, C.ink)).setOrigin(1, 1).setAlpha(0.6).setResolution(dpr());
    this.tweens.add({ targets: hint, alpha: 0, duration: 800, delay: 6000 });
    if (g.data_.mode === 'playtest') {
      const tag = this.add.text(W - 92, 42, 'PLAYTEST', textStyle(18, C.paper, { fontStyle: '700', backgroundColor: '#2b2433', padding: { x: 10, y: 4 } })).setOrigin(1, 0.5).setResolution(dpr());
      void tag;
    }

    this.speaker = this.add.graphics();
    const hit = this.add.zone(W - 44, 42, 48, 48).setInteractive({ useHandCursor: true });
    hit.on('pointerdown', () => { void audio.unlock(); audio.toggleMute(); });
    this.unsub = audio.onMute(() => this.drawSpeaker());
    this.events.once('shutdown', () => this.unsub?.());
    this.drawSpeaker();
  }

  private drawSpeaker(): void {
    this.speaker.clear();
    drawSpeaker(this.speaker, W - 44, 42, audio.muted);
  }

  override update(_t: number, dms: number): void {
    const dt = dms / 1000;
    this.t += dt;
    const w = this.game_.world;
    if (!w) return;
    // panel
    const p = this.panel;
    p.clear();
    p.fillStyle(0x000000, 0.12);
    p.fillRoundedRect(20, 20, 300, 56, 20);
    p.fillStyle(C.outline, 1);
    p.fillRoundedRect(14, 12, 300, 58, 20);
    p.fillStyle(C.paper, 1);
    p.fillRoundedRect(17, 15, 294, 52, 17);
    const corpses = [...w.corpses].sort((a, b) => a.born - b.born);
    const ic = this.icons;
    ic.clear();
    for (let i = 0; i < 3; i++) {
      const c = corpses[i];
      const key = c ? `${c.id}:${c.stage}` : '';
      if (key !== this.lastSlots[i]) { this.slotPop[i] = 1; this.lastSlots[i] = key; }
      this.slotPop[i] = Math.max(0, this.slotPop[i]! - dt * 3);
      const x = 52 + i * 62, y = 41;
      const pop = this.slotPop[i]!;
      const s = 1 + Math.sin(pop * Math.PI) * 0.25;
      p.fillStyle(c ? 0xf3e2cc : 0xeadccb, 1);
      p.fillRoundedRect(x - 26 * s, y - 20 * s, 52 * s, 40 * s, 11);
      if (!c) {
        p.lineStyle(2, C.outline, 0.18);
        p.strokeRoundedRect(x - 22, y - 16, 44, 32, 9);
        continue;
      }
      ic.save();
      ic.translateCanvas(x, y + 2);
      ic.scaleCanvas(s, s);
      drawCorpseIcon(ic, 0, 0, c.stage as Stage, this.t);
      ic.restore();
    }
    // separator
    p.fillStyle(C.outline, 0.15);
    p.fillRect(212, 24, 2, 34);

    if (w.deathCount !== this.lastDeaths) {
      this.lastDeaths = w.deathCount;
      this.deathText.setText(String(w.deathCount));
      this.tweens.killTweensOf(this.deathGroup);
      this.deathGroup.setScale(1.6).setAngle(-12);
      this.tweens.add({ targets: this.deathGroup, scale: 1, angle: 0, duration: 520, ease: 'Elastic.easeOut', easeParams: [1.1, 0.4] });
    }
  }
}
