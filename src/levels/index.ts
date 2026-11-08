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
];

export const actOf = (index: number): ActInfo => ACTS[Math.min(2, Math.floor(index / 4))]!;
export const levelIndex = (id: string): number => LEVELS.findIndex((l) => l.id === id);
