// Shared types for the deterministic simulation and the level format.
// Nothing in src/sim may import Phaser, touch the DOM, or use Math.random/Date.

/** Sim distance unit: 1 tile = 240 units. All sim positions/velocities are integers. */
export const U = 240;

// ---------------------------------------------------------------------------
// Level format (shared by shipped levels, the editor and share codes)
// ---------------------------------------------------------------------------

/**
 * Terrain glyphs stored in `LevelData.tiles`.
 * `#` solid · `.` empty · `X` fake (looks solid, isn't) · `=` troll tile (solid until an event)
 * `^ v > <` spikes (floor, ceiling, left wall, right wall) · `~` water
 * `}` conveyor right · `{` conveyor left (solid floor tiles; written `>>`/`<<` in the spec)
 * `%` crumbling floor (solid; gives way a moment after something stands on it; back on respawn)
 */
export type TileGlyph = '.' | '#' | 'X' | '=' | '^' | 'v' | '>' | '<' | '~' | '}' | '{' | '%';
export const TILE_GLYPHS: readonly TileGlyph[] = ['.', '#', 'X', '=', '^', 'v', '>', '<', '~', '}', '{', '%'];

export interface Pt { x: number; y: number }
export interface TileRect { x: number; y: number; w: number; h: number }

export type Dir4 = 'up' | 'down' | 'left' | 'right';

export interface SpawnObj { type: 'spawn'; id: string; x: number; y: number }
export interface DoorObj {
  type: 'door'; id: string; x: number; y: number; runaway?: boolean;
  /** In the connected world: where walking through the (won) door leads. */
  to?: { room: string; exit: string };
}
export interface SignObj { type: 'sign'; id: string; x: number; y: number; text: Record<string, string> }
export interface PopupObj { type: 'popup'; id: string; x: number; y: number }
export interface DropperObj {
  type: 'dropper'; id: string; x: number; y: number;
  /** Who sets it off by passing under. Default ['player']. */
  by?: Array<'player' | 'door'>;
}
export interface CrusherObj {
  type: 'crusher'; id: string; x: number; y: number; w: number; h: number;
  /** Ticks between automatic slams. 0/absent = only fires from events. */
  period?: number;
  /** Tick offset of the first automatic slam. */
  phase?: number;
}
export interface PlateObj { type: 'plate'; id: string; x: number; y: number; w: number; need: number }
export interface GateObj { type: 'gate'; id: string; x: number; y: number; h: number; plate?: string }
export interface PlatformObj {
  type: 'platform'; id: string; x: number; y: number; w: number;
  /** Waypoints in tile coords (top-left of the platform). The first point is the start. */
  path: Pt[];
  /** Tiles per second. */
  speed: number;
  start: 'always' | 'touch' | 'trigger';
  loop?: boolean;
  /** Solid only from above (Pip can drop through with ↓ and jump up through it). */
  oneWay?: boolean;
}
export interface LaserObj {
  type: 'laser'; id: string; x: number; y: number; dir: Dir4;
  /** If true, (x,y) holds a solid emitter block and the beam starts in the next tile. */
  emitter: boolean;
  /** Beam length in tiles. 0/absent = until it hits a solid tile. */
  len?: number;
  mode: 'on' | 'off' | 'blink' | 'plate';
  /** Blink pattern in ticks. */
  on?: number; off?: number; phase?: number;
  /** For mode 'plate': the beam is ON while this plate is NOT pressed. */
  plate?: string;
  /** Invisible and dormant until something first touches the beam; it then fires and is revealed for good. */
  hidden?: boolean;
}
export interface LabelObj { type: 'label'; id: string; x: number; y: number; text: string; size?: number }
/** A hanging vine/cable (verlet rope) anchored under tile (x, y). Pip grabs it mid-air and swings. */
export interface VineObj { type: 'vine'; id: string; x: number; y: number; len: number }
/** A pushable, stackable crate (weight 2). Floats, rides belts, props presses open. Resets on respawn. */
export interface CrateObj { type: 'crate'; id: string; x: number; y: number }
/** A checkpoint: touching it makes it your respawn point in this room. */
export interface BenchObj { type: 'bench'; id: string; x: number; y: number }
/** A collectible (kept for the whole run): a lab note with lore, or a specimen jar. */
export interface RelicObj { type: 'relic'; id: string; x: number; y: number; kind: 'note' | 'jar'; text?: string }
/** Decorative light source (render only). */
export interface LightObj { type: 'light'; id: string; x: number; y: number; color?: string; radius?: number; flicker?: boolean }

