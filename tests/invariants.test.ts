// The binding level invariants from Spec §8, encoded as tests where practical.
import { describe, expect, it } from 'vitest';
import { anyMoveReaches, hold, level, runPrefix, solution } from './helpers';
import { World } from '../src/sim/world';
import { cloneLevel } from '../src/sim/level';
import { pinCorpse, spawnCorpse } from '../src/sim/corpse';
import { spikeCovered, type RtPlate } from '../src/sim/hazards';
import { Btn, U, type Corpse, type LevelData, type Stage } from '../src/sim/types';
import { STAGE_H } from '../src/sim/constants';

/** Put Pip somewhere (x = left edge in tiles, standing on y = bottom in tiles). */
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

function pinned(w: World, kind: 'floor' | 'wall', cx: number, cy: number, stage: Stage = 0): Corpse {
  const c = body(w, cx, cy + 1, stage);
  pinCorpse(w, c, kind, cx, cy);
  return c;
}

const without = (l: LevelData, type: string): LevelData => {
  const c = cloneLevel(l);
  c.objects = c.objects.filter((o) => o.type !== type);
  return c;
};

/** Step until a condition holds (or give up). */
function until(w: World, mask: number, cond: (w: World) => boolean, max = 2000): void {
  for (let i = 0; i < max && !cond(w); i++) w.step(mask);
}
const respawned = (w: World) => w.pipAlive && w.respawnTimer === 0 && w.hitstop === 0;

describe('L01 Trust Me', () => {
  const L = level('L01');
  it("can't clear the spike strip with a jump", () => {
    expect(anyMoveReaches(() => new World(L), (w) => w.pip.x > 12 * U)).toBe(false);
  });
  it('two deaths are not enough: the pop-up blocks the corridor', () => {
    const start = () => { const w = new World(L); until(w, Btn.Right, (x) => x.deathCount === 2); until(w, 0, respawned); return w; };
    expect(anyMoveReaches(start, (w) => w.won, { budget: 260 })).toBe(false);
  });
  it('a 4th death in the tunnel uncovers a spike (the cap)', () => {
    const w = new World(L);
    until(w, Btn.Right, (x) => x.deathCount === 3);
    until(w, 0, respawned);
    until(w, Btn.Right, (x) => x.pip.x > 11.3 * U);
    hold(w, Btn.Jump, 10); // ceiling spikes: the body lands on the far side
    hold(w, 0, 20);
    expect(w.deathCount).toBe(4);
    expect(spikeCovered(w, 10, 4) && spikeCovered(w, 11, 4)).toBe(false);
  });
});

describe('L02 Dead Weight', () => {
  const L = level('L02');
  it("you can't step off the plate and reach the gate before it closes", () => {
    const start = () => { const w = new World(L); hold(w, Btn.Right, 64); return w; };
    expect(anyMoveReaches(start, (w) => w.pip.x > 15.6 * U, { walks: [0], holds: [1, 6, 12, 20], budget: 100 })).toBe(false);
    const w = start();
    hold(w, Btn.Right, 60);
    expect(w.pip.x).toBeLessThan(15 * U);
  });
  it('the slab alone holds the plate', () => {
    const w = new World(L);
    hold(w, Btn.Right, 64); hold(w, 0, 80);
    expect(w.corpses[0]?.shape).toBe('slab');
    expect(w.pip.x).toBeLessThan(3 * U);
    expect((w.obj.plates[0] as RtPlate).pressed).toBe(true);
  });
});

describe('L03 Leg Up', () => {
  const L = level('L03');
  it("the ledge can't be jumped from the floor", () => {
    expect(anyMoveReaches(() => { const w = new World(without(L, 'dropper')); place(w, 13.5, 7); return w; }, (w) => w.pip.y + w.pip.h <= 4 * U)).toBe(false);
  });
  it('one Fresh body is enough to climb (and to win, if you bait the door dropper)', () => {
    const runs = [...solution('L03').slice(0, 7), [0, 20], [Btn.Right, 14], [Btn.Left, 12], [0, 40], [Btn.Right, 80]] as Array<[number, number]>;
    const w = runPrefix(L, runs);
    expect(w.won).toBe(true);
    expect(w.deathCount).toBe(1);
  });
  it('dying to the second dropper turns body 1 into Rot, which still works (no soft-lock)', () => {
    const w = runPrefix(L, solution('L03'));
    expect(w.won).toBe(true);
    expect(w.corpses.some((c) => c.stage === 1 && c.x === 15 * U)).toBe(true);
  });
});

