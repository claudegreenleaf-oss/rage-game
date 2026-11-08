// Corpses: Fresh (Pip on its back, X eyes, tongue out), Rot (droopy, green, flies), Skeleton (cute bones).
import type Phaser from 'phaser';
import type { Stage } from '../sim/types';
import { C } from './palette';

export type CorpseLook = 'body' | 'slab' | 'floor' | 'wall' | 'raft';

const OL = 2.6;

function xEye(g: Phaser.GameObjects.Graphics, x: number, y: number, s = 3): void {
  g.lineStyle(2.3, C.outline, 1);
  g.lineBetween(x - s, y - s, x + s, y + s);
  g.lineBetween(x + s, y - s, x - s, y + s);
}

function bone(g: Phaser.GameObjects.Graphics, x1: number, y: number, x2: number, t = 3.4): void {
  g.fillStyle(C.outline, 1);
  g.fillRoundedRect(x1 - OL, y - t / 2 - OL, x2 - x1 + OL * 2, t + OL * 2, (t + OL * 2) / 2);
  for (const bx of [x1, x2]) { g.fillCircle(bx, y - t * 0.45, t * 0.62 + OL); g.fillCircle(bx, y + t * 0.45, t * 0.62 + OL); }
  g.fillStyle(C.bone, 1);
  g.fillRoundedRect(x1, y - t / 2, x2 - x1, t, t / 2);
  for (const bx of [x1, x2]) { g.fillCircle(bx, y - t * 0.45, t * 0.62); g.fillCircle(bx, y + t * 0.45, t * 0.62); }
}

function skull(g: Phaser.GameObjects.Graphics, x: number, y: number, r: number): void {
  g.fillStyle(C.outline, 1);
  g.fillCircle(x, y, r + OL);
  g.fillRoundedRect(x - r * 0.55 - OL, y + r * 0.35 - OL, r * 1.1 + OL * 2, r * 0.75 + OL * 2, 2);
  g.fillStyle(C.bone, 1);
  g.fillCircle(x, y, r);
  g.fillRoundedRect(x - r * 0.55, y + r * 0.35, r * 1.1, r * 0.75, 2);
  g.fillStyle(C.boneShade, 1);
  g.fillEllipse(x + r * 0.2, y + r * 0.45, r * 1.2, r * 0.5);
  g.fillStyle(C.outline, 1);
  g.fillCircle(x - r * 0.38, y - r * 0.05, r * 0.33);
  g.fillCircle(x + r * 0.38, y - r * 0.05, r * 0.33);
  g.fillStyle(C.white, 0.9);
  g.fillCircle(x - r * 0.3, y - r * 0.15, r * 0.09);
  g.fillCircle(x + r * 0.46, y - r * 0.15, r * 0.09);
}

function flies(g: Phaser.GameObjects.Graphics, cx: number, cy: number, t: number, seed: number): void {
  for (let i = 0; i < 2; i++) {
    const a = t * (2.4 + i * 0.7) + seed + i * 2.6;
    const fx = cx + Math.cos(a) * (9 + i * 4), fy = cy - 9 - Math.sin(a * 1.3) * 5 - i * 3;
    const flap = Math.sin(t * 40 + i) > 0 ? 1 : 0.55;
    g.fillStyle(C.white, 0.85);
    g.fillEllipse(fx - 1.5, fy - 2, 3.4, 2.4 * flap);
    g.fillEllipse(fx + 1.5, fy - 2, 3.4, 2.4 * flap);
    g.fillStyle(C.outline, 1);
    g.fillCircle(fx, fy, 1.6);
  }
}

