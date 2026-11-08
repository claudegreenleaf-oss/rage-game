// DOM panels for the editor, laid over the canvas and scaled with it.
// Left: palette tabs + tools. Right: inspector / events. Top: file, history, playtest and share.
import type { Action, LevelEvent, LevelObject, Pt, TileRect, Trigger, Zone } from '../sim/types';
import {
  ACTION_LABEL, ACTION_TARGET, EditorDoc, MAX_H, MAX_W, TRIGGER_LABEL, defaultAction, describeTrigger,
} from './model';
import { SELECT, TABS, TOOLS, type TabId, type Tool } from './tools';

export const GAME_W = 1280;
export const GAME_H = 720;
export const LEFT_W = 232;
export const RIGHT_W = 300;
export const TOP_H = 56;

export type Selection = { kind: 'object'; id: string } | { kind: 'zone'; id: string } | null;
export type PickRequest =
  | { type: 'point'; prompt: string; onPick: (p: Pt) => void; repeat?: boolean }
  | { type: 'rect'; prompt: string; onPick: (r: TileRect) => void };

export interface UiHost {
  doc: EditorDoc;
  tab: TabId;
  tool: Tool;
  selection: Selection;
  setTab(t: TabId): void;
  setTool(t: Tool): void;
  select(s: Selection): void;
  pick(req: PickRequest | null): void;
  playtest(): void;
  share(): void;
  exit(): void;
  openLevel(which: string): void;
  importFile(file: File): void;
  exportFile(): void;
  save(): void;
  shippedLevels: Array<{ id: string; name: string }>;
}

type Attrs = Record<string, string | number | boolean | ((e: Event) => void) | undefined>;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: Array<Node | string | null | undefined | false>): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (typeof v === 'function') el.addEventListener(k.replace(/^on/, ''), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of kids) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

