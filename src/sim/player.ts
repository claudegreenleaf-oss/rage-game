// Pip: input -> velocity -> swept movement with pushing, step-up, one-way platforms and Rot bounces.
import { Btn, type Corpse } from './types';
import {
  AIR_ACCEL, AIR_DECEL, BOUNCE_MIN_VY, BOUNCE_RISE, CONVEYOR_SPEED, COYOTE, GRAVITY,
  GROUND_ACCEL, GROUND_DECEL, JUMP_BUFFER, PUSH_SPEED, STEP_UP,
} from './constants';
import { overlaps, sweepX, sweepY } from './physics';
import type { World } from './world';
import { gadgetField, scaledGravity } from './gadgets';
import { pushCorpse } from './corpse';

const approach = (v: number, target: number, step: number): number =>
  v < target ? Math.min(v + step, target) : Math.max(v - step, target);

/** Rise (units) achieved when launched upward at `v` with gravity `g` applied before each move. */
export function riseFor(v: number, g = GRAVITY): number {
  let rise = 0;
  for (let s = v - g; s > 0; s -= g) rise += s;
  return rise;
}

/** Smallest launch speed whose rise reaches `rise` units. */
export function launchFor(rise: number, g = GRAVITY): number {
  let v = 0;
  while (riseFor(v, g) < rise) v++;
  return v;
}

/** Corpses Pip pushes by walking into them (low ones are stepped onto instead). */
export function pushable(c: Corpse): boolean {
  return !c.pin && !c.floating && c.stage !== 2 && c.h > STEP_UP;
}

const WALL_SLIDE_MAX = 20;
const WALL_COYOTE = 6;
const WALL_LOCK = 10;

