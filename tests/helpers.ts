// Shared helpers for the Vitest suites (Node only).
import { readFileSync } from 'node:fs';
import { allLevels } from '../scripts/levels-node';
import { fromAscii, type AsciiExtras } from '../scripts/ascii';
import { compileScript } from '../src/sim/replay';
import { World } from '../src/sim/world';
import { Btn, U, type LevelData } from '../src/sim/types';

export const LEVELS = allLevels();
export const level = (id: string): LevelData => {
  const l = LEVELS.find((x) => x.id === id);
  if (!l) throw new Error(`no level ${id}`);
  return l;
};
export const solution = (id: string) => compileScript(readFileSync(`src/solutions/${id}.txt`, 'utf8'));

/** Tiny test level from ASCII (spec glyphs). */
export const mk = (map: string, extras: Partial<AsciiExtras> = {}): LevelData =>
  fromAscii(map, { id: 'T', name: 'Test', ...extras });

/** Feed one mask for n ticks. */
export function hold(w: World, mask: number, n: number): void {
  for (let i = 0; i < n; i++) w.step(mask);
}

/** Run a script prefix (in runs) on a fresh world. */
export function runPrefix(l: LevelData, runs: ReadonlyArray<readonly [number, number]>): World {
  const w = new World(l);
  for (const [m, n] of runs) hold(w, m, n);
  return w;
}

/** First `count` script lines (death/respawn boundaries are easy to pick out by line). */
export const lines = (id: string, count: number) => solution(id).slice(0, count);

export const tiles = (n: number) => n * U;

/**
 * Brute force a family of simple moves from a starting state: optionally walk `walk` ticks in
 * `dir`, then jump holding for `hold` ticks while steering `steer`, then keep steering.
 * Returns true if `goal(world)` ever holds within the budget. Start state comes from `start()`.
 */
export function anyMoveReaches(start: () => World, goal: (w: World) => boolean, opts: { walks?: number[]; holds?: number[]; budget?: number } = {}): boolean {
  const walks = opts.walks ?? [0, 2, 4, 6, 8, 10, 14, 18, 24, 30, 40];
  const holds = opts.holds ?? [1, 4, 8, 12, 20, 30];
  const budget = opts.budget ?? 120;
  for (const dir of [Btn.Right, Btn.Left, 0])
    for (const walk of walks)
      for (const h of holds)
        for (const steer of [Btn.Right, Btn.Left, 0]) {
          const w = start();
          const startDeaths = w.deathCount;
          const seq: number[] = [...Array(walk).fill(dir), ...Array(h).fill(steer | Btn.Jump), ...Array(budget).fill(steer)];
          for (const m of seq) {
            w.step(m);
            if (w.deathCount > startDeaths || w.won) break;
            if (goal(w)) return true;
          }
          if (w.won && goal(w)) return true;
        }
  return false;
}
