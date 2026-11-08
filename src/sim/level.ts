import { TILE_GLYPHS, type LevelData, type LevelObject, type TileGlyph } from './types';

/** Terrain glyphs that are solid. */
export const isSolidGlyph = (g: string | undefined): boolean => g === '#' || g === '=' || g === '}' || g === '{' || g === '%';

/** FNV-1a 32-bit hash of a string, as 8 hex chars. */
export function hashString(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Stable JSON (sorted keys) so the hash doesn't depend on key order. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(canonicalJson).join(',') + ']';
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return '{' + Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + canonicalJson(o[k])).join(',') + '}';
  }
  return JSON.stringify(v);
}

/** Hash of the gameplay-relevant level content (ignores the `verified` flag). */
export function levelHash(level: LevelData): string {
  const { verified: _v, ...rest } = level;
  return hashString(canonicalJson(rest));
}

export function cloneLevel(level: LevelData): LevelData {
  return JSON.parse(JSON.stringify(level)) as LevelData;
}

export function findObject<T extends LevelObject['type']>(level: LevelData, type: T): Extract<LevelObject, { type: T }> | undefined {
  return level.objects.find((o) => o.type === type) as Extract<LevelObject, { type: T }> | undefined;
}

export interface ValidationResult { ok: boolean; errors: string[] }

/** Structural validation for levels coming from files, share codes or the editor. */
export function validateLevel(raw: unknown): ValidationResult {
  const errors: string[] = [];
  const l = raw as Partial<LevelData>;
  if (!l || typeof l !== 'object') return { ok: false, errors: ['not an object'] };
  const big = l.kind === 'zone';
  const maxW = big ? 240 : 32, maxH = big ? 120 : 18;
  if (typeof l.width !== 'number' || l.width < 4 || l.width > maxW) errors.push(`width must be 4..${maxW}`);
  if (typeof l.height !== 'number' || l.height < 4 || l.height > maxH) errors.push(`height must be 4..${maxH}`);
  if (!Array.isArray(l.tiles) || l.tiles.length !== l.height) errors.push('tiles must have `height` rows');
  else
    l.tiles.forEach((row, i) => {
      if (typeof row !== 'string' || row.length !== l.width) errors.push(`row ${i} must have ${l.width} tiles`);
      else for (const ch of row) if (!TILE_GLYPHS.includes(ch as TileGlyph)) errors.push(`row ${i}: bad glyph '${ch}'`);
    });
  if (!Array.isArray(l.objects)) errors.push('objects missing');
  else {
    if (!l.objects.some((o) => o.type === 'spawn')) errors.push('needs a spawn');
    if (!l.objects.some((o) => o.type === 'door')) errors.push('needs a door');
    const ids = new Set<string>();
    for (const o of l.objects) {
      if (!o || typeof o.id !== 'string') errors.push('object without id');
      else if (ids.has(o.id)) errors.push(`duplicate id ${o.id}`);
      else ids.add(o.id);
    }
  }
  if (!Array.isArray(l.zones)) errors.push('zones missing');
  if (!Array.isArray(l.events)) errors.push('events missing');
  return { ok: errors.length === 0, errors };
}

/** Fills defaults so older/hand-written files load. */
export function normalizeLevel(l: LevelData): LevelData {
  return {
    ...l,
    version: 1,
    zones: l.zones ?? [],
    events: l.events ?? [],
    objects: l.objects ?? [],
  };
}
