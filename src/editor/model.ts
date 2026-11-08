// The editor's document: a draft LevelData plus undo/redo, ids, persistence and editing helpers.
// Everything here is plain data so the editor builds exactly the structures the sim and shipped levels use.
import type {
  Action, LevelData, LevelEvent, LevelObject, ObjType, TileGlyph, TileRect, Trigger, Zone,
} from '../sim/types';
import { cloneLevel, normalizeLevel, validateLevel } from '../sim/level';

export const MAX_W = 32;
export const MAX_H = 18;
const DRAFT_KEY = 'dietrying.editor.v1';

export function blankLevel(w = 24, h = 12): LevelData {
  const tiles: string[] = [];
  for (let y = 0; y < h; y++) {
    let row = '';
    for (let x = 0; x < w; x++) row += x === 0 || y === 0 || x === w - 1 || y === h - 1 ? '#' : '.';
    tiles.push(row);
  }
  return {
    version: 1, id: 'custom', name: 'My Level', width: w, height: h, tiles,
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
    case 'label': return { x: Math.floor(o.x - 1), y: Math.floor(o.y - 0.5), w: 2, h: 1 };
    default: return { x: o.x, y: o.y, w: 1, h: 1 };
  }
}

export const inRect = (r: TileRect, x: number, y: number) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;

export class EditorDoc {
  level: LevelData;
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  /** Bumps on every change so views know to redraw. */
  rev = 0;
  dirty = false;
  private listeners = new Set<() => void>();