const CSS = `
.ed-root{position:fixed;left:0;top:0;width:${GAME_W}px;height:${GAME_H}px;transform-origin:0 0;pointer-events:none;z-index:5;font-family:Fredoka,'Baloo 2',Nunito,system-ui,sans-serif;color:#2b2433;user-select:none}
.ed-root *{box-sizing:border-box}
.ed-panel{position:absolute;pointer-events:auto;background:#fbf3e4;border:3px solid #2b2433;box-shadow:0 5px 0 #2b2433}
.ed-top{left:8px;right:8px;top:8px;height:${TOP_H - 12}px;border-radius:14px;display:flex;align-items:center;gap:6px;padding:0 8px}
.ed-left{left:8px;top:${TOP_H + 4}px;bottom:12px;width:${LEFT_W - 16}px;border-radius:16px;display:flex;flex-direction:column;overflow:hidden}
.ed-right{right:8px;top:${TOP_H + 4}px;bottom:12px;width:${RIGHT_W - 16}px;border-radius:16px;display:flex;flex-direction:column;overflow:hidden}
.ed-btn{font:600 14px Fredoka,system-ui,sans-serif;border:2.5px solid #2b2433;border-radius:10px;padding:5px 10px;background:#fff8ec;color:#2b2433;cursor:pointer;box-shadow:0 3px 0 #2b2433;transition:transform .08s,box-shadow .08s,background .12s;white-space:nowrap}
.ed-btn:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 4px 0 #2b2433;background:#ffe9d3}
.ed-btn:active:not(:disabled){transform:translateY(2px);box-shadow:0 1px 0 #2b2433}
.ed-btn:disabled{opacity:.4;cursor:default}
.ed-btn.hot{background:#ffc9a3}.ed-btn.go{background:#a9e7b4}.ed-btn.rot{background:#cde3bf}
.ed-sep{width:2px;height:26px;background:#2b2433;opacity:.15;margin:0 2px}
.ed-name{font:700 17px Fredoka,system-ui,sans-serif;border:2.5px solid transparent;border-radius:10px;background:transparent;color:#2b2433;padding:3px 8px;width:190px}
.ed-name:hover,.ed-name:focus{border-color:#2b2433;background:#fff8ec;outline:none}
.ed-badge{font:700 12px Fredoka,system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase;padding:4px 9px;border-radius:999px;border:2.5px solid #2b2433}
.ed-badge.ok{background:#7fd38e}.ed-badge.no{background:#e9dfcf;opacity:.8}
.ed-tabs{display:flex;flex-wrap:wrap;gap:4px;padding:8px;border-bottom:3px solid #2b2433;background:#f3e6cf}
.ed-tab{flex:1 1 30%;font:600 13px Fredoka,system-ui,sans-serif;border:2.5px solid #2b2433;border-radius:9px;padding:4px 2px;background:#fff8ec;cursor:pointer;text-align:center}
.ed-tab.on{background:#2b2433;color:#fbf3e4}
.ed-tools{padding:8px;display:grid;grid-template-columns:1fr 1fr;gap:6px;overflow-y:auto}
.ed-tool{display:flex;flex-direction:column;align-items:center;gap:2px;padding:7px 4px 6px;border:2.5px solid #2b2433;border-radius:12px;background:#fff8ec;cursor:pointer;transition:transform .08s,background .12s;font:600 12px Fredoka,system-ui,sans-serif;text-align:center;line-height:1.1}
.ed-tool:hover{transform:translateY(-1px);background:#ffe9d3}
.ed-tool.on{background:#ffc9a3;box-shadow:inset 0 -3px 0 rgba(43,36,51,.25)}
.ed-tool .ic{font-size:21px;line-height:24px}
.ed-hint{margin:auto 8px 8px;padding:9px 10px;border-radius:12px;background:#c98b52;border:2.5px solid #2b2433;color:#2b2433;font:500 13px/1.3 Fredoka,system-ui,sans-serif;box-shadow:0 3px 0 #96602f}
.ed-extra{padding:0 8px 8px;display:flex;flex-direction:column;gap:6px}
.ed-scroll{overflow-y:auto;padding:10px;display:flex;flex-direction:column;gap:8px}
.ed-h{font:700 16px Fredoka,system-ui,sans-serif;margin:0;display:flex;align-items:center;gap:8px}
.ed-h small{font:500 12px Fredoka,system-ui,sans-serif;opacity:.6}
.ed-row{display:flex;align-items:center;gap:6px;font:500 13px Fredoka,system-ui,sans-serif}
.ed-row label{flex:0 0 78px;opacity:.75}
.ed-row input[type=number],.ed-row input[type=text],.ed-row select,.ed-in{flex:1;min-width:0;font:500 13px Fredoka,system-ui,sans-serif;border:2px solid #2b2433;border-radius:8px;padding:3px 6px;background:#fff8ec;color:#2b2433}
.ed-row input[type=checkbox]{width:17px;height:17px;accent-color:#2b2433}
.ed-card{border:2.5px solid #2b2433;border-radius:12px;background:#fff8ec;padding:8px;display:flex;flex-direction:column;gap:6px}
.ed-card.sel{background:#ffe9d3}
.ed-x{margin-left:auto;border:none;background:none;font:700 15px Fredoka,system-ui,sans-serif;cursor:pointer;color:#c93f4f;padding:0 4px}
.ed-mini{font:600 12px Fredoka,system-ui,sans-serif;border:2px solid #2b2433;border-radius:8px;padding:2px 7px;background:#fbf3e4;cursor:pointer}
.ed-mini:hover{background:#ffe9d3}
.ed-act{border-left:4px solid #c98b52;padding-left:7px;display:flex;flex-direction:column;gap:4px}
.ed-muted{opacity:.6;font:500 12.5px/1.35 Fredoka,system-ui,sans-serif}
.ed-pick{position:absolute;left:50%;top:${TOP_H + 10}px;transform:translateX(-50%);pointer-events:auto;background:#2b2433;color:#fbf3e4;border-radius:999px;padding:7px 16px;font:600 14px Fredoka,system-ui,sans-serif;display:flex;gap:10px;align-items:center;box-shadow:0 4px 14px rgba(0,0,0,.25)}
.ed-menu{position:absolute;pointer-events:auto;background:#fbf3e4;border:3px solid #2b2433;border-radius:12px;box-shadow:0 5px 0 #2b2433;padding:6px;display:flex;flex-direction:column;gap:3px;min-width:170px;z-index:3}
.ed-menu h4{margin:2px 6px 4px;font:700 13px Fredoka,system-ui,sans-serif;opacity:.7}
.ed-menu button{text-align:left;font:600 13px Fredoka,system-ui,sans-serif;border:none;background:none;border-radius:8px;padding:5px 8px;cursor:pointer;color:#2b2433}
.ed-menu button:hover{background:#ffc9a3}
.ed-toast{position:absolute;left:50%;bottom:26px;transform:translateX(-50%) translateY(10px);opacity:0;transition:all .25s;background:#2b2433;color:#fbf3e4;padding:9px 18px;border-radius:999px;font:600 14px Fredoka,system-ui,sans-serif;pointer-events:none}
.ed-toast.on{opacity:1;transform:translateX(-50%)}
.ed-open{position:absolute;pointer-events:auto;top:${TOP_H - 4}px;left:8px;background:#fbf3e4;border:3px solid #2b2433;border-radius:12px;box-shadow:0 5px 0 #2b2433;padding:6px;display:grid;grid-template-columns:1fr 1fr;gap:3px;width:330px;z-index:4}
.ed-open button{text-align:left;font:600 13px Fredoka,system-ui,sans-serif;border:none;background:none;border-radius:8px;padding:5px 8px;cursor:pointer}
.ed-open button:hover{background:#ffc9a3}
.ed-open .wide{grid-column:1/3}
`;

export class EditorUI {
  root: HTMLDivElement;
  private top: HTMLDivElement;
  private left: HTMLDivElement;
  private right: HTMLDivElement;
  private pickBar: HTMLDivElement | null = null;
  private menu: HTMLDivElement | null = null;
  private openMenu: HTMLDivElement | null = null;
  private toastEl: HTMLDivElement;
  private toastT = 0;
  private fileInput: HTMLInputElement;
  private onResize = () => this.layout();
  private unsub: () => void;

  constructor(private host: UiHost) {
    if (!document.getElementById('ed-css')) document.head.append(h('style', { id: 'ed-css' }, CSS));
    this.top = h('div', { class: 'ed-panel ed-top' });
    this.left = h('div', { class: 'ed-panel ed-left' });
    this.right = h('div', { class: 'ed-panel ed-right' });
    this.toastEl = h('div', { class: 'ed-toast' });
    this.fileInput = h('input', { type: 'file', accept: '.json,application/json', style: 'display:none', onchange: () => {
      const f = this.fileInput.files?.[0];
      if (f) host.importFile(f);
      this.fileInput.value = '';
    } });
    this.root = h('div', { class: 'ed-root' }, this.top, this.left, this.right, this.toastEl, this.fileInput);
    // Keep keystrokes in text fields away from the game.
    this.root.addEventListener('keydown', (e) => { if ((e.target as HTMLElement).matches('input,textarea,select')) e.stopPropagation(); });
    document.body.append(this.root);
    window.addEventListener('resize', this.onResize);
    this.layout();
    this.unsub = host.doc.onChange(() => this.refresh());
    this.refresh();
  }

