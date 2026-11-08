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
/** A light sensor: "pressed" while Pip's flashlight beam hits it (link gates/lasers/events to it like a plate). */
export interface SensorObj { type: 'sensor'; id: string; x: number; y: number }
/**
 * A custom mechanic assembled from parts in the editor: a box that can look like anything (colour, shape or
 * a pixel-art image), be solid / one-way / passable, do something to whatever touches it, move along a path,
 * and be switched on and off by a pad, a sensor, a variable or events. Touching it also fires `touch` events.
 */
export interface GadgetObj {
  type: 'gadget'; id: string;
  /** Top-left in tiles (fractional ok) and size in tiles (0.25-64). */
  x: number; y: number; w: number; h: number;
  /** Display name in the editor (e.g. "Spring"). */
  name?: string;
  look?: {
    /** '#rrggbb'. Default per effect. */
    color?: string;
    shape?: 'box' | 'round' | 'spikes' | 'field' | 'none';
    /** A PixelArt id (from level.images) drawn stretched over the gadget instead of the shape. */
    art?: string;
    /** A short symbol drawn in the middle (e.g. '↑'). */
    glyph?: string;
    glow?: boolean;
  };
  /** 'solid' blocks like plating (and carries riders when moving); 'oneWay' only from above. Default 'none'. */
  solid?: 'none' | 'solid' | 'oneWay';
  effect: GadgetEffect;
  /** Who the effect applies to. Default both. */
  affects?: { player?: boolean; bodies?: boolean };
  /** Initial state. Default true. Off gadgets are not solid and do nothing (drawn faded). */
  on?: boolean;
  /** On only while this pad/sensor is pressed (or while it isn't, with invert). Overrides `on`/events. */
  link?: string;
  invert?: boolean;
  /** On only while this condition holds (checked every tick). */
  when?: Condition;
  /** Movement: absolute tile waypoints of the top-left; the first is the start. */
  path?: Pt[];
  /** Tiles per second. */
  speed?: number;
  /** Loop back to the first point (else ping-pong). */
  loop?: boolean;
  /** 'always' (default when a path exists), 'whenOn' (moves only while on), 'trigger' (waits for a gadget start action). */
  move?: 'always' | 'whenOn' | 'trigger';
  /** Disappears after its first touch (until respawn). */
  once?: boolean;
}

/** What a gadget does to an entity touching (overlapping, or standing on, if solid) it. Numbers in tiles and seconds. */
export type GadgetEffect =
  | { kind: 'none' }
  /** Kills Pip; bodies are unaffected. */
  | { kind: 'kill'; cause?: DeathType }
  /** Launches straight up to about `height` tiles. */
  | { kind: 'bounce'; height: number }
  /** Sets velocity (tiles/s; y down is positive). */
  | { kind: 'launch'; vx: number; vy: number }
  /** Constant acceleration while inside (tiles/s²): fans, wind, updrafts. */
  | { kind: 'force'; ax: number; ay: number }
  /** Gravity multiplier while inside (0 = float, 0.3 = moon, 2 = heavy). */
  | { kind: 'gravity'; scale: number }
  /** Moves the entity to a tile point, or to the centre of another gadget (by id). */
  | { kind: 'teleport'; to: Pt | string }
  /** Slows horizontal and vertical speed while inside (0 = stuck, 1 = no effect). */
  | { kind: 'slow'; factor: number }
  /** Carries things standing on it (tiles/s; needs solid). */
  | { kind: 'conveyor'; speed: number }
  /** Becomes Pip's respawn point. */
  | { kind: 'checkpoint' }
  /** Pip picks it up: adds `amount` (default 1) to variable `var` (if set) and disappears. */
  | { kind: 'collect'; var?: string; amount?: number }
  /** Touching it wins the level, like reaching the door. */
  | { kind: 'win' };
export type GadgetEffectKind = GadgetEffect['kind'];

/** Decorative light source (render only). */
export interface LightObj { type: 'light'; id: string; x: number; y: number; color?: string; radius?: number; flicker?: boolean }

