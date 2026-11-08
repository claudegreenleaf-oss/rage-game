// Sound designer helpers: ZzFX parameter metadata, presets, randomize/mutate, and preview playback.
import { audio, SFX } from '../audio/sfx';

/** The 21 ZzFX parameters, in order, with friendly names and ranges. */
export const PARAMS: Array<{ name: string; label: string; min: number; max: number; step: number; def: number }> = [
  { name: 'volume', label: 'Volume', min: 0, max: 1.5, step: 0.01, def: 1 },
  { name: 'randomness', label: 'Randomness', min: 0, max: 1, step: 0.01, def: 0.05 },
  { name: 'frequency', label: 'Pitch (Hz)', min: 20, max: 2400, step: 1, def: 220 },
  { name: 'attack', label: 'Attack', min: 0, max: 1, step: 0.005, def: 0 },
  { name: 'sustain', label: 'Sustain', min: 0, max: 1, step: 0.005, def: 0 },
  { name: 'release', label: 'Release', min: 0, max: 2, step: 0.005, def: 0.1 },
  { name: 'shape', label: 'Shape (0 sine … 5 noise-ish)', min: 0, max: 5, step: 1, def: 0 },
  { name: 'shapeCurve', label: 'Shape curve', min: 0, max: 5, step: 0.05, def: 1 },
  { name: 'slide', label: 'Slide', min: -50, max: 50, step: 0.5, def: 0 },
  { name: 'deltaSlide', label: 'Slide change', min: -50, max: 50, step: 0.5, def: 0 },
  { name: 'pitchJump', label: 'Pitch jump', min: -1200, max: 1200, step: 10, def: 0 },
  { name: 'pitchJumpTime', label: 'Jump time', min: 0, max: 1, step: 0.01, def: 0 },
  { name: 'repeatTime', label: 'Repeat', min: 0, max: 0.5, step: 0.005, def: 0 },
  { name: 'noise', label: 'Noise', min: 0, max: 10, step: 0.1, def: 0 },
  { name: 'modulation', label: 'Wobble', min: 0, max: 50, step: 0.5, def: 0 },
  { name: 'bitCrush', label: 'Bit crush', min: 0, max: 1, step: 0.01, def: 0 },
  { name: 'delay', label: 'Echo', min: 0, max: 0.5, step: 0.005, def: 0 },
  { name: 'sustainVolume', label: 'Sustain level', min: 0, max: 1, step: 0.01, def: 1 },
  { name: 'decay', label: 'Decay', min: 0, max: 1, step: 0.005, def: 0 },
  { name: 'tremolo', label: 'Tremolo', min: 0, max: 1, step: 0.01, def: 0 },
  { name: 'filter', label: 'Filter (− low-pass, + high-pass)', min: -3000, max: 3000, step: 10, def: 0 },
];

export const DEFAULTS = PARAMS.map((p) => p.def);

/** Every game sound with a description (from the audio module when it provides one). */
export function soundList(): Array<{ name: string; desc: string }> {
  const mod = audio as unknown as { SFX_NAMES?: string[]; describe?: (n: string) => string };
  const ext = (globalThis as unknown as { __dtSfxNames?: Array<{ name: string; desc: string }> }).__dtSfxNames;
  if (ext) return ext;
  const names = mod.SFX_NAMES ?? Object.keys(SFX);
  return names.map((n) => ({ name: n, desc: mod.describe?.(n) ?? DESC[n] ?? '' }));
}

const DESC: Record<string, string> = {
  jump: 'Pip jumps', land: 'Pip lands', step: 'Footsteps', squeak: 'Pip dies', squish: 'Body hits', blorp: 'Rot bounce / aging',
  clack: 'Skeleton', poof: 'Dust, respawn', click: 'Plate', gate: 'Shutter', slam: 'Press slams', rumble: 'Dropper shakes',
  whistle: 'Dropper falls', splash: 'Water', zap: 'Laser zap', hum: 'Laser hum', shing: 'Pop-up spike', boing: 'Bounce, door hop',
  pop: 'Pop-ups, placing', tock: 'Sign', scurry: 'Runaway door', menu: 'Menu move', select: 'Menu select', push: 'Pushing', pin: 'Body pinned',
};

/** The game's own parameters for a sound (first voice), or defaults. */
export function baseParams(name: string): number[] {
  const p = SFX[name];
  return p ? fill(p) : [...DEFAULTS];
}

export const fill = (p: number[]): number[] => PARAMS.map((m, i) => (Number.isFinite(p[i]) ? p[i]! : m.def));