  destroy(): void {
    this.unsub();
    window.removeEventListener('resize', this.onResize);
    this.root.remove();
  }

  setVisible(v: boolean): void { this.root.style.display = v ? '' : 'none'; if (v) this.layout(); }

  /** Match the canvas' on-screen box. */
  layout(): void {
    const canvas = document.querySelector('#game canvas') as HTMLCanvasElement | null;
    if (!canvas) return;
    const r = canvas.getBoundingClientRect();
    const s = r.width / GAME_W;
    this.root.style.transform = `translate(${r.left}px, ${r.top}px) scale(${s})`;
  }

  toast(msg: string): void {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('on');
    window.clearTimeout(this.toastT);
    this.toastT = window.setTimeout(() => this.toastEl.classList.remove('on'), 2200);
  }

  refresh(): void {
    this.renderTop();
    this.renderLeft();
    this.renderRight();
  }

  // ---------------------------------------------------------------------------

  private renderTop(): void {
    const { doc } = this.host;
    const l = doc.level;
    const name = h('input', { class: 'ed-name', value: l.name, maxlength: 32, title: 'Level name', onchange: (e) => {
      const v = (e.target as HTMLInputElement).value.trim() || 'Untitled';
      doc.edit((lv) => { lv.name = v; });
    } });
    const verified = !!l.verified;
    this.top.replaceChildren(
      h('button', { class: 'ed-btn', title: 'Back to the title screen (Esc)', onclick: () => this.host.exit() }, '← Title'),
      h('button', { class: 'ed-btn', title: 'New / open a level', onclick: () => this.toggleOpen() }, 'Open ▾'),
      name,
      h('span', { class: 'ed-sep' }),
      h('button', { class: 'ed-btn', disabled: !doc.canUndo, title: 'Undo (Ctrl+Z)', onclick: () => doc.undo() }, '↶'),
      h('button', { class: 'ed-btn', disabled: !doc.canRedo, title: 'Redo (Ctrl+Shift+Z)', onclick: () => doc.redo() }, '↷'),
      h('span', { class: 'ed-sep' }),
      h('button', { class: 'ed-btn', title: 'Save draft in this browser (Ctrl+S)', onclick: () => this.host.save() }, doc.dirty ? 'Save •' : 'Save'),
      h('button', { class: 'ed-btn', title: 'Import a level JSON file', onclick: () => this.fileInput.click() }, 'Import'),
      h('button', { class: 'ed-btn', title: 'Download as JSON', onclick: () => this.host.exportFile() }, 'Export'),
      h('span', { style: 'flex:1' }),
      h('span', { class: `ed-badge ${verified ? 'ok' : 'no'}`, title: verified ? 'You beat this exact level in playtest.' : 'Beat it in playtest to share it.' }, verified ? '✓ Verified' : 'Not verified'),
      h('button', { class: 'ed-btn go', title: 'Play it now (P)', onclick: () => this.host.playtest() }, '▶ Playtest'),
      h('button', { class: 'ed-btn hot', disabled: !verified, title: verified ? 'Copy a share link' : 'Beat it in playtest first', onclick: () => this.host.share() }, 'Share'),
    );
  }

  private toggleOpen(): void {
    if (this.openMenu) { this.openMenu.remove(); this.openMenu = null; return; }
    const close = () => { this.openMenu?.remove(); this.openMenu = null; };
    const item = (label: string, which: string, cls?: string) => h('button', { class: cls, onclick: () => { close(); this.host.openLevel(which); } }, label);
    this.openMenu = h('div', { class: 'ed-open' },
      item('✦ New blank level', 'new', 'wide'),
      item('↺ Last saved draft', 'draft', 'wide'),
      ...this.host.shippedLevels.map((s) => item(`${s.id} · ${s.name}`, s.id)),
    );
    this.root.append(this.openMenu);
  }

  private renderLeft(): void {
    const { host } = this;
    const tabs = h('div', { class: 'ed-tabs' }, ...TABS.map((t) =>
      h('div', { class: `ed-tab ${host.tab === t.id ? 'on' : ''}`, title: `${t.label} (${t.key})`, onclick: () => host.setTab(t.id) }, t.label)));
    const tools = [SELECT, ...TOOLS[host.tab]];
    const grid = h('div', { class: 'ed-tools' }, ...tools.map((t) =>
      h('div', { class: `ed-tool ${host.tool.id === t.id ? 'on' : ''}`, title: t.hint, onclick: () => host.setTool(t) },
        h('span', { class: 'ic' }, t.icon), t.label)));
    const extra = h('div', { class: 'ed-extra' });
    if (host.tab === 'objects' || host.tab === 'hazards') extra.append(...this.currentFields());
    const hint = h('div', { class: 'ed-hint' }, host.tool.hint, h('div', { class: 'ed-muted', style: 'margin-top:6px;opacity:.85' }, 'Left-drag paints · right-drag erases'));
    this.left.replaceChildren(tabs, grid, extra, hint);
  }

