// Editor palette: tabs and the tools in each. A tool either paints terrain or places an object.
import type { LevelObject, TileGlyph } from '../sim/types';

export type TabId = 'tiles' | 'hazards' | 'objects' | 'signs' | 'events';

export interface Tool {
  id: string;
  label: string;
  /** Short glyph/icon shown on the swatch. */
  icon: string;
  hint: string;
  /** Terrain glyph this tool paints (drag paints). */
  tile?: TileGlyph;
  /** Object factory (click places one). */
  make?: (id: string, x: number, y: number) => LevelObject;
  idPrefix?: string;
  /** Only one allowed: placing moves the existing one. */
  unique?: boolean;
  /** Special modes. */
  mode?: 'select' | 'zone' | 'link';
}

export const TABS: Array<{ id: TabId; label: string; key: string }> = [
  { id: 'tiles', label: 'Tiles', key: '1' },
  { id: 'hazards', label: 'Hazards', key: '2' },
  { id: 'objects', label: 'Objects', key: '3' },
  { id: 'signs', label: 'Signs', key: '4' },
  { id: 'events', label: 'Events', key: '5' },
];

export const SELECT: Tool = { id: 'select', label: 'Select / move', icon: '➤', hint: 'Click to inspect, drag to move. Delete removes.', mode: 'select' };

export const TOOLS: Record<TabId, Tool[]> = {
  tiles: [
    { id: 'solid', label: 'Solid', icon: '■', hint: 'Charcoal block.', tile: '#' },
    { id: 'fake', label: 'Fake tile', icon: '▣', hint: 'Looks solid. Isn’t.', tile: 'X' },
    { id: 'troll', label: 'Troll tile', icon: '▤', hint: 'Solid until an event drops, moves or removes it.', tile: '=' },
    { id: 'convR', label: 'Conveyor →', icon: '»', hint: 'Floor that carries Pip and bodies right at 2 t/s.', tile: '}' },
    { id: 'convL', label: 'Conveyor ←', icon: '«', hint: 'Floor that carries left.', tile: '{' },
    { id: 'empty', label: 'Empty', icon: '·', hint: 'Clear terrain (right-drag also erases).', tile: '.' },
  ],
  hazards: [
    { id: 'spikeU', label: 'Floor spikes', icon: '▲', hint: 'Pins bodies flush; a covered spike is safe.', tile: '^' },
    { id: 'spikeD', label: 'Ceiling spikes', icon: '▼', hint: 'The body falls to the floor.', tile: 'v' },
    { id: 'spikeR', label: 'Wall spikes →', icon: '▶', hint: 'On a left wall. The body becomes a ledge.', tile: '>' },
    { id: 'spikeL', label: 'Wall spikes ←', icon: '◀', hint: 'On a right wall.', tile: '<' },
    { id: 'water', label: 'Water', icon: '≈', hint: 'Drowns Pip; bodies float as rafts on the current.', tile: '~' },
    { id: 'popup', label: 'Pop-up spike', icon: '⇡', hint: 'Hidden until an event pops it.', idPrefix: 'p', make: (id, x, y) => ({ type: 'popup', id, x, y }) },
    { id: 'dropper', label: 'Dropper', icon: '⬇', hint: 'Looks like ceiling. Falls on Pip passing under.', idPrefix: 'd', make: (id, x, y) => ({ type: 'dropper', id, x, y }) },
    { id: 'crusher', label: 'Crusher', icon: '▥', hint: 'Slams when fired (or on a period). Flattens into slabs.', idPrefix: 'c', make: (id, x, y) => ({ type: 'crusher', id, x, y, w: 2, h: 1 }) },
    { id: 'laser', label: 'Laser', icon: '✶', hint: 'Emitter block plus a beam until it hits a wall.', idPrefix: 'l', make: (id, x, y) => ({ type: 'laser', id, x, y, dir: 'down', emitter: true, mode: 'on' }) },
    { id: 'blink', label: 'Blinking laser', icon: '✧', hint: 'A one-tile beam that blinks 1 s on, 1 s off.', idPrefix: 'l', make: (id, x, y) => ({ type: 'laser', id, x, y, dir: 'right', emitter: false, len: 1, mode: 'blink', on: 60, off: 60 }) },
  ],
  objects: [
    { id: 'spawn', label: 'Spawn', icon: '☺', hint: 'Where Pip pops out.', unique: true, make: (_id, x, y) => ({ type: 'spawn', id: 'spawn', x, y }) },
    { id: 'door', label: 'Exit door', icon: '▯', hint: 'Reach it to win.', idPrefix: 'door', make: (id, x, y) => ({ type: 'door', id, x, y }) },
    { id: 'runaway', label: 'Runaway door', icon: '🚪', hint: 'Has legs. Flees from Pip, blocked by Fresh and Rot bodies.', idPrefix: 'door', make: (id, x, y) => ({ type: 'door', id, x, y, runaway: true }) },
    { id: 'plate', label: 'Plate', icon: '▁', hint: 'Pressed at weight ≥ 1.', idPrefix: 'pl', make: (id, x, y) => ({ type: 'plate', id, x, y, w: 1, need: 1 }) },
    { id: 'heavy', label: 'Heavy plate', icon: '▂', hint: 'Pressed at weight ≥ 3.', idPrefix: 'pl', make: (id, x, y) => ({ type: 'plate', id, x, y, w: 1, need: 3 }) },
    { id: 'gate', label: 'Gate', icon: '┃', hint: 'Open while its plate is pressed. Set its plate in the inspector.', idPrefix: 'g', make: (id, x, y) => ({ type: 'gate', id, x, y, h: 2 }) },
    { id: 'platform', label: 'Moving platform', icon: '▬', hint: 'Path, speed and start condition in the inspector.', idPrefix: 'm', make: (id, x, y) => ({ type: 'platform', id, x, y, w: 2, path: [{ x, y }, { x: x + 4, y }], speed: 3, start: 'touch' }) },
    { id: 'label', label: 'Text label', icon: 'T', hint: 'Decorative text (credits-style).', idPrefix: 'lab', make: (id, x, y) => ({ type: 'label', id, x: x + 0.5, y: y + 0.5, text: 'Hello' }) },
  ],
  signs: [
    { id: 'sign', label: 'Sign', icon: '?', hint: 'The smug designer talks here. Text can change with the death count.', idPrefix: 's', make: (id, x, y) => ({ type: 'sign', id, x, y, text: { 0: 'Trust me.' } }) },
  ],
  events: [
    { id: 'zone', label: 'Trigger zone', icon: '⬚', hint: 'Drag a rectangle. Pip or a body entering it can fire events.', mode: 'zone' },
    { id: 'link', label: 'Link', icon: '⤳', hint: 'Click a zone, plate or object (the trigger), then click targets and pick an action.', mode: 'link' },
  ],
};

export function findTool(id: string): Tool | undefined {
  if (id === SELECT.id) return SELECT;
  for (const list of Object.values(TOOLS)) {
    const t = list.find((x) => x.id === id);
    if (t) return t;
  }
  return undefined;
}
