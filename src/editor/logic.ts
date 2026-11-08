// The event logic, described once: every trigger, condition and action the sim understands, with its fields.
// The events panel, the Link tool, the eyedroppers, the canvas wiring overlay and validation all read this,
// so a new trigger or action only needs an entry here.
import type {
  Action, CmpOp, Condition, DeathType, LevelData, LevelEvent, LevelObject, ObjType, Pt, TileRect, Trigger, Zone,
} from '../sim/types';

export type FieldKind =
  | { k: 'zone' }
  /** An object id. `types` limits which objects fit; `any` adds special targets like '@corpse'. */
  | { k: 'obj'; types?: ObjType[]; any?: Array<[string, string]>; /** Only things Pip can pick up. */ collectible?: boolean }
  /** A pressure pad or light sensor. */
  | { k: 'plate' }
  | { k: 'var' }
  | { k: 'signal' }
  | { k: 'point' }
  | { k: 'rect' }
  /** Waypoints. `rel`: offsets from the action's rect (moveTiles). */
  | { k: 'path'; rel?: boolean }
  | { k: 'num'; min: number; max: number; step: number; unit?: string }
  /** Stored as ticks, shown in seconds. */
  | { k: 'secs'; max?: number }
  | { k: 'text'; long?: boolean }
  | { k: 'choice'; opts: Array<[string, string]> }
  /** A boolean shown as a two-way choice. */
  | { k: 'bool'; yes: string; no: string }
  /** Optional boolean: unchanged / yes / no. */
  | { k: 'tri'; yes: string; no: string }
  | { k: 'sound' }
  | { k: 'cond' }
  | { k: 'tile' }
  | { k: 'cause' }
  | { k: 'op' };

export interface Field { key: string; label: string; kind: FieldKind; optional?: boolean }

export interface Spec {
  type: string;
  /** Sentence with {field} placeholders, e.g. "Pip enters {zone}". */
  say: string;
  /** Short name for menus. */
  label: string;
  group: string;
  hint: string;
  fields: Field[];
}

export const CAUSES: Array<[DeathType, string]> = [['spike', 'spikes'], ['crusher', 'crushed'], ['dropper', 'falling panel'], ['water', 'drowned'], ['pit', 'fell'], ['laser', 'laser']];
export const OPS: Array<[CmpOp, string]> = [['==', '='], ['!=', '≠'], ['<', '<'], ['<=', '≤'], ['>', '>'], ['>=', '≥']];
export const TILES: Array<[string, string]> = [['#', 'plating'], ['=', 'troll tile'], ['%', 'crumbling'], ['X', 'fake plating'], ['^', 'floor spikes'], ['v', 'ceiling spikes'], ['~', 'coolant'], ['}', 'belt →'], ['{', 'belt ←'], ['.', 'empty']];
const SPECIAL_ON: Array<[string, string]> = [['@corpse', 'any body'], ['@raft', 'a floating body']];
const TOUCHABLE: ObjType[] = ['gadget', 'crate', 'door', 'vine', 'relic', 'bench', 'sign', 'plate', 'sensor', 'gate', 'platform', 'crusher', 'dropper', 'laser', 'popup'];

// ---------------------------------------------------------------------------
// Triggers
// ---------------------------------------------------------------------------

