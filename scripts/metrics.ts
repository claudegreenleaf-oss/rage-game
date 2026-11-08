// Dev tool: measure Pip's movement numbers on a flat test level.
import { World } from '../src/sim/world';
import { U, Btn, type LevelData } from '../src/sim/types';
const flat: LevelData = { version: 1, id: 'T', name: 'T', width: 32, height: 12, tiles: [
  '#'.repeat(32), ...Array.from({ length: 10 }, () => '#' + '.'.repeat(30) + '#'), '#'.repeat(32)],
  objects: [{ type: 'spawn', id: 'spawn', x: 2, y: 10 }, { type: 'door', id: 'door', x: 30, y: 1 }], zones: [], events: [] };
function run(inputs: number[]) { const w = new World(flat); for (let i = 0; i < 10; i++) w.step(0); const y0 = w.pip.y; let minY = y0; const trace: Array<{x:number,y:number,g:boolean}> = []; for (const m of inputs) { w.step(m); minY = Math.min(minY, w.pip.y); trace.push({ x: w.pip.x, y: w.pip.y, g: w.pip.grounded }); } return { w, y0, apex: (y0 - minY) / U, trace }; }
const held = run([Btn.Jump, ...Array(60).fill(Btn.Jump)]);
const tap = run([Btn.Jump, ...Array(60).fill(0)]);
console.log('apex held', held.apex.toFixed(2), 'tapped', tap.apex.toFixed(2));
// running jump: run 30 ticks then jump held while running
const rj = run([...Array(30).fill(Btn.Right), ...Array(80).fill(Btn.Right | Btn.Jump)]);
const t = rj.trace; let takeoff = 30; let land = t.findIndex((s, i) => i > 31 && s.g);
console.log('air ticks', land - takeoff, 'air distance', ((t[land]!.x - t[takeoff - 1]!.x) / U).toFixed(2), 'tiles');
let acc = run(Array(20).fill(Btn.Right)); console.log('accel ticks to full', acc.trace.findIndex((s,i)=> i>0 && s.x - acc.trace[i-1]!.x === 28));