export function updatePlayer(w: World, input: number, pressed: number): void {
  const p = w.pip;
  if (p.regrab > 0) p.regrab--;
  if (p.wallLock > 0) p.wallLock--;
  if (p.hang && hang(w, input, pressed)) return;

  const rawDir = (input & Btn.Right ? 1 : 0) - (input & Btn.Left ? 1 : 0);
  // Right after a wall jump, pushing back toward that wall does nothing for a moment.
  const dir = p.wallLock > 0 && rawDir === p.wallDir ? 0 : rawDir;
  if (dir !== 0) p.facing = dir as -1 | 1;

  // Horizontal velocity: snappy accel/decel, no ice-skating. Extra speed from a swing carries a while.
  const T = w.tune;
  const target = dir * T.run;
  let a: number;
  if (p.grounded) a = dir !== 0 && Math.sign(p.vx) !== -dir ? GROUND_ACCEL : GROUND_DECEL;
  else a = dir !== 0 ? AIR_ACCEL : AIR_DECEL;
  const field = w.obj.gadgets.length ? gadgetField(w, p, true) : null;
  const fax = field?.ax ?? 0;
  if (!p.grounded && Math.abs(p.vx) > T.run && (Math.sign(p.vx) === dir || w.momentum > 0)) p.vx -= Math.sign(p.vx);
  else if (fax !== 0 && dir === 0 && Math.sign(p.vx) === Math.sign(fax)) { /* wind: no braking with it */ }
  else p.vx = approach(p.vx, target, a);
  if (fax !== 0) {
    p.vx += fax;
    const cap = T.run * 2;
    if (Math.abs(p.vx) > cap && Math.sign(p.vx) === Math.sign(fax)) p.vx = Math.sign(fax) * cap;
  }

  // Jump: buffer + coyote time.
  p.jumpHeld = (input & Btn.Jump) !== 0;
  if (pressed & Btn.Jump) p.jumpBuffer = JUMP_BUFFER;
  if (p.grounded) p.coyote = COYOTE;

  const support = w.supports.get(-1);
  const onOneWay = p.grounded && (
    (support?.kind === 'corpse' && w.corpseById(support.id)?.stage === 2) ||
    (support?.kind === 'obj' && (!!w.obj.platforms.find((pl) => pl.id === support.id)?.def.oneWay ||
      w.obj.gadgets.find((g) => g.id === support.id)?.def.solid === 'oneWay')));
  if (input & Btn.Down && onOneWay) {
    p.dropThrough = 10;
    p.grounded = false;
    p.coyote = 0;
  }

  // Wall slide (exploration zones only): pressing into a wall while falling slows the fall.
  const walls = w.abil.wallJump;
  let sliding = false;
  if (walls && !p.grounded) {
    if (rawDir !== 0 && touchingWall(w, rawDir) && p.vy > 0) { sliding = true; p.wallDir = rawDir as -1 | 1; p.wallCoyote = WALL_COYOTE; }
    else if (p.wallCoyote > 0) p.wallCoyote--;
  } else p.wallCoyote = 0;

  // Air jumps refill on the ground, against a wall or on a vine.
  if (w.abil.airJumps > 0 && w.airLeft < w.abil.airJumps && (p.grounded || touchingWall(w, -1) || touchingWall(w, 1))) w.airLeft = w.abil.airJumps;

  let jumpedNow = false;
  if (walls && p.jumpBuffer > 0 && p.coyote <= 0 && p.wallCoyote > 0 && !p.grounded) {
    p.vy = -(T.jump - 4);
    p.vx = -p.wallDir * T.run;
    p.facing = -p.wallDir as -1 | 1;
    p.jumping = true; p.bouncing = false;
    p.jumpBuffer = 0; p.wallCoyote = 0; p.wallLock = WALL_LOCK;
    jumpedNow = true;
    w.fx.push({ t: 'wallJump', x: p.x + (p.wallDir > 0 ? p.w : 0), y: p.y + (p.h >> 1), dir: -p.wallDir });
  } else if (p.jumpBuffer > 0 && p.coyote > 0) {
    p.vy = -T.jump;
    p.jumping = true;
    p.bouncing = false;
    p.coyote = 0;
    p.jumpBuffer = 0;
    p.grounded = false;
    jumpedNow = true;
    w.fx.push({ t: 'jump', x: p.x + (p.w >> 1), y: p.y + p.h });
  } else if (pressed & Btn.Jump && !p.grounded && w.airLeft > 0) {
    // Extra jump in mid-air.
    w.airLeft--;
    p.vy = -T.jump;
    p.jumping = true;
    p.bouncing = false;
    p.jumpBuffer = 0;
    jumpedNow = true;
    w.fx.push({ t: 'airJump', x: p.x + (p.w >> 1), y: p.y + p.h });
  } else {
    const cut = p.vy < 0 && p.jumping && !p.jumpHeld;
    const g = field && field.gravity !== 1 ? scaledGravity(cut ? T.gravityCut : T.gravity, field.gravity) : (cut ? T.gravityCut : T.gravity);
    p.vy = Math.min(p.vy + g, T.maxFall);
    if (field && field.gravity <= 0) p.vy = approach(p.vy, 0, 2);
  }
  if (field) {
    if (field.ay !== 0) p.vy = Math.max(-T.maxFall, Math.min(p.vy + field.ay, T.maxFall));
    if (field.slow < 1) { p.vx = Math.round(p.vx * field.slow); p.vy = Math.round(p.vy * field.slow); }
  }
  if (sliding && p.vy > WALL_SLIDE_MAX) {
    p.vy = WALL_SLIDE_MAX;
    if (w.tick % 6 === 0) w.fx.push({ t: 'wallSlide', x: p.x + (p.wallDir > 0 ? p.w : 0), y: p.y + p.h });
  }
  if (p.jumpBuffer > 0) p.jumpBuffer--;
  if (!p.grounded && !jumpedNow && p.coyote > 0) p.coyote--;
  if (p.vy >= 0) { p.jumping = false; p.bouncing = false; }

  // Conveyors carry Pip.
  let carry = 0;
  if (p.grounded && support?.kind === 'tile') carry = support.glyph === '}' ? CONVEYOR_SPEED : support.glyph === '{' ? -CONVEYOR_SPEED : 0;

  if (!(input & Btn.Down && dir !== 0 && p.grounded && drag(w, dir))) moveX(w, p.vx + carry);
  kickSkeletons(w);
  moveY(w);
  if (p.dropThrough > 0) p.dropThrough--;
  p.airTicks = p.grounded ? 0 : p.airTicks + 1;
  if (p.grounded) p.lastVine = null;
  if (!p.grounded && p.regrab === 0 && w.obj.vines.length) tryGrab(w);
}

/** Is there terrain (not a body) right beside Pip on that side? */
function touchingWall(w: World, side: number): boolean {
  const p = w.pip;
  const probe = { x: side > 0 ? p.x + p.w : p.x - 2, y: p.y + 24, w: 2, h: p.h - 48 };
  for (const s of w.solidsIn(probe, -1, false, false)) if (!s.oneWay && s.kind !== 'plate' && overlaps(probe, s)) return true;
  return false;
}

