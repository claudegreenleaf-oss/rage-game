// HUD: corpse slots with stage icons, a bouncing death counter, relic counters (world), the room or
// level name, a small R-restart hint, and ONE caption bar at the bottom for every message (signs,
// lore notes, taunts, tips, the softlock nudge), so nothing ever covers Pip or the puzzle.
import Phaser from 'phaser';
import type { Game } from './Game';
import { ATLAS } from '../render/pixel/sprites';
import { ptext } from '../render/pixel/font';
import { PHOSPHOR, panelTex, type PanelStyle } from '../render/pixel/uitex';
import { KEY } from '../render/pixel/pal';
import { UI } from '../render/ui';
import { audio } from '../audio/sfx';
import { progress } from '../progress';
import { canWallJump } from '../sim/world';

const W = 1280, H = 720;
const TIPS: Record<string, string> = {
  controls: '← → move · space jump, hold for higher · ↓ drop',
  drag: 'Hold ↓ and walk away from a body to drag it.',
  walljump: 'Green grip walls: slide down one, then jump to kick off. Only in rooms showing the wall icon.',
  map: 'M opens the map. Pick a visited room to travel there.',
  vine: 'Jump into a vine to grab it. Jump again to let go.',
};

interface Msg { key: string; text: string; kind: 'lore' | 'stuck' | 'sign' | 'taunt' | 'tip' }

export class Hud extends Phaser.Scene {
  private game_!: Game;
  private slots: Array<{ bg: Phaser.GameObjects.Image; icon: Phaser.GameObjects.Image; key: string; pop: number }> = [];
  private deathText!: Phaser.GameObjects.BitmapText;
  private skull!: Phaser.GameObjects.Image;
  private lastDeaths = -1;
  private speaker!: Phaser.GameObjects.Image;
  private restart!: Phaser.GameObjects.Container;
  private relicPanel: Phaser.GameObjects.Container | null = null;
  private noteText: Phaser.GameObjects.BitmapText | null = null;
  private jarText: Phaser.GameObjects.BitmapText | null = null;
  private caption!: Phaser.GameObjects.Container;
  private capPanel!: Phaser.GameObjects.Image;
  private capText!: Phaser.GameObjects.BitmapText;
  private capIcon!: Phaser.GameObjects.Image;
  private shown: Msg | null = null;
  private tip: { key: string; text: string; t: number } | null = null;
  private lastRoomRev = -1;
  private wallIcon!: Phaser.GameObjects.Container;
  private banner: Phaser.GameObjects.BitmapText[] = [];
  private t = 0;
  private unsub: (() => void) | null = null;

  constructor() { super('Hud'); }

  init(data: { game: Game }): void { this.game_ = data.game; this.lastDeaths = -1; this.slots = []; this.tip = null; this.shown = null; this.lastRoomRev = -1; this.relicPanel = null; }

