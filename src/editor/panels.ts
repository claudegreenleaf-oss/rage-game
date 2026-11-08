// DOM interface for the editor, laid over the canvas and scaled with it (design size 1280×720).
// Top bar · tool rail · palette (left) · inspector / layers / events / level tabs (right) · status bar ·
// minimap · studios (sound designer, music composer, image importer) · command palette · templates · tips.
import type { Action, Condition, Exit, GadgetEffect, GadgetObj, LevelEvent, LevelObject, LevelVar, PixelArt, Pt, SongData, TileRect, Trigger, Zone } from '../sim/types';
import {
  EditorDoc, LAYERS, MAX_H, MAX_W, MIN_H, MIN_W, SHARE_WARN_CHARS, kindOf, type Kind, type LayerId,
} from './model';
import {
  ACTIONS, CAUSES, CONDITIONS, OPS, TILES, TRIGGERS, actionSpec, condSpec, describeCond, describeEvent, eventMentions, fitsObj,
  grouped, makeAction, makeCond, makeTrigger, nameOf, setField, triggerRefs, triggerSpec, triggersFor, type Field, type Spec,
} from './logic';
import { GADGETS, TOOLS, itemsFor, type Item, type ToolId } from './tools';
import { decorUrl } from './decor';
import { INSTRUMENTS, DRUM_NAMES, TEMPLATES, isBlack, noteAt, noteCount, noteName, normalizeSong, previewNote, previewSong, stopPreview, toggleNote } from './song';
import { PARAMS, PRESETS, baseParams, compact, fill, mutate, playParams, randomize, soundList } from './sfxlab';
import { MAX_COLORS, artCanvas, loadImage, makeArt, quantize, sampleImage } from './pixelate';
import { encodeLevel } from './share';

export const GAME_W = 1280;
export const GAME_H = 720;
export const TOP_H = 46;
export const RAIL_W = 46;
export const PALETTE_W = 200;
export const LEFT_W = 8 + RAIL_W + 6 + PALETTE_W + 6;
export const RIGHT_W = 296;
export const BOTTOM_H = 30;

export type Selection =
  | { kind: 'object'; id: string }
  | { kind: 'zone'; id: string }
  | { kind: 'exit'; id: string }
  | { kind: 'image'; id: string }
  | null;

export type PickRequest =
  | { type: 'point'; prompt: string; onPick: (p: Pt) => void; repeat?: boolean }
  | { type: 'rect'; prompt: string; onPick: (r: TileRect) => void }
  /** Click an object on the map. Only objects `accept` likes can be picked (they glow). */
  | { type: 'object'; prompt: string; accept: (o: LevelObject) => boolean; onPick: (id: string) => void }
  | { type: 'zone'; prompt: string; onPick: (id: string) => void };

export interface EdState {
  layer: LayerId;
  tool: ToolId;
  item: Record<LayerId, Item | null>;
  brush: number;
  visible: Record<LayerId, boolean>;
  locked: Record<LayerId, boolean>;
  opacity: Record<LayerId, number>;
  grid: boolean;
  /** Show a dark room the way players see it (otherwise the editor lights it so you can work). */
  previewDark: boolean;
  selection: Selection;
  marquee: TileRect | null;
  hasClip: boolean;
  rightTab: 'inspect' | 'layers' | 'events' | 'level';
  search: string;
  /** Event under the mouse in the events list: its wiring is drawn bold on the map. */
  focusEvent: number | null;
}

export interface UiHost {
  doc: EditorDoc;
  st: EdState;
  shippedLevels: Array<{ id: string; name: string; act?: number; kind?: string }>;
  setLayer(l: LayerId): void;
  setTool(t: ToolId): void;
  setItem(i: Item): void;
  setBrush(n: number): void;
  select(s: Selection): void;
  pick(req: PickRequest | null): void;
  playtest(fromCursor?: boolean): void;
  share(): void;
  exit(): void;
  newLevel(kind: Kind, w?: number, h?: number): void;
  /** Start the Link tool. */
  startLink(): void;
  openLevel(id: string): void;
  importFile(f: File): void;
  exportFile(): void;
  save(): void;
  zoomBy(f: number): void;
  fit(): void;
  zoomPct(): number;
  centerOn(x: number, y: number): void;
  copy(): void;
  cut(): void;
  paste(): void;
  flip(axis: 'h' | 'v'): void;
  deleteSelection(): void;
  addImage(art: PixelArt): void;
  viewRect(): TileRect;
  toggleGrid(): void;
}

type Attrs = Record<string, string | number | boolean | ((e: Event) => void) | undefined>;
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: Array<Node | string | null | undefined | false>): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (typeof v === 'function') el.addEventListener(k.replace(/^on/, ''), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k === 'style') el.setAttribute('style', String(v));
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of kids) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

const INK = '#1c1a24', PANEL = '#f4ecdc', PAPER = '#fffaf0', WOOD = '#c98b52', MINT = '#7fd38e', PEACH = '#ffc9a3', SCREEN = '#5bf0a0';
const FONT_UI = `"Pixelify Sans", "Silkscreen", ui-monospace, monospace`;
/** Small text, numbers and fields: a crisp system font (pixel fonts blur digits at small sizes). */
const FONT_BODY = `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`;

const CSS = `
.ed-root{position:fixed;left:0;top:0;width:${GAME_W}px;height:${GAME_H}px;transform-origin:0 0;pointer-events:none;z-index:5;font:500 12.5px/1.3 ${FONT_BODY};color:${INK};user-select:none}
.ed-root *{box-sizing:border-box}
.ed-panel{position:absolute;pointer-events:auto;background:${PANEL};border:2px solid ${INK};box-shadow:0 3px 0 ${INK}}
.ed-top{left:8px;right:8px;top:6px;height:${TOP_H - 10}px;display:flex;align-items:center;gap:5px;padding:0 6px}
.ed-rail{left:8px;top:${TOP_H + 2}px;bottom:${BOTTOM_H + 6}px;width:${RAIL_W}px;display:flex;flex-direction:column;align-items:center;gap:4px;padding:6px 0}
.ed-pal{left:${8 + RAIL_W + 6}px;top:${TOP_H + 2}px;bottom:${BOTTOM_H + 6}px;width:${PALETTE_W}px;display:flex;flex-direction:column;overflow:hidden}
.ed-right{right:8px;top:${TOP_H + 2}px;bottom:${BOTTOM_H + 6}px;width:${RIGHT_W - 16}px;display:flex;flex-direction:column;overflow:hidden}
.ed-status{left:8px;right:8px;bottom:4px;height:${BOTTOM_H - 6}px;display:flex;align-items:center;gap:14px;padding:0 10px;font-size:12px;background:${INK};color:#d9e2ea;border-color:${INK}}
.ed-status b{color:${SCREEN};font-weight:600}
.ed-btn{font:600 12.5px ${FONT_UI};border:2px solid ${INK};padding:4px 8px;background:${PAPER};color:${INK};cursor:pointer;box-shadow:0 2px 0 ${INK};white-space:nowrap;line-height:1.1}
.ed-btn:hover:not(:disabled){background:#ffe9d3}
.ed-btn:active:not(:disabled){transform:translateY(2px);box-shadow:none}
.ed-btn:disabled{opacity:.35;cursor:default}
.ed-btn.hot{background:${PEACH}}.ed-btn.go{background:#a9e7b4}.ed-btn.ghost{background:transparent;box-shadow:none;border-color:transparent}
.ed-btn.on{background:${INK};color:${PAPER}}
.ed-sep{width:2px;height:22px;background:${INK};opacity:.15;margin:0 2px}
.ed-name{font:600 15px ${FONT_UI};border:2px solid transparent;background:transparent;color:${INK};padding:2px 6px;width:170px}
.ed-name:hover,.ed-name:focus{border-color:${INK};background:${PAPER};outline:none}
.ed-badge{font:600 11px ${FONT_UI};letter-spacing:.05em;text-transform:uppercase;padding:3px 7px;border:2px solid ${INK}}
.ed-badge.ok{background:${MINT}}.ed-badge.no{background:#e9dfcf;opacity:.85}
.ed-zoom{font:600 12px ${FONT_BODY};min-width:44px;text-align:center}
.ed-rbtn{width:34px;height:34px;display:grid;place-items:center;border:2px solid ${INK};background:${PAPER};cursor:pointer;font-size:17px;position:relative;box-shadow:0 2px 0 ${INK}}
.ed-rbtn:hover{background:#ffe9d3}
.ed-rbtn.on{background:${PEACH};box-shadow:inset 0 -3px 0 rgba(0,0,0,.2)}
.ed-rbtn .k{position:absolute;right:1px;bottom:0;font-size:8.5px;opacity:.55}
.ed-brush{margin-top:auto;display:flex;flex-direction:column;align-items:center;gap:3px;font-size:10px}
.ed-brush button{width:26px;height:20px;border:2px solid ${INK};background:${PAPER};cursor:pointer;font:600 11px ${FONT_BODY}}
.ed-layers{display:grid;grid-template-columns:repeat(6,1fr);gap:3px;padding:6px;border-bottom:2px solid ${INK};background:#eadcc3}
.ed-lchip{height:26px;border:2px solid ${INK};background:${PAPER};cursor:pointer;display:grid;place-items:center;font-size:13px;position:relative}
.ed-lchip.on{background:${INK};color:${PAPER}}
.ed-lchip.hid{opacity:.4}
.ed-lchip .lk{position:absolute;right:0;top:-2px;font-size:8px}
.ed-pal h3{margin:6px 8px 2px;font:600 13px ${FONT_UI};display:flex;align-items:center;gap:6px}
.ed-search{margin:2px 8px 6px;font:500 12px ${FONT_BODY};border:2px solid ${INK};padding:3px 6px;background:${PAPER};width:calc(100% - 16px)}
.ed-items{flex:1;overflow-y:auto;padding:0 8px 6px}
.ed-group{font:600 10.5px ${FONT_UI};text-transform:uppercase;letter-spacing:.06em;opacity:.6;margin:6px 0 3px}
.ed-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:4px}
.ed-grid.decor{grid-template-columns:repeat(4,1fr)}
.ed-item{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;padding:4px 2px;border:2px solid ${INK};background:${PAPER};cursor:pointer;font:500 10.5px/1.05 ${FONT_BODY};text-align:center;min-height:46px}
.ed-item:hover{background:#ffe9d3}
.ed-item.on{background:${PEACH};box-shadow:inset 0 -3px 0 rgba(0,0,0,.2)}
.ed-item .ic{font-size:17px;line-height:20px}
.ed-item img{width:32px;height:32px;image-rendering:pixelated}
.ed-hint{margin:6px 8px 8px;padding:6px 8px;background:${WOOD};border:2px solid ${INK};font:500 11.5px/1.3 ${FONT_BODY};box-shadow:0 2px 0 #7a4c22;min-height:44px}
.ed-tabs{display:flex;border-bottom:2px solid ${INK};background:#eadcc3}
.ed-tab{flex:1;font:600 12px ${FONT_UI};padding:6px 2px;text-align:center;cursor:pointer;border-right:2px solid ${INK}}
.ed-tab:last-child{border-right:none}
.ed-tab.on{background:${INK};color:${PAPER}}
.ed-scroll{overflow-y:auto;padding:8px;display:flex;flex-direction:column;gap:7px;flex:1}
.ed-h{font:600 14px ${FONT_UI};margin:0;display:flex;align-items:center;gap:6px}
.ed-h small{font:500 11px ${FONT_BODY};opacity:.6}
.ed-row{display:flex;align-items:center;gap:5px;font:500 12px ${FONT_BODY}}
.ed-row>label{flex:0 0 84px;opacity:.75}
.ed-row input[type=number],.ed-row input[type=text],.ed-row select,.ed-in,.ed-row textarea{flex:1;min-width:56px;font:500 12px ${FONT_BODY};border:2px solid ${INK};padding:2px 5px;background:${PAPER};color:${INK}}
.ed-row textarea{min-height:52px;resize:vertical}
.ed-row input[type=checkbox]{width:16px;height:16px;accent-color:${INK}}
.ed-row input[type=range]{flex:1;accent-color:${INK}}
.ed-row input[type=color]{width:34px;height:22px;border:2px solid ${INK};padding:0;background:none}
.ed-row output{flex:0 0 34px;text-align:right;font-size:11px}
.ed-card{border:2px solid ${INK};background:${PAPER};padding:7px;display:flex;flex-direction:column;gap:5px}
.ed-x{margin-left:auto;border:none;background:none;font:600 14px ${FONT_UI};cursor:pointer;color:#c93f4f;padding:0 3px}
.ed-mini{font:600 11px ${FONT_BODY};border:2px solid ${INK};padding:1px 6px;background:${PANEL};cursor:pointer}
.ed-mini:hover{background:#ffe9d3}
.ed-act{border-left:4px solid ${WOOD};padding-left:6px;display:flex;flex-direction:column;gap:4px}
.ed-muted{opacity:.62;font:500 11.5px/1.35 ${FONT_BODY}}
.ed-empty{display:flex;flex-direction:column;align-items:center;text-align:center;gap:6px;padding:16px 8px;opacity:.75}
.ed-empty .big{font-size:28px}
.ed-lrow{display:flex;align-items:center;gap:6px;padding:5px 6px;border:2px solid ${INK};background:${PAPER};cursor:pointer}
.ed-lrow.on{background:#ffe9d3}
.ed-lrow .nm{flex:1}
.ed-lrow button{border:none;background:none;cursor:pointer;font-size:13px;padding:0 2px}
.ed-lrow input[type=range]{width:60px;accent-color:${INK}}
.ed-pick{position:absolute;left:50%;top:${TOP_H + 8}px;transform:translateX(-50%);pointer-events:auto;background:${INK};color:${PAPER};padding:6px 14px;font:600 13px ${FONT_BODY};display:flex;gap:10px;align-items:center;border:2px solid ${PAPER}}
.ed-menu{position:absolute;pointer-events:auto;background:${PANEL};border:2px solid ${INK};box-shadow:0 3px 0 ${INK};padding:4px;display:flex;flex-direction:column;gap:1px;min-width:170px;z-index:3;max-height:420px;overflow-y:auto}
.ed-menu h4{margin:2px 6px 4px;font:600 12px ${FONT_UI};opacity:.7}
.ed-menu button{text-align:left;font:600 12px ${FONT_BODY};border:none;background:none;padding:5px 8px;cursor:pointer;color:${INK}}
.ed-menu button:hover,.ed-menu button.on{background:${PEACH}}
.ed-toast{position:absolute;left:50%;bottom:${BOTTOM_H + 14}px;transform:translateX(-50%) translateY(8px);opacity:0;transition:all .2s;background:${INK};color:${PAPER};padding:6px 14px;font:600 12.5px ${FONT_BODY};pointer-events:none;border:2px solid ${PAPER};max-width:520px;text-align:center}
.ed-toast.on{opacity:1;transform:translateX(-50%)}
.ed-mini-map{position:absolute;pointer-events:auto;right:${RIGHT_W + 4}px;bottom:${BOTTOM_H + 10}px;border:2px solid ${INK};background:${INK};box-shadow:0 3px 0 rgba(0,0,0,.3);cursor:pointer;image-rendering:pixelated}
.ed-zbtns{position:absolute;pointer-events:auto;left:${LEFT_W + 6}px;bottom:${BOTTOM_H + 10}px;display:flex;gap:3px}
.ed-modal{position:absolute;inset:0;pointer-events:auto;background:rgba(20,18,26,.55);display:grid;place-items:center;z-index:6}
.ed-studio{background:${PANEL};border:2px solid ${INK};box-shadow:0 5px 0 ${INK};width:1120px;height:600px;display:flex;flex-direction:column;overflow:hidden}
.ed-studio header{display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:2px solid ${INK};background:#eadcc3}
.ed-studio header h2{margin:0;font:600 17px ${FONT_UI};margin-right:auto}
.ed-sbody{flex:1;display:flex;min-height:0}
.ed-slist{width:230px;border-right:2px solid ${INK};overflow-y:auto;padding:6px;display:flex;flex-direction:column;gap:3px}
.ed-sitem{display:flex;align-items:center;gap:6px;padding:4px 6px;border:2px solid ${INK};background:${PAPER};cursor:pointer;font:500 12px ${FONT_BODY}}
.ed-sitem.on{background:${PEACH}}
.ed-sitem .d{width:7px;height:7px;background:transparent;border:1.5px solid ${INK};border-radius:50%}
.ed-sitem .d.on{background:${MINT}}
.ed-sitem small{opacity:.55;margin-left:auto;font-size:10px;max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ed-smain{flex:1;overflow-y:auto;padding:10px 14px;display:flex;flex-direction:column;gap:6px}
.ed-params{display:grid;grid-template-columns:1fr 1fr;gap:4px 18px}
.ed-roll-wrap{flex:1;overflow:auto;border:2px solid ${INK};background:#14121a;position:relative}
.ed-tracks{display:flex;gap:4px;flex-wrap:wrap}
.ed-track{display:flex;align-items:center;gap:5px;padding:3px 6px;border:2px solid ${INK};background:${PAPER};cursor:pointer;font:600 12px ${FONT_UI}}
.ed-track.on{background:${INK};color:${PAPER}}
.ed-track .sw{width:10px;height:10px;border:1.5px solid ${INK}}
.ed-cmd{background:${PANEL};border:2px solid ${INK};box-shadow:0 5px 0 ${INK};width:520px;max-height:440px;display:flex;flex-direction:column;align-self:start;margin-top:90px}
.ed-cmd input{font:600 15px ${FONT_UI};border:none;border-bottom:2px solid ${INK};padding:10px 12px;background:${PAPER};outline:none}
.ed-cmd .list{overflow-y:auto;padding:4px}
.ed-cmd button{display:flex;width:100%;text-align:left;font:500 13px ${FONT_BODY};border:none;background:none;padding:6px 10px;cursor:pointer;color:${INK}}
.ed-cmd button.on,.ed-cmd button:hover{background:${PEACH}}
.ed-cmd button small{margin-left:auto;opacity:.55}
.ed-gallery{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;padding:14px;overflow-y:auto}
.ed-gcard{border:2px solid ${INK};background:${PAPER};padding:10px;cursor:pointer;display:flex;flex-direction:column;gap:4px;box-shadow:0 3px 0 ${INK}}
.ed-gcard:hover{background:#ffe9d3;transform:translateY(-1px)}
.ed-gcard b{font:600 14px ${FONT_UI}}
.ed-gcard canvas{width:100%;height:70px;image-rendering:pixelated;background:#14121a;border:2px solid ${INK}}
.ed-tip{position:absolute;pointer-events:auto;width:270px;background:${INK};color:${PAPER};border:2px solid ${PAPER};padding:10px 12px;font:500 12.5px/1.4 ${FONT_BODY};z-index:7;box-shadow:0 4px 0 rgba(0,0,0,.35)}
.ed-tip b{color:${SCREEN}}
.ed-tip .row{display:flex;gap:6px;justify-content:flex-end;margin-top:8px}
.ed-tip button{font:600 12px ${FONT_UI};border:2px solid ${PAPER};background:transparent;color:${PAPER};padding:2px 8px;cursor:pointer}
.ed-tip button.go{background:${SCREEN};color:${INK};border-color:${SCREEN}}
.ed-drop{border:3px dashed ${INK};padding:24px;text-align:center;background:${PAPER};cursor:pointer}
.ed-drop.over{background:#e1f6e5}
.ed-imgprev{display:flex;gap:12px;align-items:flex-start}
/* Legible small text: beats index.html's global pixel-font rule (more specific + !important). */
.ed-root .ed-status,.ed-root .ed-status *,.ed-root .ed-row,.ed-root .ed-row *,.ed-root .ed-search,.ed-root .ed-item,.ed-root .ed-item *,.ed-root .ed-hint,.ed-root .ed-hint *,.ed-root .ed-mini,.ed-root .ed-muted,.ed-root .ed-muted *,.ed-root .ed-menu button,.ed-root .ed-lrow,.ed-root .ed-lrow *,.ed-root .ed-sitem,.ed-root .ed-sitem *,.ed-root .ed-cmd button,.ed-root .ed-cmd button *,.ed-root .ed-tip,.ed-root .ed-tip *,.ed-root .ed-toast,.ed-root .ed-brush,.ed-root .ed-brush *,.ed-root .ed-h small,.ed-root .ed-gcard span,.ed-root .ed-empty,.ed-root .ed-empty *,.ed-root .ed-drop,.ed-root .ed-track,.ed-root .ed-track *,.ed-root .ed-group,.ed-root .ed-lchip .lk,.ed-root input,.ed-root select,.ed-root textarea,.ed-root output{font-family:${FONT_BODY} !important}
.ed-root .ed-tip b,.ed-root .ed-hint b,.ed-root .ed-empty b{font-family:${FONT_UI} !important}
.ed-eye{font:600 12px ${FONT_BODY};border:2px solid ${INK};width:24px;height:22px;padding:0;background:#ffe2b8;cursor:pointer;flex:0 0 24px;display:grid;place-items:center}
.ed-eye:hover{background:${PEACH}}
.ed-ev{border:2px solid ${INK};background:${PAPER};display:flex;flex-direction:column}
.ed-ev.off{opacity:.55}
.ed-ev.focus{box-shadow:0 0 0 2px ${WOOD}}
.ed-evhead{display:flex;align-items:flex-start;gap:5px;padding:6px 6px;cursor:pointer;font:500 12px/1.3 ${FONT_BODY}}
.ed-evhead:hover{background:#fff1df}
.ed-evhead .tw{flex:0 0 10px;opacity:.6}
.ed-evhead .sum{flex:1;min-width:0;overflow-wrap:anywhere}
.ed-evhead .sum b{font-weight:700}
.ed-evhead button{border:none;background:none;cursor:pointer;padding:0 2px;font:600 13px ${FONT_BODY};opacity:.7}
.ed-evhead button:hover{opacity:1}
.ed-evbody{border-top:2px solid ${INK};padding:7px;display:flex;flex-direction:column;gap:5px}
.ed-sec{font:700 10.5px ${FONT_BODY};letter-spacing:.08em;text-transform:uppercase;opacity:.65;margin-top:3px;display:flex;align-items:center;gap:6px}
.ed-sec .ed-mini{margin-left:auto;text-transform:none;letter-spacing:0}
.ed-cond{border-left:4px solid ${MINT};padding-left:6px;display:flex;flex-direction:column;gap:4px}
.ed-evbody .ed-row>label,.ed-cond .ed-row>label,.ed-act .ed-row>label{flex:0 0 66px}
.ed-warn{background:#ffe2c2;border:2px solid ${INK};padding:6px 8px;font:500 11.5px/1.35 ${FONT_BODY};display:flex;flex-direction:column;gap:2px}
.ed-warn b{font-weight:700}
.ed-chips{display:flex;flex-wrap:wrap;gap:4px}
.ed-root .ed-evhead,.ed-root .ed-evhead *,.ed-root .ed-sec,.ed-root .ed-warn,.ed-root .ed-warn *,.ed-root .ed-eye{font-family:${FONT_BODY} !important}
.ed-imgprev canvas{image-rendering:pixelated;border:2px solid ${INK};background:repeating-conic-gradient(#ddd 0 25%,#fff 0 50%) 0 0/12px 12px}
`;

