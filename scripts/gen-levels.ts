// Authoring source for the shipped levels. Run `npx tsx scripts/gen-levels.ts` to rewrite src/levels/**.json.
// The JSON files are the canonical format (the same one the editor saves); this script just keeps the
// ASCII maps from the spec readable while the levels are being tuned.
import { writeFileSync, mkdirSync } from 'node:fs';
import { fromAscii } from './ascii';
import type { LevelData } from '../src/sim/types';

const levels: Array<{ dir: string; level: LevelData }> = [];
const add = (dir: string, level: LevelData) => levels.push({ dir, level });

// ---------------------------------------------------------------------------
// Act 1: Fresh Meat
// ---------------------------------------------------------------------------

add('act1', fromAscii(`
######################
#........#############
#........#############
#........vvvv#########
#S..?.....^^......p?D#
######################
`, {
  id: 'L01', name: 'Trust Me', act: 1,
  props: {
    s1: { text: { 0: 'SAFE →  just walk', 1: 'See? Safe.', 4: 'Okay, maybe count them.' } },
    s2: { text: { 0: 'Almost there!' } },
  },
  zones: [{ id: 'popzone', x: 16, y: 4, w: 2, h: 1 }],
  events: [{ trigger: { type: 'playerEnters', zone: 'popzone' }, actions: [{ type: 'popSpike', target: 'p1' }], once: true }],
}));

add('act1', fromAscii(`
######################
#....................#
#.......CC...........#
#....................#
#....................#
#....................#
#S.?....__.....|....D#
#################XX###
`, {
  id: 'L02', name: 'Dead Weight', act: 1,
  props: {
    s1: { text: { 0: 'Stand on the button. Nothing bad will happen.', 1: 'Something bad happened. Unrelated.' } },
    g1: { y: 1, h: 6, plate: 'pl1' },
  },
  events: [{ trigger: { type: 'playerOn', target: 'pl1' }, actions: [{ type: 'fireCrusher', target: 'c1', delay: 30 }], once: true }],
}));

add('act1', fromAscii(`
######################
#.....d...........d..#
#....................#
#.................?D.#
#...............######
#...............######
#S.?............######
######################
`, {
  id: 'L03', name: 'Leg Up', act: 1,
  props: {
    s2: { text: { 0: "Push things. It's good for you." } },
    s1: { text: { 0: 'Welcome! Mind your head.', 2: 'I did say mind your head.' } },
  },
}));

add('act1', fromAscii(`
########################
#....d....d.........d..#
#......................#
#......................#
#.................?..D.#
#................#######
#................#######
#................#######
#................#######
#S.?.............#######
########################
`, {
  id: 'L04', name: 'Growing Old', act: 1,
  props: {
    s2: { text: { 0: 'Old you is softer. Use that.' } },
    s1: { text: { 0: 'Nearly there. Look up. Or don\'t.', 3: "Every death ages the others. I don't make the rules. (I do.)" } },
  },
}));

// ---------------------------------------------------------------------------
// Act 2: Rot
// ---------------------------------------------------------------------------

add('act2', fromAscii(`
######################
#....................#
#....................#
#..............?..D..#
#.?............#######
#S.............#######
########~~~~~~~#######
########~~~~~~~#######
######################
`, {
  id: 'L05', name: 'Shallow End', act: 2,
  current: { dir: 1, speed: 2.5 },
  props: {
    s2: { text: { 0: 'Shallow end →', 1: 'Deep end, technically.', 3: 'Floaties: you. Pool: also you.' } },
    s1: { text: { 0: 'Lifeguard on break.' } },
  },
  events: [{ trigger: { type: 'playerOn', target: '@raft' }, actions: [{ type: 'setCurrent', dir: -1, speed: 1.2, delay: 24 }, { type: 'sfx', name: 'gate', delay: 24 }], once: true }],
}));

add('act2', fromAscii(`
##########################
#...........d............#
#........................#
#........................#
#........................#
#.?......................#
#S................?.D....#
##MM^^^^^^^^^^^^^^^#######
##########################
##########################
`, {
  id: 'L06', name: 'Last Stop', act: 2,
  props: {
    s1: { text: { 0: 'Please remain seated until the vehicle has come to a complete stop.', 1: 'Mind the gap. And the rock.', 3: 'Press ↓ to get off early.' } },
    s2: { text: { 0: 'Terminus.' } },
    m1: { path: [{ x: 2, y: 7 }, { x: 11, y: 7 }], speed: 3, start: 'touch', oneWay: true },
  },
}));

add('act2', fromAscii(`
########################
#.....d..........L.....#
#................:.....#
#................:.....#
#S.?.............:..?.D#
###########.############
###########z############
###########_############
########################
`, {
  id: 'L07', name: 'Lights Out', act: 2,
  props: {
    s1: { text: { 0: 'Lasers are perfectly safe. For lasers.' } },
    s2: { text: { 0: 'Lights out, please.' } },
    l1: { mode: 'plate', plate: 'pl1' },
    l2: { hidden: true, x: 11, y: 6, dir: 'right', len: 1 },
  },
}));

add('act2', fromAscii(`
##########################
#...d.....d.....d........#
#........................#
#........................#
#S.?...........D.........#
##########################
`, {
  id: 'L08', name: 'Runaway', act: 2,
  props: {
    s1: { text: { 0: 'The exit is right over there. Go on.' } },
    door: { runaway: true },
    d1: { by: ['door'] },
    d2: { by: ['door'] },
    d3: { by: ['door'] },
  },
  zones: [{ id: 'corner', x: 21, y: 1, w: 4, h: 4 }],
  events: [{ trigger: { type: 'playerEnters', zone: 'corner' }, actions: [{ type: 'sign', target: 's1', text: "Doors can jump. Didn't you know?", delay: 30 }], once: true }],
}));

