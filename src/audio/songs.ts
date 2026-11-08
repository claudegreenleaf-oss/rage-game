// The soundtrack: Erik Satie's Trois Gymnopédies (public domain), arranged for the game's soft
// chip/music-box palette. Melodies, harmonies and bass lines are the composer's, taken from
// src/audio/satie.ts (transcribed from the original score). Only voicing, tempo and light
// percussion are arranged. Each loop starts and ends at a phrase boundary.
import { barsToNotes, DRUMS, type Ev, type Song } from './synth';
import { GYMNOPEDIE_1, GYMNOPEDIE_2, GYMNOPEDIE_3, type Piece } from './satie';

const BAR = 3; // all three Gymnopédies are in 3/4

type Voice = 'mel' | 'chd' | 'bas';

/** Notes of one voice from bar `from` to bar `to` (1-based, inclusive), shifted to start at beat `at`. */
function section(p: Piece, v: Voice, from: number, to: number, at = 0): Ev[] {
  const flat = p[v], out: Ev[] = [];
  const s0 = (from - 1) * BAR, s1 = to * BAR;
  for (let i = 0; i < flat.length; i += 3) {
    const t = flat[i]!, d = flat[i + 1]!, n = flat[i + 2]!;
    if (t < s0 || t >= s1) continue;
    out.push([t - s0 + at, Math.min(d, s1 - t), n]);
  }
  return out;
}

/** Several sections joined end to end. */
function sections(p: Piece, v: Voice, ranges: Array<[number, number]>): Ev[] {
  let at = 0;
  const out: Ev[] = [];
  for (const [a, b] of ranges) { out.push(...section(p, v, a, b, at)); at += (b - a + 1) * BAR; }
  return out;
}
const beatsOf = (ranges: Array<[number, number]>): number => ranges.reduce((s, [a, b]) => s + (b - a + 1) * BAR, 0);

/** Satie's left hand holds each chord for beats 2–3; restrike it on both beats for a lilting waltz. */
const oomPahPah = (evs: Ev[]): Ev[] => evs.flatMap(([t, d, n]): Ev[] =>
  d >= 2 && t % 1 === 0 ? [[t, 1, n], [t + 1, Math.min(1, d - 1), n]] : [[t, d, n]]);

/** Long notes become a mallet roll (xylophones can't sustain). */
const roll = (evs: Ev[], every: number): Ev[] => evs.flatMap(([t, d, n]): Ev[] => {
  if (d <= 1.01) return [[t, d, n]];
  const out: Ev[] = [];
  for (let x = 0; x < d - 0.01; x += every) out.push([t + x, Math.min(every, d - x), n]);
  return out;
});

/** A drum pattern for one 3/4 bar, repeated: [beat within bar, drum letter]. Uppercase = accent. */
function drums(bars: number, pattern: Array<[number, string]>, accentEvery = 0): Ev[] {
  const out: Ev[] = [];
  for (let b = 0; b < bars; b++) for (const [beat, ch] of pattern) {
    const code = DRUMS[ch.toLowerCase() as keyof typeof DRUMS];
    const accent = ch !== ch.toLowerCase() || (accentEvery > 0 && b % accentEvery === 0 && beat === 0);
    out.push([b * BAR + beat, 0.25, code + (accent ? 100 : 0)]);
  }
  return out;
}

