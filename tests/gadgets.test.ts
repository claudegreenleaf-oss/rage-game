// Gadgets: the editor's custom mechanics. Small hand-built levels, one behaviour each.
import { describe, expect, it } from 'vitest';
import { mk } from './helpers';
import { World } from '../src/sim/world';
import { Btn, U, type GadgetObj, type LevelData, type LevelEvent, type SimEvent } from '../src/sim/types';
import type { RtGadget } from '../src/sim/hazards';

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

type G = Partial<GadgetObj> & { id: string; effect: GadgetObj['effect'] };
const gad = (g: G): GadgetObj => ({ type: 'gadget', x: 4, y: 6, w: 1, h: 1, ...g });
const build = (gadgets: G[], extra: Partial<LevelData> = {}, events: LevelEvent[] = [], objects: LevelData['objects'] = []): World =>
  new World({ ...mk(ROOM, { objects: [...gadgets.map(gad), ...objects], events }), ...extra });
const g = (w: World, id: string) => w.obj.get<RtGadget>(id)!;

/** Step n ticks, returning every SimEvent emitted. */
function run(w: World, mask: number, n: number, each?: (w: World) => void): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < n; i++) { w.step(mask); out.push(...w.fx); each?.(w); }
  return out;
}
const respawnAndSettle = (w: World) => { w.killPipBy('spike'); run(w, 0, 60); };

