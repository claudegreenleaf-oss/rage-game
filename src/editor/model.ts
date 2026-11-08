// The editor's document: a draft LevelData plus undo/redo, ids, persistence and editing helpers.
// Everything here is plain data so the editor builds exactly the structures the sim and shipped levels use.
import type {
  Condition, Exit, LevelData, LevelEvent, LevelObject, ObjType, PixelArt, TileGlyph, TileRect, Trigger, Zone,
} from '../sim/types';
import { cloneLevel, normalizeLevel, validateLevel } from '../sim/level';
import { actionRefs, condRefs, logicProblems, renameRefs, triggerRefs } from './logic';

/** Room size limits (any kind): from a tiny closet to a 4096×1536 px hall. */
export const MAX_W = 256;
export const MAX_H = 96;
export const LIMITS = { chamber: { w: MAX_W, h: MAX_H }, zone: { w: MAX_W, h: MAX_H } } as const;
export const MIN_W = 4;
export const MIN_H = 3;
const DRAFT_KEY = 'dietrying.editor.v1';
/** Share codes get unwieldy past this many characters (images are the usual cause). */
export const SHARE_WARN_CHARS = 12000;

export type Kind = 'chamber' | 'zone';
export const kindOf = (l: LevelData): Kind => (l.kind === 'zone' ? 'zone' : 'chamber');
export const limitsOf = (l: LevelData) => LIMITS[kindOf(l)];

/** The paintable grid layers. */
export type GridLayer = 'terrain' | 'bg' | 'fg';
/** Everything the layers panel lists. */
export type LayerId = GridLayer | 'objects' | 'images' | 'zones';
export const LAYERS: Array<{ id: LayerId; label: string; hint: string }> = [
  { id: 'fg', label: 'Foreground decor', hint: 'Drawn over Pip. Vines, debris, grime.' },
  { id: 'objects', label: 'Objects', hint: 'Spawn, doors, hazards, plates, signs…' },
  { id: 'zones', label: 'Zones & exits', hint: 'Trigger zones and room exits.' },
  { id: 'terrain', label: 'Terrain', hint: 'Solid plating, spikes, water, belts.' },
  { id: 'images', label: 'Images', hint: 'Your pixelated pictures.' },
  { id: 'bg', label: 'Background decor', hint: 'Panels, windows, tanks behind the playfield.' },
];

export function blankRows(w: number, h: number, border: boolean): string[] {
  const rows: string[] = [];
  for (let y = 0; y < h; y++) {
    let row = '';
    for (let x = 0; x < w; x++) row += border && (x === 0 || y === 0 || x === w - 1 || y === h - 1) ? '#' : '.';
    rows.push(row);
  }
  return rows;
}

export function blankLevel(w = 24, h = 12, kind: Kind = 'chamber'): LevelData {
  return {
    version: 1, id: 'custom', name: kind === 'zone' ? 'My Zone' : 'My Level', width: w, height: h,
    tiles: blankRows(w, h, true),
    kind: kind === 'zone' ? 'zone' : undefined,
    objects: [
      { type: 'spawn', id: 'spawn', x: 2, y: h - 2 },
      { type: 'door', id: 'door', x: w - 3, y: h - 2 },
      { type: 'sign', id: 's1', x: 4, y: h - 2, text: { 0: 'Trust me.' } },
    ],
    zones: [], events: [],
  };
}

/** Objects that occupy a cell (multi-tile objects cover their whole footprint). */
export function footprint(o: LevelObject): TileRect {
  switch (o.type) {
    case 'crusher': return { x: o.x, y: o.y, w: o.w, h: o.h };
    case 'plate': return { x: o.x, y: o.y, w: o.w, h: 1 };
    case 'gate': return { x: o.x, y: o.y, w: 1, h: Math.max(1, Math.ceil(o.h)) };
    case 'platform': return { x: o.x, y: o.y, w: o.w, h: 1 };
    case 'vine': return { x: o.x, y: o.y, w: 1, h: Math.max(1, Math.ceil(o.len) + 1) };
    case 'label': return { x: Math.floor(o.x - 1), y: Math.floor(o.y - 0.5), w: 2, h: 1 };
    case 'gadget': {
      const x = Math.floor(o.x), y = Math.floor(o.y);
      return { x, y, w: Math.max(1, Math.ceil(o.x + o.w - 1e-6) - x), h: Math.max(1, Math.ceil(o.y + o.h - 1e-6) - y) };
    }
    default: return { x: o.x, y: o.y, w: 1, h: 1 };
  }
}