export const TRIGGERS: Spec[] = [
  { type: 'playerEnters', say: 'Pip enters {zone}', label: 'Pip enters a zone', group: 'Pip', hint: 'The moment Pip steps into the zone.', fields: [{ key: 'zone', label: 'Zone', kind: { k: 'zone' } }] },
  { type: 'playerLeaves', say: 'Pip leaves {zone}', label: 'Pip leaves a zone', group: 'Pip', hint: 'The moment Pip steps out.', fields: [{ key: 'zone', label: 'Zone', kind: { k: 'zone' } }] },
  { type: 'playerOn', say: 'Pip stands on {target}', label: 'Pip stands on…', group: 'Pip', hint: 'Pip lands on an object (or any body, or a floating body).', fields: [{ key: 'target', label: 'On', kind: { k: 'obj', any: SPECIAL_ON } }] },
  { type: 'touch', say: 'Pip touches {target}', label: 'Pip touches…', group: 'Pip', hint: 'Pip bumps into, overlaps or stands on the object. Great with gadgets.', fields: [{ key: 'target', label: 'Object', kind: { k: 'obj', types: TOUCHABLE } }] },
  { type: 'collect', say: 'Pip collects {target}', label: 'Pip collects…', group: 'Pip', hint: 'A lab note, a jar or a collect gadget is picked up.', fields: [{ key: 'target', label: 'Item', kind: { k: 'obj', types: ['relic', 'gadget'], collectible: true } }] },
  { type: 'playerDies', say: 'Pip dies{cause? by }', label: 'Pip dies', group: 'Pip', hint: 'Right when Pip dies (optionally only from one cause).', fields: [{ key: 'cause', label: 'Cause', kind: { k: 'cause' }, optional: true }] },
  { type: 'key', say: 'the player presses {key}', label: 'A button is pressed', group: 'Pip', hint: 'Make your own controls: react to a button press.', fields: [{ key: 'key', label: 'Button', kind: { k: 'choice', opts: [['jump', 'jump'], ['down', 'down'], ['left', 'left'], ['right', 'right']] } }] },
  { type: 'corpseEnters', say: 'a body enters {zone}', label: 'A body enters a zone', group: 'Bodies', hint: 'A body or crate arrives in the zone.', fields: [{ key: 'zone', label: 'Zone', kind: { k: 'zone' } }] },
  { type: 'bodyTouch', say: 'a body touches {target}', label: 'A body touches…', group: 'Bodies', hint: 'A body or crate touches the object.', fields: [{ key: 'target', label: 'Object', kind: { k: 'obj', types: TOUCHABLE } }] },
  { type: 'plateDown', say: '{plate} is pressed', label: 'Pad / sensor pressed', group: 'Machines', hint: 'A pad gets enough weight, or the flashlight hits a light sensor.', fields: [{ key: 'plate', label: 'Pad', kind: { k: 'plate' } }] },
  { type: 'plateUp', say: '{plate} is released', label: 'Pad / sensor released', group: 'Machines', hint: 'The weight or the light goes away.', fields: [{ key: 'plate', label: 'Pad', kind: { k: 'plate' } }] },
  { type: 'start', say: 'the level starts', label: 'Level starts', group: 'Time', hint: 'At the start of every life (load, respawn, restart).', fields: [] },
  { type: 'timer', say: '{ticks} after spawning', label: 'After a delay', group: 'Time', hint: 'Once, this long after Pip appears.', fields: [{ key: 'ticks', label: 'After', kind: { k: 'secs' } }] },
  { type: 'every', say: 'every {ticks}', label: 'Repeating timer', group: 'Time', hint: 'Over and over, for rhythms and cycles.', fields: [{ key: 'ticks', label: 'Every', kind: { k: 'secs' } }, { key: 'phase', label: 'First at', kind: { k: 'secs' }, optional: true }] },
  { type: 'deathCountAtLeast', say: 'deaths reach {n}', label: 'Deaths reach…', group: 'Time', hint: 'Checked when a life starts.', fields: [{ key: 'n', label: 'Deaths', kind: { k: 'num', min: 0, max: 999, step: 1 } }] },
  { type: 'becomes', say: 'when {cond}', label: 'A condition comes true', group: 'Logic', hint: 'Fires the moment the condition turns true (e.g. coins ≥ 5).', fields: [{ key: 'cond', label: 'When', kind: { k: 'cond' } }] },
  { type: 'signal', say: 'signal “{name}” is sent', label: 'A signal arrives', group: 'Logic', hint: 'Another event sent this signal. Chain events together.', fields: [{ key: 'name', label: 'Signal', kind: { k: 'signal' } }] },
];

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

