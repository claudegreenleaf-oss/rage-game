// HUD: corpse slots with stage icons, a bouncing death counter, relic counters (world), the room or
// level name, a small R-restart hint, a reading panel for notes, tips and taunts that docks to the roomiest
// corner or band (never over Pip or hazards), and small sign bubbles beside their signs, so nothing covers the puzzle.
import Phaser from 'phaser';
import type { Game } from './Game';
import { ATLAS } from '../render/pixel/sprites';
import { clean, ptext, textWidth } from '../render/pixel/font';
import { PHOSPHOR, panelTex, type PanelStyle } from '../render/pixel/uitex';
import { KEY } from '../render/pixel/pal';
import { UI } from '../render/ui';
import { audio } from '../audio/sfx';
import { progress } from '../progress';
import { canWallJump } from '../sim/world';
import { coverMap, hits, type Cover, type Rect } from './placement';

const W = 1280, H = 720;
/** Top edge of the caption when Pip is low on screen: just under the HUD pills. */
const CAP_TOP = 100;
/** The reading panel is narrow (screen px) and sits in a corner or band, never mid-playfield. */
const CAP_W = 460;
const BUBBLE_W = 260;
type Slot = 'bl' | 'br' | 'tc' | 'bc';
const TIPS: Record<string, string> = {
  controls: '← → move · space jump, hold for higher · ↓ drop',
  drag: 'Hold ↓ and walk away from a body to drag it.',
  walljump: 'Green grip walls: slide down one, then jump to kick off. Only in rooms showing the wall icon.',
  map: 'M opens the map. Pick a visited room to travel there.',
  vine: 'Jump into a vine to grab it. Jump again to let go.',
};

interface Bub {
  box: Phaser.GameObjects.Container; panel: Phaser.GameObjects.Image; text: Phaser.GameObjects.BitmapText;
  side: 'u' | 'd' | 'l' | 'r'; k: number; a: number; mode: 'mark' | 'full' | ''; shown: string; w: number; h: number;
}

interface Msg { key: string; text: string; kind: 'lore' | 'stuck' | 'sign' | 'taunt' | 'tip' | 'event' }

export class Hud extends Phaser.Scene {
  private game_!: Game;
  private slots: Array<{ bg: Phaser.GameObjects.Image; icon: Phaser.GameObjects.Image; key: string; pop: number }> = [];
  private deathPanel!: Phaser.GameObjects.Image;
  private relicBg: Phaser.GameObjects.Image | null = null;
  private relicIcons: Phaser.GameObjects.Image[] = [];
  private relicKey = '';
  private capK = { v: 1 };
  private capH = 0;
  private slot: Slot = 'bc';
  private capW = 0;
  private bubbles = new Map<string, Bub>();
  private cover!: Cover;
  private capFade = 1;
  private bubbleWorld: unknown = null;
  private bannerK = { a: 0, b: 0 };
  private vars: Array<{ name: string; label: string; text: Phaser.GameObjects.BitmapText; bg: Phaser.GameObjects.Image; last: number }> = [];
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

  init(data: { game: Game }): void { this.game_ = data.game; this.lastDeaths = -1; this.slots = []; this.tip = null; this.shown = null; this.lastRoomRev = -1; this.relicPanel = null; this.bubbles = new Map(); this.bubbleWorld = null; this.slot = 'bc'; this.banner = []; }