  private currentFields(): HTMLElement[] {
    const { doc } = this.host;
    const cur = doc.level.current ?? { dir: 1, speed: 0 };
    return [
      h('div', { class: 'ed-h', style: 'font-size:13px' }, 'Water current'),
      this.row('Direction', this.select(String(cur.dir), [['1', '→ right'], ['-1', '← left']], (v) => doc.edit((l) => { l.current = { dir: Number(v) as -1 | 1, speed: l.current?.speed ?? 2 }; }))),
      this.row('Speed t/s', this.num(cur.speed, (v) => doc.edit((l) => { l.current = { dir: l.current?.dir ?? 1, speed: Math.max(0, v) }; }), 0, 8, 0.1)),
    ];
  }

  private renderRight(): void {
    const { host } = this;
    const body = h('div', { class: 'ed-scroll' });
    const sel = host.selection;
    if (sel?.kind === 'object') {
      const o = host.doc.byId(sel.id);
      if (o) body.append(...this.inspectObject(o));
    } else if (sel?.kind === 'zone') {
      const z = host.doc.level.zones.find((x) => x.id === sel.id);
      if (z) body.append(...this.inspectZone(z));
    }
    if (!body.childElementCount) body.append(...this.inspectLevel());
    if (host.tab === 'events' || sel?.kind === 'zone') body.append(...this.eventsList());
    this.right.replaceChildren(body);
  }

  // --- field helpers ---------------------------------------------------------

  private row(label: string, ...ctl: Node[]): HTMLElement { return h('div', { class: 'ed-row' }, h('label', {}, label), ...ctl); }
  private num(v: number, on: (v: number) => void, min = -999, max = 999, step = 1): HTMLInputElement {
    return h('input', { type: 'number', value: v, min, max, step, onchange: (e) => {
      const n = Number((e.target as HTMLInputElement).value);
      if (Number.isFinite(n)) on(Math.min(max, Math.max(min, n)));
    } });
  }
  private text(v: string, on: (v: string) => void, ph = ''): HTMLInputElement {
    return h('input', { type: 'text', value: v, placeholder: ph, onchange: (e) => on((e.target as HTMLInputElement).value) });
  }
  private check(v: boolean, on: (v: boolean) => void): HTMLInputElement {
    return h('input', { type: 'checkbox', checked: v, onchange: (e) => on((e.target as HTMLInputElement).checked) });
  }
  private select(v: string, opts: Array<[string, string]>, on: (v: string) => void): HTMLSelectElement {
    const s = h('select', { onchange: (e) => on((e.target as HTMLSelectElement).value) }, ...opts.map(([val, lab]) => h('option', { value: val, selected: val === v }, lab)));
    return s;
  }
  private mini(label: string, on: () => void, title = ''): HTMLButtonElement { return h('button', { class: 'ed-mini', title, onclick: on }, label); }

  /** Edit one object by id (copy-safe across undo). */
  private set(id: string, fn: (o: LevelObject) => void): void {
    this.host.doc.edit((l) => { const o = l.objects.find((x) => x.id === id); if (o) fn(o); });
  }

  // --- inspectors -------------------------------------------------------------

  private inspectLevel(): HTMLElement[] {
    const { doc } = this.host;
    const l = doc.level;
    const errs = doc.validate();
    return [
      h('h3', { class: 'ed-h' }, 'Level', h('small', {}, `${l.width} × ${l.height}`)),
      this.row('Width', this.num(l.width, (v) => doc.resize(v, l.height), 6, MAX_W)),
      this.row('Height', this.num(l.height, (v) => doc.resize(l.width, v), 5, MAX_H)),
      this.row('Act mood', this.select(String(l.act ?? 1), [['1', 'Fresh Meat'], ['2', 'Rot'], ['3', 'Bare Bones']], (v) => doc.edit((x) => { x.act = Number(v); }))),
      h('div', { class: 'ed-muted' }, errs.length ? `⚠ ${errs.join(' · ')}` : 'Select anything on the map to edit it. In the Events tab, link triggers to actions.'),
      h('div', { class: 'ed-muted' }, 'Keys: 1–5 tabs · V select · P playtest · Del delete · Ctrl+Z / Ctrl+Shift+Z · Ctrl+S save'),
    ];
  }

  private header(o: LevelObject, title: string): HTMLElement {
    return h('h3', { class: 'ed-h' }, title, h('small', {}, o.id),
      h('button', { class: 'ed-x', title: 'Delete (Del)', onclick: () => { this.host.doc.edit(() => this.host.doc.removeObject(o.id)); this.host.select(null); } }, '✕'));
  }

  private pos(o: LevelObject): HTMLElement {
    const doc = this.host.doc;
    return this.row('Position', this.num(o.x, (v) => this.set(o.id, (x) => { x.x = v; }), 0, doc.level.width - 1, o.type === 'label' ? 0.5 : 1),
      this.num(o.y, (v) => this.set(o.id, (x) => { x.y = v; }), 0, doc.level.height - 1, o.type === 'label' || o.type === 'gate' ? 0.1 : 1));
  }

  private plateOptions(): Array<[string, string]> {
    return [['', '— none —'], ...this.host.doc.objectsOfType('plate').map((p) => [p.id, `${p.id} (needs ${p.need})`] as [string, string])];
  }

