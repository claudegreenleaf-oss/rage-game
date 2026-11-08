// Unit tests for the core rules (Spec §4, §5, §6, §9).
import { describe, expect, it } from 'vitest';
import { hold, mk } from './helpers';
import { World } from '../src/sim/world';
import { spawnCorpse } from '../src/sim/corpse';
import { Btn, U, type Corpse } from '../src/sim/types';
import { BOUNCE_RISE, PIN_FLOOR_H, PUSH_SPEED, STEP_UP } from '../src/sim/constants';
import { signText, type RtDoor, type RtPlate } from '../src/sim/hazards';
import { moveDoor } from '../src/sim/hazards';

const ROOM = `
################
#..............#
#..............#
#..............#
#..............#
#..............#
#S............D#
################
`;

/** Drop a corpse of a given stage at tile column `cx`, resting on the floor row `floor`. */
function addCorpse(w: World, cx: number, bottomTiles: number, stage: 0 | 1 | 2 = 0): Corpse {
  spawnCorpse(w, { kind: 'dropper', x: cx * U + U / 2, bottom: bottomTiles * U });
  const c = w.corpses[w.corpses.length - 1]!;
  if (stage) { c.stage = stage; c.h = [192, 108, 48][stage]!; c.y = bottomTiles * U - c.h; }
  return c;
}

describe('Pip movement feel', () => {
  const settle = (w: World) => hold(w, 0, 10);
  it('jumps ~2.4 tiles held and ~1.2 tapped', () => {
    for (const [mask, lo, hi] of [[Btn.Jump, 2.3, 2.5], [0, 1.0, 1.3]] as const) {
      const w = new World(mk(ROOM));
      settle(w);
      const y0 = w.pip.y;
      let min = y0;
      w.step(Btn.Jump);
      for (let i = 0; i < 60; i++) { w.step(mask); min = Math.min(min, w.pip.y); }
      const apex = (y0 - min) / U;
      expect(apex).toBeGreaterThan(lo);
      expect(apex).toBeLessThan(hi);
    }
  });

  it('reaches full speed in ~0.06 s and stops in ~0.05 s (no ice-skating)', () => {
    const w = new World(mk(ROOM));
    settle(w);
    let ticks = 0;
    while (w.pip.vx < 28 && ticks < 30) { w.step(Btn.Right); ticks++; }
    expect(ticks).toBeLessThanOrEqual(4);
    hold(w, Btn.Right, 10);
    let stop = 0;
    while (w.pip.vx !== 0 && stop < 30) { w.step(0); stop++; }
    expect(stop).toBeLessThanOrEqual(3);
  });

  it('clears a gap of about 4.5 tiles with a running jump', () => {
    const w = new World(mk(ROOM));
    settle(w);
    hold(w, Btn.Right, 20);
    const x0 = w.pip.x;
    w.step(Btn.Right | Btn.Jump);
    let t = 0;
    while (!w.pip.grounded && t < 100) { w.step(Btn.Right | Btn.Jump); t++; }
    const gap = (w.pip.x - x0) / U + w.pip.w / U; // edge to edge
    expect(gap).toBeGreaterThan(4.2);
    expect(gap).toBeLessThan(5.2);
  });

  it('steps up onto low lips without jumping', () => {
    const w = new World(mk(ROOM));
    settle(w);
    const c = addCorpse(w, 6, 7, 0);
    c.shape = 'slab'; c.h = 60; c.y = 7 * U - 60; // a 0.25-tall slab
    expect(60).toBeLessThanOrEqual(STEP_UP);
    hold(w, Btn.Right, 70);
    expect(w.pip.x).toBeGreaterThan(7 * U); // walked over it
    expect(w.deathCount).toBe(0);
  });
});

