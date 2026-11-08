// Loads every shipped level from disk (Node-only helper for scripts).
import { readdirSync, readFileSync } from 'node:fs';
import type { LevelData } from '../src/sim/types';

export function allLevels(): LevelData[] {
  const out: LevelData[] = [];
  for (const act of ['act1', 'act2', 'act3', 'act4', 'extra']) {
    let files: string[] = [];
    try { files = readdirSync(`src/levels/${act}`); } catch { continue; }
    for (const f of files.filter((x) => x.endsWith('.json')).sort()) out.push(JSON.parse(readFileSync(`src/levels/${act}/${f}`, 'utf8')) as LevelData);
  }
  return out;
}