export const CONDITIONS: Spec[] = [
  { type: 'var', say: '{name} {op} {value}', label: 'Variable compare', group: 'Logic', hint: '', fields: [{ key: 'name', label: 'Variable', kind: { k: 'var' } }, { key: 'op', label: 'is', kind: { k: 'op' } }, { key: 'value', label: 'Value', kind: { k: 'num', min: -9999, max: 9999, step: 1 } }] },
  { type: 'pressed', say: '{plate} is {is}', label: 'Pad pressed?', group: 'Machines', hint: '', fields: [{ key: 'plate', label: 'Pad', kind: { k: 'plate' } }, { key: 'is', label: 'State', kind: { k: 'bool', yes: 'pressed', no: 'not pressed' } }] },
  { type: 'inZone', say: 'Pip is {is} {zone}', label: 'Pip in zone?', group: 'Pip', hint: '', fields: [{ key: 'zone', label: 'Zone', kind: { k: 'zone' } }, { key: 'is', label: 'State', kind: { k: 'bool', yes: 'in', no: 'not in' } }] },
  { type: 'collected', say: '{target} is {is}', label: 'Collected?', group: 'Pip', hint: '', fields: [{ key: 'target', label: 'Item', kind: { k: 'obj', types: ['relic', 'gadget'], collectible: true } }, { key: 'is', label: 'State', kind: { k: 'bool', yes: 'collected', no: 'not collected' } }] },
  { type: 'gadgetOn', say: '{target} is {is}', label: 'Gadget on?', group: 'Machines', hint: '', fields: [{ key: 'target', label: 'Gadget', kind: { k: 'obj', types: ['gadget'] } }, { key: 'is', label: 'State', kind: { k: 'bool', yes: 'on', no: 'off' } }] },
  { type: 'deaths', say: 'deaths {op} {value}', label: 'Death count', group: 'Time', hint: '', fields: [{ key: 'op', label: 'is', kind: { k: 'op' } }, { key: 'value', label: 'Value', kind: { k: 'num', min: 0, max: 999, step: 1 } }] },
  { type: 'bodies', say: 'bodies in the room {op} {value}', label: 'Body count', group: 'Bodies', hint: '', fields: [{ key: 'op', label: 'is', kind: { k: 'op' } }, { key: 'value', label: 'Value', kind: { k: 'num', min: 0, max: 6, step: 1 } }] },
];

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export const ACTIONS: Spec[] = [
  { type: 'popSpike', say: 'pop {target}', label: 'Pop spike', group: 'Traps', hint: 'A hidden spike shoots up.', fields: [{ key: 'target', label: 'Spike', kind: { k: 'obj', types: ['popup'] } }] },
  { type: 'fireCrusher', say: 'slam {target}', label: 'Fire press', group: 'Traps', hint: 'The press slams once.', fields: [{ key: 'target', label: 'Press', kind: { k: 'obj', types: ['crusher'] } }] },
  { type: 'fireDropper', say: 'drop {target}', label: 'Fire dropper', group: 'Traps', hint: 'The loose panel falls.', fields: [{ key: 'target', label: 'Dropper', kind: { k: 'obj', types: ['dropper'] } }] },
  { type: 'laser', say: 'turn {target} {mode}', label: 'Laser on / off / blink', group: 'Traps', hint: '', fields: [{ key: 'target', label: 'Laser', kind: { k: 'obj', types: ['laser'] } }, { key: 'mode', label: 'Mode', kind: { k: 'choice', opts: [['off', 'off'], ['on', 'on'], ['blink', 'blinking']] } }] },
  { type: 'toggleGate', say: 'toggle {target}', label: 'Toggle shutter', group: 'Machines', hint: 'Opens a shut shutter or shuts an open one.', fields: [{ key: 'target', label: 'Shutter', kind: { k: 'obj', types: ['gate'] } }] },
  { type: 'startPlatform', say: 'start {target}', label: 'Start lift', group: 'Machines', hint: 'For lifts set to start “on trigger”.', fields: [{ key: 'target', label: 'Lift', kind: { k: 'obj', types: ['platform'] } }] },
  { type: 'moveDoor', say: 'move {target} along a path', label: 'Move door', group: 'Machines', hint: 'The exit door walks along the path.', fields: [{ key: 'target', label: 'Door', kind: { k: 'obj', types: ['door'] } }, { key: 'path', label: 'Path', kind: { k: 'path' } }, { key: 'speed', label: 'Speed', kind: { k: 'num', min: 0.5, max: 16, step: 0.5, unit: 't/s' } }] },
  { type: 'gadget', say: '{op} {target}', label: 'Switch a gadget', group: 'Machines', hint: 'Turn a gadget on or off, or start, stop or reverse its movement.', fields: [{ key: 'target', label: 'Gadget', kind: { k: 'obj', types: ['gadget'] } }, { key: 'op', label: 'Do', kind: { k: 'choice', opts: [['on', 'turn on'], ['off', 'turn off'], ['toggle', 'toggle'], ['start', 'start moving'], ['stop', 'stop moving'], ['reverse', 'reverse']] } }] },
  { type: 'dropTiles', say: 'drop tiles {rect}', label: 'Drop tiles', group: 'Terrain', hint: 'The tiles fall away.', fields: [{ key: 'rect', label: 'Tiles', kind: { k: 'rect' } }] },
  { type: 'removeTiles', say: 'remove tiles {rect}', label: 'Remove tiles', group: 'Terrain', hint: 'The tiles vanish.', fields: [{ key: 'rect', label: 'Tiles', kind: { k: 'rect' } }] },
  { type: 'addTiles', say: 'fill {rect} with {tile}', label: 'Add tiles', group: 'Terrain', hint: 'Tiles appear (bridges, walls, spikes).', fields: [{ key: 'rect', label: 'Tiles', kind: { k: 'rect' } }, { key: 'tile', label: 'Tile', kind: { k: 'tile' } }] },
  { type: 'moveTiles', say: 'move tiles {rect}', label: 'Move tiles', group: 'Terrain', hint: 'The tiles slide along a path, carrying whatever stands on them.', fields: [{ key: 'rect', label: 'Tiles', kind: { k: 'rect' } }, { key: 'path', label: 'Path', kind: { k: 'path', rel: true } }, { key: 'speed', label: 'Speed', kind: { k: 'num', min: 0.5, max: 16, step: 0.5, unit: 't/s' } }] },
  { type: 'kill', say: 'kill Pip', label: 'Kill Pip', group: 'Pip', hint: 'Leaves a body like any death.', fields: [{ key: 'cause', label: 'As if by', kind: { k: 'cause' }, optional: true }] },
  { type: 'teleport', say: 'teleport Pip to {to}', label: 'Teleport Pip', group: 'Pip', hint: '', fields: [{ key: 'to', label: 'To', kind: { k: 'point' } }] },
  { type: 'launch', say: 'launch Pip ({vx}, {vy})', label: 'Launch Pip', group: 'Pip', hint: 'Sets Pip’s speed. Negative y is up.', fields: [{ key: 'vx', label: 'Sideways', kind: { k: 'num', min: -40, max: 40, step: 1, unit: 't/s' } }, { key: 'vy', label: 'Down (− up)', kind: { k: 'num', min: -40, max: 40, step: 1, unit: 't/s' } }] },
  { type: 'setSpawn', say: 'move the respawn point to {to}', label: 'Move respawn point', group: 'Pip', hint: '', fields: [{ key: 'to', label: 'To', kind: { k: 'point' } }] },
  { type: 'ability', say: 'change Pip’s abilities', label: 'Give / take abilities', group: 'Pip', hint: 'For the rest of this life.', fields: [{ key: 'wallJump', label: 'Wall jump', kind: { k: 'tri', yes: 'on', no: 'off' }, optional: true }, { key: 'airJumps', label: 'Air jumps', kind: { k: 'num', min: 0, max: 3, step: 1 }, optional: true }] },
  { type: 'setRule', say: 'set {rule} to ×{value}', label: 'Change physics', group: 'World', hint: 'For the rest of this life.', fields: [{ key: 'rule', label: 'Rule', kind: { k: 'choice', opts: [['gravity', 'gravity'], ['jump', 'jump height'], ['speed', 'run speed'], ['bounce', 'Rot bounce']] } }, { key: 'value', label: 'Multiplier', kind: { k: 'num', min: 0.1, max: 3, step: 0.05 } }] },
  { type: 'setCurrent', say: 'set the current', label: 'Set water current', group: 'World', hint: '', fields: [{ key: 'dir', label: 'Direction', kind: { k: 'choice', opts: [['1', '→'], ['-1', '←']] } }, { key: 'speed', label: 'Speed', kind: { k: 'num', min: 0, max: 8, step: 0.1, unit: 't/s' } }] },
  { type: 'spawnCrate', say: 'drop a crate at {at}', label: 'Spawn a crate', group: 'World', hint: '', fields: [{ key: 'at', label: 'At', kind: { k: 'point' } }] },
  { type: 'win', say: 'win the level', label: 'Win the level', group: 'World', hint: 'Like reaching the door.', fields: [] },
  { type: 'setVar', say: '{op} {value} → {name}', label: 'Change a variable', group: 'Logic', hint: 'Counters, keys, switches, scores.', fields: [{ key: 'name', label: 'Variable', kind: { k: 'var' } }, { key: 'op', label: 'Do', kind: { k: 'choice', opts: [['set', 'set to'], ['add', 'add'], ['sub', 'subtract']] } }, { key: 'value', label: 'Value', kind: { k: 'num', min: -9999, max: 9999, step: 1 } }] },
  { type: 'signal', say: 'send signal “{name}”', label: 'Send a signal', group: 'Logic', hint: 'Fires every event listening for this signal.', fields: [{ key: 'name', label: 'Signal', kind: { k: 'signal' } }] },
  { type: 'message', say: 'show “{text}”', label: 'Show a message', group: 'Feedback', hint: 'A caption at the bottom of the screen. Never covers Pip.', fields: [{ key: 'text', label: 'Text', kind: { k: 'text', long: true } }, { key: 'seconds', label: 'Seconds', kind: { k: 'num', min: 0.5, max: 20, step: 0.5 }, optional: true }] },
  { type: 'sign', say: '{target} says “{text}”', label: 'Change a sign', group: 'Feedback', hint: '', fields: [{ key: 'target', label: 'Sign', kind: { k: 'obj', types: ['sign'] } }, { key: 'text', label: 'Text', kind: { k: 'text' } }] },
  { type: 'shake', say: 'shake the screen', label: 'Screen shake', group: 'Feedback', hint: '', fields: [{ key: 'strength', label: 'Strength', kind: { k: 'num', min: 1, max: 30, step: 1 } }] },
  { type: 'sfx', say: 'play {name}', label: 'Play a sound', group: 'Feedback', hint: 'Any built-in sound, including ones you redesigned.', fields: [{ key: 'name', label: 'Sound', kind: { k: 'sound' } }] },
  { type: 'music', say: 'switch the music', label: 'Change the music', group: 'Feedback', hint: '', fields: [{ key: 'slot', label: 'Track', kind: { k: 'choice', opts: [['0', 'Title theme'], ['1', 'Act 1'], ['2', 'Act 2'], ['3', 'Act 3'], ['4', 'Credits'], ['5', 'Zone 1'], ['6', 'Zone 2'], ['7', 'Zone 3'], ['8', 'Gnossienne 1'], ['9', 'Gnossienne 2'], ['10', 'Gnossienne 3']] } }] },
];

