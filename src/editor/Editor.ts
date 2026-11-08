// The level editor scene (Spec §10). The canvas shows the real game renderer on a live World built
// from the draft, with editor overlays on top: grid, hidden traps, zones, links and paths.
import Phaser from 'phaser';
import { U, type Action, type LevelData, type LevelObject, type Pt, type TileRect, type Trigger } from '../sim/types';
import { World } from '../sim/world';
import { cloneLevel, normalizeLevel, validateLevel } from '../sim/level';
import { LevelView } from '../render/level-view';
import { C, FONT, TILE } from '../render/palette';
import { CREDITS_LEVEL, LEVELS } from '../levels';
import { audio } from '../audio/sfx';
import { music } from '../audio/music';
import type { Backdrop } from '../scenes/Backdrop';
import type { GameData } from '../scenes/Game';
import { ACTION_LABEL, ACTION_TARGET, EditorDoc, blankLevel, defaultAction, footprint } from './model';
import { EditorUI, GAME_H, GAME_W, LEFT_W, RIGHT_W, TOP_H, type PickRequest, type Selection, type UiHost } from './panels';
import { SELECT, TABS, TOOLS, findTool, type TabId, type Tool } from './tools';
import { shareUrl } from './share';

type Drag =
  | { kind: 'paint'; last: Pt }
  | { kind: 'erase'; last: Pt }
  | { kind: 'move'; id: string; grab: Pt; moved: boolean }
  | { kind: 'zone'; start: Pt; cur: Pt }
  | { kind: 'rect'; start: Pt; cur: Pt; onPick: (r: TileRect) => void };

interface LinkSource { trigger: Trigger; at: Pt }

const rectOf = (a: Pt, b: Pt): TileRect => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x) + 1, h: Math.abs(a.y - b.y) + 1 });

export class Editor extends Phaser.Scene implements UiHost {
  doc!: EditorDoc;
  ui!: EditorUI;
  tab: TabId = 'tiles';
  tool: Tool = TOOLS.tiles[0]!;
  selection: Selection = null;
  shippedLevels = [...LEVELS, ...(CREDITS_LEVEL ? [CREDITS_LEVEL] : [])].map((l) => ({ id: l.id, name: l.name }));

  private world: World | null = null;
  private view: LevelView | null = null;
  private needsRebuild = true;
  private overlay!: Phaser.GameObjects.Graphics;
  private hoverG!: Phaser.GameObjects.Graphics;
  private texts: Phaser.GameObjects.Text[] = [];
  private hoverText!: Phaser.GameObjects.Text;
  private hover: Pt | null = null;
  private drag: Drag | null = null;
  private pickReq: PickRequest | null = null;
  private link: LinkSource | null = null;
  private zoom = 1;
  private keyHandler = (e: KeyboardEvent) => this.onKey(e);
  private beforeUnload = (e: BeforeUnloadEvent) => { if (this.doc?.dirty) { this.doc.saveDraft(); e.preventDefault(); } };
  private t = 0;

  constructor() { super('Editor'); }

