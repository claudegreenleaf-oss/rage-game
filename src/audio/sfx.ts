// Audio engine and sound effects (spec §12). One AudioContext with a master bus:
//   sfx bus ─┐
//   music bus → duck ─┴→ master → compressor/limiter → speakers
// ZzFX builds the effect samples (it creates its AudioContext on import, so it's loaded lazily after the
// first user input, as browsers require). Every effect is rendered once and cached as an AudioBuffer.
import { progress } from '../progress';
import { SFX_DEFS, buildSfx, type SfxDef } from './sfxdefs';

export { SFX_NAMES, SFX_INFO } from './sfxdefs';

type ZzfxModule = typeof import('zzfx');

let Z: ZzfxModule | null = null;
let loading: Promise<void> | null = null;
let muted = progress.muted;
const listeners = new Set<(m: boolean) => void>();

interface Bus { ctx: AudioContext; master: GainNode; sfx: GainNode; music: GainNode; duck: GainNode }
let bus: Bus | null = null;
const buffers = new Map<string, AudioBuffer>();
const lastPlayed = new Map<string, number>();
let jingleBuf: AudioBuffer | null = null;
/** Per-level ZzFX overrides by sound name, and their rendered buffers. */
let overrides: Record<string, number[]> | null = null;
const overrideBufs = new Map<string, AudioBuffer>();

const SFX_LEVEL = 0.9;
const MASTER_LEVEL = 0.95;

/** Legacy table kept for callers that read it: the ZzFX parameters of each effect's first layer. */
export const SFX: Record<string, number[]> = Object.fromEntries(Object.entries(SFX_DEFS).map(([k, d]) => [k, d.layers[0]!.p]));

function makeBus(ctx: AudioContext): Bus {
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.knee.value = 8;
  comp.ratio.value = 4;
  comp.attack.value = 0.003;
  comp.release.value = 0.18;
  const master = ctx.createGain();
  master.gain.value = muted ? 0 : MASTER_LEVEL;
  const sfx = ctx.createGain();
  sfx.gain.value = SFX_LEVEL * progress.sfxVolume;
  const music = ctx.createGain();
  music.gain.value = progress.musicVolume;
  const duck = ctx.createGain();
  duck.gain.value = 1;
  music.connect(duck).connect(master);
  sfx.connect(master);
  master.connect(comp).connect(ctx.destination);
  return { ctx, master, sfx, music, duck };
}

function toBuffer(ctx: AudioContext, chans: Float32Array[], sr: number): AudioBuffer {
  const b = ctx.createBuffer(chans.length, chans[0]!.length, sr);
  chans.forEach((c, i) => b.copyToChannel(c as Float32Array<ArrayBuffer>, i));
  return b;
}

/** Raw ZzFX params as a buffer (peak-normalised so previews and overrides sit at a sane level). */
function buildRaw(params: number[], peak = 0.45): AudioBuffer | null {
  if (!Z || !bus) return null;
  const sr = Z.ZZFX.sampleRate;
  const p = params.map((x) => (Number.isFinite(x) ? x : 0)).slice(0, 21);
  try {
    const s = buildSfx({ layers: [{ p }], peak: Math.min(peak, Math.max(0.05, Math.abs(p[0] ?? 1)) * peak) }, Z.ZZFX.buildSamples.bind(Z.ZZFX), sr);
    if (s.length > sr * 6) return null; // guard against runaway params
    return toBuffer(bus.ctx, [s], sr);
  } catch { return null; }
}

function playBuffer(buf: AudioBuffer, pitch: number, vol: number): AudioBufferSourceNode | null {
  if (!bus) return null;
  try {
    const src = bus.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = Math.max(0.25, Math.min(4, pitch));
    const g = bus.ctx.createGain();
    g.gain.value = Math.max(0, Math.min(2, vol));
    src.connect(g).connect(bus.sfx);
    src.start();
    return src;
  } catch { return null; }
}

function buildOne(name: string, def: SfxDef): AudioBuffer | null {
  if (!Z || !bus) return null;
  const sr = Z.ZZFX.sampleRate;
  const s = buildSfx(def, Z.ZZFX.buildSamples.bind(Z.ZZFX), sr);
  const buf = toBuffer(bus.ctx, [s], sr);
  buffers.set(name, buf);
  return buf;
}

/** Render every effect in small slices so unlocking never stalls a frame. */
function warm(): void {
  const names = Object.keys(SFX_DEFS).filter((n) => !buffers.has(n));
  const next = () => {
    const t0 = performance.now();
    while (names.length && performance.now() - t0 < 4) { const n = names.shift()!; if (!buffers.has(n)) buildOne(n, SFX_DEFS[n]!); }
    if (names.length) setTimeout(next, 16);
  };
  setTimeout(next, 0);
}