export type LevelObject =
  | SpawnObj | DoorObj | SignObj | PopupObj | DropperObj | CrusherObj
  | PlateObj | GateObj | PlatformObj | LaserObj | LabelObj
  | VineObj | CrateObj | BenchObj | RelicObj | LightObj;
export type ObjType = LevelObject['type'];

export interface Zone { id: string; x: number; y: number; w: number; h: number }
/** A passage to another room: a tile rect on this room's edge, linked to an exit in the target room. */
export interface Exit { id: string; x: number; y: number; w: number; h: number; to: string; toExit: string }

export type Trigger =
  | { type: 'playerEnters'; zone: string }
  | { type: 'corpseEnters'; zone: string }
  | { type: 'plateDown'; plate: string }
  | { type: 'plateUp'; plate: string }
  | { type: 'timer'; ticks: number }
  | { type: 'deathCountAtLeast'; n: number }
  /** target: an object id, or '@raft' / '@corpse'. */
  | { type: 'playerOn'; target: string };

interface ActionBase { delay?: number }
export type Action = ActionBase & (
  | { type: 'dropTiles'; rect: TileRect }
  | { type: 'removeTiles'; rect: TileRect }
  | { type: 'addTiles'; rect: TileRect; tile?: TileGlyph }
  /** path: offsets in tiles from the original position, visited in order. */
  | { type: 'moveTiles'; rect: TileRect; path: Pt[]; speed: number }
  | { type: 'popSpike'; target: string }
  | { type: 'fireCrusher'; target: string }
  | { type: 'fireDropper'; target: string }
  | { type: 'toggleGate'; target: string }
  /** path: absolute tile coords. */
  | { type: 'moveDoor'; target: string; path: Pt[]; speed: number }
  | { type: 'setCurrent'; dir: -1 | 1; speed: number }
  | { type: 'laser'; target: string; mode: 'on' | 'off' | 'blink' }
  | { type: 'sign'; target: string; text: string }
  | { type: 'shake'; strength: number }
  | { type: 'sfx'; name: string }
  /** Starts a platform whose start condition is 'trigger'. */
  | { type: 'startPlatform'; target: string }
);
export type ActionType = Action['type'];

export interface LevelEvent { trigger: Trigger; actions: Action[]; once?: boolean }

export interface LevelData {
  version: 1;
  id: string;
  name: string;
  act?: number;
  width: number;
  height: number;
  /** `height` rows of `width` terrain glyphs. */
  tiles: string[];
  /** Starting water current. Speed in tiles/sec. */
  current?: { dir: -1 | 1; speed: number };
  objects: LevelObject[];
  zones: Zone[];
  events: LevelEvent[];
  /** Set by the editor once the creator has beaten the level in playtest. */
  verified?: boolean;
  /** The playable credits roll. */
  credits?: boolean;
  /** 'chamber' = a corpse puzzle room (the 12 levels); 'zone' = an exploration/traversal area. */
  kind?: 'chamber' | 'zone';
  /** Visual biome (1 sterile wing, 2 flooded bio-lab, 3 deep containment). */
  biome?: number;
  /** Movement abilities in this room. Wall-slide/jump defaults to on in zones, off in chambers. */
  abilities?: { wallJump?: boolean };
  /** Passages to other rooms (connected world only). */
  exits?: Exit[];
  /** Intended deaths for the solution path (used to suggest a restart when the player is far past it). */
  par?: number;
}

// ---------------------------------------------------------------------------
// Runtime state
// ---------------------------------------------------------------------------

export const Btn = { Left: 1, Right: 2, Jump: 4, Down: 8, Restart: 16 } as const;

