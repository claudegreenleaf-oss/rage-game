// Walks the whole connected world in a Campaign: searches each zone segment for a route (writing
// src/solutions/world/<n>-<room>-<exit>.txt), plays each chamber with its puzzle solution, and finds a
// route to every relic (src/solutions/world/relics.json).
//   npx tsx scripts/plan-world.ts [--fresh] [--relics]
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { Campaign, entryPoint } from '../src/sim/campaign';
import { World } from '../src/sim/world';
import { compileScript, unrle } from '../src/sim/replay';
import { U } from '../src/sim/types';
import { loadWorld } from './world-node';
import { cloneWorld, findRoute, toScript, lastBest } from './route-world';
import { worldPlan, playChamber, type PlanStep } from '../tests/world-plan';

const args = process.argv.slice(2);
const wantRelics = args.includes('--relics');
const { def, levels } = loadWorld();
const plan = worldPlan(def, levels);
mkdirSync('src/solutions/world', { recursive: true });

const c = new Campaign(def, levels);
const t0 = Date.now();
plan.forEach((step: PlanStep, i: number) => {
  if (c.roomId !== step.room) throw new Error(`step ${i}: expected to be in ${step.room}, in ${c.roomId}`);
  if (step.kind === 'chamber') {
    const r = playChamber(c, step.room);
    console.log(`#${i} chamber ${step.room}: ${r.mode}, ${r.ticks} ticks -> ${c.roomId}`);
    return;
  }
  const file = `src/solutions/world/${step.file}`;
  let inputs: number[] | null = null;
  if (existsSync(file) && !args.includes('--fresh')) {
    inputs = unrle(compileScript(readFileSync(file, 'utf8')));
    const probe = cloneWorld(c.room);
    let ok = false;
    for (const m of inputs) { probe.step(m); if (probe.exitHit === step.exit) { ok = true; break; } }
    if (!ok) inputs = null;
  }
  if (!inputs) {
    const ex = c.room.level.exits!.find((e) => e.id === step.exit)!;
    const res = findRoute(cloneWorld(c.room), { done: (w) => w.exitHit === step.exit, cells: [{ x: ex.x, y: ex.y }] }, 60000);
    if (!res) throw new Error(`step ${i}: no route in ${step.room} to ${step.exit} (pip at ${(c.room.pip.x / U).toFixed(1)},${(c.room.pip.y / U).toFixed(1)}; got closest at ${JSON.stringify(lastBest)})`);
    inputs = res.inputs;
    writeFileSync(file, toScript(inputs, `${step.room}: to exit ${step.exit} (found by scripts/plan-world.ts, ${res.expanded} nodes)`));
  }
  const before = c.roomId;
  for (const m of inputs) { c.step(m); if (c.roomId !== before) break; }
  console.log(`#${i} zone ${step.room} -> ${step.exit}: ${inputs.length} ticks -> ${c.roomId}  (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
});
console.log(`run complete in room ${c.roomId}, deaths ${c.totalDeaths}`);

if (wantRelics) {
  const out: Record<string, { room: string; from: string; script: string }> = {};
  for (const l of levels) {
    if (l.kind !== 'zone') continue;
    for (const o of l.objects) {
      if (o.type !== 'relic') continue;
      let found = false;
      for (const e of l.exits ?? []) {
        const w = new World(l, { entry: entryPoint(l, e) });
        const res = findRoute(w, { done: (x) => x.collected.has(o.id), cells: [{ x: o.x, y: o.y }] }, 25000, 30_000);
        if (res) { out[o.id] = { room: l.id, from: e.id, script: toScript(res.inputs, `${o.id}`) }; found = true; break; }
      }
      console.log(`${found ? 'ok  ' : 'MISS'} ${o.id} (${o.x},${o.y})`);
    }
  }
  writeFileSync('src/solutions/world/relics.json', JSON.stringify(out, null, 1) + '\n');
}