export const triggerSpec = (type: string) => TRIGGERS.find((s) => s.type === type)!;
export const actionSpec = (type: string) => ACTIONS.find((s) => s.type === type)!;
export const condSpec = (type: string) => CONDITIONS.find((s) => s.type === type)!;

// ---------------------------------------------------------------------------
// Making defaults
// ---------------------------------------------------------------------------

export interface MakeCtx {
  level: LevelData;
  /** Object or zone the thing is aimed at (from the Link tool). */
  target?: string;
  /** Cell clicked. */
  cell?: Pt;
}

/** The first id that fits a field (the given target if it fits). */
function firstFit(l: LevelData, kind: FieldKind, target?: string): string {
  if (kind.k === 'zone') return (target && l.zones.some((z) => z.id === target)) ? target : l.zones[0]?.id ?? '';
  if (kind.k === 'plate') {
    const ok = (o: LevelObject) => o.type === 'plate' || o.type === 'sensor';
    const t = target ? l.objects.find((o) => o.id === target) : undefined;
    return t && ok(t) ? t.id : l.objects.find(ok)?.id ?? '';
  }
  if (kind.k === 'obj') {
    const t = target ? l.objects.find((o) => o.id === target) : undefined;
    if (t && fitsObj(kind, t)) return t.id;
    const any = l.objects.find((o) => fitsObj(kind, o));
    return any?.id ?? kind.any?.[0]?.[0] ?? '';
  }
  return '';
}