/** Fresh body on its back, filling a ~40x32 box whose top-left is (x, y). */
function freshBody(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, t: number, flip: boolean): void {
  g.save();
  g.translateCanvas(x + w / 2, y + h);
  g.scaleCanvas((flip ? -1 : 1) * (w / 40), h / 32);
  // outline pass
  g.fillStyle(C.outline, 1);
  g.fillEllipse(-9, -25, 8 + OL * 2, 11 + OL * 2);
  g.fillEllipse(7, -26, 8 + OL * 2, 11 + OL * 2);
  g.fillCircle(-17, -9, 6 + OL);
  g.fillCircle(-16, -19, 6 + OL);
  g.fillEllipse(1, -11, 35 + OL * 2, 21 + OL * 2);
  // feet up
  g.fillStyle(C.pipShade, 1);
  g.fillEllipse(-9, -25 + Math.sin(t * 2) * 0.3, 8, 11);
  g.fillEllipse(7, -26, 8, 11);
  // ears flopped on the floor
  for (const [ex, ey] of [[-17, -9], [-16, -19]] as const) {
    g.fillStyle(C.pip, 1); g.fillCircle(ex, ey, 6);
    g.fillStyle(C.blush, 0.9); g.fillCircle(ex, ey, 3.3);
  }
  g.fillStyle(C.pip, 1);
  g.fillEllipse(1, -11, 35, 21);
  g.fillStyle(C.pipLight, 0.9);
  g.fillEllipse(4, -15, 20, 8);
  g.fillStyle(C.white, 0.5);
  g.fillEllipse(-2, -17, 8, 3);
  xEye(g, -9, -10, 2.6);
  xEye(g, -1, -12, 2.6);
  // tongue
  g.fillStyle(C.outline, 1);
  g.fillRoundedRect(-8, -6.5, 6 + OL * 2 - 2, 7 + OL, 3);
  g.fillStyle(C.blush, 1);
  g.fillRoundedRect(-7, -5.5, 4.6, 6, 2.3);
  g.fillStyle(C.blush, 0.7);
  g.fillEllipse(-13, -5, 5, 3);
  g.restore();
}

function rotBody(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, t: number, seed: number, withFlies: boolean): void {
  g.save();
  g.translateCanvas(x + w / 2, y + h);
  g.scaleCanvas(w / 40, h / 18);
  const sag = Math.sin(t * 1.6 + seed) * 0.4;
  g.fillStyle(C.outline, 1);
  g.fillEllipse(-15, -3, 12 + OL * 2, 7 + OL * 2);
  g.fillEllipse(0, -7.5 + sag, 38 + OL * 2, 15 + OL * 2);
  g.fillStyle(C.rot, 1);
  g.fillEllipse(-15, -3, 12, 7);
  g.fillEllipse(0, -7.5 + sag, 38, 15);
  g.fillStyle(C.rotShade, 1);
  g.fillEllipse(2, -2.5, 34, 5);
  g.fillCircle(8, -10, 2.2);
  g.fillCircle(-5, -5, 1.6);
  g.fillStyle(C.rotLight, 0.9);
  g.fillEllipse(-2, -11 + sag, 18, 4);
  // drips
  g.fillStyle(C.rotShade, 1);
  g.fillRoundedRect(12, -4, 3, 5 + Math.sin(t * 2 + seed) * 1, 1.5);
  xEye(g, -10, -8 + sag, 2.2);
  xEye(g, -3, -9 + sag, 2.2);
  g.lineStyle(1.8, C.outline, 1);
  g.beginPath(); g.moveTo(-9, -4 + sag); g.lineTo(-6, -5 + sag); g.lineTo(-3, -4 + sag); g.strokePath();
  g.restore();
  if (withFlies) flies(g, x + w / 2, y, t, seed);
}

function skeleton(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, flip: boolean): void {
  g.save();
  g.translateCanvas(x + w / 2, y + h);
  g.scaleCanvas((flip ? -1 : 1) * (w / 40), 1);
  const by = -Math.min(h, 8) / 2;
  bone(g, -6, by, 15, 3.2);
  // ribs
  g.lineStyle(2 + OL, C.outline, 1);
  for (const rx of [-2, 3, 8]) g.lineBetween(rx, by - 4, rx, by + 2);
  g.lineStyle(2, C.bone, 1);
  for (const rx of [-2, 3, 8]) g.lineBetween(rx, by - 4, rx, by + 2);
  bone(g, 9, by + 1.5, 17, 2.6);
  skull(g, -13, by - 1, 6);
  g.restore();
}

