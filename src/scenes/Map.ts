// World map (M, or Pause → Map). A schematic, not a survey: one coloured band per wing (Core at the
// top, Sterile Wing at the bottom, as in the building), the atrium hubs as their own column, rooms as
// named boxes, chambers as numbered tiles that show cleared/uncleared, Pip's room highlighted, relic
// counts per wing and a legend. Pick a visited room (arrows + Enter, or click) to travel there.
import Phaser from 'phaser';
import type { Game } from './Game';
import { ATLAS } from '../render/pixel/sprites';
import { ptext } from '../render/pixel/font';
import { PHOSPHOR } from '../render/pixel/uitex';
import { KEY, mix } from '../render/pixel/pal';
import { audio } from '../audio/sfx';
import type { LevelData } from '../sim/types';

const W = 1280, H = 720;
const WING_NAMES: Record<number, string> = { 1: 'Sterile Wing', 2: 'Flooded Bio-Lab', 3: 'Deep Containment', 4: 'The Core' };
const WING_COLORS: Record<number, number> = { 1: 0x70d8ff, 2: 0x7dffb2, 3: 0xffb03f, 4: 0xff6a3a };
const HUB_COLOR = 0xc8d0dc;
const INK = 0x0b0910, PAPER = 0xfff4e4, MUTED = 0x8a8496;

interface Box { id: string; l: LevelData; x: number; y: number; w: number; h: number; wing: number; kind: 'hub' | 'zone' | 'chamber'; num?: string }

const isHub = (l: LevelData) => l.kind === 'zone' && (/^(atrium|hub)/i.test(l.id) || /atrium|access/i.test(l.name));
const wingOf = (l: LevelData) => Math.max(1, Math.min(4, l.biome ?? l.act ?? 1));

export class WorldMap extends Phaser.Scene {
  private game_!: Game;
  private boxes: Box[] = [];
  private sel = 0;
  private selRect!: Phaser.GameObjects.Graphics;
  private info!: Phaser.GameObjects.Container;
  private you: Phaser.GameObjects.Image | null = null;
  private t = 0;
  private closing = false;

  constructor() { super('Map'); }
  init(d: { game: Game }): void { this.game_ = d.game; this.you = null; this.t = 0; this.boxes = []; this.closing = false; }

