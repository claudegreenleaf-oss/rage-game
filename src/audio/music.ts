// Music playback. Every song is rendered once off the main thread (a Web Worker; a sliced main-thread
// fallback if workers are unavailable), cached, and played as a seamless looping buffer through the
// music bus, crossfading between songs.
//   music.play(slot)      0 title/editor · 1–3 acts · 4 credits/end · 5–7 zone themes (see SLOTS)
//   music.playCustom(s)   a level's own SongData theme, looped like a slot
//   music.previewCustom(s) / music.stopPreview()   audition a song in the editor over the current music
import type { SongData } from '../sim/types';
import { audio } from './sfx';
import { renderJob, type Job, type RenderOut } from './render';
import { SLOTS, songKey } from './songs';

/** Music sits under the effects: every loop is levelled to this RMS (dBFS) on the music bus. */
const MUSIC_RMS_DB = -28.5;
const FADE = 1.2;
/** The felt piano is low-passed, so 32 kHz loses nothing and renders faster. */
const PIANO_SR = 32000;

interface Loop { buffer: AudioBuffer; gain: number }
type Raw = { left: Float32Array; right: Float32Array; rms: number };

const cache = new Map<string, Loop>();
const pending = new Map<string, Promise<Loop | null>>();
const waiters = new Map<string, (r: Raw | null) => void>();
let worker: Worker | null | undefined;

let current: { key: string; src: AudioBufferSourceNode; gain: GainNode } | null = null;
let preview: { key: string; src: AudioBufferSourceNode; gain: GainNode } | null = null;
let wanted: { key: string; job: Job } | null = null;

const slotKey = (id: number) => `slot:${id}`;

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = new Worker(new URL('./music.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ key: string; left?: Float32Array; right?: Float32Array; rms?: number; failed?: boolean }>) => {
      const w = waiters.get(e.data.key);
      waiters.delete(e.data.key);
      w?.(e.data.failed || !e.data.left ? null : { left: e.data.left, right: e.data.right!, rms: e.data.rms! });
    };
    worker.onerror = () => { worker = null; for (const [, w] of waiters) w(null); waiters.clear(); };
  } catch {
    worker = null;
  }
  return worker;
}

/** Fallback: render on the main thread in ~6 ms slices so frames keep flowing. */
function renderSliced(job: Job, sr: number): Promise<RenderOut | null> {
  const gen = renderJob(job, sr);
  return new Promise((resolve) => {
    const step = () => {
      const t0 = performance.now();
      try {
        for (;;) {
          const r = gen.next();
          if (r.done) { resolve(r.value); return; }
          if (performance.now() - t0 > 6) break;
        }
      } catch { resolve(null); return; }
      setTimeout(step, 0);
    };
    step();
  });
}

function load(key: string, job: Job): Promise<Loop | null> {
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  const inflight = pending.get(key);
  if (inflight) return inflight;
  const ctx = audio.context();
  if (!ctx) return Promise.resolve(null);
  const sr = job.kind === 'slot' ? Math.min(ctx.sampleRate, PIANO_SR) : ctx.sampleRate;
  const w = getWorker();
  const viaWorker = (): Promise<Raw | null> => new Promise((resolve) => { waiters.set(key, resolve); w!.postMessage({ key, job, sr }); });
  const raw: Promise<Raw | null> = w ? viaWorker().then((r) => r ?? renderSliced(job, sr)) : renderSliced(job, sr);
  const p = raw.then((r) => {
    pending.delete(key);
    if (!r) return null;
    const buffer = ctx.createBuffer(2, r.left.length, sr);
    buffer.copyToChannel(r.left as Float32Array<ArrayBuffer>, 0);
    buffer.copyToChannel(r.right as Float32Array<ArrayBuffer>, 1);
    const gain = Math.min(1, Math.pow(10, MUSIC_RMS_DB / 20) / Math.max(1e-4, r.rms));
    const loop = { buffer, gain };
    cache.set(key, loop);
    // Custom songs can pile up while composing: keep the cache bounded.
    const customs = [...cache.keys()].filter((k) => k.startsWith('custom:'));
    if (customs.length > 12) cache.delete(customs[0]!);
    return loop;
  });
  pending.set(key, p);
  return p;
}