/** Which size handle an object has (drag to resize). */
export function resizeAxes(o: LevelObject): { w?: string; h?: string } {
  switch (o.type) {
    case 'crusher': return { w: 'w', h: 'h' };
    case 'plate': case 'platform': return { w: 'w' };
    case 'gate': return { h: 'h' };
    case 'vine': return { h: 'len' };
    case 'gadget': return { w: 'w', h: 'h' };
    default: return {};
  }
}

export const inRect = (r: TileRect, x: number, y: number) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;

/** A copied block of the map. */
export interface Clip {
  w: number; h: number;
  terrain: string[]; bg: string[]; fg: string[];
  /** Positions relative to the clip's top-left. */
  objects: LevelObject[];
}

export class EditorDoc {
  level: LevelData;
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  /** Bumps on every change so views know to redraw. */
  rev = 0;
  dirty = false;
  private listeners = new Set<() => void>();

  constructor(level?: LevelData) {
    this.level = level ? normalizeLevel(cloneLevel(level)) : blankLevel();
  }

  onChange(fn: () => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private emit(): void { this.rev++; for (const f of this.listeners) f(); }

  // --- history -------------------------------------------------------------

  /** Call before a change (or once at the start of a drag). */
  checkpoint(): void {
    this.undoStack.push(JSON.stringify(this.level));
    if (this.undoStack.length > 300) this.undoStack.shift();
    this.redoStack = [];
  }

  /** Mark a change done: clears Verified (the level must be re-beaten) and notifies. */
  changed(keepVerified = false): void {
    if (!keepVerified) delete this.level.verified;
    this.dirty = true;
    this.emit();
  }

  edit(fn: (l: LevelData) => void, keepVerified = false): void {
    this.checkpoint();
    fn(this.level);
    this.changed(keepVerified);
  }

  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }

  undo(): void {
    const s = this.undoStack.pop();
    if (!s) return;
    this.redoStack.push(JSON.stringify(this.level));
    this.level = JSON.parse(s) as LevelData;
    this.dirty = true;
    this.emit();
  }

  redo(): void {
    const s = this.redoStack.pop();
    if (!s) return;
    this.undoStack.push(JSON.stringify(this.level));
    this.level = JSON.parse(s) as LevelData;
    this.dirty = true;
    this.emit();
  }

  load(level: LevelData): void {
    this.checkpoint();
    this.level = normalizeLevel(cloneLevel(level));
    this.dirty = false;
    this.emit();
  }

  markVerified(): void {
    this.level.verified = true;
    this.emit();
  }

  // --- grid layers -----------------------------------------------------------

  rows(layer: GridLayer): string[] {
    const l = this.level;
    if (layer === 'terrain') return l.tiles;
    l.decor ??= {};
    const cur = l.decor[layer];
    if (!cur || cur.length !== l.height || cur.some((r) => r.length !== l.width)) l.decor[layer] = fitRows(cur, l.width, l.height);
    return l.decor[layer]!;
  }

  cell(layer: GridLayer, x: number, y: number): string {
    if (layer === 'terrain') return this.level.tiles[y]?.[x] ?? '#';
    return this.level.decor?.[layer]?.[y]?.[x] ?? '.';
  }

  /** Set a cell without a checkpoint (callers checkpoint once per stroke). Returns true if it changed. */
  setCell(layer: GridLayer, x: number, y: number, ch: string): boolean {
    const l = this.level;
    if (x < 0 || y < 0 || x >= l.width || y >= l.height) return false;
    const rows = this.rows(layer);
    const row = rows[y]!;
    if (row[x] === ch) return false;
    rows[y] = row.slice(0, x) + ch + row.slice(x + 1);
    return true;
  }

  tile(x: number, y: number): TileGlyph { return this.cell('terrain', x, y) as TileGlyph; }
  setTile(x: number, y: number, g: TileGlyph): boolean { return this.setCell('terrain', x, y, g); }

  /** Flood-fill the 4-connected region of matching cells. Returns the number of cells changed. */
  fill(layer: GridLayer, x: number, y: number, ch: string): number {
    const l = this.level;
    if (x < 0 || y < 0 || x >= l.width || y >= l.height) return 0;
    const from = this.cell(layer, x, y);
    if (from === ch) return 0;
    const stack: Array<[number, number]> = [[x, y]];
    let n = 0;
    const seen = new Uint8Array(l.width * l.height);
    while (stack.length) {
      const [cx, cy] = stack.pop()!;
      if (cx < 0 || cy < 0 || cx >= l.width || cy >= l.height) continue;
      const k = cy * l.width + cx;
      if (seen[k]) continue;
      seen[k] = 1;
      if (this.cell(layer, cx, cy) !== from) continue;
      this.setCell(layer, cx, cy, ch);
      n++;
      stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
    }
    return n;
  }

