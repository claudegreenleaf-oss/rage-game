// New mechanics for the connected world: wall-slide/jump, vines, crates, crumbling floors,
// benches, relics, and the campaign's room transitions.
import { describe, expect, it } from 'vitest';
import { hold, mk } from './helpers';
import { allLevels } from '../scripts/levels-node';
import { World } from '../src/sim/world';
import { Campaign, validateWorld, type WorldDef } from '../src/sim/campaign';
import { Btn, U, type LevelData } from '../src/sim/types';
import type { RtPlate } from '../src/sim/hazards';

const SHAFT = `
########
#......#
#......#
#......#
#......#
#......#
#......#
#......#
#......#
#......#
#S.....#
########
`;

function climb(l: LevelData): number {
  const w = new World(l);
  hold(w, 0, 5);
  let best = w.pip.y;
  // Alternate wall jumps between the two walls of the shaft.
  hold(w, Btn.Left, 4);
  hold(w, Btn.Left | Btn.Jump, 14);
  for (let i = 0; i < 6; i++) {
    const side = i % 2 === 0 ? Btn.Left : Btn.Right;
    hold(w, side, 10); // slide on the wall
    hold(w, side | Btn.Jump, 2); // kick off
    hold(w, (side === Btn.Left ? Btn.Right : Btn.Left) | Btn.Jump, 16);
    best = Math.min(best, w.pip.y);
  }
  return (10 * U + U - w.pip.h - best) / U;
}

describe('wall-slide and wall-jump', () => {
  it('climb a shaft by wall-jumping (on by default), but not where a level turns it off', () => {
    const zone = mk(SHAFT, { id: 'Z' });
    zone.kind = 'zone';
    const chamber = mk(SHAFT, { id: 'C' });
    const off = mk(SHAFT, { id: 'O' });
    off.abilities = { wallJump: false };
    expect(climb(zone)).toBeGreaterThan(3.2); // a plain jump is ~2.4
    expect(climb(chamber)).toBeGreaterThan(3.2);
    expect(climb(off)).toBeLessThan(2.6);
  });

  it('every shipped puzzle chamber keeps wall jumping off (they were designed without it)', () => {
    for (const l of allLevels().filter((x) => /^L\d+$/.test(x.id))) expect(l.abilities?.wallJump, l.id).toBe(false);
  });

  it('pressing into a wall while falling slows the fall', () => {
    const zone = mk(SHAFT);
    zone.kind = 'zone';
    const w = new World(zone);
    w.pip.x = 1 * U; w.pip.y = 2 * U; w.pip.px = w.pip.x; w.pip.py = w.pip.y;
    hold(w, Btn.Left, 30);
    expect(w.pip.vy).toBeLessThanOrEqual(20);
  });
});

describe('vines', () => {
  const VINES = `
##########################
#........................#
#........................#
#........................#
#........................#
#........................#
#S.......................#
######^^^^^^^^^^^^^^######
`;
  it('Pip grabs a vine mid-air, swings, and leaps further than a plain jump', () => {
    const l = mk(VINES, { objects: [{ type: 'vine', id: 'v1', x: 6, y: 0, len: 4 }] });
    const w = new World(l);
    hold(w, 0, 5);
    hold(w, Btn.Right, 18);
    hold(w, Btn.Right | Btn.Jump, 14);
    let grabbed = false;
    for (let i = 0; i < 40 && !grabbed; i++) { w.step(Btn.Right); grabbed = !!w.pip.hang; }
    expect(grabbed).toBe(true);
    hold(w, Btn.Right, 50); // pump the swing
    // Release on a forward swing.
    for (let i = 0; i < 120; i++) {
      const v = w.obj.vines[0]!;
      const pt = v.pts[w.pip.hang!.seg]!;
      if (pt.x - pt.px > 6) break;
      w.step(Btn.Right);
    }
    const x0 = w.pip.x;
    w.step(Btn.Right | Btn.Jump);
    expect(w.pip.hang).toBeNull();
    hold(w, Btn.Right | Btn.Jump, 60);
    expect(w.pip.x - x0).toBeGreaterThan(4 * U);
  });
});