  create(): void {
    const g = this.game_;
    this.add.image(12, 10, panelTex(this, 92, 22, 'paper')).setOrigin(0).setScale(UI);
    for (let i = 0; i < 3; i++) {
      const x = 12 + (4 + i * 20) * UI, y = 10 + 3 * UI;
      const bg = this.add.image(x, y, panelTex(this, 18, 15, 'slotEmpty')).setOrigin(0).setScale(UI);
      const icon = this.add.image(x + 9 * UI, y + 8 * UI, ATLAS, 'icon0').setScale(UI).setVisible(false);
      this.slots.push({ bg, icon, key: '', pop: 0 });
    }
    this.add.image(12 + 66 * UI, 10 + 4 * UI, ATLAS, 'p1').setDisplaySize(UI, 14 * UI).setTint(0xb7c0cb).setOrigin(0);
    this.skull = this.add.image(12 + 73 * UI, 10 + 11 * UI, ATLAS, 'skull').setScale(UI);
    this.deathText = ptext(this, 12 + 81 * UI, 10 + 11 * UI, '0', { scale: UI, origin: [0, 0.5] });

    if (g.campaign) {
      this.relicPanel = this.add.container(12, 10 + 26 * UI, [
        this.add.image(0, 0, panelTex(this, 60, 13, 'paper')).setOrigin(0).setScale(UI),
        this.add.image(6 * UI, 6 * UI, ATLAS, 'iconNote').setScale(UI),
        this.add.image(32 * UI, 6 * UI, ATLAS, 'iconJar').setScale(UI),
      ]);
      this.noteText = ptext(this, 12 + 12 * UI, 10 + 32 * UI, '0', { scale: 2, origin: [0, 0.5] });
      this.jarText = ptext(this, 12 + 38 * UI, 10 + 32 * UI, '0', { scale: 2, origin: [0, 0.5] });
    }

    // Wall-jump badge: shown in rooms where walls can be gripped.
    this.wallIcon = this.add.container(12 + 95 * UI, 10, [
      this.add.image(0, 0, panelTex(this, 20, 22, 'paper')).setOrigin(0).setScale(UI),
      this.add.image(10 * UI, 11 * UI, ATLAS, 'iconWall').setScale(UI),
    ]).setVisible(false);
    this.wallIcon.setInteractive(new Phaser.Geom.Rectangle(0, 0, 20 * UI, 22 * UI), Phaser.Geom.Rectangle.Contains);

    // Small, always-visible restart hint (bottom-left).
    this.restart = this.add.container(16, H - 16, [
      this.add.image(0, 0, ATLAS, 'keyR').setOrigin(0, 1).setScale(2),
      ptext(this, 13 * 2, -5 * 2, 'restart', { scale: 2, color: 0xfff4e4, outline: true, origin: [0, 0.5] }),
    ]).setAlpha(0.6);

    // The caption bar: one message at a time, bottom-centre.
    this.capPanel = this.add.image(0, 0, panelTex(this, 40, 14, 'crt')).setScale(UI).setOrigin(0.5, 1);
    this.capIcon = this.add.image(0, 0, ATLAS, 'iconNote').setScale(UI).setVisible(false);
    this.capText = this.add.bitmapText(0, 0, 'pf', '', 3).setOrigin(0.5, 0.5).setCenterAlign().setMaxWidth(820);
    this.caption = this.add.container(W / 2, H - 14, [this.capPanel, this.capIcon, this.capText]).setAlpha(0);

    if (g.data_.mode === 'playtest') {
      this.add.image(W - 88, 34, panelTex(this, 40, 11, 'dark')).setScale(UI).setOrigin(1, 0.5);
      ptext(this, W - 88 - 20 * UI, 34 - UI, 'PLAYTEST', { scale: 2, color: KEY.z!, origin: [0.5, 0.5] });
    }
    this.speaker = this.add.image(W - 40, 34, ATLAS, 'speaker').setScale(UI).setInteractive({ useHandCursor: true });
    this.speaker.on('pointerdown', () => { void audio.unlock(); audio.toggleMute(); });
    this.unsub = audio.onMute(() => this.drawSpeaker());
    this.events.once('shutdown', () => this.unsub?.());
    this.drawSpeaker();
    if (!g.campaign) this.showBanner(g.data_.level.name, g.data_.mode === 'playtest' ? 'PLAYTEST · Esc to edit' : g.data_.mode === 'shared' ? 'SHARED LEVEL' : g.data_.mode === 'credits' ? '' : `CHAMBER ${g.data_.level.id.replace('L', '')}`);
    this.requestTip('controls');
  }

  private drawSpeaker(): void { this.speaker.setFrame(audio.muted ? 'speakerOff' : 'speaker'); }

  /** Show a tip once per save (through the caption bar). */
  requestTip(id: string): void {
    if (!TIPS[id] || this.tip) return;
    if (!progress.tipOnce(id)) return;
    this.tip = { key: `tip:${id}`, text: TIPS[id]!, t: 5 };
  }

  private showBanner(name: string, sub: string): void {
    for (const b of this.banner) b.destroy();
    const title = ptext(this, W / 2, 40, name, { scale: 4, bold: true, color: 0xfff4e4, origin: [0.5, 0.5] }).setAlpha(0);
    const subT = ptext(this, W / 2, 78, sub, { scale: 2, outline: true, color: KEY.z!, origin: [0.5, 0.5] }).setAlpha(0);
    this.banner = [title, subT];
    this.tweens.add({ targets: title, alpha: 1, y: { from: 28, to: 40 }, duration: 320, ease: 'Back.easeOut', delay: 150 });
    this.tweens.add({ targets: subT, alpha: 1, duration: 260, delay: 300 });
    this.tweens.add({ targets: [title, subT], alpha: 0, duration: 400, delay: 1900, ease: 'Stepped', easeParams: [4] });
  }

