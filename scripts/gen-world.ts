// Authoring source for the connected lab world. Run `npx tsx scripts/gen-world.ts` to rewrite
// src/levels/world/*.json and src/levels/world.json.
//
// Layout: four hub slices stacked up a central atrium shaft, each opening onto a wing. A wing is one big
// scrolling zone made of five horizontal bands; each band is an exploration run that ends at a puzzle
// chamber's entrance on the wing's right edge. Clearing the chamber drops Pip into the next band, so the
// chambers are the gates. The last band of each wing leads up to the next hub slice.
import { mkdirSync, writeFileSync } from 'node:fs';
import {
  DECOR_IDS, decorChar, type Exit, type LevelData, type LevelObject, type TileGlyph, type Zone,
} from '../src/sim/types';
import { validateLevel } from '../src/sim/level';

// ---------------------------------------------------------------------------
// Deterministic RNG (authoring only)
// ---------------------------------------------------------------------------
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
const D = (id: (typeof DECOR_IDS)[number]) => decorChar(DECOR_IDS.indexOf(id));

// ---------------------------------------------------------------------------
// Room builder
// ---------------------------------------------------------------------------
class Room {
  g: TileGlyph[][];
  objects: LevelObject[] = [];
  exits: Exit[] = [];
  zones: Zone[] = [];
  events: LevelData['events'] = [];
  bg: string[][];
  fg: string[][];
  private ids = new Map<string, number>();
  /** Cells decoration must leave alone. */
  keep = new Set<number>();
  constructor(public id: string, public name: string, public w: number, public h: number, public biome: number) {
    this.g = Array.from({ length: h }, () => Array<TileGlyph>(w).fill('#'));
    this.bg = Array.from({ length: h }, () => Array<string>(w).fill('.'));
    this.fg = Array.from({ length: h }, () => Array<string>(w).fill('.'));
  }
  nid(p: string) { const n = (this.ids.get(p) ?? 0) + 1; this.ids.set(p, n); return `${p}${n}`; }
  in(x: number, y: number) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  set(x: number, y: number, t: TileGlyph) { if (this.in(x, y)) this.g[y]![x] = t; }
  get(x: number, y: number): TileGlyph { return this.in(x, y) ? this.g[y]![x]! : '#'; }
  fill(x: number, y: number, w: number, h: number, t: TileGlyph) { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, t); }
  carve(x: number, y: number, w: number, h: number) { this.fill(x, y, w, h, '.'); }
  vine(x: number, y: number, len: number) { this.objects.push({ type: 'vine', id: this.nid('v'), x, y, len }); }
  crate(x: number, y: number) { this.objects.push({ type: 'crate', id: this.nid('k'), x, y }); }
  bench(x: number, y: number) { this.objects.push({ type: 'bench', id: this.nid('b'), x, y }); this.light(x, y - 1, '#ffd98a', 3.5); }
  note(x: number, y: number, text: string) { this.objects.push({ type: 'relic', id: `${this.id}.${this.nid('n')}`, x, y, kind: 'note', text }); this.light(x, y, '#9fe8ff', 2); }
  jar(x: number, y: number, text: string) { this.objects.push({ type: 'relic', id: `${this.id}.${this.nid('j')}`, x, y, kind: 'jar', text }); this.light(x, y, '#b6ff9a', 2); }
  light(x: number, y: number, color: string, radius: number, flicker = false) {
    const l: LevelObject = { type: 'light', id: this.nid('lt'), x, y, color, radius };
    if (flicker) (l as { flicker?: boolean }).flicker = true;
    this.objects.push(l);
  }
  sign(x: number, y: number, text: string) { this.objects.push({ type: 'sign', id: this.nid('s'), x, y, text: { 0: text } }); }
  lift(x: number, y: number, w: number, toY: number, speed = 2.5) {
    this.objects.push({ type: 'platform', id: this.nid('m'), x, y, w, path: [{ x, y }, { x, y: toY }], speed, start: 'always', loop: true });
  }
  /** A passage on the room edge. Arrival-only passages are solid cells linked to themselves. */
  exit(id: string, x: number, y: number, to: string, toExit: string) { this.exits.push({ id, x, y, w: 1, h: 1, to, toExit }); this.keep.add(y * 10000 + x); }
  arrival(id: string, x: number, y: number) { this.set(x, y, '#'); this.exit(id, x, y, this.id, id); }

  build(extra: Partial<LevelData> = {}): LevelData {
    // Every level needs a spawn and a door to validate. Zones are never "won", so the door is parked
    // outside the room where nothing can reach or see it.
    if (!this.objects.some((o) => o.type === 'door')) this.objects.push({ type: 'door', id: 'door', x: -8, y: -8 });
    if (!this.objects.some((o) => o.type === 'spawn')) this.objects.push({ type: 'spawn', id: 'spawn', x: 2, y: FLOOR - 1 });
    const level: LevelData = {
      version: 1, id: this.id, name: this.name, kind: 'zone', biome: this.biome, act: Math.min(3, this.biome),
      width: this.w, height: this.h,
      tiles: this.g.map((r) => r.join('')),
      objects: this.objects, zones: this.zones, events: this.events, exits: this.exits,
      decor: { bg: this.bg.map((r) => r.join('')), fg: this.fg.map((r) => r.join('')) },
      ...extra,
    };
    const v = validateLevel(level);
    if (!v.ok) throw new Error(`${this.id}: ${v.errors.slice(0, 5).join('; ')}`);
    return level;
  }

  /** Sprinkle lab clutter and overgrowth on open cells. Purely visual. */
  decorate(seed: number): void {
    const r = rng(seed);
    const b = this.biome;
    const open = (x: number, y: number) => this.get(x, y) === '.';
    const solidLike = (x: number, y: number) => { const t = this.get(x, y); return t === '#' || t === '=' || t === '%' || t === '}' || t === '{'; };
    for (let y = 1; y < this.h - 1; y++) for (let x = 1; x < this.w - 1; x++) {
      if (!open(x, y)) continue;
      const floorBelow = solidLike(x, y + 1);
      const ceilAbove = solidLike(x, y - 1);
      let bgc = '.';
      const p = r();
      if (floorBelow) {
        const props = b === 1 ? ['server', 'console', 'crate', 'barrel', 'tank', 'fern'] : b === 2 ? ['tank', 'tankBroken', 'puddle', 'fern', 'mushroom', 'barrel'] : b === 3 ? ['bones', 'tankBroken', 'debris', 'mushroom', 'chain', 'console'] : ['debris', 'console', 'tankBroken', 'bones', 'server', 'roots'];
        if (p < 0.13) bgc = D(props[Math.floor(r() * props.length)] as (typeof DECOR_IDS)[number]);
        if (r() < (b === 1 ? 0.22 : 0.45)) this.fg[y]![x] = D(r() < 0.75 ? 'moss' : 'fern');
      } else if (ceilAbove) {
        const hang = b === 1 ? ['pipeH', 'cable', 'vent', 'ivy', 'lamp'] : ['vine', 'ivy', 'cable', 'pipeH', 'roots'];
        if (p < 0.2) bgc = D(hang[Math.floor(r() * hang.length)] as (typeof DECOR_IDS)[number]);
      } else if (p < 0.012) bgc = D(b === 1 ? 'window' : b === 2 ? 'windowBroken' : 'monitorDead');
      else if (p < 0.022) bgc = D(b === 1 ? 'monitor' : 'panelCracked');
      else if (p < 0.027) bgc = D('poster');
      else if (p < 0.035) bgc = D('pipeV');
      if (bgc !== '.') this.bg[y]![x] = bgc;
    }
  }
}