  create(): void {
    const c = this.game_.campaign;
    if (!c) { this.close(); return; }
    this.scene.setVisible(false, 'Hud');
    this.events.once('shutdown', () => this.scene.setVisible(true, 'Hud'));
    const dim = this.add.rectangle(W / 2, H / 2, W, H, INK, 0.94).setInteractive();
    const root = this.add.container(0, 0);
    root.add(ptext(this, 40, 44, c.def.name || 'Map', { scale: 4, bold: true, color: PAPER, origin: [0, 0.5] }));

    // Group rooms: hubs in one column, then each wing's zones and chambers in its own row.
    const rooms = c.def.rooms.map((id) => c.level(id)).filter((l) => !l.credits);
    const wings = [...new Set(rooms.map(wingOf))].sort((a, b) => b - a);
    const top = 96, bottom = 640, gap = 12;
    const rowH = Math.floor((bottom - top - gap * (wings.length - 1)) / Math.max(1, wings.length));
    const g = this.add.graphics();
    root.add(g);
    const rc = this.relicsByWing(rooms);
    wings.forEach((wing, row) => {
      const y0 = top + row * (rowH + gap), color = WING_COLORS[wing] ?? HUB_COLOR;
      // The wing band.
      g.fillStyle(color, 0.1).fillRect(240, y0, 640, rowH);
      g.lineStyle(2, color, 0.55).strokeRect(240, y0, 640, rowH);
      root.add(ptext(this, 252, y0 + 12, WING_NAMES[wing] ?? `Wing ${wing}`, { scale: 2, color, origin: [0, 0.5] }));
      const r = rc.get(wing);
      if (r) root.add(ptext(this, 868, y0 + 12, `notes ${r.notes}/${r.notesT}  jars ${r.jars}/${r.jarsT}`, { scale: 2, color: mix(color, PAPER, 0.4), origin: [1, 0.5] }));
      // Hub for this wing (the atrium column).
      rooms.filter((l) => isHub(l) && wingOf(l) === wing).forEach((l, i, arr) => {
        const h = Math.min(64, (rowH - 16) / arr.length - 6);
        this.boxes.push({ id: l.id, l, x: 50, y: Math.round(y0 + rowH / 2 - (arr.length * (h + 6)) / 2 + i * (h + 6) + 3), w: 172, h: Math.round(h), wing, kind: 'hub' });
      });
      const zones = rooms.filter((l) => l.kind === 'zone' && !isHub(l) && wingOf(l) === wing);
      zones.forEach((l, i) => {
        const h = Math.round(Math.min(70, (rowH - 34) / zones.length - 6));
        this.boxes.push({ id: l.id, l, x: 256, y: Math.round(y0 + 26 + i * (h + 6)), w: 290, h, wing, kind: 'zone' });
      });
      const chambers = rooms.filter((l) => l.kind !== 'zone' && wingOf(l) === wing).sort((a, b) => a.id.localeCompare(b.id));
      const per = Math.max(1, Math.min(4, chambers.length)), tw = 70, th = Math.min(56, rowH - 40);
      chambers.forEach((l, i) => {
        const col = i % per, rowN = Math.floor(i / per);
        this.boxes.push({ id: l.id, l, x: 566 + col * (tw + 8), y: Math.round(y0 + 30 + rowN * (th + 6)), w: tw, h: th, wing, kind: 'chamber', num: l.id.replace(/\D/g, '').padStart(2, '0') });
      });
    });
    // Hub column band.
    if (this.boxes.some((b) => b.kind === 'hub')) {
      g.fillStyle(HUB_COLOR, 0.06).fillRect(40, top, 192, bottom - top);
      g.lineStyle(2, HUB_COLOR, 0.35).strokeRect(40, top, 192, bottom - top);
      root.add(ptext(this, 136, top - 10, 'Atrium hubs', { scale: 2, color: HUB_COLOR, origin: [0.5, 0.5] }));
    }
    // Connections: exits between drawn rooms, and each zone to its wing's chambers.
    const byId = new Map(this.boxes.map((b) => [b.id, b]));
    g.lineStyle(2, MUTED, 0.6);
    const seen = new Set<string>();
    for (const b of this.boxes) for (const e of b.l.exits ?? []) {
      const o = byId.get(e.to);
      const key = [b.id, e.to].sort().join('|');
      if (!o || seen.has(key)) continue;
      seen.add(key);
      g.lineBetween(b.x + b.w / 2, b.y + b.h / 2, o.x + o.w / 2, o.y + o.h / 2);
    }
    for (const z of this.boxes.filter((b) => b.kind === 'zone')) {
      const ch = this.boxes.filter((b) => b.kind === 'chamber' && b.wing === z.wing);
      if (ch.length) g.lineBetween(z.x + z.w, z.y + z.h / 2, ch[0]!.x, z.y + z.h / 2);
    }
    // Boxes.
    for (const b of this.boxes) this.drawBox(g, root, b);

    this.selRect = this.add.graphics();
    root.add(this.selRect);
    this.info = this.add.container(0, 0);
    root.add(this.info);
    this.drawLegend(root);
    root.add(ptext(this, W / 2, H - 24, 'arrows select · enter travel · m / esc close', { scale: 2, color: PAPER, origin: [0.5, 0.5] }).setAlpha(0.8));

    this.sel = Math.max(0, this.boxes.findIndex((b) => b.id === c.roomId));
    this.select(this.sel, false);
    root.setAlpha(0);
    this.tweens.add({ targets: root, alpha: 1, duration: 140, ease: 'Quad.easeOut' });
    audio.play('menu', 1.2, 0.7);

    const kb = this.input.keyboard!;
    kb.on('keydown-ESC', () => this.close());
    kb.on('keydown-N', () => audio.toggleMute());
    kb.on('keydown-ENTER', () => this.travel());
    kb.on('keydown-SPACE', () => this.travel());
    for (const [k, dx, dy] of [['LEFT', -1, 0], ['RIGHT', 1, 0], ['UP', 0, -1], ['DOWN', 0, 1], ['A', -1, 0], ['D', 1, 0], ['W', 0, -1], ['S', 0, 1]] as const) {
      kb.on(`keydown-${k}`, () => this.move(dx, dy));
    }
    dim.on('pointerup', () => this.close());
  }

  private relicsByWing(rooms: LevelData[]): Map<number, { notes: number; notesT: number; jars: number; jarsT: number }> {
    const c = this.game_.campaign!;
    const out = new Map<number, { notes: number; notesT: number; jars: number; jarsT: number }>();
    for (const l of rooms) {
      const r = out.get(wingOf(l)) ?? { notes: 0, notesT: 0, jars: 0, jarsT: 0 };
      for (const o of l.objects) if (o.type === 'relic') {
        const got = c.collected.has(o.id);
        if (o.kind === 'note') { r.notesT++; if (got) r.notes++; } else { r.jarsT++; if (got) r.jars++; }
      }
      out.set(wingOf(l), r);
    }
    for (const [k, v] of out) if (v.notesT + v.jarsT === 0) out.delete(k);
    return out;
  }