export function fitsObj(kind: Extract<FieldKind, { k: 'obj' }>, o: LevelObject): boolean {
  if (o.type === 'spawn' || o.type === 'label' || o.type === 'light') return false;
  if (kind.collectible) return o.type === 'relic' || (o.type === 'gadget' && o.effect.kind === 'collect');
  return !kind.types || kind.types.includes(o.type);
}

function defaultValue(f: Field, ctx: MakeCtx): unknown {
  const k = f.kind;
  const c = ctx.cell ?? { x: 1, y: 1 };
  switch (k.k) {
    case 'zone': case 'obj': case 'plate': return firstFit(ctx.level, k, ctx.target);
    case 'var': return ctx.level.vars?.[0]?.name ?? 'count';
    case 'signal': return 'go';
    case 'point': return { x: c.x, y: c.y };
    case 'rect': return { x: c.x, y: c.y, w: 1, h: 1 };
    case 'path': return k.rel ? [{ x: 0, y: -2 }] : [{ x: c.x + 3, y: c.y }];
    case 'num': return f.key === 'speed' ? 3 : f.key === 'strength' ? 6 : f.key === 'value' ? (ctx.level ? 1 : 0) : f.key === 'vy' ? -14 : f.key === 'vx' ? 0 : Math.max(k.min, Math.min(k.max, 1));
    case 'secs': return 60;
    case 'text': return f.key === 'text' ? 'Surprise!' : '';
    case 'choice': return k.opts[0]![0];
    case 'bool': return true;
    case 'tri': return undefined;
    case 'sound': return 'pop';
    case 'cond': return makeCond('var', ctx);
    case 'tile': return '#';
    case 'cause': return undefined;
    case 'op': return '>=';
  }
}

