// Every sprite in the game, generated into one atlas texture at boot. Pip is hand-authored in ASCII;
// corpses, props and particles are drawn pixel by pixel from small shape routines.
import Phaser from 'phaser';
import { KEY, css } from './pal';

export const ATLAS = 'atlas';

type Ctx = CanvasRenderingContext2D;

// ---------------------------------------------------------------------------
// Atlas packing
// ---------------------------------------------------------------------------

interface Pending { name: string; w: number; h: number; draw: (ctx: Ctx) => void }
const pending: Pending[] = [];
const def = (name: string, w: number, h: number, draw: (ctx: Ctx) => void) => pending.push({ name, w, h, draw });

/** Pixel painter bound to an origin. */
class Pen {
  constructor(public ctx: Ctx) {}
  px(x: number, y: number, c: number, a = 1): void { this.ctx.fillStyle = css(c, a); this.ctx.fillRect(x, y, 1, 1); }
  rect(x: number, y: number, w: number, h: number, c: number, a = 1): void { if (w <= 0 || h <= 0) return; this.ctx.fillStyle = css(c, a); this.ctx.fillRect(x, y, w, h); }
  /** Paint ASCII rows with palette keys ('.' and ' ' are transparent). */
  ascii(x: number, y: number, rows: string[], remap: Record<string, string> = {}): void {
    rows.forEach((r, j) => { for (let i = 0; i < r.length; i++) { const ch = remap[r[i]!] ?? r[i]!; if (ch === '.' || ch === ' ') continue; const c = KEY[ch]; if (c !== undefined) this.px(x + i, y + j, c); } });
  }
}

export function buildAtlas(scene: Phaser.Scene): void {
  if (scene.textures.exists(ATLAS)) return;
  defineAll();
  // Shelf packing, tallest first.
  const items = [...pending].sort((a, b) => b.h - a.h || b.w - a.w);
  const W = 1024;
  let x = 1, y = 1, shelf = 0;
  const pos = new Map<string, { x: number; y: number }>();
  for (const it of items) {
    if (x + it.w + 1 > W) { x = 1; y += shelf + 1; shelf = 0; }
    pos.set(it.name, { x, y });
    x += it.w + 1;
    shelf = Math.max(shelf, it.h);
  }
  const H = Math.pow(2, Math.ceil(Math.log2(y + shelf + 2)));
  const tex = scene.textures.createCanvas(ATLAS, W, H)!;
  const ctx = tex.getContext();
  ctx.imageSmoothingEnabled = false;
  for (const it of items) {
    const p = pos.get(it.name)!;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.beginPath(); ctx.rect(0, 0, it.w, it.h); ctx.clip();
    it.draw(ctx);
    ctx.restore();
    tex.add(it.name, 0, p.x, p.y, it.w, it.h);
  }
  tex.refresh();
  pending.length = 0;
}

// ---------------------------------------------------------------------------
// ASCII grid helpers (for Pip's frame variants)
// ---------------------------------------------------------------------------

const rowsOf = (s: string) => s.trim().split('\n').map((r) => r.trim());
const shiftRows = (g: string[], from: number, to: number, dy: number): string[] => {
  const out = [...g];
  const blank = '.'.repeat(g[0]!.length);
  if (dy > 0) { for (let r = to; r >= from; r--) out[r + dy] = g[r]!; for (let r = from; r < from + dy; r++) out[r] = blank; }
  else { for (let r = from; r <= to; r++) out[r + dy] = g[r]!; for (let r = to + dy + 1; r <= to; r++) out[r] = blank; }
  return out.slice(0, g.length);
};
const shiftX = (g: string[], from: number, to: number, dx: number): string[] =>
  g.map((r, j) => (j < from || j > to ? r : dx > 0 ? ('.'.repeat(dx) + r).slice(0, r.length) : (r + '.'.repeat(-dx)).slice(-dx)));
const setRows = (g: string[], rows: Record<number, string>): string[] => g.map((r, j) => rows[j] ?? r);

// ---------------------------------------------------------------------------
// Pip (16×16, facing right; feet on the bottom row)
// ---------------------------------------------------------------------------

