// Sound-effect designs: soft, satisfying, calming. Gentle taps, soft clicks, breathy whooshes, muted
// wooden knocks, water droplets and fabric thumps. Only sine/triangle tones and low-passed noise, gentle
// attacks, no buzzy square/saw waves or bit-crush. Each sound is one or more ZzFX voices mixed into a
// buffer, then normalised to a target peak. Pure data + a builder that only needs ZZFX.buildSamples.
//
// ZzFX params: [volume, randomness, frequency, attack, sustain, release, shape, shapeCurve, slide,
//   deltaSlide, pitchJump, pitchJumpTime, repeatTime, noise, modulation, bitCrush, delay,
//   sustainVolume, decay, tremolo, filter]
// shape: 0 sine · 1 triangle · 4 noise · slide: +1 ≈ +500 Hz/s · filter < 0: low-pass cutoff (Hz)

export interface Layer { p: number[]; at?: number; gain?: number }
export interface SfxDef { layers: Layer[]; peak: number; duck?: number; info: string; /** Extra post low-pass (Hz); default 5500. */ lp?: number }

const v = (...p: number[]): number[] => p;
/** Low-passed noise: frequency sets the noise "grain", lp the softness. */
const hush = (vol: number, freq: number, attack: number, sustain: number, release: number, lp: number, slide = 0, tremolo = 0, repeat = 0) =>
  v(vol, 0, freq, attack, sustain, release, 4, 1, slide, 0, 0, 0, repeat, 0, 0, 0, 0, 0.8, 0, tremolo, -lp);
/** A soft tone (sine 0 or triangle 1), optionally low-passed. */
const tone = (vol: number, freq: number, attack: number, sustain: number, release: number, shape = 0, slide = 0, lp = 0, extra: Partial<{ jump: number; jumpTime: number; mod: number; decay: number; sv: number }> = {}) =>
  v(vol, 0, freq, attack, sustain, release, shape, 1, slide, 0, extra.jump ?? 0, extra.jumpTime ?? 0, 0, 0, extra.mod ?? 0, 0, 0, extra.sv ?? 0.8, extra.decay ?? 0.02, 0, lp ? -lp : 0);