  private drawBox(g: Phaser.GameObjects.Graphics, root: Phaser.GameObjects.Container, b: Box): void {
    const c = this.game_.campaign!;
    const visited = c.visited.has(b.id), here = c.roomId === b.id, cleared = c.cleared.has(b.id);
    const color = b.kind === 'hub' ? HUB_COLOR : WING_COLORS[b.wing] ?? HUB_COLOR;
    if (visited) {
      g.fillStyle(mix(color, INK, cleared ? 0.55 : 0.72), 1).fillRect(b.x, b.y, b.w, b.h);
      g.lineStyle(2, color, 1).strokeRect(b.x, b.y, b.w, b.h);
    } else {
      g.fillStyle(0x16131d, 1).fillRect(b.x, b.y, b.w, b.h);
      g.lineStyle(2, 0x3a3546, 1).strokeRect(b.x, b.y, b.w, b.h);
    }
    if (here) g.lineStyle(3, PAPER, 1).strokeRect(b.x - 4, b.y - 4, b.w + 8, b.h + 8);
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    if (b.kind === 'chamber') {
      root.add(ptext(this, cx, cy - (cleared || !visited ? 6 : 0), b.num ?? '?', { scale: 3, bold: true, color: visited ? PAPER : 0x5a5466, origin: [0.5, 0.5] }));
      if (cleared) root.add(this.add.image(cx, cy + 14, ATLAS, 'check').setScale(2));
      else if (!visited) root.add(this.add.image(cx, cy + 15, ATLAS, 'lock').setScale(2).setAlpha(0.7));
    } else {
      root.add(ptext(this, b.x + 10, b.y + 14, b.l.name, { scale: 2, color: visited ? PAPER : 0x5a5466, origin: [0, 0.5] }));
      if (!visited) root.add(this.add.image(b.x + b.w - 14, b.y + 14, ATLAS, 'lock').setScale(2).setAlpha(0.8));
      else {
        const left = b.l.objects.filter((o) => o.type === 'relic' && !c.collected.has(o.id)).length;
        for (let i = 0; i < left; i++) g.fillStyle(KEY.z!, 1).fillRect(b.x + 10 + i * 8, b.y + b.h - 12, 5, 5);
      }
    }
    if (here) {
      this.you = this.add.image(b.kind === 'chamber' ? b.x + 12 : b.x + b.w - 18, b.kind === 'chamber' ? b.y + 12 : b.y + b.h - 16, ATLAS, 'pip_idle0').setScale(2);
      root.add(this.you);
    }
  }

  private drawLegend(root: Phaser.GameObjects.Container): void {
    const x = 910, c = this.game_.campaign!;
    const g = this.add.graphics();
    root.add(g);
    g.fillStyle(0x16131d, 1).fillRect(x, 330, 330, 250);
    g.lineStyle(2, 0x3a3546, 1).strokeRect(x, 330, 330, 250);
    root.add(ptext(this, x + 14, 350, 'Legend', { scale: 2, color: MUTED, origin: [0, 0.5] }));
    const row = (y: number, draw: () => void, label: string) => { draw(); root.add(ptext(this, x + 56, y, label, { scale: 2, color: PAPER, origin: [0, 0.5] })); };
    row(384, () => root.add(this.add.image(x + 28, 384, ATLAS, 'pip_idle0').setScale(2)), 'you are here');
    row(416, () => { g.fillStyle(mix(WING_COLORS[1]!, INK, 0.72), 1).fillRect(x + 16, 406, 24, 20); g.lineStyle(2, WING_COLORS[1]!, 1).strokeRect(x + 16, 406, 24, 20); }, 'visited: travel here');
    row(448, () => { g.fillStyle(0x16131d, 1).fillRect(x + 16, 438, 24, 20); g.lineStyle(2, 0x3a3546, 1).strokeRect(x + 16, 438, 24, 20); root.add(this.add.image(x + 28, 448, ATLAS, 'lock')); }, 'not found yet');
    row(480, () => root.add(this.add.image(x + 28, 480, ATLAS, 'check').setScale(2)), 'chamber cleared');
    row(512, () => g.fillStyle(KEY.z!, 1).fillRect(x + 25, 508, 6, 6), 'relic still here');
    const rc = this.game_.relicCounts();
    root.add(this.add.image(x + 28, 552, ATLAS, 'iconNote').setScale(2));
    root.add(ptext(this, x + 44, 552, `${rc.notes}/${rc.notesTotal}`, { scale: 2, color: PHOSPHOR, origin: [0, 0.5] }));
    root.add(this.add.image(x + 128, 552, ATLAS, 'iconJar').setScale(2));
    root.add(ptext(this, x + 144, 552, `${rc.jars}/${rc.jarsTotal}`, { scale: 2, color: PHOSPHOR, origin: [0, 0.5] }));
    root.add(this.add.image(x + 228, 552, ATLAS, 'skull').setScale(2));
    root.add(ptext(this, x + 244, 552, `${c.totalDeaths}`, { scale: 2, color: PHOSPHOR, origin: [0, 0.5] }));
  }

