// Events: triggers, conditions, actions, variables, air jumps.
import { describe, expect, it } from 'vitest';
import { mk } from './helpers';
import { World } from '../src/sim/world';
import { evalCondition } from '../src/sim/triggers';
import { validateLevel } from '../src/sim/level';
import { Btn, U, type Action, type Condition, type GadgetObj, type LevelData, type LevelEvent, type SimEvent, type Trigger } from '../src/sim/types';

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

const add = (name: string): Action => ({ type: 'setVar', name, op: 'add', value: 1 });
const ev = (trigger: Trigger, actions: Action[], extra: Partial<LevelEvent> = {}): LevelEvent => ({ trigger, actions, ...extra });
const build = (events: LevelEvent[], extra: Partial<LevelData> = {}, objects: LevelData['objects'] = [], zones: LevelData['zones'] = []): World =>
  new World({ ...mk(ROOM, { objects, events, zones }), vars: [{ name: 'n', value: 0, keep: true }, { name: 'm', value: 0 }], ...extra });
function run(w: World, mask: number, n: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < n; i++) { w.step(mask); out.push(...w.fx); }
  return out;
}
const n = (w: World, name = 'n') => w.vars.get(name);
const respawn = (w: World) => { w.killPipBy('spike'); run(w, 0, 60); };
const gadget = (g: Partial<GadgetObj> & { id: string }): GadgetObj => ({ type: 'gadget', x: 4, y: 6, w: 1, h: 1, effect: { kind: 'none' }, ...g });

describe('event basics', () => {
  it('skips disabled events and checks `if` conditions', () => {
    const w = build([
      ev({ type: 'timer', ticks: 3 }, [add('n')], { enabled: false }),
      ev({ type: 'timer', ticks: 3 }, [add('n')], { if: [{ type: 'var', name: 'n', op: '==', value: 5 }] }),
      ev({ type: 'timer', ticks: 3 }, [add('n')], { if: [{ type: 'var', name: 'n', op: '==', value: 0 }, { type: 'deaths', op: '==', value: 0 }] }),
    ]);
    run(w, 0, 10);
    expect(n(w)).toBe(1);
  });

  it('`once` is only spent when the conditions hold', () => {
    const w = build([ev({ type: 'every', ticks: 2 }, [add('n')], { once: true, if: [{ type: 'var', name: 'm', op: '>=', value: 1 }] }),
      ev({ type: 'timer', ticks: 5 }, [add('m')])]);
    run(w, 0, 12);
    expect(n(w)).toBe(1);
  });
});