  private setCaption(m: Msg | null): void {
    if (m?.key === this.shown?.key) return;
    this.shown = m;
    this.tweens.killTweensOf(this.caption);
    if (!m) { this.tweens.add({ targets: this.caption, alpha: 0, duration: 160, ease: 'Stepped', easeParams: [3] }); return; }
    const style: PanelStyle = m.kind === 'lore' ? 'paper' : m.kind === 'stuck' || m.kind === 'tip' ? 'tape' : 'crt';
    this.capText.setText(m.text).setTint(style === 'crt' ? PHOSPHOR : KEY.k!);
    const icon = m.kind === 'lore';
    const uw = Math.round(this.capText.width / UI) + (icon ? 26 : 14), uh = Math.round(this.capText.height / UI) + (style === 'tape' ? 10 : 8);
    this.capPanel.setTexture(panelTex(this, uw | 1, uh, style));
    const midY = -Math.round((uh * UI) / 2) - UI;
    this.capText.setPosition(icon ? 6 * UI : 0, midY + (style === 'tape' ? 2 * UI : 0));
    this.capIcon.setVisible(icon).setPosition(-Math.round((uw * UI) / 2) + 9 * UI, midY);
    this.caption.setAlpha(0).setY(H - 8);
    this.tweens.add({ targets: this.caption, alpha: 1, y: H - 14, duration: 200, ease: 'Back.easeOut' });
    if (m.kind === 'sign' || m.kind === 'lore') audio.play('tock', 1, 0.5);
  }

  override update(_t: number, dms: number): void {
    const dt = dms / 1000;
    this.t += dt;
    const g = this.game_;
    const w = g.world;
    if (!w) return;
    // Room changes (world mode): a short name banner, and the map tip.
    if (g.campaign && g.campaign.roomRev !== this.lastRoomRev) {
      this.lastRoomRev = g.campaign.roomRev;
      this.showBanner(w.level.name, w.level.kind === 'chamber' ? 'CHAMBER' : '');
      this.lastDeaths = -1;
    }
    const wj = canWallJump(w.level);
    // Tips queue up: one at a time, each once per save.
    if (!this.tip && this.t > 1) {
      if (wj) this.requestTip('walljump');
      if (!this.tip && g.campaign && g.campaign.visited.size > 1) this.requestTip('map');
    }
    if (wj !== this.wallIcon.visible) {
      this.wallIcon.setVisible(wj);
      if (wj) { this.wallIcon.setScale(1.3); this.tweens.add({ targets: this.wallIcon, scale: 1, duration: 300, ease: 'Back.easeOut' }); }
    }
    const corpses = [...w.corpses].filter((c) => c.kind !== 'crate').sort((a, b) => a.born - b.born);
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
    const deaths = g.campaign ? g.campaign.totalDeaths : w.deathCount;
    if (deaths !== this.lastDeaths) {
      const bump = this.lastDeaths >= 0;
      this.lastDeaths = deaths;
      this.deathText.setText(String(deaths));
      if (bump) {
        this.tweens.killTweensOf([this.deathText, this.skull]);
        this.deathText.setScale(1.67); this.skull.setScale(UI + 1).setAngle(-15);
        this.tweens.add({ targets: this.deathText, scale: 1, duration: 360, ease: 'Bounce.easeOut' });
        this.tweens.add({ targets: this.skull, scale: UI, angle: 0, duration: 360, ease: 'Bounce.easeOut' });
      }
    }
    if (g.campaign && this.noteText && this.jarText) {
      const c = g.relicCounts();
      this.noteText.setText(`${c.notes}/${c.notesTotal}`);
      this.jarText.setText(`${c.jars}/${c.jarsTotal}`);
    }
    const v = g.view;
    if (v?.collected) {
      const target = v.collected.kind === 'note' ? this.noteText : this.jarText;
      if (this.relicPanel) { this.tweens.killTweensOf(this.relicPanel); this.relicPanel.y = 10 + 24 * UI; this.tweens.add({ targets: this.relicPanel, y: 10 + 26 * UI, duration: 260, ease: 'Bounce.easeOut' }); }
      if (target) { this.tweens.killTweensOf(target); target.setScale(1.5); this.tweens.add({ targets: target, scale: 1, duration: 300, ease: 'Bounce.easeOut' }); }
      v.collected = null;
    }
    if (v?.hint) { this.requestTip(v.hint); v.hint = null; }
    for (const e of w.fx) {
      if (e.t === 'grab') this.requestTip('vine');
    }
    if (this.tip) { this.tip.t -= dt; if (this.tip.t <= 0) this.tip = null; }

    // One message at a time: lore > stuck > tip > sign > taunt.
    const vm = v?.message() ?? null;
    let m: Msg | null = null;
    if (vm && (vm.kind === 'lore' || vm.kind === 'stuck')) m = vm;
    else if (this.tip) m = { key: this.tip.key, text: this.tip.text, kind: 'tip' };
    else if (vm) m = vm;
    this.setCaption(m);
    this.restart.setAlpha(w.suggestRestart ? 0.6 + (Math.floor(this.t * 3) % 2) * 0.4 : 0.6);
  }
}