describe('crates', () => {
  const ROOM = `
##############
#............#
#............#
#S..C.._.....#
##############
`;
  it('push onto a plate (weight 2), never age, and reset on respawn', () => {
    const l = mk(ROOM.replace('C', '.'), { objects: [{ type: 'crate', id: 'k1', x: 4, y: 3 }] });
    const w = new World(l);
    hold(w, 0, 5);
    const crate = () => w.corpses.find((c) => c.kind === 'crate')!;
    expect(crate().x).toBe(4 * U);
    let pressed = false;
    for (let i = 0; i < 200 && !pressed; i++) { w.step(Btn.Right); pressed = (w.obj.plates[0] as RtPlate).weight >= 2; }
    expect(pressed).toBe(true);
    w.killPip({ kind: 'dropper', x: 2 * U, bottom: 4 * U });
    hold(w, 0, 40);
    expect(w.corpses.filter((c) => c.kind !== 'crate')).toHaveLength(1);
    expect(crate().stage).toBe(0);
    expect(crate().x).toBe(4 * U); // back home
  });
});

describe('crumbling floors', () => {
  it('give way after standing on them, and come back on respawn', () => {
    const l = mk(`
##########
#........#
#S.......#
###%%%####
##.....###
##########
`);
    const w = new World(l);
    hold(w, 0, 5);
    hold(w, Btn.Right, 22);
    hold(w, 0, 40);
    expect(w.tileAt(4, 3)).toBe('.');
    w.killPip({ kind: 'pit', x: 0, bottom: 0 });
    hold(w, 0, 40);
    expect(w.tileAt(4, 3)).toBe('%');
  });
});

describe('benches and relics', () => {
  it('a bench becomes the respawn point; relics stay collected', () => {
    const l = mk(`
##############
#............#
#S...........#
##############
`, { objects: [{ type: 'bench', id: 'b1', x: 8, y: 2 }, { type: 'relic', id: 'r1', x: 5, y: 2, kind: 'note', text: 'Day 1.' }] });
    const collected = new Set<string>();
    const w = new World(l, { collected });
    hold(w, Btn.Right, 70);
    expect(collected.has('r1')).toBe(true);
    w.killPip({ kind: 'pit', x: 0, bottom: 0 });
    hold(w, 0, 40);
    expect(w.pip.x).toBeGreaterThan(7 * U);
    const again = new World(l, { collected });
    expect(again.collected.has('r1')).toBe(true);
  });
});

describe('campaign', () => {
  const A = mk(`
##########
#........#
#S........
##########
`, { id: 'A' });
  A.kind = 'zone';
  A.exits = [{ id: 'east', x: 9, y: 2, w: 1, h: 1, to: 'B', toExit: 'west' }];
  const B = mk(`
##########
#........#
.......D.#
##########
`, { id: 'B', props: { door: { to: { room: 'A', exit: 'east' } } } });
  B.kind = 'zone';
  B.exits = [{ id: 'west', x: 0, y: 2, w: 1, h: 1, to: 'A', toExit: 'east' }];
  const def: WorldDef = { version: 1, name: 'test', start: { room: 'A' }, rooms: ['A', 'B'] };

  it('validates links', () => {
    expect(validateWorld(def, [A, B])).toEqual([]);
    const broken = { ...B, exits: [{ id: 'west', x: 0, y: 2, w: 1, h: 1, to: 'A', toExit: 'nope' }] };
    expect(validateWorld(def, [A, broken]).length).toBeGreaterThan(0);
  });

  it('walks through an exit into the next room, keeping momentum, and back out through a won door', () => {
    const c = new Campaign(def, [A, B]);
    expect(c.roomId).toBe('A');
    for (let i = 0; i < 200 && c.roomId === 'A'; i++) c.step(Btn.Right);
    expect(c.roomId).toBe('B');
    expect(c.lastChange?.side).toBe('left');
    expect(c.room.pip.vx).toBeGreaterThan(0);
    for (let i = 0; i < 300 && c.roomId === 'B'; i++) c.step(Btn.Right);
    expect(c.cleared.has('B')).toBe(true);
    expect(c.roomId).toBe('A');
    expect(c.save().visited.sort()).toEqual(['A', 'B']);
  });

  it('death respawns at the room entrance and counts toward the run', () => {
    const c = new Campaign(def, [A, B]);
    for (let i = 0; i < 200 && c.roomId === 'A'; i++) c.step(Btn.Right);
    const entry = c.room.spawnPoint();
    c.room.killPip({ kind: 'pit', x: 0, bottom: 0 });
    for (let i = 0; i < 40; i++) c.step(0);
    expect(c.totalDeaths).toBe(1);
    expect(Math.abs(c.room.pip.x - entry.x)).toBeLessThan(U);
  });
});