  /** Paint a filled rectangle. */
  rect(layer: GridLayer, r: TileRect, ch: string): number {
    let n = 0;
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (this.setCell(layer, x, y, ch)) n++;
    return n;
  }

  // --- clipboard --------------------------------------------------------------

  copy(r: TileRect): Clip {
    const take = (layer: GridLayer) => {
      const out: string[] = [];
      for (let y = r.y; y < r.y + r.h; y++) {
        let row = '';
        for (let x = r.x; x < r.x + r.w; x++) row += this.cell(layer, x, y);
        out.push(row);
      }
      return out;
    };
    const objects = this.level.objects
      .filter((o) => inRect(r, Math.floor(o.x), Math.floor(o.y)))
      .map((o) => shift(JSON.parse(JSON.stringify(o)) as LevelObject, -r.x, -r.y));
    return { w: r.w, h: r.h, terrain: take('terrain'), bg: take('bg'), fg: take('fg'), objects };
  }

  /** Clear a rectangle on the given layers (terrain to empty, decor cleared, objects removed). */
  clear(r: TileRect, layers: { terrain: boolean; bg: boolean; fg: boolean; objects: boolean }): void {
    if (layers.terrain) this.rect('terrain', r, '.');
    if (layers.bg) this.rect('bg', r, '.');
    if (layers.fg) this.rect('fg', r, '.');
    if (layers.objects) for (const o of [...this.level.objects]) if (inRect(r, Math.floor(o.x), Math.floor(o.y))) this.removeObject(o.id);
  }

  /** Stamp a clip with its top-left at (x, y). Empty decor/terrain cells in the clip don't overwrite. */
  paste(c: Clip, x: number, y: number, layers: { terrain: boolean; bg: boolean; fg: boolean; objects: boolean }): void {
    for (let j = 0; j < c.h; j++) for (let i = 0; i < c.w; i++) {
      if (layers.terrain) this.setCell('terrain', x + i, y + j, c.terrain[j]![i]!);
      if (layers.bg && c.bg[j]![i] !== '.') this.setCell('bg', x + i, y + j, c.bg[j]![i]!);
      if (layers.fg && c.fg[j]![i] !== '.') this.setCell('fg', x + i, y + j, c.fg[j]![i]!);
    }
    if (layers.objects)
      for (const o of c.objects) {
        const copy = shift(JSON.parse(JSON.stringify(o)) as LevelObject, x, y);
        copy.id = this.newId(o.id.replace(/\d+$/, '') || 'o');
        if (copy.x < this.level.width && copy.y < this.level.height) this.level.objects.push(copy);
      }
  }

  // --- size --------------------------------------------------------------------

  resize(w: number, h: number): void {
    const lim = limitsOf(this.level);
    w = Math.max(MIN_W, Math.min(lim.w, Math.round(w)));
    h = Math.max(MIN_H, Math.min(lim.h, Math.round(h)));
    if (w === this.level.width && h === this.level.height) return;
    this.edit((l) => {
      const oldW = l.width, oldH = l.height;
      const tiles: string[] = [];
      // The room's right and bottom walls move with the edge: growing clears the old wall (it would be a box
      // inside the room), shrinking builds a new one. Everything else stays where it is.
      for (let y = 0; y < h; y++) {
        let row = '';
        for (let x = 0; x < w; x++) {
          const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1;
          let g: string;
          if (x < oldW && y < oldH) {
            g = l.tiles[y]![x]!;
            const oldWall = (x === oldW - 1 && w > oldW) || (y === oldH - 1 && h > oldH);
            if (oldWall && g === '#' && !edge) g = '.';
            if ((x === w - 1 && w < oldW) || (y === h - 1 && h < oldH)) g = '#';
          } else g = edge ? '#' : '.';
          row += g;
        }
        tiles.push(row);
      }
      l.width = w; l.height = h; l.tiles = tiles;
      if (l.decor) for (const k of ['bg', 'fg'] as const) if (l.decor[k]) l.decor[k] = fitRows(l.decor[k], w, h);
      l.objects = l.objects.filter((o) => o.x < w && o.y < h);
      l.zones = l.zones.filter((z) => z.x < w && z.y < h);
      if (l.exits) l.exits = l.exits.filter((e) => e.x < w && e.y < h);
    });
  }