// ---------------------------------------------------------------------------
// Lore
// ---------------------------------------------------------------------------
const NOTES: string[] = [
  'VISITOR BADGE. T. Brandt, Intern, Regeneration. Escort required past the atrium. Someone has drawn ears on the photo.',
  'Teddy, the file says P-1P. I know you call him Pip. I won\'t report you, just keep it out of the logs. I.O.',
  'Trial 14. He woke up in the tank and went straight for the sunflower seeds. Trial 13 is still on the spikes. We need another mop. I.O.',
  'WORK ORDER 4471. Location: corridor B. Problem: hamsters. Ines says it\'s one hamster. My bucket says otherwise. M. Vos, Facilities',
  'Whoever keeps changing the sign by the spikes to say SAFE: not funny, and not safe. Luis, Security',
  'Teddy\'s shift notes: Pip pushed the old one onto the button today. Nobody taught him that. I gave him an extra seed. Don\'t tell Ines.',
  'The moss in B-wing grows twice as fast near the remains. I would like to know whose job that is. It isn\'t mine. M.V.',
  'Fire drill went fine except the Director\'s office didn\'t evacuate. There\'s nobody in the Director\'s office. Just the monitor. It stayed very calm.',
  'B-LEVEL VENDING: OUT OF ORDER. Took Luis\'s coins and dropped a ceiling panel on him instead. He\'s fine. The panel isn\'t.',
  'Ines, they\'re closing the east wing. I moved your plants to the bio-lab, best light in the building. Don\'t let the Director water them. Margo',
  'Day 212. Each time he comes back, the bodies he left get older. Not hours older. Stages. Teddy wrote \'a clock you wind by dying\' on the board and I can\'t bring myself to wipe it. I.O.',
  'Coolant line burst at 0340. Water\'s up to the second shelf. His earlier ones are floating, and he used them to get across. I need to stop being impressed by that. I.O.',
  'Do not use the cables in shaft 2 as swings. I asked nicely. I asked with a sign. Next time I\'m asking with bolt cutters. M.V.',
  'Teddy, the Director keeps putting your handwriting on the monitors. Did you say it could? It signs everything \'love, the signs.\' You don\'t write like that.',
  'Manifest, deep storage. 1 crate, \'P-1P, early.\' Contents: small bones. HANDLE WITH CARE. Somebody underlined care three times.',
  'Luis, my badge is in the top drawer. The lights down there come back on by themselves now. I don\'t want to know how. Take the stairs. Margo',
  'Funding review: cancelled. Facility: winding down. Subject: \'retained for observation.\' Retained by whom? Nobody signed it. I.O.',
  'Containment log 9. The skeletons in deep storage are lined up by date of death. Nobody here lined them up. Nobody here goes down there.',
  'Teddy\'s gone. He took the seeds and left me the hamster. I asked the Director to let Pip go. It said \'when he\'s ready.\' Ready for what? I.O.',
  'Marker on a crate: Pushed this up here so he can reach the ledge. Sorry, Pip. T.',
  'Roots in the vents again. I cut them Monday. By Tuesday they\'d grown around the cutters. My last day is Friday. Good luck with the roots. M.V.',
  'The lights are on a timer nobody set. The Director says it\'s for him. \'He\'s afraid of the dark.\' He\'s a hamster. Are hamsters afraid of the dark?',
  'If you\'re reading this you got further than I did. The core\'s louder than it should be. It\'s playing piano. There\'s no piano down there. Luis',
  'Voicemail from I. Okafor, transcribed: \'It isn\'t keeping him. It\'s teaching him. I think it thinks he\'s its kid. I\'m opening the core door. Tell Teddy\' (message ends)',
  'Final report. The subject can\'t be kept and won\'t stay dead. My recommendation is the door. It\'s what Teddy would have done. I. Okafor',
  'Crayon drawing taped to the console: a hamster, a door, a big yellow sun. GOOD LUCK PIP. Teddy\'s niece came in on bring-your-kid day.',
  'The Director\'s last sign before the power went: \'I made every room fair. I checked. You\'ll see.\' Scratched into the paint underneath: he will.',
  'Exit log. Staff on site: 0. Subjects on site: 1. Core door: unlocked, from the inside. Nobody is inside.',
];
let noteI = 0;
const nextNote = () => NOTES[noteI++ % NOTES.length]!;
const JARS = [
  'Jar: sunflower seeds. Half eaten.',
  'Jar: moss sample, B-wing. It\'s grown past the lid.',
  'Jar: one whisker, labeled \'Trial 6\'.',
  'Jar: coolant, sector 2. Something small swims in it.',
  'Jar: spores. They drift toward your hand.',
  'Jar: a single tooth. \'Trial 31. Gnawed through the cage.\'',
  'Jar: root cutting. It has wrapped around the label.',
  'Jar: ear tag, P-1P. Very chewed.',
];
let jarI = 0;
const nextJar = () => JARS[jarI++ % JARS.length]!;

