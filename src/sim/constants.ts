import { U } from './types';

/** Sim ticks per second. */
export const HZ = 60;
/** tiles/sec -> units/tick */
export const tps = (tilesPerSec: number): number => Math.round((tilesPerSec * U) / HZ);
/** seconds -> ticks */
export const secs = (s: number): number => Math.round(s * HZ);

// --- Pip -------------------------------------------------------------------
export const PIP_W = 180; // 0.75 tiles
export const PIP_H = 192; // 0.8 tiles
export const RUN_SPEED = 28; // 7 t/s
export const GROUND_ACCEL = 8; // full speed in ~0.06 s
export const GROUND_DECEL = 10; // stops in ~0.05 s
export const AIR_ACCEL = 6;
export const AIR_DECEL = 5;
export const GRAVITY = 4;
/** Extra gravity while rising with jump released (variable jump height). */
export const GRAVITY_CUT = 9;
export const JUMP_V = 66; // apex ~2.4 tiles held, ~1.15 tapped
export const MAX_FALL = 72;
export const COYOTE = 6; // 0.1 s
export const JUMP_BUFFER = 6; // 0.1 s
export const STEP_UP = 72; // 0.3 tiles
/** Falling at least this fast onto Rot counts as landing from above. */
export const BOUNCE_MIN_VY = 18;
/** Rot launches Pip to ~5.5 tiles above the surface the corpse rests on. */
export const BOUNCE_RISE = Math.round(5.5 * U);
export const PIP_WEIGHT = 1;

// --- Corpses ---------------------------------------------------------------
export const CORPSE_W = U;
export const STAGE_H = [192, 108, 48] as const; // Fresh 0.8, Rot 0.45, Skeleton 0.2
export const SLAB_H = 60; // 0.25
export const PIN_FLOOR_H = 36; // lies flush over the spikes
export const LEDGE_H = [108, 108, 48] as const;
export const STAGE_WEIGHT = [2, 1, 0] as const;
export const PUSH_SPEED = [tps(2), tps(3.5), tps(6)] as const; // 8, 14, 24
export const SKELETON_FRICTION = 1;
export const MAX_CORPSES = 3;
export const SHIVER_TICKS = secs(0.15);

// --- Death / respawn ---------------------------------------------------------
export const HITSTOP = 5; // ~80 ms
export const RESPAWN_DELAY = 21; // 0.35 s

// --- Objects ---------------------------------------------------------------
export const DROPPER_SHAKE = secs(0.25);
export const DROPPER_V0 = 45;
export const DROPPER_G = 8;
export const DROPPER_MAX = 160;
export const CRUSHER_SLAM = 60; // units/tick downward
export const CRUSHER_HOLD = secs(1);
export const CRUSHER_RISE = 8;
export const GATE_SPEED = 1 / 8; // open fraction per tick
export const CONVEYOR_SPEED = tps(2);
export const DOOR_RUN = tps(4);
export const DOOR_SIGHT = 3 * U;
export const DOOR_CATCH = Math.round(1.2 * U);
export const SIGN_RANGE = 3 * U;

// Spike hitboxes, relative to their tile (pointy half, inset at the sides).
export const SPIKE_DEPTH = 96; // 0.4 tiles
export const SPIKE_INSET = 36; // 0.15 tiles
