// Editor building blocks: the document model, image pixelation, and composer songs.
import { describe, expect, it } from 'vitest';
import { EditorDoc, LIMITS, MAX_H, MAX_W, MIN_H, MIN_W, blankLevel, flipClip } from '../src/editor/model';
import { TRANSPARENT, artToRgba, decodeIndices, encodeIndices, makeArt, medianCut, quantize } from '../src/editor/pixelate';
import { TEMPLATES, emptySong, noteAt, normalizeSong, songKey, toggleNote } from '../src/editor/song';
import { validateLevel } from '../src/sim/level';
import { World } from '../src/sim/world';
import { DECOR_IDS, decorChar } from '../src/sim/types';
import { OBJECTS } from '../src/editor/tools';

describe('editor model', () => {
  it('paints terrain and decor layers, fills, draws rectangles, and undoes it all', () => {
    const d = new EditorDoc(blankLevel(12, 8));
    d.checkpoint();
    expect(d.setCell('terrain', 3, 3, '#')).toBe(true);
    expect(d.setCell('bg', 3, 3, decorChar(3))).toBe(true);
    d.changed();
    expect(d.level.decor?.bg?.[3]?.[3]).toBe(decorChar(3));
    expect(d.level.decor!.bg!).toHaveLength(8);
    d.checkpoint();
    const n = d.fill('bg', 1, 1, decorChar(0));
    d.changed();
    expect(n).toBe(12 * 8 - 1); // decor covers the whole room; everything but the painted window
    d.checkpoint();
    expect(d.rect('terrain', { x: 5, y: 2, w: 3, h: 2 }, '%')).toBe(6);
    d.changed();
    expect(validateLevel(d.level).ok).toBe(true);
    d.undo(); d.undo(); d.undo();
    expect(d.cell('terrain', 3, 3)).toBe('.');
    expect(d.cell('bg', 3, 3)).toBe('.');
    d.redo();
    expect(d.cell('terrain', 3, 3)).toBe('#');
  });

  it('copies, flips and pastes a block with objects', () => {
    const d = new EditorDoc(blankLevel(16, 8));
    d.setCell('terrain', 2, 2, '>');
    d.setCell('terrain', 3, 2, '#');
    d.level.objects.push({ type: 'crate', id: 'k1', x: 2, y: 3 });
    const clip = d.copy({ x: 2, y: 2, w: 3, h: 2 });
    expect(clip.terrain[0]).toBe('>#.');
    expect(clip.objects).toEqual([{ type: 'crate', id: 'k1', x: 0, y: 1 }]);
    const f = flipClip(clip, 'h');
    expect(f.terrain[0]).toBe('.#<'); // wall spikes turn to face the other way
    expect(f.objects[0]!.x).toBe(2);
    d.paste(f, 8, 4, { terrain: true, bg: true, fg: true, objects: true });
    expect(d.cell('terrain', 10, 4)).toBe('<');
    const crates = d.level.objects.filter((o) => o.type === 'crate');
    expect(crates).toHaveLength(2);
    expect(new Set(d.level.objects.map((o) => o.id)).size).toBe(d.level.objects.length);
  });

  it('resizes from a closet to a giant hall (any kind) and keeps decor rows in shape', () => {
    const d = new EditorDoc(blankLevel(12, 8));
    d.setCell('fg', 1, 1, decorChar(16));
    d.resize(500, 500);
    expect([d.level.width, d.level.height]).toEqual([MAX_W, MAX_H]);
    expect(validateLevel(d.level).ok).toBe(true);
    d.resize(120, 40);
    expect([d.level.width, d.level.height]).toEqual([120, 40]);
    expect(d.level.decor!.fg!.every((r) => r.length === 120)).toBe(true);
    expect(d.level.decor!.fg![1]![1]).toBe(decorChar(16));
    d.setKind('chamber');
    expect([d.level.width, d.level.height]).toEqual([120, 40]); // kind never crops
    d.resize(1, 1);
    expect([d.level.width, d.level.height]).toEqual([MIN_W, MIN_H]);
    expect(LIMITS.zone).toEqual(LIMITS.chamber);
  });

  it('removing an object drops every reference to it', () => {
    const d = new EditorDoc(blankLevel(12, 8));
    d.level.objects.push({ type: 'plate', id: 'pl1', x: 4, y: 6, w: 1, need: 1 }, { type: 'gate', id: 'g1', x: 8, y: 4, h: 3, plate: 'pl1' });
    d.eventFor({ type: 'plateDown', plate: 'pl1' }).actions.push({ type: 'toggleGate', target: 'g1' });
    d.removeObject('pl1');
    expect(d.byId('g1')).toMatchObject({ type: 'gate' });
    expect((d.byId('g1') as { plate?: string }).plate).toBeUndefined();
    expect(d.level.events).toHaveLength(0);
  });

  it('a level with every customization still runs in the sim', () => {
    const d = new EditorDoc(blankLevel(20, 10));
    d.fill('bg', 1, 1, decorChar(DECOR_IDS.indexOf('panel')));
    d.level.rules = { gravity: 0.8, maxCorpses: 5, aging: false };
    d.level.audio = { theme: TEMPLATES[0]!.make(), sfx: { jump: [0.5, 0, 300] } };
    const q = quantize(new Uint8ClampedArray(16 * 16 * 4).fill(200), 16, 16, 4, false);
    d.level.images = [makeArt('img1', 2, 2, 16, 16, q, 'bg')];
    d.level.objects.push({ type: 'vine', id: 'v1', x: 6, y: 0, len: 3 }, { type: 'crate', id: 'k1', x: 8, y: 8 }, { type: 'light', id: 'lt1', x: 3, y: 3 });
    expect(validateLevel(d.level).ok).toBe(true);
    const w = new World(d.level);
    for (let i = 0; i < 60; i++) w.step(0);
    expect(w.pipAlive).toBe(true);
  });
});