export type LevelObject =
  | SpawnObj | DoorObj | SignObj | PopupObj | DropperObj | CrusherObj
  | PlateObj | GateObj | PlatformObj | LaserObj | LabelObj
  | VineObj | CrateObj | BenchObj | RelicObj | LightObj | SensorObj | GadgetObj;
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
  | { type: 'playerOn'; target: string }
  /** Every life start (level load, respawn, restart), after objects are built. */
  | { type: 'start' }
  /** Repeats every `ticks` (first at `phase`, default `ticks`). */
  | { type: 'every'; ticks: number; phase?: number }
  | { type: 'playerLeaves'; zone: string }
  /** Pip dies (any cause, or one cause). Fires before the respawn; delayed actions are dropped by the respawn. */
  | { type: 'playerDies'; cause?: DeathType }
  /** Pip starts touching an object (overlap or standing on): gadgets, crates, doors, vines, relics... */
  | { type: 'touch'; target: string }
  /** A body or crate starts touching a gadget or zone-like object. */
  | { type: 'bodyTouch'; target: string }
  /** A relic or a collect-gadget is picked up. */
  | { type: 'collect'; target: string }
  /** A button is pressed (edge). */
  | { type: 'key'; key: 'jump' | 'down' | 'left' | 'right' }
  /** The condition becomes true (edge: false → true). */
  | { type: 'becomes'; cond: Condition }
  /** Another event sent this signal (action `signal`). */
  | { type: 'signal'; name: string };

/** A test on the level state, used by event `if`s, `becomes` triggers and gadget `when`s. */
export type Condition =
  | { type: 'var'; name: string; op: CmpOp; value: number }
  | { type: 'pressed'; plate: string; is: boolean }
  | { type: 'deaths'; op: CmpOp; value: number }
  | { type: 'gadgetOn'; target: string; is: boolean }
  | { type: 'collected'; target: string; is: boolean }
  /** Pip is inside a zone. */
  | { type: 'inZone'; zone: string; is: boolean }
  /** Number of bodies (not crates) in the room. */
  | { type: 'bodies'; op: CmpOp; value: number };
export type CmpOp = '==' | '!=' | '<' | '<=' | '>' | '>=';

/** A level variable: a number events can set, add to and test. */
export interface LevelVar {
  name: string;
  /** Starting value. */
  value: number;
  /** Keep the value across deaths (default: reset every life, like everything else). */
  keep?: boolean;
  /** Show it on the HUD as "label: value" (e.g. "Keys"). */
  show?: string;
}

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
  | { type: 'setVar'; name: string; op: 'set' | 'add' | 'sub'; value: number }
  /** Fires every event with a matching `signal` trigger (chains are capped at 16 deep per tick). */
  | { type: 'signal'; name: string }
  | { type: 'kill'; cause?: DeathType }
  /** Moves Pip to a tile point (top-left of the tile Pip stands in). */
  | { type: 'teleport'; to: Pt }
  /** Sets Pip's velocity (tiles/s). */
  | { type: 'launch'; vx: number; vy: number }
  /** Moves the respawn point. */
  | { type: 'setSpawn'; to: Pt }
  /** Changes a rule for the rest of this life (gravity, jump, speed, bounce multipliers). */
  | { type: 'setRule'; rule: 'gravity' | 'jump' | 'speed' | 'bounce'; value: number }
  | { type: 'ability'; wallJump?: boolean; airJumps?: number }
  | { type: 'gadget'; target: string; op: 'on' | 'off' | 'toggle' | 'start' | 'stop' | 'reverse' }
  /** Drops a crate at a tile point. */
  | { type: 'spawnCrate'; at: Pt }
  /** A caption at the bottom of the screen (never over Pip). */
  | { type: 'message'; text: string; seconds?: number }
  /** Wins the level now. */
  | { type: 'win' }
  /** Switches the music to a built-in slot (0-10). */
  | { type: 'music'; slot: number }
);
export type ActionType = Action['type'];

export interface LevelEvent {
  trigger: Trigger;
  actions: Action[];
  /** Fires at most once per life. */
  once?: boolean;
  /** Only fires while all of these hold. */
  if?: Condition[];
  /** Editor label ("Open the vault"). */
  name?: string;
  /** false: ignored (kept for later). */
  enabled?: boolean;
}

// ---------------------------------------------------------------------------
// Customization (editor): art layers, pixelated images, audio, rules
// ---------------------------------------------------------------------------