/** Trim trailing defaults so stored overrides stay small. */
export function compact(p: number[]): number[] {
  const out = p.map((v, i) => Math.round(v / PARAMS[i]!.step) * PARAMS[i]!.step).map((v) => +v.toFixed(4));
  while (out.length && out[out.length - 1] === PARAMS[out.length - 1]!.def) out.pop();
  return out;
}

/** Soft, satisfying starting points. */
export const PRESETS: Array<{ label: string; p: number[] }> = [
  { label: 'Soft tap', p: [0.6, 0.05, 520, 0, 0.01, 0.06, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.5, 0.02, 0, -1600] },
  { label: 'Wood knock', p: [0.7, 0.05, 240, 0, 0.005, 0.08, 1, 1.5, -2, 0, 0, 0, 0, 0.3, 0, 0, 0, 0.4, 0.03, 0, -1200] },
  { label: 'Chime', p: [0.5, 0.02, 880, 0.005, 0.05, 0.6, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0.12, 0.6, 0.1, 0, 0] },
  { label: 'Bubble', p: [0.5, 0.05, 300, 0, 0.02, 0.12, 0, 1, 12, 0, 0, 0, 0, 0, 0, 0, 0, 0.6, 0.05, 0, -1800] },
  { label: 'Breathy whoosh', p: [0.4, 0.1, 400, 0.04, 0.08, 0.25, 4, 1, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0.5, 0.1, 0, -900] },
  { label: 'Soft thud', p: [0.8, 0.05, 90, 0, 0.02, 0.15, 0, 1, -3, 0, 0, 0, 0, 0.4, 0, 0, 0, 0.5, 0.05, 0, -600] },
  { label: 'Droplet', p: [0.45, 0.05, 1200, 0, 0.005, 0.07, 0, 1, -20, 0, 0, 0, 0, 0, 0, 0, 0, 0.4, 0.02, 0, 0] },
  { label: 'Retro blip', p: [0.4, 0.05, 660, 0, 0.02, 0.05, 1, 1, 0, 0, 220, 0.03, 0, 0, 0, 0, 0, 0.6, 0, 0, 0] },
];

let seed = 1;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };

/** A random but usually pleasant sound (biased soft: sine/triangle, short, low-passed). */
export function randomize(): number[] {
  seed = (seed + Date.now()) >>> 0;
  const p = [...DEFAULTS];
  p[0] = 0.4 + rnd() * 0.4;
  p[2] = 80 + rnd() * rnd() * 1400;
  p[3] = rnd() < 0.6 ? 0 : rnd() * 0.05;
  p[4] = rnd() * 0.08;
  p[5] = 0.04 + rnd() * 0.4;
  p[6] = Math.floor(rnd() * rnd() * 5);
  p[8] = rnd() < 0.5 ? 0 : (rnd() - 0.5) * 30;
  p[13] = rnd() < 0.7 ? 0 : rnd() * 2;
  p[16] = rnd() < 0.8 ? 0 : rnd() * 0.15;
  p[18] = rnd() * 0.1;
  p[20] = rnd() < 0.5 ? -(400 + rnd() * 1800) : 0;
  return p;
}

/** Nudge every parameter a little. */
export function mutate(p: number[], amount = 0.12): number[] {
  return fill(p).map((v, i) => {
    const m = PARAMS[i]!;
    if (i === 6) return v;
    const span = m.max - m.min;
    const nv = v + (rnd() - 0.5) * span * amount * (i === 2 ? 0.3 : 1);
    return Math.max(m.min, Math.min(m.max, nv));
  });
}

let zz: ((...p: number[]) => unknown) | null = null;
/** Play raw params (prefers the game's audio engine; falls back to ZzFX directly). */
export async function playParams(p: number[], vol = 1): Promise<void> {
  const a = audio as unknown as { playParams?: (p: number[], v?: number) => void; unlock: () => Promise<void> };
  await a.unlock();
  if (typeof a.playParams === 'function') { a.playParams(p, vol); return; }
  if (!zz) zz = (await import('zzfx')).zzfx as (...p: number[]) => unknown;
  const q = fill(p);
  q[0] = q[0]! * vol;
  zz(...q);
}

/** Apply overrides in the running game (no-op until the audio engine supports it). */
export function setOverrides(sfx: Record<string, number[]> | undefined): void {
  const a = audio as unknown as { setLevelOverrides?: (s?: Record<string, number[]>) => void };
  if (typeof a.setLevelOverrides === 'function') a.setLevelOverrides(sfx);
}
