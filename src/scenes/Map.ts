// World map (Tab, or Pause → Map): rooms Pip has visited laid out from WORLD.layout, rooms next door as
// faint outlines, the current room blinking with Pip's position, cleared chambers ticked, and relic counts.
import Phaser from 'phaser';
import type { Game } from './Game';
import { UI } from '../render/ui';
import { ATLAS } from '../render/pixel/sprites';
import { ptext } from '../render/pixel/font';
import { panelTex, PHOSPHOR } from '../render/pixel/uitex';
import { KEY } from '../render/pixel/pal';
import { audio } from '../audio/sfx';
import { U, type LevelData } from '../sim/types';

const W = 1280, H = 720;
const AREA = { x: 120, y: 118, w: 1040, h: 470 };

export class WorldMap extends Phaser.Scene {
  private game_!: Game;
  private you: Phaser.GameObjects.Rectangle | null = null;
  private t = 0;

  constructor() { super('Map'); }
  init(d: { game: Game }): void { this.game_ = d.game; this.you = null; this.t = 0; }

  create(): void {
    const c = this.game_.campaign;
    if (!c) { this.close(); return; }
    this.scene.setVisible(false, 'Hud');
    this.events.once('shutdown', () => this.scene.setVisible(true, 'Hud'));
    const dim = this.add.rectangle(W / 2, H / 2, W, H, KEY.k!, 0).setInteractive();
    this.tweens.add({ targets: dim, fillAlpha: 0.88, duration: 140, ease: 'Stepped', easeParams: [3] });
    const root = this.add.container(0, 0);
    root.add(this.add.rectangle(W / 2, H / 2 + 6, 400 * UI - 24, 216 * UI - 24, 0x0d1a17, 1));
    root.add(this.add.image(W / 2, H / 2 + 6, panelTex(this, 400, 216, 'crt')).setScale(UI));
    // Faint grid, like a schematic on the terminal.
    const grid = this.add.graphics().fillStyle(PHOSPHOR, 0.06);
    for (let x = AREA.x - 40; x < AREA.x + AREA.w + 40; x += 24) grid.fillRect(x, AREA.y - 30, 1, AREA.h + 60);
    for (let y = AREA.y - 30; y < AREA.y + AREA.h + 30; y += 24) grid.fillRect(AREA.x - 40, y, AREA.w + 80, 1);
    root.add(grid);
    root.add(ptext(this, W / 2, 62, c.def.name || 'Map', { scale: 4, bold: true, color: 0xfff4e4, origin: [0.5, 0.5] }));

    const layout = c.def.layout ?? {};
    const rooms: Array<{ id: string; l: LevelData; x: number; y: number }> = [];
    for (const id of c.def.rooms) {
      const p = layout[id];
      if (!p) continue;
      rooms.push({ id, l: c.level(id), x: p.x, y: p.y });
    }
    // Which rooms to show: visited ones, plus outlines of rooms one exit away.
    const near = new Set<string>();
    for (const r of rooms) if (c.visited.has(r.id)) for (const e of r.l.exits ?? []) near.add(e.to);
    const shown = rooms.filter((r) => c.visited.has(r.id) || near.has(r.id));
    const all = shown.length ? shown : rooms;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const r of all) { x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.l.width); y1 = Math.max(y1, r.y + r.l.height); }
    const s = Math.min(AREA.w / Math.max(1, x1 - x0), AREA.h / Math.max(1, y1 - y0), 8);
    const ox = AREA.x + (AREA.w - (x1 - x0) * s) / 2, oy = AREA.y + (AREA.h - (y1 - y0) * s) / 2;
    const R = (v: number) => Math.round(v);
    const g = this.add.graphics();
    root.add(g);
    const relicLeft = new Map<string, number>();
    for (const r of shown) {
      let n = 0;
      for (const o of r.l.objects) if (o.type === 'relic' && !c.collected.has(o.id)) n++;
      relicLeft.set(r.id, n);
    }
    for (const r of shown) {
      const rx = R(ox + (r.x - x0) * s), ry = R(oy + (r.y - y0) * s), rw = Math.max(4, R(r.l.width * s)), rh = Math.max(4, R(r.l.height * s));
      const visited = c.visited.has(r.id);
      const chamber = r.l.kind === 'chamber' || /^L\d+/.test(r.id);
      if (visited) {
        g.fillStyle(chamber ? 0x2e5a48 : 0x1f3d3a, 1).fillRect(rx, ry, rw, rh);
        g.lineStyle(2, PHOSPHOR, 0.9).strokeRect(rx + 1, ry + 1, rw - 2, rh - 2);
      } else {
        // Dashed outline for a room you can see a way into.
        g.fillStyle(PHOSPHOR, 0.55);
        for (let x = rx; x < rx + rw; x += 6) { g.fillRect(x, ry, 3, 2); g.fillRect(x, ry + rh - 2, 3, 2); }
        for (let y = ry; y < ry + rh; y += 6) { g.fillRect(rx, y, 2, 3); g.fillRect(rx + rw - 2, y, 2, 3); }
      }
      // Exits as bright notches on the border.
      if (visited) for (const e of r.l.exits ?? []) {
        g.fillStyle(0xfff4e4, 1);
        g.fillRect(R(ox + (r.x + e.x - x0) * s), R(oy + (r.y + e.y - y0) * s), Math.max(3, R(e.w * s)), Math.max(3, R(e.h * s)));
      }
      if (visited && c.cleared.has(r.id) && rw > 18 && rh > 18) root.add(this.add.image(rx + rw - 10, ry + 10, ATLAS, 'check').setScale(2));
      const left = relicLeft.get(r.id) ?? 0;
      if (visited && left > 0) for (let i = 0; i < left; i++) g.fillStyle(KEY.z!, 1).fillRect(rx + 5 + i * 6, ry + rh - 9, 4, 4);
      if (r.id === c.roomId) {
        const w = this.game_.world, p = w.pip;
        const px = ox + (r.x - x0 + (p.x + p.w / 2) / U) * s, py = oy + (r.y - y0 + (p.y + p.h / 2) / U) * s;
        this.you = this.add.rectangle(R(px), R(py), 10, 10, 0xff6a4d).setStrokeStyle(2, 0xfff4e4);
        root.add(this.you);
        g.lineStyle(2, 0xfff4e4, 1).strokeRect(rx - 2, ry - 2, rw + 4, rh + 4);
        const label = ptext(this, rx + rw / 2, ry - 12, r.l.name, { scale: 2, outline: true, color: 0xfff4e4, origin: [0.5, 1] });
        label.x = Phaser.Math.Clamp(label.x, AREA.x + label.width / 2, AREA.x + AREA.w - label.width / 2);
        root.add(label);
      }
    }

    // Footer: relics and deaths.
    const rc = this.game_.relicCounts();
    const fy = H - 74;
    root.add(this.add.image(W / 2 - 250, fy, ATLAS, 'iconNote').setScale(UI));
    root.add(ptext(this, W / 2 - 228, fy, `notes ${rc.notes}/${rc.notesTotal}`, { scale: 3, color: PHOSPHOR, origin: [0, 0.5] }));
    root.add(this.add.image(W / 2 - 10, fy, ATLAS, 'iconJar').setScale(UI));
    root.add(ptext(this, W / 2 + 12, fy, `jars ${rc.jars}/${rc.jarsTotal}`, { scale: 3, color: PHOSPHOR, origin: [0, 0.5] }));
    root.add(this.add.image(W / 2 + 196, fy, ATLAS, 'skull').setScale(UI));
    root.add(ptext(this, W / 2 + 218, fy, `${c.totalDeaths}`, { scale: 3, color: PHOSPHOR, origin: [0, 0.5] }));
    root.add(ptext(this, W / 2, H - 30, 'tab / esc  close', { scale: 2, outline: true, color: 0xfff4e4, origin: [0.5, 0.5] }).setAlpha(0.8));

    root.setAlpha(0);
    root.y = 12;
    this.tweens.add({ targets: root, alpha: 1, y: 0, duration: 180, ease: 'Quad.easeOut' });
    audio.play('menu', 1.2, 0.7);
    const kb = this.input.keyboard!;
    kb.on('keydown-ESC', () => this.close());
    kb.on('keydown-M', () => audio.toggleMute());
    dim.on('pointerup', () => this.close());
  }

  override update(_t: number, dt: number): void {
    this.t += dt / 1000;
    this.you?.setVisible(Math.floor(this.t * 2.5) % 3 !== 2);
  }

  close(): void {
    audio.play('menu', 0.9, 0.6);
    this.scene.stop();
    this.scene.resume('Game');
  }
}