  create(): void {
    const g = this.game_;
    this.deathPanel = this.add.image(12, 10, panelTex(this, 92, 22, 'paper')).setOrigin(0).setScale(UI);
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
      this.relicBg = this.add.image(0, 0, panelTex(this, 60, 13, 'paper')).setOrigin(0).setScale(UI);
      this.relicIcons = [this.add.image(0, 0, ATLAS, 'iconNote').setScale(UI), this.add.image(0, 0, ATLAS, 'iconJar').setScale(UI)];
      this.relicPanel = this.add.container(12, 10 + 26 * UI, [this.relicBg, ...this.relicIcons]);
      this.noteText = ptext(this, 12 + 12 * UI, 10 + 32 * UI, '0/0', { scale: 2, origin: [0, 0.5] });
      this.jarText = ptext(this, 12 + 38 * UI, 10 + 32 * UI, '0/0', { scale: 2, origin: [0, 0.5] });
      this.layoutRelics('0/0', '0/0');
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
    this.capText = this.add.bitmapText(0, 0, 'pf', '', 2).setOrigin(0.5, 0.5).setCenterAlign().setMaxWidth(CAP_W - 40);
    this.caption = this.add.container(W / 2, H - 14, [this.capPanel, this.capIcon, this.capText]).setAlpha(0);

    if (g.data_.mode === 'playtest') {
      const pu = Math.ceil((textWidth('PLAYTEST') * 2 + 16) / UI);
      this.add.image(W - 88, 34, panelTex(this, pu, 11, 'dark')).setScale(UI).setOrigin(1, 0.5);
      ptext(this, W - 88 - (pu * UI) / 2, 34 - 1, 'PLAYTEST', { scale: 2, color: KEY.z!, origin: [0.5, 0.5] });
    }
    this.speaker = this.add.image(W - 40, 34, ATLAS, 'speaker').setScale(UI).setInteractive({ useHandCursor: true });
    this.speaker.on('pointerdown', () => { void audio.unlock(); audio.toggleMute(); });
    this.unsub = audio.onMute(() => this.drawSpeaker());
    this.events.once('shutdown', () => this.unsub?.());
    this.drawSpeaker();
    if (!g.campaign) this.showBanner(g.data_.level.name, g.data_.mode === 'playtest' ? 'PLAYTEST · Esc to edit' : g.data_.mode === 'shared' ? 'SHARED LEVEL' : g.data_.mode === 'credits' ? '' : `CHAMBER ${g.data_.level.id.replace('L', '')}`);
    this.layoutDeath('0');
    this.buildVars();
    this.requestTip('controls');
  }

  /** Size the death pill from the measured digits (3-digit counts stay inside), and keep the wall badge beside it. */
  private layoutDeath(str: string): void {
    const pu = Math.max(92, 81 + textWidth(str) + 8);
    this.deathPanel.setTexture(panelTex(this, pu, 22, 'paper'));
    this.wallIcon.x = 12 + (pu + 3) * UI;
  }

  /** Lay the note and jar counters out left to right inside a pill sized to the measured text. */
  private layoutRelics(notes: string, jars: string): void {
    if (!this.relicBg || !this.noteText || !this.jarText) return;
    const key = notes + '|' + jars;
    if (key === this.relicKey) return;
    this.relicKey = key;
    this.noteText.setText(notes); this.jarText.setText(jars);
    const pad = 4 * UI, iw = 7 * UI, gap = 3 * UI, mid = 6.5 * UI;
    let x = pad;
    this.relicIcons[0]!.setPosition(x + iw / 2, mid);
    x += iw + gap;
    this.noteText.setX(12 + x);
    x += this.noteText.width + 5 * UI;
    this.relicIcons[1]!.setPosition(x + iw / 2, mid);
    x += iw + gap;
    this.jarText.setX(12 + x);
    x += this.jarText.width + pad;
    this.relicBg.setTexture(panelTex(this, Math.ceil(x / UI), 13, 'paper'));
  }

  /** Level variables with a `show` label: small counters under the speaker, top right. */
  private buildVars(): void {
    for (const v of this.vars) { v.text.destroy(); v.bg.destroy(); }
    this.vars = [];
    const w = this.game_.world;
    const shown = (w?.level.vars ?? []).filter((v) => v.show);
    let y = 70;
    for (const v of shown) {
      const bg = this.add.image(W - 16, y, panelTex(this, 20, 10, 'dark')).setOrigin(1, 0).setScale(UI);
      const text = ptext(this, 0, y, '', { scale: 2, color: 0xfff4e4, origin: [0.5, 0.5] });
      this.vars.push({ name: v.name, label: v.show!, text, bg, last: NaN });
      y += 40;
    }
  }