const PIP = rowsOf(`
................
...kk......kk...
..kbbk....kbbk..
..kbqkkkkkkqbk..
...kqqqqqqqqk...
..kqqqqqqqqqqk..
..kppppkwppkwpk.
..kppppkkppkkpk.
..kpbbpkkppkkbk.
..kppppppppnppk.
..kPpppppppppPk.
kpkPPpppppppPPk.
.k.kPPPPPPPPPk..
....kkkkkkkkk...
....kpk...kpk...
....kkk...kkk...
`);
const FEET = {
  idle: ['....kpk...kpk...', '....kkk...kkk...'],
  a: ['..kpk......kpk..', '..kk........kk..'],
  b: ['.....kpk.kpk....', '.....kkk.kkk....'],
  c: ['...kpk....kpk...', '...kk......kk...'],
  tuck: ['.....kpkkpk.....', '......kk.kk.....'],
  spread: ['..kpk.....kpk...', '.kk.........kk..'],
};
const withFeet = (g: string[], f: string[]) => setRows(g, { 14: f[0]!, 15: f[1]! });
const BLINK = { 6: '..kpppppppppppk.', 7: '..kppppkkppkkpk.' };
const LOOK_BACK = { 6: '..kpppkwppkwppk.', 7: '..kpppkkppkkppk.', 8: '..kpbbkkppkkpbk.' };
const DEAD = { 6: '..kpppkpkpkpkpk.', 7: '..kppppkpppkppk.', 8: '..kpbbkpkpkpkbk.', 9: '..kpppppnnnpppk.' };

function pipFrames(): Record<string, string[]> {
  const base = PIP;
  const bob = shiftRows(base, 1, 12, 1);
  const lean = (g: string[], dx: number) => shiftX(g, 1, 9, dx);
  const run1 = withFeet(lean(base, 1), FEET.a);
  const run2 = withFeet(lean(shiftRows(base, 1, 13, -1), 1), FEET.b);
  const run3 = withFeet(lean(base, 1), FEET.c);
  const jump = withFeet(shiftRows(base, 1, 13, -1), FEET.tuck);
  const fall = withFeet(setRows(base, { 1: '..kk........kk..', 2: '..kbk......kbk..' }), FEET.spread);
  // Squash: drop two head rows, widen by one column.
  const sq = [...base];
  sq.splice(4, 1); sq.splice(8, 1); sq.unshift('................', '................');
  const land = sq.map((r) => r.slice(0, 8) + r[8] + r.slice(8, 15));
  return {
    idle0: base, idle1: bob, blink: setRows(base, BLINK), blink1: setRows(bob, { 7: BLINK[6], 8: BLINK[7] }),
    run0: run1, run1: run2, run2: run3, run3: run2,
    jump, fall, land: withFeet(land, FEET.idle),
    push: withFeet(lean(base, 1), FEET.a),
    pull: withFeet(setRows(lean(base, -1), LOOK_BACK), FEET.c),
    dead: setRows(base, DEAD),
    // Hanging from a vine: paws up, feet dangling.
    hang: setRows(shiftRows(base, 1, 15, 1), { 0: '...kk.kk.kk.....', 1: '...kpkkpkpk.....', 14: '.....kpk.kpk....', 15: '.....kk...kk....' }),
    // Sliding down a wall (wall on the right): squished against it, one paw on the wall.
    wall: withFeet(setRows(lean(base, 1), { 8: '..kpbbpkkppkkbkk', 9: '..kppppppppnppkp' }), FEET.c),
  };
}

// ---------------------------------------------------------------------------
// Corpses: blob shapes per stage and form
// ---------------------------------------------------------------------------

type Look = 'body' | 'slab' | 'floor' | 'wall';
const STAGE_COL = [
  { f: KEY.p!, s: KEY.P!, l: KEY.q! },
  { f: KEY.g!, s: KEY.G!, l: KEY.h! },
];

/** Rounded blob mask with an outline, shaded bottom and lit top. */
function blob(pen: Pen, x0: number, y0: number, w: number, h: number, col: { f: number; s: number; l: number }, r = 3): boolean[][] {
  const inside = (i: number, j: number) => {
    if (i < 0 || j < 0 || i >= w || j >= h) return false;
    const rr = Math.min(r, Math.floor(h / 2), Math.floor(w / 2));
    const cx = i < rr ? rr - 0.5 : i >= w - rr ? w - rr - 0.5 : i;
    const cy = j < rr ? rr - 0.5 : j >= h - rr ? h - rr - 0.5 : j;
    return (i - cx) ** 2 + (j - cy) ** 2 <= rr * rr + 0.3;
  };
  const m: boolean[][] = [];
  for (let j = 0; j < h; j++) { m.push([]); for (let i = 0; i < w; i++) m[j]!.push(inside(i, j)); }
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    if (!m[j]![i]) continue;
    const edge = !inside(i - 1, j) || !inside(i + 1, j) || !inside(i, j - 1) || !inside(i, j + 1);
    let c = col.f;
    if (edge) c = KEY.k!;
    else if (j >= h - 2 || (j >= h - 3 && i < 3)) c = col.s;
    else if (j <= 1 + (h > 6 ? 1 : 0) && i > 1 && i < w - 3) c = col.l;
    pen.px(x0 + i, y0 + j, c);
  }
  return m;
}

