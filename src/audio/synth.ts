// A small chiptune tracker/synth, pure TypeScript (no DOM): band-limited pulses, triangle, xylophone and
// bell voices, synthesized drums, ping-pong echo. Renders a song to a seamless stereo loop.
// Runs inside a Web Worker in the browser and in Node for offline checks.

export type Inst = 'pulse12' | 'pulse25' | 'pulse50' | 'tri' | 'xylo' | 'bell' | 'pluck' | 'pad' | 'sine' | 'drums';

/** A note: start beat, length in beats, MIDI pitch. For drum tracks the "pitch" is a drum code (see DRUMS). */
export type Ev = [start: number, len: number, pitch: number];

export interface Track {
  inst: Inst;
  notes: Ev[];
  vol: number;
  /** -1 left … 1 right. */
  pan?: number;
  /** Semitones of vibrato, its rate (Hz) and onset delay (s). */
  vib?: [depth: number, rate: number, delay: number];
  /** Ping-pong echo: delay in beats, wet level, feedback. */
  echo?: [beats: number, wet: number, fb: number];
  /** Envelope override: attack, decay, sustain level, release (seconds). */
  env?: [number, number, number, number];
  /** Fraction of each note's written length that sounds (staccato < 1). */
  gate?: number;
  /** Semitone transposition. */
  transpose?: number;
  /** One-pole low-pass cutoff (Hz) on the whole track, for a soft, rounded tone. */
  lp?: number;
}

export interface Song {
  name: string;
  bpm: number;
  /** Loop length in beats. */
  beats: number;
  tracks: Track[];
}

/** Drum codes for drum tracks (accented hits use code + 100). */
export const DRUMS = { k: 1, s: 2, c: 3, h: 4, o: 5, x: 6, b: 7, w: 8, r: 9 } as const;
const DRUM_KEY = Object.fromEntries(Object.entries(DRUMS).map(([k, v]) => [v, k])) as Record<number, string>;

/**
 * Tracker-style bars for 4/4 snippets: 16 tokens per bar, a note (C5, F#4, Bb3), `-` hold, `.` rest.
 * Drum bars use the letters of DRUMS, uppercase for an accent.
 */
export function barsToNotes(bars: string[], drums = false): Ev[] {
  const out: Ev[] = [];
  let cur: Ev | null = null;
  bars.forEach((bar, bi) => {
    const toks = bar.trim().split(/\s+/);
    if (toks.length !== 16) throw new Error(`bar ${bi} has ${toks.length} tokens: "${bar}"`);
    toks.forEach((tok, si) => {
      const beat = (bi * 16 + si) / 4;
      if (tok === '-') { if (cur) cur[1] += 0.25; return; }
      cur = null;
      if (tok === '.') return;
      if (drums) { for (const ch of tok) out.push([beat, 0.25, DRUMS[ch.toLowerCase() as keyof typeof DRUMS] + (ch === ch.toUpperCase() ? 100 : 0)]); return; }
      cur = [beat, 0.25, midiOf(tok)];
      out.push(cur);
    });
  });
  return out;
}

export interface Rendered { left: Float32Array; right: Float32Array; length: number; peak: number; rms: number }

const NOTE_INDEX: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** "F#4" -> MIDI number (C4 = 60). */
export function midiOf(name: string): number {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  if (!m) throw new Error(`bad note ${name}`);
  return 12 * (Number(m[3]) + 1) + NOTE_INDEX[m[1]!]! + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}
export const hz = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12);

// ---------------------------------------------------------------------------
// Oscillators
// ---------------------------------------------------------------------------

function polyblep(t: number, dt: number): number {
  if (t < dt) { const x = t / dt; return x + x - x * x - 1; }
  if (t > 1 - dt) { const x = (t - 1) / dt; return x * x + x + x + 1; }
  return 0;
}

function pulse(t: number, dt: number, duty: number): number {
  let v = t < duty ? 1 : -1;
  v += polyblep(t, dt);
  v -= polyblep((t - duty + 1) % 1, dt);
  return v - (2 * duty - 1);
}

const tri = (t: number): number => 4 * Math.abs(t - 0.5) - 1;

/** Deterministic noise (so renders are repeatable). */
function makeNoise(n: number, seed: number): Float32Array {
  const out = new Float32Array(n);
  let s = seed >>> 0;
  for (let i = 0; i < n; i++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; out[i] = s / 2147483648 - 1; }
  return out;
}

// ---------------------------------------------------------------------------
// Drum one-shots
// ---------------------------------------------------------------------------

type DrumKit = Record<string, Float32Array>;