  private updateVars(): void {
    const view = this.game_.view;
    if (!view) return;
    for (const v of this.vars) {
      const val = view.varValue(v.name);
      if (val === v.last) continue;
      const bump = !Number.isNaN(v.last);
      v.last = val;
      const str = `${v.label} ${Number.isInteger(val) ? val : Math.round(val * 100) / 100}`;
      v.text.setText(clean(str));
      const pu = Math.ceil((textWidth(str) * 2 + 16) / UI);
      v.bg.setTexture(panelTex(this, pu, 10, 'dark'));
      const left = W - 16 - pu * UI;
      v.text.setPosition(Math.round(left + (pu * UI) / 2), Math.round(v.bg.y + (10 * UI) / 2));
      if (bump) { this.tweens.killTweensOf(v.text); v.text.setScale(1.35); this.tweens.add({ targets: v.text, scale: 1, duration: 260, ease: 'Bounce.easeOut' }); }
    }
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
    this.tweens.killTweensOf(this.bannerK);
    const tscale = textWidth(name) * 4 > W - 200 ? 3 : 4;
    const title = ptext(this, W / 2, 40, name, { scale: tscale, bold: true, color: 0xfff4e4, origin: [0.5, 0.5], align: 'center', wrap: W - 160 }).setAlpha(0);
    const subT = ptext(this, W / 2, 40 + Math.max(38, Math.ceil(title.height / 2) + 16), sub, { scale: 2, outline: true, color: KEY.z!, origin: [0.5, 0.5], align: 'center', wrap: W - 160 }).setAlpha(0);
    this.banner = [title, subT];
    // Short: in, a beat, out. Alpha is applied per frame so it can also yield to Pip.
    this.bannerK.a = 0; this.bannerK.b = 0;
    this.tweens.add({ targets: this.bannerK, a: 1, duration: 260, delay: 120 });
    this.tweens.add({ targets: this.bannerK, b: 1, duration: 280, delay: 1250, ease: 'Stepped', easeParams: [4] });
    this.tweens.add({ targets: title, y: { from: 28, to: 40 }, duration: 320, ease: 'Back.easeOut', delay: 120 });
  }

  /** Banner alpha: in/out tween, and low while Pip is up in its band. */
  private updateBanner(): void {
    if (!this.banner.length) return;
    const base = this.bannerK.a * (1 - this.bannerK.b);
    if (base <= 0 && this.bannerK.b >= 1) { for (const b of this.banner) b.destroy(); this.banner = []; return; }
    const cover = this.cover;
    const band: Rect = { x: 0, y: 0, w: W, h: 130 };
    const under = !!cover.pip && hits(cover.pip, band);
    for (const b of this.banner) b.setAlpha(under ? Math.min(base, 0.18) : base);
  }

  private setCaption(m: Msg | null): void {
    if (m?.key === this.shown?.key) return;
    this.shown = m;
    this.tweens.killTweensOf([this.caption, this.capK]);
    if (!m) { this.tweens.add({ targets: this.caption, alpha: 0, duration: 160, ease: 'Stepped', easeParams: [3] }); return; }
    const style: PanelStyle = m.kind === 'lore' ? 'paper' : m.kind === 'stuck' || m.kind === 'tip' ? 'tape' : 'crt';
    this.capText.setText(m.text).setTint(style === 'crt' ? PHOSPHOR : KEY.k!);
    const icon = m.kind === 'lore';
    const uw = Math.round(this.capText.width / UI) + (icon ? 26 : 14), uh = Math.round(this.capText.height / UI) + (style === 'tape' ? 10 : 8);
    this.capPanel.setTexture(panelTex(this, uw | 1, uh, style));
    const midY = -Math.round((uh * UI) / 2) - UI;
    this.capText.setPosition(icon ? 6 * UI : 0, midY + (style === 'tape' ? 2 * UI : 0));
    this.capIcon.setVisible(icon).setPosition(-Math.round((uw * UI) / 2) + 9 * UI, midY);
    this.capH = uh * UI + 2;
    this.capW = (uw | 1) * UI;
    this.capK.v = 0;
    this.caption.setAlpha(0);
    this.tweens.add({ targets: this.caption, alpha: 1, duration: 200 });
    this.tweens.add({ targets: this.capK, v: 1, duration: 200, ease: 'Back.easeOut' });
    if (m.kind === 'lore') audio.play('tock', 1, 0.5);
  }

