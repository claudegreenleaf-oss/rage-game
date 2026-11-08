// Music composer helpers: SongData templates, note editing, serialization, and a small built-in
// preview synth so the composer works even before the game's audio engine offers custom songs.
import type { SongData } from '../sim/types';

export type Instrument = SongData['tracks'][number]['instrument'];
export const INSTRUMENTS: Array<{ id: Instrument; label: string; color: string; low: number; high: number }> = [
  { id: 'lead', label: 'Soft lead', color: '#f2b544', low: 60, high: 84 },
  { id: 'bell', label: 'Bell', color: '#7fd0d0', low: 64, high: 88 },
  { id: 'pulse', label: 'Pulse', color: '#e0869a', low: 55, high: 79 },
  { id: 'pad', label: 'Pad', color: '#9a8ce0', low: 48, high: 72 },
  { id: 'bass', label: 'Bass', color: '#8cc455', low: 31, high: 55 },
  { id: 'drums', label: 'Drums', color: '#c4ccd8', low: 0, high: 3 },
];
export const DRUM_NAMES = ['Kick', 'Snare', 'Hat', 'Clap'];
export const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
export const noteName = (m: number) => `${NOTE_NAMES[m % 12]}${Math.floor(m / 12) - 1}`;
export const isBlack = (m: number) => [1, 3, 6, 8, 10].includes(m % 12);

export function emptySong(bpm = 90, steps = 32): SongData {
  return { name: 'My theme', bpm, steps, tracks: INSTRUMENTS.map((i) => ({ instrument: i.id, volume: i.id === 'drums' ? 0.5 : 0.7, notes: [] })) };
}

/** Clamp and tidy a song (for loading from files/share codes). */
export function normalizeSong(s: SongData): SongData {
  const steps = Math.max(4, Math.min(256, Math.round(s.steps || 32)));
  const byInst = new Map(s.tracks?.map((t) => [t.instrument, t]) ?? []);
  return {
    name: s.name ?? 'My theme',
    bpm: Math.max(30, Math.min(240, Math.round(s.bpm || 90))),
    steps,
    tracks: INSTRUMENTS.map((i) => {
      const t = byInst.get(i.id);
      return {
        instrument: i.id,
        volume: Math.max(0, Math.min(1, t?.volume ?? 0.7)),
        notes: (t?.notes ?? []).filter((n) => n[0] >= 0 && n[0] < steps).map(([st, p, l]) => [Math.round(st), Math.round(p), Math.max(1, Math.round(l))] as [number, number, number]),
      };
    }),
  };
}

export function noteAt(s: SongData, track: number, step: number, pitch: number): number {
  return s.tracks[track]!.notes.findIndex((n) => n[1] === pitch && step >= n[0] && step < n[0] + n[2]);
}

/** Toggle a note: remove one covering this cell, or add one of `len` steps. */
export function toggleNote(s: SongData, track: number, step: number, pitch: number, len = 1): void {
  const t = s.tracks[track]!;
  const i = noteAt(s, track, step, pitch);
  if (i >= 0) t.notes.splice(i, 1);
  else t.notes.push([step, pitch, Math.max(1, Math.min(len, s.steps - step))]);
  t.notes.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

export const noteCount = (s: SongData) => s.tracks.reduce((n, t) => n + t.notes.length, 0);

/** Stable short key for caching renders. */
export function songKey(s: SongData): string {
  const str = JSON.stringify(normalizeSong(s));
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16);
}

// --- templates -----------------------------------------------------------------

const T = (name: string): number => INSTRUMENTS.findIndex((i) => i.id === name);

/** A gentle Satie-like waltz: slow 3/4, bass on one, soft major-seventh chords on two, a sparse melody. */
function satieLike(): SongData {
  const s = emptySong(66, 96); // 8 bars of 3/4, 4 steps per beat
  s.name = 'Lente';
  const bar = 12;
  const bassNotes = [43, 38, 43, 38, 41, 36, 43, 38]; // G2 D2 alternating, F2/C2 colour
  const chords = [[59, 62, 66], [57, 61, 64], [59, 62, 66], [57, 61, 64], [57, 60, 64], [55, 59, 62], [59, 62, 66], [57, 61, 64]];
  const melody: Array<[number, number, number]> = [[1, 78, 4], [1, 81, 2], [2, 79, 2], [2, 78, 4], [3, 73, 6], [4, 71, 4], [4, 73, 2], [5, 74, 4], [6, 69, 8]];
  for (let b = 0; b < 8; b++) {
    s.tracks[T('bass')]!.notes.push([b * bar, bassNotes[b]!, 4]);
    for (const p of chords[b]!) s.tracks[T('pad')]!.notes.push([b * bar + 4, p, 8]);
  }
  for (const [b, p, l] of melody) s.tracks[T('bell')]!.notes.push([b * bar + (l === 2 ? 8 : 0), p, l]);
  s.tracks[T('pad')]!.volume = 0.45;
  s.tracks[T('bell')]!.volume = 0.6;
  return s;
}

function bouncy(): SongData {
  const s = emptySong(112, 32);
  s.name = 'Busy lab';
  const lead = [72, 76, 79, 76, 74, 77, 81, 77];
  for (let i = 0; i < 8; i++) s.tracks[T('lead')]!.notes.push([i * 4, lead[i]!, 2]);
  for (let i = 0; i < 8; i++) s.tracks[T('bass')]!.notes.push([i * 4, i % 4 < 2 ? 48 : 43, 2]);
  for (let i = 0; i < 32; i += 8) { s.tracks[T('drums')]!.notes.push([i, 0, 1], [i + 4, 1, 1]); }
  for (let i = 0; i < 32; i += 2) s.tracks[T('drums')]!.notes.push([i, 2, 1]);
  return s;
}

