// Local progress: unlocked levels, best deaths, total deaths, settings.
// Every storage access is guarded; the game runs fine with storage unavailable.
const KEY = 'dietrying.v1';

export interface Progress {
  unlocked: number; // highest unlocked level index (0-based)
  best: Record<string, number>;
  beaten: Record<string, boolean>;
  totalDeaths: number;
  settings: { muted: boolean; musicVolume: number; sfxVolume: number };
  /** The connected-world run (null until a new game starts). */
  world: WorldSave | null;
  /** HUD tips already shown (each appears once per save). */
  tips: string[];
}

/** Mirrors the sim's CampaignSave (kept structural so progress.ts has no sim dependency). */
export interface WorldSave { room: string; collected: string[]; cleared: string[]; visited: string[]; deaths: number }

const fresh = (): Progress => ({ unlocked: 0, best: {}, beaten: {}, totalDeaths: 0, settings: { muted: false, musicVolume: 0.8, sfxVolume: 1 }, world: null, tips: [] });

let state: Progress = load();

function load(): Progress {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return fresh();
    const p = JSON.parse(raw) as Partial<Progress>;
    return { ...fresh(), ...p, tips: Array.isArray(p.tips) ? p.tips : [], world: p.world ?? null, settings: { ...fresh().settings, ...(p.settings ?? {}) } };
  } catch {
    return fresh();
  }
}

function save(): void {
  try { globalThis.localStorage?.setItem(KEY, JSON.stringify(state)); } catch { /* storage unavailable */ }
}

export const progress = {
  get(): Readonly<Progress> { return state; },
  isUnlocked(index: number): boolean { return index <= state.unlocked || devUnlock(); },
  addDeath(): void { state.totalDeaths++; save(); },
  recordWin(id: string, index: number, deaths: number): { newBest: boolean } {
    const prev = state.best[id];
    const newBest = prev === undefined || deaths < prev;
    if (newBest) state.best[id] = deaths;
    state.beaten[id] = true;
    state.unlocked = Math.max(state.unlocked, index + 1);
    save();
    return { newBest };
  },
  /** The editor is open to everyone. */
  editorUnlocked(): boolean {
    return true;
  },
  /** The saved world run, if any. */
  worldSave(): WorldSave | null { return state.world; },
  setWorldSave(s: WorldSave | null): void { state.world = s; if (!s) state.tips = []; save(); },
  /** True the first time a tip is asked for in this save; false afterwards. */
  tipOnce(id: string): boolean {
    if (state.tips.includes(id)) return false;
    state.tips = [...state.tips, id];
    save();
    return true;
  },
  get muted(): boolean { return state.settings.muted; },
  setMuted(m: boolean): void { state.settings.muted = m; save(); },
  get musicVolume(): number { return state.settings.musicVolume; },
  get sfxVolume(): number { return state.settings.sfxVolume; },
  setVolumes(v: { music?: number; sfx?: number }): void {
    if (v.music !== undefined) state.settings.musicVolume = Math.max(0, Math.min(1, v.music));
    if (v.sfx !== undefined) state.settings.sfxVolume = Math.max(0, Math.min(1, v.sfx));
    save();
  },
  reset(): void { state = fresh(); save(); },
};

function query(): URLSearchParams {
  try { return new URLSearchParams(globalThis.location?.search ?? ''); } catch { return new URLSearchParams(); }
}
function devUnlock(): boolean { return query().has('unlock'); }
