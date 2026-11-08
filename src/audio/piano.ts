// A soft felt-piano synthesizer and a small room reverb, pure TypeScript (no DOM), for pre-rendering
// the Satie loops. Additive partials with string inharmonicity, a felt-hammer thump, slightly detuned
// string pairs (gentle beating), pitch-dependent two-stage decay, dampers with sustain-pedal overlap.
// Everything is rendered circularly so the loop seam is sample-continuous, reverb tail included.

/** Seconds, seconds, MIDI, velocity 0–1, and a seed for the note's small natural variations. */
export interface PianoNote { t: number; d: number; midi: number; vel: number; seed?: number }

export interface PianoOpts {
  /** Extra time each note rings after release, as if the sustain pedal were held (s). */
  pedal?: number;
  /** 0 = very soft felt, 1 = brighter upright. */
  brightness?: number;
  /** Reverb wet level and RT60 (s). */
  wet?: number;
  rt60?: number;
}

const hz = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

/** Deterministic per-note "randomness" so renders are repeatable. */
const hash = (a: number, b: number): number => { let h = Math.imul(a * 73856093 ^ b * 19349663, 2654435761) >>> 0; h ^= h >>> 13; return (h % 10000) / 10000; };

/** Render notes into a circular stereo buffer of `total` samples. Yields between notes. */
export function* renderPiano(notes: PianoNote[], sr: number, total: number, opts: PianoOpts = {}): Generator<void, { left: Float32Array; right: Float32Array }> {
  const left = new Float32Array(total), right = new Float32Array(total);
  const pedal = opts.pedal ?? 0.35;
  const bright = opts.brightness ?? 0.35;
  let work = 0;
  for (let ni = 0; ni < notes.length; ni++) {
    const { t, d, midi, vel } = notes[ni]!;
    const sd = notes[ni]!.seed ?? ni;
    const f0 = hz(midi);
    const start = Math.round(t * sr);
    const pan = Math.max(-0.55, Math.min(0.55, (midi - 62) / 40));
    const gl = Math.cos(((pan + 1) * Math.PI) / 4), gr = Math.sin(((pan + 1) * Math.PI) / 4);
    // Decay: low notes ring long, high notes short. Two stages (prompt sound, then aftersound).
    const T = Math.max(0.7, Math.min(16, 13 * Math.pow(2, -(midi - 33) / 15)));
    const B = 0.00012 * Math.pow(2, (midi - 40) / 18); // inharmonicity
    const K = Math.max(2, Math.min(12, Math.floor(5200 / f0)));
    const soft = 0.55 + 0.45 * vel;
    const release = d + pedal;
    const damped = midi < 89; // the top of the keyboard has no dampers
    const rel = damped ? 0.13 : 1e9;
    // Length to render: until the release has died away (or the natural decay, whichever first).
    const ring = Math.min(damped ? release + rel * 7 : T * 1.2, T * 1.6);
    const n = Math.min(Math.floor(ring * sr), total);
    const amp = 0.22 * vel * (0.8 + 0.4 * hash(sd, midi));
    // Partials.
    for (let k = 1; k <= K; k++) {
      const fk = k * f0 * Math.sqrt(1 + B * k * k);
      if (fk > sr * 0.45) break;
      const ak = amp * Math.pow(k, -1.35) * Math.exp(-(k - 1) * (0.42 - 0.18 * bright - 0.12 * soft)) * (k === 1 ? 1 : 0.9);
      const tauA = (T / (1 + 0.55 * (k - 1))) * 0.22, tauB = T / (1 + 0.35 * (k - 1));
      const strings = k <= 5 ? 2 : 1;
      for (let s = 0; s < strings; s++) {
        const det = strings === 2 ? (s === 0 ? -1 : 1) * (0.4 + 0.5 * hash(sd + 7, k)) * 0.0006 : 0;
        const w = 2 * Math.PI * fk * (1 + det) / sr;
        const c = Math.cos(w), sn = Math.sin(w);
        let x = 0, y = 1; // rotating phasor, output x
        const phase = hash(sd * 3 + s, k) * Math.PI * 2;
        x = Math.sin(phase); y = Math.cos(phase);
        const rA = Math.exp(-1 / (tauA * sr)), rB = Math.exp(-1 / (tauB * sr)), rR = Math.exp(-1 / (rel * sr));
        let eA = 0.55, eB = 0.45, damp = 1;
        const relAt = Math.floor(release * sr);
        const att = Math.max(1, Math.floor(sr * (0.0035 + 0.003 * (1 - vel))));
        const g = ak / strings, ggl = g * gl, ggr = g * gr;
        let j = start % total;
        for (let i = 0; i < n; i++) {
          const nx = c * x - sn * y; y = sn * x + c * y; x = nx;
          eA *= rA; eB *= rB;
          if (i >= relAt) damp *= rR;
          const v = x * (eA + eB) * damp * (i < att ? i / att : 1);
          left[j]! += v * ggl; right[j]! += v * ggr;
          if (++j === total) j = 0;
          if ((i & 4095) === 0 && (eA + eB) * damp < 2e-5) break;
        }
      }
    }
    // Felt hammer: a soft, low-passed thump.
    {
      const hn = Math.floor(0.012 * sr);
      let lp = 0, seed = (sd * 2654435761) >>> 0;
      const cut = Math.min(0.5, (900 + 1400 * vel + f0) / sr * 2 * Math.PI);
      for (let i = 0; i < hn; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        lp += cut * ((seed / 2147483648 - 1) - lp);
        const v = lp * amp * 0.5 * Math.exp(-i / (0.003 * sr));
        const j = (start + i) % total;
        left[j]! += v * gl; right[j]! += v * gr;
      }
    }
    if (++work % 6 === 0) yield;
  }
  // Gentle overall low-pass (felt), circular: run twice so the filter state wraps.
  for (const ch of [left, right]) {
    const a = 1 - Math.exp(-2 * Math.PI * 6500 / sr);
    let z = 0;
    for (let pass = 0; pass < 2; pass++) for (let i = 0; i < total; i++) { z += a * (ch[i]! - z); if (pass === 1) ch[i] = z; }
  }
  return { left, right };
}

