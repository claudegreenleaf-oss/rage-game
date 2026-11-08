// Dev tool: run a level with a solution script and print the state after every script line.
//   npx tsx scripts/trace.ts L03 [script-file] [--ticks a-b]
import { readFileSync } from 'node:fs';
import { compileScript, maskToKeys } from '../src/sim/replay';
import { World } from '../src/sim/world';
import { U, STAGE_NAMES } from '../src/sim/types';
import { allLevels } from './levels-node';

const id = process.argv[2] ?? 'L01';
const file = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : `src/solutions/${id}.txt`;
const tr = process.argv.indexOf('--ticks');
const [t0, t1] = tr > 0 ? process.argv[tr + 1]!.split('-').map(Number) : [-1, -1];
const level = allLevels().find((l) => l.id === id);
if (!level) throw new Error(`no level ${id}`);
const runs = compileScript(readFileSync(file, 'utf8'));
const w = new World(level);
const f = (n: number) => (n / U).toFixed(2);
const state = () => {
  const p = w.pip;
  const cs = w.corpses.map((c) => `${STAGE_NAMES[c.stage][0]}${c.shape === 'slab' ? 's' : ''}${c.pin ? 'p' : ''}${c.floating ? 'f' : ''}@${f(c.x)},${f(c.y)}`).join(' ');
  const pl = w.obj.platforms.map((m) => ` M@${f(m.x)},${f(m.y)}`).join('') + w.obj.lasers.map((l) => ` ${l.id}:${l.active ? 'ON' : 'off'}`).join('') + w.obj.doors.filter((d) => d.def.runaway).map((d) => ` door@${f(d.x)}:${d.state}`).join('') + ` L${w.lifeTick}`;
  return `t=${w.tick}${pl} pip=${w.pipAlive ? `${f(p.x)},${f(p.y)} v=${p.vx},${p.vy}${p.grounded ? ' G' : ''}` : 'DEAD'} deaths=${w.deathCount} [${cs}]${w.won ? ' WON' : ''}`;
};
let line = 0;
outer: for (const [m, n] of runs) {
  line++;
  for (let i = 0; i < n; i++) {
    w.step(m);
    for (const e of w.fx) if (['death', 'win', 'respawn', 'bounce', 'plate', 'gate', 'popSpike', 'dropperFall', 'crusherSlam', 'laserReveal', 'doorHop', 'vaporize', 'dust'].includes(e.t)) console.log(`   ${w.tick}: ${JSON.stringify(e)}`);
    if (w.tick >= t0 && w.tick <= t1) console.log('     ' + state());
    if (w.won) { console.log(`#${line} ${maskToKeys(m)} ${n}: ${state()}`); break outer; }
  }
  console.log(`#${line} ${maskToKeys(m)} ${n}: ${state()}`);
}
console.log(w.won ? `WON in ${w.tick} ticks with ${w.deathCount} deaths` : `NOT WON (deaths ${w.deathCount})`);