describe('pixelation', () => {
  it('builds a palette of at most n colours and keeps transparency', () => {
    const w = 8, h = 8;
    const px = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const x = i % w;
      px[i * 4] = x < 4 ? 250 : 10; px[i * 4 + 1] = x * 30; px[i * 4 + 2] = 40; px[i * 4 + 3] = i === 0 ? 0 : 255;
    }
    expect(medianCut(px, 4).length).toBeLessThanOrEqual(4);
    const q = quantize(px, w, h, 4, true);
    expect(q.palette.length).toBeLessThanOrEqual(4);
    expect(q.indices[0]).toBe(TRANSPARENT);
    expect(Math.max(...[...q.indices].filter((k) => k !== TRANSPARENT))).toBeLessThan(q.palette.length);
  });

  it('packs indices to base64 and back, and renders RGBA', () => {
    const a = new Uint8Array([0, 1, 2, 255, 3, 0, 1, 2, 3]);
    expect([...decodeIndices(encodeIndices(a))]).toEqual([...a]);
    const art = makeArt('i', 0, 0, 3, 3, { palette: ['#ff0000', '#00ff00', '#0000ff', '#ffffff'], indices: a }, 'fg');
    const rgba = artToRgba(art);
    expect([...rgba.slice(0, 4)]).toEqual([255, 0, 0, 255]);
    expect(rgba[3 * 4 + 3]).toBe(0); // transparent pixel
  });
});