describe('level rules', () => {
  const ROOM = `
################
#..............#
#..............#
#..............#
#..............#
#S......^......#
################
`;
  it('jump multiplier and corpse cap / aging switches', () => {
    const apex = (rules?: object) => {
      const l = mk(ROOM); if (rules) l.rules = rules;
      const w = new World(l); hold(w, 0, 5); const y0 = w.pip.y; let m = y0;
      for (let i = 0; i < 50; i++) { w.step(Btn.Jump); m = Math.min(m, w.pip.y); }
      return (y0 - m) / U;
    };
    expect(apex({ jump: 1.3 })).toBeGreaterThan(apex() + 1);
    const l = mk(ROOM); l.rules = { aging: false, maxCorpses: 5 };
    const w = new World(l);
    for (let i = 0; i < 4; i++) { w.killPip({ kind: 'dropper', x: (3 + i * 2) * U, bottom: 6 * U }); hold(w, 0, 40); }
    expect(w.corpses).toHaveLength(4);
    expect(w.corpses.every((c) => c.stage === 0)).toBe(true);
  });
});

describe('flashlight and light sensors', () => {
  const ROOM = `
################
#..............#
#..............#
#S.........#...#
################
`;
  it('a sensor is pressed only while Pip faces it with a clear line of sight, and opens its gate', () => {
    const l = mk(ROOM, { objects: [{ type: 'sensor', id: 'eye', x: 8, y: 3 }, { type: 'gate', id: 'g', x: 13, y: 1, h: 3, plate: 'eye' }] });
    const w = new World(l);
    hold(w, 0, 3);
    const s = w.obj.plates.find((p) => p.id === 'eye')!;
    expect(w.pip.facing).toBe(1);
    expect(s.pressed).toBe(true); // facing right, 7 tiles away
    hold(w, Btn.Left, 2); hold(w, 0, 10);
    expect(s.pressed).toBe(false); // looking away
    hold(w, Btn.Right, 1); hold(w, 0, 20);
    expect(s.pressed).toBe(true);
    expect(w.obj.gates[0]!.open).toBeGreaterThan(0);
  });
  it('walls block the beam', () => {
    const l = mk(ROOM, { objects: [{ type: 'sensor', id: 'eye', x: 13, y: 3 }] });
    const w = new World(l);
    hold(w, 0, 3);
    expect(w.obj.plates.find((p) => p.id === 'eye')!.pressed).toBe(false); // the pillar at col 11 is in the way
  });
  it('the mouse aims the beam: a sensor overhead lights up only when aimed at', () => {
    const l = mk(ROOM, { objects: [{ type: 'sensor', id: 'eye', x: 2, y: 1 }] });
    const w = new World(l);
    hold(w, 0, 3);
    const s = w.obj.plates.find((p) => p.id === 'eye')!;
    expect(s.pressed).toBe(false); // straight ahead misses it
    w.aim = 192; // straight up (64 = down)
    hold(w, 0, 3);
    expect(s.pressed).toBe(true);
    w.aim = 0; // back to the right
    hold(w, 0, 3);
    expect(s.pressed).toBe(false);
  });
});

describe('fast travel', () => {
  it('only to visited rooms, landing at a bench in zones', () => {
    const A = mk(`
##########
#........#
#S........
##########
`, { id: 'A' });
    A.kind = 'zone';
    A.exits = [{ id: 'east', x: 9, y: 2, w: 1, h: 1, to: 'B', toExit: 'west' }];
    const B = mk(`
##########
#........#
.........#
##########
`, { id: 'B', objects: [{ type: 'bench', id: 'b', x: 6, y: 2 }, { type: 'spawn', id: 'spawn', x: 2, y: 2 }, { type: 'door', id: 'door', x: 8, y: 2 }] });
    B.kind = 'zone';
    B.exits = [{ id: 'west', x: 0, y: 2, w: 1, h: 1, to: 'A', toExit: 'east' }];
    const c = new Campaign({ version: 1, name: 't', start: { room: 'A' }, rooms: ['A', 'B'] }, [A, B]);
    expect(c.travelTo('B')).toBe(false);
    for (let i = 0; i < 200 && c.roomId === 'A'; i++) c.step(Btn.Right);
    for (let i = 0; i < 30; i++) c.step(Btn.Left);
    expect(c.travelTo('A')).toBe(true);
    expect(c.roomId).toBe('A');
    expect(c.travelTo('B')).toBe(true);
    expect(Math.abs(c.room.pip.x - 6 * U)).toBeLessThan(U);
  });
});