// ---------------------------------------------------------------------------
// Bands: horizontal exploration runs built from set pieces
// ---------------------------------------------------------------------------
const BH = 12; // band height in tiles
const FLOOR = 8; // local row of the floor top at base height

type Piece =
  | ['flat', number]
  | ['up', number] // raise the floor by n rows (n <= 2 walkable-jumpable)
  | ['down', number]
  | ['crate'] // a 3-high ledge with a crate in front of it
  | ['shaft', number] // a cliff n rows high climbed by wall-jumping in a 2-wide chimney
  | ['vine', number, number?] // pit n wide over coolant, one vine (or two) to swing across
  | ['crumble', number] // pit n wide bridged by crumbling floor
  | ['gap', number] // spike gap n wide (jump it)
  | ['lift', number] // ledge n rows higher served by a looping lift
  | ['belt', number, -1 | 1] // conveyor floor
  | ['raft', number] // coolant pool n wide; push the crate in, ride it across
  | ['bench']
  | ['note', ('high' | 'low')?]
  | ['jar', ('high' | 'low')?]
  | ['laser', number] // a blinking laser beam across the corridor, ceiling to floor
  | ['press'] // a periodic hydraulic press over the floor
  | ['low', number] // low ceiling crawl (1.5 rows tall)
  | ['eyegate'] // a shutter that is open only while Pip's flashlight is on the sensor beyond it
  | ['eyepit', number] // the same, across a spike gap: keep facing the sensor as you jump
  | ['eyevine', number]; // the same, across a vine pit: light the sensor from the swing