function build(spec: Spec, ctx: MakeCtx): Record<string, unknown> {
  const out: Record<string, unknown> = { type: spec.type };
  for (const f of spec.fields) {
    if (f.optional) continue;
    let v = defaultValue(f, ctx);
    if (spec.type === 'setCurrent' && f.key === 'dir') v = -1;
    if (spec.type === 'setCurrent' && f.key === 'speed') v = 1.2;
    if (spec.type === 'setVar' && f.key === 'op') v = 'add';
    if (spec.type === 'setRule' && f.key === 'value') v = 0.5;
    if (spec.type === 'music' && f.key === 'slot') v = 0;
    if (v !== undefined) out[f.key] = v;
  }
  if (spec.type === 'message') out.seconds = 3;
  return out;
}

export const makeTrigger = (type: string, ctx: MakeCtx): Trigger => build(triggerSpec(type), ctx) as unknown as Trigger;
export const makeAction = (type: string, ctx: MakeCtx): Action => build(actionSpec(type), ctx) as unknown as Action;
export function makeCond(type: string, ctx: MakeCtx): Condition {
  const c = build(condSpec(type), ctx) as Record<string, unknown>;
  if (type === 'var') c.value = 1;
  return c as unknown as Condition;
}

/** Store a field value (choice fields that hold numbers are converted back). */
export function setField(obj: Record<string, unknown>, f: Field, v: unknown): void {
  if (f.kind.k === 'choice' && (f.key === 'dir' || f.key === 'slot')) v = Number(v);
  if (v === undefined || v === '' || (f.optional && v === null)) delete obj[f.key];
  else obj[f.key] = v;
}

// ---------------------------------------------------------------------------
// Describing
// ---------------------------------------------------------------------------

const secsText = (t: number) => `${+(t / 60).toFixed(2)} s`;

export function nameOf(l: LevelData, id: string): string {
  if (id === '@corpse') return 'any body';
  if (id === '@raft') return 'a floating body';
  const o = l.objects.find((x) => x.id === id);
  if (o?.type === 'gadget' && o.name) return `${o.name} (${id})`;
  return id || '?';
}

function fmt(l: LevelData, f: Field, v: unknown): string {
  if (v === undefined || v === null || v === '') return '';
  const k = f.kind;
  switch (k.k) {
    case 'zone': case 'obj': case 'plate': return nameOf(l, String(v));
    case 'point': { const p = v as Pt; return `(${p.x}, ${p.y})`; }
    case 'rect': { const r = v as TileRect; return `${r.w}×${r.h} at (${r.x}, ${r.y})`; }
    case 'secs': return secsText(Number(v));
    case 'choice': return k.opts.find((o) => o[0] === String(v))?.[1] ?? String(v);
    case 'bool': return v ? k.yes : k.no;
    case 'tri': return v ? k.yes : k.no;
    case 'cond': return describeCond(l, v as Condition);
    case 'tile': return TILES.find((t) => t[0] === v)?.[1] ?? String(v);
    case 'cause': return CAUSES.find((c) => c[0] === v)?.[1] ?? String(v);
    case 'op': return OPS.find((o) => o[0] === v)?.[1] ?? String(v);
    default: return String(v);
  }
}

