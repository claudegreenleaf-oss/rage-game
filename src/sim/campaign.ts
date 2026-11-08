// The connected world: rooms (puzzle chambers and exploration zones) joined by exits.
// Each room runs in its own deterministic World; walking into an exit moves Pip to the linked room,
// keeping momentum. Death respawns Pip at the room entrance or the last bench touched.
import { U, type Exit, type LevelData, type SimEvent } from './types';
import { PIP_H, PIP_W } from './constants';
import { World } from './world';

export interface WorldDef {
  version: 1;
  name: string;
  /** Where a new run starts. */
  start: { room: string };
  /** Room ids in map order (zones and chambers). */
  rooms: string[];
  /**
   * How chambers (whose files stay exactly as the standalone puzzles) plug into the world:
   * extra exits, wall tiles to open for them, and where the exit door leads.
   */
  attach?: Record<string, ChamberAttach>;
  /** Map placement of each room in tiles, for the map screen. */
  layout?: Record<string, { x: number; y: number }>;
}

export interface ChamberAttach {
  exits?: Exit[];
  /**
   * Legacy: cells to clear for a doorway. Ignored: chambers are entered at their own spawn, so their
   * walls stay exactly as in the standalone puzzle (and its tested solution and invariants hold).
   */
  open?: Array<{ x: number; y: number }>;
  door?: { room: string; exit: string };
}

/** A chamber with its world attachment applied (a copy; the original level is untouched). */
export function attachChamber(l: LevelData, a: ChamberAttach | undefined): LevelData {
  if (!a) return l;
  const c: LevelData = JSON.parse(JSON.stringify(l)) as LevelData;
  c.exits = [...(c.exits ?? []), ...(a.exits ?? [])];
  if (a.door) for (const o of c.objects) if (o.type === 'door') o.to = a.door;
  return c;
}

export interface RoomChange {
  from: string | null;
  to: string;
  /** Which edge Pip came through in the new room ('door' for a chamber's exit door, 'start' for a new run). */
  side: 'left' | 'right' | 'top' | 'bottom' | 'door' | 'start';
}

export interface CampaignSave {
  room: string;
  collected: string[];
  cleared: string[];
  visited: string[];
  deaths: number;
}

/** Which edge of its room an exit sits on. */
export function exitSide(l: LevelData, e: Exit): 'left' | 'right' | 'top' | 'bottom' {
  if (e.x <= 0) return 'left';
  if (e.x + e.w >= l.width) return 'right';
  if (e.y <= 0) return 'top';
  return 'bottom';
}

/** Where Pip appears when arriving through an exit: just inside the room, clear of the exit rect. */
export function entryPoint(l: LevelData, e: Exit): { x: number; y: number } {
  const side = exitSide(l, e);
  const midX = (e.x + e.w / 2) * U - PIP_W / 2;
  switch (side) {
    case 'left': return { x: (e.x + e.w) * U + 24, y: (e.y + e.h) * U - PIP_H };
    case 'right': return { x: e.x * U - PIP_W - 24, y: (e.y + e.h) * U - PIP_H };
    case 'top': return { x: Math.round(midX), y: (e.y + e.h) * U + 12 };
    case 'bottom': return { x: Math.round(midX), y: e.y * U - PIP_H - 12 };
  }
}

export class Campaign {
  readonly def: WorldDef;
  readonly rooms = new Map<string, LevelData>();
  room!: World;
  roomId = '';
  collected = new Set<string>();
  cleared = new Set<string>();
  visited = new Set<string>();
  totalDeaths = 0;
  private seenDeaths = 0;
  /** Bumps on every room change; the renderer rebuilds its view when it changes. */
  roomRev = 0;
  lastChange: RoomChange | null = null;
  /** Events from the current tick (the room's fx plus campaign-level ones). */
  fx: SimEvent[] = [];

  constructor(def: WorldDef, levels: LevelData[], save?: CampaignSave) {
    this.def = def;
    for (const l of levels) this.rooms.set(l.id, attachChamber(l, def.attach?.[l.id]));
    for (const id of def.rooms) if (!this.rooms.has(id)) throw new Error(`world: missing room ${id}`);
    if (save && this.rooms.has(save.room)) {
      save.collected.forEach((c) => this.collected.add(c));
      save.cleared.forEach((c) => this.cleared.add(c));
      save.visited.forEach((c) => this.visited.add(c));
      this.totalDeaths = save.deaths;
      this.enterAtSpawn(save.room);
    } else this.enterAtSpawn(def.start.room);
  }

  level(id: string): LevelData {
    const l = this.rooms.get(id);
    if (!l) throw new Error(`world: no room ${id}`);
    return l;
  }

  save(): CampaignSave {
    return { room: this.roomId, collected: [...this.collected], cleared: [...this.cleared], visited: [...this.visited], deaths: this.totalDeaths };
  }

