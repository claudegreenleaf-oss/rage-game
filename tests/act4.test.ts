// Act 4 "The Core": solution replays and each chamber's binding invariants.
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { anyMoveReaches, hold } from './helpers';
import { World } from '../src/sim/world';
import { compileScript, runInputs } from '../src/sim/replay';
import { cloneLevel } from '../src/sim/level';
import { pinCorpse, spawnCorpse } from '../src/sim/corpse';
import { Btn, U, type Corpse, type LevelData, type Stage } from '../src/sim/types';
import { STAGE_H } from '../src/sim/constants';
import type { RtGate, RtPlate } from '../src/sim/hazards';

const ACT4: LevelData[] = readdirSync('src/levels/act4').filter((f) => f.endsWith('.json')).sort()
  .map((f) => JSON.parse(readFileSync(`src/levels/act4/${f}`, 'utf8')) as LevelData);
const level = (id: string) => ACT4.find((l) => l.id === id)!;
const solution = (id: string) => compileScript(readFileSync(`src/solutions/${id}.txt`, 'utf8'));
const runPrefix = (l: LevelData, runs: ReadonlyArray<readonly [number, number]>) => {
  const w = new World(l);
  for (const [m, n] of runs) hold(w, m, n);
  return w;
};
const without = (l: LevelData, type: string): LevelData => { const c = cloneLevel(l); c.objects = c.objects.filter((o) => o.type !== type); return c; };

function place(w: World, x: number, bottom: number): void {
  w.pip.x = Math.round(x * U); w.pip.y = Math.round(bottom * U) - w.pip.h;
  w.pip.px = w.pip.x; w.pip.py = w.pip.y; w.pip.vx = 0; w.pip.vy = 0;
  w.step(0);
}
function body(w: World, cx: number, bottom: number, stage: Stage = 0): Corpse {
  spawnCorpse(w, { kind: 'dropper', x: cx * U + U / 2, bottom: bottom * U });
  const c = w.corpses[w.corpses.length - 1]!;
  c.stage = stage; c.h = STAGE_H[stage]; c.y = bottom * U - c.h;
  return c;
}
function pinned(w: World, cx: number, cy: number, stage: Stage = 0): Corpse {
  const c = body(w, cx, cy + 1, stage);
  pinCorpse(w, c, 'floor', cx, cy);
  c.stage = stage;
  return c;
}
const crate = (w: World) => w.corpses.find((c) => c.kind === 'crate')!;
const plate = (w: World, id = 'pl1') => w.obj.plates.find((p) => p.id === id) as RtPlate;
const gate = (w: World, id = 'g1') => w.obj.gates.find((g) => g.id === id) as RtGate;

const PAR: Record<string, number> = { L13: 2, L14: 2, L15: 2, L16: 2 };

describe('Act 4 replays', () => {
  it('ships four chambers L13-L16 in act 4', () => {
    expect(ACT4.map((l) => l.id)).toEqual(['L13', 'L14', 'L15', 'L16']);
    for (const l of ACT4) { expect(l.act).toBe(4); expect(l.kind).toBe('chamber'); expect(l.par).toBe(PAR[l.id]); }
  });
  for (const id of Object.keys(PAR)) {
    it(`${id}: solved with ${PAR[id]} deaths`, () => {
      const r = runInputs(level(id), solution(id));
      expect(r.won).toBe(true);
      expect(r.deaths).toBe(PAR[id]);
    });
  }
});

describe('L13 Inventory', () => {
  const L = without(level('L13'), 'dropper');
  // Dropping bodies in one after another ages the earlier ones, exactly like real deaths.
  const inWell = (w: World) => { spawnCorpse(w, { kind: 'dropper', x: 10 * U + U / 2, bottom: 6 * U }); hold(w, 0, 40); };
  it('the crate alone (2) is not enough, nor are Rot + Fresh (3), nor one body + the crate (4)', () => {
    let w = new World(L);
    crate(w).x = 10 * U; crate(w).y = 6 * U; hold(w, 0, 40);
    expect(plate(w).weight).toBe(2); expect(plate(w).pressed).toBe(false);
    w = new World(L); inWell(w); inWell(w);
    expect(plate(w).weight).toBe(3); expect(plate(w).pressed).toBe(false);
    w = new World(L); inWell(w); crate(w).x = 10 * U; crate(w).y = 5 * U; hold(w, 0, 40);
    expect(plate(w).weight).toBe(4); expect(plate(w).pressed).toBe(false);
  });
  it('Rot + Fresh + the crate (5) opens the gate', () => {
    const w = new World(L); inWell(w); inWell(w);
    crate(w).x = 10 * U; crate(w).y = 4 * U; hold(w, 0, 60);
    expect(plate(w).weight).toBe(5); expect(plate(w).pressed).toBe(true);
    expect(gate(w).open).toBe(1);
  });
  it('the crate goes home on respawn; bodies stay (so the crate must go in during the final life)', () => {
    const w = new World(L);
    crate(w).x = 10 * U; crate(w).y = 6 * U; hold(w, 0, 40);
    expect(plate(w).weight).toBe(2);
    w.killPip({ kind: 'pit', x: 0, bottom: 0 }); hold(w, 0, 40);
    expect(crate(w).x).toBe(6 * U);
    expect(plate(w).weight).toBe(0);
  });
});

