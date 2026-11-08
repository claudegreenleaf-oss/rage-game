// Input recording, run-length encoding, the solution-script DSL, and headless replay.
import { Btn, type LevelData } from './types';
import { World } from './world';
import { levelHash } from './level';

export interface Replay { levelId: string; levelHash: string; inputs: Array<[mask: number, ticks: number]> }

const KEY_BITS: Record<string, number> = {
  left: Btn.Left, right: Btn.Right, jump: Btn.Jump, down: Btn.Down, restart: Btn.Restart, wait: 0,
};
const BIT_NAMES: Array<[number, string]> = [[Btn.Left, 'left'], [Btn.Right, 'right'], [Btn.Jump, 'jump'], [Btn.Down, 'down'], [Btn.Restart, 'restart']];

export function maskToKeys(mask: number): string {
  const names = BIT_NAMES.filter(([b]) => mask & b).map(([, n]) => n);
  return names.length ? names.join('+') : 'wait';
}

/** Run-length encode one-mask-per-tick input. */
export function rle(inputs: readonly number[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const m of inputs) {
    const last = out[out.length - 1];
    if (last && last[0] === m) last[1]++;
    else out.push([m, 1]);
  }
  return out;
}

export function unrle(runs: ReadonlyArray<readonly [number, number]>): number[] {
  const out: number[] = [];
  for (const [m, n] of runs) for (let i = 0; i < n; i++) out.push(m);
  return out;
}

export class ScriptError extends Error {}

/**
 * Compile a solution script. One command per line: `<keys> <ticks>`, keys joined with `+`
 * (left, right, jump, down, restart, wait). `#` starts a comment. Blank lines are ignored.
 *
 *   right 40        # hold right for 40 ticks
 *   right+jump 12
 *   wait 30
 */
export function compileScript(src: string): Array<[number, number]> {
  const runs: Array<[number, number]> = [];
  src.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) return;
    const m = /^([a-z+]+)\s+(\d+)$/.exec(line);
    if (!m) throw new ScriptError(`line ${i + 1}: expected "<keys> <ticks>", got "${raw.trim()}"`);
    let mask = 0;
    for (const k of m[1]!.split('+')) {
      const bit = KEY_BITS[k];
      if (bit === undefined) throw new ScriptError(`line ${i + 1}: unknown key "${k}"`);
      mask |= bit;
    }
    runs.push([mask, Number(m[2])]);
  });
  return runs;
}

/** Turn recorded runs back into a readable script. */
export function decompile(runs: ReadonlyArray<readonly [number, number]>): string {
  return runs.map(([m, n]) => `${maskToKeys(m)} ${n}`).join('\n') + '\n';
}

export interface ReplayResult { won: boolean; deaths: number; ticks: number; wonAtTick: number | null }

/** Run inputs through a fresh sim at full speed. Stops at the win (or after `extraTicks` past the last input). */
export function runInputs(level: LevelData, runs: ReadonlyArray<readonly [number, number]>, extraTicks = 0): ReplayResult & { world: World } {
  const w = new World(level);
  let wonAtTick: number | null = null;
  const feed = (mask: number) => {
    w.step(mask);
    if (w.won && wonAtTick === null) wonAtTick = w.tick;
  };
  outer: for (const [m, n] of runs) for (let i = 0; i < n; i++) { feed(m); if (wonAtTick !== null) break outer; }
  for (let i = 0; i < extraTicks && wonAtTick === null; i++) feed(0);
  return { won: w.won, deaths: w.deathCount, ticks: w.tick, wonAtTick, world: w };
}

export function makeReplay(level: LevelData, inputs: readonly number[]): Replay {
  return { levelId: level.id, levelHash: levelHash(level), inputs: rle(inputs) };
}

/** Records one mask per tick alongside a live game. */
export class Recorder {
  private masks: number[] = [];
  push(mask: number): void { this.masks.push(mask); }
  clear(): void { this.masks = []; }
  get length(): number { return this.masks.length; }
  toReplay(level: LevelData): Replay { return makeReplay(level, this.masks); }
}