describe('gadget effects', () => {
  it('kill: kills Pip with the given cause (default spike), not bodies', () => {
    let w = build([{ id: 'k', effect: { kind: 'kill' } }]);
    run(w, Btn.Right, 40);
    expect(w.deathCount).toBe(1);
    expect(w.lastDeath).toBe('spike');
    w = build([{ id: 'k', effect: { kind: 'kill', cause: 'laser' } }]);
    run(w, Btn.Right, 40);
    expect(w.lastDeath).toBe('laser');
    w = build([{ id: 'k', effect: { kind: 'kill' }, affects: { player: false } }]);
    run(w, Btn.Right, 40);
    expect(w.deathCount).toBe(0);
  });

  it('bounce: launches Pip to about `height` tiles using the current gravity', () => {
    const w = build([{ id: 'b', effect: { kind: 'bounce', height: 4 } }]);
    run(w, 0, 10);
    const floorY = w.pip.y;
    let min = floorY;
    const ev = run(w, Btn.Right, 40, () => { min = Math.min(min, w.pip.y); });
    expect(ev.some((e) => e.t === 'gadget' && e.what === 'bounce')).toBe(true);
    const rise = (floorY - min) / U;
    expect(rise).toBeGreaterThan(3.9);
    expect(rise).toBeLessThan(4.7);
  });

  it('bounce on a solid pad works from standing, and bounces crates', () => {
    const w = build([{ id: 'b', x: 8, y: 6, effect: { kind: 'bounce', height: 3 } }], {}, [], [{ type: 'crate', id: 'c1', x: 8, y: 2 }]);
    const crate = w.corpses.find((c) => c.crateId === 'c1')!;
    let min = crate.y;
    run(w, 0, 80, () => { min = Math.min(min, crate.y); });
    expect(min).toBeLessThan(5 * U - 2 * U); // rose well above where it rests on the floor (y = 6 tiles)
  });

  it('launch: sets velocity', () => {
    const w = build([{ id: 'l', effect: { kind: 'launch', vx: 0, vy: -20 } }]);
    run(w, 0, 10);
    const y0 = w.pip.y;
    let min = y0;
    run(w, Btn.Right, 30, () => { min = Math.min(min, w.pip.y); });
    expect((y0 - min) / U).toBeGreaterThan(2.5);
  });

  it('force: accelerates what is inside (updraft)', () => {
    const w = build([{ id: 'f', x: 0, y: 1, w: 4, h: 6, effect: { kind: 'force', ax: 0, ay: -150 } }]);
    run(w, 0, 5);
    const y0 = w.pip.y;
    run(w, 0, 30);
    expect(w.pip.y).toBeLessThan(y0 - U);
  });

  it('gravity: scales gravity while inside (moon jump is higher)', () => {
    const apex = (gadgets: G[]) => {
      const w = build(gadgets);
      run(w, 0, 10);
      const y0 = w.pip.y; let min = y0;
      run(w, Btn.Jump, 50, () => { min = Math.min(min, w.pip.y); });
      return (y0 - min) / U;
    };
    const normal = apex([]);
    const moon = apex([{ id: 'm', x: 0, y: 0, w: 4, h: 7, effect: { kind: 'gravity', scale: 0.25 } }]);
    expect(moon).toBeGreaterThan(normal * 1.5);
  });

  it('slow: damps velocity while inside', () => {
    const w = build([{ id: 's', x: 0, y: 5, w: 6, h: 2, effect: { kind: 'slow', factor: 0.5 } }]);
    run(w, Btn.Right, 12);
    expect(w.pip.vx).toBeLessThan(15);
    const free = build([]);
    run(free, Btn.Right, 12);
    expect(free.pip.vx).toBe(28);
  });

  it('teleport to a tile point', () => {
    const w = build([{ id: 't', x: 3, y: 6, effect: { kind: 'teleport', to: { x: 12, y: 6 } } }]);
    const ev = run(w, Btn.Right, 40);
    expect(ev.some((e) => e.t === 'gadget' && e.what === 'teleport')).toBe(true);
    expect(w.pip.x).toBeGreaterThan(12 * U);
  });

  it('teleport between two gadgets does not ping-pong', () => {
    const w = build([
      { id: 'a', x: 3, y: 6, effect: { kind: 'teleport', to: 'b' } },
      { id: 'b', x: 9, y: 6, effect: { kind: 'teleport', to: 'a' } },
    ]);
    let jumps = 0;
    run(w, Btn.Right, 40, () => { jumps += w.fx.filter((e) => e.t === 'gadget' && e.what === 'teleport').length; });
    expect(jumps).toBe(1);
    expect(w.pip.x).toBeGreaterThan(9 * U);
    // Walking back into B after leaving it works again.
    run(w, Btn.Left, 60, () => { jumps += w.fx.filter((e) => e.t === 'gadget' && e.what === 'teleport').length; });
    expect(jumps).toBe(2);
  });

  it('conveyor: carries riders (and the gadget is solid)', () => {
    const w = build([{ id: 'cv', x: 0, y: 6, w: 4, h: 1, solid: 'solid', effect: { kind: 'conveyor', speed: 2 } }]);
    run(w, 0, 5);
    const x0 = w.pip.x;
    expect(w.pip.y + w.pip.h).toBe(6 * U); // standing on top of it
    run(w, 0, 20);
    expect(w.pip.x - x0).toBeGreaterThan(100);
  });

  it('checkpoint: becomes the respawn point', () => {
    const w = build([{ id: 'cp', x: 7, y: 6, effect: { kind: 'checkpoint' } }]);
    const ev = run(w, Btn.Right, 80);
    expect(ev.some((e) => e.t === 'checkpoint' && e.id === 'cp')).toBe(true);
    respawnAndSettle(w);
    expect(w.pip.x).toBeGreaterThan(6.5 * U);
  });

  it('win: touching wins the level', () => {
    const w = build([{ id: 'w', x: 5, y: 6, effect: { kind: 'win' } }]);
    run(w, Btn.Right, 40);
    expect(w.won).toBe(true);
  });

  it('once: gone after the first touch (standing on it counts), not solid, back after respawn', () => {
    const w = build([{ id: 'o', x: 4, y: 6, w: 2, solid: 'solid', effect: { kind: 'none' }, once: true, affects: { bodies: false } }]);
    run(w, Btn.Right, 12);
    expect(g(w, 'o').gone).toBe(false); // bumping its side is not a touch
    let t = 0;
    while (!g(w, 'o').gone && t++ < 60) w.step(Btn.Right | (t === 1 ? Btn.Jump : 0));
    expect(g(w, 'o').gone).toBe(true);
    expect(w.obj.dynamicSolids().some((s) => s.id === 'o')).toBe(false);
    respawnAndSettle(w);
    expect(g(w, 'o').gone).toBe(false);
  });
});