function makeKit(sr: number): DrumKit {
  const len = (s: number) => Math.floor(s * sr);
  const noise = makeNoise(len(0.6), 1234);
  const kit: DrumKit = {};

  // Kick: sine with a fast pitch drop and a click.
  { const n = len(0.32), b = new Float32Array(n); let ph = 0;
    for (let i = 0; i < n; i++) { const t = i / sr; const f = 48 + 110 * Math.exp(-t * 32); ph += f / sr; const env = Math.exp(-t * 11); b[i] = Math.sin(2 * Math.PI * ph) * env + (i < len(0.004) ? noise[i]! * 0.4 * (1 - i / len(0.004)) : 0); }
    kit.k = b; }
  // Snare: tone + bright noise.
  { const n = len(0.22), b = new Float32Array(n); let ph = 0, prev = 0;
    for (let i = 0; i < n; i++) { const t = i / sr; ph += (190 - 40 * t) / sr; const nz = noise[i]! - prev * 0.6; prev = noise[i]!;
      b[i] = Math.sin(2 * Math.PI * ph) * Math.exp(-t * 28) * 0.55 + nz * Math.exp(-t * 18) * 0.6; }
    kit.s = b; }
  // Clap: three quick noise bursts then a tail.
  { const n = len(0.25), b = new Float32Array(n); let prev = 0;
    for (let i = 0; i < n; i++) { const t = i / sr; const nz = noise[(i * 3) % noise.length]! - prev; prev = noise[(i * 3) % noise.length]!;
      const burst = t < 0.03 ? (Math.floor(t / 0.01) % 2 === 0 ? 1 : 0.3) : 1; b[i] = nz * burst * Math.exp(-Math.max(0, t - 0.02) * 22) * 0.55; }
    kit.c = b; }
  // Hats: high-passed noise.
  const hat = (dur: number, decay: number, gain: number) => { const n = len(dur), b = new Float32Array(n); let p1 = 0, p2 = 0;
    for (let i = 0; i < n; i++) { const x = noise[(i * 7 + 99) % noise.length]!; const hp = x - 2 * p1 + p2; p2 = p1; p1 = x; b[i] = hp * Math.exp(-(i / sr) * decay) * gain; }
    return b; };
  kit.h = hat(0.05, 70, 0.25);
  kit.o = hat(0.22, 14, 0.2);
  kit.x = hat(0.06, 45, 0.14);
  // Bone click (high) and woodblock (low): pitched, very short, hollow.
  const click = (f: number, dur: number, gain: number) => { const n = len(dur), b = new Float32Array(n);
    for (let i = 0; i < n; i++) { const t = i / sr; b[i] = (Math.sin(2 * Math.PI * f * t) * 0.7 + Math.sin(2 * Math.PI * f * 2.71 * t) * 0.3) * Math.exp(-t * 55) * gain + (i < 40 ? noise[i]! * 0.3 : 0); }
    return b; };
  kit.b = click(1650, 0.08, 0.6);
  kit.w = click(780, 0.1, 0.65);
  kit.r = click(2400, 0.04, 0.4);
  return kit;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const DEFAULT_ENV: Record<Exclude<Inst, 'drums'>, [number, number, number, number]> = {
  pulse12: [0.004, 0.08, 0.5, 0.05],
  pulse25: [0.006, 0.1, 0.62, 0.07],
  pulse50: [0.005, 0.12, 0.6, 0.06],
  tri: [0.004, 0.08, 0.8, 0.05],
  xylo: [0.001, 0.0, 1, 0.0],
  pad: [0.25, 0.3, 0.75, 0.6],
  sine: [0.01, 0.1, 0.8, 0.12],
  bell: [0.002, 0.0, 1, 0.0],
  pluck: [0.002, 0.0, 1, 0.0],
};

/**
 * Render a song as a seamless loop. A generator so callers can spread the work over time:
 * it yields between notes; the final value is the result.
 */
export function* renderSong(song: Song, sr: number): Generator<void, Rendered> {
  const beat = 60 / song.bpm;
  const total = Math.round(song.beats * beat * sr);
  const left = new Float32Array(total), right = new Float32Array(total);
  const kit = makeKit(sr);
  let work = 0;

  for (const track of song.tracks) {
    const pan = track.pan ?? 0;
    const gl = Math.cos(((pan + 1) * Math.PI) / 4), gr = Math.sin(((pan + 1) * Math.PI) / 4);
    const buf = new Float32Array(total); // mono dry signal, circular
    for (const [b0, len, pitch] of track.notes) {
      const start = Math.round(b0 * beat * sr);
      if (track.inst === 'drums') {
        const s = kit[DRUM_KEY[pitch % 100]!];
        if (!s) continue;
        const g = track.vol * (pitch >= 100 ? 1.35 : 1);
        for (let i = 0; i < s.length; i++) buf[(start + i) % total]! += s[i]! * g;
        continue;
      }
      const gate = len * beat * (track.gate ?? 1);
      const [a, d, sl, r] = track.env ?? DEFAULT_ENV[track.inst];
      const inst = track.inst;
      // Percussive voices ring on their own.
      const ring = inst === 'xylo' ? 0.55 : inst === 'bell' ? 1.1 : inst === 'pluck' ? 0.28 : 0;
      const n = Math.floor((ring ? Math.max(gate, ring) + 0.05 : gate + r) * sr);
      const f0 = hz(pitch + (track.transpose ?? 0));
      const [vd, vr, vdel] = track.vib ?? [0, 0, 0];
      let ph = 0, ph2 = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        const vib = vd && t > vdel ? Math.pow(2, (vd * Math.sin(2 * Math.PI * vr * (t - vdel)) * Math.min(1, (t - vdel) * 4)) / 12) : 1;
        const f = f0 * vib, dt = f / sr;
        ph = (ph + dt) % 1;
        let v: number, env: number;
        switch (inst) {
          case 'pulse12': v = pulse(ph, dt, 0.125); break;
          case 'pulse25': v = pulse(ph, dt, 0.25); break;
          case 'pulse50': v = pulse(ph, dt, 0.5) * 0.85; break;
          case 'tri': v = tri(ph); break;
          case 'sine': v = Math.sin(2 * Math.PI * ph); break;
          case 'pad': ph2 = (ph2 + (f * 1.004) / sr) % 1; v = (tri(ph) + tri(ph2) + Math.sin(2 * Math.PI * ph * 0.5)) * 0.4; break;
          case 'xylo': ph2 = (ph2 + (f * 3.93) / sr) % 1; v = Math.sin(2 * Math.PI * ph) + 0.45 * Math.sin(2 * Math.PI * ph2) * Math.exp(-t * 30); break;
          case 'bell': ph2 = (ph2 + (f * 2.01) / sr) % 1; v = Math.sin(2 * Math.PI * ph) * 0.8 + 0.35 * Math.sin(2 * Math.PI * ph2) * Math.exp(-t * 6); break;
          default: v = pulse(ph, dt, 0.3) * 0.8; break; // pluck
        }
        if (ring) {
          const decay = inst === 'xylo' ? 9 : inst === 'bell' ? 3.2 : 16;
          env = Math.min(1, t / Math.max(a, 0.0005)) * Math.exp(-t * decay);
          if (t > gate + 0.02 && inst === 'pluck') env *= Math.max(0, 1 - (t - gate - 0.02) / 0.03);
        } else if (t < a) env = t / a;
        else if (t < a + d) env = 1 - ((t - a) / d) * (1 - sl);
        else if (t < gate) env = sl;
        else env = sl * Math.max(0, 1 - (t - gate) / r);
        buf[(start + i) % total]! += v * env * track.vol;
      }
      if (++work % 24 === 0) yield;
    }
    if (track.lp) {
      const a = 1 - Math.exp((-2 * Math.PI * track.lp) / sr);
      let z = 0;
      for (let pass = 0; pass < 2; pass++) for (let i = 0; i < total; i++) { z += a * (buf[i]! - z); if (pass === 1) buf[i] = z; }
    }
    // Pan into the stereo mix, plus an optional circular ping-pong echo (stays seamless).
    for (let i = 0; i < total; i++) { left[i]! += buf[i]! * gl; right[i]! += buf[i]! * gr; }
    if (track.echo) {
      const [beats, wet, fb] = track.echo;
      const d = Math.round(beats * beat * sr);
      for (let tap = 1; tap <= 4; tap++) {
        const g = wet * Math.pow(fb, tap - 1);
        if (g < 0.02) break;
        const toLeft = tap % 2 === 0;
        const dl = d * tap;
        for (let i = 0; i < total; i++) {
          const v = buf[(i - dl + total * 8) % total]! * g;
          if (toLeft) left[i]! += v; else right[i]! += v;
        }
      }
    }
    yield;
  }

  // Gentle bus saturation, then normalise to -1 dBFS.
  let peak = 0;
  for (let i = 0; i < total; i++) { peak = Math.max(peak, Math.abs(left[i]!), Math.abs(right[i]!)); }
  const pre = peak > 0 ? 1.1 / peak : 1;
  peak = 0;
  let sum = 0;
  for (let i = 0; i < total; i++) {
    const l = Math.tanh(left[i]! * pre), r = Math.tanh(right[i]! * pre);
    left[i] = l; right[i] = r;
    peak = Math.max(peak, Math.abs(l), Math.abs(r));
  }
  const norm = 0.89 / peak;
  for (let i = 0; i < total; i++) { left[i]! *= norm; right[i]! *= norm; sum += left[i]! * left[i]! + right[i]! * right[i]!; }
  return { left, right, length: total, peak: 0.89, rms: Math.sqrt(sum / (2 * total)) };
}

/** Run a render generator to completion synchronously. */
export function renderNow(song: Song, sr: number): Rendered {
  const g = renderSong(song, sr);
  for (;;) { const r = g.next(); if (r.done) return r.value; }
}
