// Find a route to every relic in one zone (run one process per zone, then --merge).
//   npx tsx scripts/relics-world.ts <zone> [seconds]   |   npx tsx scripts/relics-world.ts --merge
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { World } from '../src/sim/world';
import { entryPoint } from '../src/sim/campaign';
import { loadWorld } from './world-node';
import { findRoute, lastBest, toScript } from './route-world';

const dir = '/tmp/claude-1000/relic-routes';
mkdirSync(dir, { recursive: true });
if (process.argv[2] === '--merge') {
  const out: Record<string, unknown> = {};
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) Object.assign(out, JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')));
  writeFileSync('src/solutions/world/relics.json', JSON.stringify(out, null, 1) + '\n');
  console.log(`merged ${Object.keys(out).length} relic routes`);
  process.exit(0);
}
const zone = process.argv[2]!;
const secs = Number(process.argv[3] ?? 45);
const l = loadWorld().levels.find((x) => x.id === zone)!;
const out: Record<string, { room: string; from: string; script: string }> = {};
for (const o of l.objects) {
  if (o.type !== 'relic') continue;
  let ok = false;
  for (const e of l.exits ?? []) {
    const w = new World(l, { entry: entryPoint(l, e) });
    const res = findRoute(w, { done: (x) => x.collected.has(o.id), cells: [{ x: o.x, y: o.y }] }, 60000, secs * 1000);
    if (res) { out[o.id] = { room: l.id, from: e.id, script: toScript(res.inputs, o.id) }; ok = true; break; }
  }
  console.log(`${ok ? 'ok  ' : 'MISS'} ${o.id} (${o.x},${o.y})${ok ? '' : ' closest ' + JSON.stringify(lastBest)}`);
}
writeFileSync(`${dir}/${zone}.json`, JSON.stringify(out));