function tryGrab(w: World): void {
  const p = w.pip;
  const cx = p.x + (p.w >> 1);
  let best: { vine: string; seg: number; d: number } | null = null;
  for (const v of w.obj.vines) {
    if (v.id === p.lastVine) continue; // can't snag the vine you just leapt from until you land
    for (let i = 2; i < v.pts.length; i++) {
      const pt = v.pts[i]!;
      const dx = Math.abs(pt.x - cx);
      if (dx > 72 || pt.y < p.y - 24 || pt.y > p.y + p.h * 0.65) continue;
      if (!best || dx < best.d) best = { vine: v.id, seg: i, d: dx };
    }
  }
  if (!best) return;
  const v = w.obj.vines.find((x) => x.id === best!.vine)!;
  const pt = v.pts[best.seg]!;
  pt.px = pt.x - p.vx * 0.9;
  pt.py = pt.y - Math.max(0, p.vy) * 0.4;
  p.hang = { vine: best.vine, seg: best.seg };
  w.airLeft = w.abil.airJumps;
  p.jumping = false; p.bouncing = false; p.coyote = 0;
  w.fx.push({ t: 'grab', vine: v.id });
}

/** Hanging from a vine: pump with ←/→, slide down with ↓, leap off with jump. Returns true while hanging. */
function hang(w: World, input: number, pressed: number): boolean {
  const p = w.pip;
  const v = w.obj.vines.find((x) => x.id === p.hang!.vine);
  if (!v) { p.hang = null; return false; }
  const dir = (input & Btn.Right ? 1 : 0) - (input & Btn.Left ? 1 : 0);
  if (dir !== 0) p.facing = dir as -1 | 1;
  if (input & Btn.Down && w.tick % 4 === 0) {
    if (p.hang!.seg < v.pts.length - 1) p.hang!.seg++;
    else { p.hang = null; p.regrab = 16; w.fx.push({ t: 'release', vine: v.id }); return false; }
  }
  const pt = v.pts[p.hang!.seg]!;
  // Pump: pushing with the swing adds a lot, against it brakes gently.
  const swing = pt.x - pt.px;
  pt.px -= dir * (Math.sign(swing) === dir || Math.abs(swing) < 1 ? 3.2 : 1.6);
  pt.y += 1.2; // Pip's weight
  const vx = pt.x - pt.px, vy = pt.y - pt.py;
  if (pressed & Btn.Jump) {
    p.hang = null;
    p.regrab = 14;
    p.lastVine = v.id;
    p.vx = Math.max(-56, Math.min(56, Math.round(vx * 1.3) + dir * 8));
    p.vy = -Math.round(w.tune.jump * 0.9) + Math.min(0, Math.round(vy * 0.5));
    p.jumping = true; p.jumpHeld = true; p.grounded = false;
    w.fx.push({ t: 'release', vine: v.id });
    w.fx.push({ t: 'jump', x: p.x + (p.w >> 1), y: p.y + p.h });
    return true;
  }
  const nx = Math.round(pt.x - (p.w >> 1)), ny = Math.round(pt.y - 24);
  const next = { x: nx, y: ny, w: p.w, h: p.h };
  if (!w.isFree(next, -1)) { p.hang = null; p.regrab = 10; return false; }
  p.x = nx; p.y = ny;
  p.vx = Math.round(vx); p.vy = Math.round(vy);
  p.grounded = false; p.airTicks = 0; p.jumpHeld = (input & Btn.Jump) !== 0;
  return true;
}

/**
 * Hold ↓ and walk away from a body you're touching to drag it along (so bodies are never stuck
 * against a wall). Returns true if Pip is dragging this tick.
 */
function drag(w: World, dir: number): boolean {
  const p = w.pip;
  const c = w.corpses.find((k) => pushable(k) && k.grounded && k.y < p.y + p.h && k.y + k.h > p.y + p.h - 24 &&
    (dir > 0 ? k.x + k.w === p.x : k.x === p.x + p.w));
  if (!c) return false;
  const speed = PUSH_SPEED[c.stage];
  if (Math.abs(p.vx) > speed) p.vx = dir * speed;
  const solids = w.solidsAround(p, p.vx, 0, -1, false);
  const moved = sweepX(p, p.vx, solids).d;
  if (moved === 0) { p.vx = 0; return true; }
  p.x += moved;
  w.moveEntity(c.id, moved, 0, 0, true);
  if (w.tick % 10 === 0) w.fx.push({ t: 'push', corpse: c.id });
  return true;
}

