// Render jobs for music: a Satie slot on the felt piano, the win fanfare, or a level-editor song.
// Pure (no DOM): used by the music Worker, the main-thread fallback, and offline checks.
import type { SongData } from '../sim/types';
import { renderPiano, reverb } from './piano';
import { renderSong } from './synth';
import { FANFARE, SLOTS, customToSong, pianoNotes } from './songs';

export type Job = { kind: 'slot'; id: number } | { kind: 'fanfare' } | { kind: 'custom'; song: SongData };
export interface RenderOut { left: Float32Array; right: Float32Array; rms: number; peak: number }

function finish(left: Float32Array, right: Float32Array): RenderOut {
  let peak = 0;
  for (let i = 0; i < left.length; i++) peak = Math.max(peak, Math.abs(left[i]!), Math.abs(right[i]!));
  const k = peak > 0 ? 0.89 / peak : 1;
  let sum = 0;
  for (let i = 0; i < left.length; i++) { left[i]! *= k; right[i]! *= k; sum += left[i]! * left[i]! + right[i]! * right[i]!; }
  return { left, right, rms: Math.sqrt(sum / (2 * Math.max(1, left.length))), peak: 0.89 };
}

export function* renderJob(job: Job, sr: number): Generator<void, RenderOut | null> {
  if (job.kind === 'slot') {
    const slot = SLOTS[job.id];
    if (!slot) return null;
    const { notes, seconds } = pianoNotes(slot);
    const total = Math.round(seconds * sr);
    const { left, right } = yield* renderPiano(notes, sr, total, slot.opts);
    yield* reverb(left, right, sr, slot.opts.wet ?? 0.24, slot.opts.rt60 ?? 2.3);
    return finish(left, right);
  }
  const song = job.kind === 'fanfare' ? FANFARE : customToSong(job.song);
  const r = yield* renderSong(song, sr);
  yield* reverb(r.left, r.right, sr, job.kind === 'fanfare' ? 0.14 : 0.18, 1.6);
  return finish(r.left, r.right);
}

/** Run a job to completion synchronously. */
export function renderJobNow(job: Job, sr: number): RenderOut | null {
  const g = renderJob(job, sr);
  for (;;) { const r = g.next(); if (r.done) return r.value; }
}