  private inspectObject(o: LevelObject): HTMLElement[] {
    const out: HTMLElement[] = [];
    const id = o.id;
    switch (o.type) {
      case 'spawn': out.push(this.header(o, 'Spawn'), this.pos(o)); break;
      case 'door':
        out.push(this.header(o, o.runaway ? 'Runaway door' : 'Exit door'), this.pos(o),
          this.row('Has legs', this.check(!!o.runaway, (v) => this.set(id, (x) => { if (x.type === 'door') { if (v) x.runaway = true; else delete x.runaway; } }))),
          h('div', { class: 'ed-muted' }, 'A runaway door flees within 3 tiles, hops over Pip when cornered, and is stopped by Fresh and Rot bodies.'));
        break;
      case 'popup': out.push(this.header(o, 'Pop-up spike'), this.pos(o), h('div', { class: 'ed-muted' }, 'Hidden until a "Pop spike" action fires. Use the Link tool.')); break;
      case 'dropper':
        out.push(this.header(o, 'Dropper'), this.pos(o),
          this.row('Pip passing', this.check((o.by ?? ['player']).includes('player'), (v) => this.set(id, (x) => { if (x.type === 'dropper') x.by = toggleIn(x.by ?? ['player'], 'player', v); }))),
          this.row('Door passing', this.check((o.by ?? []).includes('door'), (v) => this.set(id, (x) => { if (x.type === 'dropper') x.by = toggleIn(x.by ?? ['player'], 'door', v); }))));
        break;
      case 'crusher':
        out.push(this.header(o, 'Crusher'), this.pos(o),
          this.row('Size', this.num(o.w, (v) => this.set(id, (x) => { if (x.type === 'crusher') x.w = v; }), 1, 8), this.num(o.h, (v) => this.set(id, (x) => { if (x.type === 'crusher') x.h = v; }), 1, 4)),
          this.row('Every (ticks)', this.num(o.period ?? 0, (v) => this.set(id, (x) => { if (x.type === 'crusher') { if (v > 0) x.period = v; else delete x.period; } }), 0, 1200, 10)),
          this.row('Phase', this.num(o.phase ?? 0, (v) => this.set(id, (x) => { if (x.type === 'crusher') x.phase = v; }), 0, 1200, 5)),
          h('div', { class: 'ed-muted' }, 'Period 0 = only fires from events. It holds 1 s, then rises.'));
        break;
      case 'plate':
        out.push(this.header(o, 'Pressure plate'), this.pos(o),
          this.row('Width', this.num(o.w, (v) => this.set(id, (x) => { if (x.type === 'plate') x.w = v; }), 1, 6)),
          this.row('Needs weight', this.num(o.need, (v) => this.set(id, (x) => { if (x.type === 'plate') x.need = v; }), 1, 9)),
          h('div', { class: 'ed-muted' }, 'Pip 1 · Fresh 2 · Rot 1 · Skeleton 0. Weight passes down stacks.'));
        break;
      case 'gate':
        out.push(this.header(o, 'Gate'), this.pos(o),
          this.row('Height', this.num(o.h, (v) => this.set(id, (x) => { if (x.type === 'gate') x.h = v; }), 0.2, 16, 0.1)),
          this.row('Opened by', this.select(o.plate ?? '', this.plateOptions(), (v) => this.set(id, (x) => { if (x.type === 'gate') { if (v) x.plate = v; else delete x.plate; } }))),
          h('div', { class: 'ed-muted' }, 'Hangs from its top tile. With no plate it stays shut until a "Toggle gate" action.'));
        break;
      case 'platform':
        out.push(this.header(o, 'Moving platform'), this.pos(o),
          this.row('Width', this.num(o.w, (v) => this.set(id, (x) => { if (x.type === 'platform') x.w = v; }), 1, 8)),
          this.row('Speed t/s', this.num(o.speed, (v) => this.set(id, (x) => { if (x.type === 'platform') x.speed = v; }), 0.5, 12, 0.5)),
          this.row('Starts', this.select(o.start, [['always', 'always'], ['touch', 'on touch'], ['trigger', 'on trigger']], (v) => this.set(id, (x) => { if (x.type === 'platform') x.start = v as 'always'; }))),
          this.row('Loops', this.check(!!o.loop, (v) => this.set(id, (x) => { if (x.type === 'platform') { if (v) x.loop = true; else delete x.loop; } }))),
          this.row('Drop-through', this.check(!!o.oneWay, (v) => this.set(id, (x) => { if (x.type === 'platform') { if (v) x.oneWay = true; else delete x.oneWay; } }))),
          h('div', { class: 'ed-h', style: 'font-size:13px' }, 'Path', this.mini('+ point', () => this.host.pick({ type: 'point', prompt: 'Click tiles to add path points', repeat: true, onPick: (p) => this.set(id, (x) => { if (x.type === 'platform') x.path.push(p); }) })),
            this.mini('reset', () => this.set(id, (x) => { if (x.type === 'platform') x.path = [{ x: x.x, y: x.y }]; }))),
          ...o.path.map((p, i) => h('div', { class: 'ed-row' }, h('label', {}, i === 0 ? 'start' : `#${i}`), `${p.x}, ${p.y}`,
            i > 0 ? h('button', { class: 'ed-x', onclick: () => this.set(id, (x) => { if (x.type === 'platform') x.path.splice(i, 1); }) }, '✕') : null)));
        break;
      case 'laser':
        out.push(this.header(o, o.emitter ? 'Laser' : 'Laser beam'), this.pos(o),
          this.row('Direction', this.select(o.dir, [['down', '↓ down'], ['up', '↑ up'], ['left', '← left'], ['right', '→ right']], (v) => this.set(id, (x) => { if (x.type === 'laser') x.dir = v as 'down'; }))),
          this.row('Emitter block', this.check(o.emitter, (v) => this.set(id, (x) => { if (x.type === 'laser') x.emitter = v; }))),
          this.row('Length', this.num(o.len ?? 0, (v) => this.set(id, (x) => { if (x.type === 'laser') { if (v > 0) x.len = v; else delete x.len; } }), 0, 32)),
          this.row('Mode', this.select(o.mode, [['on', 'steady on'], ['off', 'off'], ['blink', 'blinking'], ['plate', 'off while plate pressed']], (v) => this.set(id, (x) => { if (x.type === 'laser') x.mode = v as 'on'; }))),
          ...(o.mode === 'blink' ? [this.row('On / off', this.num(o.on ?? 60, (v) => this.set(id, (x) => { if (x.type === 'laser') x.on = v; }), 1, 600, 5), this.num(o.off ?? 60, (v) => this.set(id, (x) => { if (x.type === 'laser') x.off = v; }), 1, 600, 5)),
            this.row('Phase', this.num(o.phase ?? 0, (v) => this.set(id, (x) => { if (x.type === 'laser') x.phase = v; }), 0, 600, 5))] : []),
          ...(o.mode === 'plate' ? [this.row('Plate', this.select(o.plate ?? '', this.plateOptions(), (v) => this.set(id, (x) => { if (x.type === 'laser') { if (v) x.plate = v; else delete x.plate; } })))] : []),
          this.row('Hidden', this.check(!!o.hidden, (v) => this.set(id, (x) => { if (x.type === 'laser') { if (v) x.hidden = true; else delete x.hidden; } }))),
          h('div', { class: 'ed-muted' }, 'Length 0 = until it hits a wall. Hidden: invisible until something touches it, then it fires for good.'));
        break;
      case 'sign': {
        const entries = Object.entries(o.text).sort((a, b) => Number(a[0]) - Number(b[0]));
        out.push(this.header(o, 'Sign'), this.pos(o), h('div', { class: 'ed-muted' }, 'Text by death count: the highest count reached wins. Keep lines short (≤ 40 chars).'),
          ...entries.map(([k, v]) => h('div', { class: 'ed-row' },
            h('input', { type: 'number', class: 'ed-in', style: 'flex:0 0 52px', value: k, min: 0, title: 'From this many deaths', onchange: (e) => {
              const nk = String(Math.max(0, Math.round(Number((e.target as HTMLInputElement).value))));
              this.set(id, (x) => { if (x.type === 'sign' && nk !== k) { x.text[nk] = x.text[k]!; delete x.text[k]; } });
            } }),
            this.text(v, (t) => this.set(id, (x) => { if (x.type === 'sign') x.text[k] = t; })),
            entries.length > 1 ? h('button', { class: 'ed-x', onclick: () => this.set(id, (x) => { if (x.type === 'sign') delete x.text[k]; }) }, '✕') : null)),
          h('div', { class: 'ed-row' }, this.mini('+ line after more deaths', () => this.set(id, (x) => {
            if (x.type !== 'sign') return;
            const next = Math.max(...Object.keys(x.text).map(Number)) + 1;
            x.text[String(next)] = 'Again? Bold.';
          }))));
        break;
      }
      case 'label':
        out.push(this.header(o, 'Text label'), this.pos(o),
          this.row('Text', this.text(o.text, (v) => this.set(id, (x) => { if (x.type === 'label') x.text = v; }))),
          this.row('Size', this.num(o.size ?? 1, (v) => this.set(id, (x) => { if (x.type === 'label') x.size = v; }), 0.5, 3, 0.1)));
        break;
    }
    out.push(...this.linksFor(o.id));
    return out;
  }

