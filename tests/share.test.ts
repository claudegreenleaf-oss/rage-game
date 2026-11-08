// Share links: a level carrying gadgets, variables, abilities and a big room survives encode/decode and still runs.
import { describe, expect, it } from 'vitest';
import { decodeLevel, encodeLevel } from '../src/editor/share';
import { World } from '../src/sim/world';
import { Btn, type LevelData } from '../src/sim/types';
import { mk } from './helpers';

const big = (): LevelData => {
  const W = 200, H = 60;
  const rows = Array.from({ length: H }, (_, y) => (y === 0 || y === H - 1 ? '#'.repeat(W) : '#' + '.'.repeat(W - 2) + '#'));
  const base = mk('####\n#S.#\n#.D#\n####');
  return {
    ...base, kind: 'zone', width: W, height: H, tiles: rows,
    objects: [
      { type: 'spawn', id: 'spawn', x: 3, y: H - 2 },
      { type: 'gadget', id: 'g1', x: 8, y: H - 2, w: 1, h: 1, effect: { kind: 'bounce', power: 1.2 } } as never,
      { type: 'door', id: 'd', x: 190, y: H - 2 } as never,
      { type: 'sign', id: 's', x: 5, y: H - 2, text: { 0: 'Hello' } },
    ],
    vars: [{ name: 'coins', value: 0, show: 'Coins' }],
    abilities: { wallJump: true, airJumps: 2 },
  } as LevelData;
};

describe('share codes', () => {
  it('round-trips a 200x60 level with gadgets, vars and abilities', () => {
    const l = big();
    const back = decodeLevel(encodeLevel(l));
    expect(back).not.toBeNull();
    expect(back!.width).toBe(200);
    expect(back!.height).toBe(60);
    expect(back!.vars).toEqual(l.vars);
    expect(back!.abilities?.airJumps).toBe(2);
    expect(back!.objects.find((o) => o.type === 'gadget')).toBeTruthy();
    expect(back!.tiles).toEqual(l.tiles);
  });

  it('accepts a full URL, a #lvl= hash and the bare code', () => {
    const l = big();
    const code = encodeLevel(l);
    for (const input of [code, `#lvl=${code}`, `https://x.test/play/#lvl=${code}`, `  ${code}\n`]) expect(decodeLevel(input)?.name).toBe(l.name);
  });

  it('rejects junk and invalid sizes', () => {
    expect(decodeLevel('lvl=not-a-level')).toBeNull();
    expect(decodeLevel('')).toBeNull();
    expect(decodeLevel(encodeLevel({ ...big(), width: 300 }))).toBeNull();
  });

  it('a decoded level builds a world that steps', () => {
    const w = new World(decodeLevel(encodeLevel(big()))!);
    for (let i = 0; i < 30; i++) w.step(Btn.Right);
    expect(w.pipAlive).toBe(true);
    expect(w.W).toBe(200);
  });
});