function fadeOut(node: { src: AudioBufferSourceNode; gain: GainNode } | null, secs = FADE): void {
  const ctx = audio.context();
  if (!node || !ctx) return;
  const t = ctx.currentTime;
  node.gain.gain.cancelScheduledValues(t);
  node.gain.gain.setValueAtTime(node.gain.gain.value, t);
  node.gain.gain.linearRampToValueAtTime(0, t + secs);
  try { node.src.stop(t + secs + 0.05); } catch { /* */ }
}

function startLoop(key: string, loop: Loop, out: AudioNode, fade = FADE): { key: string; src: AudioBufferSourceNode; gain: GainNode } | null {
  const ctx = audio.context();
  if (!ctx) return null;
  const src = ctx.createBufferSource();
  src.buffer = loop.buffer;
  src.loop = true;
  const gain = ctx.createGain();
  const t = ctx.currentTime;
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(loop.gain, t + fade);
  src.connect(gain).connect(out);
  src.start(t);
  return { key, src, gain };
}

let warmed = false;
function warmRest(): void {
  if (warmed) return;
  warmed = true;
  const ids = Object.keys(SLOTS).map(Number);
  void ids.reduce<Promise<unknown>>((p, id) => p.then(() => load(slotKey(id), { kind: 'slot', id })), Promise.resolve())
    .then(() => load('fanfare', { kind: 'fanfare' }));
}

function sync(): void {
  if (!wanted || !audio.context()) return;
  if (audio.muted) { fadeOut(current, 0.3); current = null; return; }
  if (current?.key === wanted.key) return;
  const { key, job } = wanted;
  void load(key, job).then((loop) => {
    const out = audio.musicBus();
    if (!loop || !out || wanted?.key !== key || current?.key === key || audio.muted) return;
    fadeOut(current);
    current = startLoop(key, loop, out);
    warmRest();
  });
}

/** The fanfare as a one-shot buffer (used by audio.jingle). */
export async function renderFanfare(): Promise<AudioBuffer | null> {
  const loop = await load('fanfare', { kind: 'fanfare' });
  return loop?.buffer ?? null;
}

export const music = {
  /** Play a slot (0 title/editor, 1–3 acts, 4 credits/end, 5+ zones). Safe to call repeatedly. */
  play(slot: number): void {
    const id = SLOTS[slot] ? slot : 0;
    wanted = { key: slotKey(id), job: { kind: 'slot', id } };
    sync();
  },
  /** Loop a level's own theme (rendered once and cached by its content). */
  playCustom(song: SongData): void {
    wanted = { key: songKey(song), job: { kind: 'custom', song } };
    sync();
  },
  /** Audition a song immediately; the current music dips until stopPreview(). */
  previewCustom(song: SongData): void {
    const key = songKey(song);
    void audio.unlock().then(() => load(key, { kind: 'custom', song })).then((loop) => {
      const out = audio.musicBus(), ctx = audio.context();
      if (!loop || !out || !ctx) return;
      fadeOut(preview, 0.15);
      preview = startLoop(key, loop, out, 0.15);
      if (current) { const t = ctx.currentTime; current.gain.gain.cancelScheduledValues(t); current.gain.gain.setTargetAtTime(0, t, 0.08); }
    });
  },
  stopPreview(): void {
    const ctx = audio.context();
    fadeOut(preview, 0.2);
    preview = null;
    if (ctx && current) {
      const loop = cache.get(current.key);
      const t = ctx.currentTime;
      current.gain.gain.cancelScheduledValues(t);
      current.gain.gain.setTargetAtTime(loop?.gain ?? 0.2, t, 0.3);
    }
  },
  stop(): void { wanted = null; fadeOut(current); current = null; },
  /** Re-sync after unlock or mute changes. */
  refresh(): void { sync(); },
  /** Names of the built-in slots (for menus and the editor). */
  slots(): Array<{ slot: number; name: string; source: string }> {
    return Object.entries(SLOTS).map(([k, s]) => ({ slot: Number(k), name: s.name, source: s.piece.source }));
  },
};

audio.onMute(() => music.refresh());
