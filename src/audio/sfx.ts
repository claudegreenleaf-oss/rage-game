// ZzFX sound presets (spec §12). ZzFX builds an AudioContext on import, so it's loaded lazily
// after the first user input, as browsers require.
import { progress } from '../progress';

type ZzfxModule = typeof import('zzfx');
let Z: ZzfxModule | null = null;
let loading: Promise<void> | null = null;
let muted = progress.muted;
const listeners = new Set<(m: boolean) => void>();

/** ZzFX parameter lists: [volume, randomness, frequency, attack, sustain, release, shape, shapeCurve,
 *  slide, deltaSlide, pitchJump, pitchJumpTime, repeatTime, noise, modulation, bitCrush, delay,
 *  sustainVolume, decay, tremolo, filter] */
export const SFX: Record<string, number[]> = {
  jump: [0.55, 0.06, 330, 0.01, 0.03, 0.09, 0, 1.6, 11, 0, 0, 0, 0, 0, 0, 0, 0, 0.6, 0.02],
  land: [0.45, 0.05, 110, 0, 0.01, 0.07, 4, 1.4, -6, 0, 0, 0, 0, 1.1, 0, 0, 0, 0.5, 0.02],
  step: [0.12, 0.2, 620, 0, 0, 0.02, 4, 2, 0, 0, 0, 0, 0, 1.6],
  squeak: [0.65, 0.04, 980, 0.01, 0.04, 0.13, 0, 1.4, -38, 0, 0, 0, 0, 0, 6, 0, 0, 0.7, 0.03],
  squish: [0.7, 0.1, 85, 0, 0.05, 0.2, 4, 2, -3, 0, 0, 0, 0, 2.4, 0, 0.1, 0, 0.6],
  blorp: [0.6, 0.05, 170, 0.01, 0.05, 0.16, 0, 1, -9, 3, 0, 0, 0, 0, 22, 0, 0, 0.7, 0.05],
  clack: [0.5, 0.05, 1150, 0, 0, 0.04, 3, 3, 0, 0, 0, 0, 0.035, 1, 0, 0, 0, 0.4],
  poof: [0.5, 0.1, 210, 0.02, 0.05, 0.28, 4, 1, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0.4, 0.1],
  click: [0.45, 0, 1500, 0, 0, 0.025, 1, 2, 0, 0, 650, 0.02],
  gate: [0.65, 0.05, 95, 0, 0.05, 0.22, 2, 2, -2, 0, 0, 0, 0, 1.4, 0, 0.2],
  slam: [0.95, 0.05, 62, 0, 0.07, 0.42, 4, 3, -2, 0, 0, 0, 0, 2.2, 0, 0.3, 0, 0.5, 0.1],
  rumble: [0.4, 0.1, 55, 0.04, 0.2, 0.08, 4, 1, 0, 0, 0, 0, 0.05, 4],
  whistle: [0.3, 0.05, 900, 0, 0.12, 0.08, 0, 1, -34],
  splash: [0.65, 0.1, 320, 0.01, 0.1, 0.32, 4, 1, 0, 0, 0, 0, 0, 4, 0, 0, 0.05, 0.5],
  zap: [0.6, 0, 1600, 0, 0.04, 0.16, 2, 2, -42, 0, 0, 0, 0, 0, 0, 0.2],
  tock: [0.45, 0, 420, 0, 0, 0.06, 1, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.5],
  scurry: [0.3, 0.1, 760, 0, 0, 0.03, 3, 2, 0, 0, 0, 0, 0.025, 1],
  boing: [0.6, 0, 190, 0.01, 0.06, 0.22, 0, 1, 14, 0, 0, 0, 0, 0, 0, 0, 0, 0.6],
  shing: [0.55, 0, 2100, 0, 0.02, 0.14, 0, 1, 0, 0, 520, 0.02, 0, 0, 0, 0, 0, 0.5],
  push: [0.18, 0.15, 95, 0.02, 0.05, 0.06, 4, 1, 0, 0, 0, 0, 0, 1],
  pop: [0.45, 0, 520, 0, 0.02, 0.06, 0, 1, 22],
  menu: [0.3, 0, 760, 0, 0.01, 0.04, 1, 1.5, 0, 0, 300, 0.02],
  select: [0.4, 0, 520, 0, 0.03, 0.12, 0, 1.4, 0, 0, 260, 0.04],
  pin: [0.4, 0.05, 240, 0, 0.02, 0.1, 3, 2, -6, 0, 0, 0, 0, 1],
};

const JINGLE: Array<[number, number]> = [[523, 0], [659, 90], [784, 180], [1047, 290], [988, 420], [1047, 520]];

export const audio = {
  get muted(): boolean { return muted; },
  get ready(): boolean { return Z !== null; },
  /** Load ZzFX and resume the AudioContext. Call from a user input handler. */
  unlock(): Promise<void> {
    if (Z) { void Z.ZZFX.audioContext.resume?.(); return Promise.resolve(); }
    if (!loading) loading = import('zzfx').then((m) => { Z = m; Z.ZZFX.volume = 0.32; void Z.ZZFX.audioContext.resume?.(); }).catch(() => { /* no audio */ });
    return loading;
  },
  context(): AudioContext | null { return Z ? Z.ZZFX.audioContext : null; },
  zzfx(): ZzfxModule | null { return Z; },
  play(name: string, pitch = 1, vol = 1): void {
    if (muted || !Z) return;
    const p = SFX[name];
    if (!p) return;
    const params = [...p];
    params[0] = (params[0] ?? 1) * vol;
    params[2] = (params[2] ?? 220) * pitch;
    try { Z.zzfx(...params); } catch { /* ignore */ }
  },
  jingle(): void {
    if (muted || !Z) return;
    for (const [f, t] of JINGLE) setTimeout(() => { try { Z?.zzfx(0.4, 0, f, 0.01, 0.08, 0.25, 0, 1.5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.7, 0.05); } catch { /* */ } }, t);
  },
  setMuted(m: boolean): void {
    muted = m;
    progress.setMuted(m);
    listeners.forEach((f) => f(m));
  },
  toggleMute(): boolean { audio.setMuted(!muted); return muted; },
  onMute(f: (m: boolean) => void): () => void { listeners.add(f); return () => listeners.delete(f); },
};