const X_EYE = ['k.k', '.k.', 'k.k'];

function corpseFresh(pen: Pen, look: Look, h: number): void {
  const c = STAGE_COL[0]!;
  if (look === 'body') {
    // On its back, feet up, head to the right with X eyes and the tongue out.
    blob(pen, 0, 3, 16, h - 3, c, 4);
    pen.ascii(3, 0, ['kk.kk', 'kpkpk', 'kpkpk']);
    pen.ascii(12, 1, ['kk', 'bk']);
    pen.ascii(8, 5, X_EYE); pen.ascii(12, 5, X_EYE);
    pen.ascii(10, 9, ['nT', '.T']);
    pen.ascii(3, 8, ['bb']);
  } else if (look === 'wall') {
    blob(pen, 0, 0, 16, h, c, 3);
    pen.ascii(9, 1, ['k.k', '.k.']); pen.ascii(12, 1, ['k.k', '.k.']);
    pen.ascii(13, 4, ['T', 'T']);
    pen.ascii(2, h - 1, ['kk..kk']);
  } else {
    const top = look === 'floor' ? 2 : 0;
    blob(pen, 0, top, 16, h - top, c, 2);
    pen.ascii(8, top + 1, ['k.kk.k', '.k..k.']);
    pen.ascii(14, top + 2, ['T']);
    pen.ascii(2, top + 1, ['bb']);
    if (look === 'floor') pen.ascii(0, 0, ['..r....r....r...', '.yR...yR...yR...']);
  }
}

function corpseRot(pen: Pen, look: Look, h: number): void {
  const c = STAGE_COL[1]!;
  if (look === 'body' || look === 'wall') {
    blob(pen, 0, 0, 16, h - (look === 'body' ? 1 : 0), c, 3);
    // Droopy eyes, a slack mouth and drips.
    pen.ascii(9, 2, ['kk.kk']);
    pen.ascii(10, 4, ['fGf']);
    pen.ascii(3, 1, ['G.f']);
    if (look === 'body') { pen.px(4, h - 1, KEY.G!); pen.px(11, h - 1, KEY.G!); }
  } else {
    const top = look === 'floor' ? 2 : 0;
    blob(pen, 0, top, 16, h - top, c, 2);
    pen.ascii(9, top + 1, ['kk.kk']);
    pen.px(3, top + 1, KEY.f!);
    if (look === 'floor') pen.ascii(0, 0, ['..r....r....r...', '.yR...yR...yR...']);
  }
}

function corpseBones(pen: Pen, look: Look, h: number): void {
  const y = h - 4;
  if (look === 'floor') pen.ascii(0, 0, ['..r....r....r...', '.yR...yR...yR...']);
  // Skull on the right, spine and ribs, a femur on the left.
  pen.ascii(0, Math.max(0, y), [
    'kk.........kkkk.',
    'okk.k.k.k.kooook',
    'kookokokokokokok',
    'kk..k.k.k..kkkk.',
  ]);
  if (look === 'wall') pen.ascii(0, 0, ['kkkkkkkkkkkkkkk.', 'kooooooooooooook', '.kkkkkkkkkkkkkk.'].slice(0, Math.min(3, h)));
}

const CORPSE_SIZES: Record<Look, [number, number, number]> = { body: [13, 8, 5], slab: [5, 5, 4], floor: [8, 7, 6], wall: [7, 7, 3] };