function slab(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, stage: Stage, t: number, seed: number): void {
  if (stage === 2) {
    g.fillStyle(C.outline, 1);
    g.fillRoundedRect(x - 1, y + h - 5, w + 2, 5, 2);
    bone(g, x + 6, y + h - 4, x + w - 6, 3);
    skull(g, x + 7, y + h - 5, 4.5);
    return;
  }
  const fill = stage === 0 ? C.pip : C.rot, shade = stage === 0 ? C.pipShade : C.rotShade, light = stage === 0 ? C.pipLight : C.rotLight;
  g.fillStyle(C.outline, 1);
  g.fillRoundedRect(x - OL, y - OL + 1, w + OL * 2, h + OL * 2 - 1, Math.min(7, h / 2 + OL));
  g.fillStyle(fill, 1);
  g.fillRoundedRect(x, y + 1, w, h - 1, Math.min(5, h / 2));
  g.fillStyle(shade, 1);
  g.fillRoundedRect(x + 2, y + h - Math.max(2, h * 0.35), w - 4, Math.max(2, h * 0.35), 2);
  g.fillStyle(light, 0.8);
  g.fillRoundedRect(x + 6, y + 2, w - 16, Math.max(1.5, h * 0.22), 1);
  const ey = y + h * 0.45 + 0.5;
  xEye(g, x + 10, ey, Math.min(2.4, h * 0.3));
  xEye(g, x + 17, ey, Math.min(2.4, h * 0.3));
  if (stage === 0) {
    g.fillStyle(C.pip, 1);
    g.fillCircle(x - 1, y + h * 0.5, Math.min(4, h * 0.45));
    g.fillCircle(x + w + 1, y + h * 0.5, Math.min(3, h * 0.4));
  } else flies(g, x + w / 2, y, t, seed);
}

/** Wall-spike ledge: a stiff body sticking out of the wall. */
function ledge(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, stage: Stage, t: number, seed: number, fromLeft: boolean): void {
  if (stage === 2) {
    g.save();
    g.translateCanvas(x + w / 2, y + h / 2);
    g.scaleCanvas(fromLeft ? 1 : -1, 1);
    bone(g, -16, 0, 12, 4);
    skull(g, 13, -1, 5.5);
    g.restore();
    return;
  }
  const fill = stage === 0 ? C.pip : C.rot, shade = stage === 0 ? C.pipShade : C.rotShade;
  g.save();
  g.translateCanvas(x + w / 2, y);
  g.scaleCanvas(fromLeft ? 1 : -1, 1);
  g.fillStyle(C.outline, 1);
  g.fillRoundedRect(-20 - OL, -OL, 40 + OL * 2, h + OL * 2, h / 2 + OL);
  g.fillEllipse(18, h * 0.25, 9 + OL * 2, 7 + OL * 2);
  g.fillEllipse(18, h * 0.8, 9 + OL * 2, 7 + OL * 2);
  g.fillStyle(fill, 1);
  g.fillRoundedRect(-20, 0, 40, h, h / 2);
  g.fillStyle(shade, 1);
  g.fillRoundedRect(-18, h * 0.62, 34, h * 0.32, 3);
  g.fillEllipse(18, h * 0.25, 9, 7);
  g.fillEllipse(18, h * 0.8, 9, 7);
  g.fillStyle(C.white, 0.45);
  g.fillRoundedRect(-14, 3, 22, 3, 1.5);
  xEye(g, -10, h * 0.42, 2.4);
  xEye(g, -3, h * 0.42, 2.4);
  g.restore();
  if (stage === 1) flies(g, x + w / 2, y, t, seed);
}

/** Draw a corpse in its box (world px). */
export function drawCorpse(
  g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number,
  stage: Stage, look: CorpseLook, t: number, seed: number, flip = false,
): void {
  switch (look) {
    case 'slab':
    case 'floor':
      slab(g, x, y, w, h, stage, t, seed);
      return;
    case 'wall':
      ledge(g, x, y, w, h, stage, t, seed, !flip);
      return;
    default:
      if (stage === 0) freshBody(g, x, y, w, h, t, flip);
      else if (stage === 1) rotBody(g, x, y, w, h, t, seed, true);
      else skeleton(g, x, y, w, h, flip);
  }
}

/** Tiny HUD icon of a corpse stage centred at (x, y). */
export function drawCorpseIcon(g: Phaser.GameObjects.Graphics, x: number, y: number, stage: Stage, t: number): void {
  if (stage === 0) freshBody(g, x - 15, y - 12, 30, 24, t, false);
  else if (stage === 1) rotBody(g, x - 15, y - 4, 30, 13, t, 0, false);
  else skeleton(g, x - 16, y - 2, 32, 8, false);
}