function spooky(): SongData {
  const s = emptySong(72, 32);
  s.name = 'Containment';
  const pad = [[57, 60, 64], [56, 60, 63]];
  for (let b = 0; b < 2; b++) for (const p of pad[b]!) s.tracks[T('pad')]!.notes.push([b * 16, p, 16]);
  const bell = [[0, 81], [6, 80], [10, 76], [16, 79], [22, 75], [26, 72]];
  for (const [st, p] of bell) s.tracks[T('bell')]!.notes.push([st!, p!, 3]);
  s.tracks[T('bass')]!.notes.push([0, 33, 8], [16, 32, 8]);
  return s;
}

export const TEMPLATES: Array<{ id: string; label: string; make: () => SongData }> = [
  { id: 'satie', label: 'Gentle waltz (Satie-like 3/4)', make: satieLike },
  { id: 'bouncy', label: 'Busy lab (bouncy)', make: bouncy },
  { id: 'spooky', label: 'Containment (eerie)', make: spooky },
  { id: 'empty', label: 'Empty', make: () => emptySong() },
];

// --- preview synth -------------------------------------------------------------

let ctx: AudioContext | null = null;
let stopFn: (() => void) | null = null;

const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/**
 * Play a song (looping) with a soft built-in synth. Returns a stop function and calls `onStep`
 * with the current step for the playhead.
 */
export function previewSong(song: SongData, onStep?: (step: number) => void): () => void {
  stopPreview();
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AC) return () => {};
  ctx ??= new AC();
  const c = ctx;
  void c.resume();
  const master = c.createGain();
  master.gain.value = 0.35;
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 3200;
  master.connect(lp).connect(c.destination);
  const s = normalizeSong(song);
  const stepDur = 60 / s.bpm / 4;
  const loopDur = s.steps * stepDur;
  const t0 = c.currentTime + 0.08;
  let scheduledUntil = 0;
  let loops = 0;
  const schedule = () => {
    const ahead = c.currentTime + 0.6;
    while (t0 + scheduledUntil < ahead) {
      const base = t0 + loops * loopDur;
      for (const tr of s.tracks) for (const [st, p, l] of tr.notes) voice(c, master, tr.instrument, p, base + st * stepDur, l * stepDur, tr.volume);
      loops++;
      scheduledUntil = loops * loopDur;
    }
    onStep?.(Math.floor(((c.currentTime - t0) % loopDur + loopDur) % loopDur / stepDur));
  };
  schedule();
  const iv = window.setInterval(schedule, 50);
  stopFn = () => { window.clearInterval(iv); master.gain.setTargetAtTime(0, c.currentTime, 0.05); setTimeout(() => master.disconnect(), 300); onStep?.(-1); };
  return stopPreview;
}

export function stopPreview(): void { stopFn?.(); stopFn = null; }

/** Preview one note (when clicking the piano roll). */
export function previewNote(inst: Instrument, pitch: number, vol = 0.7): void {
  const AC = window.AudioContext;
  if (!AC) return;
  ctx ??= new AC();
  void ctx.resume();
  const g = ctx.createGain();
  g.gain.value = 0.35;
  g.connect(ctx.destination);
  voice(ctx, g, inst, pitch, ctx.currentTime + 0.01, 0.25, vol);
  setTimeout(() => g.disconnect(), 1500);
}

function voice(c: AudioContext, out: AudioNode, inst: Instrument, pitch: number, at: number, dur: number, vol: number): void {
  const g = c.createGain();
  g.connect(out);
  if (inst === 'drums') {
    const len = pitch === 0 ? 0.25 : pitch === 2 ? 0.05 : 0.14;
    if (pitch === 0) {
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(120, at);
      o.frequency.exponentialRampToValueAtTime(40, at + len);
      g.gain.setValueAtTime(vol * 0.9, at);
      g.gain.exponentialRampToValueAtTime(0.001, at + len);
      o.connect(g); o.start(at); o.stop(at + len + 0.02);
      return;
    }
    const buf = c.createBuffer(1, Math.floor(c.sampleRate * len), c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = c.createBufferSource();
    src.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = pitch === 2 ? 'highpass' : 'bandpass';
    f.frequency.value = pitch === 2 ? 7000 : pitch === 3 ? 1500 : 1800;
    g.gain.setValueAtTime(vol * (pitch === 2 ? 0.25 : 0.5), at);
    src.connect(f).connect(g); src.start(at);
    return;
  }
  const o = c.createOscillator();
  o.type = inst === 'pulse' ? 'square' : inst === 'bass' || inst === 'lead' ? 'triangle' : 'sine';
  o.frequency.value = midiHz(pitch);
  const peak = vol * (inst === 'pulse' ? 0.12 : inst === 'pad' ? 0.18 : 0.3);
  const attack = inst === 'pad' ? 0.25 : 0.008;
  const release = inst === 'bell' ? 1.2 : inst === 'pad' ? 0.6 : 0.25;
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(peak, at + attack);
  if (inst === 'bell') g.gain.exponentialRampToValueAtTime(0.001, at + Math.max(dur, 0.2) + release);
  else { g.gain.setValueAtTime(peak, at + Math.max(attack, dur - 0.02)); g.gain.exponentialRampToValueAtTime(0.001, at + dur + release); }
  o.connect(g);
  o.start(at);
  o.stop(at + dur + release + 0.1);
}