describe('gadget state', () => {
  const PLATE = { type: 'plate' as const, id: 'pl', x: 3, y: 6, w: 1, need: 1 };
  it('link follows a plate; invert flips it; the link overrides `on`', () => {
    const w = build([
      { id: 'l', x: 9, effect: { kind: 'none' }, link: 'pl', on: true },
      { id: 'i', x: 10, effect: { kind: 'none' }, link: 'pl', invert: true },
    ], {}, [], [PLATE]);
    run(w, 0, 3);
    expect(g(w, 'l').on).toBe(false);
    expect(g(w, 'i').on).toBe(true);
    const ev = run(w, Btn.Right, 18);
    expect(g(w, 'l').on).toBe(true);
    expect(g(w, 'i').on).toBe(false);
    expect(ev.filter((e) => e.t === 'gadget' && e.what === 'on').length).toBe(1);
    expect(ev.filter((e) => e.t === 'gadget' && e.what === 'off').length).toBe(1);
  });

  it('when: follows a condition; the condition beats `on` and actions', () => {
    const w = build([{ id: 'w', x: 9, effect: { kind: 'none' }, when: { type: 'var', name: 'v', op: '>=', value: 1 } }], { vars: [{ name: 'v', value: 0 }] },
      [{ trigger: { type: 'timer', ticks: 10 }, actions: [{ type: 'setVar', name: 'v', op: 'set', value: 1 }] },
       { trigger: { type: 'timer', ticks: 20 }, actions: [{ type: 'gadget', target: 'w', op: 'off' }] }]);
    run(w, 0, 5);
    expect(g(w, 'w').on).toBe(false);
    run(w, 0, 10);
    expect(g(w, 'w').on).toBe(true);
    run(w, 0, 10);
    expect(g(w, 'w').on).toBe(true);
  });

  it('actions: on, off, toggle', () => {
    const w = build([{ id: 'a', x: 9, effect: { kind: 'none' }, on: false }], {}, [
      { trigger: { type: 'timer', ticks: 5 }, actions: [{ type: 'gadget', target: 'a', op: 'on' }] },
      { trigger: { type: 'timer', ticks: 10 }, actions: [{ type: 'gadget', target: 'a', op: 'toggle' }] },
    ]);
    expect(g(w, 'a').on).toBe(false);
    run(w, 0, 6);
    expect(g(w, 'a').on).toBe(true);
    run(w, 0, 5);
    expect(g(w, 'a').on).toBe(false);
  });

  it('off gadgets are not solid and do nothing', () => {
    const w = build([{ id: 'k', effect: { kind: 'kill' }, on: false, solid: 'solid' }]);
    run(w, Btn.Right, 40);
    expect(w.deathCount).toBe(0);
    expect(w.obj.dynamicSolids().some((s) => s.id === 'k')).toBe(false);
  });
});

