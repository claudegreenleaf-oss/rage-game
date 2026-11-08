// Editor building blocks: the document model, image pixelation, and composer songs.
import { describe, expect, it } from 'vitest';
import { EditorDoc, LIMITS, blankLevel, flipClip } from '../src/editor/model';
import { TRANSPARENT, artToRgba, decodeIndices, encodeIndices, makeArt, medianCut, quantize } from '../src/editor/pixelate';
import { TEMPLATES, emptySong, noteAt, normalizeSong, songKey, toggleNote } from '../src/editor/song';
import { validateLevel } from '../src/sim/level';
import { World } from '../src/sim/world';
import { DECOR_IDS, decorChar } from '../src/sim/types';

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

  it('resizes within the room-kind limits and keeps decor rows in shape', () => {
    const d = new EditorDoc(blankLevel(12, 8));
    d.setCell('fg', 1, 1, decorChar(16));
    d.resize(500, 500);
    expect(d.level.width).toBe(LIMITS.chamber.w);
    expect(d.level.height).toBe(LIMITS.chamber.h);
    d.setKind('zone');
    d.resize(120, 40);
    expect([d.level.width, d.level.height]).toEqual([120, 40]);
    expect(d.level.decor!.fg!.every((r) => r.length === 120)).toBe(true);
    expect(d.level.decor!.fg![1]![1]).toBe(decorChar(16));
    expect(validateLevel(d.level).ok).toBe(true);
    d.setKind('chamber');
    expect(d.level.width).toBeLessThanOrEqual(LIMITS.chamber.w);
    expect(validateLevel(d.level).ok).toBe(true);
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
