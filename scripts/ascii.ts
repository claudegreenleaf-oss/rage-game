// Turns an ASCII map in the spec's glyphs into the canonical level JSON (terrain + objects).
// Used by scripts/gen-levels.ts to author the shipped levels.
import type { LevelData, LevelObject, TileGlyph } from '../src/sim/types';

const TERRAIN = new Set(['#', '.', 'X', '=', '^', 'v', '>', '<', '~', '}', '{']);

export interface AsciiExtras {
  id: string;
  name: string;
  act?: number;
  current?: LevelData['current'];
  /** Per-object overrides, keyed by generated id (s1, d1, c1, pl1, g1, m1, l1, p1, door, spawn...). */
  props?: Record<string, Record<string, unknown>>;
  /** Extra objects not drawn in the map. */
  objects?: LevelObject[];
  zones?: LevelData['zones'];
  events?: LevelData['events'];
  credits?: boolean;
}

export function fromAscii(map: string, extras: AsciiExtras): LevelData {
  const rows = map.replace(/^\n+|\n+\s*$/g, '').split('\n').map((r) => r.trimEnd());
  const H = rows.length;
  const W = Math.max(...rows.map((r) => r.length));
  const tiles: string[][] = rows.map((r) => r.padEnd(W, '.').split(''));
  const objects: LevelObject[] = [];
  const counters: Record<string, number> = {};
  const next = (p: string) => `${p}${(counters[p] = (counters[p] ?? 0) + 1)}`;
  const taken = new Set<string>();
  const key = (x: number, y: number) => `${x},${y}`;

  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const ch = tiles[y]![x]!;
      if (TERRAIN.has(ch) || taken.has(key(x, y))) continue;
      const run = (glyph: string) => { let n = 0; while (tiles[y]![x + n] === glyph && !taken.has(key(x + n, y))) { taken.add(key(x + n, y)); n++; } return n; };
      switch (ch) {
        case 'S': objects.push({ type: 'spawn', id: 'spawn', x, y }); break;
        case 'D': objects.push({ type: 'door', id: 'door', x, y }); break;
        case '?': objects.push({ type: 'sign', id: next('s'), x, y, text: { 0: '...' } }); break;
        case 'p': objects.push({ type: 'popup', id: next('p'), x, y }); break;
        case 'd': objects.push({ type: 'dropper', id: next('d'), x, y }); break;
        case 'C': { const w = run('C'); objects.push({ type: 'crusher', id: next('c'), x, y, w, h: 1 }); break; }
        case '_': { const w = run('_'); objects.push({ type: 'plate', id: next('pl'), x, y, w, need: 1 }); break; }
        case '3': { const w = run('3'); objects.push({ type: 'plate', id: next('pl'), x, y, w, need: 3 }); break; }
        case '|': objects.push({ type: 'gate', id: next('g'), x, y, h: 1 }); break;
        case 'M': { const w = run('M'); objects.push({ type: 'platform', id: next('m'), x, y, w, path: [{ x, y }], speed: 3, start: 'touch' }); break; }
        case 'L': objects.push({ type: 'laser', id: next('l'), x, y, dir: 'down', emitter: true, mode: 'on' }); break;
        case 'z': objects.push({ type: 'laser', id: next('l'), x, y, dir: 'right', emitter: false, len: 1, mode: 'blink', on: 60, off: 60 }); break;
        case ':': break;
        default: throw new Error(`${extras.id}: unknown glyph '${ch}' at ${x},${y}`);
      }
      tiles[y]![x] = '.';
    }
  for (const k of taken) { const [x, y] = k.split(',').map(Number); tiles[y!]![x!] = '.'; }

  for (const [id, props] of Object.entries(extras.props ?? {})) {
    const o = objects.find((ob) => ob.id === id);
    if (!o) throw new Error(`${extras.id}: no object ${id} to override`);
    Object.assign(o, props);
  }
  objects.push(...(extras.objects ?? []));

  const level: LevelData = {
    version: 1,
    id: extras.id,
    name: extras.name,
    act: extras.act,
    width: W,
    height: H,
    tiles: tiles.map((r) => r.join('') as string),
    objects,
    zones: extras.zones ?? [],
    events: extras.events ?? [],
  };
  if (extras.current) level.current = extras.current;
  if (extras.credits) level.credits = true;
  for (const row of level.tiles) for (const g of row) if (!TERRAIN.has(g)) throw new Error(`bad tile ${g as TileGlyph}`);
  return level;
}
