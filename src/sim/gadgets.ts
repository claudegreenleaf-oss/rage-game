// Gadgets: editor-built custom mechanics. A box with an optional path, an on/off state and an effect on what touches it.
import { PIP_H, PIP_W, GRAVITY, tps } from './constants';
import { U, type Box, type GadgetObj, type Pt } from './types';
import { overlaps } from './physics';
import { carryObjectRiders, carryRiders, type RtGadget, type RtPlate } from './hazards';
import { launchFor } from './player';
import { evalCondition } from './triggers';
import type { World } from './world';

const stepToward = (from: number, to: number, sp: number): number => Math.max(-sp, Math.min(sp, to - from));
const affectsPlayer = (g: RtGadget): boolean => g.def.affects?.player ?? true;
const affectsBodies = (g: RtGadget): boolean => g.def.affects?.bodies ?? true;

/** Per-effect accelerations are in units/tick^2: 1 tile/s^2 = 240/3600. Rounded to whole units (sign kept). */
const accel = (a: number): number => (a === 0 ? 0 : Math.round(a) === 0 ? Math.sign(a) : Math.round(a));
const tpsAccel = (a: number): number => accel((a * U) / 3600);

const bounceCache = new Map<string, number>();
function bounceSpeed(heightTiles: number, g: number): number {
  const rise = Math.round(heightTiles * U);
  const k = `${rise}:${g}`;
  let v = bounceCache.get(k);
  if (v === undefined) { v = launchFor(rise, g); bounceCache.set(k, v); }
  return v;
}

/** Is `box` touching the gadget: overlapping it, or (if currently solid) standing on it. */
function touches(g: RtGadget, box: Box): boolean {
  const solid = g.on && g.def.solid && g.def.solid !== 'none';
  return overlaps(solid ? { x: box.x, y: box.y, w: box.w, h: box.h + 1 } : box, g);
}

/** Recompute the effective on-state (link overrides everything, else `when`, else the action-set state). */
export function refreshGadget(w: World, g: RtGadget, silent = false): void {
  const d = g.def;
  let on: boolean;
  if (d.link) on = (w.obj.get<RtPlate>(d.link)?.pressed ?? false) !== !!d.invert;
  else if (d.when) on = evalCondition(w, d.when);
  else on = g.base;
  if (on !== g.on) {
    g.on = on;
    if (!silent) w.fx.push({ t: 'gadget', id: g.id, what: on ? 'on' : 'off' });
  }
}

export function refreshGadgets(w: World, silent = true): void {
  for (const g of w.obj.gadgets) refreshGadget(w, g, silent);
}

/** Gadget actions from events. */
export function gadgetOp(w: World, g: RtGadget, op: 'on' | 'off' | 'toggle' | 'start' | 'stop' | 'reverse'): void {
  switch (op) {
    case 'on': g.base = true; break;
    case 'off': g.base = false; break;
    case 'toggle': g.base = !g.base; break;
    case 'start': g.run = true; break;
    case 'stop': g.run = false; break;
    case 'reverse': {
      const n = g.pts.length;
      if (n < 2) break;
      const next = g.seg - g.dir;
      g.seg = g.def.loop ? ((next % n) + n) % n : Math.max(0, Math.min(n - 1, next));
      g.dir = g.dir === 1 ? -1 : 1;
      break;
    }
  }
  refreshGadget(w, g);
}

/** Start of every tick: state, conveyors, movement (carrying riders). */
export function updateGadgets(w: World): void {
  for (const g of w.obj.gadgets) {
    g.px = g.x; g.py = g.y;
    if (g.gone) continue;
    refreshGadget(w, g);
    const d = g.def;
    if (g.on && d.effect.kind === 'conveyor' && d.solid && d.solid !== 'none') {
      const sp = tps(d.effect.speed);
      if (sp !== 0)
        for (const r of w.ridersOf((s) => s.kind === 'obj' && s.id === g.id)) {
          if (r === -1 ? !affectsPlayer(g) : !affectsBodies(g)) continue;
          carryRiders(w, r, sp, 0, 0);
        }
    }
    if (g.pts.length < 2 || !d.speed || d.speed <= 0 || !g.run) continue;
    if ((d.move ?? 'always') === 'whenOn' && !g.on) continue;
    const sp = Math.max(1, tps(d.speed));
    const t = g.pts[g.seg]!;
    const dx = stepToward(g.x, t.x, sp), dy = stepToward(g.y, t.y, sp);
    g.x += dx; g.y += dy;
    carryObjectRiders(w, g.id, dx, dy);
    if (g.x === t.x && g.y === t.y) {
      const n = g.pts.length;
      const next = g.seg + g.dir;
      if (d.loop) g.seg = ((next % n) + n) % n;
      else if (next < 0 || next >= n) { g.dir = g.dir === 1 ? -1 : 1; g.seg += g.dir; }
      else g.seg = next;
    }
  }
}

export interface GadgetField { gravity: number; ax: number; ay: number; slow: number; any: boolean }

/** Continuous effects (gravity, force, slow) on a box inside on gadgets. */
export function gadgetField(w: World, box: Box, player: boolean): GadgetField {
  const f: GadgetField = { gravity: 1, ax: 0, ay: 0, slow: 1, any: false };
  for (const g of w.obj.gadgets) {
    if (!g.on || g.gone) continue;
    const k = g.def.effect.kind;
    if (k !== 'gravity' && k !== 'force' && k !== 'slow') continue;
    if (!(player ? affectsPlayer(g) : affectsBodies(g))) continue;
    if (!overlaps(box, g)) continue;
    const e = g.def.effect;
    f.any = true;
    if (e.kind === 'gravity') f.gravity *= e.scale;
    else if (e.kind === 'force') { f.ax += tpsAccel(e.ax); f.ay += tpsAccel(e.ay); }
    else if (e.kind === 'slow') f.slow *= Math.max(0, Math.min(1, e.factor));
  }
  return f;
}

