// Pip: a tiny round hamster-mouse. Drawn in code with an outline pass then a fill pass.
import type Phaser from 'phaser';
import { C } from './palette';

export interface PipPose {
  sx: number;
  sy: number;
  /** Lean in radians (run lean, landing wobble). */
  lean: number;
  facing: number;
  /** 0 = eyes open, 1 = closed. */
  blink: number;
  lookX: number;
  lookY: number;
  /** Run cycle phase (radians) and amount 0..1. */
  run: number;
  runAmt: number;
  /** Secondary motion: ear/tail lag (-1..1). */
  lag: number;
  hurt: boolean;
  /** 0..1 overall scale (respawn pop). */
  pop: number;
}

export const defaultPose = (): PipPose => ({ sx: 1, sy: 1, lean: 0, facing: 1, blink: 0, lookX: 0, lookY: 0, run: 0, runAmt: 0, lag: 0, hurt: false, pop: 1 });

const OL = 2.6;

/** Draw Pip with its feet centred at (x, y) in world px. */
export function drawPip(g: Phaser.GameObjects.Graphics, x: number, y: number, p: PipPose): void {
  if (p.pop <= 0.01) return;
  g.save();
  g.translateCanvas(x, y);
  g.rotateCanvas(p.lean);
  g.scaleCanvas(p.sx * p.pop * (p.facing < 0 ? -1 : 1), p.sy * p.pop);

  const step = Math.sin(p.run) * p.runAmt;
  const footL = -7 + step * 4, footR = 7 - step * 4;
  const liftL = Math.max(0, Math.sin(p.run)) * p.runAmt * 3, liftR = Math.max(0, -Math.sin(p.run)) * p.runAmt * 3;
  const bob = Math.abs(Math.sin(p.run)) * p.runAmt * 1.5;
  const earTilt = p.lag * 3;

  // --- outline pass
  g.fillStyle(C.outline, 1);
  g.fillCircle(-10 + earTilt, -28 - bob, 7.5 + OL);
  g.fillCircle(10 + earTilt, -28 - bob, 7.5 + OL);
  g.fillEllipse(footL, -2 - liftL, 11 + OL * 2, 7 + OL * 2);
  g.fillEllipse(footR, -2 - liftR, 11 + OL * 2, 7 + OL * 2);
  g.fillEllipse(0, -14 - bob, 33 + OL * 2, 28 + OL * 2);
  // tail
  g.lineStyle(5 + OL, C.outline, 1);
  g.beginPath();
  g.moveTo(-14, -7 - bob);
  g.lineTo(-20 - p.lag * 2, -10 - bob);
  g.lineTo(-22 - p.lag * 3, -15 - bob);
  g.strokePath();

  // --- fills
  g.lineStyle(3.2, C.pink, 1);
  g.beginPath();
  g.moveTo(-14, -7 - bob);
  g.lineTo(-20 - p.lag * 2, -10 - bob);
  g.lineTo(-22 - p.lag * 3, -15 - bob);
  g.strokePath();

  for (const ex of [-10, 10]) {
    g.fillStyle(C.pip, 1);
    g.fillCircle(ex + earTilt, -28 - bob, 7.5);
    g.fillStyle(C.blush, 0.9);
    g.fillCircle(ex + earTilt + (ex < 0 ? 0.5 : -0.5), -27.5 - bob, 4.2);
  }
  g.fillStyle(C.pipShade, 1);
  g.fillEllipse(footL, -2 - liftL, 11, 7);
  g.fillEllipse(footR, -2 - liftR, 11, 7);
  g.fillStyle(C.pip, 1);
  g.fillEllipse(0, -14 - bob, 33, 28);
  // soft shading + belly + rim light
  g.fillStyle(C.pipShade, 0.55);
  g.fillEllipse(-2, -6 - bob, 26, 10);
  g.fillStyle(C.pip, 1);
  g.fillEllipse(0, -16 - bob, 30, 22);
  g.fillStyle(C.pipLight, 0.9);
  g.fillEllipse(3, -9 - bob, 15, 9);
  g.fillStyle(C.white, 0.55);
  g.fillEllipse(-7, -23 - bob, 9, 4);

  // face
  const lx = p.lookX * 2.5, ly = p.lookY * 1.5;
  const ey = -16 - bob + ly;
  if (p.hurt) {
    g.lineStyle(2.6, C.outline, 1);
    for (const ex of [-1, 11]) {
      g.lineBetween(ex - 3.5 + lx, ey - 3.5, ex + 3.5 + lx, ey + 3.5);
      g.lineBetween(ex + 3.5 + lx, ey - 3.5, ex - 3.5 + lx, ey + 3.5);
    }
    g.fillStyle(C.outline, 1);
    g.fillEllipse(6 + lx, -7 - bob, 6, 5);
  } else {
    for (const ex of [-1, 11]) {
      const open = 1 - p.blink;
      if (open > 0.2) {
        g.fillStyle(C.outline, 1);
        g.fillEllipse(ex + lx, ey, 8, 10 * open);
        g.fillStyle(C.white, 1);
        g.fillCircle(ex + lx + 1.6, ey - 2.6 * open, 2.2 * Math.min(1, open + 0.2));
        g.fillCircle(ex + lx - 1.5, ey + 2.2 * open, 1);
      } else {
        g.lineStyle(2.2, C.outline, 1);
        g.lineBetween(ex + lx - 3.5, ey + 0.5, ex + lx + 3.5, ey + 0.5);
      }
    }
    // mouth: a tiny "w"
    g.lineStyle(1.8, C.outline, 1);
    g.beginPath();
    g.moveTo(3 + lx, -9.5 - bob);
    g.lineTo(4.6 + lx, -8 - bob);
    g.lineTo(6 + lx, -9.3 - bob);
    g.lineTo(7.4 + lx, -8 - bob);
    g.lineTo(9 + lx, -9.5 - bob);
    g.strokePath();
  }
  g.fillStyle(C.blush, 0.75);
  g.fillEllipse(-5 + lx * 0.6, -9 - bob, 6, 3.4);
  g.fillEllipse(15 + lx * 0.6, -9 - bob, 5, 3.2);
  g.restore();
}