  /** Switch between chamber (puzzle room) and zone (exploration area). Only changes defaults like wall jump. */
  setKind(kind: Kind): void {
    this.edit((l) => {
      if (kind === 'zone') l.kind = 'zone'; else delete l.kind;
    });
  }

  // --- objects -------------------------------------------------------------

  newId(prefix: string): string {
    const used = new Set([
      ...this.level.objects.map((o) => o.id), ...this.level.zones.map((z) => z.id),
      ...(this.level.exits ?? []).map((e) => e.id), ...(this.level.images ?? []).map((i) => i.id),
    ]);
    for (let i = 1; ; i++) if (!used.has(`${prefix}${i}`)) return `${prefix}${i}`;
  }

  objectAt(x: number, y: number): LevelObject | undefined {
    // Topmost (last placed) first.
    for (let i = this.level.objects.length - 1; i >= 0; i--) {
      const o = this.level.objects[i]!;
      if (inRect(footprint(o), x, y)) return o;
    }
    return undefined;
  }

  zoneAt(x: number, y: number): Zone | undefined {
    for (let i = this.level.zones.length - 1; i >= 0; i--) if (inRect(this.level.zones[i]!, x, y)) return this.level.zones[i];
    return undefined;
  }

  exitAt(x: number, y: number): Exit | undefined {
    return (this.level.exits ?? []).find((e) => inRect(e, x, y));
  }

  imageAt(x: number, y: number, layer?: 'bg' | 'fg'): PixelArt | undefined {
    const imgs = this.level.images ?? [];
    for (let i = imgs.length - 1; i >= 0; i--) {
      const im = imgs[i]!;
      if (layer && im.layer !== layer) continue;
      if (x >= im.x && y >= im.y && x < im.x + im.w / 16 && y < im.y + im.h / 16) return im;
    }
    return undefined;
  }

  byId(id: string): LevelObject | undefined { return this.level.objects.find((o) => o.id === id); }

  /** Remove an object and every reference to it (gate links, laser links, event triggers/targets). */
  removeObject(id: string): void {
    const l = this.level;
    l.objects = l.objects.filter((o) => o.id !== id);
    for (const o of l.objects) {
      if (o.type === 'gate' && o.plate === id) delete o.plate;
      if (o.type === 'laser' && o.plate === id) { delete o.plate; if (o.mode === 'plate') o.mode = 'on'; }
      if (o.type === 'gadget') {
        if (o.link === id) { delete o.link; delete o.invert; }
        if (o.when && condRefs(o.when).some((r) => r.id === id)) delete o.when;
        if (o.effect.kind === 'teleport' && o.effect.to === id) o.effect.to = { x: Math.floor(o.x) + 4, y: Math.floor(o.y) };
      }
    }
    this.pruneRefs(id);
  }

  removeZone(id: string): void {
    this.level.zones = this.level.zones.filter((z) => z.id !== id);
    this.pruneRefs(id);
  }

  /** Give an object or zone a new id, updating every reference. Returns false if the id is taken. */
  rename(from: string, to: string): boolean {
    to = to.trim().replace(/\s+/g, '_');
    if (!to || to === from) return false;
    const l = this.level;
    const taken = [...l.objects.map((o) => o.id), ...l.zones.map((z) => z.id), ...(l.exits ?? []).map((e) => e.id), ...(l.images ?? []).map((i) => i.id)];
    if (taken.includes(to)) return false;
    this.edit(() => {
      const o = l.objects.find((x) => x.id === from);
      if (o) o.id = to;
      const z = l.zones.find((x) => x.id === from);
      if (z) z.id = to;
      renameRefs(l, from, to);
    }, true);
    return true;
  }

  /** Drop events whose trigger needs a deleted id, and actions/conditions that mention it. */
  private pruneRefs(id: string): void {
    const has = (refs: Array<{ id: string }>) => refs.some((r) => r.id === id);
    this.pruneEvents((t) => has(triggerRefs(t)), (a) => has(actionRefs(a)), (c) => has(condRefs(c)));
  }

  removeExit(id: string): void {
    this.level.exits = (this.level.exits ?? []).filter((e) => e.id !== id);
  }

  removeImage(id: string): void {
    this.level.images = (this.level.images ?? []).filter((i) => i.id !== id);
  }