function sayOf(l: LevelData, spec: Spec, x: Record<string, unknown>): string {
  return spec.say
    .replace(/\{(\w+)\?([^}]*)\}/g, (_m, key: string, pre: string) => {
      const f = spec.fields.find((q) => q.key === key);
      const s = f ? fmt(l, f, x[key]) : '';
      return s ? `${pre}${s}` : '';
    })
    .replace(/\{(\w+)\}/g, (_m, key: string) => {
      const f = spec.fields.find((q) => q.key === key);
      return f ? fmt(l, f, x[key]) || '…' : '…';
    });
}

export const describeTrigger = (l: LevelData, t: Trigger) => sayOf(l, triggerSpec(t.type), t as unknown as Record<string, unknown>);
export const describeAction = (l: LevelData, a: Action) => sayOf(l, actionSpec(a.type), a as unknown as Record<string, unknown>) + (a.delay ? ` after ${secsText(a.delay)}` : '');
export const describeCond = (l: LevelData, c: Condition) => sayOf(l, condSpec(c.type), c as unknown as Record<string, unknown>);

export function describeEvent(l: LevelData, ev: LevelEvent): string {
  const when = describeTrigger(l, ev.trigger);
  const cond = ev.if?.length ? ` if ${ev.if.map((c) => describeCond(l, c)).join(' and ')}` : '';
  const acts = ev.actions.length ? ev.actions.map((a) => describeAction(l, a)).join(', ') : 'nothing yet';
  return `When ${when}${cond}: ${acts}`;
}

// ---------------------------------------------------------------------------
// References (wiring overlay, validation, renames)
// ---------------------------------------------------------------------------

export interface RefUse { key: string; kind: 'zone' | 'obj' | 'plate'; id: string }

function refsIn(spec: Spec, x: Record<string, unknown>): RefUse[] {
  const out: RefUse[] = [];
  for (const f of spec.fields) {
    const v = x[f.key];
    if (f.kind.k === 'zone' || f.kind.k === 'obj' || f.kind.k === 'plate') {
      if (typeof v === 'string' && v && !v.startsWith('@')) out.push({ key: f.key, kind: f.kind.k, id: v });
    } else if (f.kind.k === 'cond' && v) out.push(...refsIn(condSpec((v as Condition).type), v as unknown as Record<string, unknown>));
  }
  return out;
}

export const triggerRefs = (t: Trigger) => refsIn(triggerSpec(t.type), t as unknown as Record<string, unknown>);
export const actionRefs = (a: Action) => refsIn(actionSpec(a.type), a as unknown as Record<string, unknown>);
export const condRefs = (c: Condition) => refsIn(condSpec(c.type), c as unknown as Record<string, unknown>);

/** Every id an event mentions. */
export function eventRefs(ev: LevelEvent): RefUse[] {
  return [...triggerRefs(ev.trigger), ...(ev.if ?? []).flatMap(condRefs), ...ev.actions.flatMap(actionRefs)];
}

/** Where an action happens on the map (for the wiring overlay), in tiles. */
export function actionSpot(a: Action): { at?: Pt; rect?: TileRect; id?: string } {
  const r = a as unknown as Record<string, unknown>;
  if (typeof r.target === 'string' && r.target && !r.target.startsWith('@')) return { id: r.target };
  if (r.rect) return { rect: r.rect as TileRect };
  const p = (r.to ?? r.at) as Pt | undefined;
  if (p && typeof p === 'object') return { at: p };
  return {};
}