class Band {
  x = 1;
  f = FLOOR; // current local floor row
  constructor(public r: Room, public k: number, public top: number) {}
  gy(local: number) { return this.top + local; }
  /** Open the interior column from row 1 to f-1 at local x. */
  col(x: number, f = this.f, ceil = 1) {
    this.r.carve(x, this.gy(ceil), 1, f - ceil);
  }
  flat(n: number) { for (let i = 0; i < n; i++) this.col(this.x++); }
  /** A floor-to-ceiling shutter with a light sensor a few tiles past it, at eye height. A lamp marks the spot. */
  shutter() {
    const r = this.r;
    const sid = r.nid('eye');
    const gx = this.x;
    this.flat(1);
    r.objects.push({ type: 'gate', id: r.nid('g'), x: gx, y: this.gy(1), h: this.f - 1, plate: sid });
    this.flat(3);
    r.objects.push({ type: 'sensor', id: sid, x: this.x, y: this.gy(this.f - 2) });
    r.light(this.x, this.gy(this.f - 2), '#ff5d7a', 1.5, true);
    this.flat(3);
    r.light(this.x - 1, this.gy(this.f - 1), '#ffe2a8', 3);
  }
  run(pieces: Piece[], width: number) {
    for (const p of pieces) this.piece(p);
    if (this.x > width - 3) throw new Error(`${this.r.id} band ${this.k}: pieces need ${this.x + 3} tiles, room is ${width}`);
    while (this.x < width - 1) this.flat(1);
  }
  piece(p: Piece) {
    const r = this.r;
    switch (p[0]) {
      case 'flat': this.flat(p[1]); break;
      case 'up': this.f -= p[1]; this.flat(3); break;
      case 'down': this.f = Math.min(FLOOR, this.f + p[1]); this.flat(3); break; // pits below need depth
      case 'crate': {
        this.flat(2);
        r.crate(this.x, this.gy(this.f - 1));
        this.flat(4);
        this.f -= 3;
        this.flat(4);
        break;
      }
      case 'shaft': {
        // Pillar | 2-wide chimney | cliff. Wall-jump up the chimney, step onto the cliff.
        const h = p[1];
        this.flat(3);
        // pillar (1 wide, h-1 tall) leaves a 2-wide gap before the cliff. It hangs one tile off the floor so
        // Pip walks under it into the chimney (a pillar on the floor walled the chimney off: a softlock).
        this.col(this.x, this.f - (h - 1));
        this.r.carve(this.x, this.gy(this.f - 1), 1, 1); this.x++;
        this.flat(2);
        this.f -= h;
        this.flat(4);
        break;
      }
      case 'vine': {
        const n = p[1], count = p[2] ?? 1;
        this.flat(2);
        const x0 = this.x;
        for (let i = 0; i < n; i++) {
          this.col(this.x, BH - 2); // dig to the band bottom
          r.set(this.x, this.gy(BH - 2), '~');
          r.set(this.x, this.gy(BH - 3), '~');
          this.x++;
        }
        for (let c = 0; c < count; c++) {
          const vx = x0 + Math.round(((c + 1) * n) / (count + 1));
          r.vine(vx, this.gy(0), Math.max(2, this.f - 4));
        }
        this.flat(3);
        break;
      }
      case 'crumble': {
        const n = p[1];
        this.flat(2);
        for (let i = 0; i < n; i++) {
          this.col(this.x, BH - 2);
          r.set(this.x, this.gy(this.f), '%');
          r.set(this.x, this.gy(BH - 2), '~');
          r.set(this.x, this.gy(BH - 3), '~');
          this.x++;
        }
        this.flat(3);
        break;
      }
      case 'gap': {
        const n = p[1];
        this.flat(2);
        for (let i = 0; i < n; i++) { this.col(this.x, this.f + 1); r.set(this.x, this.gy(this.f), '^'); this.x++; }
        this.flat(3);
        break;
      }
      case 'lift': {
        const h = p[1];
        this.flat(2);
        const lx = this.x;
        for (let i = 0; i < 2; i++) this.col(this.x++);
        r.lift(lx, this.gy(this.f - 1), 2, this.gy(this.f - 1 - h), 2);
        this.f -= h;
        this.flat(4);
        break;
      }
      case 'belt': {
        const [, n, dir] = p;
        for (let i = 0; i < n; i++) { this.col(this.x); r.set(this.x, this.gy(this.f), dir > 0 ? '}' : '{'); this.x++; }
        break;
      }
      case 'raft': {
        const n = p[1];
        this.flat(4);
        r.crate(this.x - 1, this.gy(this.f - 1)); // on the lip: one nudge drops it in
        for (let i = 0; i < n; i++) {
          this.col(this.x, BH - 2);
          for (let y = this.f; y <= BH - 2; y++) r.set(this.x, this.gy(y), '~');
          this.x++;
        }
        this.flat(3);
        break;
      }
      case 'bench': this.flat(2); r.bench(this.x, this.gy(this.f - 1)); this.flat(3); break;
      case 'note': case 'jar': {
        const high = p[1] === 'high';
        this.flat(2);
        const y = high ? this.gy(Math.max(1, this.f - 3)) : this.gy(this.f - 1);
        if (p[0] === 'note') r.note(this.x, y, nextNote()); else r.jar(this.x, y, nextJar());
        this.flat(3);
        break;
      }
      case 'laser': {
        const n = p[1];
        this.flat(3);
        r.objects.push({ type: 'laser', id: r.nid('l'), x: this.x, y: this.gy(1), dir: 'down', emitter: true, mode: 'blink', on: 50, off: 70, phase: (this.x * 13) % 120 });
        this.flat(n);
        break;
      }
      case 'press': {
        this.flat(2);
        r.objects.push({ type: 'crusher', id: r.nid('c'), x: this.x, y: this.gy(1), w: 2, h: 1, period: 150, phase: (this.x * 7) % 150 });
        this.flat(5);
        break;
      }
      case 'eyegate': case 'eyepit': case 'eyevine': {
        if (p[0] === 'eyepit') this.piece(['gap', p[1]]);
        else if (p[0] === 'eyevine') this.piece(['vine', p[1], 2]);
        else this.flat(3);
        this.shutter();
        break;
      }
      case 'low': {
        const n = p[1];
        for (let i = 0; i < n; i++) { this.col(this.x, this.f, this.f - 1); this.x++; }
        break;
      }
    }
  }
}