  create(): void {
    this.doc = new EditorDoc(EditorDoc.loadDraft() ?? blankLevel());
    this.overlay = this.add.graphics().setDepth(20);
    this.hoverG = this.add.graphics().setDepth(21);
    this.hoverText = this.add.text(0, 0, '', { fontFamily: FONT, fontSize: '22px', color: '#2b2433', fontStyle: '700' }).setOrigin(0.5).setDepth(22).setAlpha(0.8);
    this.ui = new EditorUI(this);
    this.doc.onChange(() => { this.needsRebuild = true; this.validateSelection(); });
    this.input.mouse?.disableContextMenu();
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.onDown(p));
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.onMove(p));
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => this.onUp(p));
    this.input.on('gameout', () => { this.hover = null; });
    this.attach();
    this.events.on('wake', () => { this.attach(); this.ui.setVisible(true); this.needsRebuild = true; this.setMood(); });
    this.events.on('sleep', () => { this.detach(); this.ui.setVisible(false); });
    this.events.once('shutdown', () => { this.detach(); this.ui.destroy(); this.view?.destroy(); });
    this.setMood();
    this.ui.toast('Level editor. Paint, link, playtest, share.');
  }

  private attach(): void { window.addEventListener('keydown', this.keyHandler, true); window.addEventListener('beforeunload', this.beforeUnload); }
  private detach(): void { window.removeEventListener('keydown', this.keyHandler, true); window.removeEventListener('beforeunload', this.beforeUnload); }

  private setMood(): void {
    const bd = this.scene.get('Backdrop') as Backdrop | undefined;
    bd?.setMood?.(this.doc.level.act ?? 1);
    music.play(0);
  }

  // ---------------------------------------------------------------------------
  // UiHost
  // ---------------------------------------------------------------------------

  setTab(t: TabId): void {
    this.tab = t;
    this.tool = TOOLS[t].find((x) => x.mode !== 'select') ?? SELECT;
    this.link = null;
    this.ui.refresh();
  }

  setTool(t: Tool): void {
    this.tool = t;
    this.link = null;
    this.pick(null);
    this.ui.refresh();
  }

  select(s: Selection): void {
    this.selection = s;
    this.ui.refresh();
  }

  pick(req: PickRequest | null): void {
    this.pickReq = req;
    this.ui.showPick(req);
  }

  playtest(): void {
    const errs = this.doc.validate();
    if (errs.length) { this.ui.toast(`Can't play yet: ${errs[0]}`); return; }
    this.ui.closeMenu();
    const level = cloneLevel(this.doc.level);
    delete level.verified;
    const rev = this.doc.rev;
    const data: GameData = {
      level,
      mode: 'playtest',
      onWon: () => { if (this.doc.rev === rev) this.doc.markVerified(); },
      onExit: (r) => {
        this.scene.wake('Editor');
        if (r.won) this.ui.toast(`Beaten with ${r.deaths} ${r.deaths === 1 ? 'death' : 'deaths'}. Verified, so you can share it!`);
      },
    };
    this.scene.sleep();
    this.scene.launch('Game', data);
  }

  share(): void {
    if (!this.doc.level.verified) { this.ui.toast('Beat it in playtest first.'); return; }
    const url = shareUrl(this.doc.level);
    const copy = async () => { try { await navigator.clipboard.writeText(url); return true; } catch { return false; } };
    const wrap = document.createElement('div');
    wrap.className = 'dt-modal';
    wrap.innerHTML = `<div class="dt-card" role="dialog" aria-modal="true"><h2>Share your level</h2><p>Anyone who opens this link plays it straight away.</p><textarea readonly spellcheck="false"></textarea><div class="dt-row"><span class="dt-err" style="color:#2b2433"></span><button class="dt-btn ghost" data-a="close">Close</button><button class="dt-btn" data-a="copy">Copy link</button></div></div>`;
    const ta = wrap.querySelector('textarea') as HTMLTextAreaElement;
    ta.value = url;
    const note = wrap.querySelector('.dt-err') as HTMLElement;
    const close = () => { wrap.remove(); window.removeEventListener('keydown', esc, true); };
    const esc = (e: KeyboardEvent) => { e.stopPropagation(); if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', esc, true);
    wrap.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).dataset.a;
      if (a === 'close' || e.target === wrap) close();
      if (a === 'copy') void copy().then((ok) => { note.textContent = ok ? 'Copied!' : 'Select the text and copy it.'; ta.select(); });
    });
    document.body.appendChild(wrap);
    ta.select();
    void copy().then((ok) => { if (ok) note.textContent = 'Copied to your clipboard.'; });
  }

  exit(): void {
    this.doc.saveDraft();
    this.scene.start('Title');
  }

  save(): void {
    this.ui.toast(this.doc.saveDraft() ? 'Draft saved in this browser.' : 'Could not save (storage is blocked). Use Export.');
    this.ui.refresh();
  }

  openLevel(which: string): void {
    this.select(null);
    if (which === 'new') { this.doc.load(blankLevel()); this.ui.toast('New level.'); return; }
    if (which === 'draft') {
      const d = EditorDoc.loadDraft();
      if (d) { this.doc.load(d); this.ui.toast('Loaded your saved draft.'); } else this.ui.toast('No saved draft yet.');
      return;
    }
    const l = [...LEVELS, ...(CREDITS_LEVEL ? [CREDITS_LEVEL] : [])].find((x) => x.id === which);
    if (l) {
      const copy = cloneLevel(l);
      delete copy.verified;
      this.doc.load(copy);
      this.ui.toast(`Opened ${l.id} · ${l.name}. Make it yours.`);
    }
  }

  importFile(file: File): void {
    void file.text().then((s) => {
      try {
        const raw = JSON.parse(s) as unknown;
        const v = validateLevel(raw);
        if (!v.ok) { this.ui.toast(`Not a level: ${v.errors[0]}`); return; }
        const l = normalizeLevel(raw as LevelData);
        delete l.verified;
        this.doc.load(l);
        this.ui.toast(`Imported ${l.name}.`);
      } catch {
        this.ui.toast('That file is not valid JSON.');
      }
    });
  }

  exportFile(): void {
    const json = JSON.stringify(this.doc.level, null, 2) + '\n';
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(this.doc.level.name || 'level').replace(/[^a-z0-9-_]+/gi, '-').toLowerCase()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---------------------------------------------------------------------------
  // View
  // ---------------------------------------------------------------------------

  private rebuild(): void {
    this.needsRebuild = false;
    this.view?.destroy();
    for (const t of this.texts) t.destroy();
    this.texts = [];
    const level = this.doc.level;
    try {
      this.world = new World(level);
    } catch {
      this.world = null;
      this.view = null;
      return;
    }
    this.view = new LevelView(this, this.world, { shake: () => {}, punch: () => {}, flash: () => {} });
    this.view.root.setDepth(0);
    this.fit();
    // Zone labels.
    for (const z of level.zones) {
      this.texts.push(this.add.text((z.x + 0.08) * TILE, (z.y + 0.04) * TILE, z.id, { fontFamily: FONT, fontSize: '13px', color: '#1d6f6a', fontStyle: '700' }).setDepth(21).setResolution(2));
    }
  }

  private fit(): void {
    const level = this.doc.level;
    const vx = LEFT_W, vy = TOP_H, vw = GAME_W - LEFT_W - RIGHT_W, vh = GAME_H - TOP_H;
    const cam = this.cameras.main;
    cam.setViewport(vx, vy, vw, vh);
    this.zoom = Math.min(vw / (level.width * TILE), vh / (level.height * TILE)) * 0.94;
    cam.setZoom(this.zoom);
    cam.centerOn((level.width * TILE) / 2, (level.height * TILE) / 2);
    this.view?.setZoom(this.zoom);
  }

  override update(_time: number, delta: number): void {
    const dt = Math.min(delta, 50) / 1000;
    this.t += dt;
    if (this.needsRebuild) this.rebuild();
    this.view?.render(1, dt);
    this.drawOverlay();
    this.drawHover();
  }

  private cellAt(p: Phaser.Input.Pointer): Pt | null {
    if (p.x < LEFT_W || p.x > GAME_W - RIGHT_W || p.y < TOP_H) return null;
    const wp = this.cameras.main.getWorldPoint(p.x, p.y);
    const x = Math.floor(wp.x / TILE), y = Math.floor(wp.y / TILE);
    const l = this.doc.level;
    if (x < 0 || y < 0 || x >= l.width || y >= l.height) return null;
    return { x, y };
  }

  /** Game-space screen position of a tile centre (for menus). */
  private screenOf(c: Pt): Pt {
    const cam = this.cameras.main;
    return { x: cam.x + ((c.x + 0.5) * TILE - cam.worldView.x) * this.zoom, y: cam.y + ((c.y + 0.5) * TILE - cam.worldView.y) * this.zoom };
  }

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------

  private onDown(p: Phaser.Input.Pointer): void {
    void audio.unlock();
    if (this.ui.closeMenu()) return;
    const c = this.cellAt(p);
    if (!c) return;
    const doc = this.doc;

    if (p.rightButtonDown()) {
      if (this.link) { this.link = null; return; }
      if (this.pickReq) { this.pick(null); return; }
      doc.checkpoint();
      this.drag = { kind: 'erase', last: c };
      if (this.eraseCell(c)) doc.changed(); else this.drag = { kind: 'erase', last: c };
      return;
    }

    if (this.pickReq) {
      const req = this.pickReq;
      if (req.type === 'point') { req.onPick(c); if (!req.repeat) this.pick(null); }
      else this.drag = { kind: 'rect', start: c, cur: c, onPick: req.onPick };
      return;
    }

    switch (this.tool.mode) {
      case 'select': {
        const o = doc.objectAt(c.x, c.y);
        if (o) { this.select({ kind: 'object', id: o.id }); this.drag = { kind: 'move', id: o.id, grab: c, moved: false }; return; }
        const z = doc.zoneAt(c.x, c.y);
        this.select(z ? { kind: 'zone', id: z.id } : null);
        return;
      }
      case 'zone': this.drag = { kind: 'zone', start: c, cur: c }; return;
      case 'link': this.linkClick(c); return;
    }

    if (this.tool.tile) {
      doc.checkpoint();
      this.drag = { kind: 'paint', last: c };
      if (this.paintCell(c)) doc.changed();
      return;
    }
    if (this.tool.make) this.place(c);
  }

  private onMove(p: Phaser.Input.Pointer): void {
    const c = this.cellAt(p);
    this.hover = c;
    const d = this.drag;
    if (!d || !c) return;
    switch (d.kind) {
      case 'paint': case 'erase': {
        let any = false;
        for (const q of line(d.last, c)) any = (d.kind === 'paint' ? this.paintCell(q) : this.eraseCell(q)) || any;
        d.last = c;
        if (any) this.doc.changed();
        break;
      }
      case 'move': {
        const dx = c.x - d.grab.x, dy = c.y - d.grab.y;
        if (!dx && !dy) break;
        if (!d.moved) { this.doc.checkpoint(); d.moved = true; }
        const o = this.doc.byId(d.id);
        if (o) {
          o.x += dx; o.y += dy;
          if (o.type === 'platform') for (const pt of o.path) { pt.x += dx; pt.y += dy; }
          d.grab = c;
          this.doc.changed();
        }
        break;
      }
      case 'zone': case 'rect': d.cur = c; break;
    }
  }

  private onUp(_p: Phaser.Input.Pointer): void {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    if (d.kind === 'zone') {
      const r = rectOf(d.start, d.cur);
      const id = this.doc.newId('z');
      this.doc.edit((l) => { l.zones.push({ id, ...r }); });
      this.select({ kind: 'zone', id });
      this.ui.toast(`Zone ${id}. Now use Link: click it, then a target.`);
    } else if (d.kind === 'rect') {
      d.onPick(rectOf(d.start, d.cur));
      this.pick(null);
    }
  }

  private paintCell(c: Pt): boolean {
    const g = this.tool.tile;
    if (!g) return false;
    // Painting terrain over an object's footprint removes that object (except the spawn).
    let changed = false;
    if (g !== '.') for (const o of [...this.doc.level.objects]) if (o.type !== 'spawn' && o.type !== 'label' && inFoot(o, c)) { this.doc.removeObject(o.id); changed = true; }
    return this.doc.setTile(c.x, c.y, g) || changed;
  }

  private eraseCell(c: Pt): boolean {
    let changed = false;
    const o = this.doc.objectAt(c.x, c.y);
    if (o) { this.doc.removeObject(o.id); changed = true; if (this.selection?.kind === 'object' && this.selection.id === o.id) this.selection = null; }
    else {
      const z = this.doc.zoneAt(c.x, c.y);
      if (z && this.tab === 'events') { this.doc.removeZone(z.id); changed = true; }
      else changed = this.doc.setTile(c.x, c.y, '.');
    }
    return changed;
  }

  private place(c: Pt): void {
    const t = this.tool;
    if (!t.make) return;
    const doc = this.doc;
    const existing = doc.objectAt(c.x, c.y);
    const sameKind = existing && t.make('x', 0, 0).type === existing.type;
    if (sameKind && !t.unique) { this.select({ kind: 'object', id: existing.id }); return; }
    doc.checkpoint();
    let obj: LevelObject;
    if (t.unique) {
      doc.level.objects = doc.level.objects.filter((o) => o.type !== t.make!('x', 0, 0).type);
      obj = t.make('spawn', c.x, c.y);
    } else obj = t.make(doc.newId(t.idPrefix ?? 'o'), c.x, c.y);
    doc.level.objects.push(obj);
    // Objects sit in open air: clear the terrain under their footprint.
    const f = footprint(obj);
    if (obj.type !== 'label') for (let y = f.y; y < f.y + f.h; y++) for (let x = f.x; x < f.x + f.w; x++) doc.setTile(x, y, '.');
    doc.changed();
    this.select({ kind: 'object', id: obj.id });
    audio.play('pop');
  }

  // --- linking ---------------------------------------------------------------

  private linkClick(c: Pt): void {
    const doc = this.doc;
    const o = doc.objectAt(c.x, c.y);
    const z = doc.zoneAt(c.x, c.y);
    const s = this.screenOf(c);
    if (!this.link) {
      const begin = (trigger: Trigger) => { this.link = { trigger, at: c }; this.ui.toast('Now click what should happen (right-click or Esc to finish).'); };
      const items: Array<{ label: string; run: () => void }> = [];
      if (o?.type === 'plate') items.push({ label: 'When pressed', run: () => begin({ type: 'plateDown', plate: o.id }) }, { label: 'When released', run: () => begin({ type: 'plateUp', plate: o.id }) }, { label: 'When Pip stands on it', run: () => begin({ type: 'playerOn', target: o.id }) });
      else if (o && o.type !== 'sign' && o.type !== 'label') items.push({ label: `When Pip stands on ${o.id}`, run: () => begin({ type: 'playerOn', target: o.id }) });
      if (z) items.push({ label: `When Pip enters ${z.id}`, run: () => begin({ type: 'playerEnters', zone: z.id }) }, { label: `When a body enters ${z.id}`, run: () => begin({ type: 'corpseEnters', zone: z.id }) });
      items.push({ label: 'After a timer (1 s)', run: () => begin({ type: 'timer', ticks: 60 }) }, { label: 'When deaths ≥ 1', run: () => begin({ type: 'deathCountAtLeast', n: 1 }) },
        { label: 'When Pip stands on a raft', run: () => begin({ type: 'playerOn', target: '@raft' }) });
      this.ui.showMenu(s.x, s.y, 'Trigger', items);
      return;
    }
    const src = this.link;
    const add = (a: Action) => {
      doc.edit(() => { doc.eventFor(src.trigger).actions.push(a); });
      audio.play('click');
    };
    const items: Array<{ label: string; run: () => void }> = [];
    if (o) {
      for (const [type, tt] of Object.entries(ACTION_TARGET) as Array<[Action['type'], string]>) {
        if (tt !== o.type) continue;
        if (type === 'laser') for (const mode of ['off', 'on', 'blink'] as const) items.push({ label: `Laser ${mode}`, run: () => add({ type: 'laser', target: o.id, mode }) });
        else items.push({ label: ACTION_LABEL[type], run: () => add(defaultAction(type, o.id, c)) });
      }
    }
    for (const type of ['dropTiles', 'removeTiles', 'addTiles', 'moveTiles'] as const) items.push({ label: `${ACTION_LABEL[type]} here`, run: () => add(defaultAction(type, undefined, c)) });
    items.push({ label: 'Set current ← 1.2', run: () => add(defaultAction('setCurrent')) }, { label: 'Screen shake', run: () => add(defaultAction('shake')) }, { label: 'Play sound', run: () => add(defaultAction('sfx')) });
    this.ui.showMenu(s.x, s.y, o ? `Do to ${o.id}` : 'Action', items);
  }

  // --- keys --------------------------------------------------------------------

  private onKey(e: KeyboardEvent): void {
    const tgt = e.target as HTMLElement | null;
    if (tgt && tgt.matches?.('input,textarea,select')) return;
    if (document.querySelector('.dt-modal')) return;
    const k = e.key.toLowerCase();
    const mod = e.ctrlKey || e.metaKey;
    const doc = this.doc;
    if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) doc.redo(); else doc.undo(); return; }
    if (mod && k === 'y') { e.preventDefault(); doc.redo(); return; }
    if (mod && k === 's') { e.preventDefault(); this.save(); return; }
    if (mod) return;
    if (k === 'p') { e.preventDefault(); this.playtest(); return; }
    if (k === 'escape') {
      e.preventDefault();
      if (this.ui.closeMenu()) return;
      if (this.pickReq) { this.pick(null); return; }
      if (this.link) { this.link = null; return; }
      if (this.selection) { this.select(null); return; }
      this.exit();
      return;
    }
    if (k === 'delete' || k === 'backspace') {
      const s = this.selection;
      if (s?.kind === 'object') { doc.edit(() => doc.removeObject(s.id)); this.select(null); }
      if (s?.kind === 'zone') { doc.edit(() => doc.removeZone(s.id)); this.select(null); }
      e.preventDefault();
      return;
    }
    if (k === 'v') { this.setTool(SELECT); return; }
    const tab = TABS.find((t) => t.key === k);
    if (tab) this.setTab(tab.id);
  }

  private validateSelection(): void {
    const s = this.selection;
    if (s?.kind === 'object' && !this.doc.byId(s.id)) this.selection = null;
    if (s?.kind === 'zone' && !this.doc.level.zones.some((z) => z.id === s.id)) this.selection = null;
    if (!findTool(this.tool.id)) this.tool = SELECT;
  }

  // ---------------------------------------------------------------------------
  // Overlays
  // ---------------------------------------------------------------------------

  private drawOverlay(): void {
    const g = this.overlay;
    g.clear();
    const l = this.doc.level;
    const W = l.width * TILE, H = l.height * TILE;
    const lw = 1 / this.zoom;
    // Grid.
    g.lineStyle(lw, C.ink, 0.07);
    for (let x = 0; x <= l.width; x++) g.lineBetween(x * TILE, 0, x * TILE, H);
    for (let y = 0; y <= l.height; y++) g.lineBetween(0, y * TILE, W, y * TILE);
    g.lineStyle(2 * lw, C.ink, 0.35).strokeRect(0, 0, W, H);

    // Secrets the player can't see: fake and troll tiles, pop-ups, droppers, hidden lasers.
    const pulse = 0.55 + Math.sin(this.t * 4) * 0.2;
    for (let y = 0; y < l.height; y++) for (let x = 0; x < l.width; x++) {
      const ch = l.tiles[y]![x];
      if (ch === 'X') this.dashRect(g, x * TILE + 4, y * TILE + 4, TILE - 8, TILE - 8, C.white, pulse, lw * 2);
      if (ch === '=') this.dashRect(g, x * TILE + 4, y * TILE + 4, TILE - 8, TILE - 8, C.gold, pulse, lw * 2);
    }
    for (const o of l.objects) {
      const cx = (o.x + 0.5) * TILE, cy = (o.y + 0.5) * TILE;
      if (o.type === 'popup') { g.lineStyle(2 * lw, C.hazard, pulse); g.strokeTriangle(cx - 12, o.y * TILE + TILE - 4, cx + 12, o.y * TILE + TILE - 4, cx, o.y * TILE + TILE - 22); }
      if (o.type === 'dropper') { g.fillStyle(C.gold, pulse); g.fillTriangle(cx - 7, cy - 2, cx + 7, cy - 2, cx, cy + 9); g.fillRect(cx - 2.5, cy - 11, 5, 9); }
      if (o.type === 'laser' && o.hidden && this.world) {
        const rl = this.world.obj.lasers.find((x) => x.id === o.id);
        if (rl) this.dashRect(g, rl.beam.x / U * TILE, rl.beam.y / U * TILE, rl.beam.w / U * TILE, rl.beam.h / U * TILE, C.laser, pulse, lw * 2);
      }
    }

    // Zones.
    for (const z of l.zones) {
      const sel = this.selection?.kind === 'zone' && this.selection.id === z.id;
      g.fillStyle(C.water, sel ? 0.28 : 0.14).fillRect(z.x * TILE, z.y * TILE, z.w * TILE, z.h * TILE);
      this.dashRect(g, z.x * TILE + 1, z.y * TILE + 1, z.w * TILE - 2, z.h * TILE - 2, C.waterDeep, sel ? 1 : 0.6, lw * 2);
    }

    // Links: plate wiring and events.
    const strong = this.tab === 'events' ? 0.9 : 0.4;
    const center = (id: string): Pt | null => {
      const o = l.objects.find((x) => x.id === id);
      if (!o) return null;
      const f = footprint(o);
      return { x: (f.x + f.w / 2) * TILE, y: (f.y + f.h / 2) * TILE };
    };
    for (const o of l.objects) {
      const plate = (o.type === 'gate' || o.type === 'laser') ? o.plate : undefined;
      if (plate) { const a = center(plate), b = center(o.id); if (a && b) this.dotted(g, a, b, C.plateOn, strong); }
    }
    const spawn = l.objects.find((o) => o.type === 'spawn');
    for (const ev of l.events) {
      const t = ev.trigger;
      let src: Pt | null = null;
      if (t.type === 'playerEnters' || t.type === 'corpseEnters') { const z = l.zones.find((q) => q.id === t.zone); if (z) src = { x: (z.x + z.w / 2) * TILE, y: (z.y + z.h / 2) * TILE }; }
      else if (t.type === 'plateDown' || t.type === 'plateUp') src = center(t.plate);
      else if (t.type === 'playerOn' && !t.target.startsWith('@')) src = center(t.target);
      else if (spawn) src = { x: (spawn.x + 0.5) * TILE, y: (spawn.y + 0.5) * TILE };
      if (!src) continue;
      for (const a of ev.actions) {
        let dst: Pt | null = null;
        if ('target' in a && a.target) dst = center(a.target);
        else if ('rect' in a) dst = { x: (a.rect.x + a.rect.w / 2) * TILE, y: (a.rect.y + a.rect.h / 2) * TILE };
        if ('rect' in a) this.dashRect(g, a.rect.x * TILE + 3, a.rect.y * TILE + 3, a.rect.w * TILE - 6, a.rect.h * TILE - 6, C.hazard, strong, lw * 2);
        if (dst) this.dotted(g, src, dst, C.hazard, strong);
      }
    }

    // Platform paths.
    for (const o of l.objects) if (o.type === 'platform' && o.path.length > 1) {
      for (let i = 1; i < o.path.length; i++) {
        const a = o.path[i - 1]!, b = o.path[i]!;
        this.dotted(g, { x: (a.x + o.w / 2) * TILE, y: (a.y + 0.2) * TILE }, { x: (b.x + o.w / 2) * TILE, y: (b.y + 0.2) * TILE }, C.metal, 0.9);
      }
      for (const p of o.path) g.fillStyle(C.metalDark, 0.9).fillCircle((p.x + o.w / 2) * TILE, (p.y + 0.2) * TILE, 4);
    }

    // Selection.
    const s = this.selection;
    if (s?.kind === 'object') {
      const o = l.objects.find((x) => x.id === s.id);
      if (o) {
        const f = footprint(o);
        const pad = 3 + Math.sin(this.t * 6) * 1.5;
        g.lineStyle(3 * lw, C.gold, 1).strokeRoundedRect(f.x * TILE - pad, f.y * TILE - pad, f.w * TILE + pad * 2, f.h * TILE + pad * 2, 8);
      }
    }

    // Link in progress.
    if (this.link && this.hover) {
      const a = { x: (this.link.at.x + 0.5) * TILE, y: (this.link.at.y + 0.5) * TILE };
      this.dotted(g, a, { x: (this.hover.x + 0.5) * TILE, y: (this.hover.y + 0.5) * TILE }, C.hazard, 1);
      g.fillStyle(C.hazard, 1).fillCircle(a.x, a.y, 6);
    }
  }

  private drawHover(): void {
    const g = this.hoverG;
    g.clear();
    this.hoverText.setVisible(false);
    const d = this.drag;
    if (d && (d.kind === 'zone' || d.kind === 'rect')) {
      const r = rectOf(d.start, d.cur);
      g.fillStyle(d.kind === 'zone' ? C.water : C.hazard, 0.25).fillRect(r.x * TILE, r.y * TILE, r.w * TILE, r.h * TILE);
      g.lineStyle(2 / this.zoom, C.ink, 0.8).strokeRect(r.x * TILE, r.y * TILE, r.w * TILE, r.h * TILE);
      return;
    }
    const c = this.hover;
    if (!c) return;
    let w = 1, h = 1;
    if (this.tool.make && !this.pickReq) {
      const f = footprint(this.tool.make('preview', c.x, c.y));
      w = f.w; h = f.h;
    }
    const col = this.pickReq ? C.hazard : this.tool.tile === '.' ? C.white : C.gold;
    g.fillStyle(col, 0.22).fillRect(c.x * TILE, c.y * TILE, w * TILE, h * TILE);
    g.lineStyle(2 / this.zoom, C.ink, 0.7).strokeRect(c.x * TILE, c.y * TILE, w * TILE, h * TILE);
    if (!this.pickReq && this.tool.mode !== 'select') {
      this.hoverText.setText(this.tool.icon).setPosition((c.x + w / 2) * TILE, (c.y + h / 2) * TILE).setVisible(true);
    }
  }

  private dotted(g: Phaser.GameObjects.Graphics, a: Pt, b: Pt, color: number, alpha: number): void {
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) return;
    const step = 9, dash = 5;
    const off = (this.t * 18) % step;
    g.lineStyle(2.5 / this.zoom, color, alpha);
    for (let s = off; s < len; s += step) {
      const e = Math.min(len, s + dash);
      g.lineBetween(a.x + (dx * s) / len, a.y + (dy * s) / len, a.x + (dx * e) / len, a.y + (dy * e) / len);
    }
    // Arrowhead.
    const ux = dx / len, uy = dy / len;
    g.fillStyle(color, alpha).fillTriangle(b.x, b.y, b.x - ux * 10 - uy * 5, b.y - uy * 10 + ux * 5, b.x - ux * 10 + uy * 5, b.y - uy * 10 - ux * 5);
  }

  private dashRect(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, color: number, alpha: number, lw: number): void {
    g.lineStyle(lw, color, alpha);
    const seg = 6;
    const edge = (x0: number, y0: number, x1: number, y1: number) => {
      const len = Math.hypot(x1 - x0, y1 - y0);
      for (let s = 0; s < len; s += seg * 2) {
        const e = Math.min(len, s + seg);
        g.lineBetween(x0 + ((x1 - x0) * s) / len, y0 + ((y1 - y0) * s) / len, x0 + ((x1 - x0) * e) / len, y0 + ((y1 - y0) * e) / len);
      }
    };
    edge(x, y, x + w, y); edge(x + w, y, x + w, y + h); edge(x + w, y + h, x, y + h); edge(x, y + h, x, y);
  }
}

function inFoot(o: LevelObject, c: Pt): boolean {
  const f = footprint(o);
  return c.x >= f.x && c.x < f.x + f.w && c.y >= f.y && c.y < f.y + f.h;
}

/** Cells on the line between two cells (so fast drags don't leave gaps). */
function line(a: Pt, b: Pt): Pt[] {
  const out: Pt[] = [];
  const n = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  for (let i = 0; i <= n; i++) out.push({ x: Math.round(a.x + ((b.x - a.x) * i) / Math.max(1, n)), y: Math.round(a.y + ((b.y - a.y) * i) / Math.max(1, n)) });
  return out;
}