  private inspectZone(z: Zone): HTMLElement[] {
    const { doc } = this.host;
    const setZ = (fn: (zz: Zone) => void) => doc.edit((l) => { const zz = l.zones.find((q) => q.id === z.id); if (zz) fn(zz); });
    return [
      h('h3', { class: 'ed-h' }, 'Trigger zone', h('small', {}, z.id),
        h('button', { class: 'ed-x', onclick: () => { doc.edit(() => doc.removeZone(z.id)); this.host.select(null); } }, '✕')),
      this.row('Position', this.num(z.x, (v) => setZ((q) => { q.x = v; }), 0, doc.level.width - 1), this.num(z.y, (v) => setZ((q) => { q.y = v; }), 0, doc.level.height - 1)),
      this.row('Size', this.num(z.w, (v) => setZ((q) => { q.w = v; }), 1, MAX_W), this.num(z.h, (v) => setZ((q) => { q.h = v; }), 1, MAX_H)),
      h('div', { class: 'ed-muted' }, 'Use the Link tool: click this zone, then click what should happen.'),
    ];
  }

  /** Events this object takes part in. */
  private linksFor(id: string): HTMLElement[] {
    const evs = this.host.doc.level.events.filter((e) => JSON.stringify(e).includes(`"${id}"`));
    if (!evs.length) return [];
    return [h('div', { class: 'ed-h', style: 'font-size:13px;margin-top:4px' }, 'Linked events'), ...evs.map((e) => h('div', { class: 'ed-muted' }, `When ${describeTrigger(e.trigger)} → ${e.actions.map((a) => ACTION_LABEL[a.type]).join(', ')}`))];
  }

