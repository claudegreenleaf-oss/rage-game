// The level editor scene. The canvas shows the real game renderer (LevelView) on a live World built from
// the draft, plus editor previews of decor layers and images, and overlays: grid, hidden traps, zones,
// exits, links, lift paths, selection, handles and brush previews. The camera pans and zooms freely.
import Phaser from 'phaser';
import type { Overlay } from '../scenes/Overlay';
import {
  DECOR_IDS, U, decorIndex,
  type Action, type LevelData, type LevelObject, type PixelArt, type Pt, type TileRect, type Trigger,
} from '../sim/types';
import { World } from '../sim/world';
import { cloneLevel, isSolidGlyph, normalizeLevel, validateLevel } from '../sim/level';
import { LevelView } from '../render/level-view';
import { FONT, TILE } from '../render/palette';
import * as LV from '../levels';
import { audio } from '../audio/sfx';
import { music } from '../audio/music';
import type { Backdrop } from '../scenes/Backdrop';
import type { GameData } from '../scenes/Game';
import {
  EditorDoc, MAX_H, MAX_W, MIN_H, MIN_W, blankLevel, flipClip, footprint, inRect, resizeAxes, shift as shiftObj,
  SHARE_WARN_CHARS, type Clip, type GridLayer, type Kind, type LayerId,
} from './model';
import {
  actionSpot, actionsForCell, actionsForObj, actionsGlobal, condRefs, describeAction, makeAction, makeTrigger, nameOf,
  triggerRefs, triggersFor, triggersGlobal, type Spec,
} from './logic';
import {
  BOTTOM_H, EditorUI, GAME_H, GAME_W, LEFT_W, RIGHT_W, TOP_H,
  type EdState, type PickRequest, type Selection, type UiHost,
} from './panels';
import { DECOR, GADGETS, OBJECTS, TERRAIN, TOOLS, ZONES, itemForGlyph, type Item, type ToolId } from './tools';
import { decorCanvas, ensureDecorTextures } from './decor';
import { artCanvas } from './pixelate';
import { setOverrides } from './sfxlab';
import { encodeLevel, shareUrl } from './share';

const T = TILE; // world pixels per tile
const MIN_Z = 0.1, MAX_Z = 10;
/** Colour of the editor canvas around the room. */
const WORKSPACE = 0x1b2127;
const VIEW = { x: LEFT_W, y: TOP_H, w: GAME_W - LEFT_W - RIGHT_W, h: GAME_H - TOP_H - BOTTOM_H };

type Drag =
  | { kind: 'pan'; sx: number; sy: number; scrollX: number; scrollY: number }
  | { kind: 'paint'; last: Pt; erase: boolean }
  | { kind: 'shape'; shape: 'rect' | 'line'; start: Pt; cur: Pt; erase: boolean }
  | { kind: 'move'; sel: NonNullable<Selection>; grab: Pt; moved: boolean; fx?: number; fy?: number }
  | { kind: 'resize'; sel: NonNullable<Selection>; moved: boolean }
  | { kind: 'path'; id: string; index: number; moved: boolean }
  | { kind: 'marquee'; start: Pt; cur: Pt }
  | { kind: 'float'; clip: Clip; grab: Pt; origin: Pt; cur: Pt }
  | { kind: 'zone'; mode: 'zone' | 'exit'; start: Pt; cur: Pt }
  | { kind: 'pickRect'; start: Pt; cur: Pt; onPick: (r: TileRect) => void }
  | { kind: 'room'; w: number; h: number };

interface LinkSource { trigger: Trigger; at: Pt }

const rectOf = (a: Pt, b: Pt): TileRect => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x) + 1, h: Math.abs(a.y - b.y) + 1 });
const LAYER_KEYS: LayerId[] = ['terrain', 'objects', 'bg', 'fg', 'images', 'zones'];
const isGrid = (l: LayerId): l is GridLayer => l === 'terrain' || l === 'bg' || l === 'fg';

/** Every level the editor can start from (shipped chambers, act 4, world rooms, credits). */
function allLevels(): LevelData[] {
  const mod = LV as unknown as Record<string, unknown>;
  const out: LevelData[] = [...((mod.LEVELS as LevelData[] | undefined) ?? [])];
  for (const k of ['ACT4_LEVELS', 'WORLD_LEVELS', 'WORLD_ROOMS', 'ZONES', 'ROOMS']) {
    const v = mod[k];
    if (Array.isArray(v)) for (const l of v as LevelData[]) if (l && l.id && l.tiles && !out.some((o) => o.id === l.id)) out.push(l);
  }
  if (mod.CREDITS_LEVEL) out.push(mod.CREDITS_LEVEL as LevelData);
  return out;
}

export class Editor extends Phaser.Scene implements UiHost {
  doc!: EditorDoc;
  ui!: EditorUI;
  st: EdState = {
    layer: 'terrain', tool: 'brush',
    item: { terrain: TERRAIN[0]!, objects: OBJECTS.find((o) => o.id === 'crate')!, bg: DECOR[0]!, fg: DECOR.find((d) => d.decor === 'vine')!, images: null, zones: ZONES[0]! },
    brush: 1,
    visible: { terrain: true, objects: true, bg: true, fg: true, images: true, zones: true },
    locked: { terrain: false, objects: false, bg: false, fg: false, images: false, zones: false },
    opacity: { terrain: 1, objects: 1, bg: 1, fg: 1, images: 1, zones: 1 },
    grid: true, previewDark: false, selection: null, marquee: null, hasClip: false, rightTab: 'inspect', search: '', focusEvent: null,
  };
  shippedLevels = allLevels().map((l) => ({ id: l.id, name: l.name, act: l.act, kind: l.kind }));

  private world: World | null = null;
  private view: LevelView | null = null;
  private needsRebuild = true;
  private overlay!: Phaser.GameObjects.Graphics;
  private hoverG!: Phaser.GameObjects.Graphics;
  private labels: Phaser.GameObjects.Text[] = [];
  private hoverText!: Phaser.GameObjects.Text;
  private bgImg: Phaser.GameObjects.Image | null = null;
  private fgImg: Phaser.GameObjects.Image | null = null;
  private ghost: Phaser.GameObjects.Image | null = null;
  private artKeys: string[] = [];
  private hover: Pt | null = null;
  private drag: Drag | null = null;
  private pickReq: PickRequest | null = null;
  private link: LinkSource | null = null;
  private clip: Clip | null = null;
  private zoom = 2;
  private space = false;
  private fitted = false;
  private saveTimer = 0;
  private builtSize = '';
  /** Whether the current preview shows the dark room's darkness (rebuild when the toggle flips). */
  private builtDark = false;
  private shadow: Phaser.GameObjects.Graphics | null = null;
  private keyDown = (e: KeyboardEvent) => this.onKey(e);
  private keyUp = (e: KeyboardEvent) => { if (e.code === 'Space') this.space = false; };
  private beforeUnload = () => { if (this.doc?.dirty) this.doc.saveDraft(); };
  private t = 0;
  private lastBuild = 0;

  constructor() { super('Editor'); }

  private openIris(): void {
    const ov = this.scene.get('Overlay') as Overlay | null;
    ov?.irisOpen?.(GAME_W / 2, GAME_H / 2, 450);
  }