describe('triggers', () => {
  it('start fires on every life start', () => {
    const w = build([ev({ type: 'start' }, [add('n')])]);
    expect(n(w)).toBe(1);
    respawn(w);
    expect(n(w)).toBe(2);
    w.restart();
    expect(n(w)).toBe(1); // restart resets keep vars too, then start fires
  });

  it('every repeats (phase defaults to the period)', () => {
    const w = build([ev({ type: 'every', ticks: 10 }, [add('n')]), ev({ type: 'every', ticks: 10, phase: 3 }, [add('m')])]);
    run(w, 0, 35);
    expect(n(w)).toBe(3);
    expect(n(w, 'm')).toBe(4); // 3, 13, 23, 33
  });

  it('playerLeaves fires when Pip leaves a zone (not when dying in it)', () => {
    const zones = [{ id: 'z', x: 0, y: 5, w: 3, h: 2 }];
    const w = build([ev({ type: 'playerLeaves', zone: 'z' }, [add('n')])], {}, [], zones);
    run(w, 0, 5);
    expect(n(w)).toBe(0);
    run(w, Btn.Right, 40);
    expect(n(w)).toBe(1);
    const d = build([ev({ type: 'playerLeaves', zone: 'z' }, [add('n')])], {}, [], zones);
    run(d, 0, 5);
    d.killPipBy('spike');
    run(d, 0, 10);
    expect(n(d)).toBe(0);
  });

  it('playerDies fires with the cause (and can filter on it)', () => {
    const w = build([
      ev({ type: 'playerDies' }, [add('n')]),
      ev({ type: 'playerDies', cause: 'laser' }, [add('m')]),
    ]);
    w.killPipBy('spike');
    expect(n(w)).toBe(1);
    expect(n(w, 'm')).toBe(0); // the non-keep var is the same either way until respawn
    run(w, 0, 60);
    w.killPipBy('laser');
    expect(n(w)).toBe(2);
    expect(n(w, 'm')).toBe(1);
  });

  it('touch is an edge over a gadget; bodyTouch over a zone for a crate', () => {
    const w = build([ev({ type: 'touch', target: 'g' }, [add('n')])], {}, [gadget({ id: 'g' })]);
    run(w, Btn.Right, 40);
    expect(n(w)).toBe(1);
    run(w, 0, 20);
    expect(n(w)).toBe(1);
    const b = build([ev({ type: 'bodyTouch', target: 'z' }, [add('n')])], {}, [{ type: 'crate', id: 'c1', x: 8, y: 1 }], [{ id: 'z', x: 8, y: 4, w: 1, h: 2 }]);
    run(b, 0, 60);
    expect(n(b)).toBe(1);
  });

  it('touch works on crates, doors and relics', () => {
    const w = build([ev({ type: 'touch', target: 'r1' }, [add('n')]), ev({ type: 'touch', target: 'c1' }, [add('m')])], {},
      [{ type: 'relic', id: 'r1', x: 3, y: 6, kind: 'note' }, { type: 'crate', id: 'c1', x: 6, y: 6 }]);
    run(w, Btn.Right, 60);
    expect(n(w)).toBe(1);
    expect(n(w, 'm')).toBe(1);
  });

  it('collect fires for relics and collect gadgets', () => {
    const w = build([ev({ type: 'collect', target: 'r1' }, [add('n')]), ev({ type: 'collect', target: 'cg' }, [add('n'), add('n')])], {},
      [{ type: 'relic', id: 'r1', x: 3, y: 6, kind: 'note' }, gadget({ id: 'cg', x: 5, effect: { kind: 'collect' } })]);
    run(w, Btn.Right, 60);
    expect(n(w)).toBe(3);
  });

  it('key is a press edge', () => {
    const w = build([ev({ type: 'key', key: 'jump' }, [add('n')])]);
    run(w, Btn.Jump, 20);
    expect(n(w)).toBe(1);
    run(w, 0, 3);
    run(w, Btn.Jump, 3);
    expect(n(w)).toBe(2);
  });

  it('becomes is a condition edge', () => {
    const w = build([
      ev({ type: 'becomes', cond: { type: 'var', name: 'm', op: '>=', value: 3 } }, [add('n')]),
      ev({ type: 'timer', ticks: 5 }, [{ type: 'setVar', name: 'm', op: 'set', value: 3 }]),
      ev({ type: 'timer', ticks: 15 }, [{ type: 'setVar', name: 'm', op: 'set', value: 0 }]),
      ev({ type: 'timer', ticks: 25 }, [{ type: 'setVar', name: 'm', op: 'set', value: 4 }]),
    ]);
    run(w, 0, 40);
    expect(n(w)).toBe(2);
  });

  it('signal chains through events, capped at 16 deep', () => {
    const w = build([
      ev({ type: 'timer', ticks: 3 }, [{ type: 'signal', name: 'a' }]),
      ev({ type: 'signal', name: 'a' }, [add('n'), { type: 'signal', name: 'b' }]),
      ev({ type: 'signal', name: 'b' }, [add('n'), { type: 'signal', name: 'c' }]),
      ev({ type: 'signal', name: 'c' }, [add('n')]),
      ev({ type: 'timer', ticks: 5 }, [{ type: 'signal', name: 'loop' }]),
      ev({ type: 'signal', name: 'loop' }, [add('m'), { type: 'signal', name: 'loop' }]),
    ]);
    run(w, 0, 10);
    expect(n(w)).toBe(3);
    expect(n(w, 'm')).toBe(16);
  });
});