describe('L04 Growing Old', () => {
  const L = without(level('L04'), 'dropper');
  const onBodyBy = (stage: Stage) => () => { const w = new World(L); body(w, 16, 10, stage); place(w, 16.1, 10 - STAGE_H[stage] / U - 1.5); return w; };
  it("a Fresh body doesn't get you up the 5-high ledge", () => {
    expect(anyMoveReaches(onBodyBy(0), (w) => w.pip.y + w.pip.h <= 5 * U && w.pip.x > 16.5 * U)).toBe(false);
  });
  it('a Rot bounce clears it', () => {
    expect(anyMoveReaches(onBodyBy(1), (w) => w.pip.grounded && w.pip.y + w.pip.h === 5 * U)).toBe(true);
  });
});

describe('L05 Shallow End', () => {
  const L = level('L05');
  it("the pool can't be jumped", () => {
    expect(anyMoveReaches(() => { const w = new World(L); place(w, 6.5, 6); return w; }, (w) => w.pip.x > 15 * U)).toBe(false);
  });
  it('three rafts pile up at the far wall and you can climb from a raft to the ledge (solution)', () => {
    const w = runPrefix(L, solution('L05').slice(0, 2));
    expect(w.corpses.filter((c) => c.floating)).toHaveLength(3);
    expect(Math.max(...w.corpses.map((c) => c.x + c.w))).toBe(15 * U);
    expect(runPrefix(L, solution('L05')).won).toBe(true);
  });
});

describe('L06 Last Stop', () => {
  const L = without(level('L06'), 'dropper');
  const onBank = (w: World) => w.pip.grounded && w.pip.x + w.pip.w > 19 * U + 10 && w.pip.y + w.pip.h === 7 * U;
  it("you can't jump straight from the last stop to the bank", () => {
    const start = () => { const w = new World(L); hold(w, Btn.Right, 14); hold(w, 0, 190); return w; };
    expect(start().obj.platforms[0]!.done).toBe(true);
    expect(anyMoveReaches(start, onBank, { walks: [0, 4, 8, 12, 16], holds: [8, 14, 20, 30] })).toBe(false);
  });
  it('one stepping stone is not enough by plain jumps', () => {
    const start = () => { const w = new World(L); pinned(w, 'floor', 12, 7); place(w, 12.1, 8 - 0.15); return w; };
    expect(anyMoveReaches(start, onBank)).toBe(false);
  });
  it('two stones are (and so is a Rot bounce): the solution', () => {
    const w = runPrefix(level('L06'), solution('L06'));
    expect(w.won).toBe(true);
  });
});

describe('L07 Lights Out', () => {
  const L = level('L07');
  it('one body on the plate turns off the exit laser', () => {
    const w = new World(L);
    hold(w, 0, 2);
    expect(w.obj.lasers.find((l) => l.id === 'l1')!.active).toBe(true);
    body(w, 11, 8 - 0.05);
    hold(w, 0, 3);
    expect(w.obj.lasers.find((l) => l.id === 'l1')!.active).toBe(false);
  });
  it('the push can be timed from a standstill (solution)', () => {
    expect(runPrefix(L, solution('L07')).won).toBe(true);
  });
});

describe('L08 Runaway', () => {
  it("you can't catch the door with no bodies", () => {
    const L = without(level('L08'), 'dropper');
    let seed = 12345;
    const rnd = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 2 ** 32; };
    const moves = [Btn.Right, Btn.Left, Btn.Right | Btn.Jump, Btn.Left | Btn.Jump, 0, Btn.Right, Btn.Right];
    for (let trial = 0; trial < 400; trial++) {
      const w = new World(L);
      for (let seg = 0; seg < 30 && !w.won; seg++) hold(w, moves[Math.floor(rnd() * moves.length)]!, 5 + Math.floor(rnd() * 40));
      expect(w.won).toBe(false);
    }
  });
  it('one well-placed body is enough (solution)', () => {
    const w = runPrefix(level('L08'), solution('L08'));
    expect(w.won).toBe(true);
    expect(w.deathCount).toBe(1);
  });
});