describe('composer songs', () => {
  it('toggles notes and survives normalization', () => {
    const s = emptySong(100, 16);
    toggleNote(s, 0, 2, 72, 4);
    expect(noteAt(s, 0, 4, 72)).toBe(0);
    toggleNote(s, 0, 3, 72);
    expect(s.tracks[0]!.notes).toHaveLength(0);
    toggleNote(s, 5, 0, 1);
    const n = normalizeSong(JSON.parse(JSON.stringify({ ...s, bpm: 999, steps: 3 })));
    expect(n.bpm).toBe(240);
    expect(n.steps).toBe(4);
    expect(n.tracks).toHaveLength(6);
  });

  it('templates are valid and keyed stably', () => {
    for (const t of TEMPLATES) {
      const s = normalizeSong(t.make());
      for (const tr of s.tracks) for (const [st, , l] of tr.notes) { expect(st).toBeLessThan(s.steps); expect(l).toBeGreaterThan(0); }
      expect(songKey(s)).toBe(songKey(normalizeSong(t.make())));
    }
    const satie = TEMPLATES.find((t) => t.id === 'satie')!.make();
    expect(satie.steps % 12).toBe(0); // 3/4
  });
});

describe('editor light sensors and dark rooms', () => {
  it('places a sensor that opens a shutter in the sim, and deleting it unwires the shutter', () => {
    const d = new EditorDoc(blankLevel(16, 8));
    const item = OBJECTS.find((o) => o.id === 'sensor')!;
    const sensor = item.make!(d.newId(item.idPrefix!), 9, 5);
    expect(sensor).toEqual({ type: 'sensor', id: 'sn1', x: 9, y: 5 });
    d.edit((l) => { l.objects.push(sensor, { type: 'gate', id: 'g1', x: 12, y: 5, h: 2, plate: 'sn1' }); l.dark = true; });
    expect(validateLevel(d.level).ok).toBe(true);
    const w = new World(d.level);
    w.step(0);
    expect(w.obj.plates.find((p) => p.id === 'sn1')?.light).toBe(true);
    d.edit(() => { d.removeObject('sn1'); });
    expect(d.level.objects.find((o) => o.id === 'g1')).not.toHaveProperty('plate');
  });
});

describe('deleting anything', () => {
  it('clearing an area removes every object in it, the spawn and vines included', () => {
    const doc = new EditorDoc();
    const sp = doc.level.objects.find((o) => o.type === 'spawn')!;
    doc.level.objects.push({ type: 'vine', id: 'v1', x: sp.x + 1, y: 1, len: 3 });
    doc.edit(() => doc.clear({ x: 0, y: 0, w: doc.level.width, h: doc.level.height }, { terrain: false, bg: false, fg: false, objects: true }));
    expect(doc.level.objects).toHaveLength(0);
    expect(doc.validate().some((e) => e.includes('spawn'))).toBe(true); // flagged, not blocked
  });
});