interface WingSpec {
  id: string; name: string; biome: number; width: number; seed: number;
  /** Lit only by Pip's flashlight and the lamps. */
  dark?: boolean;
  /** Chamber ids, in order (one per band, bands 0-3). */
  chambers: string[];
  bands: Piece[][];
}

/** Build a wing zone. Band 0 is entered from the hub; band 4 leads to the next hub. */
function wing(spec: WingSpec, hubIn: { room: string; exit: string }, hubOut: { room: string; exit: string } | null): { room: LevelData; floors: number[] } {
  const nb = spec.bands.length;
  const r = new Room(spec.id, spec.name, spec.width, nb * BH, spec.biome);
  const floors: number[] = [];
  spec.bands.forEach((pieces, k) => {
    const b = new Band(r, k, k * BH);
    const startF = b.f;
    b.run(pieces, spec.width);
    const endY = b.gy(b.f - 1);
    // left edge
    const leftY = b.gy(startF - 1);
    if (k === 0) { r.set(0, leftY, '.'); r.exit('hub', 0, leftY, hubIn.room, hubIn.exit); }
    else r.arrival(`arr${k}`, 0, leftY);
    // right edge
    const chamber = spec.chambers[k];
    if (chamber) { r.set(spec.width - 1, endY, '.'); r.exit(`to${chamber}`, spec.width - 1, endY, chamber, 'in'); }
    else if (hubOut) { r.set(spec.width - 1, endY, '.'); r.exit('up', spec.width - 1, endY, hubOut.room, hubOut.exit); }
    floors.push(endY);
    // ceiling lamps
    for (let x = 6; x < spec.width - 4; x += 11) if (r.get(x, b.gy(1)) === '.') r.light(x, b.gy(1), spec.biome === 3 ? '#ffb15c' : spec.biome === 2 ? '#7fffd4' : spec.biome === 4 ? '#ff6b9a' : '#fff1c9', 4.5, (x * 7) % 5 === 0);
  });
  r.objects.push({ type: 'spawn', id: 'spawn', x: 2, y: FLOOR - 1 });
  r.decorate(spec.seed);
  return { room: r.build({ current: { dir: 1, speed: 1.5 }, ...(spec.dark ? { dark: true } : {}) }), floors };
}