  create(): void {
    // Phaser reuses this scene object every time the editor opens: reset everything from the last visit,
    // or the editor keeps the previous (destroyed) preview and shows only the backdrop.
    this.world = null;
    this.view = null;
    this.needsRebuild = true;
    this.labels = [];
    this.bgImg = null; this.fgImg = null; this.ghost = null; this.shadow = null;
    this.artKeys = [];
    this.hover = null; this.drag = null; this.pickReq = null; this.link = null;
    this.fitted = false; this.builtSize = ''; this.builtDark = false;
    this.cursors = null; this.space = false; this.t = 0; this.lastBuild = 0;
    this.st.selection = null; this.st.marquee = null; this.st.focusEvent = null;
    this.doc = new EditorDoc(EditorDoc.loadDraft() ?? blankLevel());
    ensureDecorTextures(this.textures);
    this.overlay = this.add.graphics().setDepth(20);
    this.hoverG = this.add.graphics().setDepth(21);
    this.hoverText = this.add.text(0, 0, '', { fontFamily: FONT, fontSize: '10px', color: '#1c1a24', fontStyle: '700' }).setOrigin(0.5).setDepth(22).setAlpha(0.85).setResolution(8);
    this.ui = new EditorUI(this);
    this.doc.onChange(() => this.onDocChange());
    this.input.mouse?.disableContextMenu();
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.onDown(p));
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.onMove(p));
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => this.onUp(p));
    // Releasing over a panel (or outside the window) still finishes the drag.
    this.input.on('pointerupoutside', (p: Phaser.Input.Pointer) => this.onUp(p));
    this.input.on('wheel', (p: Phaser.Input.Pointer, _o: unknown, dx: number, dy: number) => this.onWheel(p, dx, dy));
    this.input.on('gameout', () => { this.hover = null; });
    this.attach();
    this.events.on('wake', () => { this.attach(); this.ui.setVisible(true); this.needsRebuild = true; this.setMood(); setOverrides(undefined); this.openIris(); });
    // The title (and a finished playtest) close the iris wipe before switching here: open it, or the canvas stays black.
    this.openIris();
    this.events.on('sleep', () => { this.detach(); this.ui.setVisible(false); });
    this.events.once('shutdown', () => {
      this.detach(); this.ui.destroy(); this.view?.destroy(); this.dropArt();
      this.view = null; this.world = null; this.needsRebuild = true;
    });
    this.setMood();
    this.cameras.main.setViewport(VIEW.x, VIEW.y, VIEW.w, VIEW.h);
    this.ui.toast('Welcome to the lab. Everything here is yours to change.');
    this.time.delayedCall(400, () => this.ui.startTips());
  }

  private winUp = () => { if (this.drag) this.onUp(this.input.activePointer); };
  private winMove = (e: PointerEvent) => {
    // Keep dragging while the cursor is over a DOM panel: map the window position into game space.
    if (!this.drag) return;
    const canvas = this.game.canvas.getBoundingClientRect();
    const p = this.input.activePointer;
    p.x = ((e.clientX - canvas.left) / canvas.width) * GAME_W;
    p.y = ((e.clientY - canvas.top) / canvas.height) * GAME_H;
    this.onMove(p);
  };

  private attach(): void {
    window.addEventListener('pointerup', this.winUp);
    window.addEventListener('pointermove', this.winMove);
    window.addEventListener('keydown', this.keyDown, true);
    window.addEventListener('keyup', this.keyUp, true);
    window.addEventListener('beforeunload', this.beforeUnload);
  }
  private detach(): void {
    window.removeEventListener('pointerup', this.winUp);
    window.removeEventListener('pointermove', this.winMove);
    window.removeEventListener('keydown', this.keyDown, true);
    window.removeEventListener('keyup', this.keyUp, true);
    window.removeEventListener('beforeunload', this.beforeUnload);
    this.space = false;
  }

  private setMood(): void {
    const bd = this.scene.get('Backdrop') as Backdrop | undefined;
    (bd as unknown as { setMood?: (n: number) => void } | undefined)?.setMood?.(this.doc.level.biome ?? this.doc.level.act ?? 1);
    music.play(0);
  }

  private onDocChange(): void {
    this.needsRebuild = true;
    this.validateSelection();
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => { if (this.doc.dirty && this.doc.saveDraft()) this.ui.refresh(); }, 1500);
  }

  // ---------------------------------------------------------------------------
  // UiHost
  // ---------------------------------------------------------------------------

  setLayer(l: LayerId): void {
    this.st.layer = l;
    this.st.search = '';
    if (!isGrid(l) && ['rect', 'line', 'fill', 'stamp'].includes(this.st.tool)) this.st.tool = l === 'objects' || l === 'zones' ? 'brush' : 'select';
    if (l === 'images') this.st.tool = 'select';
    this.link = null;
    this.ui.refresh();
  }

  setTool(t: ToolId): void {
    if (t === 'stamp' && !this.clip) { this.ui.toast('Copy a selection first (Select tool, drag, Ctrl+C).'); return; }
    this.st.tool = t;
    this.link = null;
    this.pick(null);
    this.ui.refresh();
  }

  setItem(i: Item): void {
    this.st.item[this.st.layer] = i;
    if (this.st.tool === 'select' || this.st.tool === 'pick' || this.st.tool === 'erase' || this.st.tool === 'stamp') this.st.tool = 'brush';
    this.link = null;
    this.ui.refresh();
  }

  setBrush(n: number): void {
    this.st.brush = Math.max(1, Math.min(9, n));
    this.ui.refresh();
  }

  select(s: Selection): void {
    this.st.selection = s;
    if (s) { this.st.marquee = null; this.st.rightTab = 'inspect'; }
    this.ui.refresh();
  }

  pick(req: PickRequest | null): void {
    this.pickReq = req;
    this.ui.showPick(req);
  }

  playtest(fromCursor = false): void {
    const errs = this.doc.validate();
    if (errs.length) { this.ui.toast(`Can't play yet: ${errs[0]}`); this.st.rightTab = 'level'; this.ui.refresh(); return; }
    this.ui.closeMenu();
    this.ui.closeModal();
    const level = cloneLevel(this.doc.level);
    delete level.verified;
    const at = fromCursor ? this.hover : null;
    if (at) {
      const sp = level.objects.find((o) => o.type === 'spawn');
      if (sp) { sp.x = at.x; sp.y = at.y; }
    }
    const rev = this.doc.rev;
    setOverrides(level.audio?.sfx);
    const data: GameData = {
      level,
      mode: 'playtest',
      onWon: () => { if (!at && this.doc.rev === rev) this.doc.markVerified(); },
      onExit: (r) => {
        this.scene.wake('Editor');
        if (r.won) this.ui.toast(at ? 'Beaten from the cursor. Verify from the spawn (▶ Playtest) to share.' : `Beaten with ${r.deaths} ${r.deaths === 1 ? 'death' : 'deaths'}. Verified: you can share it!`);
      },
    };
    this.scene.sleep();
    this.scene.launch('Game', data);
  }

  share(): void {
    if (!this.doc.level.verified) { this.ui.toast('Beat it in playtest (from the spawn) first.'); return; }
    const url = shareUrl(this.doc.level);
    const big = encodeLevel(this.doc.level).length > SHARE_WARN_CHARS;
    const copy = async () => { try { await navigator.clipboard.writeText(url); return true; } catch { return false; } };
    const wrap = document.createElement('div');
    wrap.className = 'dt-modal';
    wrap.innerHTML = `<div class="dt-card" role="dialog" aria-modal="true"><h2>Share your level</h2><p>Anyone who opens this link plays it straight away.${big ? ' It’s long because of your images; it still works, but some chat apps may cut it.' : ''}</p><textarea readonly spellcheck="false"></textarea><div class="dt-row"><span class="dt-err" style="color:#2b2433"></span><button class="dt-btn ghost" data-a="close">Close</button><button class="dt-btn" data-a="copy">Copy link</button></div></div>`;
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

  newLevel(kind: Kind, w?: number, h?: number): void {
    this.select(null);
    const W = Math.max(MIN_W, Math.min(MAX_W, w ?? (kind === 'zone' ? 80 : 24)));
    const H = Math.max(MIN_H, Math.min(MAX_H, h ?? (kind === 'zone' ? 30 : 12)));
    this.doc.load(blankLevel(W, H, kind));
    this.fitted = false;
    this.ui.toast(`New ${W}×${H} ${kind === 'zone' ? 'zone' : 'room'}. Drag the green corner to resize any time.`);
  }

  startLink(): void {
    this.setLayer('zones');
    const it = ZONES.find((i) => i.mode === 'link');
    if (it) this.setItem(it);
    this.ui.toast('Link: click what starts it (a zone, pad, gadget, any object, or empty floor for timers and buttons).');
  }

  openLevel(which: string): void {
    this.select(null);
    if (which === 'draft') {
      const d = EditorDoc.loadDraft();
      if (d) { this.doc.load(d); this.fitted = false; this.ui.toast('Loaded your saved draft.'); } else this.ui.toast('No saved draft yet.');
      return;
    }
    const l = allLevels().find((x) => x.id === which);
    if (!l) return;
    const copy = cloneLevel(l);
    delete copy.verified;
    this.doc.load(copy);
    this.fitted = false;
    this.ui.toast(`Opened ${l.id} · ${l.name}. Make it yours.`);
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
        this.fitted = false;
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

  zoomBy(f: number, at?: { x: number; y: number }): void {
    const cam = this.cameras.main;
    const sx = at?.x ?? VIEW.x + VIEW.w / 2, sy = at?.y ?? VIEW.y + VIEW.h / 2;
    const before = cam.getWorldPoint(sx, sy);
    this.zoom = Math.max(MIN_Z, Math.min(MAX_Z, this.zoom * f));
    cam.setZoom(this.zoom);
    cam.preRender();
    const after = cam.getWorldPoint(sx, sy);
    cam.scrollX += before.x - after.x;
    cam.scrollY += before.y - after.y;
    this.view?.setZoom(this.zoom);
    this.ui.refresh();
  }

  fit(): void {
    const l = this.doc.level;
    const cam = this.cameras.main;
    this.zoom = Math.max(MIN_Z, Math.min(MAX_Z, Math.min(VIEW.w / (l.width * T), VIEW.h / (l.height * T)) * 0.92));
    cam.setZoom(this.zoom);
    cam.centerOn((l.width * T) / 2, (l.height * T) / 2);
    this.view?.setZoom(this.zoom);
    this.ui.refresh();
  }

  /** Zoom as a percentage of "one tile = 32 screen pixels". */
  zoomPct(): number { return (this.zoom * 100) / 2; }

  centerOn(x: number, y: number): void { this.cameras.main.centerOn(x * T, y * T); }

  viewRect(): TileRect {
    const v = this.cameras.main.worldView;
    return { x: v.x / T, y: v.y / T, w: v.width / T, h: v.height / T };
  }

  toggleGrid(): void { this.st.grid = !this.st.grid; this.ui.toast(this.st.grid ? 'Grid on' : 'Grid off'); }

  private layersMask(): { terrain: boolean; bg: boolean; fg: boolean; objects: boolean } {
    const ok = (l: LayerId) => this.st.visible[l] && !this.st.locked[l];
    return { terrain: ok('terrain'), bg: ok('bg'), fg: ok('fg'), objects: ok('objects') };
  }

  copy(): void {
    const m = this.st.marquee;
    if (!m) { this.ui.toast('Drag a selection with the Select tool first.'); return; }
    this.clip = this.doc.copy(m);
    this.st.hasClip = true;
    this.ui.toast(`Copied ${m.w}×${m.h}. Ctrl+V or the Stamp tool pastes.`);
  }

  cut(): void {
    const m = this.st.marquee;
    if (!m) return;
    this.copy();
    this.doc.edit(() => this.doc.clear(m, this.layersMask()));
  }

  paste(): void {
    if (!this.clip) { this.ui.toast('Nothing copied yet.'); return; }
    this.st.tool = 'stamp';
    this.ui.refresh();
    this.ui.toast('Click to stamp. F flips, Esc stops.');
  }

  flip(axis: 'h' | 'v'): void {
    if (this.st.marquee) {
      const m = this.st.marquee;
      const clip = flipClip(this.doc.copy(m), axis);
      this.doc.edit(() => { this.doc.clear(m, this.layersMask()); this.doc.paste(clip, m.x, m.y, this.layersMask()); });
    } else if (this.clip) this.clip = flipClip(this.clip, axis);
    else return;
    this.ui.toast(axis === 'h' ? 'Flipped ↔' : 'Flipped ↕');
  }

  deleteSelection(): void {
    const s = this.st.selection;
    const d = this.doc;
    if (s?.kind === 'object') d.edit(() => d.removeObject(s.id));
    else if (s?.kind === 'zone') d.edit(() => d.removeZone(s.id));
    else if (s?.kind === 'exit') d.edit(() => d.removeExit(s.id));
    else if (s?.kind === 'image') d.edit(() => d.removeImage(s.id));
    else if (this.st.marquee) { const m = this.st.marquee; d.edit(() => d.clear(m, this.layersMask())); this.st.marquee = null; }
    else if (this.hover) {
      // Nothing selected: delete whatever is under the cursor (an object, exit, zone or image).
      const c = this.hover;
      d.checkpoint();
      if (this.eraseTopmost(c)) d.changed(); else this.ui.toast('Nothing to delete here. Select something, or right-drag to erase tiles.');
    }
    this.select(null);
  }

  addImage(art: PixelArt): void {
    this.doc.edit((l) => { l.images ??= []; l.images.push(art); });
    this.st.layer = 'images';
    this.st.tool = 'select';
    this.select({ kind: 'image', id: art.id });
  }

  // ---------------------------------------------------------------------------
  // View
  // ---------------------------------------------------------------------------

  private rebuild(): void {
    this.needsRebuild = false;
    this.view?.destroy();
    this.view = null;
    for (const t of this.labels) t.destroy();
    this.labels = [];
    const level = this.doc.level;
    // Dark rooms are lit while editing (Layers → Preview → Darkness shows them as players will).
    this.builtDark = !!level.dark && this.st.previewDark;
    const shown = level.dark && !this.builtDark ? { ...level, dark: false } : level;
    try {
      this.world = new World(shown);
      this.world.step(0); // settle once so beams, pads and shutters show their start state
    } catch {
      this.world = null;
    }
    if (this.world) {
      try {
        this.view = new LevelView(this, this.world, { shake: () => {}, punch: () => {}, flash: () => {} });
        this.view.root.setDepth(0);
        this.view.setZoom(this.zoom);
      } catch (e) {
        console.error(e);
        this.view = null;
      }
    }
    this.bakeArt();
    // A neutral workspace around the room: the game's parallax backdrop (which shows through the room's
    // back wall, as in play) would otherwise fill the surround in the room's own colours, so you couldn't
    // tell where the level ends. Plus a soft drop shadow so the room reads as a sheet on the desk.
    this.shadow?.destroy();
    const W = level.width * T, H = level.height * T, F = 1e5;
    this.shadow = this.add.graphics().setDepth(-1);
    this.shadow.fillStyle(WORKSPACE, 1).fillRect(-F, -F, 2 * F + W, F).fillRect(-F, H, 2 * F + W, F).fillRect(-F, 0, F, H).fillRect(W, 0, F, H);
    for (let i = 1; i <= 4; i++) this.shadow.fillStyle(0x000000, 0.14).fillRect(W, i * 2, i * 1.5, H).fillRect(i * 1.5, H, W - i * 1.5, i * 2);
    const size = `${level.width}x${level.height}`;
    if (!this.fitted || size !== this.builtSize) { this.fitted = true; this.builtSize = size; this.fit(); }
    if (level.dark) this.labels.push(this.label(0, -9, this.builtDark ? '☾ dark room (preview)' : '☾ dark room · lit for editing', '#b9c6ff'));
    for (const z of level.zones) this.labels.push(this.label((z.x + 0.08) * T, (z.y + 0.04) * T, z.id, '#1d6f6a'));
    for (const e of level.exits ?? []) this.labels.push(this.label((e.x + 0.08) * T, (e.y + 0.04) * T, `⇥ ${e.to || '?'}`, '#8a5a12'));
  }

  private label(x: number, y: number, s: string, color: string): Phaser.GameObjects.Text {
    return this.add.text(x, y, s, { fontFamily: FONT, fontSize: '6px', color, fontStyle: '700' }).setDepth(21).setResolution(8);
  }

  private dropArt(): void {
    this.bgImg?.destroy(); this.fgImg?.destroy();
    this.bgImg = null; this.fgImg = null;
    for (const k of this.artKeys) if (this.textures.exists(k)) this.textures.remove(k);
    this.artKeys = [];
  }

  /** Editor preview of decor layers and images (skipped if the game renderer draws them itself). */
  private bakeArt(): void {
    this.dropArt();
    const l = this.doc.level;
    if ((this.view as unknown as { drawsCustomArt?: boolean } | null)?.drawsCustomArt) return;
    const W = l.width * T, H = l.height * T;
    const make = (layer: 'bg' | 'fg') => {
      const rows = l.decor?.[layer];
      const imgs = (l.images ?? []).filter((i) => i.layer === layer);
      if (!rows && !imgs.length) return null;
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const g = c.getContext('2d')!;
      g.imageSmoothingEnabled = false;
      for (const im of imgs) {
        g.globalAlpha = im.opacity ?? 1;
        g.drawImage(artCanvas(im), Math.round(im.x * T), Math.round(im.y * T));
      }
      g.globalAlpha = 1;
      if (rows) for (let y = 0; y < l.height; y++) for (let x = 0; x < l.width; x++) {
        const id = DECOR_IDS[decorIndex(rows[y]?.[x] ?? '.')];
        if (id) g.drawImage(decorCanvas(id), x * T, y * T);
      }
      // Background art sits behind solid terrain: punch out the solid cells.
      if (layer === 'bg') for (let y = 0; y < l.height; y++) for (let x = 0; x < l.width; x++) if (isSolidGlyph(l.tiles[y]![x])) g.clearRect(x * T, y * T, T, T);
      const key = `ed_art_${layer}_${this.doc.rev}_${Math.random().toString(36).slice(2, 7)}`;
      this.textures.addCanvas(key, c);
      this.artKeys.push(key);
      return key;
    };
    const bk = make('bg');
    if (bk) {
      this.bgImg = this.add.image(0, 0, bk).setOrigin(0);
      if (this.view) this.view.root.addAt(this.bgImg, 1); // between the baked room and the objects
      else this.bgImg.setDepth(1);
    }
    const fk = make('fg');
    if (fk) this.fgImg = this.add.image(0, 0, fk).setOrigin(0).setDepth(15);
  }

  override update(_time: number, delta: number): void {
    const dt = Math.min(delta, 50) / 1000;
    this.t += dt;
    // Rebuilding the preview re-bakes the whole room: on big rooms, do it at most ~8 times a second mid-stroke.
    const big = this.doc.level.width * this.doc.level.height > 3000;
    const stroking = !!this.drag && (this.drag.kind === 'paint' || this.drag.kind === 'move' || this.drag.kind === 'path' || this.drag.kind === 'resize');
    if ((this.needsRebuild && (!big || !stroking || this.t - this.lastBuild > 0.12)) || (!!this.doc.level.dark && this.st.previewDark) !== this.builtDark) { this.lastBuild = this.t; this.rebuild(); }
    this.view?.render(1, dt);
    const st = this.st;
    if (this.view) this.view.root.setAlpha(st.visible.terrain ? st.opacity.terrain : 0.12);
    if (this.bgImg) this.bgImg.setAlpha(st.visible.bg || st.visible.images ? Math.min(st.opacity.bg, st.opacity.images) : 0);
    if (this.fgImg) this.fgImg.setAlpha(st.visible.fg || st.visible.images ? Math.min(st.opacity.fg, st.opacity.images) : 0);
    this.panKeys(dt);
    this.drawOverlay();
    this.drawHover();
    this.ui.drawMinimap();
  }

  private panKeys(dt: number): void {
    if (this.ui.modalOpen || !this.input.keyboard) return;
    const c = this.cursors ??= this.input.keyboard.createCursorKeys();
    const sp = (520 * dt) / this.zoom;
    const cam = this.cameras.main;
    if (c.left?.isDown) cam.scrollX -= sp;
    if (c.right?.isDown) cam.scrollX += sp;
    if (c.up?.isDown) cam.scrollY -= sp;
    if (c.down?.isDown) cam.scrollY += sp;
  }
  private cursors: Phaser.Types.Input.Keyboard.CursorKeys | null = null;

  private inView(p: Phaser.Input.Pointer): boolean {
    return p.x >= VIEW.x && p.x <= VIEW.x + VIEW.w && p.y >= VIEW.y && p.y <= VIEW.y + VIEW.h;
  }

  private worldAt(p: Phaser.Input.Pointer): Pt {
    const wp = this.cameras.main.getWorldPoint(p.x, p.y);
    return { x: wp.x, y: wp.y };
  }

  private cellAt(p: Phaser.Input.Pointer, clamp = false): Pt | null {
    const w = this.worldAt(p);
    let x = Math.floor(w.x / T), y = Math.floor(w.y / T);
    const l = this.doc.level;
    if (clamp) { x = Math.max(0, Math.min(l.width - 1, x)); y = Math.max(0, Math.min(l.height - 1, y)); }
    if (x < 0 || y < 0 || x >= l.width || y >= l.height) return null;
    return { x, y };
  }

  private screenOf(c: Pt): Pt {
    const cam = this.cameras.main;
    return { x: cam.x + ((c.x + 0.5) * T - cam.worldView.x) * this.zoom, y: cam.y + ((c.y + 0.5) * T - cam.worldView.y) * this.zoom };
  }

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------

  private onWheel(p: Phaser.Input.Pointer, dx: number, dy: number): void {
    if (!this.inView(p) || this.ui.modalOpen) return;
    const ev = p.event as WheelEvent | undefined;
    if (ev?.shiftKey) { this.cameras.main.scrollX += dy / this.zoom; return; }
    if (Math.abs(dx) > Math.abs(dy) * 1.5 && !ev?.ctrlKey) { this.cameras.main.scrollX += dx / this.zoom; return; }
    this.zoomBy(dy > 0 ? 1 / 1.15 : 1.15, { x: p.x, y: p.y });
  }

  private locked(): boolean {
    const l = this.st.layer;
    if (this.st.locked[l]) { this.ui.toast(`That layer is locked. Unlock it in Layers.`); return true; }
    if (!this.st.visible[l]) { this.ui.toast(`That layer is hidden. Show it in Layers.`); return true; }
    return false;
  }

  private onDown(p: Phaser.Input.Pointer): void {
    void audio.unlock();
    if (this.ui.closeMenu()) return;
    if (!this.inView(p) || this.ui.modalOpen) return;
    const st = this.st;
    // Pan: middle button, or Space held.
    if (p.middleButtonDown() || this.space) {
      const cam = this.cameras.main;
      this.drag = { kind: 'pan', sx: p.x, sy: p.y, scrollX: cam.scrollX, scrollY: cam.scrollY };
      return;
    }
    // The room's corner handle (any tool): drag to resize the room.
    {
      const wpx = this.worldAt(p), lv = this.doc.level, grab = (8 / this.zoom) * 1.5 + 3;
      if (p.leftButtonDown() && Math.abs(wpx.x - lv.width * T) <= grab && Math.abs(wpx.y - lv.height * T) <= grab) { this.drag = { kind: 'room', w: lv.width, h: lv.height }; return; }
    }
    const c = this.cellAt(p);
    if (!c) { if (st.tool === 'select') { this.st.marquee = null; this.select(null); } return; }
    const ev = p.event as MouseEvent | undefined;

    if (p.rightButtonDown()) {
      if (this.link) { this.link = null; this.ui.toast('Link finished.'); return; }
      if (this.pickReq) { this.pick(null); return; }
      if (this.locked()) return;
      this.startErase(c);
      return;
    }

    if (this.pickReq) {
      const req = this.pickReq;
      if (req.type === 'point') { req.onPick(c); if (!req.repeat) this.pick(null); }
      else if (req.type === 'rect') this.drag = { kind: 'pickRect', start: c, cur: c, onPick: req.onPick };
      else if (req.type === 'object') {
        const o = this.pickableAt(c, req.accept);
        if (o) { this.pick(null); req.onPick(o.id); audio.play('click'); }
        else { const any = this.doc.objectAt(c.x, c.y); this.ui.toast(any ? `${nameOf(this.doc.level, any.id)} doesn’t fit here. The glowing ones do.` : 'Click one of the glowing objects (Esc cancels).'); }
      } else {
        const z = this.doc.zoneAt(c.x, c.y);
        if (z) { this.pick(null); req.onPick(z.id); audio.play('click'); }
        else this.ui.toast('Click inside a zone (Esc cancels). Draw zones with the Zones layer.');
      }
      return;
    }

    if (ev?.altKey || st.tool === 'pick') { this.eyedrop(c); return; }
    if (st.tool === 'select') { this.selectDown(p, c); return; }
    if (this.locked()) return;
    if (st.tool === 'erase') { this.startErase(c); return; }

    const layer = st.layer;
    const item = st.item[layer];
    if (layer === 'zones') {
      if (!item) return;
      if (item.mode === 'link') { this.linkClick(c); return; }
      this.drag = { kind: 'zone', mode: item.mode === 'exit' ? 'exit' : 'zone', start: c, cur: c };
      return;
    }
    if (layer === 'images') { this.ui.openImageStudio(); return; }
    if (layer === 'objects') { if (item?.make) this.place(c, item); return; }

    // Grid layers.
    if (st.tool === 'stamp' && this.clip) {
      const clip = this.clip;
      this.doc.edit(() => this.doc.paste(clip, c.x, c.y, this.layersMask()));
      return;
    }
    const ch = item?.glyph;
    if (ch === undefined) return;
    if (st.tool === 'fill') {
      this.doc.checkpoint();
      if (this.doc.fill(layer as GridLayer, c.x, c.y, ch)) this.doc.changed(); else this.ui.toast('Already that.');
      return;
    }
    if (st.tool === 'rect' || st.tool === 'line') { this.drag = { kind: 'shape', shape: st.tool, start: c, cur: c, erase: false }; return; }
    this.doc.checkpoint();
    this.drag = { kind: 'paint', last: c, erase: false };
    if (this.paintAt(c, false)) this.doc.changed();
  }

  /** The topmost object at a cell that a pick accepts. */
  private pickableAt(c: Pt, accept: (o: LevelObject) => boolean): LevelObject | undefined {
    const objs = this.doc.level.objects;
    for (let i = objs.length - 1; i >= 0; i--) { const o = objs[i]!; if (accept(o) && inRect(footprint(o), c.x, c.y)) return o; }
    return undefined;
  }

  /** Path points of a lift or gadget, and where their handles sit (world px). */
  private pathOf(o: LevelObject): { pts: Pt[]; handle: (p: Pt) => Pt } | null {
    if (o.type === 'platform') return { pts: o.path, handle: (p) => ({ x: (p.x + o.w / 2) * T, y: (p.y + 0.2) * T }) };
    if (o.type === 'gadget' && o.path?.length) return { pts: o.path, handle: (p) => ({ x: (p.x + o.w / 2) * T, y: (p.y + o.h / 2) * T }) };
    return null;
  }

  private startErase(c: Pt): void {
    const st = this.st;
    if (isGrid(st.layer) && (st.tool === 'rect' || st.tool === 'line')) { this.drag = { kind: 'shape', shape: st.tool, start: c, cur: c, erase: true }; return; }
    this.doc.checkpoint();
    this.drag = { kind: 'paint', last: c, erase: true };
    if (this.paintAt(c, true)) this.doc.changed();
  }

  private selectDown(p: Phaser.Input.Pointer, c: Pt): void {
    const d = this.doc;
    const st = this.st;
    const wpx = this.worldAt(p);
    const grab = (8 / this.zoom) + 2;
    // Handles of the current selection first.
    const sel = st.selection;
    if (sel) {
      const h = this.handleOf(sel);
      if (h && Math.abs(wpx.x - h.x) <= grab && Math.abs(wpx.y - h.y) <= grab) { d.checkpoint(); this.drag = { kind: 'resize', sel, moved: false }; return; }
      if (sel.kind === 'object') {
        const o = d.byId(sel.id);
        const path = o && this.pathOf(o);
        if (o && path) {
          const i = path.pts.findIndex((pt) => { const hp = path.handle(pt); return Math.hypot(hp.x - wpx.x, hp.y - wpx.y) <= grab; });
          if (i >= 0) { d.checkpoint(); this.drag = { kind: 'path', id: o.id, index: i, moved: false }; return; }
        }
      }
    }
    // Drag a tile selection to move it.
    if (st.marquee && inRect(st.marquee, c.x, c.y) && isGrid(st.layer) && !st.locked[st.layer]) {
      const m = st.marquee;
      const clip = d.copy(m);
      d.checkpoint();
      d.clear(m, this.layersMask());
      d.changed();
      this.drag = { kind: 'float', clip, grab: c, origin: { x: m.x, y: m.y }, cur: { x: m.x, y: m.y } };
      return;
    }
    const order: LayerId[] = [st.layer, ...LAYER_KEYS.filter((l) => l !== st.layer)];
    for (const layer of order) {
      if (!st.visible[layer] || st.locked[layer]) continue;
      if (layer === 'objects') {
        const o = d.objectAt(c.x, c.y);
        if (o) { this.select({ kind: 'object', id: o.id }); this.drag = { kind: 'move', sel: { kind: 'object', id: o.id }, grab: c, moved: false }; return; }
      } else if (layer === 'zones') {
        const e = d.exitAt(c.x, c.y);
        if (e) { this.select({ kind: 'exit', id: e.id }); this.drag = { kind: 'move', sel: { kind: 'exit', id: e.id }, grab: c, moved: false }; return; }
        const z = d.zoneAt(c.x, c.y);
        if (z) { this.select({ kind: 'zone', id: z.id }); this.drag = { kind: 'move', sel: { kind: 'zone', id: z.id }, grab: c, moved: false }; return; }
      } else if (layer === 'images') {
        const im = d.imageAt(wpx.x / T, wpx.y / T);
        if (im) { this.select({ kind: 'image', id: im.id }); this.drag = { kind: 'move', sel: { kind: 'image', id: im.id }, grab: c, moved: false, fx: wpx.x - im.x * T, fy: wpx.y - im.y * T }; return; }
      }
      if (layer === st.layer && isGrid(layer)) break; // on a tile layer, empty space starts a marquee
    }
    this.st.marquee = null;
    this.select(null);
    this.drag = { kind: 'marquee', start: c, cur: c };
  }

  private onMove(p: Phaser.Input.Pointer): void {
    const inside = this.inView(p) && !this.ui.modalOpen && !(this.drag && this.drag.kind === 'room');
    this.hover = inside ? this.cellAt(p) : null;
    this.updateStatus();
    const d = this.drag;
    if (!d) return;
    if (d.kind === 'pan') {
      const cam = this.cameras.main;
      cam.scrollX = d.scrollX - (p.x - d.sx) / this.zoom;
      cam.scrollY = d.scrollY - (p.y - d.sy) / this.zoom;
      return;
    }
    if (d.kind === 'room') {
      const w = this.worldAt(p);
      d.w = Math.round(w.x / T); d.h = Math.round(w.y / T);
      return;
    }
    const cc = this.cellAt(p, true);
    if (!cc) return;
    switch (d.kind) {
      case 'paint': {
        let any = false;
        for (const q of line(d.last, cc)) any = this.paintAt(q, d.erase) || any;
        d.last = cc;
        if (any) this.doc.changed();
        break;
      }
      case 'shape': case 'marquee': case 'zone': case 'pickRect': d.cur = cc; break;
      case 'float': d.cur = { x: d.origin.x + cc.x - d.grab.x, y: d.origin.y + cc.y - d.grab.y }; break;
      case 'move': this.moveSel(d, cc, this.worldAt(p)); break;
      case 'resize': this.resizeSel(d, cc); break;
      case 'path': {
        const o = this.doc.byId(d.id);
        const path = o && this.pathOf(o);
        if (!o || !path) break;
        const pt = path.pts[d.index]!;
        const w = (o as { w: number }).w;
        const nx = cc.x - Math.floor(w / 2), ny = o.type === 'gadget' ? cc.y - Math.floor(o.h / 2) : cc.y;
        if (pt.x !== nx || pt.y !== ny) {
          pt.x = nx; pt.y = ny;
          if (d.index === 0) { o.x = nx; o.y = ny; }
          d.moved = true;
          this.doc.changed();
        }
        break;
      }
    }
  }

  private onUp(_p: Phaser.Input.Pointer): void {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    const doc = this.doc;
    switch (d.kind) {
      case 'shape': {
        const layer = this.st.layer as GridLayer;
        const ch = d.erase ? '.' : this.st.item[this.st.layer]?.glyph;
        if (ch === undefined) break;
        doc.checkpoint();
        let n = 0;
        if (d.shape === 'rect') n = doc.rect(layer, rectOf(d.start, d.cur), ch);
        else for (const q of line(d.start, d.cur)) for (const b of this.brushCells(q)) if (doc.setCell(layer, b.x, b.y, ch)) n++;
        if (n) doc.changed();
        break;
      }
      case 'marquee': {
        const r = rectOf(d.start, d.cur);
        if (r.w === 1 && r.h === 1) { this.st.marquee = null; this.ui.refresh(); break; }
        this.st.marquee = r;
        this.st.rightTab = 'inspect';
        this.ui.refresh();
        this.ui.toast(`${r.w}×${r.h} selected. Drag it to move · Ctrl+C copy · Del clear · F flip.`);
        break;
      }
      case 'float': {
        doc.paste(d.clip, d.cur.x, d.cur.y, this.layersMask());
        doc.changed();
        this.st.marquee = { x: d.cur.x, y: d.cur.y, w: d.clip.w, h: d.clip.h };
        this.ui.refresh();
        break;
      }
      case 'zone': {
        const r = rectOf(d.start, d.cur);
        const id = doc.newId(d.mode === 'exit' ? 'exit' : 'z');
        if (d.mode === 'exit') {
          doc.edit((l) => {
            l.exits ??= [];
            l.exits.push({ id, ...r, to: '', toExit: '' });
            // Open the wall where the exit is so Pip can walk through.
            for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (x === 0 || y === 0 || x === l.width - 1 || y === l.height - 1) doc.setTile(x, y, '.');
          });
          this.select({ kind: 'exit', id });
          this.ui.toast('Exit added. Set the room it leads to in the inspector.');
        } else {
          doc.edit((l) => { l.zones.push({ id, ...r }); });
          this.select({ kind: 'zone', id });
          this.ui.toast(`Zone ${id}. Now pick Link: click the zone, then a target.`);
        }
        break;
      }
      case 'pickRect': d.onPick(rectOf(d.start, d.cur)); this.pick(null); break;
      case 'room': {
        const before = `${doc.level.width}x${doc.level.height}`;
        doc.resize(d.w, d.h);
        const after = `${doc.level.width}x${doc.level.height}`;
        this.builtSize = after; // keep the camera where it is
        if (before !== after) this.ui.toast(`Room is now ${doc.level.width}×${doc.level.height}.`);
        break;
      }
      default: break;
    }
  }

  private brushCells(c: Pt): Pt[] {
    const n = this.st.brush;
    if (n <= 1) return [c];
    const out: Pt[] = [];
    const o = Math.floor((n - 1) / 2);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) out.push({ x: c.x - o + x, y: c.y - o + y });
    return out;
  }

  private eraseTopmost(c: Pt): boolean {
    const st = this.st;
    const doc = this.doc;
    const ok = (l: 'objects' | 'zones' | 'images') => st.visible[l] && !st.locked[l];
    if (ok('objects')) {
      const o = doc.objectAt(c.x, c.y);
      if (o) {
        doc.removeObject(o.id);
        if (o.type === 'spawn') this.ui.toast('Spawn removed. Place a new one before playtesting.');
        return true;
      }
    }
    if (ok('zones')) {
      const e = doc.exitAt(c.x, c.y);
      if (e) { doc.removeExit(e.id); return true; }
      const z = doc.zoneAt(c.x, c.y);
      if (z) { doc.removeZone(z.id); return true; }
    }
    if (ok('images')) {
      const im = doc.imageAt(c.x + 0.5, c.y + 0.5);
      if (im) { doc.removeImage(im.id); return true; }
    }
    return false;
  }

  /** Paint or erase one brush stamp on the active layer. */
  private paintAt(c: Pt, erase: boolean): boolean {
    const st = this.st;
    const doc = this.doc;
    const layer = st.layer;
    // Erasing takes whatever is on top at that spot first (vines, the spawn, any object, exits,
    // zones, images), from any visible and unlocked layer, before touching the active layer's tiles.
    if (erase && this.eraseTopmost(c)) return true;
    if (isGrid(layer)) {
      const ch = erase ? '.' : st.item[layer]?.glyph;
      if (ch === undefined) return false;
      let any = false;
      for (const b of this.brushCells(c)) {
        if (layer === 'terrain' && !erase && ch !== '.')
          for (const o of [...doc.level.objects]) if (o.type !== 'spawn' && o.type !== 'label' && o.type !== 'vine' && o.type !== 'light' && inRect(footprint(o), b.x, b.y)) { doc.removeObject(o.id); any = true; }
        any = doc.setCell(layer, b.x, b.y, ch) || any;
      }
      return any;
    }
    if (!erase) return false;
    if (layer === 'objects') {
      const o = doc.objectAt(c.x, c.y);
      if (o) { doc.removeObject(o.id); return true; }
    } else if (layer === 'zones') {
      const e = doc.exitAt(c.x, c.y);
      if (e) { doc.removeExit(e.id); return true; }
      const z = doc.zoneAt(c.x, c.y);
      if (z) { doc.removeZone(z.id); return true; }
    } else if (layer === 'images') {
      const im = doc.imageAt(c.x + 0.5, c.y + 0.5);
      if (im) { doc.removeImage(im.id); return true; }
    }
    return false;
  }

  private eyedrop(c: Pt): void {
    const st = this.st;
    const d = this.doc;
    if (isGrid(st.layer)) {
      const it = itemForGlyph(st.layer, d.cell(st.layer, c.x, c.y));
      if (it) { st.item[st.layer] = it; st.tool = 'brush'; this.ui.refresh(); this.ui.toast(`Picked ${it.label}`); }
      return;
    }
    if (st.layer === 'objects') {
      const o = d.objectAt(c.x, c.y);
      const it = o && OBJECTS.find((i) => {
        const m = i.make?.('x', 0, 0) as (LevelObject & { runaway?: boolean; need?: number; kind?: string }) | undefined;
        if (!m || m.type !== o.type) return false;
        if (o.type === 'door') return !!m.runaway === !!o.runaway;
        if (o.type === 'plate') return m.need === o.need;
        if (o.type === 'relic') return m.kind === o.kind;
        return true;
      });
      if (it && o?.type !== 'gadget') { st.item.objects = it; st.tool = 'brush'; this.ui.refresh(); this.ui.toast(`Picked ${it.label}`); return; }
      if (o) {
        // Anything else (gadgets especially): the eyedropper copies it exactly, so you can paint more of it.
        const proto = JSON.parse(JSON.stringify(o)) as LevelObject;
        const name = o.type === 'gadget' ? o.name || 'Gadget' : o.type;
        const clone: Item = { id: `clone_${o.id}`, label: `${name} (copy)`, icon: GADGETS.find((g) => g.label === name)?.icon ?? '✚', hint: `Paints copies of ${o.id}.`, idPrefix: o.id.replace(/\d+$/, '') || 'o',
          make: (id, x, y) => { const c2 = JSON.parse(JSON.stringify(proto)) as LevelObject; c2.id = id; return shiftObj(c2, x - Math.floor(proto.x), y - Math.floor(proto.y)); } };
        st.item.objects = clone; st.tool = 'brush'; this.ui.refresh(); this.ui.toast(`Copied ${name}: click to place more`);
      }
    }
  }

  private place(c: Pt, it: Item): void {
    const doc = this.doc;
    if (!it.make) return;
    const proto = it.make('x', 0, 0);
    const existing = doc.objectAt(c.x, c.y);
    if (existing && existing.type === proto.type && !it.unique) { this.select({ kind: 'object', id: existing.id }); return; }
    doc.checkpoint();
    let obj: LevelObject;
    if (it.unique) {
      doc.level.objects = doc.level.objects.filter((o) => o.type !== proto.type);
      obj = it.make('spawn', c.x, c.y);
    } else obj = it.make(doc.newId(it.idPrefix ?? 'o'), c.x, c.y);
    doc.level.objects.push(obj);
    if (obj.type === 'gadget') {
      // Keep fields inside the room, create the counters coins and keys use, and clear the clicked tile only
      // (a fan or a field may overlap walls on purpose).
      const g = obj;
      const dy = Math.max(0, -g.y), dx = Math.max(0, -g.x);
      if (dx || dy) { g.x += dx; g.y += dy; if (g.path) g.path = g.path.map((p) => ({ x: p.x + dx, y: p.y + dy })); }
      if (g.effect.kind === 'collect' && g.effect.var) { const n = g.effect.var; doc.ensureVar(n, n[0]!.toUpperCase() + n.slice(1)); }
      if (g.when?.type === 'var') doc.ensureVar(g.when.name, g.when.name[0]!.toUpperCase() + g.when.name.slice(1));
      if (isSolidGlyph(doc.tile(c.x, c.y))) doc.setTile(c.x, c.y, '.');
      doc.changed();
      this.select({ kind: 'object', id: obj.id });
      audio.play('pop');
      return;
    }
    // Objects sit in open air: clear the terrain under their footprint (a vine hangs from its own tile).
    if (obj.type === 'vine') {
      if (!isSolidGlyph(doc.tile(c.x, c.y)) && c.y > 0 && isSolidGlyph(doc.tile(c.x, c.y - 1))) obj.y = c.y - 1;
    } else if (obj.type !== 'label' && obj.type !== 'light') {
      const f = footprint(obj);
      for (let y = f.y; y < f.y + f.h; y++) for (let x = f.x; x < f.x + f.w; x++) doc.setTile(x, y, '.');
    }
    doc.changed();
    this.select({ kind: 'object', id: obj.id });
    audio.play('pop');
  }

  private moveSel(d: Extract<Drag, { kind: 'move' }>, c: Pt, wpx: Pt): void {
    const doc = this.doc;
    const s = d.sel;
    if (s.kind === 'image') {
      const im = (doc.level.images ?? []).find((x) => x.id === s.id);
      if (!im) return;
      const nx = Math.round(wpx.x - (d.fx ?? 0)) / T, ny = Math.round(wpx.y - (d.fy ?? 0)) / T;
      if (nx === im.x && ny === im.y) return;
      if (!d.moved) { doc.checkpoint(); d.moved = true; }
      im.x = nx; im.y = ny;
      doc.changed();
      return;
    }
    const dx = c.x - d.grab.x, dy = c.y - d.grab.y;
    if (!dx && !dy) return;
    if (!d.moved) { doc.checkpoint(); d.moved = true; }
    d.grab = c;
    if (s.kind === 'object') {
      const o = doc.byId(s.id);
      if (!o) return;
      o.x += dx; o.y += dy;
      if (o.type === 'platform') for (const pt of o.path) { pt.x += dx; pt.y += dy; }
      if (o.type === 'gadget' && o.path) for (const pt of o.path) { pt.x += dx; pt.y += dy; }
    } else if (s.kind === 'zone') {
      const z = doc.level.zones.find((x) => x.id === s.id);
      if (z) { z.x += dx; z.y += dy; }
    } else if (s.kind === 'exit') {
      const e = (doc.level.exits ?? []).find((x) => x.id === s.id);
      if (e) { e.x += dx; e.y += dy; }
    }
    doc.changed();
  }

  /** Where the resize handle of a selection is (world px), if it has one. */
  private handleOf(s: NonNullable<Selection>): Pt | null {
    const doc = this.doc;
    if (s.kind === 'object') {
      const o = doc.byId(s.id);
      if (!o) return null;
      const ax = resizeAxes(o);
      if (!ax.w && !ax.h) return null;
      const f = footprint(o);
      return { x: (f.x + f.w) * T, y: (f.y + f.h) * T };
    }
    if (s.kind === 'zone') { const z = doc.level.zones.find((x) => x.id === s.id); return z ? { x: (z.x + z.w) * T, y: (z.y + z.h) * T } : null; }
    if (s.kind === 'exit') { const e = (doc.level.exits ?? []).find((x) => x.id === s.id); return e ? { x: (e.x + e.w) * T, y: (e.y + e.h) * T } : null; }
    return null;
  }

  private resizeSel(d: Extract<Drag, { kind: 'resize' }>, c: Pt): void {
    const doc = this.doc;
    const s = d.sel;
    let changed = false;
    if (s.kind === 'object') {
      const o = doc.byId(s.id);
      if (!o) return;
      const rec = o as unknown as Record<string, number>;
      const ax = resizeAxes(o);
      const f = footprint(o);
      if (ax.w) { const nw = Math.max(1, c.x - f.x + 1); if (rec[ax.w] !== nw) { rec[ax.w] = nw; changed = true; } }
      if (ax.h) { const nh = Math.max(1, c.y - f.y + (o.type === 'vine' ? 0 : 1)); if (rec[ax.h] !== nh) { rec[ax.h] = nh; changed = true; } }
    } else {
      const r = s.kind === 'zone' ? doc.level.zones.find((x) => x.id === s.id) : (doc.level.exits ?? []).find((x) => x.id === s.id);
      if (!r) return;
      const nw = Math.max(1, c.x - r.x + 1), nh = Math.max(1, c.y - r.y + 1);
      if (r.w !== nw || r.h !== nh) { r.w = nw; r.h = nh; changed = true; }
    }
    if (changed) { d.moved = true; doc.changed(); }
  }

  // --- linking ---------------------------------------------------------------

  /** Link tool: first click picks what starts it ("When…"), every later click adds what happens ("Then…"). */
  private linkClick(c: Pt): void {
    const doc = this.doc;
    const l = doc.level;
    const o = doc.objectAt(c.x, c.y);
    const z = doc.zoneAt(c.x, c.y);
    const s = this.screenOf(c);
    type MenuItem = { label: string; run: () => void };
    if (!this.link) {
      const begin = (trigger: Trigger) => {
        this.link = { trigger, at: c };
        this.ui.toast('Now click what should happen: an object, or tiles. Keep clicking to add more. Right-click or Esc when done.');
      };
      const items: MenuItem[] = [];
      const named = (sp: Spec, what: string) => sp.label.replace('…', ` ${what}`).replace('a zone', what).replace('Pad / sensor', what);
      if (o) for (const sp of triggersFor({ obj: o })) items.push({ label: named(sp, nameOf(l, o.id)), run: () => begin(makeTrigger(sp.type, { level: l, target: o.id })) });
      if (z) for (const sp of triggersFor({ zone: z })) items.push({ label: named(sp, z.id), run: () => begin(makeTrigger(sp.type, { level: l, target: z.id })) });
      if (!o && !z) items.push({ label: '⬚ Pip walks here (makes a zone)', run: () => {
        const id = doc.newId('z');
        doc.edit((lv) => { lv.zones.push({ id, x: c.x, y: Math.max(0, c.y - 1), w: 2, h: 2 }); });
        begin(makeTrigger('playerEnters', { level: doc.level, target: id }));
      } });
      for (const sp of triggersGlobal()) items.push({ label: sp.label, run: () => begin(makeTrigger(sp.type, { level: l })) });
      this.ui.showMenu(s.x, s.y, o ? `When… (${nameOf(l, o.id)})` : z ? `When… (${z.id})` : 'When…', items);
      return;
    }
    const src = this.link;
    const add = (a: Action) => {
      doc.edit(() => { doc.eventFor(src.trigger).actions.push(a); });
      audio.play('click');
      this.ui.toast(`Added: ${describeAction(doc.level, a)}. Click more, or right-click to finish.`);
    };
    const items: MenuItem[] = [];
    if (o) {
      for (const sp of actionsForObj(o)) {
        if (sp.type === 'laser') for (const mode of ['off', 'on', 'blink'] as const) items.push({ label: `Laser ${mode}`, run: () => add({ type: 'laser', target: o.id, mode }) });
        else if (sp.type === 'gadget') for (const [op, lab] of [['on', 'Turn on'], ['off', 'Turn off'], ['toggle', 'Toggle on/off'], ['start', 'Start moving'], ['stop', 'Stop moving'], ['reverse', 'Reverse']] as const) items.push({ label: lab, run: () => add({ type: 'gadget', target: o.id, op }) });
        else items.push({ label: sp.label, run: () => add(makeAction(sp.type, { level: l, target: o.id, cell: c })) });
      }
    }
    for (const sp of actionsForCell()) items.push({ label: `${sp.label} here`, run: () => add(makeAction(sp.type, { level: l, cell: c })) });
    for (const sp of actionsGlobal()) items.push({ label: sp.label, run: () => add(makeAction(sp.type, { level: l, cell: c })) });
    this.ui.showMenu(s.x, s.y, o ? `Then, to ${nameOf(l, o.id)}…` : 'Then…', items);
  }

  // --- keys --------------------------------------------------------------------

  private onKey(e: KeyboardEvent): void {
    const tgt = e.target as HTMLElement | null;
    if (tgt && tgt.matches?.('input,textarea,select')) return;
    if (document.querySelector('.dt-modal')) return;
    const k = e.key.toLowerCase();
    const mod = e.ctrlKey || e.metaKey;
    if (this.ui.modalOpen) { if (k === 'escape') { e.preventDefault(); this.ui.closeModal(); } return; }
    const doc = this.doc;
    if (e.code === 'Space') { this.space = true; e.preventDefault(); return; }
    if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) doc.redo(); else doc.undo(); return; }
    if (mod && k === 'y') { e.preventDefault(); doc.redo(); return; }
    if (mod && k === 's') { e.preventDefault(); this.save(); return; }
    if (mod && k === 'k') { e.preventDefault(); this.ui.openCommands(); return; }
    if (mod && k === 'c') { e.preventDefault(); this.copy(); return; }
    if (mod && k === 'x') { e.preventDefault(); this.cut(); return; }
    if (mod && k === 'v') { e.preventDefault(); this.paste(); return; }
    if (mod && k === 'a') { e.preventDefault(); this.st.marquee = { x: 0, y: 0, w: doc.level.width, h: doc.level.height }; this.st.tool = 'select'; this.ui.refresh(); return; }
    if (mod) return;
    if (k === 'p') { e.preventDefault(); this.playtest(!e.shiftKey); return; }
    if (k === 'escape') {
      e.preventDefault();
      if (this.ui.closeMenu()) return;
      if (this.pickReq) { this.pick(null); return; }
      if (this.link) { this.link = null; return; }
      if (this.st.tool === 'stamp') { this.setTool('brush'); return; }
      if (this.st.selection || this.st.marquee) { this.st.marquee = null; this.select(null); return; }
      this.exit();
      return;
    }
    if (k === 'delete' || k === 'backspace') { e.preventDefault(); this.deleteSelection(); return; }
    if (k === '[') { this.setBrush(this.st.brush - 1); return; }
    if (k === ']') { this.setBrush(this.st.brush + 1); return; }
    if (k === '0') { this.fit(); return; }
    if (k === '=' || k === '+') { this.zoomBy(1.25); return; }
    if (k === '-' || k === '_') { this.zoomBy(1 / 1.25); return; }
    if (k === '#' || k === "'") { this.toggleGrid(); return; }
    if (k === 'f') { this.flip(e.shiftKey ? 'v' : 'h'); return; }
    const tool = TOOLS.find((t) => t.key.toLowerCase() === k);
    if (tool) { this.setTool(tool.id); return; }
    const n = Number(k);
    if (n >= 1 && n <= 6) this.setLayer(LAYER_KEYS[n - 1]!);
  }

  private validateSelection(): void {
    const s = this.st.selection;
    const d = this.doc;
    if (s?.kind === 'object' && !d.byId(s.id)) this.st.selection = null;
    if (s?.kind === 'zone' && !d.level.zones.some((z) => z.id === s.id)) this.st.selection = null;
    if (s?.kind === 'exit' && !(d.level.exits ?? []).some((z) => z.id === s.id)) this.st.selection = null;
    if (s?.kind === 'image' && !(d.level.images ?? []).some((z) => z.id === s.id)) this.st.selection = null;
    if (this.st.marquee) {
      const m = this.st.marquee;
      if (m.x >= d.level.width || m.y >= d.level.height) this.st.marquee = null;
    }
  }

  private updateStatus(): void {
    const c = this.hover;
    if (!c) { this.ui.setStatus(this.space ? 'Panning: drag' : 'Wheel zooms · Space-drag or middle-drag pans · Ctrl+K for everything'); return; }
    const d = this.doc;
    const o = d.objectAt(c.x, c.y);
    const t = TERRAIN.find((i) => i.glyph === d.tile(c.x, c.y))?.label ?? '';
    const bg = DECOR.find((i) => i.glyph === d.cell('bg', c.x, c.y));
    const z = d.zoneAt(c.x, c.y);
    this.ui.setStatus(`x ${c.x}, y ${c.y} · ${t}${o ? ` · ${nameOf(d.level, o.id)}` : ''}${z ? ` · zone ${z.id}` : ''}${bg ? ` · bg: ${bg.label}` : ''}`);
  }

  // ---------------------------------------------------------------------------
  // Overlays
  // ---------------------------------------------------------------------------

  private drawOverlay(): void {
    const g = this.overlay;
    g.clear();
    const st = this.st;
    const l = this.doc.level;
    const W = l.width * T, H = l.height * T;
    const lw = 1 / this.zoom;
    const v = this.cameras.main.worldView;
    const x0 = Math.max(0, Math.floor(v.x / T)), x1 = Math.min(l.width - 1, Math.ceil((v.x + v.width) / T));
    const y0 = Math.max(0, Math.floor(v.y / T)), y1 = Math.min(l.height - 1, Math.ceil((v.y + v.height) / T));
    if (st.grid && this.zoom * T >= 6) {
      g.lineStyle(lw, 0xffffff, 0.09);
      for (let x = x0; x <= x1 + 1; x++) g.lineBetween(x * T, y0 * T, x * T, (y1 + 1) * T);
      for (let y = y0; y <= y1 + 1; y++) g.lineBetween(x0 * T, y * T, (x1 + 1) * T, y * T);
    }
    g.lineStyle(2 * lw, 0x5bf0a0, 0.6).strokeRect(0, 0, W, H);
    {
      const hs = (6 / this.zoom) * 1.4;
      g.fillStyle(0x5bf0a0, 0.95).fillTriangle(W + hs, H + hs, W + hs, H - hs, W - hs, H + hs);
    }

    const pulse = 0.55 + Math.sin(this.t * 4) * 0.2;
    if (st.visible.objects) {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const ch = l.tiles[y]![x];
        if (ch === 'X') this.dashRect(g, x * T + 2, y * T + 2, T - 4, T - 4, 0xffffff, pulse, lw * 1.5);
        else if (ch === '=') this.dashRect(g, x * T + 2, y * T + 2, T - 4, T - 4, 0xf2b544, pulse, lw * 1.5);
        else if (ch === '%') this.dashRect(g, x * T + 2, y * T + 2, T - 4, T - 4, 0xc08a5a, pulse, lw * 1.5);
      }
      for (const o of l.objects) {
        const cx = (o.x + 0.5) * T, cy = (o.y + 0.5) * T;
        switch (o.type) {
          case 'popup': g.lineStyle(1.5 * lw, 0xe0564f, pulse).strokeTriangle(cx - 5, o.y * T + T - 2, cx + 5, o.y * T + T - 2, cx, o.y * T + T - 10); break;
          case 'dropper': g.fillStyle(0xf2b544, pulse).fillTriangle(cx - 3, cy - 1, cx + 3, cy - 1, cx, cy + 4).fillRect(cx - 1, cy - 5, 2, 4); break;
          case 'vine': {
            g.lineStyle(Math.max(1, 2 * lw), 0x5e9a3a, 0.9);
            const len = o.len * T;
            for (let i = 0; i < len; i += 2) {
              const sx = cx + Math.sin((i + this.t * 20) * 0.08) * 1.5;
              g.lineBetween(sx, (o.y + 1) * T + i, sx, (o.y + 1) * T + i + 1.5);
            }
            g.fillStyle(0x8cc455, 0.9).fillCircle(cx, (o.y + 1) * T + len, 1.8);
            break;
          }
          case 'light': {
            const col = Phaser.Display.Color.HexStringToColor(o.color ?? '#ffe9a6').color;
            // The radius only for the selected light: a zone full of lamps would drown in circles.
            if (st.selection?.kind === 'object' && st.selection.id === o.id) {
              g.fillStyle(col, o.flicker ? 0.06 + Math.random() * 0.05 : 0.08).fillCircle(cx, cy, (o.radius ?? 4) * T);
              g.lineStyle(lw, col, 0.5).strokeCircle(cx, cy, (o.radius ?? 4) * T);
            }
            g.lineStyle(lw, col, 0.8).strokeCircle(cx, cy, 4.5);
            g.fillStyle(col, 1).fillCircle(cx, cy, 2.5);
            break;
          }
          case 'bench': g.lineStyle(1.5 * lw, 0x5bf0a0, 0.95).strokeRect(o.x * T + 2, o.y * T + 2, T - 4, T - 4).fillStyle(0x5bf0a0, 0.95).fillTriangle(cx - 2, cy - 4, cx - 2, cy + 1, cx + 4, cy - 1.5); break;
          case 'relic': g.fillStyle(o.kind === 'note' ? 0xe8dcc0 : 0x7fd0d0, 0.95).fillRect(cx - 3, cy - 4, 6, 8).lineStyle(lw, 0x1c1a24, 1).strokeRect(cx - 3, cy - 4, 6, 8); break;
          case 'sensor': {
            g.lineStyle(1.5 * lw, 0xffe9a6, 0.5 + pulse * 0.4).strokeCircle(cx, cy, 6.5);
            for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 + this.t * 0.6; g.lineBetween(cx + Math.cos(a) * 8, cy + Math.sin(a) * 8, cx + Math.cos(a) * 10, cy + Math.sin(a) * 10); }
            break;
          }
          case 'crate': g.lineStyle(1.5 * lw, 0xb07a45, 0.6).strokeRect(o.x * T + 1, o.y * T + 1, T - 2, T - 2); break;
          case 'laser':
            if (o.hidden && this.world) {
              const rl = this.world.obj.lasers.find((x) => x.id === o.id);
              if (rl) this.dashRect(g, (rl.beam.x / U) * T, (rl.beam.y / U) * T, (rl.beam.w / U) * T, (rl.beam.h / U) * T, 0xff3fa4, pulse, lw * 1.5);
            }
            break;
          default: break;
        }
      }
    }

    if (st.visible.zones) {
      for (const z of l.zones) {
        const sel = st.selection?.kind === 'zone' && st.selection.id === z.id;
        g.fillStyle(0x3fb8b0, (sel ? 0.28 : 0.14) * st.opacity.zones).fillRect(z.x * T, z.y * T, z.w * T, z.h * T);
        this.dashRect(g, z.x * T + 0.5, z.y * T + 0.5, z.w * T - 1, z.h * T - 1, 0x23848a, sel ? 1 : 0.6, lw * 1.5);
      }
      for (const e of l.exits ?? []) {
        const sel = st.selection?.kind === 'exit' && st.selection.id === e.id;
        g.fillStyle(0xf2b544, (sel ? 0.3 : 0.16) * st.opacity.zones).fillRect(e.x * T, e.y * T, e.w * T, e.h * T);
        this.dashRect(g, e.x * T + 0.5, e.y * T + 0.5, e.w * T - 1, e.h * T - 1, 0xc08a12, sel ? 1 : 0.7, lw * 1.5);
      }
    }

    // Wiring: pads to shutters, lasers and gadgets; every event from its trigger to what it does.
    const strong = st.layer === 'zones' ? 0.9 : 0.35;
    const center = (id: string): Pt | null => {
      const o = l.objects.find((x) => x.id === id);
      if (o) { const f = o.type === 'gadget' ? { x: o.x, y: o.y, w: o.w, h: o.h } : footprint(o); return { x: (f.x + f.w / 2) * T, y: (f.y + f.h / 2) * T }; }
      const z = l.zones.find((q) => q.id === id);
      return z ? { x: (z.x + z.w / 2) * T, y: (z.y + z.h / 2) * T } : null;
    };
    for (const o of l.objects) {
      const plate = (o.type === 'gate' || o.type === 'laser') ? o.plate : o.type === 'gadget' ? o.link : undefined;
      if (plate) { const a = center(plate), b = center(o.id); if (a && b) this.dotted(g, a, b, 0x7fd38e, strong); }
      if (o.type === 'gadget' && o.when) for (const r of condRefs(o.when)) { const a = center(r.id), b = center(o.id); if (a && b) this.dotted(g, a, b, 0x7fd38e, strong); }
    }
    const spawn = l.objects.find((o) => o.type === 'spawn');
    const focus = st.focusEvent;
    l.events.forEach((ev, i) => {
      const on = focus === i;
      if (focus !== null && !on) return; // hovering an event: show only its wiring
      const alpha = on ? 1 : ev.enabled === false ? 0.12 : strong;
      const col = on ? 0xffa23a : 0xe0564f;
      const tref = triggerRefs(ev.trigger)[0];
      let src: Pt | null = tref ? center(tref.id) : null;
      if (!src && !tref && spawn) src = { x: (spawn.x + 0.5) * T, y: (spawn.y + 0.5) * T };
      if (!src) return;
      if (on) g.lineStyle(2.5 / this.zoom, col, 1).strokeCircle(src.x, src.y, 7);
      for (const c of ev.if ?? []) for (const r of condRefs(c)) { const p = center(r.id); if (p) this.dotted(g, p, src, 0x7fd38e, alpha); }
      for (const a of ev.actions) {
        const spot = actionSpot(a);
        let dst: Pt | null = null;
        if (spot.id) dst = center(spot.id);
        else if (spot.rect) {
          const r = spot.rect;
          dst = { x: (r.x + r.w / 2) * T, y: (r.y + r.h / 2) * T };
          this.dashRect(g, r.x * T + 1.5, r.y * T + 1.5, r.w * T - 3, r.h * T - 3, col, alpha, lw * 1.5);
        } else if (spot.at) {
          dst = { x: (spot.at.x + 0.5) * T, y: (spot.at.y + 0.5) * T };
          g.lineStyle(1.5 / this.zoom + 0.5, col, alpha).strokeCircle(dst.x, dst.y, 4).lineBetween(dst.x - 6, dst.y, dst.x + 6, dst.y).lineBetween(dst.x, dst.y - 6, dst.x, dst.y + 6);
        }
        if (dst) this.dotted(g, src, dst, col, alpha);
        if (on && dst) g.lineStyle(2 / this.zoom, col, 1).strokeCircle(dst.x, dst.y, 6);
      }
    });

    // Paths (lifts and gadgets) with draggable handles; teleport destinations; invisible gadgets.
    for (const o of l.objects) {
      const path = this.pathOf(o);
      const sel = st.selection?.kind === 'object' && st.selection.id === o.id;
      if (path && path.pts.length) {
        for (let i = 1; i < path.pts.length; i++) this.dotted(g, path.handle(path.pts[i - 1]!), path.handle(path.pts[i]!), 0x9aa4b4, sel ? 1 : 0.6);
        if (o.type === 'gadget' && o.loop && path.pts.length > 2) this.dotted(g, path.handle(path.pts[path.pts.length - 1]!), path.handle(path.pts[0]!), 0x9aa4b4, sel ? 0.7 : 0.35);
        for (const p of path.pts) { const hp = path.handle(p); g.fillStyle(sel ? 0xf2b544 : 0x5c6575, 0.95).fillCircle(hp.x, hp.y, (sel ? 3.5 : 2.5) * Math.max(1, 2 / this.zoom)); }
      }
      if (o.type !== 'gadget') continue;
      if (o.effect.kind === 'teleport') {
        const to = o.effect.to;
        const a = center(o.id);
        const b = typeof to === 'string' ? center(to) : { x: (to.x + 0.5) * T, y: (to.y + 0.5) * T };
        if (a && b) { this.dotted(g, a, b, 0xff3fa0, sel ? 1 : 0.5); if (typeof to !== 'string') g.lineStyle(lw * 1.5, 0xff3fa0, sel ? 1 : 0.6).strokeCircle(b.x, b.y, 5); }
      }
      if (o.look?.shape === 'none' && st.visible.objects) this.dashRect(g, o.x * T, o.y * T, o.w * T, o.h * T, 0xffffff, 0.5, lw * 1.5);
    }

    // Eyedropper in progress: make what can be picked glow.
    const req = this.pickReq;
    if (req?.type === 'object') {
      for (const o of l.objects) if (req.accept(o)) {
        const f = footprint(o);
        const hov = this.hover && inRect(f, this.hover.x, this.hover.y);
        g.lineStyle((hov ? 3 : 2) / this.zoom + 0.5, 0xffd35c, hov ? 1 : pulse).strokeRect(f.x * T - 1, f.y * T - 1, f.w * T + 2, f.h * T + 2);
      }
    } else if (req?.type === 'zone') {
      for (const z of l.zones) {
        const hov = this.hover && inRect(z, this.hover.x, this.hover.y);
        g.lineStyle((hov ? 3 : 2) / this.zoom + 0.5, 0xffd35c, hov ? 1 : pulse).strokeRect(z.x * T, z.y * T, z.w * T, z.h * T);
      }
    }

    // Selection & handles.
    const s = st.selection;
    if (s) {
      let r: TileRect | null = null;
      if (s.kind === 'object') { const o = l.objects.find((x) => x.id === s.id); if (o) r = footprint(o); }
      else if (s.kind === 'zone') r = l.zones.find((x) => x.id === s.id) ?? null;
      else if (s.kind === 'exit') r = (l.exits ?? []).find((x) => x.id === s.id) ?? null;
      else if (s.kind === 'image') { const im = (l.images ?? []).find((x) => x.id === s.id); if (im) r = { x: im.x, y: im.y, w: im.w / 16, h: im.h / 16 }; }
      if (r) {
        const pad = (2 + Math.sin(this.t * 6)) / Math.max(1, this.zoom / 2);
        g.lineStyle(2 * lw, 0xf2b544, 1).strokeRect(r.x * T - pad, r.y * T - pad, r.w * T + pad * 2, r.h * T + pad * 2);
      }
      const h = this.handleOf(s);
      if (h) {
        const hs = (5 / this.zoom) * 1.6;
        g.fillStyle(0xf2b544, 1).fillRect(h.x - hs, h.y - hs, hs * 2, hs * 2).lineStyle(lw, 0x1c1a24, 1).strokeRect(h.x - hs, h.y - hs, hs * 2, hs * 2);
      }
    }
    if (st.marquee) {
      const m = st.marquee;
      g.fillStyle(0x5bf0a0, 0.08).fillRect(m.x * T, m.y * T, m.w * T, m.h * T);
      this.dashRect(g, m.x * T, m.y * T, m.w * T, m.h * T, 0x5bf0a0, 1, lw * 2);
    }

    // Link in progress.
    if (this.link && this.hover) {
      const a = { x: (this.link.at.x + 0.5) * T, y: (this.link.at.y + 0.5) * T };
      this.dotted(g, a, { x: (this.hover.x + 0.5) * T, y: (this.hover.y + 0.5) * T }, 0xe0564f, 1);
      g.fillStyle(0xe0564f, 1).fillCircle(a.x, a.y, 3);
    }
    for (const t of this.labels) t.setVisible(st.visible.zones);
  }

  private drawHover(): void {
    const g = this.hoverG;
    g.clear();
    this.hoverText.setVisible(false);
    const st = this.st;
    const d = this.drag;
    const lw = 2 / this.zoom;
    if (d && (d.kind === 'zone' || d.kind === 'pickRect' || d.kind === 'marquee' || (d.kind === 'shape' && d.shape === 'rect'))) {
      this.decorGhost(null);
      const r = rectOf(d.start, d.cur);
      const col = d.kind === 'zone' ? (d.mode === 'exit' ? 0xf2b544 : 0x3fb8b0) : d.kind === 'marquee' ? 0x5bf0a0 : d.kind === 'shape' && d.erase ? 0xe0564f : 0xf2b544;
      g.fillStyle(col, 0.25).fillRect(r.x * T, r.y * T, r.w * T, r.h * T);
      g.lineStyle(lw, col, 0.9).strokeRect(r.x * T, r.y * T, r.w * T, r.h * T);
      this.hoverText.setText(`${r.w}×${r.h}`).setPosition((r.x + r.w / 2) * T, (r.y + r.h / 2) * T).setVisible(true);
      return;
    }
    if (d && d.kind === 'shape' && d.shape === 'line') {
      for (const q of line(d.start, d.cur)) for (const b of this.brushCells(q)) g.fillStyle(d.erase ? 0xe0564f : 0xf2b544, 0.4).fillRect(b.x * T, b.y * T, T, T);
      return;
    }
    if (d && d.kind === 'float') { this.drawClipGhost(g, d.clip, d.cur); return; }
    if (d && d.kind === 'room') {
      const lv = this.doc.level;
      void lv;
      const w = Math.max(MIN_W, Math.min(MAX_W, d.w)), h = Math.max(MIN_H, Math.min(MAX_H, d.h));
      g.lineStyle(lw, 0x5bf0a0, 1).strokeRect(0, 0, w * T, h * T);
      g.fillStyle(0x5bf0a0, 0.06).fillRect(0, 0, w * T, h * T);
      this.hoverText.setText(`${w}×${h}`).setPosition((w * T) / 2, (h * T) / 2).setVisible(true);
      return;
    }
    const c = this.hover;
    if (!c) { this.decorGhost(null); return; }
    if (st.tool === 'stamp' && this.clip) { this.decorGhost(null); this.drawClipGhost(g, this.clip, c); return; }
    if (this.pickReq) {
      if (this.pickReq.type === 'object' || this.pickReq.type === 'zone') return; // the glow says it all
      g.lineStyle(lw, 0xffa23a, 0.95).strokeRect(c.x * T, c.y * T, T, T);
      this.hoverText.setText(`${c.x},${c.y}`).setPosition((c.x + 0.5) * T, (c.y - 0.4) * T).setVisible(true);
      return;
    }
    if (st.tool === 'select' || st.tool === 'pick') { this.decorGhost(null); g.lineStyle(lw, 0xffffff, 0.6).strokeRect(c.x * T, c.y * T, T, T); return; }
    const item = st.item[st.layer];
    if (isGrid(st.layer)) {
      const erase = st.tool === 'erase';
      for (const b of this.brushCells(c)) {
        g.fillStyle(erase ? 0xe0564f : item?.decor ? 0xffffff : 0xf2b544, item?.decor && !erase ? 0.1 : 0.22).fillRect(b.x * T, b.y * T, T, T);
        g.lineStyle(1 / this.zoom, 0xffffff, 0.7).strokeRect(b.x * T, b.y * T, T, T);
      }
      if (!erase && item?.decor) this.decorGhost(c, item.decor);
      else {
        this.decorGhost(null);
        if (!erase && item) this.hoverText.setText(item.icon).setPosition((c.x + 0.5) * T, (c.y + 0.5) * T).setVisible(true);
      }
      return;
    }
    this.decorGhost(null);
    let w = 1, h = 1;
    if (st.layer === 'objects' && item?.make && st.tool !== 'erase') { const f = footprint(item.make('preview', c.x, c.y)); w = f.w; h = f.h; }
    g.fillStyle(st.tool === 'erase' ? 0xe0564f : 0xf2b544, 0.22).fillRect(c.x * T, c.y * T, w * T, h * T);
    g.lineStyle(lw, 0xffffff, 0.7).strokeRect(c.x * T, c.y * T, w * T, h * T);
    if (item && st.tool !== 'erase') this.hoverText.setText(item.icon).setPosition((c.x + w / 2) * T, (c.y + h / 2) * T).setVisible(true);
  }

  private decorGhost(c: Pt | null, id?: string): void {
    if (!c || !id) { this.ghost?.setVisible(false); return; }
    const key = `ed_decor_${id}`;
    if (!this.ghost) this.ghost = this.add.image(0, 0, key).setOrigin(0).setDepth(21).setAlpha(0.8);
    this.ghost.setTexture(key).setPosition(c.x * T, c.y * T).setVisible(true);
  }

  private drawClipGhost(g: Phaser.GameObjects.Graphics, clip: Clip, at: Pt): void {
    for (let y = 0; y < clip.h; y++) for (let x = 0; x < clip.w; x++) {
      const ch = clip.terrain[y]![x]!;
      if (ch === '.' && clip.bg[y]![x] === '.' && clip.fg[y]![x] === '.') continue;
      g.fillStyle(isSolidGlyph(ch) ? 0x9aa4b4 : 0x5bf0a0, isSolidGlyph(ch) ? 0.55 : 0.25).fillRect((at.x + x) * T, (at.y + y) * T, T, T);
    }
    for (const o of clip.objects) g.fillStyle(0xf2b544, 0.7).fillCircle((at.x + o.x + 0.5) * T, (at.y + o.y + 0.5) * T, 3);
    g.lineStyle(2 / this.zoom, 0x5bf0a0, 1).strokeRect(at.x * T, at.y * T, clip.w * T, clip.h * T);
  }

  private dotted(g: Phaser.GameObjects.Graphics, a: Pt, b: Pt, color: number, alpha: number): void {
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) return;
    const step = 5, dash = 3;
    const off = (this.t * 12) % step;
    g.lineStyle(Math.max(1, 2.2 / this.zoom), color, alpha);
    for (let s = off; s < len; s += step) {
      const e = Math.min(len, s + dash);
      g.lineBetween(a.x + (dx * s) / len, a.y + (dy * s) / len, a.x + (dx * e) / len, a.y + (dy * e) / len);
    }
    const ux = dx / len, uy = dy / len;
    g.fillStyle(color, alpha).fillTriangle(b.x, b.y, b.x - ux * 5 - uy * 2.5, b.y - uy * 5 + ux * 2.5, b.x - ux * 5 + uy * 2.5, b.y - uy * 5 - ux * 2.5);
  }

  private dashRect(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, color: number, alpha: number, lw: number): void {
    g.lineStyle(lw, color, alpha);
    const seg = 3;
    const edge = (xa: number, ya: number, xb: number, yb: number) => {
      const len = Math.hypot(xb - xa, yb - ya);
      for (let s = 0; s < len; s += seg * 2) {
        const e = Math.min(len, s + seg);
        g.lineBetween(xa + ((xb - xa) * s) / len, ya + ((yb - ya) * s) / len, xa + ((xb - xa) * e) / len, ya + ((yb - ya) * e) / len);
      }
    };
    edge(x, y, x + w, y); edge(x + w, y, x + w, y + h); edge(x + w, y + h, x, y + h); edge(x, y + h, x, y);
  }
}

/** Cells on the line between two cells (so fast drags don't leave gaps). */
function line(a: Pt, b: Pt): Pt[] {
  const out: Pt[] = [];
  const n = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  for (let i = 0; i <= n; i++) out.push({ x: Math.round(a.x + ((b.x - a.x) * i) / Math.max(1, n)), y: Math.round(a.y + ((b.y - a.y) * i) / Math.max(1, n)) });
  return out;
}
