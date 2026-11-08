// Turns the authored world (src/levels/world.json + zone files) and the chamber levels into a
// WorldDef the Campaign can run. Chamber files stay exactly as the standalone puzzles: they plug in
// through WorldDef.attach (an entrance cut in the wall at the spawn row, and where the door leads).
// If Act 4 isn't shipped yet, its wing is dropped and the last Act 3 door leads to the credits.
import type { Exit, LevelData } from '../sim/types';
import type { ChamberAttach, WorldDef } from '../sim/campaign';

export interface WorldSource extends WorldDef {
  chain: Array<{ chamber: string; zone: string; entrance: string; door: { room: string; exit: string } }>;
  fallback: { act4: string[]; lastAct3: string };
  /** Chambers whose entrance can't be at the spawn-side wall (their solution leans on that wall). */
  entrances?: Record<string, { x: number; y: number }>;
}

export interface ResolvedWorld { def: WorldDef; levels: LevelData[] }

export function resolveWorld(src: WorldSource, zones: LevelData[], chambers: LevelData[]): ResolvedWorld {
  const byId = new Map<string, LevelData>();
  for (const l of [...zones, ...chambers]) byId.set(l.id, l);
  const act4Chambers = src.fallback.act4.filter((id) => /^L\d\d$/.test(id));
  const hasAct4 = act4Chambers.every((id) => byId.has(id));
  const dropped = new Set(hasAct4 ? [] : src.fallback.act4);
  const rooms = src.rooms.filter((id) => !dropped.has(id) && byId.has(id));
  const keep = new Set(rooms);

  const levels: LevelData[] = rooms.map((id) => {
    const l = byId.get(id)!;
    if (!l.exits?.some((e) => !keep.has(e.to))) return l;
    return { ...l, exits: l.exits.filter((e) => keep.has(e.to)) };
  });

  const attach: Record<string, ChamberAttach> = {};
  for (const c of src.chain) {
    if (!keep.has(c.chamber)) continue;
    const l = byId.get(c.chamber)!;
    const spawn = l.objects.find((o) => o.type === 'spawn');
    if (!spawn) continue;
    const at = src.entrances?.[c.chamber];
    const entrance: Exit = at
      ? { id: 'in', x: at.x, y: at.y, w: 1, h: 1, to: c.zone, toExit: c.entrance }
      : { id: 'in', x: 0, y: spawn.y, w: 1, h: 1, to: c.zone, toExit: c.entrance };
    const open: Array<{ x: number; y: number }> = [];
    if (at) open.push({ x: at.x, y: at.y });
    else for (let x = 0; x < spawn.x; x++) if (l.tiles[spawn.y]?.[x] !== '.') open.push({ x, y: spawn.y });
    const door = !hasAct4 && c.chamber === src.fallback.lastAct3 ? { room: 'credits', exit: 'in' } : c.door;
    attach[c.chamber] = { exits: [entrance], open, door: keep.has(door.room) ? door : { room: 'credits', exit: 'in' } };
  }
  const credits = byId.get('credits');
  if (credits && keep.has('credits')) {
    const spawn = credits.objects.find((o) => o.type === 'spawn');
    // Arrival-only: a solid wall cell linked to itself, next to the credits spawn.
    attach.credits = { exits: [{ id: 'in', x: 0, y: spawn?.y ?? 1, w: 1, h: 1, to: 'credits', toExit: 'in' }] };
  }

  const layout = Object.fromEntries(Object.entries(src.layout ?? {}).filter(([id]) => keep.has(id)));
  return { def: { version: 1, name: src.name, start: src.start, rooms, attach, layout }, levels };
}
