// Route finder for the connected world: best-first search over macro inputs in the deterministic sim.
// Used to prove every zone route and relic is reachable, and to write the replay scripts the tests use.
import { Btn, U, type LevelData } from '../src/sim/types';
import { World } from '../src/sim/world';
import { isSolidGlyph } from '../src/sim/level';
import { rle } from '../src/sim/replay';

/** Deep clone that keeps prototypes, Maps/Sets and cycles; the immutable level is shared. */
export function cloneWorld(w: World): World {
  const memo = new Map<unknown, unknown>();
  memo.set(w.level, w.level);
  const walk = (v: unknown): unknown => {
    if (v === null || typeof v !== 'object') return v;
    const hit = memo.get(v);
    if (hit !== undefined) return hit;
    if (Array.isArray(v)) { const a: unknown[] = []; memo.set(v, a); for (const x of v) a.push(walk(x)); return a; }
    if (v instanceof Map) { const m = new Map(); memo.set(v, m); for (const [k, x] of v) m.set(walk(k), walk(x)); return m; }
    if (v instanceof Set) { const s = new Set(); memo.set(v, s); for (const x of v) s.add(walk(x)); return s; }
    const o = Object.create(Object.getPrototypeOf(v) as object) as Record<string, unknown>;
    memo.set(v, o);
    for (const k of Object.keys(v)) o[k] = walk((v as Record<string, unknown>)[k]);
    return o;
  };
  return walk(w) as World;
}

/** Geodesic distance (tiles) to the goal cells through non-solid space, ignoring physics. */
function distanceField(l: LevelData, goals: Array<{ x: number; y: number }>): Int32Array {
  const W = l.width, H = l.height;
  const d = new Int32Array(W * H).fill(1 << 29);
  const q: number[] = [];
  for (const g of goals) if (g.x >= 0 && g.y >= 0 && g.x < W && g.y < H) { d[g.y * W + g.x] = 0; q.push(g.y * W + g.x); }
  for (let i = 0; i < q.length; i++) {
    const c = q[i]!; const x = c % W, y = (c - x) / W;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const n = ny * W + nx;
      const t = l.tiles[ny]![nx]!;
      if (d[n]! <= d[c]! + 1 || (isSolidGlyph(t) && t !== '%')) continue;
      d[n] = d[c]! + 1; q.push(n);
    }
  }
  return d;
}

const MACROS: number[][] = (() => {
  const out: number[][] = [];
  for (const dir of [Btn.Right, Btn.Left, 0]) {
    for (const len of dir === 0 ? [6, 14, 30, 60] : [6, 14, 32]) out.push(Array(len).fill(dir));
    for (const hold of [3, 9, 18]) out.push([...Array(hold).fill(dir | Btn.Jump), ...Array(Math.max(0, 16 - hold)).fill(dir)]);
    out.push([...Array(2).fill(dir), ...Array(18).fill(dir | Btn.Jump)]);
  }
  for (const dir of [Btn.Right, Btn.Left, 0]) out.push(Array(8).fill(dir | Btn.Down));
  // A wall-jump kick away from each side.
  out.push([...Array(8).fill(Btn.Left), ...Array(14).fill(Btn.Right | Btn.Jump)]);
  out.push([...Array(8).fill(Btn.Right), ...Array(14).fill(Btn.Left | Btn.Jump)]);
  return out;
})();

export interface RouteGoal { done: (w: World) => boolean; cells: Array<{ x: number; y: number }> }
export interface RouteResult { inputs: number[]; expanded: number; ticks: number }
/** Where the last failed search got closest to the goal (tile coords), for debugging level design. */
export let lastBest: { x: number; y: number; h: number } | null = null;

/** Search for inputs that take `start` to the goal without dying. Returns null if not found in budget. */
export function findRoute(start: World, goal: RouteGoal, budget = 40000, maxMs = 240_000): RouteResult | null {
  const deadline = Date.now() + maxMs;
  const field = distanceField(start.level, goal.cells);
  const W = start.level.width;
  const h = (w: World) => {
    const cx = Math.floor((w.pip.x + w.pip.w / 2) / U), cy = Math.floor((w.pip.y + w.pip.h / 2) / U);
    const v = field[cy * W + cx];
    return v === undefined || v >= 1 << 29 ? 9999 : v;
  };
  interface Node { w: World; path: number[][]; f: number; g: number }
  const heap: Node[] = [];
  const push = (n: Node) => { heap.push(n); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p]!.f <= n.f) break; heap[i] = heap[p]!; i = p; } heap[i] = n; };
  const pop = (): Node | undefined => {
    const top = heap[0]; const last = heap.pop();
    if (!heap.length || !last) return top;
    let i = 0;
    for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l]!.f < (m === i ? last.f : heap[m]!.f)) m = l; if (r < heap.length && heap[r]!.f < (m === i ? last.f : heap[m]!.f)) m = r; if (m === i) break; heap[i] = heap[m]!; i = m; }
    heap[i] = last;
    return top;
  };
  const seen = new Set<string>();
  const key = (w: World) => `${Math.round(w.pip.x / 48)},${Math.round(w.pip.y / 48)},${Math.round(w.pip.vx / 10)},${Math.round(w.pip.vy / 16)},${w.pip.grounded ? 1 : 0},${w.pip.hang ? w.pip.hang.seg : -1},${w.pip.facing},${w.obj.gates.map((g) => (g.open > 0.5 ? 1 : 0)).join('')},${w.obj.platforms.map((p) => Math.round(p.y / 120)).join('')}|${w.corpses.map((c) => `${Math.round(c.x / 60)}.${Math.round(c.y / 60)}`).join(';')}`;
  push({ w: start, path: [], f: h(start), g: 0 });
  let expanded = 0;
  lastBest = null;
  while (heap.length && expanded < budget && Date.now() < deadline) {
    const n = pop()!;
    expanded++;
    const hn = h(n.w);
    if (!lastBest || hn < lastBest.h) lastBest = { x: +(n.w.pip.x / U).toFixed(1), y: +(n.w.pip.y / U).toFixed(1), h: hn };
    for (const m of MACROS) {
      const w = cloneWorld(n.w);
      const deaths = w.deathCount;
      let ok = true, reached = false, used = 0;
      for (const mask of m) {
        w.step(mask); used++;
        if (w.deathCount > deaths || !w.pipAlive) { ok = false; break; }
        if (goal.done(w)) { reached = true; break; }
      }
      if (!ok) continue;
      const path = [...n.path, m.slice(0, used)];
      if (reached) return { inputs: path.flat(), expanded, ticks: path.flat().length };
      if (w.exitHit) continue; // left through some other exit
      const k = key(w);
      if (seen.has(k)) continue;
      seen.add(k);
      const g = n.g + used;
      push({ w, path, f: h(w) * 10 + g / 30, g });
    }
  }
  return null;
}

export function toScript(inputs: number[], header: string): string {
  const names = (m: number) => {
    const k: string[] = [];
    if (m & Btn.Left) k.push('left'); if (m & Btn.Right) k.push('right'); if (m & Btn.Jump) k.push('jump'); if (m & Btn.Down) k.push('down');
    return k.length ? k.join('+') : 'wait';
  };
  return `# ${header}\n` + rle(inputs).map(([m, n]) => `${names(m)} ${n}`).join('\n') + '\n';
}