describe('conditions', () => {
  it('evaluates every kind', () => {
    const w = build([], { vars: [{ name: 'v', value: 5 }] },
      [{ type: 'plate', id: 'pl', x: 8, y: 6, w: 1, need: 1 }, { type: 'relic', id: 'r1', x: 3, y: 6, kind: 'note' }, gadget({ id: 'g', on: false })],
      [{ id: 'z', x: 0, y: 5, w: 3, h: 2 }]);
    const t = (c: Condition) => evalCondition(w, c);
    for (const [op, val, want] of [['==', 5, true], ['!=', 5, false], ['<', 6, true], ['<=', 5, true], ['>', 5, false], ['>=', 6, false]] as const)
      expect(t({ type: 'var', name: 'v', op, value: val })).toBe(want);
    expect(t({ type: 'deaths', op: '==', value: 0 })).toBe(true);
    expect(t({ type: 'gadgetOn', target: 'g', is: false })).toBe(true);
    expect(t({ type: 'gadgetOn', target: 'g', is: true })).toBe(false);
    expect(t({ type: 'inZone', zone: 'z', is: true })).toBe(true);
    expect(t({ type: 'pressed', plate: 'pl', is: false })).toBe(true);
    expect(t({ type: 'collected', target: 'r1', is: false })).toBe(true);
    expect(t({ type: 'bodies', op: '==', value: 0 })).toBe(true);
    run(w, Btn.Right, 30);
    expect(t({ type: 'inZone', zone: 'z', is: true })).toBe(false);
    expect(t({ type: 'collected', target: 'r1', is: true })).toBe(true);
    w.killPipBy('spike');
    run(w, 0, 60);
    expect(t({ type: 'bodies', op: '==', value: 1 })).toBe(true);
    expect(t({ type: 'deaths', op: '>=', value: 1 })).toBe(true);
  });
});

describe('variables', () => {
  it('keep persists across deaths, others reset, restart resets all; changes emit var events', () => {
    const w = build([ev({ type: 'timer', ticks: 2 }, [add('n'), add('m')])]);
    const e = run(w, 0, 5);
    expect(e.filter((x) => x.t === 'var').length).toBe(2);
    expect(n(w)).toBe(1);
    respawn(w);
    expect(n(w)).toBe(2); // timer fired again in the new life, keep var survived
    expect(n(w, 'm')).toBe(1);
    w.restart();
    run(w, 0, 3);
    expect(n(w)).toBe(1);
  });

  it('set / add / sub', () => {
    const w = build([ev({ type: 'timer', ticks: 1 }, [
      { type: 'setVar', name: 'n', op: 'set', value: 10 }, { type: 'setVar', name: 'n', op: 'sub', value: 3 }, { type: 'setVar', name: 'n', op: 'add', value: 1 }])]);
    run(w, 0, 2);
    expect(n(w)).toBe(8);
  });
});

