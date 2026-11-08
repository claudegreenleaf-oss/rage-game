// Renders music off the main thread.
import { renderJobNow, type Job } from './render';

self.onmessage = (e: MessageEvent<{ key: string; job: Job; sr: number }>) => {
  const { key, job, sr } = e.data;
  let r = null;
  try { r = renderJobNow(job, sr); } catch { r = null; }
  if (!r) { (self as unknown as Worker).postMessage({ key, failed: true }); return; }
  (self as unknown as Worker).postMessage({ key, left: r.left, right: r.right, rms: r.rms }, [r.left.buffer, r.right.buffer]);
};
