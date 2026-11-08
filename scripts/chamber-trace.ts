// Trace a chamber script starting from its world entrance (as the campaign plays it).
//   npx tsx scripts/chamber-trace.ts L16 path/to/script.txt
import { readFileSync } from 'node:fs';
import { World } from '../src/sim/world';
import { attachChamber, entryPoint } from '../src/sim/campaign';
import { compileScript } from '../src/sim/replay';
import { U } from '../src/sim/types';
import { loadWorld } from './world-node';

const [id, file] = [process.argv[2]!, process.argv[3]!];
const { levels, def } = loadWorld();
const l = attachChamber(levels.find((x) => x.id === id)!, def.attach![id]);
const w = new World(l, { entry: entryPoint(l, l.exits!.find((e) => e.id === 'in')!) });
let line = 0;
for (const [m, n] of compileScript(readFileSync(file, 'utf8'))) {
  line++;
  for (let i = 0; i < n; i++) { w.step(m); if (w.won || w.exitHit) break; }
  console.log(`#${line} t=${w.tick} pip=${(w.pip.x / U).toFixed(2)},${(w.pip.y / U).toFixed(2)} alive=${w.pipAlive} deaths=${w.deathCount}${w.exitHit ? ' EXIT ' + w.exitHit : ''}${w.won ? ' WON' : ''}`);
  if (w.won || w.exitHit) break;
}