function defineCorpses(): void {
  const looks: Look[] = ['body', 'slab', 'floor', 'wall'];
  for (const look of looks) for (let st = 0; st < 3; st++) {
    const h = CORPSE_SIZES[look][st]!;
    def(`c${st}_${look}`, 16, h, (ctx) => {
      const pen = new Pen(ctx);
      if (st === 0) corpseFresh(pen, look, h);
      else if (st === 1) corpseRot(pen, look, h);
      else corpseBones(pen, look, h);
    });
  }
  // HUD icons (12×9).
  for (let st = 0; st < 3; st++) def(`icon${st}`, 14, 10, (ctx) => {
    const pen = new Pen(ctx);
    if (st === 0) { blob(pen, 0, 3, 14, 7, STAGE_COL[0]!, 3); pen.ascii(2, 0, ['kk.kk', 'kpkpk', 'kkkkk']); pen.ascii(8, 5, ['k.k.k']); }
    else if (st === 1) { blob(pen, 0, 4, 14, 6, STAGE_COL[1]!, 3); pen.ascii(8, 6, ['kk.k']); pen.px(3, 2, KEY.f!); pen.px(10, 1, KEY.f!); }
    else pen.ascii(0, 5, ['........kkkkk.', '.k.k.k.koooook', 'kokokokooookok', '.k.k.k.k.kkkk.']);
  });
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

function defineProps(): void {
  // Exit: a lab airlock with a glowing status panel and striped sill.
  const DOOR = rowsOf(`
kkkkkkkkkkkkkkkk
kMMMMMMMMMMMMMMk
kMkkkkkkkkkkkkMk
kMkjjjjjjjjjjkMk
kMkJjjjjjjjjJkMk
kMkkkkkkkkkkkkMk
kMklllllklllllMk
kMklmmmmkmmmmlMk
kMklmmmmkmmmmlMk
kMklmmlmkmlmmlMk
kMklmmlmkmlmmlMk
kMklmmmmkmmmmlMk
kMklmmmmkmmmmlMk
kMkzkzkzkzkzkzMk
kMkkzkzkkkzkzkMk
kkkkkkkkkkkkkkkk
`);
  def('door', 16, 16, (ctx) => new Pen(ctx).ascii(0, 0, DOOR));
  // Runaway airlock on little robot legs.
  const body = DOOR.slice(0, 13).concat(['kkkkkkkkkkkkkkkk']);
  const legs: Record<string, string[]> = {
    stand: ['...kMk....kMk...', '..kkkkk..kkkkk..'],
    runA: ['..kMk......kMk..', '.kkkk......kkkk.'],
    runB: ['....kMk..kMk....', '...kkkk..kkkk...'],
    hop: ['....kkkkkkkk....', '................'],
  };
  for (const [k, l] of Object.entries(legs)) def(`doorLegs_${k}`, 16, 16, (ctx) => { const p = new Pen(ctx); p.ascii(0, 0, body); p.ascii(0, 14, l); });
  def('doorSmirk', 6, 2, (ctx) => new Pen(ctx).ascii(0, 0, ['k....k', '.kkkk.']));

  // Glow halo for the airlock (pixel rings, tinted green).
  def('halo', 32, 32, (ctx) => {
    const p = new Pen(ctx);
    for (let j = 0; j < 32; j++) for (let i = 0; i < 32; i++) {
      const d = Math.hypot(i - 15.5, j - 15.5);
      const a = d < 6 ? 0.5 : d < 10 ? 0.3 : d < 13 ? 0.16 : d < 16 ? 0.07 : 0;
      if (a > 0 && ((i + j) % 2 === 0 || d < 10)) p.px(i, j, 0xffffff, a);
    }
  });

  // Sign: a CRT monitor on a pole (two frames: the screen flickers).
  for (let f = 0; f < 2; f++) def(`signpost${f}`, 12, 14, (ctx) => {
    const g = f ? 'a' : 'c';
    new Pen(ctx).ascii(0, 0, rowsOf(`
kkkkkkkkkkkk
kMMMMMMMMMMk
kMkkkkkkkkMk
kMk${g}${g}${g}${g}${g}${g}kMk
kMkCCCCCCkMk
kMk${g}${g}${g}${g}${g}${g}kMk
kMkkkkkkkkMk
kMMMMMMzMMMk
kkkkkkkkkkkk
.....kk.....
.....kM.....
.....kM.....
....kkkk....
...kMMMMk...
`));
  });

  // Spike teeth (16×6) used by pop-ups.
  const TEETH = rowsOf(`
..k...k...k...k.
.kyk.kyk.kyk.kyk
.kyrkkyrkkyrkkyr
kyrrRkyrRkyrRkyr
kyrrRRyrRRyrRRyR
kkkkkkkkkkkkkkkk
`);
  for (let f = 0; f < 4; f++) def(`pop${f}`, 16, 16, (ctx) => { const h = [1, 3, 5, 6][f]!; new Pen(ctx).ascii(0, 16 - h, TEETH.slice(6 - h)); });

  // Pressure pads with LED weight pips.
  def('plateBase', 16, 3, (ctx) => new Pen(ctx).ascii(0, 0, ['kkkkkkkkkkkkkkkk', 'kzkzkzkzkzkzkzkk', 'kMMMMMMMMMMMMMMk']));
  def('plateBtnOff', 14, 3, (ctx) => new Pen(ctx).ascii(0, 0, ['kkkkkkkkkkkkkk', 'klllllllllllyk', 'kRRRRRRRRRRRRk']));
  def('plateBtnOn', 14, 3, (ctx) => new Pen(ctx).ascii(0, 0, ['kkkkkkkkkkkkkk', 'kllllllllllljk', 'kJJJJJJJJJJJJk']));
  def('pipOn', 3, 3, (ctx) => new Pen(ctx).ascii(0, 0, ['kjk', 'jwj', 'kjk']));
  def('pipOff', 3, 3, (ctx) => new Pen(ctx).ascii(0, 0, ['kkk', 'kRk', 'kkk']));

  // Blast shutter: stacked steel slats (tiles vertically) with a striped bottom edge.
  def('gateBars', 16, 8, (ctx) => new Pen(ctx).ascii(0, 0, rowsOf(`
...kkkkkkkkkk...
...kllllllllk...
...kmmmmmmmmk...
...kMMMMMMMMk...
...kkkkkkkkkk...
...klllllllMk...
...kmmmmmmmMk...
...kMMMMMMMMk...
`)));
  def('gateTip', 16, 3, (ctx) => new Pen(ctx).ascii(0, 0, ['...kzkzkzkzkk...', '...kkzkzkzkzk...', '...kkkkkkkkkk...']));

  // Maintenance lift (solid) and a grated catwalk (drop-through), 4 px thick.
  def('plank', 16, 4, (ctx) => new Pen(ctx).ascii(0, 0, ['kkkkkkkkkkkkkkkk', 'zzkkzzkkzzkkzzkk', 'mmmmlmmmmmmmlmmm', 'kkkkkkkkkkkkkkkk']));
  def('bonePlank', 16, 4, (ctx) => new Pen(ctx).ascii(0, 0, ['kkkkkkkkkkkkkkkk', 'lkllklllkllklllk', 'k.k.k.k.k.k.k.k.', '.k...k...k...k..']));
  // Press piston rod (tiles vertically).
  def('piston', 8, 8, (ctx) => new Pen(ctx).ascii(0, 0, ['.kllmMk.', '.kllmMk.', '.kllmMk.', '.kllmMk.', '.kllmMk.', '.kllmMk.', '.kllmMk.', '.kkkkkk.']));

  // Security laser emitter (points down) and the beam.
  def('emitter', 16, 16, (ctx) => new Pen(ctx).ascii(0, 0, rowsOf(`
kkkkkkkkkkkkkkkk
kMMMMMMMMMMMMMMk
kMKKKKKKKKKKKKMk
kMKzKKKKKKKKrKMk
kMKKKKKKKKKKKKMk
kMKKKkkkkkkKKKMk
kMKKkxxxxxxkKKMk
kMKKkxXXXXxkKKMk
kMKKkxxxxxxkKKMk
kMKKKkkkkkkKKKMk
kMMMMMMMMMMMMMMk
kkkkkkkkkkkkkkkk
....kMMMMMMk....
....kkxXXxkk....
.....kxXXxk.....
......kxxk......
`)));
  for (let f = 0; f < 3; f++) def(`beam${f}`, 16, 16, (ctx) => {
    const p = new Pen(ctx);
    for (let j = 0; j < 16; j++) {
      const wob = ((j + f * 5) % 7 === 0) ? 1 : 0;
      p.rect(5 - wob, j, 6 + wob * 2, 1, KEY.x!, 0.35);
      p.rect(6, j, 4, 1, KEY.x!);
      p.rect(7, j, 2, 1, KEY.X!);
      if ((j * 3 + f * 7) % 11 === 0) p.px(4, j, KEY.X!, 0.8);
    }
  });

  for (let f = 0; f < 3; f++) def(`beamh${f}`, 16, 16, (ctx) => {
    const p = new Pen(ctx);
    for (let i = 0; i < 16; i++) {
      const wob = ((i + f * 5) % 7 === 0) ? 1 : 0;
      p.rect(i, 5 - wob, 1, 6 + wob * 2, KEY.x!, 0.35);
      p.rect(i, 6, 1, 4, KEY.x!);
      p.rect(i, 7, 1, 2, KEY.X!);
      if ((i * 3 + f * 7) % 11 === 0) p.px(i, 4, KEY.X!, 0.8);
    }
  });
  // Laser off: faint dotted guide so a blinking beam stays readable.
  def('beamOffV', 16, 16, (ctx) => { const p = new Pen(ctx); for (let j = 0; j < 16; j += 4) p.rect(7, j, 2, 2, KEY.x!, 0.35); });
  def('beamOffH', 16, 16, (ctx) => { const p = new Pen(ctx); for (let i = 0; i < 16; i += 4) p.rect(i, 7, 2, 2, KEY.x!, 0.35); });

  // Conveyor belt strip (scrolls), water surface wave (scrolls).
  def('belt', 16, 5, (ctx) => new Pen(ctx).ascii(0, 0, ['kkkkkkkkkkkkkkkk', 'KKKKKKKKKKKKKKKK', 'KkKKKKKKKkKKKKKK', 'MMMMMMMMMMMMMMMM', 'kkkkkkkkkkkkkkkk']));
  def('chevron', 16, 3, (ctx) => new Pen(ctx).ascii(0, 0, ['..j.......j.....', '...j.......j....', '..j.......j.....']));
  for (let f = 0; f < 4; f++) def(`wave${f}`, 16, 4, (ctx) => {
    const p = new Pen(ctx);
    for (let i = 0; i < 16; i++) {
      const s = Math.round(Math.sin(((i + f * 4) / 16) * Math.PI * 2) * 1);
      p.rect(i, 1 + s, 1, 4, KEY.c!);
      p.px(i, 1 + s, KEY.a!);
      if ((i + f * 4) % 8 === 0) p.px(i, 2 + s, KEY.w!);
    }
  });

  // Fly (2 frames) for Rot bodies.
  def('fly0', 3, 2, (ctx) => new Pen(ctx).ascii(0, 0, ['WkW', '.k.']));
  def('fly1', 3, 2, (ctx) => new Pen(ctx).ascii(0, 0, ['.k.', 'WkW']));

  // Soft contact shadow.
  def('shadow', 14, 3, (ctx) => { const p = new Pen(ctx); p.rect(2, 0, 10, 3, KEY.k!, 0.18); p.rect(0, 1, 14, 1, KEY.k!, 0.18); });

  // Particles (white, tinted at use).
  def('p1', 1, 1, (ctx) => new Pen(ctx).px(0, 0, 0xffffff));
  def('p2', 2, 2, (ctx) => new Pen(ctx).rect(0, 0, 2, 2, 0xffffff));
  def('p3', 3, 3, (ctx) => new Pen(ctx).ascii(0, 0, ['.w.', 'www', '.w.']));
  def('spark', 5, 5, (ctx) => new Pen(ctx).ascii(0, 0, ['..w..', '..w..', 'wwwww', '..w..', '..w..']));
  def('bonebit', 4, 3, (ctx) => new Pen(ctx).ascii(0, 0, ['k..k', 'oooo', 'k..k']));
  def('drop', 2, 3, (ctx) => new Pen(ctx).ascii(0, 0, ['.a', 'ac', 'cc']));
  def('debris', 3, 3, (ctx) => new Pen(ctx).ascii(0, 0, ['kkk', 'kmk', 'kkk']));
  const PUFFS = [
    ['.ww.', 'wwww', 'wwww', '.ww.'],
    ['..www..', '.wwwww.', 'wwwwwww', 'wwwwwww', '.wwwww.', '..www..'],
    ['..w.w..', '.w...w.', 'w.....w', 'w.....w', '.w...w.', '..w.w..'],
    ['...w...', '.w...w.', '.......', 'w.....w', '.......', '.w...w.'],
  ];
  PUFFS.forEach((r, i) => def(`puff${i}`, r[0]!.length, r.length, (ctx) => new Pen(ctx).ascii(0, 0, r)));

  // World objects.
  def('crate', 16, 16, (ctx) => new Pen(ctx).ascii(0, 0, rowsOf(`
kkkkkkkkkkkkkkkk
klllllllllllllMk
klkkkkkkkkkkklMk
klkmmmmmmmmmklMk
klkmzkzkzkzmklMk
klkmmmmmmmmmklMk
klkmmmkkkmmmklMk
klkmmkWWWkmmklMk
klkmmkWrWkmmklMk
klkmmkWWWkmmklMk
klkmmmkkkmmmklMk
klkmmmmmmmmmklMk
klkkkkkkkkkkklMk
klllllllllllllMk
kMMMMMMMMMMMMMMk
kkkkkkkkkkkkkkkk
`)));
  for (let f = 0; f < 2; f++) def(`bench${f}`, 16, 16, (ctx) => {
    const sc = f ? 'j' : 'K', hi = f ? 'w' : 'M';
    new Pen(ctx).ascii(0, 0, rowsOf(`
................
..kkkkkkkkkkkk..
..kMMMMMMMMMMk..
..kMkkkkkkkkMk..
..kMk${sc}${sc}${sc}${sc}${sc}${sc}kMk..
..kMk${sc}${hi}${sc}${sc}${sc}${sc}kMk..
..kMk${sc}${sc}${sc}${sc}${sc}${sc}kMk..
..kMkkkkkkkkMk..
..kMMMMMMMMMMk..
..kkkkkkkkkkkk..
.....kMMMMk.....
...kkkkkkkkkk...
..kllllllllllk..
..kmz${f ? 'j' : 'R'}mmmmmmmk..
..kMMMMMMMMMMk..
..kkkkkkkkkkkk..
`));
  });
  def('note', 10, 12, (ctx) => new Pen(ctx).ascii(0, 0, rowsOf(`
...kkkk...
.kkkMMkkk.
kWWkkkkWWk
kWWWWWWWWk
kWkkkkkWWk
kWWWWWWWWk
kWkkkkkkWk
kWWWWWWWWk
kWkkkkWWWk
kWWWWWWWWk
kWWWWWWWOk
kkkkkkkkkk
`)));
  def('jar', 10, 13, (ctx) => new Pen(ctx).ascii(0, 0, rowsOf(`
..kkkkkk..
..kMMMMk..
.kkkkkkkk.
.kWaaaack.
kWacccccCk
kWaccgccCk
kWacgggcCk
kWacggccCk
kWaccccCCk
kWccccCCCk
.kCCCCCCk.
.kkkkkkkk.
..........
`)));
  // Light sensor: a lens in a bolted panel; the iris lights up gold-white while the beam hits it.
  for (let f = 0; f < 2; f++) def(`sensor${f}`, 16, 16, (ctx) => {
    const a = f ? 'z' : 'K', b = f ? 'w' : 'm', c = f ? 'y' : 'k';
    new Pen(ctx).ascii(0, 0, rowsOf(`
.kkkkkkkkkkkkkk.
kMMMMMMMMMMMMMMk
kMlkkkkkkkkkklMk
kMkkk${a}${a}${a}${a}${a}${a}kkkMk
kMkk${a}${a}${b}${b}${a}${a}${a}${a}kkMk
kMk${a}${a}${b}${b}${b}${a}${a}${a}${a}${a}kMk
kMk${a}${b}${b}${a}${c}${c}${a}${a}${a}${a}kMk
kMk${a}${a}${a}${c}kk${c}${a}${a}${a}kMk
kMk${a}${a}${a}${c}kk${c}${a}${a}${a}kMk
kMk${a}${a}${a}${a}${c}${c}${a}${a}${a}${a}kMk
kMk${a}${a}${a}${a}${a}${a}${a}${a}${a}${a}kMk
kMkk${a}${a}${a}${a}${a}${a}${a}${a}kkMk
kMkkk${a}${a}${a}${a}${a}${a}kkkMk
kMlkkkkkkkkkklMk
kMMMMMMMMMMMMMMk
.kkkkkkkkkkkkkk.
`));
  });
  // HUD: wall-jump icon (a gripped wall with a kick-off arrow).
  def('iconWall', 13, 12, (ctx) => new Pen(ctx).ascii(0, 0, [
    'kkk..........', 'kjk.....k....', 'kJk....kwk...', 'kjkkkkkwwwk..', 'kJwwwwwwwwwk.', 'kjkkkkkwwwk..',
    'kJk....kwk...', 'kjk.....k....', 'kJk..........', 'kjk..........', 'kJk..........', 'kkk..........']));
  def('lamp', 10, 6, (ctx) => new Pen(ctx).ascii(0, 0, ['..kkkkkk..', '.kMMMMMMk.', 'kMMMMMMMMk', 'kzzzzzzzzk', '.kwwwwwwk.', '..kkkkkk..']));
  def('arrow', 7, 7, (ctx) => new Pen(ctx).ascii(0, 0, ['..k....', '..kk...', 'kkkwk..', 'kwwwwk.', 'kkkwk..', '..kk...', '..k....']));
  def('vineSeg', 2, 6, (ctx) => new Pen(ctx).ascii(0, 0, ['gG', 'Gg', 'gG', 'fG', 'gG', 'Gg']));
  def('leaf', 4, 3, (ctx) => new Pen(ctx).ascii(0, 0, ['.hg.', 'hggf', '.gf.']));
  def('cableSeg', 2, 6, (ctx) => new Pen(ctx).ascii(0, 0, ['kK', 'Kk', 'kK', 'kK', 'Kk', 'kK']));
  def('ragHead', 10, 9, (ctx) => new Pen(ctx).ascii(0, 0, ['.kk...kk.', 'kbbk.kbbk', 'kpppppppk', 'kpkpkpkpk', 'kppkppkpk', 'kpkpkpkpk', 'kpbpppbpk', '.kpppppk.', '..kkkkk..'].map((r) => r.padEnd(10, '.'))));
  def('ragLimb', 3, 3, (ctx) => new Pen(ctx).ascii(0, 0, ['kkk', 'kpk', 'kkk']));
  // Soft light brush (white, alpha falls off; dithered rings at the rim) for the darkness layer.
  def('light', 48, 48, (ctx) => {
    const p = new Pen(ctx);
    for (let j = 0; j < 48; j++) for (let i = 0; i < 48; i++) {
      const d = Math.hypot(i - 23.5, j - 23.5) / 24;
      if (d >= 1) continue;
      const a = d < 0.45 ? 1 : d < 0.7 ? 0.7 : d < 0.85 ? ((i + j) % 2 ? 0.45 : 0.25) : (i + j) % 2 ? 0.18 : 0;
      if (a > 0) p.px(i, j, 0xffffff, a);
    }
  });
  // Fog band (tiles horizontally; dithered so it stays pixel-crisp).
  def('fog', 64, 20, (ctx) => {
    const p = new Pen(ctx);
    for (let j = 0; j < 20; j++) for (let i = 0; i < 64; i++) {
      const v = Math.sin((i / 64) * Math.PI * 2 * 2 + j * 0.3) * 0.5 + 0.5;
      const edge = 1 - Math.abs(j - 9.5) / 10;
      const a = edge * (0.25 + v * 0.35);
      if ((i * 7 + j * 3) % 5 < Math.round(a * 5)) p.px(i, j, 0xffffff, 0.55);
    }
  });
  // Water caustics (tiles; drawn additively under the surface).
  for (let f = 0; f < 2; f++) def(`caustic${f}`, 16, 16, (ctx) => {
    const p = new Pen(ctx);
    for (let j = 0; j < 16; j++) for (let i = 0; i < 16; i++) {
      const v = Math.sin((i + f * 3) * 0.8 + Math.sin(j * 0.6) * 2) + Math.sin((j + f * 2) * 0.7 + Math.cos(i * 0.5) * 2);
      if (v > 1.3) p.px(i, j, 0xc8fff0, 0.5);
    }
  });

  // UI icons.
  def('skull', 9, 9, (ctx) => new Pen(ctx).ascii(0, 0, rowsOf(`
..kkkkk..
.kooooook
koooooook
kokkookko
kokkookko
kooooooOk
.kOokoOk.
..kokok..
...kkk...
`)));
  def('speaker', 11, 9, (ctx) => new Pen(ctx).ascii(0, 0, rowsOf(`
....k......
...kk...k..
kkkok.k..k.
kooOk..k.k.
kooOk..k.k.
kkkok.k..k.
...kk...k..
....k......
...........
`)));
  def('speakerOff', 11, 9, (ctx) => new Pen(ctx).ascii(0, 0, rowsOf(`
....k......
...kk......
kkkok.k...k
kooOk..k.k.
kooOk...k..
kkkok..k.k.
...kk.k...k
....k......
...........
`)));
  def('lock', 9, 10, (ctx) => new Pen(ctx).ascii(0, 0, rowsOf(`
..kkkkk..
.kk...kk.
.k.....k.
kkkkkkkkk
kmmmmmmmk
kmmmkmmmk
kmmmkmmmk
kmmmmmmmk
kMMMMMMMk
kkkkkkkkk
`)));
  def('check', 7, 6, (ctx) => new Pen(ctx).ascii(0, 0, ['.....kk', '....kjk', 'kk.kjk.', 'kjkjk..', '.kjk...', '..k....']));
  def('keyR', 11, 11, (ctx) => new Pen(ctx).ascii(0, 0, rowsOf(`
kkkkkkkkkkk
kWWWWWWWWWk
kWWkkkkWWWk
kWWkWWWkWWk
kWWkkkkWWWk
kWWkWkWWWWk
kWWkWWkWWWk
kWWWWWWWWWk
kOOOOOOOOOk
kOOOOOOOOOk
kkkkkkkkkkk
`)));
  def('iconNote', 7, 8, (ctx) => new Pen(ctx).ascii(0, 0, ['.kkkkk.', 'kWWWWWk', 'kWkkkWk', 'kWWWWWk', 'kWkkWWk', 'kWWWWWk', 'kWWWWOk', 'kkkkkkk']));
  def('iconJar', 7, 8, (ctx) => new Pen(ctx).ascii(0, 0, ['.kkkkk.', '.kMMMk.', 'kkkkkkk', 'kaccccK', 'kacgccK', 'kaccccK', 'kcCCCCk', '.kkkkk.']));
  def('heart', 7, 6, (ctx) => new Pen(ctx).ascii(0, 0, ['.kk.kk.', 'krrkyrk', 'krrrrrk', '.krrrk.', '..krk..', '...k...']));
}

function definePip(): void {
  for (const [name, g] of Object.entries(pipFrames())) def(`pip_${name}`, 16, 16, (ctx) => new Pen(ctx).ascii(0, 0, g));
}

let defined = false;
function defineAll(): void {
  if (defined) return;
  defined = true;
  definePip();
  defineCorpses();
  defineProps();
}

/** Atlas frame for a corpse. */
export function corpseFrame(stage: number, look: Look): string {
  return `c${stage}_${look}`;
}
export type { Look };