describe('corpse lifecycle', () => {
  it('every death that leaves a body ages the others; the cap is 3 and the oldest turns to dust', () => {
    const w = new World(mk(ROOM));
    addCorpse(w, 3, 7);
    addCorpse(w, 6, 7);
    addCorpse(w, 9, 7);
    expect(w.corpses.map((c) => c.stage)).toEqual([2, 1, 0]);
    const firstId = w.corpses[0]!.id;
    addCorpse(w, 12, 7);
    expect(w.corpses).toHaveLength(3);
    expect(w.corpses.some((c) => c.id === firstId)).toBe(false);
    expect(w.corpses.map((c) => c.stage)).toEqual([2, 1, 0]);
  });

  it('pit and laser deaths leave no body and age nothing', () => {
    const w = new World(mk(ROOM));
    addCorpse(w, 3, 7);
    spawnCorpse(w, { kind: 'pit', x: 0, bottom: 0 });
    spawnCorpse(w, { kind: 'laser', x: 0, bottom: 0 });
    expect(w.corpses.map((c) => c.stage)).toEqual([0]);
  });

  it('R clears every corpse and restarts, keeping the death count', () => {
    const w = new World(mk(`
##########
#S....^..#
##########
`));
    hold(w, Btn.Right, 80);
    expect(w.deathCount).toBe(1);
    expect(w.corpses).toHaveLength(1);
    w.step(Btn.Restart);
    expect(w.corpses).toHaveLength(0);
    expect(w.deathCount).toBe(1);
  });
});

describe('how you die shapes the body', () => {
  it('floor spikes pin the body flush over them, making that tile safe', () => {
    const w = new World(mk(`
############
#S...^.....#
############
`));
    hold(w, Btn.Right, 60);
    expect(w.deathCount).toBe(1);
    const c = w.corpses[0]!;
    expect(c.pin?.kind).toBe('floor');
    expect(c.h).toBe(PIN_FLOOR_H);
    hold(w, Btn.Right, 140); // respawn and walk across
    expect(w.deathCount).toBe(1);
    expect(w.pip.x).toBeGreaterThan(7 * U);
  });

  it('wall spikes pin the body as a ledge you can stand on', () => {
    const w = new World(mk(`
#######
#.....#
#.....#
#>....#
#S....#
#######
`));
    hold(w, Btn.Jump, 30);
    expect(w.corpses[0]?.pin?.kind).toBe('wall');
    const ledge = w.corpses[0]!;
    expect(ledge.y).toBeLessThan(4 * U);
    hold(w, 0, 60);
    // Pip lands on it: jump from beside and drift left.
    hold(w, Btn.Right, 9); hold(w, 0, 6);
    hold(w, Btn.Jump, 12); hold(w, Btn.Left | Btn.Jump, 12); hold(w, 0, 10);
    expect(w.pip.y + w.pip.h).toBe(ledge.y);
  });

  it('ceiling spikes drop an ordinary body', () => {
    const w = new World(mk(`
#######
#.vvv.#
#.....#
#S....#
#######
`));
    hold(w, Btn.Right, 8); hold(w, Btn.Right | Btn.Jump, 20); hold(w, 0, 60);
    const c = w.corpses[0]!;
    expect(c.pin).toBeNull();
    expect(c.shape).toBe('body');
    expect(c.y + c.h).toBe(4 * U); // fell to the floor
  });

  it('crushers leave a slab, droppers an ordinary body, water a floating raft that drifts', () => {
    const crush = new World(mk(`
##########
#...C....#
#........#
#S.......#
##########
`, { props: { c1: { period: 30 } } }));
    hold(crush, Btn.Right, 25); hold(crush, 0, 60);
    expect(crush.corpses[0]?.shape).toBe('slab');

    const drop = new World(mk(`
##########
#....d...#
#........#
#S.......#
##########
`));
    hold(drop, Btn.Right, 60);
    expect(drop.lastDeath).toBe('dropper');
    expect(drop.corpses[0]?.shape).toBe('body');

    const water = new World(mk(`
############
#..........#
#S.........#
###~~~~~~###
###~~~~~~###
############
`, { current: { dir: 1, speed: 2 } }));
    hold(water, Btn.Right, 30);
    expect(water.lastDeath).toBe('water');
    const raft = water.corpses[0]!;
    expect(raft.floating).toBe(true);
    const x0 = raft.x;
    hold(water, 0, 30);
    expect(raft.x).toBeGreaterThan(x0);
    expect(raft.y + raft.h).toBe(3 * U); // floats on the surface
  });
});

