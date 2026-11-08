// Local progress: unlocked levels, best deaths, total deaths, settings.
// Every storage access is guarded; the game runs fine with storage unavailable.
const KEY = 'dietrying.v1';

export interface Progress {
  unlocked: number; // highest unlocked level index (0-based)
  best: Record<string, number>;
  beaten: Record<string, boolean>;
  totalDeaths: number;
  settings: { muted: boolean };
}

const fresh = (): Progress => ({ unlocked: 0, best: {}, beaten: {}, totalDeaths: 0, settings: { muted: false } });

let state: Progress = load();

function load(): Progress {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return fresh();
    const p = JSON.parse(raw) as Partial<Progress>;
    return { ...fresh(), ...p, settings: { ...fresh().settings, ...(p.settings ?? {}) } };
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
  editorUnlocked(): boolean {
    return !!state.beaten['L04'] || devEditor();
  },
  get muted(): boolean { return state.settings.muted; },
  setMuted(m: boolean): void { state.settings.muted = m; save(); },
  reset(): void { state = fresh(); save(); },
};

function query(): URLSearchParams {
  try { return new URLSearchParams(globalThis.location?.search ?? ''); } catch { return new URLSearchParams(); }
}
function devEditor(): boolean { return query().has('editor'); }
function devUnlock(): boolean { return query().has('unlock'); }