export const audio = {
  get muted(): boolean { return muted; },
  get ready(): boolean { return bus !== null; },

  /** Load ZzFX, build the bus and resume the AudioContext. Call from a user input handler. */
  unlock(): Promise<void> {
    if (bus) { void bus.ctx.resume?.(); return Promise.resolve(); }
    if (!loading) {
      loading = import('zzfx').then((m) => {
        Z = m;
        const ctx = m.ZZFX.audioContext;
        bus = makeBus(ctx);
        void ctx.resume?.();
        warm();
      }).catch(() => { /* no audio available */ });
    }
    return loading;
  },

  context(): AudioContext | null { return bus?.ctx ?? null; },
  zzfx(): ZzfxModule | null { return Z; },
  /** Diagnostics hook (tests): the live bus nodes, or null before unlock. */
  debugBus(): Readonly<Bus> | null { return bus; },
  /** The bus music should connect to (null before unlock). */
  musicBus(): GainNode | null { return bus?.music ?? null; },

  /** Play an effect. `pitch` scales playback speed (and pitch); `vol` scales its level. */
  play(name: string, pitch = 1, vol = 1): void {
    if (muted || !bus) return;
    const def = SFX_DEFS[name];
    if (!def) return;
    const now = bus.ctx.currentTime;
    // Don't stack the same sound on top of itself within a few milliseconds.
    const key = `${name}@${pitch.toFixed(2)}`;
    if (now - (lastPlayed.get(key) ?? -1) < 0.025) return;
    lastPlayed.set(key, now);
    const ov = overrides?.[name];
    let buf: AudioBuffer | null | undefined;
    if (ov) {
      const k = `${name}:${ov.join(',')}`;
      buf = overrideBufs.get(k) ?? buildRaw(ov, def.peak);
      if (buf) overrideBufs.set(k, buf);
    }
    buf ??= buffers.get(name) ?? buildOne(name, def);
    if (!buf) return;
    const src = playBuffer(buf, pitch, vol);
    if (src && def.duck) audio.duck(def.duck, buf.duration / src.playbackRate.value);
  },

  /** Play raw ZzFX params right away (sound-designer preview). Unlocks audio if needed. */
  playParams(params: number[], vol = 1): void {
    if (muted) return;
    const go = () => { const b = buildRaw(params); if (b) playBuffer(b, 1, vol); };
    if (bus) go(); else void audio.unlock().then(go);
  },

  /** Per-level overrides by sound name (ZzFX params). Pass undefined to clear them. */
  setLevelOverrides(sfx?: Record<string, number[]>): void {
    overrides = sfx && Object.keys(sfx).length ? { ...sfx } : null;
    overrideBufs.clear();
  },

  /** Short level-complete fanfare (rendered with the music synth). */
  jingle(): void {
    if (muted || !bus) return;
    if (!jingleBuf) {
      void import('./music').then((m) => m.renderFanfare()).then((b) => { if (b) { jingleBuf = b; audio.jingle(); } }).catch(() => {});
      return;
    }
    const src = bus.ctx.createBufferSource();
    src.buffer = jingleBuf;
    const g = bus.ctx.createGain();
    g.gain.value = 0.3; // gentle: measured in-game at ~4x the music at 0.8
    src.connect(g).connect(bus.sfx);
    src.start();
    audio.duck(0.6, 1.4);
  },

  /** Dip the music under an important sound. `amount` 0–1 is how far it dips. */
  duck(amount: number, seconds: number): void {
    if (!bus) return;
    const g = bus.duck.gain, t = bus.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(Math.max(0.05, 1 - amount), t, 0.03);
    g.setTargetAtTime(1, t + Math.max(0.15, seconds), 0.35);
  },

  /** Music volume 0–1 (saved). */
  get musicVolume(): number { return progress.musicVolume; },
  /** Sound-effects volume 0–1 (saved). */
  get sfxVolume(): number { return progress.sfxVolume; },
  /** Set either volume (0–1); applies immediately with a short ramp and is saved. */
  setVolumes(v: { music?: number; sfx?: number }): void {
    progress.setVolumes(v);
    if (!bus) return;
    const t = bus.ctx.currentTime;
    if (v.music !== undefined) { bus.music.gain.cancelScheduledValues(t); bus.music.gain.setTargetAtTime(progress.musicVolume, t, 0.04); }
    if (v.sfx !== undefined) { bus.sfx.gain.cancelScheduledValues(t); bus.sfx.gain.setTargetAtTime(SFX_LEVEL * progress.sfxVolume, t, 0.04); }
  },
  setMuted(m: boolean): void {
    muted = m;
    progress.setMuted(m);
    if (bus) {
      const t = bus.ctx.currentTime;
      bus.master.gain.cancelScheduledValues(t);
      bus.master.gain.setTargetAtTime(m ? 0 : MASTER_LEVEL, t, 0.05);
    }
    listeners.forEach((f) => f(m));
  },
  toggleMute(): boolean { audio.setMuted(!muted); return muted; },
  onMute(f: (m: boolean) => void): () => void { listeners.add(f); return () => listeners.delete(f); },
};