const LAYER_ICON: Record<LayerId, string> = { fg: '✿', objects: '☺', zones: '⬚', terrain: '■', images: '🖼', bg: '▦' };

export class EditorUI {
  root: HTMLDivElement;
  private top: HTMLDivElement;
  private rail: HTMLDivElement;
  private pal: HTMLDivElement;
  private right: HTMLDivElement;
  private status: HTMLDivElement;
  private minimap: HTMLCanvasElement;
  private zbtns: HTMLDivElement;
  private pickBar: HTMLDivElement | null = null;
  private menu: HTMLDivElement | null = null;
  private modal: HTMLDivElement | null = null;
  private tip: HTMLDivElement | null = null;
  private toastEl: HTMLDivElement;
  private toastT = 0;
  private fileInput: HTMLInputElement;
  private onResize = () => this.layout();
  private unsub: () => void;
  private statusText = '';
  private miniKey = '';
  private lastTab = '';
  /** Expanded event cards (by index). */
  private openEvents = new Set<number>();
  private scrollToEvent: number | null = null;
  private eventFilter = '';
  /** Called by studios when they close (so the editor can resume previews etc.). */
  onModalClose: (() => void) | null = null;

  constructor(private host: UiHost) {
    if (!document.getElementById('ed-css2')) document.head.append(h('style', { id: 'ed-css2' }, CSS));
    document.getElementById('ed-css')?.remove();
    this.top = h('div', { class: 'ed-panel ed-top' });
    this.rail = h('div', { class: 'ed-panel ed-rail' });
    this.pal = h('div', { class: 'ed-panel ed-pal' });
    this.right = h('div', { class: 'ed-panel ed-right' });
    this.status = h('div', { class: 'ed-panel ed-status' });
    this.minimap = h('canvas', { class: 'ed-mini-map', width: 180, height: 90, title: 'Minimap: click to jump' });
    this.minimap.addEventListener('pointerdown', (e) => this.minimapJump(e));
    this.minimap.addEventListener('pointermove', (e) => { if (e.buttons & 1) this.minimapJump(e); });
    this.zbtns = h('div', { class: 'ed-zbtns' },
      h('button', { class: 'ed-btn', title: 'Zoom out (−)', onclick: () => host.zoomBy(1 / 1.25) }, '−'),
      h('button', { class: 'ed-btn', title: 'Fit the room (0)', onclick: () => host.fit() }, 'Fit'),
      h('button', { class: 'ed-btn', title: 'Zoom in (+)', onclick: () => host.zoomBy(1.25) }, '+'),
      h('button', { class: 'ed-btn', title: 'Toggle grid (#)', onclick: () => host.toggleGrid() }, '▦'));
    this.toastEl = h('div', { class: 'ed-toast' });
    this.fileInput = h('input', { type: 'file', accept: '.json,application/json', style: 'display:none', onchange: () => {
      const f = this.fileInput.files?.[0];
      if (f) host.importFile(f);
      this.fileInput.value = '';
    } });
    this.root = h('div', { class: 'ed-root' }, this.top, this.rail, this.pal, this.right, this.status, this.minimap, this.zbtns, this.toastEl, this.fileInput);
    // Keystrokes in fields stay in the fields.
    this.root.addEventListener('keydown', (e) => { if ((e.target as HTMLElement).matches('input,textarea,select')) e.stopPropagation(); });
    // Drop an image anywhere on the editor to import it.
    this.root.addEventListener('dragover', (e) => e.preventDefault());
    document.body.append(this.root);
    window.addEventListener('resize', this.onResize);
    window.addEventListener('dragover', this.onDragOver);
    window.addEventListener('drop', this.onDrop);
    this.layout();
    this.unsub = host.doc.onChange(() => this.refresh());
    this.refresh();
  }

  private onDragOver = (e: DragEvent) => { if (this.root.style.display !== 'none') e.preventDefault(); };
  private onDrop = (e: DragEvent) => {
    if (this.root.style.display === 'none') return;
    const f = e.dataTransfer?.files?.[0];
    if (!f) return;
    e.preventDefault();
    if (f.type.startsWith('image/')) this.openImageStudio(f);
    else if (f.name.endsWith('.json')) this.host.importFile(f);
  };

  destroy(): void {
    this.unsub();
    stopPreview();
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('dragover', this.onDragOver);
    window.removeEventListener('drop', this.onDrop);
    this.root.remove();
  }

