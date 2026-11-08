// Pip: input -> velocity -> swept movement with pushing, step-up, one-way platforms and Rot bounces.
import { Btn, type Corpse } from './types';
import {
  AIR_ACCEL, AIR_DECEL, BOUNCE_MIN_VY, BOUNCE_RISE, CONVEYOR_SPEED, COYOTE, GRAVITY, GRAVITY_CUT,
  GROUND_ACCEL, GROUND_DECEL, JUMP_BUFFER, JUMP_V, MAX_FALL, PUSH_SPEED, RUN_SPEED, STEP_UP,
} from './constants';
import { overlaps, sweepX, sweepY } from './physics';
import type { World } from './world';
import { pushCorpse } from './corpse';

const approach = (v: number, target: number, step: number): number =>
  v < target ? Math.min(v + step, target) : Math.max(v - step, target);

/** Rise (units) achieved when launched upward at `v` with normal gravity applied before each move. */
export function riseFor(v: number): number {
  let rise = 0;
  for (let s = v - GRAVITY; s > 0; s -= GRAVITY) rise += s;
  return rise;
}

/** Smallest launch speed whose rise reaches `rise` units. */
export function launchFor(rise: number): number {
  let v = 0;
  while (riseFor(v) < rise) v++;
  return v;
}

/** Corpses Pip pushes by walking into them (low ones are stepped onto instead). */
export function pushable(c: Corpse): boolean {
  return !c.pin && !c.floating && c.stage !== 2 && c.h > STEP_UP;
}

export function updatePlayer(w: World, input: number, pressed: number): void {
  const p = w.pip;
  const dir = (input & Btn.Right ? 1 : 0) - (input & Btn.Left ? 1 : 0);
  if (dir !== 0) p.facing = dir as -1 | 1;

  // Horizontal velocity: snappy accel/decel, no ice-skating.
  const target = dir * RUN_SPEED;
  let a: number;
  if (p.grounded) a = dir !== 0 && Math.sign(p.vx) !== -dir ? GROUND_ACCEL : GROUND_DECEL;
  else a = dir !== 0 ? AIR_ACCEL : AIR_DECEL;
  p.vx = approach(p.vx, target, a);

  // Jump: buffer + coyote time.
  p.jumpHeld = (input & Btn.Jump) !== 0;
  if (pressed & Btn.Jump) p.jumpBuffer = JUMP_BUFFER;
  if (p.grounded) p.coyote = COYOTE;

  const support = w.supports.get(-1);
  const onOneWay = p.grounded && (
    (support?.kind === 'corpse' && w.corpseById(support.id)?.stage === 2) ||
    (support?.kind === 'obj' && !!w.obj.platforms.find((pl) => pl.id === support.id)?.def.oneWay));
  if (input & Btn.Down && onOneWay) {
    p.dropThrough = 10;
    p.grounded = false;
    p.coyote = 0;
  }

  let jumpedNow = false;
  if (p.jumpBuffer > 0 && p.coyote > 0) {
    p.vy = -JUMP_V;
    p.jumping = true;
    p.bouncing = false;
    p.coyote = 0;
    p.jumpBuffer = 0;
    p.grounded = false;
    jumpedNow = true;
    w.fx.push({ t: 'jump', x: p.x + (p.w >> 1), y: p.y + p.h });
  } else {
    const cut = p.vy < 0 && p.jumping && !p.jumpHeld;
    p.vy = Math.min(p.vy + (cut ? GRAVITY_CUT : GRAVITY), MAX_FALL);
  }
  if (p.jumpBuffer > 0) p.jumpBuffer--;
  if (!p.grounded && !jumpedNow && p.coyote > 0) p.coyote--;
  if (p.vy >= 0) { p.jumping = false; p.bouncing = false; }

  // Conveyors carry Pip.
  let carry = 0;
  if (p.grounded && support?.kind === 'tile') carry = support.glyph === '}' ? CONVEYOR_SPEED : support.glyph === '{' ? -CONVEYOR_SPEED : 0;

  moveX(w, p.vx + carry);
  kickSkeletons(w);
  moveY(w);
  if (p.dropThrough > 0) p.dropThrough--;
  p.airTicks = p.grounded ? 0 : p.airTicks + 1;
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
        const v = launchForCached(BOUNCE_RISE - c.h);
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

const launchCache = new Map<number, number>();
function launchForCached(rise: number): number {
  let v = launchCache.get(rise);
  if (v === undefined) { v = launchFor(rise); launchCache.set(rise, v); }
  return v;
}
