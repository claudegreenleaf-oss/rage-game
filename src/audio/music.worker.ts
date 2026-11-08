// Renders music loops off the main thread.
import { renderNow } from './synth';
import { FANFARE, SONGS } from './songs';

self.onmessage = (e: MessageEvent<{ id: number | 'fanfare'; sr: number }>) => {
  const { id, sr } = e.data;
  const song = id === 'fanfare' ? FANFARE : SONGS[id];
  if (!song) return;
  const r = renderNow(song, sr);
  (self as unknown as Worker).postMessage({ id, left: r.left, right: r.right, rms: r.rms }, [r.left.buffer, r.right.buffer]);
};