  private pruneEvents(badTrigger: (t: Trigger) => boolean, badAction: (a: LevelEvent['actions'][number]) => boolean, badCond: (c: Condition) => boolean): void {
    const l = this.level;
    l.events = l.events
      .filter((e) => !badTrigger(e.trigger))
      .map((e) => {
        const out: LevelEvent = { ...e, actions: e.actions.filter((a) => !badAction(a)) };
        if (e.if) { const c = e.if.filter((x) => !badCond(x)); if (c.length) out.if = c; else delete out.if; }
        return out;
      })
      .filter((e) => e.actions.length > 0);
  }

  /** Make sure a variable exists (created at 0). */
  ensureVar(name: string, show?: string): void {
    if (!name) return;
    const l = this.level;
    l.vars ??= [];
    if (!l.vars.some((v) => v.name === name)) l.vars.push(show ? { name, value: 0, show } : { name, value: 0 });
  }

  objectsOfType<T extends ObjType>(type: T): Array<Extract<LevelObject, { type: T }>> {
    return this.level.objects.filter((o) => o.type === type) as Array<Extract<LevelObject, { type: T }>>;
  }

  /** Find (or create) the event for a trigger, so links from the same source share one event. */
  eventFor(trigger: Trigger): LevelEvent {
    const key = JSON.stringify(trigger);
    let ev = this.level.events.find((e) => JSON.stringify(e.trigger) === key);
    if (!ev) { ev = { trigger, actions: [], once: true }; this.level.events.push(ev); }
    return ev;
  }

  validate(): string[] {
    const v = validateLevel(this.level);
    const errs = [...v.errors];
    if (this.objectsOfType('spawn').length !== 1) errs.push('needs exactly one spawn');
    return errs;
  }

  /** Things that won't stop a playtest but probably aren't what you meant (broken links, undefined variables). */
  warnings(): string[] {
    return logicProblems(this.level);
  }

  // --- persistence ---------------------------------------------------------

  saveDraft(): boolean {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(this.level));
      this.dirty = false;
      return true;
    } catch {
      return false;
    }
  }

  static loadDraft(): LevelData | null {
    try {
      const s = localStorage.getItem(DRAFT_KEY);
      if (!s) return null;
      const raw = JSON.parse(s) as unknown;
      return validateLevel(raw).ok ? normalizeLevel(raw as LevelData) : null;
    } catch {
      return null;
    }
  }
}

/** Pad/crop decor rows to a size. */
export function fitRows(rows: string[] | undefined, w: number, h: number): string[] {
  const out: string[] = [];
  for (let y = 0; y < h; y++) out.push(((rows?.[y] ?? '') + '.'.repeat(w)).slice(0, w));
  return out;
}

export function shift(o: LevelObject, dx: number, dy: number): LevelObject {
  o.x += dx; o.y += dy;
  if (o.type === 'platform') o.path = o.path.map((p) => ({ x: p.x + dx, y: p.y + dy }));
  if (o.type === 'gadget') {
    if (o.path) o.path = o.path.map((p) => ({ x: p.x + dx, y: p.y + dy }));
    if (o.effect.kind === 'teleport' && typeof o.effect.to === 'object') o.effect.to = { x: o.effect.to.x + dx, y: o.effect.to.y + dy };
  }
  return o;
}

/** Mirror a clip horizontally or vertically (terrain spikes turn to face the new way). */
export function flipClip(c: Clip, axis: 'h' | 'v'): Clip {
  const mirror: Record<string, string> = axis === 'h' ? { '>': '<', '<': '>', '}': '{', '{': '}' } : { '^': 'v', v: '^' };
  const flipRows = (rows: string[], swap: boolean) => {
    const r = axis === 'v' ? [...rows].reverse() : rows.map((row) => [...row].reverse().join(''));
    return swap ? r.map((row) => [...row].map((ch) => mirror[ch] ?? ch).join('')) : r;
  };
  return {
    w: c.w, h: c.h,
    terrain: flipRows(c.terrain, true), bg: flipRows(c.bg, false), fg: flipRows(c.fg, false),
    objects: c.objects.map((o) => {
      const f = footprint(o);
      const copy = JSON.parse(JSON.stringify(o)) as LevelObject;
      // Move the footprint to its mirrored spot; everything else in the object moves with it.
      const dx = axis === 'h' ? c.w - f.x - f.w - f.x : 0;
      const dy = axis === 'v' ? c.h - f.y - f.h - f.y : 0;
      return shift(copy, dx, dy);
    }),
  };
}