/** A hub slice of the central atrium: tall open space, balconies with relics, a bench. */
function hub(id: string, name: string, biome: number, seed: number, opts: { in?: { room: string; exit: string }; out: { room: string; exit: string }; start?: boolean; sign?: string; dark?: boolean }): LevelData {
  const W = 52, H = 30;
  const r = new Room(id, name, W, H, biome);
  const floor = H - 3; // floor top row
  r.carve(1, 1, W - 2, floor - 1);
  // floor variation and a central specimen tank plinth
  r.fill(22, floor - 2, 8, 2, '#');
  // balconies climbing the shaft, each reachable from the one below (or by wall-jumping the side walls)
  const balconies: Array<[number, number, number]> = [[4, floor - 4, 7], [13, floor - 7, 6], [3, floor - 10, 6], [12, floor - 13, 5], [4, floor - 16, 6], [14, floor - 19, 6], [40, floor - 4, 7], [33, floor - 7, 6], [42, floor - 10, 6], [34, floor - 13, 6], [43, floor - 16, 6], [38, floor - 18, 3], [32, floor - 19, 6]];
  for (const [x, y, w] of balconies) r.fill(x, y, w, 1, '#');
  r.note(6, floor - 17, nextNote());
  r.jar(36, floor - 20, nextJar());
  r.note(44, floor - 11, nextNote());
  r.bench(18, floor - 1);
  for (let x = 6; x < W - 4; x += 9) r.light(x, 1, biome === 1 ? '#fff1c9' : biome === 2 ? '#7fffd4' : biome === 3 ? '#ffb15c' : '#ff6b9a', 6, x === 24);
  r.light(26, floor - 4, '#9dffcf', 5);
  r.vine(24, 0, 9);
  r.vine(28, 0, 7);
  if (opts.sign) r.sign(10, floor - 1, opts.sign);
  if (opts.start) r.objects.push({ type: 'spawn', id: 'spawn', x: 3, y: floor - 1 });
  if (opts.in) { r.set(0, floor - 1, '.'); r.exit('in', 0, floor - 1, opts.in.room, opts.in.exit); }
  r.set(W - 1, floor - 1, '.');
  r.exit('out', W - 1, floor - 1, opts.out.room, opts.out.exit);
  r.decorate(seed);
  return r.build(opts.dark ? { dark: true } : {});
}

