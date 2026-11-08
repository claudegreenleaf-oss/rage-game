// Authoring source for Act 4 "The Core". Run `npx tsx scripts/gen-act4.ts` to rewrite src/levels/act4/*.json.
// Same conventions as scripts/gen-levels.ts: ASCII maps in the spec's glyphs, plus extras.
import { writeFileSync, mkdirSync } from 'node:fs';
import { fromAscii } from './ascii';
import type { LevelData } from '../src/sim/types';

const levels: LevelData[] = [];
const add = (l: LevelData, par: number) => { l.kind = 'chamber'; l.par = par; levels.push(l); };
const withRules = (l: LevelData, rules: LevelData['rules']) => { l.rules = rules; return l; };

// ---------------------------------------------------------------------------
// L13 · Inventory — crates forget, bodies remember.
// A heavy plate (needs 5) at the bottom of a well. Bodies stay across respawns; the crate goes home.
// Only Rot (1) + Fresh (2) + the crate (2), the crate pushed in during the final life, is enough.
// ---------------------------------------------------------------------------
add(fromAscii(`
######################
#.........d..........#
#....................#
#....................#
#....................#
#S.?.......?.......|D#
##########.###########
##########3###########
######################
`, {
  id: 'L13', name: 'Inventory', act: 4,
  props: {
    s1: { text: { 0: 'Company property. Return when done.', 2: 'Bodies stay. Boxes go home.', 4: 'Rot 1 + Fresh 2 + box 2. Do the maths.' } },
    s2: { text: { 0: 'Heavy plate. Bring friends.', 1: 'Five. The plate wants five.' } },
    pl1: { need: 5 },
    g1: { y: 1, h: 5, plate: 'pl1' },
  },
  objects: [{ type: 'crate', id: 'k1', x: 6, y: 5 }],
}), 2);

// ---------------------------------------------------------------------------
// L14 · Formaldehyde — nothing rots in here (aging off), so there's no Rot bounce.
// One body isn't tall enough. Die standing on yourself: the next body lands on top. Climb the family.
// ---------------------------------------------------------------------------
add(withRules(fromAscii(`
######################
#.............d......#
#....................#
#....................#
#....................#
#....................#
#.............?...D..#
#..............#######
#..............#######
#S.?...........#######
######################
`, {
  id: 'L14', name: 'Formaldehyde', act: 4,
  props: {
    s1: { text: { 0: 'Preservation wing. Nothing rots here.', 2: 'Fresh forever. Heavy forever.', 3: 'Stand on yourself. It helps.' } },
    s2: { text: { 0: 'Mind the ceiling panel.', 2: 'You again. And again.' } },
  },
}), { aging: false, jump: 0.85 }), 2);

// ---------------------------------------------------------------------------
// L15 · Pendulum — the vine hangs out of reach; a Rot bounce from the pit's edge gets you to it,
// then a leap from the vine reaches the high exit. A plain bounce falls short.
// ---------------------------------------------------------------------------
add(fromAscii(`
##########################
#........................#
#........................#
#..................?..D..#
#...........##############
#...........##############
#...........##############
#...........##############
#...........##############
#.?.........##############
#S...^^^^^^^##############
##########################
`, {
  id: 'L15', name: 'Pendulum', act: 4,
  props: {
    s1: { text: { 0: 'Swing safely. Ha.', 2: 'Soft things bounce. Old things are soft.', 4: 'Die at the edge first. Then age it.' } },
    s2: { text: { 0: 'Hang in there. Then don\'t.' } },
  },
  objects: [{ type: 'vine', id: 'v1', x: 9, y: 0, len: 4 }],
}), 2);

// ---------------------------------------------------------------------------
// L16 · Critical Mass — the exam. Two gates, two plates that each need 2, one way up.
// The way up is a Rot bounce from the spike well under the crumbling tile. One plate takes a Fresh
// press slab (so the press must be your LAST death); the other takes the crate (pushed in the final
// life, because crates forget). Die in the well first, then the press, then don't die again.
// ---------------------------------------------------------------------------
add(fromAscii(`
############################
#..........................#
#..........................#
#..........................#
#..........................#
#............?.........D...#
#.##########################
#.........CC...............#
#?.S......__......._.......#
#%##########################
#^##########################
############################
`, {
  id: 'L16', name: 'Critical Mass', act: 4,
  props: {
    s2: { text: { 0: 'Almost out. Probably.', 2: 'Two plates. Two kinds of heavy.' } },
    s1: { text: { 0: 'Stand by the wall. Admire the floor.', 1: 'The floor admired you back.', 3: 'Well first. Press second. Box last.' } },
    c1: { h: 0.5 },
    pl1: { need: 2 },
    pl2: { need: 2 },
  },
  objects: [
    { type: 'crate', id: 'k1', x: 15, y: 8 },
    { type: 'gate', id: 'g1', x: 14, y: 1, h: 5, plate: 'pl1' },
    { type: 'gate', id: 'g2', x: 18, y: 1, h: 5, plate: 'pl2' },
  ],
  events: [{ trigger: { type: 'playerOn', target: 'pl1' }, actions: [{ type: 'fireCrusher', target: 'c1', delay: 20 }], once: true }],
}), 2);

for (const level of levels) {
  mkdirSync('src/levels/act4', { recursive: true });
  writeFileSync(`src/levels/act4/${level.id}.json`, JSON.stringify(level, null, 2) + '\n');
}
console.log(`wrote ${levels.length} act 4 levels`);
