// Every shipped level must be beaten by its solution script, with exactly the intended number of deaths.
import { afterAll, describe, expect, it } from 'vitest';
import { LEVELS, solution } from './helpers';
import { decompile, makeReplay, rle, runInputs, unrle, compileScript } from '../src/sim/replay';
import { levelHash } from '../src/sim/level';

/** The intended death path for each level. Changing a level must not silently change these. */
const EXPECTED_DEATHS: Record<string, number> = {
  L01: 3, L02: 2, L03: 2, L04: 3, L05: 3, L06: 2, L07: 3, L08: 1, L09: 3, L10: 5, L11: 3, L12: 3,
  L13: 2, L14: 2, L15: 2, L16: 2, credits: 1,
};

const table: Array<{ level: string; solved: string; deaths: number; time: string }> = [];

describe('solution replays', () => {
  it('ships 16 levels in 4 acts plus the credits', () => {
    expect(LEVELS.filter((l) => /^L\d\d$/.test(l.id)).map((l) => l.id)).toEqual(
      ['L01', 'L02', 'L03', 'L04', 'L05', 'L06', 'L07', 'L08', 'L09', 'L10', 'L11', 'L12', 'L13', 'L14', 'L15', 'L16'],
    );
    expect(LEVELS.some((l) => l.credits)).toBe(true);
  });

  for (const l of LEVELS) {
    it(`${l.id} ${l.name}: solved with ${EXPECTED_DEATHS[l.id]} deaths`, () => {
      const runs = solution(l.id);
      const r = runInputs(l, runs);
      table.push({ level: `${l.id} ${l.name}`, solved: r.won ? 'yes' : 'NO', deaths: r.deaths, time: `${((r.wonAtTick ?? r.ticks) / 60).toFixed(1)} s` });
      expect(r.won).toBe(true);
      expect(r.deaths).toBe(EXPECTED_DEATHS[l.id]);
    });
  }

  it('replays are deterministic and round-trip through RLE and the DSL', () => {
    for (const l of LEVELS) {
      const masks = unrle(solution(l.id));
      const replay = makeReplay(l, masks);
      expect(replay.levelHash).toBe(levelHash(l));
      expect(unrle(replay.inputs)).toEqual(masks);
      expect(compileScript(decompile(rle(masks)))).toEqual(rle(masks));
      const a = runInputs(l, replay.inputs);
      const b = runInputs(l, replay.inputs);
      expect([a.won, a.deaths, a.wonAtTick]).toEqual([b.won, b.deaths, b.wonAtTick]);
    }
  });
});

afterAll(() => {
  if (!table.length) return;
  const pad = (s: string | number, n: number) => String(s).padEnd(n);
  const lines = [
    `${pad('level', 24)}${pad('solved', 8)}${pad('deaths', 8)}time`,
    ...table.map((r) => `${pad(r.level, 24)}${pad(r.solved, 8)}${pad(r.deaths, 8)}${r.time}`),
  ];
  console.log('\n' + lines.join('\n') + '\n');
});
