// Music playback: each song (src/audio/songs.ts) is rendered once into a seamless stereo loop in a Web
// Worker, cached, and played as a looping buffer through the music bus, crossfading between songs.
import { audio } from './sfx';
import { renderSong, type Rendered } from './synth';
import { FANFARE, SONGS } from './songs';

/** Music sits about 10 dB under the effects: every loop is levelled to this RMS (dBFS) at the bus. */
const MUSIC_RMS_DB = -26;
const FADE = 0.9;

type Id = number | 'fanfare';
interface Loop { buffer: AudioBuffer; gain: number }

const cache = new Map<Id, Loop>();
const pending = new Map<Id, Promise<Loop | null>>();
let worker: Worker | null | undefined;
const waiters = new Map<Id, (r: { left: Float32Array; right: Float32Array; rms: number } | null) => void>();

let current: { id: number; src: AudioBufferSourceNode; gain: GainNode } | null = null;
let wanted = -1;

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = new Worker(new URL('./music.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ id: Id; left: Float32Array; right: Float32Array; rms: number }>) => {
      const w = waiters.get(e.data.id);
      waiters.delete(e.data.id);
      w?.(e.data);
    };
    worker.onerror = () => { worker = null; for (const [, w] of waiters) w(null); waiters.clear(); };
  } catch {
    worker = null;
  }
  return worker;
}

/** Fallback: render on the main thread in ~6 ms slices. */
function renderSliced(id: Id, sr: number): Promise<Rendered | null> {
  const song = id === 'fanfare' ? FANFARE : SONGS[id];
  if (!song) return Promise.resolve(null);
  const gen = renderSong(song, sr);
  return new Promise((resolve) => {
    const step = () => {
      const t0 = performance.now();
      for (;;) {
        const r = gen.next();
        if (r.done) { resolve(r.value); return; }
        if (performance.now() - t0 > 6) break;
      }
      setTimeout(step, 0);
    };
    step();
  });
}

function load(id: Id): Promise<Loop | null> {
  const hit = cache.get(id);
  if (hit) return Promise.resolve(hit);
  const inflight = pending.get(id);
  if (inflight) return inflight;
  const ctx = audio.context();
  if (!ctx) return Promise.resolve(null);
  const sr = ctx.sampleRate;
  const w = getWorker();
  const raw: Promise<{ left: Float32Array; right: Float32Array; rms: number } | null> = w
    ? new Promise((resolve) => { waiters.set(id, resolve); w.postMessage({ id, sr }); }).then((r) => (r as { left: Float32Array } | null) ?? renderSliced(id, sr)) as Promise<{ left: Float32Array; right: Float32Array; rms: number } | null>
    : renderSliced(id, sr);
  const p = raw.then((r) => {
    pending.delete(id);
    if (!r) return null;
    const buffer = ctx.createBuffer(2, r.left.length, sr);
    buffer.copyToChannel(r.left as Float32Array<ArrayBuffer>, 0);
    buffer.copyToChannel(r.right as Float32Array<ArrayBuffer>, 1);
    const gain = Math.min(1, Math.pow(10, MUSIC_RMS_DB / 20) / Math.max(1e-4, r.rms));
    const loop = { buffer, gain };
    cache.set(id, loop);
    return loop;
  });
  pending.set(id, p);
  return p;
}

function stopCurrent(): void {
  const ctx = audio.context();
  if (!current || !ctx) { current = null; return; }
  const { src, gain } = current;
  const t = ctx.currentTime;
  gain.gain.cancelScheduledValues(t);
  gain.gain.setValueAtTime(gain.gain.value, t);
  gain.gain.linearRampToValueAtTime(0, t + FADE);
  try { src.stop(t + FADE + 0.05); } catch { /* */ }
  current = null;
}

function startLoop(id: number, loop: Loop): void {
  const ctx = audio.context(), out = audio.musicBus();
  if (!ctx || !out) return;
  const src = ctx.createBufferSource();
  src.buffer = loop.buffer;
  src.loop = true;
  const gain = ctx.createGain();
  const t = ctx.currentTime;
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(loop.gain, t + FADE);
  src.connect(gain).connect(out);
  src.start(t);
  current = { id, src, gain };
}

function sync(): void {
  if (wanted < 0 || audio.muted || !audio.context()) { if (audio.muted) stopCurrent(); return; }
  if (current?.id === wanted) return;
  const id = wanted;
  void load(id).then((loop) => {
    if (!loop || wanted !== id || current?.id === id || audio.muted) return;
    stopCurrent();
    startLoop(id, loop);
    // Warm the rest of the soundtrack in the background, one song at a time.
    void [...Object.keys(SONGS).map(Number), 'fanfare' as const].reduce<Promise<void>>((p, other) => p.then(() => load(other).then(() => undefined)), Promise.resolve());
  });
}

/** Render the win fanfare as a one-shot buffer (used by audio.jingle). */
export async function renderFanfare(ctx: AudioContext): Promise<AudioBuffer | null> {
  const loop = await load('fanfare');
  void ctx;
  return loop?.buffer ?? null;
}

export const music = {
  /** Play the loop for a slot: 0 title/editor, 1–3 acts, 4 credits/end. Safe to call repeatedly. */
  play(act: number): void {
    wanted = SONGS[act] ? act : 0;
    sync();
  },
  stop(): void { wanted = -1; stopCurrent(); },
  /** Re-sync after unlock or mute changes. */
  refresh(): void { sync(); },
};

audio.onMute(() => music.refresh());