describe('L09 Hang In There', () => {
  const L = level('L09');
  const exitReached = (w: World) => w.pip.y + w.pip.h <= 3 * U && w.pip.x >= 3.5 * U;
  it("you can't reach the exit with Fresh ledges alone", () => {
    const start = () => { const w = new World(L); pinned(w, 'wall', 1, 9); pinned(w, 'wall', 3, 7); w.corpses.forEach((c) => { c.stage = 0; }); place(w, 3.05, 7.1); return w; };
    expect(anyMoveReaches(start, exitReached)).toBe(false);
  });
  it('the Rot bounce from the middle ledge clears it, through the Skeleton ledge (solution)', () => {
    const w = runPrefix(L, solution('L09'));
    expect(w.won).toBe(true);
    expect(w.corpses.find((c) => c.pin?.cx === 1 && c.pin.cy === 9)?.stage).toBe(2);
    expect(w.corpses.find((c) => c.pin?.cx === 3 && c.pin.cy === 7)?.stage).toBe(1);
  });
});

describe('L10 Family Reunion', () => {
  const L = level('L10');
  it('the well holds 3 stacked bodies below floor level, and the readout sums them', () => {
    const w = new World(without(L, 'dropper'));
    body(w, 12, 4, 0); hold(w, 0, 40);
    body(w, 12, 4, 0); hold(w, 0, 40);
    body(w, 12, 4, 0); hold(w, 0, 40);
    expect(w.corpses).toHaveLength(3);
    for (const c of w.corpses) expect(c.y).toBeGreaterThanOrEqual(5 * U);
    const plate = w.obj.plates[0] as RtPlate;
    expect(plate.weight).toBe(3); // Skeleton 0 + Rot 1 + Fresh 2
    expect(plate.pressed).toBe(true);
  });
  it('the weight can be rebuilt after extra deaths (solution: 5 deaths)', () => {
    const w = runPrefix(L, solution('L10'));
    expect(w.won).toBe(true);
    expect(w.deathCount).toBe(5);
  });
});

describe('L11 Assembly Line', () => {
  const L = without(level('L11'), 'dropper');
  for (const stage of [0, 1] as const) {
    it(`a ${stage ? 'Rot' : 'Fresh'} body can't pass the slot`, () => {
      const w = new World(L);
      body(w, 13, 7, stage);
      hold(w, 0, 20);
      const c = w.corpses[0]!;
      c.shape = 'body'; c.h = STAGE_H[stage]; // keep it a body even if the press catches it
      w.obj.crushers.length = 0;
      hold(w, 0, 300);
      expect(c.x + c.w).toBeLessThanOrEqual(15.25 * U + 1);
    });
  }
  it('a Fresh slab rides through, drops on the plate and opens the staff gate', () => {
    const w = new World(L);
    const c = body(w, 13, 7, 0);
    c.shape = 'slab'; c.h = 60; c.y = 7 * U - 60;
    hold(w, 0, 500);
    expect((w.obj.plates[0] as RtPlate).pressed).toBe(true);
  });
});

describe('L12 Die Trying', () => {
  const L = level('L12');
  const abc = solution('L12').slice(0, 8);
  it('dying at A, B, C in that order leaves Skeleton, Rot, Fresh', () => {
    const w = runPrefix(L, abc);
    const at = (cx: number) => w.corpses.find((c) => Math.abs(c.x - cx * U) < U);
    expect(at(3)?.stage).toBe(2);
    expect(at(19)?.stage).toBe(1);
    expect(at(12)?.stage).toBe(0);
    expect((w.obj.plates.find((p) => p.id === 'pl2') as RtPlate).pressed).toBe(true);
  });
  it('any extra death breaks it: the chimney ledge crumbles to dust', () => {
    const w = runPrefix(L, abc);
    until(w, 0, respawned);
    w.killPip({ kind: 'dropper', x: 8 * U, bottom: 15 * U });
    hold(w, 0, 40);
    expect(w.corpses.some((c) => c.pin?.cx === 3)).toBe(false);
  });
});