export type Stage = 0 | 1 | 2; // Fresh, Rot, Skeleton
export const STAGE_NAMES = ['Fresh', 'Rot', 'Skeleton'] as const;

export type DeathType = 'spike' | 'crusher' | 'dropper' | 'water' | 'pit' | 'laser';

export interface Box { x: number; y: number; w: number; h: number }

export interface Corpse extends Box {
  id: number;
  /** Crates share corpse physics but never age, pin or count toward the cap. */
  kind?: 'crate';
  crateId?: string;
  stage: Stage;
  /** 'body' uses the stage shape; 'slab' is a crushed full-width 0.25-tall body. */
  shape: 'body' | 'slab';
  /** Pinned by spikes: never moves. 'floor' lies flush over a floor spike; 'wall' sticks out as a ledge. */
  pin: null | { kind: 'floor' | 'wall'; cx: number; cy: number };
  floating: boolean;
  vx: number;
  vy: number;
  px: number; py: number; // previous position (render interpolation)
  /** Ticks left of the age-change shiver. */
  shiver: number;
  /** Order of creation; lower = older. */
  born: number;
  grounded: boolean;
}

export interface Player extends Box {
  vx: number;
  vy: number;
  px: number; py: number;
  facing: -1 | 1;
  grounded: boolean;
  coyote: number;
  jumpBuffer: number;
  jumpHeld: boolean;
  /** Rising from a jump (variable height applies). */
  jumping: boolean;
  /** Rising from a Rot bounce (variable height does not apply). */
  bouncing: boolean;
  airTicks: number;
  dropThrough: number;
  /** Side of the wall Pip is sliding on (-1 left, 1 right, 0 none) and grace ticks for a wall jump. */
  wallDir: -1 | 0 | 1;
  wallCoyote: number;
  /** Ticks during which input toward the wall just jumped from is ignored. */
  wallLock: number;
  /** Hanging from a vine: its id and the segment Pip holds. */
  hang: { vine: string; seg: number } | null;
  /** Ticks before Pip can grab a vine again after letting go. */
  regrab: number;
}

/** Things the renderer/audio react to. Emitted during a tick, cleared at the start of the next. */
export type SimEvent =
  | { t: 'jump'; x: number; y: number }
  | { t: 'land'; x: number; y: number; impact: number }
  | { t: 'bounce'; x: number; y: number; corpse: number }
  | { t: 'step'; x: number; y: number }
  | { t: 'push'; corpse: number }
  | { t: 'death'; kind: DeathType; x: number; y: number }
  | { t: 'corpse'; id: number }
  | { t: 'age'; id: number; stage: Stage }
  | { t: 'dust'; id: number; x: number; y: number }
  | { t: 'vaporize'; id: number; x: number; y: number }
  | { t: 'pin'; id: number }
  | { t: 'flatten'; id: number }
  | { t: 'splash'; x: number; y: number }
  | { t: 'respawn'; x: number; y: number }
  | { t: 'restart' }
  | { t: 'plate'; id: string; down: boolean }
  | { t: 'gate'; id: string; open: boolean }
  | { t: 'popSpike'; id: string }
  | { t: 'dropperShake'; id: string }
  | { t: 'dropperFall'; id: string }
  | { t: 'dropperBreak'; id: string; x: number; y: number }
  | { t: 'crusherSlam'; id: string }
  | { t: 'laserZap'; id: string }
  | { t: 'laserReveal'; id: string }
  | { t: 'tiles' }
  | { t: 'tilesDrop'; cells: Pt[] }
  | { t: 'sign'; id: string }
  | { t: 'doorHop'; id: string }
  | { t: 'doorScurry'; id: string }
  | { t: 'shake'; strength: number }
  | { t: 'sfx'; name: string }
  | { t: 'win'; x: number; y: number }
  | { t: 'wallJump'; x: number; y: number; dir: number }
  | { t: 'wallSlide'; x: number; y: number }
  | { t: 'grab'; vine: string }
  | { t: 'release'; vine: string }
  | { t: 'crumble'; cells: Pt[] }
  | { t: 'collect'; id: string; kind: 'note' | 'jar' }
  | { t: 'checkpoint'; id: string }
  | { t: 'exit'; id: string };
