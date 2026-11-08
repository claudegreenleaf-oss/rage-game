// A tiny tracker: note patterns rendered with ZzFX into one looping buffer per act. Quiet under the SFX.
import { audio } from './sfx';

type Inst = 'lead' | 'bass' | 'bell' | 'hat' | 'kick';
type Note = [step: number, midi: number, len: number, inst: Inst];

interface Song { bpm: number; steps: number; notes: Note[] }

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

function seq(start: number, every: number, notes: number[], len: number, inst: Inst): Note[] {
  return notes.map((n, i) => [start + i * every, n, len, inst] as Note).filter((n) => n[1] > 0);
}

const drums = (steps: number): Note[] => {
  const out: Note[] = [];
  for (let s = 0; s < steps; s += 4) out.push([s, 36, 1, s % 8 === 0 ? 'kick' : 'hat']);
  for (let s = 2; s < steps; s += 4) out.push([s, 80, 1, 'hat']);
  return out;
};

// 4 bars of 16 steps each.
const SONGS: Record<number, Song> = {
  0: { bpm: 104, steps: 64, notes: [
    ...seq(0, 8, [48, 55, 53, 55, 45, 52, 50, 55], 6, 'bass'),
    ...seq(0, 2, [72, 0, 76, 79, 0, 76, 74, 0, 72, 0, 74, 76, 0, 79, 81, 0, 79, 0, 76, 72, 0, 74, 76, 0, 74, 0, 72, 69, 0, 71, 72, 0], 2, 'bell'),
  ] },
  1: { bpm: 118, steps: 64, notes: [
    ...seq(0, 4, [48, 0, 55, 0, 53, 0, 55, 0, 45, 0, 52, 0, 50, 0, 55, 0], 3, 'bass'),
    ...seq(0, 2, [72, 76, 79, 76, 0, 77, 76, 74, 72, 0, 74, 76, 74, 72, 69, 0, 69, 72, 76, 74, 0, 72, 74, 71, 72, 0, 0, 79, 77, 76, 74, 0], 2, 'lead'),
    ...drums(64),
  ] },
  2: { bpm: 100, steps: 64, notes: [
    ...seq(0, 4, [45, 0, 52, 0, 48, 0, 55, 0, 41, 0, 48, 0, 43, 0, 50, 0], 3, 'bass'),
    ...seq(0, 2, [69, 0, 72, 0, 76, 74, 72, 0, 71, 0, 72, 74, 0, 72, 69, 0, 65, 0, 69, 72, 0, 74, 72, 69, 67, 0, 71, 74, 0, 71, 67, 0], 3, 'bell'),
    ...drums(64),
  ] },
  3: { bpm: 96, steps: 64, notes: [
    ...seq(0, 4, [50, 0, 57, 0, 53, 0, 60, 0, 48, 0, 55, 0, 52, 0, 57, 0], 3, 'bass'),
    ...seq(0, 2, [74, 0, 77, 81, 0, 79, 77, 0, 76, 0, 74, 72, 0, 74, 77, 0, 74, 0, 72, 69, 0, 72, 74, 0, 76, 77, 0, 76, 74, 0, 0, 0], 3, 'lead'),
    ...seq(1, 8, [86, 84, 81, 84, 86, 88, 86, 81], 1, 'bell'),
    ...drums(64),
  ] },
};

const cache = new Map<number, Float32Array>();
let current: { source: AudioBufferSourceNode & { gainNode?: GainNode }; act: number } | null = null;
let wanted = -1;

function render(act: number): Float32Array | null {
  const Z = audio.zzfx();
  if (!Z) return null;
  const song = SONGS[act] ?? SONGS[1]!;
  const sr = Z.ZZFX.sampleRate;
  const stepLen = (60 / song.bpm / 4) * sr;
  const total = Math.floor(stepLen * song.steps);
  const out = new Float32Array(total);
  for (const [step, n, len, inst] of song.notes) {
    const f = midi(n);
    const dur = (len * stepLen) / sr;
    let s: number[];
    switch (inst) {
      case 'lead': s = Z.ZZFX.buildSamples(0.38, 0, f, 0.01, dur * 0.5, dur * 0.5, 2, 1.3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.6, 0.02, 0.15); break;
      case 'bell': s = Z.ZZFX.buildSamples(0.32, 0, f, 0.005, 0.02, dur + 0.15, 0, 1.6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.5, 0.05); break;
      case 'bass': s = Z.ZZFX.buildSamples(0.55, 0, f, 0.01, dur * 0.6, dur * 0.35, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.8); break;
      case 'kick': s = Z.ZZFX.buildSamples(0.6, 0, 70, 0, 0.03, 0.12, 0, 1, -6); break;
      default: s = Z.ZZFX.buildSamples(0.12, 0, 4000, 0, 0, 0.03, 4, 1, 0, 0, 0, 0, 0, 3); break;
    }
    const start = Math.floor(step * stepLen);
    for (let i = 0; i < s.length; i++) out[(start + i) % total]! += s[i]!;
  }
  let peak = 0;
  for (let i = 0; i < total; i++) peak = Math.max(peak, Math.abs(out[i]!));
  if (peak > 0) for (let i = 0; i < total; i++) out[i]! *= 0.9 / peak;
  return out;
}

function stopCurrent(): void {
  if (!current) return;
  const { source } = current;
  const ctx = audio.context();
  try {
    if (ctx && source.gainNode) {
      source.gainNode.gain.setTargetAtTime(0, ctx.currentTime, 0.25);
      setTimeout(() => { try { source.stop(); } catch { /* */ } }, 900);
    } else source.stop();
  } catch { /* */ }
  current = null;
}

function start(act: number): void {
  const Z = audio.zzfx();
  if (!Z || audio.muted) return;
  let buf = cache.get(act);
  if (!buf) { const r = render(act); if (!r) return; buf = r; cache.set(act, buf); }
  const source = Z.ZZFX.playSamples([Array.from(buf)], 0.42, 1, 0, true) as AudioBufferSourceNode & { gainNode?: GainNode };
  const ctx = audio.context();
  if (ctx && source.gainNode) {
    const target = source.gainNode.gain.value;
    source.gainNode.gain.setValueAtTime(0, ctx.currentTime);
    source.gainNode.gain.linearRampToValueAtTime(target, ctx.currentTime + 1.2);
  }
  current = { source, act };
}

export const music = {
  /** Play the loop for an act (0 = menus). Safe to call repeatedly. */
  play(act: number): void {
    wanted = act;
    if (current?.act === act) return;
    stopCurrent();
    start(act);
  },
  stop(): void { wanted = -1; stopCurrent(); },
  /** Re-sync after unlock or mute changes. */
  refresh(): void {
    if (audio.muted) { stopCurrent(); return; }
    if (wanted >= 0 && current?.act !== wanted) { stopCurrent(); start(wanted); }
  },
};

audio.onMute(() => music.refresh());