/**
 * Feedback-delay-network room reverb (8 lines, Householder mixing, damped), applied circularly:
 * the network runs over the loop twice and the second pass is kept, so the tail wraps into the start.
 */
export function* reverb(left: Float32Array, right: Float32Array, sr: number, wet = 0.22, rt60 = 2.1): Generator<void, void> {
  const total = left.length;
  const ms = [29.7, 37.1, 41.1, 43.7, 47.3, 53.1, 59.3, 67.1];
  const N = ms.length;
  const len = ms.map((m) => Math.round((m / 1000) * sr));
  const gain = len.map((L) => Math.pow(10, (-3 * L) / (rt60 * sr)));
  const bufs = len.map((L) => new Float32Array(L));
  const idx = new Array<number>(N).fill(0);
  const lp = new Array<number>(N).fill(0);
  const damp = 1 - Math.exp(-2 * Math.PI * 4200 / sr);
  const pre = Math.round(0.018 * sr);
  const outL = new Float32Array(total), outR = new Float32Array(total);
  const vals = new Array<number>(N).fill(0);
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < total; i++) {
      const ii = (i - pre + total) % total;
      const input = (left[ii]! + right[ii]!) * 0.5;
      let sum = 0;
      for (let k = 0; k < N; k++) {
        const v = bufs[k]![idx[k]!]!;
        lp[k]! += damp * (v - lp[k]!);
        vals[k] = lp[k]!;
        sum += vals[k]!;
      }
      const h = (2 / N) * sum;
      let l = 0, r = 0;
      for (let k = 0; k < N; k++) {
        const fb = (vals[k]! - h) * gain[k]!;
        bufs[k]![idx[k]!] = fb + input * (k % 2 ? 0.35 : -0.35);
        idx[k] = (idx[k]! + 1) % len[k]!;
        if (k % 2) r += vals[k]!; else l += vals[k]!;
      }
      if (pass === 1) { outL[i] = l; outR[i] = r; }
      if ((i & 65535) === 0) yield;
    }
  }
  for (let i = 0; i < total; i++) { left[i] = left[i]! * (1 - wet * 0.4) + outL[i]! * wet; right[i] = right[i]! * (1 - wet * 0.4) + outR[i]! * wet; }
}