describe('editor logic (events, gadgets, variables)', () => {
  it('builds every trigger, action and condition with valid defaults that describe themselves', async () => {
    const { TRIGGERS, ACTIONS, CONDITIONS, makeTrigger, makeAction, makeCond, describeEvent } = await import('../src/editor/logic');
    const d = new EditorDoc(blankLevel(20, 10));
    const l = d.level;
    l.zones.push({ id: 'z1', x: 3, y: 3, w: 2, h: 2 });
    l.objects.push({ type: 'plate', id: 'pl1', x: 5, y: 8, w: 1, need: 1 }, { type: 'gadget', id: 'g1', x: 8, y: 7, w: 1, h: 1, effect: { kind: 'none' } });
    for (const t of TRIGGERS) for (const a of ACTIONS) {
      const ev = { trigger: makeTrigger(t.type, { level: l }), actions: [makeAction(a.type, { level: l, cell: { x: 4, y: 4 } })] };
      const s = describeEvent(l, ev);
      expect(s.startsWith('When '), `${t.type}/${a.type}`).toBe(true);
      expect(s.includes('undefined'), s).toBe(false);
    }
    for (const c of CONDITIONS) expect(makeCond(c.type, { level: l }).type).toBe(c.type);
  });

  it('flags broken references and undefined variables, and renames follow links', async () => {
    const { logicProblems } = await import('../src/editor/logic');
    const d = new EditorDoc(blankLevel(20, 10));
    d.edit((l) => {
      l.zones.push({ id: 'z1', x: 3, y: 3, w: 2, h: 2 });
      l.objects.push({ type: 'gadget', id: 'g1', x: 8, y: 7, w: 1, h: 1, effect: { kind: 'none' }, when: { type: 'var', name: 'keys', op: '>=', value: 1 } });
      l.events.push({ trigger: { type: 'playerEnters', zone: 'z1' }, actions: [{ type: 'gadget', target: 'g1', op: 'toggle' }, { type: 'setVar', name: 'keys', op: 'add', value: 1 }] });
    });
    expect(logicProblems(d.level).some((p) => p.includes('“keys”'))).toBe(true);
    d.edit(() => d.ensureVar('keys'));
    expect(logicProblems(d.level)).toEqual([]);
    expect(d.rename('g1', 'vault')).toBe(true);
    expect(d.level.events[0]!.actions[0]).toMatchObject({ target: 'vault' });
    expect(d.rename('z1', 'vault')).toBe(false); // taken
    expect(d.rename('z1', 'hall')).toBe(true);
    expect(d.level.events[0]!.trigger).toMatchObject({ zone: 'hall' });
    // Deleting the gadget drops the action aimed at it; the event survives with its other action.
    d.edit(() => d.removeObject('vault'));
    expect(d.level.events[0]!.actions).toHaveLength(1);
    d.edit(() => d.removeZone('hall'));
    expect(d.level.events).toHaveLength(0);
  });

  it('gadgets get a footprint, resize handles and move with their path', async () => {
    const { footprint, resizeAxes, shift } = await import('../src/editor/model');
    const g = { type: 'gadget' as const, id: 'g', x: 2.25, y: 3.5, w: 1.5, h: 0.5, effect: { kind: 'bounce' as const, height: 4 }, path: [{ x: 2, y: 3 }, { x: 6, y: 3 }] };
    expect(footprint(g)).toEqual({ x: 2, y: 3, w: 2, h: 1 });
    expect(resizeAxes(g)).toEqual({ w: 'w', h: 'h' });
    shift(g, 1, 1);
    expect(g.path).toEqual([{ x: 3, y: 4 }, { x: 7, y: 4 }]);
  });

  it('a level using every new feature validates and survives a share code', async () => {
    const { encodeLevel, decodeLevel } = await import('../src/editor/share');
    const { GADGETS } = await import('../src/editor/tools');
    const d = new EditorDoc(blankLevel(200, 60, 'zone'));
    d.edit((l) => {
      GADGETS.forEach((it, i) => l.objects.push(it.make!(`gd${i}`, 4 + i * 3, 50)));
      l.vars = [{ name: 'coins', value: 0, show: 'Coins' }, { name: 'keys', value: 0 }];
      l.abilities = { airJumps: 2 };
      l.events.push({ trigger: { type: 'becomes', cond: { type: 'var', name: 'coins', op: '>=', value: 3 } }, actions: [{ type: 'message', text: 'Rich!', seconds: 2 }, { type: 'signal', name: 'go' }] });
    });
    expect(d.validate()).toEqual([]);
    const back = decodeLevel(encodeLevel(d.level));
    expect(back?.objects.filter((o) => o.type === 'gadget')).toHaveLength(GADGETS.length);
    expect(back?.width).toBe(200);
  });
});

describe('room resize', () => {
  it('moves the right and bottom walls with the edge instead of leaving a box inside', () => {
    const d = new EditorDoc(blankLevel(10, 6));
    d.resize(16, 9);
    const t = d.level.tiles;
    expect(t[5]![4]).toBe('.'); // old floor row is now open air
    expect(t[3]![9]).toBe('.'); // old right wall is gone
    expect(t[8]!).toBe('#'.repeat(16));
    expect(t.every((r) => r[0] === '#' && r[15] === '#')).toBe(true);
    d.resize(8, 5);
    expect(d.level.tiles[4]).toBe('#'.repeat(8));
    expect(d.level.tiles.every((r) => r[7] === '#')).toBe(true);
  });
});