// ---------------------------------------------------------------------------
// Act 3: Bare Bones
// ---------------------------------------------------------------------------

add('act3', fromAscii(`
#########
#.......#
#.....D.#
#...#####
#...#####
#...#####
#...#####
#..<#####
#...#####
#>..#####
#S?^#####
#########
`, {
  id: 'L09', name: 'Hang In There', act: 3,
  props: { s1: { text: { 0: 'Hang in there.', 2: 'Feeling stuck? Age gracefully.', 4: 'Up is the only way out.' } } },
}));

add('act3', fromAscii(`
########################
#....d....d........d...#
#......................#
#......................#
#S.?...........|......D#
############.###########
############3###########
########################
`, {
  id: 'L10', name: 'Family Reunion', act: 3,
  props: {
    s1: { text: { 0: 'Bring the whole family.' } },
    g1: { y: 1, h: 4, plate: 'pl1' },
  },
}));

add('act3', fromAscii(`
######################
#.........d.CCC#######
#D|p.?.........#######
######.........#######
#..............#######
#......##.......######
#S.....##?....?.....##
#########}}}}}}}}}}.##
###################.##
###################.##
###################_##
######################
`, {
  id: 'L11', name: 'Assembly Line', act: 3,
  props: {
    s1: { text: { 0: 'Staff entrance.' } },
    s2: { text: { 0: 'Free ride!' } },
    s3: { text: { 0: 'Employees only.' } },
    g1: { y: 1, h: 2, plate: 'pl1' },
    c1: { h: 2, period: 120, phase: 40 },
    pl1: { need: 2 },
  },
  objects: [{ type: 'gate', id: 'slot', x: 15, y: 5, h: 1.6 }],
  zones: [{ id: 'popzone', x: 4, y: 1, w: 2, h: 2 }],
  events: [
    { trigger: { type: 'playerEnters', zone: 'popzone' }, actions: [{ type: 'popSpike', target: 'p1' }], once: true },
    { trigger: { type: 'plateDown', plate: 'pl1' }, actions: [{ type: 'sign', target: 's1', text: 'Thanks for your contribution.' }, { type: 'sfx', name: 'jingle' }] },
  ],
}));

add('act3', fromAscii(`
##########################
##########################
##########################
##########################
##########################
###################......#
###################......#
###################.?....#
#...###############......#
#...###############..._..#
#D|.###############.######
###.#.......CC......######
###.#...............######
###>................######
###..?.S.?..__.?...^######
##########################
`, {
  id: 'L12', name: 'Die Trying', act: 3,
  props: {
    s1: { text: { 0: 'The key to the cliff.', 3: 'Key turned. Now hurry.' } },
    s2: { text: { 0: 'Chimney. Sweep not included.' } },
    s3: { text: { 0: 'Plan your funeral.', 4: 'Order matters. R starts over.' } },
    s4: { text: { 0: 'Third time\'s the charm.' } },
    g1: { y: 8, h: 3 },
    c1: { h: 1 },
    pl2: { need: 2 },
  },
  objects: [{ type: 'gate', id: 'chimney', x: 3, y: 9, h: 2, plate: 'pl2' }],
  events: [
    { trigger: { type: 'playerOn', target: 'pl2' }, actions: [{ type: 'fireCrusher', target: 'c1', delay: 20 }], once: true },
    { trigger: { type: 'plateDown', plate: 'pl1' }, actions: [{ type: 'toggleGate', target: 'g1' }, { type: 'sign', target: 's1', text: 'Door unlocked. Now hurry.' }, { type: 'sfx', name: 'jingle' }], once: true },
  ],
}));

// The playable credits roll.
add('extra', fromAscii(`
##############################
#............................#
#............................#
#............................#
#............................#
#...............#####........#
#......................?..p.D#
#.........#####.......########
#............................#
#...#####....................#
#S...........................#
##############################
`, {
  id: 'credits', name: 'Credits', credits: true,
  props: { s1: { text: { 0: 'Directed by: the signs' } } },
  objects: [
    { type: 'label', id: 'title', x: 15, y: 2, text: 'DIE TRYING', size: 2 },
    { type: 'label', id: 'for', x: 15, y: 3.2, text: 'made for Thomas Greenleaf', size: 1 },
    { type: 'label', id: 'n1', x: 6.5, y: 9.5, text: 'PIP · as themself' },
    { type: 'label', id: 'n2', x: 12.5, y: 7.5, text: 'BODIES · also Pip' },
    { type: 'label', id: 'n3', x: 18.5, y: 5.5, text: 'CODE · Claude' },
    { type: 'label', id: 'n4', x: 25.5, y: 7.5, text: 'THANKS FOR PLAYING' },
  ],
  zones: [{ id: 'last', x: 24, y: 5, w: 2, h: 2 }],
  events: [{ trigger: { type: 'playerEnters', zone: 'last' }, actions: [{ type: 'popSpike', target: 'p1' }], once: true }],
}));

for (const { dir, level } of levels) {
  mkdirSync(`src/levels/${dir}`, { recursive: true });
  writeFileSync(`src/levels/${dir}/${level.id}.json`, JSON.stringify(level, null, 2) + '\n');
}
console.log(`wrote ${levels.length} levels`);