/** Gravity for an entity given its base value: scaled by gadget fields (0 = none). */
export const scaledGravity = (base: number, scale: number): number =>
  scale === 1 ? base : scale <= 0 ? 0 : Math.max(1, Math.round(base * scale));

function teleportTarget(w: World, e: Extract<GadgetObj['effect'], { kind: 'teleport' }>, box: Box, pip: boolean): { x: number; y: number } | null {
  if (typeof e.to === 'string') {
    const dest = w.obj.get<RtGadget>(e.to);
    if (!dest) return null;
    return { x: dest.x + ((dest.w - box.w) >> 1), y: dest.y + ((dest.h - box.h) >> 1) };
  }
  const h = pip ? PIP_H : box.h, ww = pip ? PIP_W : box.w;
  return { x: Math.round(e.to.x * U + ((U - ww) >> 1)), y: Math.round((e.to.y + 1) * U - h) };
}

/** Move an entity (Pip or a body) to a spot without collision, and keep it from re-triggering teleports it lands in. */
function relocate(w: World, key: number, box: Box & { px?: number; py?: number }, pos: Pt): void {
  box.x = pos.x; box.y = pos.y; box.px = pos.x; box.py = pos.y;
  for (const o of w.obj.gadgets) if (o.def.effect.kind === 'teleport' && !o.gone && overlaps(box, o)) o.suppress.add(key);
}

/** End of tick: instant effects on whatever touches a gadget. */
export function gadgetEffects(w: World): void {
  for (const g of w.obj.gadgets) {
    if (g.gone) continue;
    const e = g.def.effect;
    const entities: Array<{ key: number; box: Box & { px?: number; py?: number }; pip: boolean }> = [];
    if (w.pipAlive) entities.push({ key: -1, box: w.pip, pip: true });
    for (const c of w.corpses) if (!c.pin) entities.push({ key: c.id, box: c, pip: false });
    const now = new Set<number>();
    for (const en of entities) {
      if (!touches(g, en.box)) continue;
      now.add(en.key);
      if (en.pip && !g.touching.has(-1)) w.fx.push({ t: 'gadget', id: g.id, what: 'touch' });
      if (!g.on) continue;
      if (!(en.pip ? affectsPlayer(g) : affectsBodies(g))) continue;
      if (en.pip && !w.pipAlive) continue;
      const p = w.pip;
      const c = en.pip ? null : (en.box as unknown as { vx: number; vy: number; grounded: boolean; floating: boolean });
      switch (e.kind) {
        case 'kill':
          if (en.pip) { w.killPip({ kind: e.cause ?? 'spike', x: p.x + (p.w >> 1), bottom: p.y + p.h }); }
          break;
        case 'bounce': {
          const vy = en.pip ? p.vy : c!.vy;
          if (vy < 0) break;
          const v = bounceSpeed(e.height, en.pip ? w.tune.gravity : GRAVITY);
          if (en.pip) { p.vy = -v; p.bouncing = true; p.jumping = false; p.grounded = false; p.coyote = 0; p.hang = null; }
          else { c!.vy = -v; c!.grounded = false; c!.floating = false; }
          w.fx.push({ t: 'gadget', id: g.id, what: 'bounce' });
         
          break;
        }
        case 'launch':
          if (en.pip) {
            p.vx = tps(e.vx); p.vy = tps(e.vy); p.grounded = false; p.jumping = false; p.coyote = 0; p.hang = null;
            if (Math.abs(p.vx) > w.tune.run) w.momentum = 24;
          } else { c!.vx = tps(e.vx); c!.vy = tps(e.vy); c!.grounded = false; c!.floating = false; }
          w.fx.push({ t: 'gadget', id: g.id, what: 'bounce' });
         
          break;
        case 'teleport': {
          if (g.suppress.has(en.key)) break;
          const to = teleportTarget(w, e, en.box, en.pip);
          if (!to) break;
          if (en.pip) { p.hang = null; if (typeof e.to === 'string') p.vy = Math.min(p.vy, 0); }
          relocate(w, en.key, en.box, to);
          w.fx.push({ t: 'gadget', id: g.id, what: 'teleport' });
         
          break;
        }
        case 'checkpoint':
          if (en.pip && !g.touching.has(-1)) {
            w.checkpoint = { x: g.x + ((g.w - PIP_W) >> 1), y: g.y + g.h - PIP_H };
            w.fx.push({ t: 'checkpoint', id: g.id });
          }
          break;
        case 'collect':
          if (en.pip) {
            if (e.var) w.setVar(e.var, 'add', e.amount ?? 1);
            g.gone = true;
            // Stays collected across deaths unless it feeds a variable that resets with the life.
            if (!e.var || w.varKeeps(e.var)) w.collectedGadgets.add(g.id);
            w.pickups.push(g.id);
            w.fx.push({ t: 'gadget', id: g.id, what: 'collect' });
            w.fx.push({ t: 'collect', id: g.id, kind: 'note' });
           
          }
          break;
        case 'win':
          if (en.pip) w.winNow();
          break;
        default: break;
      }
    }
    // Entities that left the gadget may trigger it again.
    for (const k of [...g.suppress]) if (!now.has(k)) g.suppress.delete(k);
    g.touching = now;
    if (g.def.once && g.on && !g.gone) {
      for (const k of now) if (k === -1 ? affectsPlayer(g) : affectsBodies(g)) { g.gone = true; break; }
    }
  }
}