/**
 * Decorative tiles painted behind (bg) or in front of (fg) the playfield. One char per tile;
 * '.' is empty, other chars index DECOR_IDS (a = DECOR_IDS[0], b = DECOR_IDS[1], ...). Purely visual.
 */
export const DECOR_IDS = [
  'panel', 'panelDark', 'panelCracked', 'window', 'windowBroken', 'monitor', 'monitorDead', 'server',
  'tank', 'tankBroken', 'pipeH', 'pipeV', 'cable', 'vent', 'grate', 'lamp',
  'vine', 'ivy', 'moss', 'fern', 'roots', 'mushroom', 'puddle', 'bones',
  'crate', 'barrel', 'console', 'hazardStripe', 'poster', 'sign', 'chain', 'debris',
] as const;
export type DecorId = (typeof DECOR_IDS)[number];
export const decorChar = (i: number): string => 'abcdefghijklmnopqrstuvwxyzABCDEF'[i] ?? '.';
export const decorIndex = (ch: string): number => 'abcdefghijklmnopqrstuvwxyzABCDEF'.indexOf(ch);

/** A user image, pixelated in the editor to a small palette. */
export interface PixelArt {
  id: string;
  /** Top-left in tiles (fractional ok). */
  x: number; y: number;
  /** Size in art pixels (1 art pixel = 1 game pixel; 16 per tile). */
  w: number; h: number;
  /** Up to 32 colours as '#rrggbb'; index 255 = transparent. */
  palette: string[];
  /** base64 of w*h palette indices (1 byte each), row-major. */
  data: string;
  layer: 'bg' | 'fg';
  /** 1 = moves with the level, < 1 = distant parallax. */
  parallax?: number;
  opacity?: number;
}

/** A user-composed theme for a level: a looping step sequence. */
export interface SongData {
  name?: string;
  bpm: number;
  /** Steps per loop (16th notes). */
  steps: number;
  tracks: Array<{
    instrument: 'lead' | 'pulse' | 'bell' | 'pad' | 'bass' | 'drums';
    volume: number; // 0..1
    /** [step, midi pitch, length in steps]. For drums: pitch 0 kick, 1 snare, 2 hat, 3 clap. */
    notes: Array<[number, number, number]>;
  }>;
}

export interface LevelAudio {
  /** Built-in music slot (0 title, 1-3 acts, 4 credits) when there's no custom theme. */
  music?: number;
  theme?: SongData;
  /** ZzFX parameter overrides keyed by sound name (jump, land, squeak, ...). */
  sfx?: Record<string, number[]>;
}

/** Rule tweaks a level can make. All optional; defaults are the normal game. */
export interface LevelRules {
  /** Corpse cap (1-6, default 3). */
  maxCorpses?: number;
  /** false: deaths don't age the other bodies. */
  aging?: boolean;
  /** Multipliers (0.5-2). */
  gravity?: number;
  jump?: number;
  speed?: number;
  /** Multiplier on the Rot bounce height. */
  bounce?: number;
}

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
  /** Movement abilities in this room. Wall-slide/jump defaults to on. */
  abilities?: { wallJump?: boolean; /** Extra jumps in mid-air (0-3, default 0). */ airJumps?: number };
  /** Level variables for events and gadgets. */
  vars?: LevelVar[];
  /** Passages to other rooms (connected world only). */
  exits?: Exit[];
  /** Decor layers: `height` rows of `width` chars each (see DECOR_IDS). */
  decor?: { bg?: string[]; fg?: string[] };
  images?: PixelArt[];
  audio?: LevelAudio;
  rules?: LevelRules;
  /** Dark room: only Pip's flashlight beam and light objects show anything. */
  dark?: boolean;
  /** Visual palette override for the level (act palette index 1-3). */
  palette?: number;
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
  /** The vine Pip last leapt from (can't re-grab it until landing). */
  lastVine: string | null;
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
  | { t: 'exit'; id: string }
  | { t: 'gadget'; id: string; what: 'touch' | 'on' | 'off' | 'bounce' | 'teleport' | 'collect' }
  | { t: 'airJump'; x: number; y: number }
  | { t: 'message'; text: string; seconds: number }
  | { t: 'music'; slot: number }
  | { t: 'var'; name: string; value: number };