describe('weight, stacks and plates', () => {
  it('weight passes down a stack: Rot (1) on Fresh (2) on a heavy plate = 3', () => {
    const w = new World(mk(`
##########
#........#
#........#
#S...3...#
##########
`));
    addCorpse(w, 5, 4 - 0.05, 0);
    hold(w, 0, 20);
    const plate = w.obj.plates[0] as RtPlate;
    expect(plate.weight).toBe(2);
    expect(plate.pressed).toBe(false);
    const fresh = w.corpses[0]!;
    // Age it by adding another body on top: the first becomes Rot (1), the new one Fresh (2).
    spawnCorpse(w, { kind: 'dropper', x: 5 * U + U / 2, bottom: fresh.y - 2 * U });
    hold(w, 0, 40);
    expect(plate.weight).toBe(3);
    expect(plate.pressed).toBe(true);
  });
});

describe('respawn reset rule', () => {
  it('a corpse riding a moving platform falls when the platform resets', () => {
    const w = new World(mk(`
################
#..............#
#..............#
#S.............#
##MM...........#
################
`, { props: { m1: { path: [{ x: 2, y: 4 }, { x: 10, y: 4 }], start: 'always', speed: 4 } } }));
    addCorpse(w, 3, 4, 0);
    hold(w, 0, 140);
    const c = w.corpses[0]!;
    expect(c.x).toBeGreaterThan(9 * U); // carried along
    w.pipAlive = false; w.respawnTimer = 1; // force a respawn
    w.step(0);
    expect(w.obj.platforms[0]!.x).toBeLessThan(3 * U); // platform reset
    hold(w, 0, 30);
    expect(c.y + c.h).toBe(5 * U); // body fell to the floor below
  });

  it('a corpse on a plate keeps holding it down across respawns', () => {
    const w = new World(mk(`
############
#..........#
#..........#
#S.._....|D#
############
`, { props: { g1: { y: 1, h: 3, plate: 'pl1' } } }));
    addCorpse(w, 4, 4 - 0.05, 0);
    hold(w, 0, 20);
    expect((w.obj.plates[0] as RtPlate).pressed).toBe(true);
    w.killPip({ kind: 'pit', x: 0, bottom: 0 });
    hold(w, 0, 60);
    expect(w.pipAlive).toBe(true);
    expect((w.obj.plates[0] as RtPlate).pressed).toBe(true);
    expect(w.obj.gates[0]!.open).toBe(1);
  });
});

describe('Rot and Skeleton physics', () => {
  it('landing on Rot launches Pip ~5.5 tiles above the floor it rests on; walking onto it does not', () => {
    const w = new World(mk(`
############
#..........#
#..........#
#..........#
#..........#
#..........#
#..........#
#..........#
#S.........#
############
`));
    const rot = addCorpse(w, 4, 9, 1);
    hold(w, 0, 5);
    hold(w, Btn.Right, 12); // walk into it from the side: pushes, no bounce
    expect(w.fx.some((e) => e.t === 'bounce')).toBe(false);
    hold(w, 0, 10);
    // Jump onto it from above.
    w.pip.x = rot.x + 30; w.pip.y = rot.y - 3 * U; w.pip.vy = 0; w.pip.vx = 0;
    let bounced = false;
    let min = Infinity;
    for (let i = 0; i < 90; i++) {
      w.step(0);
      if (w.fx.some((e) => e.t === 'bounce')) bounced = true;
      if (bounced) min = Math.min(min, w.pip.y + w.pip.h);
    }
    expect(bounced).toBe(true);
    const apexAboveFloor = (9 * U - min) / U;
    expect(apexAboveFloor).toBeGreaterThan(5.2);
    expect(apexAboveFloor).toBeLessThan(5.8);
    expect(BOUNCE_RISE).toBe(5.5 * U);
  });

  it('Skeletons are one-way: jump up through, stand on top, ↓ drops through', () => {
    const w = new World(mk(`
##########
#........#
#........#
#........#
#S.......#
##########
`));
    // A pinned skeleton ledge floating at 1.5 tiles up, over Pip's head.
    const c = addCorpse(w, 2, 5, 2);
    c.pin = { kind: 'wall', cx: 2, cy: 3 };
    c.x = 1 * U; c.y = 3 * U + 120; c.w = 2 * U;
    hold(w, 0, 5);
    hold(w, Btn.Jump, 30); hold(w, 0, 20);
    expect(w.pip.y + w.pip.h).toBe(c.y); // standing on it after jumping up through
    hold(w, Btn.Down, 2); hold(w, 0, 30);
    expect(w.pip.y + w.pip.h).toBe(5 * U); // dropped through to the floor
  });

  it('push speeds: Fresh heavy, Rot medium, Skeleton slides fast', () => {
    expect(PUSH_SPEED[0]).toBeLessThan(PUSH_SPEED[1]);
    expect(PUSH_SPEED[1]).toBeLessThan(PUSH_SPEED[2]);
    const w = new World(mk(ROOM));
    const c = addCorpse(w, 4, 7, 0);
    hold(w, 0, 5);
    const x0 = c.x;
    hold(w, Btn.Right, 60);
    const moved = c.x - x0;
    expect(moved).toBeGreaterThan(0);
    expect(moved).toBeLessThanOrEqual(60 * PUSH_SPEED[0]);
  });
});

