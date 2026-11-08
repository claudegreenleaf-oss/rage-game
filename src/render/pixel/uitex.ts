// Pixel UI surfaces (panels, buttons, wooden sign boards) generated at their native pixel size and cached.
import Phaser from 'phaser';
import { KEY, css } from './pal';

export type PanelStyle = 'paper' | 'wood' | 'crt' | 'tape' | 'btn' | 'btnHot' | 'btnLocked' | 'btnRed' | 'btnGreen' | 'dark' | 'slot' | 'slotEmpty';

/** Phosphor green for text on CRT boards. */
export const PHOSPHOR = 0x9dffbf;

const STY: Record<PanelStyle, { fill: number; top: number; bottom: number; edge: number; shadow: boolean; grain?: number }> = {
  paper: { fill: 0xe8edf2, top: 0xffffff, bottom: 0xbcc6d1, edge: KEY.k!, shadow: true },
  wood: { fill: KEY.u!, top: KEY.v!, bottom: KEY.U!, edge: KEY.k!, shadow: true, grain: 0xb87747 },
  crt: { fill: 0x10281f, top: 0x10281f, bottom: 0x10281f, edge: KEY.k!, shadow: true },
  tape: { fill: 0xffd96b, top: 0xfff0b0, bottom: 0xe0ad3c, edge: KEY.k!, shadow: true },
  btn: { fill: 0xffcfa8, top: 0xffe7d2, bottom: 0xe59a73, edge: KEY.k!, shadow: true },
  btnHot: { fill: KEY.z!, top: 0xfff0b0, bottom: KEY.Z!, edge: KEY.k!, shadow: true },
  btnRed: { fill: 0xff6a6a, top: 0xffa59a, bottom: 0xc0434f, edge: KEY.k!, shadow: true },
  btnGreen: { fill: 0xa8d98f, top: 0xd6f0c2, bottom: 0x6f9f63, edge: KEY.k!, shadow: true },
  btnLocked: { fill: 0xcfc6cf, top: 0xe3dce3, bottom: 0xa69ca8, edge: 0x6f6578, shadow: true },
  dark: { fill: 0x3b3046, top: 0x55476a, bottom: 0x2a2034, edge: KEY.k!, shadow: true },
  slot: { fill: 0xf3e2cc, top: 0xfff2e0, bottom: 0xdcc6a9, edge: 0x8a7a8f, shadow: false },
  slotEmpty: { fill: 0xe8dccb, top: 0xe8dccb, bottom: 0xd9cbb7, edge: 0xb3a5ad, shadow: false },
};

/** Rounded pixel panel (w×h in pixels, plus a 2 px drop shadow when styled). Returns the texture key. */
export function panelTex(scene: Phaser.Scene, w: number, h: number, style: PanelStyle, tail = false): string {
  const key = `panel_${style}_${w}x${h}${tail ? 't' : ''}`;
  if (scene.textures.exists(key)) return key;
  const s = STY[style];
  const sh = s.shadow ? 2 : 0;
  const th = tail ? 4 : 0;
  const tex = scene.textures.createCanvas(key, w, h + sh + th)!;
  const ctx = tex.getContext();
  const px = (x: number, y: number, c: number, a = 1) => { ctx.fillStyle = css(c, a); ctx.fillRect(x, y, 1, 1); };
  const inside = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return false;
    const r = 2;
    const cx = x < r ? r : x > w - 1 - r ? w - 1 - r : x;
    const cy = y < r ? r : y > h - 1 - r ? h - 1 - r : y;
    return Math.abs(x - cx) + Math.abs(y - cy) <= r;
  };
  if (s.shadow) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (inside(x, y)) px(x, y + sh, KEY.k!, 0.35);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!inside(x, y)) continue;
    const edge = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
    let c = s.fill;
    if (edge) c = s.edge;
    else if (y === 1 || (y === 2 && x > 1 && x < w - 2)) c = y === 1 ? s.top : s.fill;
    else if (y >= h - 3) c = s.bottom;
    if (!edge && s.grain && y > 3 && y < h - 3 && (y % 5 === 0) && (x * 7 + y * 3) % 13 > 4) c = s.grain;
    px(x, y, c);
  }
  // Lab panels get corner rivets; CRT boards a steel bezel and scanlines; taped signs a hazard header.
  if (style === 'paper' || style === 'dark') for (const [x, y] of [[2, 2], [w - 3, 2], [2, h - 3], [w - 3, h - 3]] as const) px(x, y, style === 'paper' ? 0x8f9bab : 0x6d6385);
  if (style === 'crt') {
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      if (!inside(x, y)) continue;
      const bezel = x === 1 || x === w - 2 || y === 1 || y === h - 2;
      px(x, y, bezel ? KEY.M! : y % 2 ? 0x14352a : 0x0f2a21);
    }
    px(w - 4, h - 2, 0x76d68a);
  }
  if (style === 'tape') {
    for (let x = 1; x < w - 1; x++) for (let y = 1; y < 3; y++) if (inside(x, y)) px(x, y, ((x + y) >> 1) % 2 ? KEY.k! : KEY.z!);
    for (const x0 of [1, w - 5]) for (let i = 0; i < 4; i++) px(x0 + i, 3, 0xfff6d8, 0.8);
  }
  if (s.grain) { px(2, Math.floor(h / 2), KEY.U!); px(w - 3, Math.floor(h / 2), KEY.U!); }
  if (tail) {
    const cx = Math.floor(w / 2);
    for (let j = 0; j < th; j++) for (let i = -(th - j); i <= th - j - 1; i++) {
      const x = cx + i, y = h - 1 + j;
      const edge = i === -(th - j) || i === th - j - 1 || j === th - 1;
      px(x, y, edge ? s.edge : s.fill);
    }
  }
  tex.refresh();
  return key;
}