  private select(i: number, sound = true): void {
    this.sel = i;
    const b = this.boxes[i];
    if (!b) return;
    if (sound) audio.play('menu', 1.1, 0.5);
    const c = this.game_.campaign!;
    this.info.removeAll(true);
    const x = 910, visited = c.visited.has(b.id), here = c.roomId === b.id;
    const g = this.add.graphics().fillStyle(0x16131d, 1).fillRect(x, 96, 330, 220).lineStyle(2, 0x3a3546, 1).strokeRect(x, 96, 330, 220);
    this.info.add(g);
    const color = b.kind === 'hub' ? HUB_COLOR : WING_COLORS[b.wing] ?? HUB_COLOR;
    this.info.add(ptext(this, x + 14, 118, b.kind === 'chamber' ? `Chamber ${b.num}` : b.kind === 'hub' ? 'Atrium hub' : WING_NAMES[b.wing] ?? 'Zone', { scale: 2, color, origin: [0, 0.5] }));
    const name = ptext(this, x + 14, 136, visited ? b.l.name : '???', { scale: 3, bold: true, color: PAPER, origin: [0, 0], wrap: 300 });
    this.info.add(name);
    const sy = 136 + name.height + 16;
    const status = here ? 'You are here.' : visited ? (c.cleared.has(b.id) ? 'Cleared. Enter to travel.' : 'Enter to travel here.') : 'Not found yet.';
    this.info.add(ptext(this, x + 14, sy, status, { scale: 2, color: here ? PAPER : visited ? PHOSPHOR : MUTED, origin: [0, 0.5], wrap: 300 }));
    const relics = b.l.objects.filter((o) => o.type === 'relic');
    if (visited && relics.length) {
      const got = relics.filter((o) => c.collected.has(o.id)).length;
      this.info.add(this.add.image(x + 26, sy + 40, ATLAS, 'iconNote').setScale(2));
      this.info.add(ptext(this, x + 44, sy + 40, `relics found here: ${got}/${relics.length}`, { scale: 2, color: PAPER, origin: [0, 0.5] }));
    }
    if (b.kind === 'chamber' && visited) this.info.add(ptext(this, x + 14, sy + 76, c.cleared.has(b.id) ? 'Solved.' : 'Unsolved.', { scale: 2, color: c.cleared.has(b.id) ? KEY.j! : MUTED, origin: [0, 0.5] }));
    this.drawSel();
  }

  private drawSel(): void {
    const b = this.boxes[this.sel];
    if (!b) return;
    const on = Math.floor(this.t * 3) % 4 !== 3;
    this.selRect.clear().lineStyle(3, KEY.z!, on ? 1 : 0.4).strokeRect(b.x - 7, b.y - 7, b.w + 14, b.h + 14);
  }

  /** Arrow keys: the nearest box in that direction. */
  private move(dx: number, dy: number): void {
    const a = this.boxes[this.sel];
    if (!a) return;
    const ax = a.x + a.w / 2, ay = a.y + a.h / 2;
    let best = -1, bestScore = Infinity;
    this.boxes.forEach((b, i) => {
      if (i === this.sel) return;
      const vx = b.x + b.w / 2 - ax, vy = b.y + b.h / 2 - ay;
      const along = vx * dx + vy * dy;
      if (along <= 4) return;
      const score = along + Math.abs(vx * dy + vy * dx) * 2.2;
      if (score < bestScore) { bestScore = score; best = i; }
    });
    if (best >= 0) this.select(best);
  }

  private travel(): void {
    const b = this.boxes[this.sel];
    const c = this.game_.campaign;
    if (!b || !c || this.closing) return;
    if (b.id === c.roomId) { this.close(); return; }
    if (!c.visited.has(b.id)) { audio.play('tock', 0.6); this.cameras.main.shake(80, 0.004); return; }
    this.closing = true;
    audio.play('select');
    this.scene.stop();
    this.scene.resume('Game');
    this.game_.travel(b.id);
  }

  override update(_t: number, dt: number): void {
    this.t += dt / 1000;
    this.you?.setVisible(Math.floor(this.t * 2.5) % 3 !== 2);
    this.drawSel();
    // Mouse: hover selects, click travels.
    const p = this.input.activePointer;
    if (p.isDown || p.velocity.lengthSq() > 0) {
      const i = this.boxes.findIndex((b) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h);
      if (i >= 0 && i !== this.sel) this.select(i);
    }
  }

  close(): void {
    if (this.closing && this.scene.isActive() === false) return;
    audio.play('menu', 0.9, 0.6);
    this.scene.stop();
    this.scene.resume('Game');
  }
}
