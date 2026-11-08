// Share codes: lz-string compressed level JSON, carried in a URL hash (#lvl=...).
import LZString from 'lz-string';
import type { LevelData } from '../sim/types';
import { normalizeLevel, validateLevel } from '../sim/level';

export function encodeLevel(level: LevelData): string {
  return LZString.compressToEncodedURIComponent(JSON.stringify(level));
}

export function shareUrl(level: LevelData): string {
  const base = `${location.origin}${location.pathname}`;
  return `${base}#lvl=${encodeLevel(level)}`;
}

/** Accepts a bare code, `#lvl=...`, or a full share URL. Returns null if it isn't a valid level. */
export function decodeLevel(input: string): LevelData | null {
  let code = input.trim();
  const at = code.indexOf('lvl=');
  if (at >= 0) code = code.slice(at + 4);
  code = code.replace(/[\s#]/g, '');
  if (!code) return null;
  try {
    const json = LZString.decompressFromEncodedURIComponent(code);
    if (!json) return null;
    const raw = JSON.parse(json) as unknown;
    if (!validateLevel(raw).ok) return null;
    return normalizeLevel(raw as LevelData);
  } catch {
    return null;
  }
}