describe('L14 Formaldehyde', () => {
  const L = without(level('L14'), 'dropper');
  const onLedge = (w: World) => w.pip.grounded && w.pip.y + w.pip.h === 7 * U && w.pip.x > 14.5 * U;
  it('nothing ages in here', () => {
    const w = runPrefix(level('L14'), solution('L14'));
    expect(w.won).toBe(true);
    expect(w.corpses.filter((c) => c.kind !== 'crate').every((c) => c.stage === 0)).toBe(true);
  });
  it('one body against the ledge is not tall enough', () => {
    expect(anyMoveReaches(() => { const w = new World(L); body(w, 14, 10); place(w, 14.1, 9.2); return w; }, onLedge)).toBe(false);
  });
  it('two stacked bodies are', () => {
    expect(anyMoveReaches(() => { const w = new World(L); body(w, 14, 10); body(w, 14, 9.2); hold(w, 0, 20); place(w, 14.1, 8.4); return w; }, onLedge)).toBe(true);
  });
});

describe('L15 Pendulum', () => {
  const L = level('L15');
  const grabbed = (w: World) => !!w.pip.hang;
  const onLedge = (w: World) => w.pip.grounded && w.pip.y + w.pip.h === 4 * U;
  it('the vine is out of reach without a Rot bounce (Fresh bodies at the edge)', () => {
    expect(anyMoveReaches(() => { const w = new World(L); pinned(w, 5, 10); pinned(w, 6, 10); for (const c of w.corpses) c.stage = 0; place(w, 6.1, 11 - 0.15); return w; }, grabbed)).toBe(false);
  });
  it('a Rot bounce reaches the vine, but not the ledge by itself', () => {
    const start = () => { const w = new World(L); pinned(w, 5, 10, 1); place(w, 3.5, 11); return w; };
    expect(anyMoveReaches(start, grabbed)).toBe(true);
    expect(anyMoveReaches(() => { const w = new World(without(L, 'vine')); pinned(w, 5, 10, 1); place(w, 3.5, 11); return w; }, onLedge)).toBe(false);
  });
});

describe('L16 Critical Mass', () => {
  const L = level('L16');
  const upstairs = (w: World) => w.pip.grounded && w.pip.y + w.pip.h <= 6 * U;
  const abc = solution('L16').slice(0, 4); // well, then press
  it('well first, press second: a Rot bounce pad and a Fresh slab holding the press plate', () => {
    const w = runPrefix(L, abc);
    const pad = w.corpses.find((c) => c.pin?.cx === 1)!;
    expect(pad.stage).toBe(1);
    expect(plate(w, 'pl1').pressed).toBe(true);
  });
  it('the upper floor is out of reach without the Rot pad', () => {
    const start = () => { const w = new World(L); pinned(w, 1, 10, 0); w.setTile(1, 9, '.'); place(w, 1.05, 11 - 0.15); return w; };
    expect(anyMoveReaches(start, upstairs)).toBe(false);
    expect(anyMoveReaches(() => { const w = new World(L); place(w, 1.0, 9); return w; }, upstairs)).toBe(false);
  });
  it('the other order fails: press first leaves a Rot slab (1) on the press plate and a Fresh pad', () => {
    const w = new World(L);
    hold(w, Btn.Right, 64); hold(w, 0, 60); // press (death 1)
    hold(w, Btn.Left, 40); hold(w, 0, 70); // well (death 2)
    expect(w.deathCount).toBe(2);
    expect(plate(w, 'pl1').pressed).toBe(false);
    expect(w.corpses.find((c) => c.pin?.cx === 1)?.stage).toBe(0);
  });
  it('the crate can hold either plate but not both, and a third death breaks the plan', () => {
    const w = runPrefix(L, abc);
    hold(w, 0, 40);
    w.killPip({ kind: 'dropper', x: 5 * U, bottom: 9 * U }); hold(w, 0, 40);
    expect(w.corpses.find((c) => c.pin?.cx === 1)?.stage).toBe(2); // the bounce pad is a skeleton now
    expect(plate(w, 'pl1').pressed).toBe(false);
  });
});
