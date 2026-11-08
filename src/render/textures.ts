// Textures generated in code at boot (no image files ship with the game).
import Phaser from 'phaser';
import { C, MOODS } from './palette';

function canvasTex(scene: Phaser.Scene, key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): void {
  if (scene.textures.exists(key)) return;
  const t = scene.textures.createCanvas(key, w, h);
  if (!t) return;
  draw(t.getContext());
  t.refresh();
}

const rgba = (c: number, a: number) => `rgba(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255},${a})`;

export function makeTextures(scene: Phaser.Scene): void {
  // Soft radial glow (white, tinted at use).
  canvasTex(scene, 'glow', 128, 128, (ctx) => {
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  });
  // Small soft dot for particles.
  canvasTex(scene, 'soft', 32, 32, (ctx) => {
    const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.6)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 32, 32);
  });
  // Large-dot pattern tile.
  canvasTex(scene, 'dots', 96, 96, (ctx) => {
    ctx.fillStyle = 'rgba(255,255,255,1)';
    for (const [x, y] of [[24, 24], [72, 72]]) { ctx.beginPath(); ctx.arc(x!, y!, 9, 0, Math.PI * 2); ctx.fill(); }
  });
  // Vignette.
  canvasTex(scene, 'vignette', 512, 288, (ctx) => {
    const g = ctx.createRadialGradient(256, 144, 60, 256, 144, 300);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.65, 'rgba(0,0,0,0.05)');
    g.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 512, 288);
  });
  // Sky gradients per mood.
  for (const [k, m] of Object.entries(MOODS)) {
    canvasTex(scene, `sky${k}`, 4, 256, (ctx) => {
      const g = ctx.createLinearGradient(0, 0, 0, 256);
      g.addColorStop(0, rgba(m.skyTop, 1));
      g.addColorStop(1, rgba(m.skyBottom, 1));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 4, 256);
    });
  }
  // Light ray for the backdrop.
  canvasTex(scene, 'ray', 64, 256, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(18, 0); ctx.lineTo(46, 0); ctx.lineTo(64, 256); ctx.lineTo(0, 256); ctx.closePath(); ctx.fill();
  });
  void C;
}