  setVisible(v: boolean): void { this.root.style.display = v ? '' : 'none'; if (v) this.layout(); }
  get modalOpen(): boolean { return !!this.modal; }

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
    this.toastT = window.setTimeout(() => this.toastEl.classList.remove('on'), 2400);
  }

  setStatus(text: string): void {
    if (text === this.statusText) return;
    this.statusText = text;
    this.renderStatus();
  }

  refresh(): void {
    this.renderTop();
    this.renderRail();
    this.renderPalette();
    this.renderRight();
    this.renderStatus();
    this.miniKey = '';
  }

  // ---------------------------------------------------------------------------
  // Top bar
  // ---------------------------------------------------------------------------

  private renderTop(): void {
    const { doc } = this.host;
    const l = doc.level;
    const verified = !!l.verified;
    this.top.replaceChildren(
      h('button', { class: 'ed-btn', title: 'Back to the title (Esc)', onclick: () => this.host.exit() }, '←'),
      h('button', { class: 'ed-btn', title: 'Start from a template or a shipped level', onclick: () => this.openTemplates() }, '✦ New / Open'),
      h('input', { class: 'ed-name', value: l.name, maxlength: 40, title: 'Level name', onchange: (e) => {
        const v = (e.target as HTMLInputElement).value.trim() || 'Untitled';
        doc.edit((lv) => { lv.name = v; }, true);
      } }),
      h('span', { class: 'ed-sep' }),
      h('button', { class: 'ed-btn', disabled: !doc.canUndo, title: 'Undo (Ctrl+Z)', onclick: () => doc.undo() }, '↶'),
      h('button', { class: 'ed-btn', disabled: !doc.canRedo, title: 'Redo (Ctrl+Shift+Z)', onclick: () => doc.redo() }, '↷'),
      h('span', { class: 'ed-sep' }),
      h('button', { class: 'ed-btn', title: 'Save draft in this browser (Ctrl+S)', onclick: () => this.host.save() }, doc.dirty ? 'Save •' : 'Saved'),
      h('button', { class: 'ed-btn', title: 'Import a level JSON file', onclick: () => this.fileInput.click() }, 'Import'),
      h('button', { class: 'ed-btn', title: 'Download as JSON', onclick: () => this.host.exportFile() }, 'Export'),
      h('span', { class: 'ed-sep' }),
      h('button', { class: 'ed-btn', title: 'Import a picture and pixelate it', onclick: () => this.openImageStudio() }, '🖼 Image'),
      h('button', { class: 'ed-btn', title: 'Sound designer: change any sound effect', onclick: () => this.openSoundStudio() }, '♪ Sounds'),
      h('button', { class: 'ed-btn', title: 'Compose this level’s theme', onclick: () => this.openMusicStudio() }, '♫ Music'),
      h('span', { style: 'flex:1' }),
      h('button', { class: 'ed-btn ghost', title: 'Command palette (Ctrl+K)', onclick: () => this.openCommands() }, '⌘K'),
      h('button', { class: 'ed-btn ghost', title: 'Show the tips again', onclick: () => this.startTips(true) }, '?'),
      h('span', { class: `ed-badge ${verified ? 'ok' : 'no'}`, title: verified ? 'You beat this exact level in playtest.' : 'Beat it in playtest (from the spawn) to share it.' }, verified ? '✓ Verified' : 'Not verified'),
      h('button', { class: 'ed-btn go', title: 'Play from the spawn (verifies the level). P plays from the cursor.', onclick: () => this.host.playtest(false) }, '▶ Playtest'),
      h('button', { class: 'ed-btn hot', disabled: !verified, title: verified ? 'Copy a share link' : 'Beat it in playtest first', onclick: () => this.host.share() }, 'Share'),
    );
  }

  // ---------------------------------------------------------------------------
  // Tool rail
  // ---------------------------------------------------------------------------

  private renderRail(): void {
    const { st } = this.host;
    const btns = TOOLS.map((t) => {
      const b = h('button', { class: `ed-rbtn ${st.tool === t.id ? 'on' : ''}`, title: `${t.label} (${t.key}) — ${t.hint}`, onclick: () => this.host.setTool(t.id) }, t.icon, h('span', { class: 'k' }, t.key));
      return b;
    });
    const brush = h('div', { class: 'ed-brush' }, 'size',
      h('button', { title: 'Bigger brush (])', onclick: () => this.host.setBrush(st.brush + 1) }, '+'),
      h('b', {}, String(st.brush)),
      h('button', { title: 'Smaller brush ([)', onclick: () => this.host.setBrush(st.brush - 1) }, '−'));
    this.rail.replaceChildren(...btns, brush);
  }

  // ---------------------------------------------------------------------------
  // Palette
  // ---------------------------------------------------------------------------

  private renderPalette(): void {
    const { st } = this.host;
    const chips = h('div', { class: 'ed-layers' }, ...(['terrain', 'objects', 'bg', 'fg', 'images', 'zones'] as LayerId[]).map((id) => {
      const L = LAYERS.find((x) => x.id === id)!;
      return h('div', { class: `ed-lchip ${st.layer === id ? 'on' : ''} ${st.visible[id] ? '' : 'hid'}`, title: `${L.label}: ${L.hint}`, onclick: () => this.host.setLayer(id) },
        LAYER_ICON[id], st.locked[id] ? h('span', { class: 'lk' }, '🔒') : null);
    }));
    const L = LAYERS.find((x) => x.id === st.layer)!;
    const title = h('h3', {}, L.label);
    const kids: Node[] = [chips, title];
    if (st.layer === 'images') {
      kids.push(this.imagesPalette());
    } else {
      const search = h('input', { class: 'ed-search', placeholder: 'Search…', value: st.search, oninput: (e) => { st.search = (e.target as HTMLInputElement).value; this.renderItems(itemsWrap); } });
      const itemsWrap = h('div', { class: 'ed-items' });
      kids.push(search, itemsWrap);
      this.renderItems(itemsWrap);
    }
    const cur = st.item[st.layer];
    kids.push(h('div', { class: 'ed-hint' }, cur ? h('b', {}, cur.label) : TOOLS.find((t) => t.id === st.tool)!.label, h('br'), cur?.hint ?? TOOLS.find((t) => t.id === st.tool)!.hint));
    this.pal.replaceChildren(...kids);
  }

  private renderItems(wrap: HTMLElement): void {
    const { st } = this.host;
    const q = st.search.trim().toLowerCase();
    const items = itemsFor(st.layer).filter((i) => !q || i.label.toLowerCase().includes(q) || i.hint.toLowerCase().includes(q));
    const decor = st.layer === 'bg' || st.layer === 'fg';
    const groups = new Map<string, Item[]>();
    for (const it of items) { const g = it.group ?? ''; if (!groups.has(g)) groups.set(g, []); groups.get(g)!.push(it); }
    const out: Node[] = [];
    if (!items.length) out.push(h('div', { class: 'ed-empty' }, h('span', {}, 'Nothing matches.')));
    for (const [g, list] of groups) {
      if (g) out.push(h('div', { class: 'ed-group' }, g));
      out.push(h('div', { class: `ed-grid ${decor ? 'decor' : ''}` }, ...list.map((it) =>
        h('div', { class: `ed-item ${st.item[st.layer]?.id === it.id ? 'on' : ''}`, title: it.hint, onclick: () => this.host.setItem(it) },
          it.decor ? h('img', { src: decorUrl(it.decor), alt: '' }) : h('span', { class: 'ic' }, it.icon),
          decor ? null : it.label))));
    }
    wrap.replaceChildren(...out);
  }

  private imagesPalette(): HTMLElement {
    const { doc, st } = this.host;
    const imgs = doc.level.images ?? [];
    return h('div', { class: 'ed-items' },
      h('button', { class: 'ed-btn hot', style: 'width:100%;margin:2px 0 8px', onclick: () => this.openImageStudio() }, '＋ Import & pixelate…'),
      imgs.length ? null : h('div', { class: 'ed-empty' }, h('span', { class: 'big' }, '🖼'), 'No images yet.', h('span', {}, 'Drop a picture anywhere on the editor, or use Import.')),
      ...imgs.map((im) => {
        const c = artCanvas(im);
        c.style.cssText = 'width:44px;height:30px;image-rendering:pixelated;object-fit:contain;background:#14121a;border:2px solid #1c1a24';
        return h('div', { class: `ed-lrow ${st.selection?.kind === 'image' && st.selection.id === im.id ? 'on' : ''}`, onclick: () => { this.host.select({ kind: 'image', id: im.id }); this.host.centerOn(im.x + im.w / 32, im.y + im.h / 32); } },
          c, h('span', { class: 'nm' }, `${im.id} · ${im.layer}`, h('br'), h('small', {}, (() => {
            const users = doc.level.objects.filter((o) => o.type === 'gadget' && o.look?.art === im.id).map((o) => o.id);
            return users.length ? `skin of ${users.join(', ')}` : `${im.w}×${im.h}px, ${im.palette.length} colours`;
          })())));
      }));
  }

  // ---------------------------------------------------------------------------
  // Right panel
  // ---------------------------------------------------------------------------

  private renderRight(): void {
    const { st } = this.host;
    const tabs = h('div', { class: 'ed-tabs' }, ...([['inspect', 'Inspect'], ['layers', 'Layers'], ['events', 'Events'], ['level', 'Level']] as const).map(([id, label]) =>
      h('div', { class: `ed-tab ${st.rightTab === id ? 'on' : ''}`, onclick: () => { st.rightTab = id; this.renderRight(); } }, label)));
    const prev = this.right.querySelector('.ed-scroll') as HTMLElement | null;
    const keepScroll = prev && this.lastTab === st.rightTab ? prev.scrollTop : 0;
    this.lastTab = st.rightTab;
    const body = h('div', { class: 'ed-scroll' });
    switch (st.rightTab) {
      case 'inspect': body.append(...this.inspectSelection()); break;
      case 'layers': body.append(...this.layersPanel()); break;
      case 'events': body.append(...this.eventsList()); break;
      case 'level': body.append(...this.levelSettings()); break;
    }
    this.right.replaceChildren(tabs, body);
    body.scrollTop = keepScroll;
    if (this.scrollToEvent !== null) {
      const el = body.querySelector(`[data-ev="${this.scrollToEvent}"]`) as HTMLElement | null;
      this.scrollToEvent = null;
      if (el) body.scrollTop = el.offsetTop - 8;
    }
  }

  // --- field helpers ---------------------------------------------------------

  row(label: string, ...ctl: Array<Node | null>): HTMLElement { return h('div', { class: 'ed-row' }, h('label', {}, label), ...ctl); }
  num(v: number, on: (v: number) => void, min = -999, max = 999, step = 1): HTMLInputElement {
    return h('input', { type: 'number', value: v, min, max, step, onchange: (e) => {
      const n = Number((e.target as HTMLInputElement).value);
      if (Number.isFinite(n)) on(Math.min(max, Math.max(min, n)));
    } });
  }
  text(v: string, on: (v: string) => void, ph = ''): HTMLInputElement {
    return h('input', { type: 'text', value: v, placeholder: ph, onchange: (e) => on((e.target as HTMLInputElement).value) });
  }
  area(v: string, on: (v: string) => void): HTMLTextAreaElement {
    const t = h('textarea', { onchange: (e) => on((e.target as HTMLTextAreaElement).value) });
    t.value = v;
    return t;
  }
  check(v: boolean, on: (v: boolean) => void): HTMLInputElement {
    return h('input', { type: 'checkbox', checked: v, onchange: (e) => on((e.target as HTMLInputElement).checked) });
  }
  select(v: string, opts: Array<[string, string]>, on: (v: string) => void): HTMLSelectElement {
    return h('select', { onchange: (e) => on((e.target as HTMLSelectElement).value) }, ...opts.map(([val, lab]) => h('option', { value: val, selected: val === v }, lab)));
  }
  slider(v: number, min: number, max: number, step: number, on: (v: number) => void, fmt = (x: number) => x.toFixed(2)): HTMLElement[] {
    const out = h('output', {}, fmt(v));
    const s = h('input', { type: 'range', min, max, step, value: v, oninput: (e) => { out.textContent = fmt(Number((e.target as HTMLInputElement).value)); }, onchange: (e) => on(Number((e.target as HTMLInputElement).value)) });
    return [s, out];
  }
  mini(label: string, on: () => void, title = ''): HTMLButtonElement { return h('button', { class: 'ed-mini', title, onclick: on }, label); }

  private set(id: string, fn: (o: LevelObject) => void): void {
    this.host.doc.edit((l) => { const o = l.objects.find((x) => x.id === id); if (o) fn(o); });
  }

  // --- inspector ---------------------------------------------------------------

  private inspectSelection(): HTMLElement[] {
    const { doc, st } = this.host;
    const sel = st.selection;
    if (sel?.kind === 'object') { const o = doc.byId(sel.id); if (o) return this.inspectObject(o); }
    if (sel?.kind === 'zone') { const z = doc.level.zones.find((x) => x.id === sel.id); if (z) return this.inspectZone(z); }
    if (sel?.kind === 'exit') { const e = (doc.level.exits ?? []).find((x) => x.id === sel.id); if (e) return this.inspectExit(e); }
    if (sel?.kind === 'image') { const im = (doc.level.images ?? []).find((x) => x.id === sel.id); if (im) return this.inspectImage(im); }
    if (st.marquee) {
      const m = st.marquee;
      return [
        h('h3', { class: 'ed-h' }, 'Selection', h('small', {}, `${m.w}×${m.h} at ${m.x},${m.y}`)),
        h('div', { class: 'ed-row' }, this.mini('Copy', () => this.host.copy(), 'Ctrl+C'), this.mini('Cut', () => this.host.cut(), 'Ctrl+X'), this.mini('Delete', () => this.host.deleteSelection(), 'Del')),
        h('div', { class: 'ed-row' }, this.mini('Flip ↔', () => this.host.flip('h'), 'F'), this.mini('Flip ↕', () => this.host.flip('v'), 'Shift+F'), this.mini('Stamp', () => this.host.setTool('stamp'), 'S')),
        h('div', { class: 'ed-muted' }, 'Copies every visible, unlocked layer. Stamp pastes at the cursor (Ctrl+V).'),
      ];
    }
    return [h('div', { class: 'ed-empty' }, h('span', { class: 'big' }, '☞'), h('b', {}, 'Nothing selected'),
      h('span', {}, 'Pick the Select tool (V) and click something on the map to edit it here. Drag a selected object to move it; drag its corner to resize.'))];
  }

  private header(title: string, id: string, onDelete: () => void, renamable = false): HTMLElement {
    const idEl = renamable
      ? h('input', { class: 'ed-in', style: 'flex:0 1 92px;min-width:40px;font-size:11px;padding:1px 4px', value: id, title: 'Rename (links follow)', onchange: (e) => {
        const v = (e.target as HTMLInputElement).value;
        if (!this.host.doc.rename(id, v)) { (e.target as HTMLInputElement).value = id; if (v.trim() && v.trim() !== id) this.toast('That name is taken.'); }
        else this.host.select(this.host.st.selection?.kind === 'zone' ? { kind: 'zone', id: v.trim().replace(/\s+/g, '_') } : { kind: 'object', id: v.trim().replace(/\s+/g, '_') });
      } })
      : h('small', {}, id);
    return h('h3', { class: 'ed-h' }, title, idEl, h('button', { class: 'ed-x', title: 'Delete (Del)', onclick: onDelete }, '✕'));
  }

  private pos(o: LevelObject): HTMLElement {
    const l = this.host.doc.level;
    const fine = o.type === 'label' || o.type === 'gate';
    return this.row('Position', this.num(o.x, (v) => this.set(o.id, (x) => { x.x = v; }), 0, l.width - 1, fine ? 0.5 : 1),
      this.num(o.y, (v) => this.set(o.id, (x) => { x.y = v; }), 0, l.height - 1, fine ? 0.1 : 1));
  }

  private plateOptions(): Array<[string, string]> {
    const { doc } = this.host;
    return [['', '— none —'], ...doc.objectsOfType('plate').map((p) => [p.id, `${p.id} (needs ${p.need})`] as [string, string]),
      ...doc.objectsOfType('sensor').map((p) => [p.id, `${p.id} (light sensor)`] as [string, string])];
  }

  private inspectObject(o: LevelObject): HTMLElement[] {
    const id = o.id;
    const del = () => { this.host.doc.edit(() => this.host.doc.removeObject(id)); this.host.select(null); };
    const out: HTMLElement[] = [];
    const typed = <T extends LevelObject['type']>(t: T, fn: (x: Extract<LevelObject, { type: T }>) => void) => (x: LevelObject) => { if (x.type === t) fn(x as Extract<LevelObject, { type: T }>); };
    const header = this.header.bind(this);
    this.header = (title: string, hid: string, onDelete: () => void) => header(title, hid, onDelete, o.type !== 'spawn');
    try { this.inspectObjectBody(o, id, del, typed, out); } finally { this.header = header; }
    out.push(...this.linksFor(o.id, o));
    return out;
  }

  private inspectObjectBody(o: LevelObject, id: string, del: () => void, typed: <T extends LevelObject['type']>(t: T, fn: (x: Extract<LevelObject, { type: T }>) => void) => (x: LevelObject) => void, out: HTMLElement[]): void {
    switch (o.type) {
      case 'spawn': out.push(this.header('Spawn', id, del), this.pos(o), h('div', { class: 'ed-muted' }, 'Where Pip pops out. Every level needs exactly one.')); break;
      case 'door':
        out.push(this.header(o.runaway ? 'Runaway door' : 'Airlock exit', id, del), this.pos(o),
          this.row('Robot legs', this.check(!!o.runaway, (v) => this.set(id, typed('door', (x) => { if (v) x.runaway = true; else delete x.runaway; })))),
          this.row('Leads to', this.text(o.to?.room ?? '', (v) => this.set(id, typed('door', (x) => { if (v) x.to = { room: v, exit: x.to?.exit ?? '' }; else delete x.to; })), 'room id (world)')),
          this.row('…exit', this.text(o.to?.exit ?? '', (v) => this.set(id, typed('door', (x) => { if (x.to) x.to.exit = v; })), 'exit id')),
          h('div', { class: 'ed-muted' }, 'In the connected world, walking through a won door takes Pip to that room’s exit.'));
        break;
      case 'popup': out.push(this.header('Pop-up spike', id, del), this.pos(o), h('div', { class: 'ed-muted' }, 'Hidden until a "Pop spike" action fires: use the Link tool in the Zones layer.')); break;
      case 'dropper':
        out.push(this.header('Dropper', id, del), this.pos(o),
          this.row('Pip passing', this.check((o.by ?? ['player']).includes('player'), (v) => this.set(id, typed('dropper', (x) => { x.by = toggleIn(x.by ?? ['player'], 'player', v); })))),
          this.row('Door passing', this.check((o.by ?? []).includes('door'), (v) => this.set(id, typed('dropper', (x) => { x.by = toggleIn(x.by ?? ['player'], 'door', v); })))));
        break;
      case 'crusher':
        out.push(this.header('Press', id, del), this.pos(o),
          this.row('Size', this.num(o.w, (v) => this.set(id, typed('crusher', (x) => { x.w = v; })), 1, 12), this.num(o.h, (v) => this.set(id, typed('crusher', (x) => { x.h = v; })), 1, 6)),
          this.row('Every (ticks)', this.num(o.period ?? 0, (v) => this.set(id, typed('crusher', (x) => { if (v > 0) x.period = v; else delete x.period; })), 0, 1200, 10)),
          this.row('Phase', this.num(o.phase ?? 0, (v) => this.set(id, typed('crusher', (x) => { x.phase = v; })), 0, 1200, 5)),
          h('div', { class: 'ed-muted' }, 'Period 0 = only fires from events. Holds 1 s, then rises. 60 ticks = 1 s.'));
        break;
      case 'plate':
        out.push(this.header('Pressure pad', id, del), this.pos(o),
          this.row('Width', this.num(o.w, (v) => this.set(id, typed('plate', (x) => { x.w = v; })), 1, 8)),
          this.row('Needs weight', this.num(o.need, (v) => this.set(id, typed('plate', (x) => { x.need = v; })), 1, 12)),
          h('div', { class: 'ed-muted' }, 'Pip 1 · Fresh 2 · Rot 1 · Skeleton 0 · crate 2. Weight passes down stacks.'));
        break;
      case 'sensor':
        out.push(this.header('Light sensor', id, del), this.pos(o),
          h('div', { class: 'ed-muted' }, 'Pressed while Pip’s flashlight shines on it, with nothing solid in between (range 9 tiles, about a 64° cone). Pick it as “Opened by” on a shutter, as a laser’s pad, or link events with the Link tool.'),
          ...(this.host.doc.level.dark ? [] : [h('div', { class: 'ed-muted' }, 'Tip: sensors shine brightest in a dark room (Level → Dark room).')]));
        break;
      case 'gate':
        out.push(this.header('Blast shutter', id, del), this.pos(o),
          this.row('Height', this.num(o.h, (v) => this.set(id, typed('gate', (x) => { x.h = v; })), 0.2, 30, 0.1)),
          this.row('Opened by', this.select(o.plate ?? '', this.plateOptions(), (v) => this.set(id, typed('gate', (x) => { if (v) x.plate = v; else delete x.plate; })))),
          h('div', { class: 'ed-muted' }, 'Hangs from its top tile. With no pad it stays shut until a "Toggle shutter" action.'));
        break;
      case 'platform':
        out.push(this.header('Lift', id, del), this.pos(o),
          this.row('Width', this.num(o.w, (v) => this.set(id, typed('platform', (x) => { x.w = v; })), 1, 12)),
          this.row('Speed t/s', ...this.slider(o.speed, 0.5, 12, 0.5, (v) => this.set(id, typed('platform', (x) => { x.speed = v; })), (x) => x.toFixed(1))),
          this.row('Starts', this.select(o.start, [['always', 'always'], ['touch', 'on touch'], ['trigger', 'on trigger']], (v) => this.set(id, typed('platform', (x) => { x.start = v as 'always'; })))),
          this.row('Loops', this.check(!!o.loop, (v) => this.set(id, typed('platform', (x) => { if (v) x.loop = true; else delete x.loop; })))),
          this.row('Drop-through', this.check(!!o.oneWay, (v) => this.set(id, typed('platform', (x) => { if (v) x.oneWay = true; else delete x.oneWay; })))),
          h('div', { class: 'ed-h', style: 'font-size:12.5px' }, 'Path',
            this.mini('+ point', () => this.host.pick({ type: 'point', prompt: 'Click tiles to add path points', repeat: true, onPick: (p) => this.set(id, typed('platform', (x) => { x.path.push(p); })) })),
            this.mini('reset', () => this.set(id, typed('platform', (x) => { x.path = [{ x: x.x, y: x.y }]; })))),
          h('div', { class: 'ed-muted' }, 'Drag the round path handles on the map to move points.'),
          ...o.path.map((p, i) => h('div', { class: 'ed-row' }, h('label', {}, i === 0 ? 'start' : `#${i}`), `${p.x}, ${p.y}`,
            i > 0 ? h('button', { class: 'ed-x', onclick: () => this.set(id, typed('platform', (x) => { x.path.splice(i, 1); })) }, '✕') : null)));
        break;
      case 'laser':
        out.push(this.header(o.emitter ? 'Laser' : 'Laser beam', id, del), this.pos(o),
          this.row('Direction', this.select(o.dir, [['down', '↓ down'], ['up', '↑ up'], ['left', '← left'], ['right', '→ right']], (v) => this.set(id, typed('laser', (x) => { x.dir = v as 'down'; })))),
          this.row('Emitter block', this.check(o.emitter, (v) => this.set(id, typed('laser', (x) => { x.emitter = v; })))),
          this.row('Length', this.num(o.len ?? 0, (v) => this.set(id, typed('laser', (x) => { if (v > 0) x.len = v; else delete x.len; })), 0, 64)),
          this.row('Mode', this.select(o.mode, [['on', 'steady on'], ['off', 'off'], ['blink', 'blinking'], ['plate', 'off while pad pressed']], (v) => this.set(id, typed('laser', (x) => { x.mode = v as 'on'; })))),
          ...(o.mode === 'blink' ? [this.row('On / off', this.num(o.on ?? 60, (v) => this.set(id, typed('laser', (x) => { x.on = v; })), 1, 600, 5), this.num(o.off ?? 60, (v) => this.set(id, typed('laser', (x) => { x.off = v; })), 1, 600, 5)),
            this.row('Phase', this.num(o.phase ?? 0, (v) => this.set(id, typed('laser', (x) => { x.phase = v; })), 0, 600, 5))] : []),
          ...(o.mode === 'plate' ? [this.row('Pad', this.select(o.plate ?? '', this.plateOptions(), (v) => this.set(id, typed('laser', (x) => { if (v) x.plate = v; else delete x.plate; }))))] : []),
          this.row('Hidden', this.check(!!o.hidden, (v) => this.set(id, typed('laser', (x) => { if (v) x.hidden = true; else delete x.hidden; })))),
          h('div', { class: 'ed-muted' }, 'Length 0 = until it hits a wall. Hidden: invisible until something touches it, then it fires for good.'));
        break;
      case 'sign': {
        const entries = Object.entries(o.text).sort((a, b) => Number(a[0]) - Number(b[0]));
        out.push(this.header('Sign monitor', id, del), this.pos(o), h('div', { class: 'ed-muted' }, 'Text by death count: the highest count reached is shown. Keep lines short.'),
          ...entries.map(([k, v]) => h('div', { class: 'ed-row' },
            h('input', { type: 'number', class: 'ed-in', style: 'flex:0 0 46px', value: k, min: 0, title: 'From this many deaths', onchange: (e) => {
              const nk = String(Math.max(0, Math.round(Number((e.target as HTMLInputElement).value))));
              this.set(id, typed('sign', (x) => { if (nk !== k) { x.text[nk] = x.text[k]!; delete x.text[k]; } }));
            } }),
            this.text(v, (t) => this.set(id, typed('sign', (x) => { x.text[k] = t; }))),
            entries.length > 1 ? h('button', { class: 'ed-x', onclick: () => this.set(id, typed('sign', (x) => { delete x.text[k]; })) }, '✕') : null)),
          h('div', { class: 'ed-row' }, this.mini('+ line for more deaths', () => this.set(id, typed('sign', (x) => {
            const next = Math.max(...Object.keys(x.text).map(Number)) + 1;
            x.text[String(next)] = 'Again? Bold.';
          })))));
        break;
      }
      case 'vine':
        out.push(this.header('Vine', id, del), this.pos(o),
          this.row('Length', ...this.slider(o.len, 1, 20, 0.5, (v) => this.set(id, typed('vine', (x) => { x.len = v; })), (x) => `${x} t`)),
          h('div', { class: 'ed-muted' }, 'Hangs from the tile at its position (make that tile solid). Pip grabs it mid-air, pumps with ←/→, slides with ↓, leaps with jump.'));
        break;
      case 'crate': out.push(this.header('Crate', id, del), this.pos(o), h('div', { class: 'ed-muted' }, 'Pushable, stackable, weight 2. Floats, rides belts, props presses open. Back home on respawn.')); break;
      case 'bench': out.push(this.header('Checkpoint', id, del), this.pos(o), h('div', { class: 'ed-muted' }, 'Touching it makes it the respawn point in this room.')); break;
      case 'relic':
        out.push(this.header(o.kind === 'note' ? 'Lab note' : 'Specimen jar', id, del), this.pos(o),
          this.row('Kind', this.select(o.kind, [['note', 'Lab note'], ['jar', 'Specimen jar']], (v) => this.set(id, typed('relic', (x) => { x.kind = v as 'note'; })))),
          this.row('Text', this.area(o.text ?? '', (v) => this.set(id, typed('relic', (x) => { if (v) x.text = v; else delete x.text; })))),
          h('div', { class: 'ed-muted' }, 'Collected once per run. Notes show their text when picked up.'));
        break;
      case 'light':
        out.push(this.header('Light', id, del), this.pos(o),
          this.row('Colour', h('input', { type: 'color', value: o.color ?? '#ffe9a6', onchange: (e) => this.set(id, typed('light', (x) => { x.color = (e.target as HTMLInputElement).value; })) })),
          this.row('Radius', ...this.slider(o.radius ?? 4, 1, 16, 0.5, (v) => this.set(id, typed('light', (x) => { x.radius = v; })), (x) => `${x} t`)),
          this.row('Flicker', this.check(!!o.flicker, (v) => this.set(id, typed('light', (x) => { if (v) x.flicker = true; else delete x.flicker; })))));
        break;
      case 'label':
        out.push(this.header('Text label', id, del), this.pos(o),
          this.row('Text', this.text(o.text, (v) => this.set(id, typed('label', (x) => { x.text = v; })))),
          this.row('Size', ...this.slider(o.size ?? 1, 0.5, 4, 0.5, (v) => this.set(id, typed('label', (x) => { x.size = v; })), (x) => `×${x}`)));
        break;
      case 'gadget': out.push(...this.inspectGadget(o, del)); break;
    }
  }

  // --- gadgets -------------------------------------------------------------------

  private inspectGadget(o: GadgetObj, del: () => void): HTMLElement[] {
    const { doc } = this.host;
    const l = doc.level;
    const id = o.id;
    const setG = (fn: (g: GadgetObj) => void) => doc.edit((lv) => { const g = lv.objects.find((x) => x.id === id); if (g?.type === 'gadget') fn(g); });
    const setFx = (fn: (e: GadgetEffect & Record<string, unknown>) => void) => setG((g) => fn(g.effect as GadgetEffect & Record<string, unknown>));
    const eye = (title: string, run: () => void) => h('button', { class: 'ed-eye', title, onclick: run }, '◉');
    const out: HTMLElement[] = [this.header(o.name || 'Gadget', id, del)];
    out.push(this.row('Name', this.text(o.name ?? '', (v) => setG((g) => { if (v.trim()) g.name = v.trim(); else delete g.name; }), 'e.g. Spring')));
    out.push(this.row('Start from', this.select('', [['', 'a preset…'], ...GADGETS.map((it) => [it.id, it.label] as [string, string])], (v) => {
      const it = GADGETS.find((x) => x.id === v);
      if (!it?.make) return;
      const fresh = it.make(id, Math.floor(o.x), Math.floor(o.y)) as GadgetObj;
      setG((g) => { for (const k of Object.keys(g)) if (k !== 'type' && k !== 'id') delete (g as unknown as Record<string, unknown>)[k]; Object.assign(g, { ...fresh, id }); });
      if (fresh.effect.kind === 'collect' && fresh.effect.var) doc.edit(() => doc.ensureVar(fresh.effect.kind === 'collect' ? fresh.effect.var! : '', 'Coins'));
    })));
    out.push(this.row('Position', this.num(o.x, (v) => setG((g) => { const dx = v - g.x; g.x = v; if (g.path) g.path = g.path.map((p) => ({ x: p.x + dx, y: p.y })); }), -4, l.width, 0.25),
      this.num(o.y, (v) => setG((g) => { const dy = v - g.y; g.y = v; if (g.path) g.path = g.path.map((p) => ({ x: p.x, y: p.y + dy })); }), -4, l.height, 0.25)));
    out.push(this.row('Size', this.num(o.w, (v) => setG((g) => { g.w = v; }), 0.25, 64, 0.25), this.num(o.h, (v) => setG((g) => { g.h = v; }), 0.25, 64, 0.25), h('span', { style: 'opacity:.6;font-size:11px' }, 'tiles')));

    // What it does
    const fx = o.effect as GadgetEffect & Record<string, unknown>;
    out.push(h('div', { class: 'ed-sec' }, 'What it does'));
    const EFFECTS: Array<[GadgetEffect['kind'], string, string]> = [
      ['none', 'Nothing (just a part)', 'A block, platform or decoration. Wire it up with events.'],
      ['kill', 'Kills Pip', 'Leaves a body like any death.'],
      ['bounce', 'Bounces', 'Launches up to a height.'],
      ['launch', 'Launches', 'Sets speed in a direction.'],
      ['force', 'Pushes (fan / wind)', 'Constant push while inside. Gravity is 60 t/s² down.'],
      ['gravity', 'Changes gravity', 'Multiplies gravity while inside: 0 floats, 2 is heavy.'],
      ['teleport', 'Teleports', 'Moves Pip or a body to a spot or another gadget.'],
      ['slow', 'Slows (goo)', 'Damps speed while inside.'],
      ['conveyor', 'Carries (belt)', 'Moves what stands on it. Make it solid.'],
      ['checkpoint', 'Checkpoint', 'Becomes the respawn point.'],
      ['collect', 'Collectible', 'Picked up by Pip; adds to a variable.'],
      ['win', 'Wins the level', 'Like reaching the door.'],
    ];
    out.push(this.row('Effect', this.select(fx.kind, EFFECTS.map(([k, lab]) => [k, lab] as [string, string]), (v) => setG((g) => { g.effect = defaultEffect(v as GadgetEffect['kind'], g); }))));
    const ehint = EFFECTS.find((e) => e[0] === fx.kind)?.[2];
    if (ehint) out.push(h('div', { class: 'ed-muted' }, ehint));
    const numFx = (label: string, key: string, min: number, max: number, step: number, unit = '') => this.row(label, this.num(Number(fx[key] ?? 0), (v) => setFx((e) => { e[key] = v; }), min, max, step), unit ? h('span', { style: 'opacity:.6;font-size:11px' }, unit) : null);
    switch (fx.kind) {
      case 'kill': out.push(this.row('As if by', this.select(String(fx.cause ?? 'spike'), CAUSES, (v) => setFx((e) => { e.cause = v; })))); break;
      case 'bounce': out.push(numFx('Height', 'height', 0.5, 40, 0.5, 'tiles')); break;
      case 'launch': out.push(numFx('Sideways', 'vx', -40, 40, 1, 't/s'), numFx('Down (− up)', 'vy', -40, 40, 1, 't/s')); break;
      case 'force': out.push(numFx('Push x', 'ax', -300, 300, 5, 't/s²'), numFx('Push y (− up)', 'ay', -300, 300, 5, 't/s²')); break;
      case 'gravity': out.push(this.row('Gravity ×', ...this.slider(Number(fx.scale ?? 1), 0, 3, 0.05, (v) => setFx((e) => { e.scale = v; })))); break;
      case 'slow': out.push(this.row('Keep speed', ...this.slider(Number(fx.factor ?? 0.4), 0, 1, 0.05, (v) => setFx((e) => { e.factor = v; }), (x) => `${Math.round(x * 100)}%`))); break;
      case 'conveyor': out.push(numFx('Speed (− left)', 'speed', -16, 16, 0.5, 't/s')); break;
      case 'teleport': {
        const to = fx.to as Pt | string;
        out.push(this.row('Sends to', h('span', { style: 'flex:1' }, typeof to === 'string' ? nameOf(l, to) : `tile ${to.x}, ${to.y}`),
          eye('Click a spot', () => this.host.pick({ type: 'point', prompt: 'Click where it sends things', onPick: (p) => setFx((e) => { e.to = p; }) })),
          h('button', { class: 'ed-mini', title: 'Pick another gadget (e.g. a second teleporter)', onclick: () => this.host.pick({ type: 'object', prompt: 'Click the gadget it sends things to', accept: (x) => x.type === 'gadget' && x.id !== id, onPick: (gid) => setFx((e) => { e.to = gid; }) }) }, '◉ gadget')));
        out.push(h('div', { class: 'ed-row' }, h('label', {}, ''), this.mini('Make a return pad', () => {
          const p = typeof to === 'string' ? undefined : to;
          const nid = doc.newId('tele');
          doc.edit((lv) => {
            const back: GadgetObj = { type: 'gadget', id: nid, name: 'Teleporter', x: p?.x ?? o.x + 6, y: p?.y ?? o.y, w: o.w, h: o.h, look: { ...(o.look ?? {}) }, effect: { kind: 'teleport', to: id } };
            lv.objects.push(back);
            const me = lv.objects.find((x) => x.id === id);
            if (me?.type === 'gadget' && me.effect.kind === 'teleport') me.effect.to = nid;
          });
          this.toast('Linked pair: each sends to the other.');
        }, 'Place a second teleporter at the destination; they send to each other')));
        break;
      }
      case 'collect': {
        const listId = 'ed-vars-dl2';
        out.push(this.row('Adds to', h('input', { type: 'text', value: String(fx.var ?? ''), list: listId, placeholder: 'variable (optional)', onchange: (e) => {
          const n = (e.target as HTMLInputElement).value.trim().replace(/\s+/g, '_');
          doc.edit((lv) => { const g = lv.objects.find((x) => x.id === id); if (g?.type === 'gadget' && g.effect.kind === 'collect') { if (n) g.effect.var = n; else delete g.effect.var; } if (n) doc.ensureVar(n, n[0]!.toUpperCase() + n.slice(1)); });
        } }), h('datalist', { id: listId }, ...(l.vars ?? []).map((v) => h('option', { value: v.name })))), numFx('Amount', 'amount', -99, 99, 1));
        break;
      }
      default: break;
    }
    const aff = o.affects ?? {};
    if (fx.kind !== 'none' && fx.kind !== 'win' && fx.kind !== 'checkpoint' && fx.kind !== 'collect')
      out.push(this.row('Affects', h('label', { style: 'display:flex;gap:3px;align-items:center;flex:0 0 auto;opacity:1' }, this.check(aff.player !== false, (v) => setG((g) => { g.affects = { ...(g.affects ?? {}), player: v }; })), 'Pip'),
        h('label', { style: 'display:flex;gap:3px;align-items:center;flex:0 0 auto;opacity:1' }, this.check(aff.bodies !== false, (v) => setG((g) => { g.affects = { ...(g.affects ?? {}), bodies: v }; })), 'bodies & crates')));
    out.push(this.row('Solid', this.select(o.solid ?? 'none', [['none', 'no (pass through)'], ['solid', 'yes (blocks, carries)'], ['oneWay', 'from above only']], (v) => setG((g) => { if (v === 'none') delete g.solid; else g.solid = v as 'solid'; }))));
    out.push(this.row('One use', this.check(!!o.once, (v) => setG((g) => { if (v) g.once = true; else delete g.once; })), h('span', { class: 'ed-muted' }, 'gone after the first touch')));

    // Look
    const look = o.look ?? {};
    const setLook = (fn: (lk: NonNullable<GadgetObj['look']>) => void) => setG((g) => { g.look ??= {}; fn(g.look); });
    out.push(h('div', { class: 'ed-sec' }, 'Look'));
    out.push(this.row('Shape', this.select(look.shape ?? 'box', [['box', 'block'], ['round', 'round'], ['spikes', 'spikes'], ['field', 'soft field'], ['none', 'invisible']], (v) => setLook((lk) => { lk.shape = v as 'box'; }))));
    out.push(this.row('Colour', h('input', { type: 'color', value: look.color ?? '#7fd38e', onchange: (e) => setLook((lk) => { lk.color = (e.target as HTMLInputElement).value; }) }),
      look.color ? this.mini('auto', () => setLook((lk) => { delete lk.color; }), 'Use the colour for its effect') : h('span', { class: 'ed-muted' }, 'auto'),
      h('span', { style: 'flex:1' }), h('label', { style: 'display:flex;gap:3px;align-items:center;flex:0 0 auto;opacity:1' }, this.check(!!look.glow, (v) => setLook((lk) => { if (v) lk.glow = true; else delete lk.glow; })), 'glow')));
    out.push(this.row('Symbol', h('input', { type: 'text', value: look.glyph ?? '', maxlength: 3, placeholder: 'auto', style: 'flex:0 0 60px', onchange: (e) => setLook((lk) => { const v = (e.target as HTMLInputElement).value.trim(); if (v) lk.glyph = v; else delete lk.glyph; }) }),
      h('span', { class: 'ed-muted' }, 'a character drawn on it')));
    const imgs = l.images ?? [];
    out.push(this.row('Image', this.select(look.art ?? '', [['', '— none —'], ...imgs.map((im) => [im.id, `${im.id} (${im.w}×${im.h})`] as [string, string])], (v) => setLook((lk) => { if (v) lk.art = v; else delete lk.art; })),
      this.mini('Import…', () => this.openImageStudio(), 'Pixelate a picture, then pick it here')));

    // On / off
    const mode = o.link ? 'pad' : o.when ? 'cond' : o.on === false ? 'off' : 'on';
    out.push(h('div', { class: 'ed-sec' }, 'On / off'));
    out.push(this.row('It is', this.select(mode, [['on', 'on (events can switch it)'], ['off', 'off at first (events can switch it)'], ['pad', 'on while a pad / sensor is pressed'], ['cond', 'on while a condition holds']], (v) => setG((g) => {
      delete g.link; delete g.invert; delete g.when; delete g.on;
      if (v === 'off') g.on = false;
      if (v === 'pad') { const p = l.objects.find((x) => x.type === 'plate' || x.type === 'sensor'); g.link = p?.id ?? ''; }
      if (v === 'cond') g.when = makeCond(l.vars?.length ? 'var' : 'pressed', { level: l });
    }))));
    if (mode === 'pad') {
      out.push(this.field({ key: 'link', label: 'Pad', kind: { k: 'plate' } }, o.link, (v) => setG((g) => { g.link = String(v ?? ''); })),
        this.row('Reverse', this.check(!!o.invert, (v) => setG((g) => { if (v) g.invert = true; else delete g.invert; })), h('span', { class: 'ed-muted' }, 'on while NOT pressed')));
    }
    if (mode === 'cond' && o.when) {
      out.push(this.condEditor(o.when, (nc) => setG((g) => { g.when = nc; }), (fn) => setG((g) => { if (g.when) fn(g.when as unknown as Record<string, unknown>); })));
    }
    out.push(h('div', { class: 'ed-muted' }, 'Off gadgets are faded, not solid, and do nothing. Events can switch them with “Switch a gadget”.'));

    // Movement
    out.push(h('div', { class: 'ed-sec' }, 'Movement',
      this.mini(o.path?.length ? '◉ redraw path' : '◉ draw a path', () => {
        const acc: Pt[] = [{ x: o.x, y: o.y }];
        setG((g) => { g.path = [...acc]; g.speed ??= 3; });
        this.host.pick({ type: 'point', repeat: true, prompt: 'Click where it should travel, point by point (it starts where it is). Done when finished.', onPick: (c) => { acc.push({ x: c.x, y: c.y }); setG((g) => { g.path = [...acc]; }); } });
      }, 'Click points on the map')));
    if (o.path?.length) {
      out.push(this.row('Speed', ...this.slider(o.speed ?? 3, 0.25, 16, 0.25, (v) => setG((g) => { g.speed = v; }), (x) => `${x} t/s`)),
        this.row('Moves', this.select(o.move ?? 'always', [['always', 'all the time'], ['whenOn', 'only while on'], ['trigger', 'when an event starts it']], (v) => setG((g) => { if (v === 'always') delete g.move; else g.move = v as 'whenOn'; }))),
        this.row('Loop', this.check(!!o.loop, (v) => setG((g) => { if (v) g.loop = true; else delete g.loop; })), h('span', { class: 'ed-muted' }, 'off = back and forth')),
        h('div', { class: 'ed-muted' }, `${o.path.length} points. Drag the round handles on the map to move them.`),
        h('div', { class: 'ed-row' }, this.mini('Remove path', () => setG((g) => { delete g.path; delete g.speed; delete g.move; delete g.loop; }))));
    } else out.push(h('div', { class: 'ed-muted' }, 'Stays put. Draw a path to make it move (saws, elevators, patrolling hazards).'));
    return out;
  }

  private inspectZone(z: Zone): HTMLElement[] {
    const { doc } = this.host;
    const setZ = (fn: (zz: Zone) => void) => doc.edit((l) => { const zz = l.zones.find((q) => q.id === z.id); if (zz) fn(zz); });
    return [
      this.header('Trigger zone', z.id, () => { doc.edit(() => doc.removeZone(z.id)); this.host.select(null); }, true),
      this.row('Position', this.num(z.x, (v) => setZ((q) => { q.x = v; }), 0, doc.level.width - 1), this.num(z.y, (v) => setZ((q) => { q.y = v; }), 0, doc.level.height - 1)),
      this.row('Size', this.num(z.w, (v) => setZ((q) => { q.w = v; }), 1, MAX_W), this.num(z.h, (v) => setZ((q) => { q.h = v; }), 1, MAX_H)),
      ...this.linksFor(z.id, undefined, z),
    ];
  }

  private inspectExit(e: Exit): HTMLElement[] {
    const { doc } = this.host;
    const setE = (fn: (x: Exit) => void) => doc.edit((l) => { const x = (l.exits ?? []).find((q) => q.id === e.id); if (x) fn(x); });
    const rooms = this.host.shippedLevels.map((s) => [s.id, `${s.id} · ${s.name}`] as [string, string]);
    return [
      this.header('Room exit', e.id, () => { doc.edit(() => doc.removeExit(e.id)); this.host.select(null); }),
      this.row('Id', this.text(e.id, (v) => setE((x) => { x.id = v.trim() || x.id; }))),
      this.row('Position', this.num(e.x, (v) => setE((x) => { x.x = v; }), 0, doc.level.width - 1), this.num(e.y, (v) => setE((x) => { x.y = v; }), 0, doc.level.height - 1)),
      this.row('Size', this.num(e.w, (v) => setE((x) => { x.w = v; }), 1, 60), this.num(e.h, (v) => setE((x) => { x.h = v; }), 1, 60)),
      this.row('To room', this.text(e.to, (v) => setE((x) => { x.to = v; }), 'room id')),
      rooms.length ? this.row('', this.select('', [['', 'pick a known room…'], ...rooms], (v) => { if (v) setE((x) => { x.to = v; }); })) : h('span'),
      this.row('To exit', this.text(e.toExit, (v) => setE((x) => { x.toExit = v; }), 'exit id in that room')),
      h('div', { class: 'ed-muted' }, 'Exits sit on the room edge (open the wall there). Walking into one moves Pip to the linked exit of the other room. Used by the connected world.'),
    ];
  }

  private inspectImage(im: PixelArt): HTMLElement[] {
    const { doc } = this.host;
    const setI = (fn: (x: PixelArt) => void) => doc.edit((l) => { const x = (l.images ?? []).find((q) => q.id === im.id); if (x) fn(x); });
    const c = artCanvas(im);
    c.style.cssText = 'width:100%;image-rendering:pixelated;background:#14121a;border:2px solid #1c1a24;max-height:140px;object-fit:contain';
    return [
      this.header('Image', im.id, () => { doc.edit(() => doc.removeImage(im.id)); this.host.select(null); }),
      c,
      this.row('Position', this.num(im.x, (v) => setI((x) => { x.x = v; }), -50, doc.level.width, 0.0625), this.num(im.y, (v) => setI((x) => { x.y = v; }), -50, doc.level.height, 0.0625)),
      this.row('Layer', this.select(im.layer, [['bg', 'Behind the playfield'], ['fg', 'In front of Pip']], (v) => setI((x) => { x.layer = v as 'bg'; }))),
      this.row('Parallax', ...this.slider(im.parallax ?? 1, 0.1, 1, 0.05, (v) => setI((x) => { x.parallax = v; }))),
      this.row('Opacity', ...this.slider(im.opacity ?? 1, 0.1, 1, 0.05, (v) => setI((x) => { x.opacity = v; }))),
      h('div', { class: 'ed-muted' }, `${im.w}×${im.h} pixels (${(im.w / 16).toFixed(1)}×${(im.h / 16).toFixed(1)} tiles), ${im.palette.length} colours. Drag it with the Select tool on the Images layer.`),
    ];
  }

  /** Events this object or zone takes part in, plus quick ways to wire it. */
  private linksFor(id: string, o?: LevelObject, z?: Zone): HTMLElement[] {
    const { doc } = this.host;
    const l = doc.level;
    const out: HTMLElement[] = [h('div', { class: 'ed-sec' }, 'Logic')];
    l.events.forEach((e, i) => {
      if (!eventMentions(e, id)) return;
      out.push(h('div', { class: 'ed-lrow', title: 'Open in Events', onclick: () => this.openEvent(i), onmouseenter: () => { this.host.st.focusEvent = i; }, onmouseleave: () => { this.host.st.focusEvent = null; } },
        h('span', { class: 'nm', style: 'font-size:11.5px' }, describeEvent(l, e)), h('span', {}, '›')));
    });
    const starts = triggersFor(o ? { obj: o } : z ? { zone: z } : {});
    if (starts.length) {
      out.push(h('div', { class: 'ed-row' }, h('label', {}, 'When this…'), this.select('', [['', 'add an event…'], ...starts.map((sp) => [sp.type, sp.label] as [string, string])], (v) => {
        if (!v) return;
        this.addEvent(makeTrigger(v, { level: l, target: id }));
      })));
    }
    out.push(h('div', { class: 'ed-muted' }, 'Or use the Link tool: click this, then click what it should affect.'));
    return out;
  }

  // --- layers -------------------------------------------------------------------

  private layersPanel(): HTMLElement[] {
    const { st } = this.host;
    return [
      h('h3', { class: 'ed-h' }, 'Layers', h('small', {}, 'top draws over bottom')),
      ...LAYERS.map((L) => h('div', { class: `ed-lrow ${st.layer === L.id ? 'on' : ''}`, title: L.hint, onclick: () => this.host.setLayer(L.id) },
        h('span', {}, LAYER_ICON[L.id]), h('span', { class: 'nm' }, L.label),
        h('input', { type: 'range', min: 0.1, max: 1, step: 0.05, value: st.opacity[L.id], title: 'Opacity preview', onclick: (e) => e.stopPropagation(), oninput: (e) => { st.opacity[L.id] = Number((e.target as HTMLInputElement).value); } }),
        h('button', { title: st.visible[L.id] ? 'Hide' : 'Show', onclick: (e) => { e.stopPropagation(); st.visible[L.id] = !st.visible[L.id]; this.refresh(); } }, st.visible[L.id] ? '👁' : '◌'),
        h('button', { title: st.locked[L.id] ? 'Unlock' : 'Lock', onclick: (e) => { e.stopPropagation(); st.locked[L.id] = !st.locked[L.id]; this.refresh(); } }, st.locked[L.id] ? '🔒' : '🔓'))),
      h('div', { class: 'ed-muted' }, 'Click a layer to paint on it. Hidden and locked layers can’t be edited. Opacity only affects this preview.'),
      h('h3', { class: 'ed-h', style: 'margin-top:10px' }, 'Preview'),
      this.row('Grid', this.check(st.grid, (v) => { st.grid = v; })),
      this.row('Darkness', this.check(st.previewDark, (v) => { st.previewDark = v; }), h('span', { class: 'ed-muted' }, this.host.doc.level.dark ? 'see the dark room as players do' : 'only for dark rooms')),
    ];
  }

  // --- level settings ------------------------------------------------------------

  private levelSettings(): HTMLElement[] {
    const { doc } = this.host;
    const l = doc.level;
    const r = l.rules ?? {};
    const setR = (fn: (rr: NonNullable<typeof l.rules>) => void) => doc.edit((x) => { x.rules ??= {}; fn(x.rules); if (!Object.keys(x.rules).length) delete x.rules; });
    const errs = doc.validate();
    const warns = doc.warnings();
    const music = l.audio?.theme ? 'custom' : String(l.audio?.music ?? (l.act ?? 1));
    const size = (w: number, hh: number, label: string) => h('button', { class: `ed-mini ${l.width === w && l.height === hh ? 'on' : ''}`, title: `${w}×${hh}`, onclick: () => { doc.resize(w, hh); this.host.fit(); } }, label);
    return [
      h('h3', { class: 'ed-h' }, 'Level', h('small', {}, `${l.width}×${l.height} · ${kindOf(l)}`)),
      errs.length ? h('div', { class: 'ed-warn' }, h('b', {}, '✕ Can’t play yet'), ...errs.map((e) => h('span', {}, e))) : h('div', { class: 'ed-muted' }, '✓ Playable.'),
      warns.length ? h('div', { class: 'ed-warn' }, h('b', {}, `⚠ ${warns.length} to check`), ...warns.slice(0, 6).map((w) => h('span', {}, w))) : h('span'),
      this.row('Name', this.text(l.name, (v) => doc.edit((x) => { x.name = v.trim() || 'Untitled'; }, true))),
      this.row('Id', this.text(l.id, (v) => doc.edit((x) => { x.id = v.trim() || 'custom'; }, true))),
      this.row('Kind', this.select(kindOf(l), [['chamber', 'Chamber (puzzle room)'], ['zone', 'Zone (exploration)']], (v) => this.host.doc.setKind(v as Kind))),
      h('div', { class: 'ed-muted' }, 'Kind is a label for the map and the banner. Any size and any mechanic work in both.'),
      h('div', { class: 'ed-sec' }, 'Size'),
      this.row('Width', this.num(l.width, (v) => doc.resize(v, l.height), MIN_W, MAX_W), h('span', { style: 'opacity:.6' }, '×'), this.num(l.height, (v) => doc.resize(l.width, v), MIN_H, MAX_H), h('span', { style: 'opacity:.6;font-size:11px' }, 'tiles')),
      h('div', { class: 'ed-chips' }, size(8, 5, 'Closet'), size(24, 12, 'One screen'), size(48, 20, 'Wide'), size(80, 30, 'Big'), size(160, 50, 'Huge'), size(MAX_W, MAX_H, 'Max')),
      h('div', { class: 'ed-muted' }, `From ${MIN_W}×${MIN_H} to ${MAX_W}×${MAX_H}. Or drag the green corner of the room on the map. Shrinking crops from the right and bottom.`),
      h('div', { class: 'ed-sec' }, 'Look & sound'),
      this.row('Dark room', this.check(!!l.dark, (v) => doc.edit((x) => { if (v) x.dark = true; else delete x.dark; })), h('span', { class: 'ed-muted' }, 'only the flashlight and lights see')),
      this.row('Look', this.select(String(l.biome ?? l.act ?? 1), [['1', 'Sterile wing'], ['2', 'Flooded bio-lab'], ['3', 'Deep containment']], (v) => doc.edit((x) => { x.biome = Number(v); x.act = Number(v); x.palette = Number(v); }))),
      this.row('Music', this.select(music, [['0', 'Title theme'], ['1', 'Act 1'], ['2', 'Act 2'], ['3', 'Act 3'], ['4', 'Credits'], ['custom', 'Your theme (composer)']], (v) => {
        if (v === 'custom') { this.openMusicStudio(); return; }
        doc.edit((x) => { x.audio ??= {}; x.audio.music = Number(v); delete x.audio.theme; });
      })),
      h('div', { class: 'ed-sec' }, 'Pip'),
      this.row('Wall jump', this.select(l.abilities?.wallJump === false ? 'off' : 'on', [['on', 'on'], ['off', 'off']], (v) => doc.edit((x) => {
        if (v === 'on') { if (x.abilities) delete x.abilities.wallJump; } else { x.abilities ??= {}; x.abilities.wallJump = false; }
        if (x.abilities && !Object.keys(x.abilities).length) delete x.abilities;
      }))),
      this.row('Air jumps', ...this.slider(l.abilities?.airJumps ?? 0, 0, 3, 1, (v) => doc.edit((x) => {
        x.abilities ??= {};
        if (v > 0) x.abilities.airJumps = v; else delete x.abilities.airJumps;
        if (!Object.keys(x.abilities).length) delete x.abilities;
      }), (x) => (x ? `${x}` : 'none'))),
      this.row('Gravity', ...this.slider(r.gravity ?? 1, 0.5, 2, 0.05, (v) => setR((rr) => { if (v === 1) delete rr.gravity; else rr.gravity = v; }), (x) => `×${x.toFixed(2)}`)),
      this.row('Jump', ...this.slider(r.jump ?? 1, 0.5, 2, 0.05, (v) => setR((rr) => { if (v === 1) delete rr.jump; else rr.jump = v; }), (x) => `×${x.toFixed(2)}`)),
      this.row('Run speed', ...this.slider(r.speed ?? 1, 0.5, 2, 0.05, (v) => setR((rr) => { if (v === 1) delete rr.speed; else rr.speed = v; }), (x) => `×${x.toFixed(2)}`)),
      h('div', { class: 'ed-sec' }, 'Bodies'),
      this.row('Body cap', ...this.slider(r.maxCorpses ?? 3, 1, 6, 1, (v) => setR((rr) => { if (v === 3) delete rr.maxCorpses; else rr.maxCorpses = v; }), (x) => String(x))),
      this.row('Bodies age', this.check(r.aging !== false, (v) => setR((rr) => { if (v) delete rr.aging; else rr.aging = false; }))),
      this.row('Rot bounce', ...this.slider(r.bounce ?? 1, 0.5, 2, 0.05, (v) => setR((rr) => { if (v === 1) delete rr.bounce; else rr.bounce = v; }), (x) => `×${x.toFixed(2)}`)),
      this.row('Par deaths', this.num(l.par ?? 0, (v) => doc.edit((x) => { if (v > 0) x.par = v; else delete x.par; }, true), 0, 99)),
      h('div', { class: 'ed-sec' }, 'Water current'),
      this.row('Direction', this.select(String(l.current?.dir ?? 1), [['1', '→ right'], ['-1', '← left']], (v) => doc.edit((x) => { x.current = { dir: Number(v) as -1 | 1, speed: x.current?.speed ?? 2 }; }))),
      this.row('Speed t/s', ...this.slider(l.current?.speed ?? 0, 0, 8, 0.1, (v) => doc.edit((x) => { x.current = { dir: x.current?.dir ?? 1, speed: v }; }), (x) => x.toFixed(1))),
      ...this.varsPanel(),
      h('div', { class: 'ed-muted', style: 'margin-top:6px' }, 'Keys: V B U L G I S E tools · 1–6 layers · [ ] brush · P playtest · Space-drag pan · wheel zoom · 0 fit · Del deletes what’s under the cursor · Ctrl+K commands'),
    ];
  }

  /** Variables: numbers events and gadgets can count with. */
  private varsPanel(): HTMLElement[] {
    const { doc } = this.host;
    const l = doc.level;
    const vars = l.vars ?? [];
    const setV = (i: number, fn: (v: LevelVar) => void) => doc.edit((x) => { const v = x.vars?.[i]; if (v) fn(v); });
    const renameVar = (from: string, to: string) => doc.edit((x) => {
      const fix = (o: unknown): void => {
        if (!o || typeof o !== 'object') return;
        const r = o as Record<string, unknown>;
        if ((r.type === 'var' || r.type === 'setVar') && r.name === from) r.name = to;
        if (r.cond) fix(r.cond);
      };
      for (const ev of x.events) { fix(ev.trigger); ev.if?.forEach(fix); ev.actions.forEach(fix); }
      for (const o of x.objects) if (o.type === 'gadget') { if (o.when) fix(o.when); if (o.effect.kind === 'collect' && o.effect.var === from) o.effect.var = to; }
      const v = x.vars?.find((q) => q.name === from);
      if (v) v.name = to;
    });
    return [
      h('div', { class: 'ed-sec' }, 'Variables', this.mini('+ variable', () => doc.edit((x) => { x.vars ??= []; let n = 1; while (x.vars.some((v) => v.name === `var${n}`)) n++; x.vars.push({ name: `var${n}`, value: 0 }); }))),
      vars.length ? h('span') : h('div', { class: 'ed-muted' }, 'Numbers your events can set, add to and test: keys, coins, switches, laps, a score. Coins and keys make their own.'),
      ...vars.map((v, i) => h('div', { class: 'ed-card', style: 'padding:5px;gap:4px' },
        h('div', { class: 'ed-row' }, h('input', { type: 'text', value: v.name, title: 'Name (links follow a rename)', onchange: (e) => {
          const n = (e.target as HTMLInputElement).value.trim().replace(/\s+/g, '_');
          if (n && n !== v.name && !vars.some((q) => q.name === n)) renameVar(v.name, n); else (e.target as HTMLInputElement).value = v.name;
        } }), h('span', { style: 'opacity:.6;font-size:11px' }, 'starts at'), h('input', { type: 'number', class: 'ed-in', style: 'flex:0 0 54px', value: v.value, onchange: (e) => setV(i, (q) => { q.value = Number((e.target as HTMLInputElement).value) || 0; }) }),
          h('button', { class: 'ed-x', title: 'Delete variable', onclick: () => doc.edit((x) => { x.vars?.splice(i, 1); if (!x.vars?.length) delete x.vars; }) }, '✕')),
        h('div', { class: 'ed-row' }, h('label', { style: 'display:flex;gap:3px;align-items:center;flex:0 0 auto;opacity:1' }, this.check(!!v.keep, (b) => setV(i, (q) => { if (b) q.keep = true; else delete q.keep; })), 'keep after death'),
          h('input', { type: 'text', value: v.show ?? '', placeholder: 'on-screen label', title: 'Show it on the HUD with this label (blank = hidden)', onchange: (e) => setV(i, (q) => { const t = (e.target as HTMLInputElement).value.trim(); if (t) q.show = t; else delete q.show; }) })))),
    ];
  }

  // --- events -------------------------------------------------------------------

  /** Open one event in the Events tab (and scroll to it). */
  openEvent(i: number): void {
    this.host.st.rightTab = 'events';
    this.openEvents.add(i);
    this.scrollToEvent = i;
    this.renderRight();
  }

  /** Add an event with a trigger and open it. */
  addEvent(trigger: Trigger, actions: Action[] = []): void {
    const { doc } = this.host;
    doc.edit((l) => { l.events.push({ trigger, actions, once: true }); });
    this.openEvent(doc.level.events.length - 1);
  }

  private eventsList(): HTMLElement[] {
    const { doc, st } = this.host;
    const l = doc.level;
    const evs = l.events;
    const q = this.eventFilter.trim().toLowerCase();
    const out: HTMLElement[] = [h('h3', { class: 'ed-h' }, 'Events', h('small', {}, `${evs.length}`), h('span', { style: 'margin-left:auto' }),
      this.mini('⤳ Link tool', () => this.host.startLink(), 'Click what starts it on the map, then click what should happen'),
      this.mini('+ New', () => this.addEvent(makeTrigger('start', { level: l })), 'A blank event (When the level starts → …)'))];
    out.push(h('div', { class: 'ed-muted' }, 'Each event: ', h('b', {}, 'When'), ' something happens, ', h('b', {}, 'only if'), ' conditions hold, ', h('b', {}, 'do'), ' actions. Use ◉ to pick things on the map.'));
    const warns = doc.warnings();
    if (warns.length) out.push(h('div', { class: 'ed-warn' }, h('b', {}, `⚠ ${warns.length} thing${warns.length > 1 ? 's' : ''} to check`), ...warns.slice(0, 8).map((w) => h('span', {}, w)), warns.length > 8 ? h('span', {}, `…and ${warns.length - 8} more`) : null));
    if (evs.length > 4) out.push(h('input', { class: 'ed-search', style: 'margin:0;width:100%', placeholder: 'Filter events…', value: this.eventFilter, oninput: (e) => { this.eventFilter = (e.target as HTMLInputElement).value; this.renderRight(); const inp = this.right.querySelector('.ed-scroll .ed-search') as HTMLInputElement | null; inp?.focus(); inp?.setSelectionRange(inp.value.length, inp.value.length); } }));
    if (!evs.length) out.push(h('div', { class: 'ed-empty' }, h('span', { class: 'big' }, '⤳'), h('b', {}, 'No events yet'),
      h('span', {}, 'Events are your level’s logic: traps, doors that open, counters, teleports, messages, new rules. Fastest way: press the Link tool, click a zone, pad or object on the map, then click what should happen.')));
    evs.forEach((ev, i) => {
      if (q && !describeEvent(l, ev).toLowerCase().includes(q) && !(ev.name ?? '').toLowerCase().includes(q)) return;
      out.push(this.eventCard(ev, i));
    });
    if (st.focusEvent !== null && st.focusEvent >= evs.length) st.focusEvent = null;
    return out;
  }

  private editEvent(i: number, fn: (e: LevelEvent) => void): void {
    this.host.doc.edit((l) => { const e = l.events[i]; if (e) fn(e); });
  }

  private eventCard(ev: LevelEvent, i: number): HTMLElement {
    const { doc, st } = this.host;
    const l = doc.level;
    const open = this.openEvents.has(i);
    const off = ev.enabled === false;
    const toggle = () => { if (open) this.openEvents.delete(i); else this.openEvents.add(i); this.renderRight(); };
    const removeAt = () => {
      doc.edit((lv) => { lv.events.splice(i, 1); });
      this.openEvents = new Set([...this.openEvents].filter((k) => k !== i).map((k) => (k > i ? k - 1 : k)));
      st.focusEvent = null;
    };
    const summary = h('span', { class: 'sum' }, ev.name ? h('b', {}, `${ev.name}: `) : null, describeEvent(l, ev));
    const head = h('div', { class: 'ed-evhead', onclick: toggle },
      h('span', { class: 'tw' }, open ? '▾' : '▸'), summary,
      h('button', { title: off ? 'Turn on' : 'Turn off (keep it, but it won’t fire)', onclick: (e) => { e.stopPropagation(); this.editEvent(i, (x) => { if (x.enabled === false) delete x.enabled; else x.enabled = false; }); } }, off ? '◌' : '⏻'),
      h('button', { title: 'Duplicate', onclick: (e) => { e.stopPropagation(); doc.edit((lv) => { lv.events.splice(i + 1, 0, JSON.parse(JSON.stringify(ev)) as LevelEvent); }); this.openEvents = new Set([...this.openEvents].map((k) => (k > i ? k + 1 : k))); this.openEvent(i + 1); } }, '⧉'),
      h('button', { title: 'Delete event', style: 'color:#c93f4f', onclick: (e) => { e.stopPropagation(); removeAt(); } }, '✕'));
    const card = h('div', { class: `ed-ev ${off ? 'off' : ''} ${st.focusEvent === i ? 'focus' : ''}`, 'data-ev': i,
      onmouseenter: () => { st.focusEvent = i; }, onmouseleave: () => { if (st.focusEvent === i) st.focusEvent = null; } }, head);
    if (!open) return card;

    const t = ev.trigger as unknown as Record<string, unknown>;
    const body = h('div', { class: 'ed-evbody' });
    body.append(this.row('Name', this.text(ev.name ?? '', (v) => this.editEvent(i, (x) => { if (v.trim()) x.name = v.trim(); else delete x.name; }), 'optional, e.g. “Vault opens”')));
    // WHEN
    body.append(h('div', { class: 'ed-sec' }, 'When'));
    body.append(this.row('', this.specSelect(TRIGGERS, ev.trigger.type, (type) => this.editEvent(i, (x) => {
      const keep = triggerRefs(x.trigger)[0]?.id;
      x.trigger = makeTrigger(type, { level: l, target: keep });
    }))));
    const tspec = triggerSpec(ev.trigger.type);
    if (tspec.hint) body.append(h('div', { class: 'ed-muted' }, tspec.hint));
    body.append(...this.fieldsFor(tspec, t, (fn) => this.editEvent(i, (x) => fn(x.trigger as unknown as Record<string, unknown>))));
    // ONLY IF
    const conds = ev.if ?? [];
    body.append(h('div', { class: 'ed-sec' }, 'Only if', this.mini('+ condition', () => this.editEvent(i, (x) => { (x.if ??= []).push(makeCond(l.vars?.length ? 'var' : 'pressed', { level: l })); }), 'Only fire while this holds')));
    if (!conds.length) body.append(h('div', { class: 'ed-muted' }, 'Always (no conditions).'));
    conds.forEach((c, j) => body.append(this.condEditor(c,
      (nc) => this.editEvent(i, (x) => { if (x.if) x.if[j] = nc; }),
      (fn) => this.editEvent(i, (x) => { const cc = x.if?.[j]; if (cc) fn(cc as unknown as Record<string, unknown>); }),
      () => this.editEvent(i, (x) => { x.if?.splice(j, 1); if (!x.if?.length) delete x.if; }))));
    // DO
    body.append(h('div', { class: 'ed-sec' }, 'Do'));
    ev.actions.forEach((a, j) => body.append(this.actionBlock(a, i, j, ev.actions.length)));
    body.append(this.row('', this.specSelect(ACTIONS, '', (type) => this.editEvent(i, (x) => { x.actions.push(makeAction(type, { level: l, cell: this.cellNear() })); }), '+ add an action…')));
    body.append(this.row('Once per life', this.check(!!ev.once, (v) => this.editEvent(i, (x) => { if (v) x.once = true; else delete x.once; })), h('span', { class: 'ed-muted' }, 'off = every time')));
    card.append(body);
    return card;
  }

  /** A cell near the middle of the view (default spot for new point/rect actions). */
  private cellNear(): Pt {
    const r = this.host.viewRect();
    return { x: Math.max(1, Math.floor(r.x + r.w / 2)), y: Math.max(1, Math.floor(r.y + r.h / 2)) };
  }

  private actionBlock(a: Action, i: number, j: number, n: number): HTMLElement {
    const { doc } = this.host;
    const l = doc.level;
    const spec = actionSpec(a.type);
    const put = (fn: (r: Record<string, unknown>) => void) => this.editEvent(i, (e) => { const x = e.actions[j]; if (x) fn(x as unknown as Record<string, unknown>); });
    const move = (d: number) => this.editEvent(i, (e) => { const k = j + d; if (k < 0 || k >= e.actions.length) return; const [x] = e.actions.splice(j, 1); e.actions.splice(k, 0, x!); });
    const delay = h('input', { type: 'number', class: 'ed-in', style: 'flex:0 0 64px', value: +((a.delay ?? 0) / 60).toFixed(2), min: 0, step: 0.1, title: 'Wait this many seconds first',
      onchange: (e) => put((x) => { const s = Number((e.target as HTMLInputElement).value); if (s > 0) x.delay = Math.round(s * 60); else delete x.delay; }) });
    const head = h('div', { class: 'ed-row' },
      this.specSelect(ACTIONS, a.type, (type) => this.editEvent(i, (e) => {
        const old = e.actions[j] as unknown as Record<string, unknown> | undefined;
        const na = makeAction(type, { level: l, target: typeof old?.target === 'string' ? old.target : undefined, cell: (old?.rect as Pt | undefined) ?? (old?.to as Pt | undefined) ?? (old?.at as Pt | undefined) ?? this.cellNear() });
        if (old?.delay) na.delay = old.delay as number;
        e.actions[j] = na;
      })),
      h('button', { class: 'ed-x', style: 'margin-left:0', title: 'Remove action', onclick: () => this.editEvent(i, (e) => { e.actions.splice(j, 1); }) }, '✕'));
    const timing = h('div', { class: 'ed-row' }, h('label', {}, 'Wait'), delay, h('span', { style: 'opacity:.6;font-size:11px' }, 's first'), h('span', { style: 'flex:1' }),
      j > 0 ? this.mini('↑', () => move(-1), 'Move up') : null,
      j < n - 1 ? this.mini('↓', () => move(1), 'Move down') : null);
    const rows: HTMLElement[] = [head];
    if (spec.hint) rows.push(h('div', { class: 'ed-muted' }, spec.hint));
    rows.push(...this.fieldsFor(spec, a as unknown as Record<string, unknown>, put), timing);
    return h('div', { class: 'ed-act' }, ...rows);
  }

  /** A condition: type + its fields. */
  private condEditor(c: Condition, replace: (c: Condition) => void, put: (fn: (r: Record<string, unknown>) => void) => void, remove?: () => void): HTMLElement {
    const l = this.host.doc.level;
    const spec = condSpec(c.type);
    return h('div', { class: 'ed-cond' },
      h('div', { class: 'ed-row' }, this.specSelect(CONDITIONS, c.type, (type) => replace(makeCond(type, { level: l }))),
        remove ? h('button', { class: 'ed-x', title: 'Remove condition', onclick: remove }, '✕') : null),
      ...this.fieldsFor(spec, c as unknown as Record<string, unknown>, put),
      h('div', { class: 'ed-muted' }, `= ${describeCond(l, c)}`));
  }

  /** A <select> of specs, grouped. */
  private specSelect(specs: Spec[], v: string, on: (type: string) => void, placeholder?: string): HTMLSelectElement {
    const sel = h('select', { onchange: (e) => { const val = (e.target as HTMLSelectElement).value; if (val) on(val); } },
      placeholder ? h('option', { value: '', selected: !v }, placeholder) : null,
      ...grouped(specs).map(([g, list]) => {
        const og = h('optgroup', { label: g });
        og.append(...list.map((s) => h('option', { value: s.type, selected: s.type === v, title: s.hint }, s.label)));
        return og;
      }));
    return sel;
  }

  /** Controls for every field of a spec on a record. `put` applies a change to the live record (inside an undo step). */
  private fieldsFor(spec: Spec, rec: Record<string, unknown>, put: (fn: (r: Record<string, unknown>) => void) => void): HTMLElement[] {
    return spec.fields.map((f) => {
      if (f.kind.k === 'cond') {
        const c = rec[f.key] as Condition | undefined;
        if (!c) return h('span');
        return this.condEditor(c, (nc) => put((r) => { r[f.key] = nc; }),
          (fn) => put((r) => { const cc = r[f.key] as Record<string, unknown> | undefined; if (cc) fn(cc); }));
      }
      return this.field(f, rec[f.key], (v) => put((r) => setField(r, f, v)), rec);
    });
  }

  /** One field row with the right control and, for anything on the map, an eyedropper. */
  field(f: Field, val: unknown, set: (v: unknown) => void, rec: Record<string, unknown> = {}): HTMLElement {
    const { doc } = this.host;
    const l = doc.level;
    const k = f.kind;
    const eye = (title: string, run: () => void) => h('button', { class: 'ed-eye', title, onclick: run }, '◉');
    const opt = f.optional;
    switch (k.k) {
      case 'zone': {
        const zones = l.zones.map((z) => [z.id, z.id] as [string, string]);
        return this.row(f.label, this.select(String(val ?? ''), zones.length ? (val && !zones.some((z) => z[0] === val) ? [[String(val), `${val} (missing!)`], ...zones] : zones) : [['', '(draw a zone first)']], set),
          eye('Pick a zone on the map', () => this.host.pick({ type: 'zone', prompt: `Click a zone for “${f.label}”`, onPick: set })));
      }
      case 'obj': case 'plate': {
        const fits = (o: LevelObject) => k.k === 'plate' ? (o.type === 'plate' || o.type === 'sensor') : fitsObj(k, o);
        const opts: Array<[string, string]> = [...(k.k === 'obj' ? k.any ?? [] : []), ...l.objects.filter(fits).map((o) => [o.id, `${nameOf(l, o.id)}${o.type === 'gadget' ? '' : ` · ${o.type}`}`] as [string, string])];
        const v = String(val ?? '');
        if (v && !opts.some((o) => o[0] === v)) opts.unshift([v, `${v} (missing!)`]);
        if (!opts.length) opts.push(['', `(place one first)`]);
        const what = k.k === 'plate' ? 'a pad or light sensor' : k.types?.length === 1 ? `a ${k.types[0]}` : 'an object';
        return this.row(f.label, this.select(v, opt ? [['', '— any —'], ...opts] : opts, (x) => set(x || undefined)),
          eye(`Pick ${what} on the map`, () => this.host.pick({ type: 'object', prompt: `Click ${what} for “${f.label}”`, accept: fits, onPick: set })));
      }
      case 'var': {
        const listId = 'ed-vars-dl';
        const names = (l.vars ?? []).map((x) => x.name);
        const inp = h('input', { type: 'text', value: String(val ?? ''), list: listId, placeholder: 'name', title: 'Type a new name to create a variable', onchange: (e) => {
          const name = (e.target as HTMLInputElement).value.trim().replace(/\s+/g, '_');
          if (!name) return;
          doc.edit(() => { doc.ensureVar(name); });
          set(name);
        } });
        return this.row(f.label, inp, h('datalist', { id: listId }, ...names.map((n) => h('option', { value: n }))));
      }
      case 'signal': {
        const listId = 'ed-sig-dl';
        const names = new Set<string>();
        for (const ev of l.events) { if (ev.trigger.type === 'signal') names.add(ev.trigger.name); for (const a of ev.actions) if (a.type === 'signal') names.add(a.name); }
        return this.row(f.label, h('input', { type: 'text', value: String(val ?? ''), list: listId, placeholder: 'any name', onchange: (e) => set((e.target as HTMLInputElement).value.trim() || 'go') }),
          h('datalist', { id: listId }, ...[...names].map((n) => h('option', { value: n }))));
      }
      case 'point': {
        const p = val as Pt | undefined;
        return this.row(f.label, h('span', { style: 'flex:1' }, p ? `tile ${p.x}, ${p.y}` : '—'),
          eye('Click the spot on the map', () => this.host.pick({ type: 'point', prompt: `Click the spot for “${f.label}”`, onPick: set })));
      }
      case 'rect': {
        const r = val as TileRect | undefined;
        return this.row(f.label, h('span', { style: 'flex:1' }, r ? `${r.w}×${r.h} at ${r.x}, ${r.y}` : '—'),
          eye('Drag over the tiles on the map', () => this.host.pick({ type: 'rect', prompt: `Drag over the tiles for “${f.label}”`, onPick: set })));
      }
      case 'path': {
        const pts = (val as Pt[] | undefined) ?? [];
        const base = k.rel ? (rec.rect as TileRect | undefined) : undefined;
        const abs = (p: Pt) => (base ? { x: p.x + base.x, y: p.y + base.y } : p);
        const text = pts.length ? pts.map((p) => { const q = abs(p); return `${q.x},${q.y}`; }).join(' → ') : '—';
        return this.row(f.label, h('span', { style: 'flex:1;font-size:11px' }, text),
          eye('Click points on the map, in order (Done when finished)', () => {
            const acc: Pt[] = [];
            set([]);
            this.host.pick({ type: 'point', repeat: true, prompt: `Click the path for “${f.label}”, point by point. Done when finished.`, onPick: (c) => {
              acc.push(base ? { x: c.x - base.x, y: c.y - base.y } : c);
              set([...acc]);
            } });
          }));
      }
      case 'num': {
        const n = val === undefined ? '' : Number(val);
        const inp = h('input', { type: 'number', value: n, min: k.min, max: k.max, step: k.step, placeholder: opt ? 'unchanged' : '', onchange: (e) => {
          const raw = (e.target as HTMLInputElement).value;
          if (raw === '' && opt) { set(undefined); return; }
          const x = Number(raw);
          if (Number.isFinite(x)) set(Math.min(k.max, Math.max(k.min, x)));
        } });
        return this.row(f.label, inp, k.unit ? h('span', { style: 'opacity:.6;font-size:11px' }, k.unit) : null);
      }
      case 'secs': {
        const inp = h('input', { type: 'number', value: val === undefined ? '' : +(Number(val) / 60).toFixed(2), min: 0, step: 0.1, placeholder: opt ? 'auto' : '', onchange: (e) => {
          const raw = (e.target as HTMLInputElement).value;
          if (raw === '' && opt) { set(undefined); return; }
          const x = Number(raw);
          if (Number.isFinite(x) && x >= 0) set(Math.max(f.key === 'ticks' ? 1 : 0, Math.round(x * 60)));
        } });
        return this.row(f.label, inp, h('span', { style: 'opacity:.6;font-size:11px' }, 's'));
      }
      case 'text': return this.row(f.label, k.long ? this.area(String(val ?? ''), (v) => set(v)) : this.text(String(val ?? ''), (v) => set(v)));
      case 'choice': return this.row(f.label, this.select(String(val ?? ''), opt ? [['', '—'], ...k.opts] : k.opts, (v) => set(v || undefined)));
      case 'bool': return this.row(f.label, this.select(val === false ? 'n' : 'y', [['y', k.yes], ['n', k.no]], (v) => set(v === 'y')));
      case 'tri': return this.row(f.label, this.select(val === undefined ? '' : val ? 'y' : 'n', [['', 'unchanged'], ['y', k.yes], ['n', k.no]], (v) => set(v === '' ? undefined : v === 'y')));
      case 'sound': return this.row(f.label, this.select(String(val ?? 'pop'), soundList().map((s) => [s.name, s.name] as [string, string]), set), h('button', { class: 'ed-eye', title: 'Listen', onclick: () => { const nm = String(val ?? 'pop'); const ov = l.audio?.sfx?.[nm]; void playParams(ov ? fill(ov) : baseParams(nm)); } }, '♪'));
      case 'tile': return this.row(f.label, this.select(String(val ?? '#'), TILES, set));
      case 'cause': return this.row(f.label, this.select(String(val ?? ''), [['', opt ? 'any' : 'spikes'], ...CAUSES], (v) => set(v || undefined)));
      case 'op': return this.row(f.label, this.select(String(val ?? '>='), OPS, set));
      case 'cond': return h('span');
    }
  }

  // ---------------------------------------------------------------------------
  // Status bar & minimap
  // ---------------------------------------------------------------------------

  private renderStatus(): void {
    const { st, doc } = this.host;
    const L = LAYERS.find((x) => x.id === st.layer)!;
    const tool = TOOLS.find((t) => t.id === st.tool)!;
    this.status.replaceChildren(
      h('span', {}, 'Layer ', h('b', {}, L.label)),
      h('span', {}, 'Tool ', h('b', {}, tool.label)),
      h('span', {}, st.item[st.layer] ? h('b', {}, st.item[st.layer]!.label) : ''),
      h('span', { style: 'flex:1;opacity:.8' }, this.statusText),
      h('span', {}, `${doc.level.width}×${doc.level.height}`),
      h('span', {}, h('b', {}, `${Math.round(this.host.zoomPct())}%`)),
    );
  }

  /** Redraw the minimap when the level or view changed. */
  drawMinimap(): void {
    const { doc } = this.host;
    const l = doc.level;
    const v = this.host.viewRect();
    const key = `${doc.rev}|${v.x.toFixed(1)}|${v.y.toFixed(1)}|${v.w.toFixed(1)}|${v.h.toFixed(1)}`;
    if (key === this.miniKey) return;
    this.miniKey = key;
    const scale = Math.max(1, Math.min(6, Math.floor(Math.min(180 / l.width, 110 / l.height))));
    const W = l.width * scale, H = l.height * scale;
    const c = this.minimap;
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; c.style.width = `${W}px`; c.style.height = `${H}px`; }
    const g = c.getContext('2d')!;
    g.fillStyle = '#2a2e3a';
    g.fillRect(0, 0, W, H);
    const COL: Record<string, string> = { '#': '#9aa4b4', '=': '#c4a864', X: '#7f8898', '%': '#a08a6a', '^': '#e0564f', v: '#e0564f', '>': '#e0564f', '<': '#e0564f', '~': '#3f8f98', '}': '#5c6575', '{': '#5c6575' };
    const bg = l.decor?.bg;
    for (let y = 0; y < l.height; y++) for (let x = 0; x < l.width; x++) {
      const ch = l.tiles[y]![x]!;
      const col = COL[ch] ?? (bg?.[y]?.[x] && bg[y]![x] !== '.' ? '#3c4252' : null);
      if (col) { g.fillStyle = col; g.fillRect(x * scale, y * scale, scale, scale); }
    }
    for (const o of l.objects) {
      g.fillStyle = o.type === 'spawn' ? '#ffc9a3' : o.type === 'door' ? '#5bf0a0' : o.type === 'relic' ? '#f2b544' : '#e9eef2';
      g.fillRect(o.x * scale, o.y * scale, Math.max(2, scale), Math.max(2, scale));
    }
    g.strokeStyle = '#5bf0a0';
    g.lineWidth = 1;
    g.strokeRect(Math.max(0, v.x * scale) + 0.5, Math.max(0, v.y * scale) + 0.5, Math.min(W, v.w * scale) - 1, Math.min(H, v.h * scale) - 1);
  }

  private minimapJump(e: PointerEvent): void {
    const r = this.minimap.getBoundingClientRect();
    const l = this.host.doc.level;
    this.host.centerOn(((e.clientX - r.left) / r.width) * l.width, ((e.clientY - r.top) / r.height) * l.height);
  }

  // ---------------------------------------------------------------------------
  // Pick bar & menus
  // ---------------------------------------------------------------------------

  showPick(req: PickRequest | null): void {
    this.pickBar?.remove();
    this.pickBar = null;
    if (!req) return;
    this.pickBar = h('div', { class: 'ed-pick' }, req.prompt, h('button', { class: 'ed-mini', onclick: () => this.host.pick(null) }, req.type === 'point' && req.repeat ? 'Done' : 'Cancel'));
    this.root.append(this.pickBar);
  }

  showMenu(x: number, y: number, title: string, items: Array<{ label: string; run: () => void }>): void {
    this.closeMenu();
    const m = h('div', { class: 'ed-menu' }, h('h4', {}, title), ...items.map((it) => h('button', { onclick: () => { this.closeMenu(); it.run(); } }, it.label)));
    m.style.left = `${Math.min(x, GAME_W - 200)}px`;
    m.style.top = `${Math.max(TOP_H, Math.min(y, GAME_H - 60 - Math.min(items.length, 14) * 28))}px`;
    this.menu = m;
    this.root.append(m);
  }

  closeMenu(): boolean {
    const had = !!this.menu;
    this.menu?.remove(); this.menu = null;
    return had;
  }

  closeModal(): boolean {
    if (!this.modal) return false;
    stopPreview();
    this.modal.remove();
    this.modal = null;
    this.onModalClose?.();
    return true;
  }

  private openModal(content: HTMLElement): void {
    this.closeModal();
    this.closeMenu();
    this.modal = h('div', { class: 'ed-modal', onclick: (e) => { if (e.target === this.modal) this.closeModal(); } }, content);
    this.root.append(this.modal);
  }

  // ---------------------------------------------------------------------------
  // Templates gallery
  // ---------------------------------------------------------------------------

  openTemplates(): void {
    const card = (title: string, sub: string, run: () => void, thumb?: HTMLCanvasElement) =>
      h('div', { class: 'ed-gcard', onclick: () => { this.closeModal(); run(); } }, thumb ?? null, h('b', {}, title), h('span', { class: 'ed-muted' }, sub));
    const shipped = this.host.shippedLevels;
    const box = h('div', { class: 'ed-studio' },
      h('header', {}, h('h2', {}, 'Start something'), h('button', { class: 'ed-btn', onclick: () => this.closeModal() }, 'Close')),
      h('div', { class: 'ed-gallery' },
        card('Blank chamber', 'One screen, a puzzle room. 24×12.', () => this.host.newLevel('chamber')),
        card('Blank zone', 'A big scrolling area to explore. 80×30.', () => this.host.newLevel('zone')),
        card('Tiny room', 'A closet-sized challenge. 10×6.', () => this.host.newLevel('chamber', 10, 6)),
        card('Giant hall', 'A huge space for a whole adventure. 200×60.', () => this.host.newLevel('zone', 200, 60)),
        card('Last saved draft', 'Pick up where you left off.', () => this.host.openLevel('draft')),
        card('Import a file…', 'A level JSON from your computer.', () => this.fileInput.click()),
        ...shipped.map((s) => card(`${s.id} · ${s.name}`, s.kind === 'zone' ? 'World zone' : s.act ? `Act ${s.act} chamber` : 'Level', () => this.host.openLevel(s.id)))));
    this.openModal(box);
  }

  // ---------------------------------------------------------------------------
  // Command palette
  // ---------------------------------------------------------------------------

  openCommands(): void {
    const host = this.host;
    const cmds: Array<{ label: string; key?: string; run: () => void }> = [
      { label: 'Playtest from the spawn', key: '▶', run: () => host.playtest(false) },
      { label: 'Save draft', key: 'Ctrl+S', run: () => host.save() },
      { label: 'New / open (templates)', run: () => this.openTemplates() },
      { label: 'Import level JSON', run: () => this.fileInput.click() },
      { label: 'Export level JSON', run: () => host.exportFile() },
      { label: 'Share link', run: () => host.share() },
      { label: 'Import & pixelate an image', run: () => this.openImageStudio() },
      { label: 'Sound designer', run: () => this.openSoundStudio() },
      { label: 'Music composer', run: () => this.openMusicStudio() },
      { label: 'Fit room in view', key: '0', run: () => host.fit() },
      { label: 'Toggle grid', key: '#', run: () => host.toggleGrid() },
      { label: 'Undo', key: 'Ctrl+Z', run: () => host.doc.undo() },
      { label: 'Redo', key: 'Ctrl+Shift+Z', run: () => host.doc.redo() },
      { label: 'Show tips', run: () => this.startTips(true) },
      { label: 'Level settings', run: () => { host.st.rightTab = 'level'; this.renderRight(); } },
      ...TOOLS.map((t) => ({ label: `Tool: ${t.label}`, key: t.key, run: () => host.setTool(t.id) })),
      ...LAYERS.map((L) => ({ label: `Layer: ${L.label}`, run: () => host.setLayer(L.id) })),
      ...(['terrain', 'objects', 'bg', 'zones'] as LayerId[]).flatMap((layer) => itemsFor(layer).map((it) => ({ label: `Paint: ${it.label}`, run: () => { host.setLayer(layer === 'bg' ? 'bg' : layer); host.setItem(it); } }))),
    ];
    let sel = 0;
    const input = h('input', { placeholder: 'Type a command, tool, layer or item…' });
    const list = h('div', { class: 'list' });
    let shown = cmds;
    const render = () => {
      const q = input.value.trim().toLowerCase();
      shown = cmds.filter((c) => !q || q.split(/\s+/).every((w) => c.label.toLowerCase().includes(w))).slice(0, 40);
      sel = Math.min(sel, Math.max(0, shown.length - 1));
      list.replaceChildren(...shown.map((c, i) => h('button', { class: i === sel ? 'on' : '', onclick: () => { this.closeModal(); c.run(); } }, c.label, c.key ? h('small', {}, c.key) : null)));
    };
    input.addEventListener('input', () => { sel = 0; render(); });
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'ArrowDown') { sel = Math.min(shown.length - 1, sel + 1); render(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); render(); e.preventDefault(); }
      else if (e.key === 'Enter') { const c = shown[sel]; this.closeModal(); c?.run(); }
      else if (e.key === 'Escape') this.closeModal();
    });
    render();
    this.openModal(h('div', { class: 'ed-cmd' }, input, list));
    setTimeout(() => input.focus(), 20);
  }

  // ---------------------------------------------------------------------------
  // Image studio
  // ---------------------------------------------------------------------------

  openImageStudio(file?: File): void {
    let img: HTMLImageElement | null = null;
    const opt = { tilesW: 8, tilesH: 6, lockAspect: true, colors: 12, dither: true, layer: 'bg' as 'bg' | 'fg', parallax: 1, opacity: 1, cx: 0, cy: 0, cw: 1, ch: 1 };
    const src = h('canvas', { width: 240, height: 180 });
    const out = h('canvas', { width: 128, height: 96 });
    const info = h('div', { class: 'ed-muted' });
    const controls = h('div', { class: 'ed-smain' });
    const drop = h('div', { class: 'ed-drop' }, h('b', {}, 'Drop a picture here'), h('br'), 'or click to choose one (PNG, JPG, GIF, WebP).');
    const picker = h('input', { type: 'file', accept: 'image/*', style: 'display:none', onchange: () => { const f = picker.files?.[0]; if (f) void load(f); } });
    drop.addEventListener('click', () => picker.click());
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); drop.classList.remove('over'); const f = e.dataTransfer?.files?.[0]; if (f) void load(f); });
    let q: ReturnType<typeof quantize> | null = null;
    const update = () => {
      if (!img) return;
      const w = opt.tilesW * 16, hh = opt.tilesH * 16;
      const crop = { x: opt.cx, y: opt.cy, w: Math.max(0.05, Math.min(1 - opt.cx, opt.cw)), h: Math.max(0.05, Math.min(1 - opt.cy, opt.ch)) };
      const rgba = sampleImage(img, w, hh, crop);
      q = quantize(rgba, w, hh, opt.colors, opt.dither);
      const art = makeArt('preview', 0, 0, w, hh, q, opt.layer);
      const pc = artCanvas(art);
      const sc = Math.max(1, Math.floor(Math.min(520 / w, 300 / hh)));
      out.width = w; out.height = hh;
      out.style.width = `${w * sc}px`; out.style.height = `${hh * sc}px`;
      out.getContext('2d')!.drawImage(pc, 0, 0);
      const g = src.getContext('2d')!;
      g.clearRect(0, 0, src.width, src.height);
      const s = Math.min(src.width / img.width, src.height / img.height);
      g.drawImage(img, 0, 0, img.width * s, img.height * s);
      g.strokeStyle = '#5bf0a0'; g.lineWidth = 2;
      g.strokeRect(crop.x * img.width * s, crop.y * img.height * s, crop.w * img.width * s, crop.h * img.height * s);
      const chars = Math.ceil((w * hh * 4) / 3);
      info.textContent = `${w}×${hh} px · ${q.palette.length} colours · ~${(chars / 1000).toFixed(1)}k characters in the level${chars > SHARE_WARN_CHARS ? ' · ⚠ large: share links get long, try fewer tiles' : ''}`;
    };
    const load = async (f: File) => {
      try {
        img = await loadImage(f);
        opt.tilesH = Math.max(1, Math.round(opt.tilesW * (img.height / img.width)));
        drop.replaceWith(h('div', { class: 'ed-imgprev' }, src, out));
        buildControls();
        update();
      } catch { this.toast('That file is not an image.'); }
    };
    const num = (label: string, v: number, min: number, max: number, step: number, set: (n: number) => void) =>
      this.row(label, ...this.slider(v, min, max, step, (n) => { set(n); update(); buildControls(); }, (x) => String(+x.toFixed(2))));
    const buildControls = () => {
      controls.replaceChildren(
        img ? h('div', { class: 'ed-imgprev' }, src, out) : drop,
        info,
        h('div', { class: 'ed-params' },
          num('Width (tiles)', opt.tilesW, 1, 40, 1, (n) => { opt.tilesW = n; if (opt.lockAspect && img) opt.tilesH = Math.max(1, Math.round(n * ((img.height * opt.ch) / (img.width * opt.cw)))); }),
          num('Height (tiles)', opt.tilesH, 1, 30, 1, (n) => { opt.tilesH = n; opt.lockAspect = false; }),
          num('Colours', opt.colors, 2, MAX_COLORS, 1, (n) => { opt.colors = n; }),
          this.row('Dithering', this.check(opt.dither, (v) => { opt.dither = v; update(); })),
          num('Crop left', opt.cx, 0, 0.9, 0.01, (n) => { opt.cx = n; }),
          num('Crop top', opt.cy, 0, 0.9, 0.01, (n) => { opt.cy = n; }),
          num('Crop width', opt.cw, 0.1, 1, 0.01, (n) => { opt.cw = n; }),
          num('Crop height', opt.ch, 0.1, 1, 0.01, (n) => { opt.ch = n; }),
          this.row('Layer', this.select(opt.layer, [['bg', 'Behind the playfield'], ['fg', 'In front of Pip']], (v) => { opt.layer = v as 'bg'; })),
          num('Parallax', opt.parallax, 0.1, 1, 0.05, (n) => { opt.parallax = n; }),
          num('Opacity', opt.opacity, 0.1, 1, 0.05, (n) => { opt.opacity = n; })),
      );
    };
    buildControls();
    const place = () => {
      if (!img || !q) { this.toast('Pick a picture first.'); return; }
      const v = this.host.viewRect();
      const w = opt.tilesW * 16, hh = opt.tilesH * 16;
      const art = makeArt(this.host.doc.newId('img'), Math.max(0, Math.round(v.x + v.w / 2 - opt.tilesW / 2)), Math.max(0, Math.round(v.y + v.h / 2 - opt.tilesH / 2)), w, hh, q, opt.layer);
      art.parallax = opt.parallax; art.opacity = opt.opacity;
      this.host.addImage(art);
      this.closeModal();
      this.toast('Image placed. Drag it with the Select tool on the Images layer.');
    };
    const box = h('div', { class: 'ed-studio' },
      h('header', {}, h('h2', {}, '🖼 Import & pixelate'), h('span', { class: 'ed-muted' }, 'Any picture becomes palette-limited pixel art'),
        h('button', { class: 'ed-btn', onclick: () => picker.click() }, 'Choose file…'), h('button', { class: 'ed-btn go', onclick: place }, 'Place in level'), h('button', { class: 'ed-btn', onclick: () => this.closeModal() }, 'Close')),
      h('div', { class: 'ed-sbody' }, controls), picker);
    this.openModal(box);
    if (file) void load(file);
  }

  // ---------------------------------------------------------------------------
  // Sound designer
  // ---------------------------------------------------------------------------

  openSoundStudio(): void {
    const { doc } = this.host;
    const sounds = soundList();
    let cur = sounds[0]?.name ?? 'jump';
    let filter = '';
    const listEl = h('div', { class: 'ed-slist' });
    const main = h('div', { class: 'ed-smain' });
    const overrides = () => doc.level.audio?.sfx ?? {};
    const params = (): number[] => fill(overrides()[cur] ?? baseParams(cur));
    let live = params();
    const count = h('span', { class: 'ed-muted' });
    const updCount = () => { count.textContent = `${Object.keys(overrides()).length} changed in this level`; };
    const commit = (p: number[]) => {
      doc.edit((l) => { l.audio ??= {}; l.audio.sfx ??= {}; l.audio.sfx[cur] = compact(p); }, true);
      renderList();
      updCount();
    };
    const renderList = () => {
      const q = filter.toLowerCase();
      listEl.replaceChildren(
        h('input', { class: 'ed-search', style: 'margin:0 0 4px;width:100%', placeholder: 'Search sounds…', value: filter, oninput: (e) => { filter = (e.target as HTMLInputElement).value; renderList(); } }),
        ...sounds.filter((s) => !q || s.name.includes(q) || s.desc.toLowerCase().includes(q)).map((s) =>
          h('div', { class: `ed-sitem ${s.name === cur ? 'on' : ''}`, onclick: () => { cur = s.name; live = params(); renderList(); renderMain(); void playParams(live); } },
            h('span', { class: `d ${overrides()[s.name] ? 'on' : ''}`, title: overrides()[s.name] ? 'Changed in this level' : 'Game sound' }), s.name, h('small', {}, s.desc))));
    };
    const renderMain = () => {
      const changed = !!overrides()[cur];
      const sliders = PARAMS.map((m, i) => {
        const out = h('output', {}, String(+live[i]!.toFixed(3)));
        const s = h('input', { type: 'range', min: m.min, max: m.max, step: m.step, value: live[i]!,
          oninput: (e) => { live[i] = Number((e.target as HTMLInputElement).value); out.textContent = String(+live[i]!.toFixed(3)); },
          onchange: () => { commit(live); void playParams(live); renderMain(); } });
        return h('div', { class: 'ed-row', title: m.name }, h('label', { style: 'flex:0 0 120px' }, m.label), s, out);
      });
      main.replaceChildren(
        h('div', { class: 'ed-row', style: 'gap:6px;flex-wrap:wrap' },
          h('b', { style: 'font-size:15px;margin-right:8px' }, cur), h('span', { class: 'ed-muted' }, changed ? 'changed in this level' : 'the game’s sound'),
          h('span', { style: 'flex:1' }),
          h('button', { class: 'ed-btn go', onclick: () => void playParams(live) }, '▶ Play'),
          h('button', { class: 'ed-btn', title: 'A random soft sound', onclick: () => { live = randomize(); commit(live); renderMain(); void playParams(live); } }, '🎲 Random'),
          h('button', { class: 'ed-btn', title: 'Nudge everything a little', onclick: () => { live = mutate(live); commit(live); renderMain(); void playParams(live); } }, '✧ Mutate'),
          this.select('', [['', 'Presets…'], ...PRESETS.map((p, i) => [String(i), p.label] as [string, string])], (v) => { if (v === '') return; live = fill(PRESETS[Number(v)]!.p); commit(live); renderMain(); void playParams(live); }),
          h('button', { class: 'ed-btn', disabled: !changed, title: 'Back to the game’s own sound', onclick: () => { doc.edit((l) => { if (l.audio?.sfx) { delete l.audio.sfx[cur]; if (!Object.keys(l.audio.sfx).length) delete l.audio.sfx; } }, true); live = params(); renderList(); renderMain(); updCount(); } }, 'Reset')),
        h('div', { class: 'ed-params' }, ...sliders),
        h('div', { class: 'ed-muted' }, 'Changes apply to this level only (in playtest and when shared). Sounds are ZzFX: tiny, generated, no files. Tip: low pitch + small release + negative filter = soft and satisfying.'),
      );
    };
    renderList();
    renderMain();
    updCount();
    const box = h('div', { class: 'ed-studio' },
      h('header', {}, h('h2', {}, '♪ Sound designer'), count, h('button', { class: 'ed-btn', onclick: () => this.closeModal() }, 'Done')),
      h('div', { class: 'ed-sbody' }, listEl, main));
    this.openModal(box);
  }

  // ---------------------------------------------------------------------------
  // Music composer
  // ---------------------------------------------------------------------------

  openMusicStudio(): void {
    const { doc } = this.host;
    let song: SongData = normalizeSong(doc.level.audio?.theme ?? TEMPLATES[0]!.make());
    const hadTheme = !!doc.level.audio?.theme;
    let track = song.tracks.findIndex((t) => t.notes.length) >= 0 ? song.tracks.findIndex((t) => t.notes.length) : 0;
    let len = 2;
    let meter = song.steps % 12 === 0 && song.bpm < 90 ? 3 : 4;
    const muted = new Set<number>();
    let playing = false;
    let playStep = -1;
    const cell = 18, rowH = 13;
    const canvas = h('canvas', {});
    const wrap = h('div', { class: 'ed-roll-wrap' }, canvas);
    const controls = h('div', { class: 'ed-row', style: 'gap:6px;flex-wrap:wrap' });
    const tracksEl = h('div', { class: 'ed-tracks' });
    const save = () => doc.edit((l) => { l.audio ??= {}; l.audio.theme = JSON.parse(JSON.stringify(song)) as SongData; delete l.audio.music; }, true);
    const range = () => {
      const inst = INSTRUMENTS[track]!;
      const pitches: number[] = [];
      for (let p = inst.high; p >= inst.low; p--) pitches.push(p);
      return pitches;
    };
    const draw = () => {
      const pitches = range();
      const W = song.steps * cell + 40, H = pitches.length * rowH;
      if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; canvas.style.width = `${W}px`; canvas.style.height = `${H}px`; }
      const g = canvas.getContext('2d')!;
      g.fillStyle = '#14121a'; g.fillRect(0, 0, W, H);
      const drums = INSTRUMENTS[track]!.id === 'drums';
      pitches.forEach((p, r) => {
        g.fillStyle = drums ? (r % 2 ? '#1d1b25' : '#22202c') : isBlack(p) ? '#1a1822' : '#24222e';
        g.fillRect(40, r * rowH, W - 40, rowH);
        g.fillStyle = drums ? '#c4ccd8' : isBlack(p) ? '#3a3846' : '#e9eef2';
        g.fillRect(0, r * rowH, 38, rowH - 1);
        g.fillStyle = drums || isBlack(p) ? '#e9eef2' : '#1c1a24';
        g.font = '9px monospace';
        g.fillText(drums ? DRUM_NAMES[p] ?? '' : p % 12 === 0 ? noteName(p) : '', 3, r * rowH + rowH - 3);
      });
      for (let s = 0; s <= song.steps; s++) {
        g.fillStyle = s % (4 * meter) === 0 ? '#6a6878' : s % 4 === 0 ? '#3c3a48' : '#2a2834';
        g.fillRect(40 + s * cell, 0, 1, H);
      }
      // Other tracks as ghosts.
      song.tracks.forEach((t, ti) => {
        if (ti === track || INSTRUMENTS[ti]!.id === 'drums' || drums) return;
        for (const [st, p, l] of t.notes) {
          const r = pitches.indexOf(p);
          if (r < 0) continue;
          g.fillStyle = 'rgba(255,255,255,.08)';
          g.fillRect(40 + st * cell + 1, r * rowH + 1, l * cell - 2, rowH - 2);
        }
      });
      const col = INSTRUMENTS[track]!.color;
      for (const [st, p, l] of song.tracks[track]!.notes) {
        const r = pitches.indexOf(p);
        if (r < 0) continue;
        g.fillStyle = col;
        g.fillRect(40 + st * cell + 1, r * rowH + 1, l * cell - 2, rowH - 2);
        g.fillStyle = 'rgba(0,0,0,.25)';
        g.fillRect(40 + st * cell + 1, r * rowH + rowH - 3, l * cell - 2, 2);
      }
      if (playStep >= 0) { g.fillStyle = 'rgba(91,240,160,.35)'; g.fillRect(40 + playStep * cell, 0, cell, H); }
    };
    let painting: 'add' | 'del' | null = null;
    const cellAt = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * canvas.width, y = ((e.clientY - r.top) / r.height) * canvas.height;
      if (x < 40) return null;
      return { step: Math.floor((x - 40) / cell), pitch: range()[Math.floor(y / rowH)] };
    };
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => {
      const c = cellAt(e);
      if (!c || c.pitch === undefined || c.step >= song.steps) return;
      const exists = noteAt(song, track, c.step, c.pitch) >= 0;
      painting = e.button === 2 || exists ? 'del' : 'add';
      if ((painting === 'add') !== exists) {
        toggleNote(song, track, c.step, c.pitch, INSTRUMENTS[track]!.id === 'drums' ? 1 : len);
        if (painting === 'add') previewNote(INSTRUMENTS[track]!.id, c.pitch, song.tracks[track]!.volume);
      }
      canvas.setPointerCapture(e.pointerId);
      draw();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!painting) return;
      const c = cellAt(e);
      if (!c || c.pitch === undefined || c.step >= song.steps) return;
      const exists = noteAt(song, track, c.step, c.pitch) >= 0;
      if (painting === 'add' && !exists) { toggleNote(song, track, c.step, c.pitch, INSTRUMENTS[track]!.id === 'drums' ? 1 : len); draw(); }
      if (painting === 'del' && exists) { toggleNote(song, track, c.step, c.pitch); draw(); }
    });
    canvas.addEventListener('pointerup', () => { if (painting) { painting = null; save(); renderTracks(); } });
    const play = () => {
      if (playing) { stopPreview(); playing = false; playStep = -1; renderControls(); draw(); return; }
      const s = JSON.parse(JSON.stringify(song)) as SongData;
      muted.forEach((i) => { s.tracks[i]!.volume = 0; });
      const m = (window as unknown as { __dtMusic?: { previewCustom?: (x: SongData) => void } }).__dtMusic;
      if (m?.previewCustom) m.previewCustom(s);
      else previewSong(s, (st) => { playStep = st; draw(); });
      playing = true;
      renderControls();
    };
    const renderControls = () => {
      controls.replaceChildren(
        h('button', { class: `ed-btn ${playing ? 'hot' : 'go'}`, onclick: play }, playing ? '■ Stop' : '▶ Play'),
        h('span', {}, 'Name'), h('input', { class: 'ed-in', style: 'flex:0 0 120px', value: song.name ?? '', onchange: (e) => { song.name = (e.target as HTMLInputElement).value; save(); } }),
        h('span', { style: 'opacity:.7' }, 'BPM'), h('input', { type: 'number', class: 'ed-in', style: 'flex:0 0 60px', min: 30, max: 240, value: song.bpm, onchange: (e) => { song.bpm = Math.max(30, Math.min(240, Number((e.target as HTMLInputElement).value) || 90)); save(); } }),
        h('span', { style: 'opacity:.7' }, 'Meter'), this.select(String(meter), [['3', '3/4'], ['4', '4/4']], (v) => { meter = Number(v); draw(); }),
        h('span', { style: 'opacity:.7' }, 'Bars'), this.select(String(song.steps / (4 * meter)), [1, 2, 4, 8, 12, 16].map((b) => [String(b), String(b)] as [string, string]), (v) => {
          song.steps = Number(v) * 4 * meter;
          song = normalizeSong(song);
          save(); draw();
        }),
        h('span', { style: 'opacity:.7' }, 'Note'), this.select(String(len), [['1', '1/16'], ['2', '1/8'], ['4', '1/4'], ['8', '1/2'], ['12', '3/4'], ['16', 'whole']], (v) => { len = Number(v); }),
        this.select('', [['', 'Templates…'], ...TEMPLATES.map((t) => [t.id, t.label] as [string, string])], (v) => {
          const t = TEMPLATES.find((x) => x.id === v);
          if (!t) return;
          song = normalizeSong(t.make());
          meter = t.id === 'satie' ? 3 : 4;
          save(); renderControls(); renderTracks(); draw();
        }),
        h('button', { class: 'ed-btn', title: 'Clear this track', onclick: () => { song.tracks[track]!.notes = []; save(); draw(); renderTracks(); } }, 'Clear track'),
        h('span', { style: 'flex:1' }),
        h('button', { class: 'ed-btn', title: 'Use a built-in track instead', onclick: () => { doc.edit((l) => { if (l.audio) { delete l.audio.theme; l.audio.music = l.act ?? 1; } }, true); this.closeModal(); this.toast('Using the built-in music.'); } }, 'Use built-in'),
      );
    };
    const renderTracks = () => {
      tracksEl.replaceChildren(...song.tracks.map((t, i) => {
        const inst = INSTRUMENTS[i]!;
        return h('div', { class: `ed-track ${i === track ? 'on' : ''}`, onclick: () => { track = i; renderTracks(); draw(); } },
          h('span', { class: 'sw', style: `background:${inst.color}` }), inst.label, h('small', {}, `${t.notes.length}`),
          h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: t.volume, title: 'Volume', style: 'width:54px', onclick: (e) => e.stopPropagation(), onchange: (e) => { t.volume = Number((e.target as HTMLInputElement).value); save(); } }),
          h('button', { class: 'ed-mini', title: muted.has(i) ? 'Unmute' : 'Mute (preview)', onclick: (e) => { e.stopPropagation(); if (muted.has(i)) muted.delete(i); else muted.add(i); renderTracks(); } }, muted.has(i) ? '🔇' : '🔈'));
      }));
    };
    renderControls();
    renderTracks();
    const box = h('div', { class: 'ed-studio' },
      h('header', {}, h('h2', {}, '♫ Music composer'), h('span', { class: 'ed-muted' }, `${noteCount(song)} notes · click to add, drag to paint, right-click to delete`), h('button', { class: 'ed-btn', onclick: () => this.closeModal() }, 'Done')),
      h('div', { class: 'ed-smain', style: 'overflow:hidden' }, controls, tracksEl, wrap));
    this.openModal(box);
    draw();
    if (!hadTheme) this.toast('Starting from the gentle-waltz template. Edit a note to make it this level\u2019s theme.');
  }

  // ---------------------------------------------------------------------------
  // First-run tips
  // ---------------------------------------------------------------------------

  startTips(force = false): void {
    const KEY = 'dietrying.editor.tips.v3';
    if (!force) { try { if (localStorage.getItem(KEY)) return; } catch { return; } }
    const steps: Array<{ x: number; y: number; html: string }> = [
      { x: LEFT_W + 20, y: TOP_H + 20, html: '<b>Welcome to the lab.</b> Everything you see is editable. Left-drag paints, right-drag erases, wheel zooms, Space-drag pans.' },
      { x: 70, y: TOP_H + 60, html: '<b>Tools</b> on the left rail: brush, rectangle, line, fill, eyedropper, select, stamp. Keys in the corners.' },
      { x: 270, y: TOP_H + 10, html: '<b>Layers</b>: terrain, objects, background and foreground decor, images, zones. Pick one, then pick what to paint below it.' },
      { x: 270, y: TOP_H + 200, html: '<b>Gadgets</b> (Objects layer, scroll down) are mechanics you build: springs, fans, teleporters, saws, coins, keys and locks, or a blank part. Give any of them a look, an effect, a path and logic in Inspect.' },
      { x: GAME_W - RIGHT_W - 290, y: TOP_H + 30, html: '<b>Inspect</b> anything you select. <b>Events</b> are the logic: when something happens, only if a condition holds, do actions. Every ◉ button is an eyedropper: click it, then click the thing on the map.' },
      { x: 270, y: TOP_H + 40, html: 'The fastest way to wire things: <b>⤳ Link</b> (Zones layer). Click what starts it, then click what should happen. <b>Level</b> has the size (4×3 up to 256×96), rules, abilities and variables.' },
      { x: GAME_W - 560, y: TOP_H + 4, html: 'Pictures become pixel art with <b>🖼 Image</b>. Change any sound in <b>♪ Sounds</b>, write a theme in <b>♫ Music</b>. Press <b>P</b> to play from the cursor, <b>Ctrl+K</b> for everything.' },
    ];
    let i = 0;
    const show = () => {
      this.tip?.remove();
      const s = steps[i];
      if (!s) { try { localStorage.setItem(KEY, '1'); } catch { /* fine */ } this.tip = null; return; }
      const body = h('div', {});
      body.innerHTML = s.html;
      this.tip = h('div', { class: 'ed-tip', style: `left:${s.x}px;top:${s.y}px` }, body,
        h('div', { class: 'row' }, h('span', { style: 'margin-right:auto;opacity:.6' }, `${i + 1}/${steps.length}`),
          h('button', { onclick: () => { i = steps.length; show(); } }, 'Skip'),
          h('button', { class: 'go', onclick: () => { i++; show(); } }, i === steps.length - 1 ? 'Got it' : 'Next')));
      this.root.append(this.tip);
    };
    show();
  }
}

function toggleIn<T>(arr: T[], v: T, on: boolean): T[] {
  const s = new Set(arr);
  if (on) s.add(v); else s.delete(v);
  return [...s];
}


/** Rough share-code size for warnings. */
export function shareSize(l: Parameters<typeof encodeLevel>[0]): number { return encodeLevel(l).length; }


/** A fresh effect of a kind, with sensible numbers for a gadget of this size. */
function defaultEffect(kind: GadgetEffect['kind'], g: GadgetObj): GadgetEffect {
  switch (kind) {
    case 'none': return { kind };
    case 'kill': return { kind, cause: 'spike' };
    case 'bounce': return { kind, height: 6 };
    case 'launch': return { kind, vx: 12, vy: -14 };
    case 'force': return { kind, ax: 0, ay: -95 };
    case 'gravity': return { kind, scale: 0.3 };
    case 'teleport': return { kind, to: { x: Math.floor(g.x) + 6, y: Math.floor(g.y) } };
    case 'slow': return { kind, factor: 0.35 };
    case 'conveyor': return { kind, speed: 4 };
    case 'checkpoint': return { kind };
    case 'collect': return { kind, var: 'coins', amount: 1 };
    case 'win': return { kind };
  }
}
