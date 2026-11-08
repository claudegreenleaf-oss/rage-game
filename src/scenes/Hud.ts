// HUD: corpse slots with stage icons, a bouncing death counter, the level name, an R-restart hint
// (which pulses when the player has probably softlocked), one-off tips, and the mute toggle.
import Phaser from 'phaser';
import type { Game } from './Game';
import { ATLAS } from '../render/pixel/sprites';
import { ptext } from '../render/pixel/font';
import { panelTex } from '../render/pixel/uitex';
import { KEY } from '../render/pixel/pal';
import { UI } from '../render/ui';
import { audio } from '../audio/sfx';

const W = 1280, H = 720;

export class Hud extends Phaser.Scene {
  private game_!: Game;
  private slots: Array<{ bg: Phaser.GameObjects.Image; icon: Phaser.GameObjects.Image; key: string; pop: number }> = [];
  private deathText!: Phaser.GameObjects.BitmapText;
  private skull!: Phaser.GameObjects.Image;
  private lastDeaths = 0;
  private speaker!: Phaser.GameObjects.Image;
  private restart!: Phaser.GameObjects.Container;
  private restartBig!: Phaser.GameObjects.Container;
  private tip: Phaser.GameObjects.Container | null = null;
  private t = 0;
  private unsub: (() => void) | null = null;

  constructor() { super('Hud'); }

  init(data: { game: Game }): void { this.game_ = data.game; this.lastDeaths = 0; this.slots = []; this.tip = null; }

  create(): void {
    const g = this.game_;
    // Corpse slots + death counter panel.
    this.add.image(12, 10, panelTex(this, 92, 22, 'paper')).setOrigin(0).setScale(UI);
    for (let i = 0; i < 3; i++) {
      const x = 12 + (4 + i * 20) * UI, y = 10 + 3 * UI;
      const bg = this.add.image(x, y, panelTex(this, 18, 15, 'slotEmpty')).setOrigin(0).setScale(UI);
      const icon = this.add.image(x + 9 * UI, y + 8 * UI, ATLAS, 'icon0').setScale(UI).setVisible(false);
      this.slots.push({ bg, icon, key: '', pop: 0 });
    }
    this.add.image(12 + 66 * UI, 10 + 4 * UI, ATLAS, 'p1').setDisplaySize(UI, 14 * UI).setTint(0xcdbba6).setOrigin(0);
    this.skull = this.add.image(12 + 73 * UI, 10 + 11 * UI, ATLAS, 'skull').setScale(UI);
    this.deathText = ptext(this, 12 + 81 * UI, 10 + 11 * UI, '0', { scale: UI, origin: [0, 0.5] });

    // Level name banner.
    const lvl = g.data_.level;
    const sub = g.data_.mode === 'playtest' ? 'PLAYTEST · Esc to edit' : g.data_.mode === 'shared' ? 'SHARED LEVEL' : g.data_.mode === 'credits' ? '' : `LEVEL ${lvl.id.replace('L', '')}`;
    const title = ptext(this, W / 2, 46, lvl.name, { scale: 5, bold: true, color: 0xfff4e4, origin: [0.5, 0.5] });
    const subT = ptext(this, W / 2, 92, sub, { scale: 3, outline: true, color: KEY.z!, origin: [0.5, 0.5] });
    title.setAlpha(0); subT.setAlpha(0);
    this.tweens.add({ targets: title, alpha: 1, y: { from: 30, to: 46 }, duration: 380, ease: 'Back.easeOut', delay: 250 });
    this.tweens.add({ targets: subT, alpha: 1, duration: 300, delay: 450 });
    this.tweens.add({ targets: [title, subT], alpha: 0, duration: 500, delay: 2300, ease: 'Stepped', easeParams: [4] });

    // Always-visible restart hint (bottom-left) and the big softlock prompt.
    this.restart = this.add.container(16, H - 16, [
      this.add.image(0, 0, ATLAS, 'keyR').setOrigin(0, 1).setScale(UI),
      ptext(this, 13 * UI, -5 * UI, 'restart', { scale: 2, color: 0xfff4e4, outline: true, origin: [0, 0.5] }),
    ]).setAlpha(0.8);
    const bigW = 118;
    this.restartBig = this.add.container(W / 2, H - 70, [
      this.add.image(0, 0, panelTex(this, bigW, 17, 'dark')).setScale(UI),
      this.add.image(-bigW * UI / 2 + 8 * UI, -UI, ATLAS, 'keyR').setScale(UI),
      ptext(this, -bigW * UI / 2 + 16 * UI, -UI, 'restart (clears bodies)', { scale: 3, color: 0xfff4e4, origin: [0, 0.5] }),
    ]).setVisible(false);

    // Controls hint, fades after a few seconds.
    const hint = ptext(this, W - 16, H - 16, '←→ move · space jump · ↓ drop / drag · esc pause', { scale: 2, outline: true, color: 0xfff4e4, origin: [1, 1] });
    this.tweens.add({ targets: hint, alpha: 0, duration: 600, delay: 6000, ease: 'Stepped', easeParams: [4] });
    if (g.data_.mode === 'playtest') this.add.image(W - 88, 34, panelTex(this, 40, 11, 'dark')).setScale(UI).setOrigin(1, 0.5);
    if (g.data_.mode === 'playtest') ptext(this, W - 88 - 20 * UI, 34 - UI, 'PLAYTEST', { scale: 2, color: KEY.z!, origin: [0.5, 0.5] });

    this.speaker = this.add.image(W - 40, 34, ATLAS, 'speaker').setScale(UI).setInteractive({ useHandCursor: true });
    this.speaker.on('pointerdown', () => { void audio.unlock(); audio.toggleMute(); });
    this.unsub = audio.onMute(() => this.drawSpeaker());
    this.events.once('shutdown', () => this.unsub?.());
    this.drawSpeaker();
  }

