// The connected world: links are valid, a full run reaches every room and the credits, and every relic
// can be reached. Zone routes and relic routes were found by scripts/plan-world.ts and are replayed here.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Campaign, entryPoint, validateWorld } from '../src/sim/campaign';
import { World } from '../src/sim/world';
import { compileScript, unrle } from '../src/sim/replay';
import { loadWorld } from '../scripts/world-node';
import { playChamber, worldPlan } from './world-plan';

const full = loadWorld();
const noAct4 = loadWorld({ act4: false });

describe('world map', () => {
  it('every exit links to an exit that links back, on the room edge', () => {
    expect(validateWorld(full.def, full.levels)).toEqual([]);
    expect(validateWorld(noAct4.def, noAct4.levels)).toEqual([]);
  });

  it('includes all 16 chambers, the zones and the credits', () => {
    const ids = full.def.rooms;
    for (let i = 1; i <= 16; i++) expect(ids).toContain(`L${String(i).padStart(2, '0')}`);
    expect(ids).toContain('credits');
    expect(full.levels.filter((l) => l.kind === 'zone').length).toBeGreaterThanOrEqual(8);
    for (const z of full.levels.filter((l) => l.kind === 'zone')) {
      expect(z.width).toBeGreaterThanOrEqual(50);
      expect(z.height).toBeGreaterThanOrEqual(30);
    }
  });

  it('without Act 4 the last Act 3 door leads to the credits', () => {
    expect(noAct4.def.rooms).not.toContain('w4');
    expect(noAct4.def.attach?.L12?.door).toEqual({ room: 'credits', exit: 'in' });
  });

  it('a full run walks from the atrium through every zone and chamber to the credits', () => {
    const plan = worldPlan(full.def, full.levels);
    const c = new Campaign(full.def, full.levels);
    for (const step of plan) {
      expect(c.roomId).toBe(step.room);
      if (step.kind === 'chamber') { playChamber(c, step.room); continue; }
      const inputs = unrle(compileScript(readFileSync(`src/solutions/world/${step.file}`, 'utf8')));
      const before = c.roomId;
      for (const m of inputs) { c.step(m); if (c.roomId !== before) break; }
      expect(c.roomId, `${step.file} should leave ${before}`).not.toBe(before);
    }
    expect(c.roomId).toBe('credits');
    for (const id of full.def.rooms) expect(c.visited.has(id), `visited ${id}`).toBe(true);
  }, 120_000);

  it('every relic can be reached', () => {
    const file = 'src/solutions/world/relics.json';
    expect(existsSync(file)).toBe(true);
    const routes = JSON.parse(readFileSync(file, 'utf8')) as Record<string, { room: string; from: string; script: string }>;
    const relics = full.levels.flatMap((l) => l.objects.filter((o) => o.type === 'relic').map((o) => ({ room: l, id: o.id })));
    expect(relics.length).toBeGreaterThanOrEqual(30);
    for (const { room, id } of relics) {
      const r = routes[id];
      expect(r, `route for ${id}`).toBeDefined();
      const e = room.exits!.find((x) => x.id === r!.from)!;
      const w = new World(room, { entry: entryPoint(room, e) });
      for (const m of unrle(compileScript(r!.script))) { w.step(m); if (w.collected.has(id)) break; }
      expect(w.collected.has(id), id).toBe(true);
    }
  }, 120_000);
});