  constructor(level?: LevelData) {
    this.level = level ? cloneLevel(level) : blankLevel();
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

  edit(fn: (l: LevelData) => void): void {
    this.checkpoint();
    fn(this.level);
    this.changed();
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

  // --- tiles ---------------------------------------------------------------

  tile(x: number, y: number): TileGlyph {
    return (this.level.tiles[y]?.[x] ?? '#') as TileGlyph;
  }

  /** Set a tile without a checkpoint (callers checkpoint once per stroke). Returns true if it changed. */
  setTile(x: number, y: number, g: TileGlyph): boolean {
    const l = this.level;
    if (x < 0 || y < 0 || x >= l.width || y >= l.height) return false;
    const row = l.tiles[y]!;
    if (row[x] === g) return false;
    l.tiles[y] = row.slice(0, x) + g + row.slice(x + 1);
    return true;
  }

  resize(w: number, h: number): void {
    w = Math.max(6, Math.min(MAX_W, Math.round(w)));
    h = Math.max(5, Math.min(MAX_H, Math.round(h)));
    this.edit((l) => {
      const tiles: string[] = [];
      for (let y = 0; y < h; y++) {
        let row = '';
        for (let x = 0; x < w; x++) {
          const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1;
          const old = l.tiles[y]?.[x];
          row += old !== undefined && !(edge && (x >= l.width - 1 || y >= l.height - 1)) ? old : edge ? '#' : '.';
        }
        tiles.push(row);
      }
      l.width = w; l.height = h; l.tiles = tiles;
      l.objects = l.objects.filter((o) => o.x < w && o.y < h);
      l.zones = l.zones.filter((z) => z.x < w && z.y < h);
    });
  }

  // --- objects -------------------------------------------------------------

  newId(prefix: string): string {
    const used = new Set([...this.level.objects.map((o) => o.id), ...this.level.zones.map((z) => z.id)]);
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

  byId(id: string): LevelObject | undefined { return this.level.objects.find((o) => o.id === id); }

  /** Remove an object and every reference to it (gate links, laser links, event triggers/targets). */
  removeObject(id: string): void {
    const l = this.level;
    l.objects = l.objects.filter((o) => o.id !== id);
    for (const o of l.objects) {
      if (o.type === 'gate' && o.plate === id) delete o.plate;
      if (o.type === 'laser' && o.plate === id) { delete o.plate; if (o.mode === 'plate') o.mode = 'on'; }
    }
    this.pruneEvents((t) => ('plate' in t && t.plate === id) || ('target' in t && t.target === id), (a) => 'target' in a && a.target === id);
  }

  removeZone(id: string): void {
    this.level.zones = this.level.zones.filter((z) => z.id !== id);
    this.pruneEvents((t) => 'zone' in t && t.zone === id, () => false);
  }

  private pruneEvents(badTrigger: (t: Trigger) => boolean, badAction: (a: Action) => boolean): void {
    const l = this.level;
    l.events = l.events
      .filter((e) => !badTrigger(e.trigger))
      .map((e) => ({ ...e, actions: e.actions.filter((a) => !badAction(a)) }))
      .filter((e) => e.actions.length > 0);
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

// --- labels for the UI -----------------------------------------------------

export const TRIGGER_LABEL: Record<Trigger['type'], string> = {
  playerEnters: 'Pip enters zone',
  corpseEnters: 'a body enters zone',
  plateDown: 'plate pressed',
  plateUp: 'plate released',
  timer: 'after ticks (since spawn)',
  deathCountAtLeast: 'deaths at least',
  playerOn: 'Pip stands on',
};

export const ACTION_LABEL: Record<Action['type'], string> = {
  dropTiles: 'Drop tiles',
  removeTiles: 'Remove tiles',
  addTiles: 'Add tiles',
  moveTiles: 'Move tiles',
  popSpike: 'Pop spike',
  fireCrusher: 'Fire crusher',
  fireDropper: 'Fire dropper',
  toggleGate: 'Toggle gate',
  moveDoor: 'Move door',
  setCurrent: 'Set current',
  laser: 'Laser on/off/blink',
  sign: 'Change sign',
  shake: 'Screen shake',
  sfx: 'Play sound',
  startPlatform: 'Start platform',
};

/** Which target object type an action needs (undefined = no target). */
export const ACTION_TARGET: Partial<Record<Action['type'], ObjType>> = {
  popSpike: 'popup', fireCrusher: 'crusher', fireDropper: 'dropper', toggleGate: 'gate',
  moveDoor: 'door', laser: 'laser', sign: 'sign', startPlatform: 'platform',
};

/** A sensible default action of a type aimed at a target/cell. */
export function defaultAction(type: Action['type'], target?: string, cell?: { x: number; y: number }): Action {
  const rect = { x: cell?.x ?? 1, y: cell?.y ?? 1, w: 1, h: 1 };
  switch (type) {
    case 'dropTiles': return { type, rect };
    case 'removeTiles': return { type, rect };
    case 'addTiles': return { type, rect, tile: '#' };
    case 'moveTiles': return { type, rect, path: [{ x: 0, y: -1 }], speed: 3 };
    case 'moveDoor': return { type, target: target ?? 'door', path: [{ x: (cell?.x ?? 1) + 3, y: cell?.y ?? 1 }], speed: 3 };
    case 'setCurrent': return { type, dir: -1, speed: 1.2 };
    case 'laser': return { type, target: target ?? '', mode: 'off' };
    case 'sign': return { type, target: target ?? '', text: 'Surprise!' };
    case 'shake': return { type, strength: 6 };
    case 'sfx': return { type, name: 'jingle' };
    default: return { type, target: target ?? '' } as Action;
  }
}

export function describeTrigger(t: Trigger): string {
  switch (t.type) {
    case 'playerEnters': case 'corpseEnters': return `${TRIGGER_LABEL[t.type]} ${t.zone}`;
    case 'plateDown': case 'plateUp': return `${t.plate} ${t.type === 'plateDown' ? 'pressed' : 'released'}`;
    case 'timer': return `${t.ticks} ticks after spawn`;
    case 'deathCountAtLeast': return `deaths ≥ ${t.n}`;
    case 'playerOn': return `Pip stands on ${t.target}`;
  }
}