  private drawSpeaker(): void { this.speaker.setFrame(audio.muted ? 'speakerOff' : 'speaker'); }

  private showTip(text: string): void {
    this.tip?.destroy();
    const w = Math.round(text.length * 5.2) + 14;
    const c = this.add.container(W / 2, 150, [
      this.add.image(0, 0, panelTex(this, w, 16, 'tape', true)).setScale(UI),
      ptext(this, 0, -2 * UI, text, { scale: 3, origin: [0.5, 0.5] }),
    ]).setScale(0);
    this.tweens.add({ targets: c, scale: 1, duration: 280, ease: 'Back.easeOut' });
    this.tweens.add({ targets: c, scale: 0, duration: 160, delay: 4200, ease: 'Quad.easeIn', onComplete: () => c.destroy() });
    audio.play('tock');
    this.tip = c;
  }

  override update(_t: number, dms: number): void {
    const dt = dms / 1000;
    this.t += dt;
    const w = this.game_.world;
    if (!w) return;
    const corpses = [...w.corpses].sort((a, b) => a.born - b.born);
    for (let i = 0; i < 3; i++) {
      const c = corpses[i];
      const s = this.slots[i]!;
      const key = c ? `${c.id}:${c.stage}` : '';
      if (key !== s.key) {
        s.key = key; s.pop = 0.25;
        s.bg.setTexture(panelTex(this, 18, 15, c ? 'slot' : 'slotEmpty'));
        s.icon.setVisible(!!c);
        if (c) s.icon.setFrame(`icon${c.stage}`);
      }
      s.pop = Math.max(0, s.pop - dt);
      s.icon.setY(10 + 3 * UI + 8 * UI - (s.pop > 0.12 ? UI : 0));
    }
    if (w.deathCount !== this.lastDeaths) {
      this.lastDeaths = w.deathCount;
      this.deathText.setText(String(w.deathCount));
      this.tweens.killTweensOf([this.deathText, this.skull]);
      this.deathText.setScale(1.67); this.skull.setScale(UI + 1).setAngle(-15);
      this.tweens.add({ targets: this.deathText, scale: 1, duration: 360, ease: 'Bounce.easeOut' });
      this.tweens.add({ targets: this.skull, scale: UI, angle: 0, duration: 360, ease: 'Bounce.easeOut' });
    }
    const stuck = !!(w as unknown as { suggestRestart?: boolean }).suggestRestart;
    this.restartBig.setVisible(stuck);
    if (stuck) this.restartBig.y = H - 70 - (Math.floor(this.t * 3) % 2) * UI;
    this.restart.setAlpha(stuck ? 1 : 0.75);
    const v = this.game_.view;
    if (v?.hint) { this.showTip(v.hint); v.hint = null; }
  }
}