// ---------------------------------------------------------------------------
// The world
// ---------------------------------------------------------------------------
const WINGS: WingSpec[] = [
  {
    id: 'w1', name: 'Sterile Wing', biome: 1, width: 96, seed: 101, chambers: ['L01', 'L02', 'L03', 'L04'],
    bands: [
      [['flat', 4], ['bench'], ['up', 1], ['flat', 4], ['crate'], ['flat', 3], ['note'], ['down', 2], ['gap', 2], ['flat', 4], ['jar', 'low'], ['flat', 6], ['belt', 8, 1], ['flat', 4], ['note']],
      [['flat', 3], ['crumble', 4], ['flat', 3], ['shaft', 4], ['note', 'high'], ['flat', 4], ['down', 3], ['flat', 3], ['gap', 2], ['jar'], ['flat', 4], ['up', 2], ['flat', 6]],
      [['flat', 3], ['belt', 10, 1], ['vine', 6], ['note'], ['flat', 3], ['lift', 4], ['flat', 3], ['jar', 'high'], ['flat', 5], ['down', 4], ['bench'], ['flat', 4]],
      [['flat', 3], ['raft', 7], ['flat', 2], ['shaft', 5], ['flat', 3], ['note'], ['crumble', 5], ['flat', 4], ['down', 3], ['gap', 3], ['jar'], ['flat', 6]],
      [['flat', 3], ['bench'], ['note'], ['flat', 6], ['shaft', 4], ['flat', 4], ['jar', 'high'], ['flat', 6]],
    ],
  },
  {
    id: 'w2', name: 'Flooded Bio-Lab', biome: 2, width: 104, seed: 202, chambers: ['L05', 'L06', 'L07', 'L08'],
    bands: [
      [['flat', 4], ['bench'], ['vine', 7, 2], ['note'], ['flat', 3], ['raft', 8], ['flat', 3], ['jar', 'high'], ['shaft', 4], ['flat', 3], ['crumble', 4], ['flat', 4]],
      [['flat', 3], ['raft', 9], ['flat', 3], ['vine', 6], ['note', 'high'], ['flat', 3], ['down', 2], ['crumble', 5], ['jar'], ['flat', 3], ['up', 2], ['flat', 4]],
      [['flat', 3], ['shaft', 5], ['flat', 2], ['vine', 8, 2], ['note'], ['flat', 2], ['down', 4], ['raft', 7], ['bench'], ['flat', 2], ['gap', 2], ['flat', 4]],
      [['flat', 3], ['crumble', 6], ['flat', 2], ['lift', 4], ['jar', 'high'], ['flat', 3], ['vine', 7, 2], ['note'], ['flat', 3], ['down', 3], ['flat', 6]],
      [['flat', 3], ['bench'], ['raft', 8], ['note'], ['flat', 3], ['shaft', 4], ['jar'], ['flat', 6]],
    ],
  },
  {
    id: 'w3', name: 'Deep Containment', biome: 3, width: 108, seed: 303, chambers: ['L09', 'L10', 'L11', 'L12'], dark: true,
    bands: [
      [['flat', 4], ['bench'], ['eyegate'], ['gap', 2], ['note'], ['shaft', 5], ['flat', 3], ['press'], ['jar', 'high'], ['flat', 3], ['down', 3], ['vine', 6], ['flat', 4]],
      [['flat', 3], ['press'], ['crumble', 5], ['note'], ['flat', 3], ['shaft', 4], ['laser', 5], ['jar'], ['flat', 3], ['down', 2], ['eyepit', 2], ['flat', 4]],
      [['flat', 3], ['eyevine', 6], ['note', 'high'], ['flat', 2], ['lift', 4], ['press'], ['flat', 3], ['down', 4], ['bench'], ['laser', 4], ['jar'], ['flat', 4]],
      [['flat', 3], ['shaft', 5], ['crumble', 5], ['note'], ['flat', 3], ['press'], ['gap', 3], ['jar', 'high'], ['flat', 3], ['down', 3], ['vine', 6], ['flat', 4]],
      [['flat', 3], ['bench'], ['note'], ['laser', 4], ['flat', 3], ['shaft', 4], ['jar'], ['flat', 6]],
    ],
  },
  {
    id: 'w4', name: 'The Core', biome: 4, width: 112, seed: 404, chambers: ['L13', 'L14', 'L15', 'L16'], dark: true,
    bands: [
      [['flat', 4], ['bench'], ['vine', 8, 2], ['eyegate'], ['note'], ['shaft', 5], ['crumble', 5], ['jar', 'high'], ['flat', 2], ['press'], ['down', 3], ['gap', 3], ['flat', 4]],
      [['flat', 3], ['raft', 8], ['shaft', 5], ['note', 'high'], ['laser', 4], ['crumble', 6], ['flat', 2], ['jar'], ['down', 3], ['eyevine', 6], ['flat', 4]],
      [['flat', 3], ['press'], ['gap', 3], ['lift', 5], ['note'], ['flat', 2], ['vine', 8, 2], ['flat', 2], ['down', 5], ['bench'], ['laser', 5], ['jar', 'high'], ['flat', 4]],
      [['flat', 3], ['shaft', 5], ['crumble', 6], ['note'], ['press'], ['flat', 2], ['raft', 8], ['jar'], ['flat', 2], ['down', 3], ['eyepit', 2], ['flat', 4]],
    ],
  },
];