/** Problems with the level's logic: missing references, empty events, unknown variables. */
export function logicProblems(l: LevelData): string[] {
  const out: string[] = [];
  const ids = new Set(l.objects.map((o) => o.id));
  const zones = new Set(l.zones.map((z) => z.id));
  const vars = new Set((l.vars ?? []).map((v) => v.name));
  const check = (where: string, refs: RefUse[]) => {
    for (const r of refs) {
      if (r.kind === 'zone' ? !zones.has(r.id) : !ids.has(r.id)) out.push(`${where}: ${r.kind === 'zone' ? 'zone' : 'object'} “${r.id}” is missing`);
    }
  };
  const varUses = (x: unknown): string[] => {
    const o = x as Record<string, unknown> | null;
    if (!o || typeof o !== 'object') return [];
    const own = o.type === 'var' || o.type === 'setVar' ? [String(o.name)] : [];
    return [...own, ...(o.cond ? varUses(o.cond) : [])];
  };
  l.events.forEach((ev, i) => {
    const where = `Event ${i + 1}${ev.name ? ` (${ev.name})` : ''}`;
    if (ev.enabled === false) return;
    check(where, eventRefs(ev));
    for (const ref of triggerRefs(ev.trigger)) if (!ref.id) out.push(`${where}: pick a ${ref.kind === 'zone' ? 'zone' : 'target'}`);
    if (!ev.actions.length) out.push(`${where}: does nothing yet`);
    const used = [...varUses(ev.trigger), ...(ev.if ?? []).flatMap(varUses), ...ev.actions.flatMap(varUses)];
    for (const n of used) if (!vars.has(n)) out.push(`${where}: variable “${n}” isn’t defined (Level tab → Variables)`);
  });
  for (const o of l.objects) {
    if (o.type !== 'gadget') continue;
    if (o.link && !ids.has(o.link)) out.push(`${o.id}: its pad “${o.link}” is missing`);
    if (o.look?.art && !(l.images ?? []).some((im) => im.id === o.look!.art)) out.push(`${o.id}: its image “${o.look.art}” is missing`);
    if (o.effect.kind === 'teleport' && typeof o.effect.to === 'string' && !ids.has(o.effect.to)) out.push(`${o.id}: teleport target “${o.effect.to}” is missing`);
    if (o.when) check(o.id, condRefs(o.when));
    if (o.effect.kind === 'collect' && o.effect.var && !vars.has(o.effect.var)) out.push(`${o.id}: variable “${o.effect.var}” isn’t defined`);
  }
  return out;
}

/** Rename an id everywhere it is referenced (events, gadget links, shutters, lasers, teleports). */
export function renameRefs(l: LevelData, from: string, to: string): void {
  const fix = (x: unknown): void => {
    if (!x || typeof x !== 'object') return;
    const o = x as Record<string, unknown>;
    for (const k of ['zone', 'plate', 'target', 'link']) if (o[k] === from) o[k] = to;
    if (o.cond) fix(o.cond);
    if (o.when) fix(o.when);
  };
  for (const ev of l.events) { fix(ev.trigger); ev.if?.forEach(fix); ev.actions.forEach(fix); }
  for (const o of l.objects) {
    if ((o.type === 'gate' || o.type === 'laser') && o.plate === from) o.plate = to;
    if (o.type === 'gadget') {
      if (o.link === from) o.link = to;
      if (o.when) fix(o.when);
      if (o.effect.kind === 'teleport' && o.effect.to === from) o.effect.to = to;
    }
  }
}

/** Does an event mention this id (object or zone)? */
export const eventMentions = (ev: LevelEvent, id: string) => eventRefs(ev).some((r) => r.id === id);

/** Triggers that start from a clicked object or zone (first field fits it). */
export function triggersFor(thing: { obj?: LevelObject; zone?: Zone }): Spec[] {
  return TRIGGERS.filter((s) => {
    const f = s.fields[0];
    if (!f) return false;
    if (thing.zone) return f.kind.k === 'zone';
    const o = thing.obj;
    if (!o) return false;
    if (f.kind.k === 'plate') return o.type === 'plate' || o.type === 'sensor';
    if (f.kind.k === 'obj') return fitsObj(f.kind, o);
    return false;
  });
}

/** Actions aimed at a clicked object. */
export function actionsForObj(o: LevelObject): Spec[] {
  return ACTIONS.filter((s) => {
    const f = s.fields.find((q) => q.key === 'target');
    return !!f && f.kind.k === 'obj' && !!f.kind.types && fitsObj(f.kind, o);
  });
}

/** Actions that happen at a clicked cell. */
export const actionsForCell = (): Spec[] => ACTIONS.filter((s) => s.fields.some((f) => f.kind.k === 'rect' || f.kind.k === 'point'));
/** Actions that need no target at all. */
export const actionsGlobal = (): Spec[] => ACTIONS.filter((s) => !s.fields.some((f) => f.kind.k === 'obj' || f.kind.k === 'rect' || f.kind.k === 'point'));
/** Triggers that need no thing on the map. */
export const triggersGlobal = (): Spec[] => TRIGGERS.filter((s) => !s.fields.some((f) => f.kind.k === 'zone' || f.kind.k === 'obj' || f.kind.k === 'plate'));

/** Group specs for <optgroup>s. */
export function grouped(specs: Spec[]): Array<[string, Spec[]]> {
  const m = new Map<string, Spec[]>();
  for (const s of specs) { if (!m.has(s.group)) m.set(s.group, []); m.get(s.group)!.push(s); }
  return [...m];
}