function moveX(w: World, dx: number): void {
  const p = w.pip;
  let remaining = dx;
  for (let iter = 0; iter < 3 && remaining !== 0; iter++) {
    const solids = w.solidsAround(p, remaining, 0, -1, false);
    const { d, hit } = sweepX(p, remaining, solids);
    p.x += d;
    remaining -= d;
    if (!hit || remaining === 0) return;
    const sign = Math.sign(remaining);
    const lip = p.y + p.h - hit.y;

    // Push a body.
    if (hit.kind === 'corpse' && !(lip > 0 && lip <= STEP_UP)) {
      const c = w.corpseById(hit.id as number);
      if (c && pushable(c) && p.grounded) {
        const speed = PUSH_SPEED[c.stage];
        const want = sign * Math.min(Math.abs(remaining), speed);
        const moved = pushCorpse(w, c, want);
        if (moved !== 0) {
          const s2 = w.solidsAround(p, moved, 0, -1, false);
          p.x += sweepX(p, moved, s2).d;
          if (w.tick % 10 === 0) w.fx.push({ t: 'push', corpse: c.id });
        }
        if (Math.abs(p.vx) > speed) p.vx = Math.sign(p.vx) * speed;
        return;
      }
    }

    // Auto step-up over small lips (plates, slabs, flush corpses).
    if (p.grounded && lip > 0 && lip <= STEP_UP) {
      const raised = { x: p.x + sign, y: hit.y - p.h, w: p.w, h: p.h };
      if (w.isFree(raised, -1)) {
        p.y = hit.y - p.h;
        continue;
      }
    }
    p.vx = 0;
    return;
  }
}

function kickSkeletons(w: World): void {
  const p = w.pip;
  if (p.vx === 0) return;
  const sign = Math.sign(p.vx);
  for (const c of w.corpses) {
    if (c.stage !== 2 || c.pin || c.shape !== 'body' || c.floating) continue;
    if (!overlaps(p, c)) continue;
    if (p.y + p.h <= c.y) continue; // standing on it
    const toward = Math.sign(c.x + (c.w >> 1) - (p.x + (p.w >> 1)));
    if (toward !== 0 && toward !== sign) continue;
    if (c.vx * sign < PUSH_SPEED[2]) {
      c.vx = sign * PUSH_SPEED[2];
      w.fx.push({ t: 'push', corpse: c.id });
    }
  }
}

function moveY(w: World): void {
  const p = w.pip;
  const dy = p.vy;
  if (dy === 0) return;
  const solids = w.solidsAround(p, 0, dy, -1, false);
  const { d, hit } = sweepY(p, dy, solids, p.dropThrough > 0);
  p.y += d;
  const wasGrounded = p.grounded;
  if (dy > 0 && hit) {
    // Landing. Rot bounces Pip when landed on from above.
    if (hit.kind === 'corpse') {
      const c = w.corpseById(hit.id as number);
      if (c && c.stage === 1 && dy >= BOUNCE_MIN_VY) {
        const v = launchForCached(Math.round(BOUNCE_RISE * w.tune.bounce) - c.h, w.tune.gravity);
        p.vy = -v;
        p.bouncing = true;
        p.jumping = false;
        p.grounded = false;
        p.coyote = 0;
        w.fx.push({ t: 'bounce', x: p.x + (p.w >> 1), y: p.y + p.h, corpse: c.id });
        return;
      }
    }
    if (!wasGrounded && p.airTicks > 1) w.fx.push({ t: 'land', x: p.x + (p.w >> 1), y: p.y + p.h, impact: dy });
    p.grounded = true;
    p.vy = 0;
  } else {
    if (dy < 0 && hit) { p.vy = 0; p.jumping = false; p.bouncing = false; }
    p.grounded = false;
  }
}

const launchCache = new Map<string, number>();
function launchForCached(rise: number, g: number): number {
  const k = `${rise}:${g}`;
  let v = launchCache.get(k);
  if (v === undefined) { v = launchFor(rise, g); launchCache.set(k, v); }
  return v;
}