  // --- events -------------------------------------------------------------------

  private eventsList(): HTMLElement[] {
    const { doc } = this.host;
    const evs = doc.level.events;
    const out: HTMLElement[] = [h('h3', { class: 'ed-h', style: 'margin-top:6px' }, 'Events', h('small', {}, `${evs.length}`),
      h('span', { style: 'margin-left:auto' }), this.mini('+ event', () => doc.edit((l) => { l.events.push({ trigger: { type: 'timer', ticks: 60 }, actions: [{ type: 'shake', strength: 6 }], once: true }); })))];
    if (!evs.length) out.push(h('div', { class: 'ed-muted' }, 'No events yet. Pick the Link tool, click a zone or plate, then click a target.'));
    evs.forEach((ev, i) => out.push(this.eventCard(ev, i)));
    return out;
  }

  private editEvent(i: number, fn: (e: LevelEvent) => void): void {
    this.host.doc.edit((l) => { const e = l.events[i]; if (e) fn(e); });
  }

  private eventCard(ev: LevelEvent, i: number): HTMLElement {
    const { doc } = this.host;
    const t = ev.trigger;
    const zones: Array<[string, string]> = doc.level.zones.map((z) => [z.id, z.id]);
    const objs: Array<[string, string]> = [...doc.level.objects.filter((o) => o.type !== 'spawn' && o.type !== 'label').map((o) => [o.id, `${o.id} (${o.type})`] as [string, string]), ['@raft', 'any raft'], ['@corpse', 'any body']];
    const plates = doc.objectsOfType('plate').map((p) => [p.id, p.id] as [string, string]);
    const trigTypes = Object.entries(TRIGGER_LABEL) as Array<[Trigger['type'], string]>;
    const changeType = (type: Trigger['type']) => this.editEvent(i, (e) => {
      switch (type) {
        case 'playerEnters': case 'corpseEnters': e.trigger = { type, zone: zones[0]?.[0] ?? '' }; break;
        case 'plateDown': case 'plateUp': e.trigger = { type, plate: plates[0]?.[0] ?? '' }; break;
        case 'timer': e.trigger = { type, ticks: 60 }; break;
        case 'deathCountAtLeast': e.trigger = { type, n: 1 }; break;
        case 'playerOn': e.trigger = { type, target: objs[0]?.[0] ?? '@corpse' }; break;
      }
    });
    let param: HTMLElement;
    switch (t.type) {
      case 'playerEnters': case 'corpseEnters': param = this.select(t.zone, zones.length ? zones : [['', '(draw a zone)']], (v) => this.editEvent(i, (e) => { if ('zone' in e.trigger) e.trigger.zone = v; })); break;
      case 'plateDown': case 'plateUp': param = this.select(t.plate, plates.length ? plates : [['', '(add a plate)']], (v) => this.editEvent(i, (e) => { if ('plate' in e.trigger) e.trigger.plate = v; })); break;
      case 'timer': param = this.num(t.ticks, (v) => this.editEvent(i, (e) => { if (e.trigger.type === 'timer') e.trigger.ticks = v; }), 0, 36000, 10); break;
      case 'deathCountAtLeast': param = this.num(t.n, (v) => this.editEvent(i, (e) => { if (e.trigger.type === 'deathCountAtLeast') e.trigger.n = v; }), 0, 999); break;
      case 'playerOn': param = this.select(t.target, objs, (v) => this.editEvent(i, (e) => { if (e.trigger.type === 'playerOn') e.trigger.target = v; })); break;
    }
    const actTypes = Object.entries(ACTION_LABEL) as Array<[Action['type'], string]>;
    return h('div', { class: 'ed-card' },
      h('div', { class: 'ed-row' }, h('b', {}, 'When'), this.select(t.type, trigTypes, (v) => changeType(v as Trigger['type'])),
        h('button', { class: 'ed-x', title: 'Delete event', onclick: () => doc.edit((l) => { l.events.splice(i, 1); }) }, '✕')),
      h('div', { class: 'ed-row' }, h('label', {}, ''), param),
      h('div', { class: 'ed-row' }, h('label', {}, 'Once per life'), this.check(!!ev.once, (v) => this.editEvent(i, (e) => { e.once = v; }))),
      ...ev.actions.map((a, j) => this.actionRow(a, i, j)),
      h('div', { class: 'ed-row' }, h('label', {}, ''), this.select('', [['', '+ add action…'], ...actTypes], (v) => {
        if (!v) return;
        const type = v as Action['type'];
        const tt = ACTION_TARGET[type];
        const target = tt ? doc.objectsOfType(tt)[0]?.id : undefined;
        this.editEvent(i, (e) => { e.actions.push(defaultAction(type, target)); });
      })));
  }