  step(input: number): void {
    const w = this.room;
    w.step(input);
    this.totalDeaths += w.deathCount - this.seenDeaths;
    this.seenDeaths = w.deathCount;
    this.fx = w.fx;
    if (w.exitHit) {
      const e = w.level.exits?.find((x) => x.id === w.exitHit);
      if (e) this.enterVia(e.to, e.toExit, { vx: w.pip.vx, vy: w.pip.vy }, exitSideOf(this.level(e.to), e.toExit));
      return;
    }
    if (w.won) {
      this.cleared.add(this.roomId);
      const door = w.level.objects.find((o) => o.type === 'door' && o.to);
      if (door && door.type === 'door' && door.to) this.enterVia(door.to.room, door.to.exit, { vx: 0, vy: 0 }, 'door');
    }
  }

  /**
   * Fast travel (from the map) to a room already visited: chambers start at their spawn,
   * zones at their first bench, else their spawn, else just inside their first exit.
   */
  travelTo(id: string): boolean {
    if (!this.visited.has(id) || !this.rooms.has(id)) return false;
    const l = this.level(id);
    const from = this.roomId;
    if (l.kind !== 'zone') { this.room = new World(l, { collected: this.collected }); this.setRoom(id, from, 'start'); return true; }
    const bench = l.objects.find((o) => o.type === 'bench');
    const spawn = l.objects.find((o) => o.type === 'spawn');
    const e = l.exits?.[0];
    const entry = bench ? { x: bench.x * U + ((U - PIP_W) >> 1), y: bench.y * U + U - PIP_H }
      : spawn ? undefined : e ? entryPoint(l, e) : undefined;
    this.room = new World(l, { collected: this.collected, entry });
    this.setRoom(id, from, 'start');
    return true;
  }

  /** Start a room at its own spawn (new run, or a loaded save). */
  enterAtSpawn(id: string): void {
    const from = this.roomId || null;
    this.room = new World(this.level(id), { collected: this.collected });
    this.setRoom(id, from, 'start');
  }

  private enterVia(id: string, exitId: string, velocity: { vx: number; vy: number }, side: RoomChange['side']): void {
    const l = this.level(id);
    const e = l.exits?.find((x) => x.id === exitId);
    const from = this.roomId;
    if (!e) { this.enterAtSpawn(id); return; }
    // Walking into a puzzle chamber starts the puzzle as designed: at its spawn, standing still,
    // and respawning there (its tested solutions and invariants assume that start).
    if (l.kind !== 'zone') {
      this.room = new World(l, { collected: this.collected });
      this.setRoom(id, from, side === 'door' ? 'door' : exitSide(l, e));
      return;
    }
    const entry = entryPoint(l, e);
    const s = exitSide(l, e);
    // Coming up through a floor hole: make sure Pip clears the lip.
    const v = s === 'bottom' ? { vx: velocity.vx, vy: Math.min(velocity.vy, -60) } : velocity;
    this.room = new World(l, { collected: this.collected, entry, velocity: v });
    this.setRoom(id, from, side === 'door' ? 'door' : s);
  }

  private setRoom(id: string, from: string | null, side: RoomChange['side']): void {
    this.roomId = id;
    this.seenDeaths = 0;
    this.visited.add(id);
    this.roomRev++;
    this.lastChange = { from, to: id, side };
  }
}

function exitSideOf(l: LevelData, exitId: string): RoomChange['side'] {
  const e = l.exits?.find((x) => x.id === exitId);
  return e ? exitSide(l, e) : 'start';
}

/** Check that every exit links to a real exit that links back (used by tests and the world build). */
export function validateWorld(def: WorldDef, levels: LevelData[]): string[] {
  const errs: string[] = [];
  const byId = new Map(levels.map((l) => [l.id, attachChamber(l, def.attach?.[l.id])]));
  for (const id of def.rooms) {
    const l = byId.get(id);
    if (!l) { errs.push(`missing room ${id}`); continue; }
    for (const e of l.exits ?? []) {
      const t = byId.get(e.to);
      const back = t?.exits?.find((x) => x.id === e.toExit);
      if (!t) errs.push(`${id}.${e.id} -> unknown room ${e.to}`);
      else if (!back) errs.push(`${id}.${e.id} -> ${e.to}.${e.toExit} does not exist`);
      else if (back.to !== id || back.toExit !== e.id) errs.push(`${id}.${e.id} -> ${e.to}.${e.toExit} does not link back`);
      if (e.x > 0 && e.y > 0 && e.x + e.w < l.width && e.y + e.h < l.height) errs.push(`${id}.${e.id} is not on the room edge`);
    }
    for (const o of l.objects) if (o.type === 'door' && o.to && !byId.get(o.to.room)?.exits?.some((x) => x.id === o.to!.exit)) errs.push(`${id} door -> ${o.to.room}.${o.to.exit} missing`);
  }
  if (!byId.has(def.start.room)) errs.push(`start room ${def.start.room} missing`);
  return errs;
}