describe('actions', () => {
  it('setRule changes the tuning for this life only', () => {
    const w = build([ev({ type: 'timer', ticks: 2 }, [{ type: 'setRule', rule: 'gravity', value: 2 }, { type: 'setRule', rule: 'bounce', value: 2 }, { type: 'setRule', rule: 'speed', value: 0.5 }, { type: 'setRule', rule: 'jump', value: 1.5 }])]);
    const base = { ...w.tune };
    run(w, 0, 3);
    expect(w.tune.gravity).toBe(base.gravity * 2);
    expect(w.tune.bounce).toBe(2);
    expect(w.tune.run).toBe(Math.round(base.run / 2));
    expect(w.tune.jump).toBeGreaterThan(base.jump);
    respawn(w);
    expect(w.tune.gravity).toBe(w.tune.gravity); // reset then re-applied by the timer
    w.restart();
    expect(w.tune).toEqual(base);
  });

  it('ability sets wall jump and air jumps for the life', () => {
    const w = build([ev({ type: 'start' }, [{ type: 'ability', wallJump: true, airJumps: 2 }])]);
    expect(w.abil).toEqual({ wallJump: true, airJumps: 2 });
    expect(w.airLeft).toBe(2);
  });

  it('spawnCrate adds a crate that is cleared on respawn', () => {
    const w = build([ev({ type: 'timer', ticks: 2 }, [{ type: 'spawnCrate', at: { x: 8, y: 2 } }], { once: true })]);
    run(w, 0, 60);
    const crates = () => w.corpses.filter((c) => c.kind === 'crate');
    expect(crates().length).toBe(1);
    expect(crates()[0]!.y + U).toBeGreaterThan(5 * U); // fell to the floor
    w.killPipBy('spike');
    run(w, 0, 30);
    expect(crates().length).toBe(1); // the timer fired again in the new life, but only one exists
    w.corpses = w.corpses.filter((c) => c.kind !== 'crate');
  });

  it('message and music only emit events', () => {
    const w = build([ev({ type: 'timer', ticks: 1 }, [{ type: 'message', text: 'hi', seconds: 2 }, { type: 'message', text: 'yo' }, { type: 'music', slot: 4 }])]);
    const e = run(w, 0, 2);
    expect(e).toContainEqual({ t: 'message', text: 'hi', seconds: 2 });
    expect(e.some((x) => x.t === 'message' && x.text === 'yo' && x.seconds > 0)).toBe(true);
    expect(e).toContainEqual({ t: 'music', slot: 4 });
  });

  it('teleport, launch, setSpawn, kill and win act on Pip', () => {
    const w = build([
      ev({ type: 'timer', ticks: 2 }, [{ type: 'teleport', to: { x: 10, y: 6 } }], { if: [{ type: 'deaths', op: '==', value: 0 }] }),
      ev({ type: 'timer', ticks: 4 }, [{ type: 'setSpawn', to: { x: 7, y: 6 } }]),
    ]);
    run(w, 0, 6);
    expect(w.pip.x).toBeGreaterThan(10 * U);
    respawn(w);
    expect(Math.abs(w.pip.x - 7 * U)).toBeLessThan(U);

    const l = build([ev({ type: 'timer', ticks: 2 }, [{ type: 'launch', vx: 0, vy: -20 }])]);
    run(l, 0, 3);
    expect(l.pip.vy).toBeLessThan(-30);

    const k = build([ev({ type: 'timer', ticks: 2 }, [{ type: 'kill', cause: 'water' }])]);
    run(k, 0, 3);
    expect(k.lastDeath).toBe('water');

    const x = build([ev({ type: 'timer', ticks: 2 }, [{ type: 'win' }])]);
    run(x, 0, 3);
    expect(x.won).toBe(true);
  });

  it('a level can be won with no door', () => {
    const l = { ...mk(ROOM, { events: [] }), objects: [] as LevelData['objects'] };
    l.objects.push({ type: 'spawn', id: 'spawn', x: 1, y: 6 }, gadget({ id: 'w', effect: { kind: 'win' } }));
    expect(validateLevel(l).ok).toBe(true);
  });
});


describe('air jumps', () => {
  const air = (airJumps: number) => build([], { abilities: { airJumps } });

  it('allows extra mid-air jumps, refilled on landing', () => {
    const w = air(2);
    run(w, 0, 10);
    const jumps = () => { const e = [] as SimEvent[]; for (let i = 0; i < 1; i++) { w.step(Btn.Jump); e.push(...w.fx); } return e; };
    run(w, Btn.Jump, 1); // ground jump
    run(w, 0, 12);
    let count = 0;
    for (let k = 0; k < 3; k++) {
      count += jumps().filter((e) => e.t === 'airJump').length;
      run(w, 0, 8);
    }
    expect(count).toBe(2); // third press in the air does nothing
    // Land, then it refills.
    run(w, 0, 120);
    expect(w.pip.grounded).toBe(true);
    run(w, Btn.Jump, 1);
    run(w, 0, 12);
    expect(jumps().filter((e) => e.t === 'airJump').length).toBe(1);
  });

  it('gives no extra jump when the level has none', () => {
    const w = air(0);
    run(w, 0, 10);
    run(w, Btn.Jump, 1);
    run(w, 0, 12);
    const e = run(w, Btn.Jump, 1);
    expect(e.some((x) => x.t === 'airJump')).toBe(false);
  });

  it('refills on wall contact', () => {
    const w = air(1);
    run(w, 0, 10);
    // Burn the air jump, then touch the right wall and jump again.
    run(w, Btn.Jump | Btn.Right, 1);
    run(w, Btn.Right, 12);
    run(w, Btn.Right | Btn.Jump, 1); // spends the air jump (released since)
    expect(w.airLeft).toBe(0);
    run(w, Btn.Right, 70); // drifts into the right wall (x = 15 tiles) or lands: both refill
    expect(w.airLeft).toBe(1);
  });
});