  /** The reading panel docks to the roomiest of four spots (bottom centre, bottom corners, top centre): fewest hazards, objects and tiles under it, never Pip. */
  private placeCaption(): void {
    const cap = this.caption;
    const w = this.capW || CAP_W, h = this.capH || 40;
    const k = this.capK.v;
    const spot = (sl: Slot): { x: number; y: number } => {
      if (sl === 'bl') return { x: 170 + w / 2, y: H - 14 };
      if (sl === 'br') return { x: W - 16 - w / 2, y: H - 14 };
      if (sl === 'tc') return { x: W / 2, y: CAP_TOP + h };
      return { x: W / 2, y: H - 14 };
    };
    if (this.shown) {
      let best = this.slot, bestS = Infinity;
      for (const sl of ['bc', 'bl', 'br', 'tc'] as Slot[]) {
        const p = spot(sl);
        const sc = this.cover.score({ x: p.x - w / 2, y: p.y - h, w, h }) + (sl === this.slot ? -50 : sl === 'tc' ? 20 : 0);
        if (sc < bestS) { bestS = sc; best = sl; }
      }
      this.slot = best;
    }
    const p = spot(this.slot);
    const off = (1 - k) * 6 * (this.slot === 'tc' ? -1 : 1);
    cap.x += (p.x - cap.x) * 0.35; cap.y += (p.y + off - cap.y) * 0.35;
    // If every spot is crowded and Pip is behind it, fade the panel out of the way.
    const r: Rect = { x: cap.x - w / 2, y: cap.y - h, w, h };
    const behind = !!this.cover.pip && hits(r, this.cover.pip);
    this.capFade += ((behind ? 0.2 : 1) - this.capFade) * 0.25;
    for (const o of [this.capPanel, this.capText, this.capIcon]) o.setAlpha(this.capFade);
  }