describe('moving gadgets', () => {
  const rider = (extra: Partial<GadgetObj>) => ({
    id: 'm', x: 0, y: 6, w: 3, h: 1, solid: 'solid' as const, effect: { kind: 'none' as const },
    path: [{ x: 0, y: 6 }, { x: 8, y: 6 }], speed: 2, ...extra,
  });

  it('a solid moving gadget carries Pip', () => {
    const w = build([rider({})]);
    run(w, 0, 3);
    const gx = g(w, 'm').x, px = w.pip.x;
    run(w, 0, 60);
    expect(g(w, 'm').x - gx).toBeGreaterThan(400);
    expect(w.pip.x - px).toBeGreaterThan(400);
    expect(Math.abs((w.pip.x - g(w, 'm').x) - (px - gx))).toBeLessThan(U / 2);
    expect(g(w, 'm').px).toBeLessThan(g(w, 'm').x);
  });

  it('ping-pongs along its path (or loops)', () => {
    const w = build([rider({ path: [{ x: 0, y: 6 }, { x: 3, y: 6 }], speed: 6, solid: 'none' })]);
    let max = 0;
    run(w, 0, 50, () => { max = Math.max(max, g(w, 'm').x); });
    expect(max).toBe(3 * U);
    expect(g(w, 'm').x).toBeLessThan(3 * U);
    const l = build([rider({ path: [{ x: 0, y: 6 }, { x: 3, y: 6 }, { x: 3, y: 3 }], speed: 6, loop: true, solid: 'none' })]);
    run(l, 0, 200);
    expect(g(l, 'm').seg).toBeGreaterThanOrEqual(0);
  });

  it("move 'trigger' waits for a start action; stop pauses; reverse turns around", () => {
    const w = build([rider({ solid: 'none', move: 'trigger' })], {}, [
      { trigger: { type: 'timer', ticks: 20 }, actions: [{ type: 'gadget', target: 'm', op: 'start' }] },
      { trigger: { type: 'timer', ticks: 40 }, actions: [{ type: 'gadget', target: 'm', op: 'reverse' }] },
      { trigger: { type: 'timer', ticks: 50 }, actions: [{ type: 'gadget', target: 'm', op: 'stop' }] },
    ]);
    run(w, 0, 15);
    expect(g(w, 'm').x).toBe(0);
    run(w, 0, 25);
    const x40 = g(w, 'm').x;
    expect(x40).toBeGreaterThan(0);
    run(w, 0, 10);
    const x50 = g(w, 'm').x;
    expect(x50).toBeLessThan(x40);
    run(w, 0, 10);
    expect(g(w, 'm').x).toBe(x50);
  });

  it("move 'whenOn' only moves while on", () => {
    const w = build([rider({ solid: 'none', move: 'whenOn', on: false })], {}, [
      { trigger: { type: 'timer', ticks: 10 }, actions: [{ type: 'gadget', target: 'm', op: 'on' }] },
    ]);
    run(w, 0, 9);
    expect(g(w, 'm').x).toBe(0);
    run(w, 0, 10);
    expect(g(w, 'm').x).toBeGreaterThan(0);
  });
});

describe('collect gadgets', () => {
  const coin = (extra: Partial<GadgetObj> = {}) => ({ id: 'c', x: 5, y: 6, effect: { kind: 'collect' as const, var: 'coins' }, ...extra });
  it('adds to the variable, vanishes, emits collect', () => {
    const w = build([coin()], { vars: [{ name: 'coins', value: 0, keep: true }] });
    const ev = run(w, Btn.Right, 40);
    expect(w.vars.get('coins')).toBe(1);
    expect(g(w, 'c').gone).toBe(true);
    expect(ev.some((e) => e.t === 'collect' && e.id === 'c')).toBe(true);
    expect(ev.some((e) => e.t === 'var' && e.name === 'coins' && e.value === 1)).toBe(true);
  });

  it('with a keep variable it stays collected after death; restart brings it back', () => {
    const w = build([coin()], { vars: [{ name: 'coins', value: 0, keep: true }] });
    run(w, Btn.Right, 40);
    respawnAndSettle(w);
    expect(w.vars.get('coins')).toBe(1);
    expect(g(w, 'c').gone).toBe(true);
    w.restart();
    expect(w.vars.get('coins')).toBe(0);
    expect(g(w, 'c').gone).toBe(false);
  });

  it('with a resetting variable it comes back with the variable', () => {
    const w = build([coin()], { vars: [{ name: 'coins', value: 0 }] });
    run(w, Btn.Right, 40);
    expect(w.vars.get('coins')).toBe(1);
    respawnAndSettle(w);
    expect(w.vars.get('coins')).toBe(0);
    expect(g(w, 'c').gone).toBe(false);
  });
});