export const SFX_DEFS: Record<string, SfxDef> = {
  // Movement --------------------------------------------------------------------------
  jump: { lp: 1500, peak: 0.32, info: 'Pip jumps: a small breathy lift', layers: [
    { p: hush(1, 700, 0.012, 0.03, 0.1, 1800, 2) },
    { p: tone(0.6, 380, 0.01, 0.03, 0.08, 0, 6, 1500), gain: 0.45 },
  ] },
  land: { peak: 0.34, info: 'Pip lands: a soft fabric thump', layers: [
    { p: tone(1, 120, 0.004, 0.02, 0.09, 0, -1.2) },
    { p: hush(0.8, 400, 0.003, 0.01, 0.07, 650), gain: 0.6 },
  ] },
  step: { lp: 1700, peak: 0.12, info: 'Footstep: a tiny soft tap', layers: [
    { p: hush(1, 900, 0.002, 0, 0.025, 1400) },
  ] },
  push: { lp: 900, peak: 0.18, info: 'Pushing a body: a soft cloth drag', layers: [
    { p: hush(1, 220, 0.03, 0.06, 0.08, 450, 0, 0.35, 0.05) },
  ] },
  // Death ---------------------------------------------------------------------------------
  squeak: { lp: 1400, peak: 0.5, duck: 0.4, info: 'Pip dies: a soft "pff" and a little exhale', layers: [
    { p: hush(1, 500, 0.006, 0.02, 0.2, 1100, -0.4) },
    { p: tone(0.5, 560, 0.01, 0.03, 0.14, 0, -2, 1200), gain: 0.35 },
  ] },
  squish: { peak: 0.45, info: 'Body squished (crusher, dropper): a muted squish', layers: [
    { p: hush(1, 260, 0.008, 0.04, 0.16, 700, -0.5) },
    { p: tone(1, 95, 0.006, 0.03, 0.14, 0, -0.5), gain: 0.7 },
    { p: tone(0.5, 300, 0.004, 0.01, 0.05, 0, 8), at: 0.09, gain: 0.25 },
  ] },
  // Corpses -------------------------------------------------------------------------------
  blorp: { peak: 0.4, info: 'A body turns Rot: a soft wet bubble', layers: [
    { p: tone(1, 240, 0.008, 0.03, 0.1, 0, 10, 0, { mod: 6 }) },
    { p: tone(0.6, 380, 0.005, 0.01, 0.06, 0, 14), at: 0.08, gain: 0.5 },
  ] },
  clack: { peak: 0.38, info: 'A body turns Skeleton: two muted wooden knocks', layers: [
    { p: tone(1, 520, 0.002, 0.004, 0.05, 1, 0, 1600) },
    { p: tone(1, 430, 0.002, 0.004, 0.06, 1, 0, 1400), at: 0.07, gain: 0.8 },
  ] },
  poof: { lp: 1300, peak: 0.3, info: 'The oldest body crumbles to dust: a breathy whoosh', layers: [
    { p: hush(1, 500, 0.03, 0.05, 0.3, 1300, -0.5) },
  ] },
  pin: { peak: 0.35, info: 'A body is pinned on spikes: a soft thud', layers: [
    { p: tone(1, 180, 0.003, 0.02, 0.08, 0, -1) },
    { p: tone(0.6, 700, 0.002, 0.003, 0.04, 1, 0, 1500), gain: 0.3 },
  ] },
  // Objects -------------------------------------------------------------------------------
  click: { peak: 0.3, info: 'Pressure plate: a soft click', layers: [
    { p: tone(1, 1400, 0.001, 0.002, 0.025, 1, 0, 3000) },
    { p: tone(1, 300, 0.002, 0.01, 0.04, 0, -1), gain: 0.6 },
  ] },
  gate: { peak: 0.4, info: 'Gate moves: a muted wooden slide and clunk', layers: [
    { p: hush(1, 180, 0.03, 0.08, 0.06, 400) },
    { p: tone(1, 140, 0.004, 0.03, 0.1, 1, -0.4, 900), at: 0.12, gain: 0.8 },
  ] },
  slam: { peak: 0.6, duck: 0.3, info: 'Crusher slam: a deep, soft thud', layers: [
    { p: tone(1, 72, 0.004, 0.05, 0.35, 0, -0.3) },
    { p: hush(0.9, 160, 0.003, 0.04, 0.25, 320), gain: 0.7 },
  ] },
  rumble: { peak: 0.25, info: 'Dropper shakes: a low soft rumble', layers: [
    { p: hush(1, 90, 0.05, 0.18, 0.1, 220, 0, 0.5, 0.05) },
  ] },
  whistle: { lp: 1800, peak: 0.22, info: 'Dropper falls: a breathy falling whistle', layers: [
    { p: tone(1, 900, 0.03, 0.2, 0.12, 0, -2.5, 1800) },
    { p: hush(0.5, 600, 0.03, 0.2, 0.12, 1500), gain: 0.4 },
  ] },
  splash: { lp: 1900, peak: 0.4, info: 'Water: a splash and droplets', layers: [
    { p: hush(1, 600, 0.006, 0.05, 0.25, 1500, -0.3) },
    { p: tone(0.7, 1000, 0.002, 0.01, 0.05, 0, 10), at: 0.1, gain: 0.35 },
    { p: tone(0.7, 1350, 0.002, 0.01, 0.04, 0, 12), at: 0.17, gain: 0.3 },
  ] },
  zap: { lp: 1800, peak: 0.3, info: 'Laser: a soft "fsst"', layers: [
    { p: hush(1, 1200, 0.005, 0.03, 0.12, 2600) },
    { p: tone(0.6, 700, 0.004, 0.03, 0.1, 0, -6, 2000), gain: 0.4 },
  ] },
  hum: { peak: 0.14, info: 'Laser hum (ambient)', layers: [
    { p: v(1, 0, 110, 0.08, 0.4, 0.12, 0, 1, 0, 0, 0, 0, 0.05, 0, 0, 0, 0, 0.8, 0, 0.3) },
    { p: tone(0.5, 220, 0.08, 0.4, 0.12), gain: 0.3 },
  ] },
  shing: { lp: 3200, peak: 0.3, info: 'Pop-up spike: a soft chime', layers: [
    { p: tone(1, 1600, 0.004, 0.02, 0.25, 0, 0, 3500, { decay: 0.05, sv: 0.6 }) },
    { p: tone(0.6, 2400, 0.004, 0.01, 0.2, 0, 0, 3500), gain: 0.35 },
  ] },
  boing: { peak: 0.38, info: 'Rot bounce (and door hop): a soft spring', layers: [
    { p: tone(1, 160, 0.006, 0.08, 0.22, 0, 5, 0, { mod: 8 }) },
  ] },
  pop: { peak: 0.3, info: 'Pop: a soft bubble pop', layers: [
    { p: tone(1, 500, 0.003, 0.01, 0.05, 0, 18) },
  ] },
  tock: { peak: 0.32, info: 'Sign appears: a soft wooden tock', layers: [
    { p: tone(1, 480, 0.002, 0.005, 0.06, 1, 0, 1500) },
  ] },
  scurry: { lp: 1800, peak: 0.2, info: 'Runaway door scurries: tiny soft taps', layers: [
    { p: hush(1, 900, 0.002, 0, 0.02, 1800) },
    { p: hush(1, 800, 0.002, 0, 0.02, 1700), at: 0.045 },
    { p: hush(1, 1000, 0.002, 0, 0.02, 1800), at: 0.09 },
    { p: hush(1, 850, 0.002, 0, 0.02, 1700), at: 0.135 },
  ] },
  // Interface -----------------------------------------------------------------------------
  menu: { peak: 0.22, info: 'Menu move: a soft tick', layers: [
    { p: tone(1, 1000, 0.002, 0.005, 0.04, 0, 0, 2500) },
  ] },
  select: { peak: 0.3, info: 'Menu select: a soft two-note chime', layers: [
    { p: tone(1, 660, 0.004, 0.04, 0.12, 0, 0, 3000, { jump: 330, jumpTime: 0.05 }) },
  ] },
};