  /** Sign bubbles: small, anchored beside their sign, on whichever side is most open; faded when Pip is behind; only the sign Pip stands by shows its words. */
  private updateBubbles(dt: number): void {
    const g = this.game_, v = g.view;
    if (!v) return;
    if (this.bubbleWorld !== g.world) {
      for (const b of this.bubbles.values()) b.box.destroy();
      this.bubbles.clear();
      this.bubbleWorld = g.world;
    }
    const live = new Set<string>();
    const margin = 8;
    const zoom = g.cameras.main.zoom;
    for (const sg of v.signBubbles()) {
      const a0 = g.toScreen(sg.x - 80, sg.y), a1 = g.toScreen(sg.x + 80, sg.y + 160);
      const sr: Rect = { x: a0.x, y: a0.y, w: a1.x - a0.x, h: Math.max(a1.y - a0.y, 16 * zoom) };
      if (sr.x + sr.w < -40 || sr.x > W + 40 || sr.y + sr.h < -40 || sr.y > H + 40) continue;
      live.add(sg.id);
      let b = this.bubbles.get(sg.id);
      if (!b) {
        const panel = this.add.image(0, 0, panelTex(this, 12, 8, 'crt')).setScale(UI).setOrigin(0.5, 0.5);
        const text = this.add.bitmapText(0, 0, 'pf', '', 2).setOrigin(0.5, 0.5).setCenterAlign().setTint(PHOSPHOR);
        const box = this.add.container(0, 0, [panel, text]).setAlpha(0);
        b = { box, panel, text, side: 'u', k: 0, a: 0, mode: '', shown: '', w: 0, h: 0 };
        this.bubbles.set(sg.id, b);
      }
      b.k += ((sg.speaking ? 1 : 0) - b.k) * Math.min(1, dt * 10);
      const mode = b.k > 0.5 ? 'full' : 'mark';
      const label = mode === 'full' ? sg.text : '...';
      if (mode !== b.mode || label !== b.shown) {
        if (mode === 'full' && b.mode === 'mark') audio.play('tock', 1, 0.5);
        b.mode = mode; b.shown = label;
        b.text.setMaxWidth(mode === 'full' ? BUBBLE_W - 20 : 0).setText(clean(label));
        const uw = Math.max(12, Math.round(b.text.width / UI) + (mode === 'full' ? 10 : 8)), uh = Math.round(b.text.height / UI) + (mode === 'full' ? 8 : 6);
        b.panel.setTexture(panelTex(this, uw | 1, uh, 'crt'));
        b.w = (uw | 1) * UI; b.h = uh * UI + 2 * 2;
      }
      const gap = 10;
      const sides: Array<['u' | 'd' | 'r' | 'l', number, Rect]> = [
        ['u', 0, { x: sr.x + sr.w / 2 - b.w / 2, y: sr.y - gap - b.h, w: b.w, h: b.h }],
        ['d', 6, { x: sr.x + sr.w / 2 - b.w / 2, y: sr.y + sr.h + gap, w: b.w, h: b.h }],
        ['r', 10, { x: sr.x + sr.w + gap, y: sr.y + sr.h / 2 - b.h / 2, w: b.w, h: b.h }],
        ['l', 10, { x: sr.x - gap - b.w, y: sr.y + sr.h / 2 - b.h / 2, w: b.w, h: b.h }],
      ];
      let pick = sides[0]!, pickS = Infinity;
      for (const c of sides) {
        const r = c[2];
        r.x = Math.max(margin, Math.min(W - margin - r.w, r.x));
        r.y = Math.max(margin, Math.min(H - margin - r.h, r.y));
        // The top-left pills are HUD too.
        const hud = r.x < 340 && r.y < 140 ? 400 : 0;
        const sc = this.cover.score(r) + c[1] + hud + (c[0] === b.side ? -40 : 0);
        if (sc < pickS) { pickS = sc; pick = c; }
      }
      b.side = pick[0];
      const r = pick[2];
      const behind = !!this.cover.pip && hits(r, this.cover.pip);
      const target = behind ? 0.2 : mode === 'full' ? 1 : 0.55;
      b.a += (target - b.a) * Math.min(1, dt * 10);
      b.box.setPosition(Math.round(r.x + r.w / 2), Math.round(r.y + r.h / 2)).setAlpha(b.a);
      b.box.setScale(mode === 'full' ? 0.75 + 0.25 * Math.min(1, (b.k - 0.5) * 4) : 1);
    }
    for (const [id, b] of this.bubbles) if (!live.has(id)) { b.box.destroy(); this.bubbles.delete(id); }
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
      this.buildVars();
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
      this.layoutDeath(String(deaths));
      if (bump) {
        this.tweens.killTweensOf([this.deathText, this.skull]);
        this.deathText.setScale(1.67); this.skull.setScale(UI + 1).setAngle(-15);
        this.tweens.add({ targets: this.deathText, scale: 1, duration: 360, ease: 'Bounce.easeOut' });
        this.tweens.add({ targets: this.skull, scale: UI, angle: 0, duration: 360, ease: 'Bounce.easeOut' });
      }
    }
    if (g.campaign && this.noteText && this.jarText) {
      const c = g.relicCounts();
      this.layoutRelics(`${c.notes}/${c.notesTotal}`, `${c.jars}/${c.jarsTotal}`);
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
    if (vm && (vm.kind === 'lore' || vm.kind === 'stuck' || vm.kind === 'event')) m = vm;
    else if (this.tip) m = { key: this.tip.key, text: this.tip.text, kind: 'tip' };
    else if (vm && vm.kind !== 'sign') m = vm;
    this.cover = coverMap(g);
    this.setCaption(m);
    this.updateVars();
    this.placeCaption();
    this.updateBubbles(dt);
    // Under the pause menu the panels would collide with its title.
    const paused = this.scene.isActive('Pause');
    this.caption.setVisible(!paused);
    for (const b of this.bubbles.values()) b.box.setVisible(!paused);
    this.updateBanner();
    this.restart.setAlpha(w.suggestRestart ? 0.6 + (Math.floor(this.t * 3) % 2) * 0.4 : 0.6);
  }
}
