// Shipped levels, loaded from src/levels/act*/*.json at build time.
import type { LevelData } from '../sim/types';
import { normalizeLevel } from '../sim/level';

const files = import.meta.glob<LevelData>('./act*/*.json', { eager: true, import: 'default' });
const extra = import.meta.glob<LevelData>('./extra/*.json', { eager: true, import: 'default' });

export const LEVELS: LevelData[] = Object.values(files)
  .map((l) => normalizeLevel(l))
  .sort((a, b) => a.id.localeCompare(b.id));

export const CREDITS_LEVEL: LevelData | null = (() => {
  const c = Object.values(extra).find((l) => l.credits || l.id.toLowerCase().includes('credit'));
  return c ? normalizeLevel(c) : null;
})();

export interface ActInfo { n: number; name: string; line: string; first: number }

export const ACTS: ActInfo[] = [
  { n: 1, name: 'Fresh Meat', line: "Don't worry. You get to keep the bodies.", first: 0 },
  { n: 2, name: 'Rot', line: 'The level fights back now. Sorry. Not sorry.', first: 4 },
  { n: 3, name: 'Bare Bones', line: 'Plan your deaths. I already have.', first: 8 },
  { n: 4, name: 'The Core', line: 'No more training wheels. Or bodies.', first: 12 },
];

export const actOf = (index: number): ActInfo => ACTS[Math.min(3, Math.floor(index / 4))]!;
export const levelIndex = (id: string): number => LEVELS.findIndex((l) => l.id === id);

// ---------------------------------------------------------------------------
// The connected world (zones + chambers). See src/levels/world-resolve.ts.
// ---------------------------------------------------------------------------
import worldSource from './world.json';
import { resolveWorld, type WorldSource } from './world-resolve';
import type { WorldDef } from '../sim/campaign';

const zoneFiles = import.meta.glob<LevelData>('./world/*.json', { eager: true, import: 'default' });
const resolved = resolveWorld(
  worldSource as unknown as WorldSource,
  Object.values(zoneFiles).map((l) => normalizeLevel(l)),
  [...LEVELS, ...(CREDITS_LEVEL ? [CREDITS_LEVEL] : [])],
);

/** The connected world, ready for `new Campaign(WORLD, WORLD_LEVELS)`. */
export const WORLD: WorldDef = resolved.def;
/** Every room the world uses (zones, chambers, credits), with exits pruned to rooms that exist. */
export const WORLD_LEVELS: LevelData[] = resolved.levels;
