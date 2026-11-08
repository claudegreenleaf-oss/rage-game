// 16×16 pixel icons for every decor id, drawn in code. Used for the editor palette (as data URLs)
// and the editor's canvas preview of decor layers (as Phaser canvas textures).
import { DECOR_IDS, type DecorId } from '../sim/types';

const S = 16;
type Px = (x: number, y: number, c: string, w?: number, h?: number) => void;

const C = {
  ink: '#1c1a24', steel: '#8e98a8', steelD: '#5c6575', steelL: '#c4ccd8', white: '#e9eef2', glass: '#9fd8e0', glassD: '#5aa5b5',
  screen: '#5bf0a0', screenD: '#1f5a46', dark: '#2a2e3a', moss: '#5e9a3a', mossL: '#8cc455', mossD: '#3c6b2a', leaf: '#4f8c35',
  rust: '#9a5a3a', wood: '#8a5a32', woodL: '#b07a45', bone: '#efe6d2', boneD: '#c8bca4', red: '#e0564f', amber: '#f2b544',
  water: '#3f8f98', waterL: '#7fd0d0', paper: '#e8dcc0', pipe: '#77808e', mush: '#d9735a', lamp: '#ffe9a6',
};

const DRAW: Record<DecorId, (p: Px) => void> = {
  panel: (p) => { p(0, 0, C.steelD, 16, 16); p(1, 1, C.steel, 14, 14); p(1, 1, C.steelL, 14, 1); p(2, 3, C.steelD, 1, 1); p(13, 3, C.steelD, 1, 1); p(2, 12, C.steelD, 1, 1); p(13, 12, C.steelD, 1, 1); p(1, 8, C.steelD, 14, 1); },
  panelDark: (p) => { p(0, 0, C.ink, 16, 16); p(1, 1, C.dark, 14, 14); p(1, 1, C.steelD, 14, 1); p(3, 5, C.steelD, 10, 1); p(3, 9, C.steelD, 10, 1); },
  panelCracked: (p) => { DRAW.panel(p); p(5, 2, C.dark, 1, 3); p(6, 5, C.dark, 1, 3); p(7, 8, C.dark, 2, 1); p(9, 9, C.dark, 1, 4); p(4, 6, C.dark, 2, 1); },
  window: (p) => { p(0, 0, C.steelD, 16, 16); p(2, 2, C.glass, 12, 12); p(2, 2, C.white, 3, 2); p(7, 2, C.steelD, 2, 12); p(2, 7, C.steelD, 12, 2); p(3, 10, C.glassD, 3, 3); },
  windowBroken: (p) => { p(0, 0, C.steelD, 16, 16); p(2, 2, C.dark, 12, 12); p(2, 2, C.glass, 5, 3); p(9, 9, C.glass, 5, 5); p(3, 5, C.glass, 2, 2); p(4, 10, C.mossL, 3, 4); p(5, 9, C.moss, 1, 2); },
  monitor: (p) => { p(1, 2, C.ink, 14, 11); p(2, 3, C.screenD, 12, 8); p(3, 4, C.screen, 6, 1); p(3, 6, C.screen, 9, 1); p(3, 8, C.screen, 4, 1); p(6, 13, C.steelD, 4, 2); p(4, 15, C.steelD, 8, 1); },
  monitorDead: (p) => { p(1, 2, C.ink, 14, 11); p(2, 3, C.dark, 12, 8); p(4, 4, C.steelD, 1, 6); p(5, 6, C.steelD, 3, 1); p(8, 5, C.steelD, 1, 3); p(6, 13, C.steelD, 4, 2); p(4, 15, C.steelD, 8, 1); },
  server: (p) => { p(2, 0, C.ink, 12, 16); for (let y = 1; y < 15; y += 3) { p(3, y, C.dark, 10, 2); p(11, y, y % 2 ? C.screen : C.red, 1, 1); p(4, y, C.steelD, 5, 1); } },
  tank: (p) => { p(3, 0, C.steelD, 10, 2); p(3, 14, C.steelD, 10, 2); p(4, 2, C.glassD, 8, 12); p(5, 2, C.glass, 6, 12); p(5, 3, C.white, 1, 9); p(7, 6, C.mossL, 3, 4); p(8, 5, C.moss, 1, 1); p(9, 10, C.mossD, 1, 3); },
  tankBroken: (p) => { p(3, 0, C.steelD, 10, 2); p(3, 14, C.steelD, 10, 2); p(4, 8, C.glassD, 8, 6); p(4, 6, C.glass, 2, 3); p(10, 5, C.glass, 2, 4); p(6, 12, C.water, 5, 2); p(5, 13, C.waterL, 2, 1); },
  pipeH: (p) => { p(0, 6, C.ink, 16, 5); p(0, 7, C.pipe, 16, 3); p(0, 7, C.steelL, 16, 1); p(5, 5, C.steelD, 2, 7); p(12, 5, C.steelD, 2, 7); },
  pipeV: (p) => { p(6, 0, C.ink, 5, 16); p(7, 0, C.pipe, 3, 16); p(7, 0, C.steelL, 1, 16); p(5, 5, C.steelD, 7, 2); p(5, 12, C.steelD, 7, 2); },
  cable: (p) => { for (let x = 0; x < 16; x++) { const y = 3 + Math.round(Math.sin((x / 15) * Math.PI) * 6); p(x, y, C.ink, 1, 2); } for (let x = 0; x < 16; x++) { const y = 5 + Math.round(Math.sin((x / 15) * Math.PI) * 6); p(x, y, C.red, 1, 1); } },
  vent: (p) => { p(1, 3, C.ink, 14, 10); p(2, 4, C.steel, 12, 8); for (let y = 5; y < 12; y += 2) p(3, y, C.dark, 10, 1); },
  grate: (p) => { p(0, 0, C.ink, 16, 16); for (let i = 1; i < 16; i += 3) { p(i, 0, C.steelD, 1, 16); p(0, i, C.steelD, 16, 1); } },
  lamp: (p) => { p(7, 0, C.ink, 2, 5); p(4, 5, C.ink, 8, 3); p(5, 8, C.lamp, 6, 2); p(6, 10, C.amber, 4, 1); p(3, 11, '#fff4c2', 10, 1); },
  vine: (p) => { for (let y = 0; y < 16; y++) { const x = 7 + Math.round(Math.sin(y * 0.6) * 2); p(x, y, C.mossD, 2, 1); if (y % 4 === 1) p(x + 2, y, C.mossL, 2, 1); if (y % 4 === 3) p(x - 2, y, C.leaf, 2, 1); } },
  ivy: (p) => { for (let i = 0; i < 26; i++) { const x = (i * 7) % 15, y = (i * 11) % 15; p(x, y, i % 3 ? C.leaf : C.mossL, 2, 2); } p(0, 15, C.mossD, 16, 1); },
  moss: (p) => { p(0, 11, C.mossD, 16, 5); p(1, 9, C.moss, 5, 3); p(6, 8, C.mossL, 4, 4); p(10, 10, C.moss, 6, 2); p(3, 12, C.mossL, 2, 1); p(12, 12, C.mossL, 2, 1); },
  fern: (p) => { p(7, 8, C.mossD, 2, 8); for (let i = 0; i < 4; i++) { p(8 - 2 - i * 1, 6 + i * 2, C.leaf, 2 + i, 1); p(9, 6 + i * 2, C.mossL, 2 + i, 1); } p(7, 3, C.mossL, 2, 4); },
  roots: (p) => { p(6, 0, C.wood, 3, 6); p(4, 5, C.wood, 3, 4); p(8, 5, C.wood, 2, 6); p(2, 8, C.woodL, 3, 5); p(10, 10, C.wood, 2, 5); p(5, 11, C.woodL, 1, 5); },
  mushroom: (p) => { p(3, 9, C.mush, 6, 3); p(4, 8, C.mush, 4, 1); p(5, 12, C.paper, 2, 4); p(5, 9, C.paper, 1, 1); p(9, 11, C.mush, 4, 2); p(10, 13, C.paper, 2, 3); },
  puddle: (p) => { p(1, 12, C.water, 14, 3); p(3, 11, C.water, 10, 1); p(4, 12, C.waterL, 5, 1); p(10, 13, C.waterL, 2, 1); },
  bones: (p) => { p(2, 11, C.bone, 9, 2); p(1, 10, C.bone, 2, 4); p(10, 10, C.bone, 2, 4); p(10, 5, C.bone, 5, 5); p(11, 6, C.ink, 1, 1); p(13, 6, C.ink, 1, 1); p(11, 9, C.boneD, 3, 1); },
  crate: (p) => { p(1, 2, C.ink, 14, 14); p(2, 3, C.wood, 12, 12); p(2, 3, C.woodL, 12, 1); p(2, 8, C.ink, 12, 1); for (let i = 0; i < 10; i++) p(3 + i, 4 + i, C.woodL, 1, 1); },
  barrel: (p) => { p(3, 1, C.ink, 10, 15); p(4, 2, C.amber, 8, 13); p(4, 4, C.ink, 8, 1); p(4, 12, C.ink, 8, 1); p(6, 6, C.ink, 4, 4); p(7, 7, C.amber, 2, 2); },
  console: (p) => { p(0, 6, C.ink, 16, 10); p(1, 7, C.steelD, 14, 8); p(2, 8, C.screenD, 6, 3); p(3, 9, C.screen, 3, 1); p(10, 8, C.red, 2, 2); p(13, 8, C.amber, 1, 2); p(10, 12, C.steel, 4, 1); },
  hazardStripe: (p) => { p(0, 0, C.ink, 16, 16); for (let i = -16; i < 16; i += 6) for (let k = 0; k < 3; k++) for (let y = 0; y < 16; y++) { const x = i + y + k; if (x >= 0 && x < 16) p(x, y, C.amber, 1, 1); } },
  poster: (p) => { p(3, 1, C.ink, 10, 14); p(4, 2, C.paper, 8, 12); p(5, 4, C.red, 6, 2); p(5, 8, C.steelD, 6, 1); p(5, 10, C.steelD, 4, 1); p(11, 2, '#d8c8a0', 1, 3); },
  sign: (p) => { p(1, 4, C.ink, 14, 8); p(2, 5, C.amber, 12, 6); p(7, 6, C.ink, 2, 3); p(7, 10, C.ink, 2, 1); },
  chain: (p) => { for (let y = 0; y < 16; y += 4) { p(6, y, C.steelD, 4, 1); p(6, y + 2, C.steelD, 4, 1); p(6, y, C.steelD, 1, 3); p(9, y, C.steelD, 1, 3); } },
  debris: (p) => { p(1, 12, C.steelD, 5, 3); p(6, 13, C.dark, 4, 2); p(10, 11, C.steel, 4, 4); p(3, 10, C.rust, 2, 2); p(12, 9, C.mossL, 2, 2); p(0, 15, C.ink, 16, 1); },
};