  private actionRow(a: Action, i: number, j: number): HTMLElement {
    const { doc } = this.host;
    const edit = (fn: (x: Action) => void) => this.editEvent(i, (e) => { const x = e.actions[j]; if (x) fn(x); });
    const rows: HTMLElement[] = [h('div', { class: 'ed-row' }, h('b', {}, ACTION_LABEL[a.type]),
      h('span', { style: 'margin-left:auto;opacity:.6' }, 'delay'), h('input', { type: 'number', class: 'ed-in', style: 'flex:0 0 54px', value: a.delay ?? 0, min: 0, step: 5, title: 'Ticks before it happens (60 = 1 s)', onchange: (e) => edit((x) => { const n = Number((e.target as HTMLInputElement).value); if (n > 0) x.delay = n; else delete x.delay; }) }),
      h('button', { class: 'ed-x', title: 'Remove action', onclick: () => this.editEvent(i, (e) => { e.actions.splice(j, 1); }) }, '✕'))];
    const tt = ACTION_TARGET[a.type];
    if (tt && 'target' in a) {
      const opts = doc.objectsOfType(tt).map((o) => [o.id, o.id] as [string, string]);
      rows.push(this.row('Target', this.select(a.target, opts.length ? opts : [['', `(no ${tt})`]], (v) => edit((x) => { if ('target' in x) x.target = v; }))));
    }
    if ('rect' in a) {
      const r = a.rect;
      rows.push(this.row('Tiles', h('span', {}, `${r.w}×${r.h} at ${r.x},${r.y}`), this.mini('pick', () => this.host.pick({ type: 'rect', prompt: 'Drag over the tiles', onPick: (nr) => edit((x) => { if ('rect' in x) x.rect = nr; }) }))));
    }
    switch (a.type) {
      case 'addTiles': rows.push(this.row('Tile', this.select(a.tile ?? '#', [['#', 'solid'], ['=', 'troll'], ['^', 'floor spikes'], ['~', 'water']], (v) => edit((x) => { if (x.type === 'addTiles') x.tile = v as '#'; })))); break;
      case 'moveTiles': case 'moveDoor':
        rows.push(this.row(a.type === 'moveTiles' ? 'Offsets' : 'Path', this.text(a.path.map((p) => `${p.x},${p.y}`).join('; '), (v) => edit((x) => { if (x.type === 'moveTiles' || x.type === 'moveDoor') x.path = parsePath(v); }), 'x,y; x,y')),
          this.row('Speed t/s', this.num(a.speed, (v) => edit((x) => { if (x.type === 'moveTiles' || x.type === 'moveDoor') x.speed = v; }), 0.5, 16, 0.5)));
        break;
      case 'setCurrent':
        rows.push(this.row('Direction', this.select(String(a.dir), [['1', '→'], ['-1', '←']], (v) => edit((x) => { if (x.type === 'setCurrent') x.dir = Number(v) as 1; }))),
          this.row('Speed t/s', this.num(a.speed, (v) => edit((x) => { if (x.type === 'setCurrent') x.speed = v; }), 0, 8, 0.1)));
        break;
      case 'laser': rows.push(this.row('Mode', this.select(a.mode, [['on', 'on'], ['off', 'off'], ['blink', 'blink']], (v) => edit((x) => { if (x.type === 'laser') x.mode = v as 'on'; })))); break;
      case 'sign': rows.push(this.row('Text', this.text(a.text, (v) => edit((x) => { if (x.type === 'sign') x.text = v; })))); break;
      case 'shake': rows.push(this.row('Strength', this.num(a.strength, (v) => edit((x) => { if (x.type === 'shake') x.strength = v; }), 1, 30))); break;
      case 'sfx': rows.push(this.row('Sound', this.select(a.name, SFX_NAMES.map((n) => [n, n] as [string, string]), (v) => edit((x) => { if (x.type === 'sfx') x.name = v; })))); break;
      default: break;
    }
    return h('div', { class: 'ed-act' }, ...rows);
  }

  // --- pick bar & action menu --------------------------------------------------

  showPick(req: PickRequest | null): void {
    this.pickBar?.remove();
    this.pickBar = null;
    if (!req) return;
    this.pickBar = h('div', { class: 'ed-pick' }, req.prompt, h('button', { class: 'ed-mini', onclick: () => this.host.pick(null) }, req.type === 'point' && req.repeat ? 'Done' : 'Cancel'));
    this.root.append(this.pickBar);
  }

  /** Small menu at a game-space point. */
  showMenu(x: number, y: number, title: string, items: Array<{ label: string; run: () => void }>): void {
    this.closeMenu();
    const m = h('div', { class: 'ed-menu' }, h('h4', {}, title), ...items.map((it) => h('button', { onclick: () => { this.closeMenu(); it.run(); } }, it.label)));
    m.style.left = `${Math.min(x, GAME_W - 200)}px`;
    m.style.top = `${Math.min(y, GAME_H - 40 - items.length * 30)}px`;
    this.menu = m;
    this.root.append(m);
  }

  closeMenu(): boolean {
    const had = !!this.menu || !!this.openMenu;
    this.menu?.remove(); this.menu = null;
    this.openMenu?.remove(); this.openMenu = null;
    return had;
  }
}

export const SFX_NAMES = ['jingle', 'gate', 'shing', 'slam', 'zap', 'tock', 'poof', 'splash', 'rumble', 'scurry', 'click', 'blorp', 'clack'];

function toggleIn<T>(arr: T[], v: T, on: boolean): T[] {
  const s = new Set(arr);
  if (on) s.add(v); else s.delete(v);
  return [...s];
}

function parsePath(s: string): Pt[] {
  return s.split(/[;|]/).map((p) => p.trim()).filter(Boolean).map((p) => {
    const [x, y] = p.split(/[ ,]+/).map(Number);
    return { x: Number.isFinite(x) ? x! : 0, y: Number.isFinite(y) ? y! : 0 };
  });
}