// 0 · Title & editor — Gymnopédie No. 1, bars 1–39 (the first time through). Lent et douloureux.
const T_RANGE: Array<[number, number]> = [[1, 39]];
const TITLE: Song = {
  name: 'Gymnopédie No. 1', bpm: 72, beats: beatsOf(T_RANGE),
  tracks: [
    { inst: 'tri', vol: 0.42, pan: -0.1, notes: sections(GYMNOPEDIE_1, 'mel', T_RANGE), vib: [0.12, 4.5, 0.35], env: [0.03, 0.3, 0.75, 0.25], echo: [1.5, 0.2, 0.4] },
    { inst: 'bell', vol: 0.14, pan: 0.35, notes: sections(GYMNOPEDIE_1, 'chd', T_RANGE) },
    { inst: 'pulse12', vol: 0.035, pan: -0.4, notes: sections(GYMNOPEDIE_1, 'chd', T_RANGE), env: [0.15, 0.3, 0.6, 0.4] },
    { inst: 'tri', vol: 0.36, notes: sections(GYMNOPEDIE_1, 'bas', T_RANGE), env: [0.01, 0.5, 0.6, 0.3] },
  ],
};

// 1 · Act 1 "Fresh Meat" — Gymnopédie No. 2, bars 1–27 (opening, theme, the C-major episode, and the
// return of the opening chords). Pushed from Lent et triste to a lilting 104 with waltz-style restrikes.
const A1_RANGE: Array<[number, number]> = [[1, 27]];
const A1_BEATS = beatsOf(A1_RANGE);
const ACT1: Song = {
  name: 'Gymnopédie No. 2', bpm: 104, beats: A1_BEATS,
  tracks: [
    { inst: 'pulse25', vol: 0.3, pan: -0.12, notes: sections(GYMNOPEDIE_2, 'mel', A1_RANGE), gate: 0.7, vib: [0.1, 6, 0.15], echo: [0.75, 0.18, 0.35] },
    { inst: 'pluck', vol: 0.15, pan: 0.35, notes: oomPahPah(sections(GYMNOPEDIE_2, 'chd', A1_RANGE)), gate: 0.45 },
    { inst: 'tri', vol: 0.4, notes: sections(GYMNOPEDIE_2, 'bas', A1_RANGE), gate: 0.45, env: [0.004, 0.08, 0.7, 0.06] },
    { inst: 'drums', vol: 0.32, notes: drums(A1_BEATS / BAR, [[0, 'k'], [1, 'x'], [2, 'x']], 4) },
    { inst: 'drums', vol: 0.16, pan: 0.3, notes: drums(A1_BEATS / BAR, [[1.5, 'r'], [2.5, 'x']]) },
  ],
};

// 2 · Act 2 "Rot" — Gymnopédie No. 3, bars 1–28 (to the return of the opening chords). Lent et grave:
// a wobbly, murky lead over a bass dropped an octave, with only a faint heartbeat.
const A2_RANGE: Array<[number, number]> = [[1, 28]];
const A2_BEATS = beatsOf(A2_RANGE);
const ACT2: Song = {
  name: 'Gymnopédie No. 3', bpm: 80, beats: A2_BEATS,
  tracks: [
    { inst: 'pulse50', vol: 0.25, pan: -0.15, notes: sections(GYMNOPEDIE_3, 'mel', A2_RANGE), env: [0.04, 0.2, 0.65, 0.25], vib: [0.3, 4, 0.2], echo: [1, 0.28, 0.5] },
    { inst: 'pulse12', vol: 0.075, pan: 0.4, notes: sections(GYMNOPEDIE_3, 'chd', A2_RANGE), env: [0.12, 0.3, 0.55, 0.3] },
    { inst: 'bell', vol: 0.07, pan: 0.2, notes: sections(GYMNOPEDIE_3, 'chd', A2_RANGE), transpose: -12 },
    { inst: 'tri', vol: 0.5, notes: sections(GYMNOPEDIE_3, 'bas', A2_RANGE), transpose: -12, vib: [0.06, 5, 0], env: [0.02, 0.4, 0.7, 0.3] },
    { inst: 'drums', vol: 0.22, notes: drums(A2_BEATS / BAR, [[0, 'k']]) },
  ],
};