const canvases = new Map<DecorId, HTMLCanvasElement>();

/** A 16×16 canvas for a decor id (cached). */
export function decorCanvas(id: DecorId): HTMLCanvasElement {
  let c = canvases.get(id);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = S; c.height = S;
  const g = c.getContext('2d')!;
  const px: Px = (x, y, col, w = 1, h = 1) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
  DRAW[id](px);
  canvases.set(id, c);
  return c;
}

const urls = new Map<DecorId, string>();
export function decorUrl(id: DecorId): string {
  let u = urls.get(id);
  if (!u) { u = decorCanvas(id).toDataURL(); urls.set(id, u); }
  return u;
}

/** Register every decor icon as a Phaser texture `ed_decor_<id>` (once per game). */
export function ensureDecorTextures(textures: { exists(k: string): boolean; addCanvas(k: string, c: HTMLCanvasElement): unknown }): void {
  for (const id of DECOR_IDS) {
    const key = `ed_decor_${id}`;
    if (!textures.exists(key)) textures.addCanvas(key, decorCanvas(id));
  }
}

export const DECOR_LABEL: Record<DecorId, string> = {
  panel: 'Wall panel', panelDark: 'Dark panel', panelCracked: 'Cracked panel', window: 'Window', windowBroken: 'Broken window',
  monitor: 'Monitor', monitorDead: 'Dead monitor', server: 'Server rack', tank: 'Specimen tank', tankBroken: 'Broken tank',
  pipeH: 'Pipe ─', pipeV: 'Pipe │', cable: 'Sagging cable', vent: 'Vent', grate: 'Grate', lamp: 'Lamp',
  vine: 'Vine', ivy: 'Ivy', moss: 'Moss', fern: 'Fern', roots: 'Roots', mushroom: 'Mushrooms', puddle: 'Puddle', bones: 'Bones',
  crate: 'Crate (decor)', barrel: 'Barrel', console: 'Console', hazardStripe: 'Hazard stripes', poster: 'Poster', sign: 'Warning sign',
  chain: 'Chain', debris: 'Debris',
};
