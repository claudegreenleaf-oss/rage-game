// Loads the connected world from disk for Node scripts and tests (no Vite globs).
import { readdirSync, readFileSync } from 'node:fs';
import type { LevelData } from '../src/sim/types';
import { normalizeLevel } from '../src/sim/level';
import { resolveWorld, type ResolvedWorld, type WorldSource } from '../src/levels/world-resolve';

const readDir = (dir: string): LevelData[] => {
  let files: string[] = [];
  try { files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort(); } catch { return []; }
  return files.map((f) => normalizeLevel(JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')) as LevelData));
};

export function loadWorld(opts: { act4?: boolean } = {}): ResolvedWorld & { source: WorldSource } {
  const source = JSON.parse(readFileSync('src/levels/world.json', 'utf8')) as WorldSource;
  const zones = readDir('src/levels/world');
  const chambers = [...readDir('src/levels/act1'), ...readDir('src/levels/act2'), ...readDir('src/levels/act3'),
    ...(opts.act4 === false ? [] : readDir('src/levels/act4')), ...readDir('src/levels/extra')];
  return { ...resolveWorld(source, zones, chambers), source };
}