// 3 · Act 3 "Bare Bones" — Gymnopédie No. 1, bars 17–39 (the middle section). Xylophone with mallet
// rolls on the long notes, plucked "bone" bass, woodblock and bone-click percussion.
const A3_RANGE: Array<[number, number]> = [[17, 39]];
const A3_BEATS = beatsOf(A3_RANGE);
const ACT3: Song = {
  name: 'Gymnopédie No. 1 (middle section)', bpm: 120, beats: A3_BEATS,
  tracks: [
    { inst: 'xylo', vol: 0.45, pan: -0.1, notes: roll(sections(GYMNOPEDIE_1, 'mel', A3_RANGE), 0.5), echo: [0.75, 0.15, 0.3] },
    { inst: 'xylo', vol: 0.14, pan: 0.4, notes: oomPahPah(sections(GYMNOPEDIE_1, 'chd', A3_RANGE)) },
    { inst: 'pluck', vol: 0.4, notes: sections(GYMNOPEDIE_1, 'bas', A3_RANGE), gate: 0.4 },
    { inst: 'drums', vol: 0.4, pan: 0.3, notes: drums(A3_BEATS / BAR, [[0, 'w'], [1, 'b'], [2, 'b'], [2.5, 'b']], 4) },
    { inst: 'drums', vol: 0.14, pan: -0.3, notes: drums(A3_BEATS / BAR, [[0.5, 'x'], [1.5, 'x'], [2.5, 'x']]) },
  ],
};

// 4 · Credits & End — Gymnopédie No. 1 complete as written for the last time through: bars 1–31 and
// the closing bars 40–47. Music box over a soft pad.
const CR_RANGE: Array<[number, number]> = [[1, 31], [40, 47]];
const CREDITS: Song = {
  name: 'Gymnopédie No. 1 (reprise)', bpm: 66, beats: beatsOf(CR_RANGE),
  tracks: [
    { inst: 'bell', vol: 0.4, pan: -0.1, notes: sections(GYMNOPEDIE_1, 'mel', CR_RANGE), echo: [1.5, 0.22, 0.4] },
    { inst: 'tri', vol: 0.14, pan: 0.1, notes: sections(GYMNOPEDIE_1, 'mel', CR_RANGE), transpose: -12, env: [0.05, 0.3, 0.7, 0.3] },
    { inst: 'pulse12', vol: 0.06, pan: 0.4, notes: sections(GYMNOPEDIE_1, 'chd', CR_RANGE), env: [0.2, 0.3, 0.6, 0.5] },
    { inst: 'tri', vol: 0.36, notes: sections(GYMNOPEDIE_1, 'bas', CR_RANGE), env: [0.01, 0.5, 0.6, 0.3] },
  ],
};

// Win fanfare: a short original one-shot (one bar of music, two bars of silence for the tail).
const rest = '. . . . . . . . . . . . . . . .';
export const FANFARE: Song = {
  name: 'Fanfare', bpm: 150, beats: 12,
  tracks: [
    { inst: 'pulse25', vol: 0.34, pan: -0.15, notes: barsToNotes(['C5 . E5 . G5 . C6 - - . G5 . C6 - - -', 'E6 - - - - - - - . . . . . . . .', rest]), vib: [0.2, 6, 0.1] },
    { inst: 'pulse12', vol: 0.18, pan: 0.3, notes: barsToNotes(['E4 . G4 . C5 . E5 - - . E5 . G5 - - -', 'G5 - - - - - - - . . . . . . . .', rest]) },
    { inst: 'tri', vol: 0.45, notes: barsToNotes(['C3 . . . G3 . . . C4 - - . G3 . C3 -', 'C3 - - - - - - - . . . . . . . .', rest]) },
    { inst: 'drums', vol: 0.5, notes: barsToNotes(['k . . . s . . . k . s . s S s S', 'K o . . . . . . . . . . . . . .', rest], true) },
  ],
};

export const SONGS: Record<number, Song> = { 0: TITLE, 1: ACT1, 2: ACT2, 3: ACT3, 4: CREDITS };