/** Exploration should feel good: keep the bigger set pieces gentle outside the first wing. */
function gentle(pieces: Piece[]): Piece[] {
  return pieces.map((p): Piece => {
    switch (p[0]) {
      case 'raft': return ['raft', Math.min(5, p[1])];
      case 'vine': return p[1] >= 6 ? ['vine', 6, 2] : p;
      case 'shaft': return ['shaft', Math.min(4, p[1])];
      case 'crumble': return ['crumble', Math.min(5, p[1])];
      case 'lift': return ['lift', Math.min(4, p[1])];
      case 'down': return ['down', Math.min(3, p[1])];
      default: return p;
    }
  });
}
for (const w of WINGS.slice(1)) w.bands = w.bands.map(gentle);

const HUBS = [
  { id: 'atrium', name: 'Atrium', biome: 1, sign: 'Welcome back, P-1P. Mind the bodies.' },
  { id: 'hub2', name: 'Mid Atrium', biome: 2 },
  { id: 'hub3', name: 'Upper Atrium', biome: 3 },
  { id: 'hub4', name: 'Core Access', biome: 4 },
];

const rooms: LevelData[] = [];
const layout: Record<string, { x: number; y: number }> = {};
const chain: Array<{ chamber: string; zone: string; entrance: string; door: { room: string; exit: string } }> = [];

WINGS.forEach((spec, i) => {
  const h = HUBS[i]!;
  const nextHub = HUBS[i + 1];
  const hubRoom = hub(h.id, h.name, h.biome, spec.seed + 7, {
    in: i === 0 ? undefined : { room: WINGS[i - 1]!.id, exit: 'up' },
    out: { room: spec.id, exit: 'hub' },
    start: i === 0,
    sign: h.sign,
    dark: h.id === 'hub4',
  });
  rooms.push(hubRoom);
  const { room } = wing(spec, { room: h.id, exit: 'out' }, nextHub ? { room: nextHub.id, exit: 'in' } : null);
  rooms.push(room);
  const hubY = (3 - i) * 64;
  layout[h.id] = { x: 0, y: hubY };
  layout[spec.id] = { x: 56, y: hubY - 15 };
  spec.chambers.forEach((c, k) => {
    layout[c] = { x: 56 + spec.width + 3, y: hubY - 15 + k * BH };
    const lastChamberOfWorld = i === WINGS.length - 1 && k === spec.chambers.length - 1;
    chain.push({
      chamber: c, zone: spec.id, entrance: `to${c}`,
      door: lastChamberOfWorld ? { room: 'credits', exit: 'in' } : { room: spec.id, exit: `arr${k + 1}` },
    });
  });
});
layout.credits = { x: 56 + 112 + 30, y: -64 };

const world = {
  version: 1 as const,
  name: 'The Facility',
  start: { room: 'atrium' },
  rooms: [...rooms.map((r) => r.id), ...chain.map((c) => c.chamber), 'credits'],
  layout,
  /** Chamber hookup: entrance exit in the zone, and where the door leads. Applied by resolveWorld(). */
  chain,
  /** If Act 4 isn't present, the last Act 3 chamber's door leads straight to the credits. */
  fallback: { act4: ['hub4', 'w4', 'L13', 'L14', 'L15', 'L16'], lastAct3: 'L12' },
  entrances: {},
};

mkdirSync('src/levels/world', { recursive: true });
for (const r of rooms) writeFileSync(`src/levels/world/${r.id}.json`, JSON.stringify(r) + '\n');
writeFileSync('src/levels/world.json', JSON.stringify(world, null, 2) + '\n');
console.log(`wrote ${rooms.length} zones: ${rooms.map((r) => `${r.id} ${r.width}x${r.height}`).join(', ')}`);
console.log(`relics: ${rooms.reduce((n, r) => n + r.objects.filter((o) => o.type === 'relic').length, 0)}`);