/** Every effect name, in a stable order, with a short label for the editor. */
export const SFX_NAMES: readonly string[] = Object.keys(SFX_DEFS);
export const SFX_INFO: Readonly<Record<string, string>> = Object.fromEntries(Object.entries(SFX_DEFS).map(([k, d]) => [k, d.info]));

/**
 * Build a sound as a mono buffer. `build` is ZZFX.buildSamples (bound) and `sr` its sample rate.
 * Returns samples normalised to the sound's target peak.
 */
export function buildSfx(def: Pick<SfxDef, 'layers' | 'peak' | 'lp'>, build: (...p: number[]) => ArrayLike<number>, sr: number): Float32Array {
  const parts = def.layers.map((l) => ({ s: build(...l.p), at: Math.round((l.at ?? 0) * sr), g: l.gain ?? 1 }));
  const n = Math.max(1, ...parts.map((p) => p.at + p.s.length)) + Math.round(0.005 * sr);
  const out = new Float32Array(n);
  for (const { s, at, g } of parts) for (let i = 0; i < s.length; i++) out[at + i]! += s[i]! * g;
  // Two one-pole low-passes (12 dB/oct): nothing harsh up top.
  const a = 1 - Math.exp((-2 * Math.PI * (def.lp ?? 5500)) / sr);
  for (let pass = 0; pass < 2; pass++) { let z = 0; for (let i = 0; i < n; i++) { z += a * (out[i]! - z); out[i] = z; } }
  // Fade the last 5 ms, normalise.
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]!));
  const fade = Math.round(0.005 * sr);
  for (let i = 0; i < fade && i < n; i++) out[n - 1 - i]! *= i / fade;
  const k = peak > 0 ? def.peak / peak : 1;
  for (let i = 0; i < n; i++) out[i]! *= k;
  return out;
}
