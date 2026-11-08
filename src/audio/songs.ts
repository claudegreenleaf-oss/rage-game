// The soundtrack: Erik Satie, played on a synthesized soft felt piano at the composer's own tempi,
// whole pieces, looping at their real endings. Plus a short win fanfare and level-editor songs.
import type { SongData } from '../sim/types';
import { barsToNotes, DRUMS, type Song } from './synth';
import { GYMNOPEDIE_1, GYMNOPEDIE_2, GYMNOPEDIE_3, OGIVE_1, OGIVE_2, OGIVE_3, OGIVE_4, type Piece } from './satie';
import type { PianoNote, PianoOpts } from './piano';

export interface PianoSong { name: string; piece: Piece; bpm: number; opts: PianoOpts }

/**
 * Music slots. 0 title & editor, 1–3 the three acts, 4 credits & end, 5+ zone themes.
 * Gymnopédies: Lent et douloureux / triste / grave, at slow tempi in 3/4.
 * The Ogives keep the tempo changes written into their transcriptions.
 */
export const SLOTS: Record<number, PianoSong> = {
  0: { name: 'Gymnopédie No. 1', piece: GYMNOPEDIE_1, bpm: 70, opts: { brightness: 0.35, wet: 0.24, rt60: 2.3 } },
  1: { name: 'Gymnopédie No. 2', piece: GYMNOPEDIE_2, bpm: 66, opts: { brightness: 0.4, wet: 0.22, rt60: 2.1 } },
  2: { name: 'Gymnopédie No. 3', piece: GYMNOPEDIE_3, bpm: 62, opts: { brightness: 0.28, wet: 0.26, rt60: 2.5 } },
  3: { name: 'Ogive No. 1', piece: OGIVE_1, bpm: 60, opts: { brightness: 0.3, wet: 0.3, rt60: 3.0, pedal: 0.25 } },
  4: { name: 'Gymnopédie No. 1 (reprise)', piece: GYMNOPEDIE_1, bpm: 64, opts: { brightness: 0.25, wet: 0.3, rt60: 2.8, pedal: 0.5 } },
  5: { name: 'Ogive No. 2', piece: OGIVE_2, bpm: 60, opts: { brightness: 0.3, wet: 0.3, rt60: 3.0, pedal: 0.25 } },
  6: { name: 'Ogive No. 3', piece: OGIVE_3, bpm: 60, opts: { brightness: 0.28, wet: 0.3, rt60: 3.0, pedal: 0.25 } },
  7: { name: 'Ogive No. 4', piece: OGIVE_4, bpm: 60, opts: { brightness: 0.3, wet: 0.3, rt60: 3.0, pedal: 0.25 } },
};

/** Notes of a piece in seconds at the slot's tempo. */
export function pianoNotes(s: PianoSong): { notes: PianoNote[]; seconds: number } {
  const k = 60 / s.bpm, f = s.piece.notes, notes: PianoNote[] = [];
  for (let i = 0; i < f.length; i += 4) notes.push({ t: f[i]! * k, d: f[i + 1]! * k, midi: f[i + 2]!, vel: f[i + 3]! / 127, seed: i / 4 });
  return { notes, seconds: s.piece.beats * k };
}

// Win fanfare: a short, soft original one-shot (bell and felt tones, two bars of tail).
const rest = '. . . . . . . . . . . . . . . .';
export const FANFARE: Song = {
  name: 'Fanfare', bpm: 132, beats: 12,
  tracks: [
    { inst: 'bell', vol: 0.4, pan: -0.15, notes: barsToNotes(['C5 . E5 . G5 . C6 - - . G5 . C6 - - -', 'E6 - - - - - - - . . . . . . . .', rest]) },
    { inst: 'tri', vol: 0.18, pan: 0.3, lp: 2500, notes: barsToNotes(['E4 . G4 . C5 . E5 - - . E5 . G5 - - -', 'G5 - - - - - - - . . . . . . . .', rest]) },
    { inst: 'sine', vol: 0.4, notes: barsToNotes(['C3 . . . G3 . . . C4 - - . G3 . C3 -', 'C3 - - - - - - - . . . . . . . .', rest]) },
  ],
};

/** A level-editor song (see SongData) as a soft synth song. Drums: 0 kick, 1 snare, 2 hat, 3 clap. */
export function customToSong(s: SongData): Song {
  const drum = [DRUMS.k, DRUMS.s, DRUMS.x, DRUMS.c];
  return {
    name: s.name ?? 'Custom',
    bpm: Math.max(30, Math.min(240, s.bpm || 100)),
    beats: Math.max(1, s.steps) / 4,
    tracks: s.tracks.map((t, i) => {
      const vol = Math.max(0, Math.min(1, t.volume ?? 0.7));
      const pan = (i % 2 ? 1 : -1) * 0.2;
      const notes = t.notes.map(([step, pitch, len]) => [step / 4, Math.max(1, len) / 4, t.instrument === 'drums' ? (drum[pitch] ?? DRUMS.x) : pitch] as [number, number, number]);
      switch (t.instrument) {
        case 'lead': return { inst: 'tri' as const, vol: 0.34 * vol, pan, notes, lp: 3200, vib: [0.12, 5, 0.25] as [number, number, number], env: [0.015, 0.2, 0.7, 0.18] as [number, number, number, number] };
        case 'pulse': return { inst: 'pulse25' as const, vol: 0.2 * vol, pan, notes, lp: 1900, env: [0.01, 0.15, 0.6, 0.15] as [number, number, number, number] };
        case 'bell': return { inst: 'bell' as const, vol: 0.3 * vol, pan, notes, lp: 4500 };
        case 'pad': return { inst: 'pad' as const, vol: 0.2 * vol, pan: -pan, notes, lp: 2200 };
        case 'bass': return { inst: 'sine' as const, vol: 0.45 * vol, notes, lp: 900, env: [0.01, 0.2, 0.75, 0.12] as [number, number, number, number] };
        default: return { inst: 'drums' as const, vol: 0.35 * vol, notes, lp: 3000 };
      }
    }),
  };
}

/** Stable key for caching rendered songs. */
export function songKey(s: SongData): string {
  const json = JSON.stringify(s);
  let h = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) { h ^= json.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `custom:${h.toString(16)}:${json.length}`;
}