describe('doors and bodies', () => {
  const doorLevel = mk(`
################
#..............#
#S...D.........#
################
`);
  for (const [stage, blocks] of [[0, true], [1, true], [2, false]] as const) {
    it(`a sliding door ${blocks ? 'is blocked by' : 'shoves aside'} a ${['Fresh', 'Rot', 'Skeleton'][stage]} body`, () => {
      const w = new World(doorLevel);
      addCorpse(w, 8, 3, stage);
      hold(w, 0, 5);
      const door = w.obj.doors[0] as RtDoor;
      moveDoor(door, [{ x: 13, y: 2 }], 4);
      hold(w, 0, 200);
      if (blocks) expect(door.x + door.w).toBeLessThanOrEqual(8 * U);
      else expect(door.x).toBeGreaterThan(12 * U);
    });
  }
});

describe('signs and events', () => {
  it('sign text follows the death count', () => {
    const w = new World(mk(`
##########
#S.?..^..#
##########
`, { props: { s1: { text: { 0: 'SAFE', 1: 'See?' } } } }));
    expect(signText(w, w.obj.signs[0]!)).toBe('SAFE');
    hold(w, Btn.Right, 60);
    expect(signText(w, w.obj.signs[0]!)).toBe('See?');
  });

  it('events fire once per life with delays, and re-arm on respawn', () => {
    const w = new World(mk(`
############
#..........#
#S.....p...#
############
`, {
      zones: [{ id: 'z', x: 4, y: 2, w: 1, h: 1 }],
      events: [{ trigger: { type: 'playerEnters', zone: 'z' }, actions: [{ type: 'popSpike', target: 'p1', delay: 10 }], once: true }],
    }));
    hold(w, Btn.Right, 22);
    expect(w.obj.popups[0]!.up).toBe(false);
    hold(w, 0, 14);
    expect(w.obj.popups[0]!.up).toBe(true);
    w.killPip({ kind: 'pit', x: 0, bottom: 0 });
    hold(w, 0, 40);
    expect(w.obj.popups[0]!.up).toBe(false); // the level forgets
  });
});

describe('softlock relief', () => {
  it('holding ↓ while walking away drags a body off a wall', () => {
    const w = new World(mk(`
############
#..........#
#..........#
#S.........#
############
`));
    const c = addCorpse(w, 1, 4, 0); // against the left wall
    w.pip.x = 2 * U; w.pip.px = w.pip.x; // standing right next to it
    hold(w, 0, 10);
    expect(c.x).toBe(1 * U);
    hold(w, Btn.Right, 20); // plain walking leaves it behind
    expect(c.x).toBe(1 * U);
    w.pip.x = 2 * U; w.pip.vx = 0;
    hold(w, 0, 5);
    hold(w, Btn.Right | Btn.Down, 40);
    expect(c.x).toBeGreaterThan(2 * U);
    expect(w.pip.x).toBe(c.x + c.w);
  });

  it('suggests R when the player is well past par since the last restart', () => {
    const w = new World(mk(`
##########
#S.......#
##..######
`, { par: 1 } as never));
    w.level.par = 1;
    expect(w.suggestRestart).toBe(false);
    for (let i = 0; i < 3; i++) { w.killPip({ kind: 'pit', x: 0, bottom: 0 }); hold(w, 0, 40); }
    expect(w.suggestRestart).toBe(true);
    w.step(Btn.Restart);
    expect(w.suggestRestart).toBe(false);
  });
});
