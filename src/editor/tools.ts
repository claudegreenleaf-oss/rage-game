// Editor tools (how you paint) and palette items (what you paint), grouped by layer.
import { DECOR_IDS, decorChar, type DecorId, type LevelObject, type TileGlyph } from '../sim/types';
import type { LayerId } from './model';
import { DECOR_LABEL } from './decor';

export type ToolId = 'select' | 'brush' | 'rect' | 'line' | 'fill' | 'pick' | 'stamp' | 'erase';

export const TOOLS: Array<{ id: ToolId; label: string; icon: string; key: string; hint: string }> = [
  { id: 'select', label: 'Select', icon: '⬚', key: 'V', hint: 'Click to inspect; drag to move objects or marquee-select tiles. Ctrl+C / X / V, F flip.' },
  { id: 'brush', label: 'Brush', icon: '✎', key: 'B', hint: 'Paint. [ and ] change the brush size.' },
  { id: 'rect', label: 'Rectangle', icon: '▭', key: 'U', hint: 'Drag a filled rectangle.' },
  { id: 'line', label: 'Line', icon: '╱', key: 'L', hint: 'Drag a straight line.' },
  { id: 'fill', label: 'Fill', icon: '▧', key: 'G', hint: 'Flood-fill a connected area.' },
  { id: 'pick', label: 'Eyedropper', icon: '◉', key: 'I', hint: 'Pick the item under the cursor. (Alt-click works with any tool.)' },
  { id: 'stamp', label: 'Stamp', icon: '⎘', key: 'S', hint: 'Stamp the clipboard. Copy a selection first.' },
  { id: 'erase', label: 'Eraser', icon: '⌫', key: 'E', hint: 'Erase on the active layer (right-drag erases with any tool).' },
];

/** Something in the palette. */
export interface Item {
  id: string;
  label: string;
  icon: string;
  hint: string;
  /** Terrain glyph or decor char this item paints. */
  glyph?: string;
  decor?: DecorId;
  /** Object factory. */
  make?: (id: string, x: number, y: number) => LevelObject;
  idPrefix?: string;
  unique?: boolean;
  /** Zones layer specials. */
  mode?: 'zone' | 'exit' | 'link';
  group?: string;
}

export const TERRAIN: Item[] = [
  { id: 'solid', label: 'Lab plating', icon: '■', glyph: '#', hint: 'Solid. Moss grows on top edges.', group: 'Blocks' },
  { id: 'fake', label: 'Fake plating', icon: '▣', glyph: 'X', hint: "Looks solid. Isn't.", group: 'Blocks' },
  { id: 'troll', label: 'Troll tile', icon: '▤', glyph: '=', hint: 'Solid until an event drops, moves or removes it.', group: 'Blocks' },
  { id: 'crumble', label: 'Crumbling floor', icon: '▒', glyph: '%', hint: 'Gives way a moment after something stands on it. Back on respawn.', group: 'Blocks' },
  { id: 'beltR', label: 'Belt →', icon: '»', glyph: '}', hint: 'Sample belt: carries Pip, bodies and crates right.', group: 'Blocks' },
  { id: 'beltL', label: 'Belt ←', icon: '«', glyph: '{', hint: 'Carries left.', group: 'Blocks' },
  { id: 'empty', label: 'Empty', icon: '·', glyph: '.', hint: 'Open air.', group: 'Blocks' },
  { id: 'spikeU', label: 'Floor spikes', icon: '▲', glyph: '^', hint: 'Pins bodies flush; a covered spike is safe.', group: 'Hazards' },
  { id: 'spikeD', label: 'Ceiling spikes', icon: '▼', glyph: 'v', hint: 'The body falls to the floor.', group: 'Hazards' },
  { id: 'spikeR', label: 'Wall spikes →', icon: '▶', glyph: '>', hint: 'On a left wall. The body becomes a ledge.', group: 'Hazards' },
  { id: 'spikeL', label: 'Wall spikes ←', icon: '◀', glyph: '<', hint: 'On a right wall.', group: 'Hazards' },
  { id: 'water', label: 'Coolant', icon: '≈', glyph: '~', hint: 'Drowns Pip; bodies and crates float on the current.', group: 'Hazards' },
];

export const OBJECTS: Item[] = [
  { id: 'spawn', label: 'Spawn', icon: '☺', hint: 'Where Pip pops out.', unique: true, group: 'Basics', make: (_i, x, y) => ({ type: 'spawn', id: 'spawn', x, y }) },
  { id: 'door', label: 'Airlock exit', icon: '▯', hint: 'Reach it to win.', idPrefix: 'door', group: 'Basics', make: (id, x, y) => ({ type: 'door', id, x, y }) },
  { id: 'runaway', label: 'Runaway door', icon: '⇄', hint: 'Robot legs. Flees, hops over Pip; stopped by Fresh and Rot bodies.', idPrefix: 'door', group: 'Basics', make: (id, x, y) => ({ type: 'door', id, x, y, runaway: true }) },
  { id: 'sign', label: 'Sign monitor', icon: '?', hint: 'The smug designer talks here. Text can change with the death count.', idPrefix: 's', group: 'Basics', make: (id, x, y) => ({ type: 'sign', id, x, y, text: { 0: 'Trust me.' } }) },
  { id: 'bench', label: 'Checkpoint', icon: '⚑', hint: 'Touch it to respawn here.', idPrefix: 'b', group: 'Basics', make: (id, x, y) => ({ type: 'bench', id, x, y }) },
  { id: 'popup', label: 'Pop-up spike', icon: '⇡', hint: 'Hidden until an event pops it.', idPrefix: 'p', group: 'Traps', make: (id, x, y) => ({ type: 'popup', id, x, y }) },
  { id: 'dropper', label: 'Dropper', icon: '⬇', hint: 'A loose ceiling panel. Falls on Pip passing under.', idPrefix: 'd', group: 'Traps', make: (id, x, y) => ({ type: 'dropper', id, x, y }) },
  { id: 'crusher', label: 'Press', icon: '▥', hint: 'Hydraulic press. Slams when fired or on a period. Drag its corner to resize.', idPrefix: 'c', group: 'Traps', make: (id, x, y) => ({ type: 'crusher', id, x, y, w: 2, h: 1 }) },
  { id: 'laser', label: 'Laser', icon: '✶', hint: 'Security emitter plus a beam until it hits a wall.', idPrefix: 'l', group: 'Traps', make: (id, x, y) => ({ type: 'laser', id, x, y, dir: 'down', emitter: true, mode: 'on' }) },
  { id: 'blink', label: 'Blinking laser', icon: '✧', hint: 'A one-tile beam: 1 s on, 1 s off.', idPrefix: 'l', group: 'Traps', make: (id, x, y) => ({ type: 'laser', id, x, y, dir: 'right', emitter: false, len: 1, mode: 'blink', on: 60, off: 60 }) },
  { id: 'plate', label: 'Pressure pad', icon: '▁', hint: 'Pressed at weight ≥ 1 (Pip 1, Fresh 2, Rot 1, bones 0, crate 2).', idPrefix: 'pl', group: 'Machines', make: (id, x, y) => ({ type: 'plate', id, x, y, w: 1, need: 1 }) },
  { id: 'heavy', label: 'Heavy pad', icon: '▂', hint: 'Pressed at weight ≥ 3.', idPrefix: 'pl', group: 'Machines', make: (id, x, y) => ({ type: 'plate', id, x, y, w: 1, need: 3 }) },
  { id: 'gate', label: 'Blast shutter', icon: '┃', hint: 'Open while its pad is pressed. Set the pad in the inspector; drag to resize.', idPrefix: 'g', group: 'Machines', make: (id, x, y) => ({ type: 'gate', id, x, y, h: 2 }) },
  { id: 'platform', label: 'Lift', icon: '▬', hint: 'Moving platform. Drag its path points.', idPrefix: 'm', group: 'Machines', make: (id, x, y) => ({ type: 'platform', id, x, y, w: 2, path: [{ x, y }, { x: x + 4, y }], speed: 3, start: 'touch' }) },
  { id: 'vine', label: 'Vine', icon: '⌇', hint: 'Hanging vine: Pip grabs it mid-air and swings. Drag to set length.', idPrefix: 'v', group: 'Nature', make: (id, x, y) => ({ type: 'vine', id, x, y, len: 4 }) },
  { id: 'crate', label: 'Crate', icon: '▦', hint: 'Pushable, stackable, weight 2. Floats and props presses open.', idPrefix: 'k', group: 'Nature', make: (id, x, y) => ({ type: 'crate', id, x, y }) },
  { id: 'note', label: 'Lab note', icon: '✉', hint: 'A collectible with a short story text.', idPrefix: 'r', group: 'Secrets', make: (id, x, y) => ({ type: 'relic', id, x, y, kind: 'note', text: 'Day 1. The bodies keep coming back.' }) },
  { id: 'jar', label: 'Specimen jar', icon: '⚱', hint: 'A collectible jar.', idPrefix: 'r', group: 'Secrets', make: (id, x, y) => ({ type: 'relic', id, x, y, kind: 'jar' }) },
  { id: 'light', label: 'Light', icon: '☀', hint: 'A light source (colour, radius, flicker).', idPrefix: 'lt', group: 'Secrets', make: (id, x, y) => ({ type: 'light', id, x, y, color: '#ffe9a6', radius: 4 }) },
  { id: 'label', label: 'Text label', icon: 'T', hint: 'Decorative text (credits-style).', idPrefix: 'lab', group: 'Secrets', make: (id, x, y) => ({ type: 'label', id, x: x + 0.5, y: y + 0.5, text: 'Hello' }) },
];

export const DECOR: Item[] = DECOR_IDS.map((d, i) => ({ id: `decor_${d}`, label: DECOR_LABEL[d], icon: '', hint: DECOR_LABEL[d], decor: d, glyph: decorChar(i) }));

export const ZONES: Item[] = [
  { id: 'zone', label: 'Trigger zone', icon: '⬚', hint: 'Drag a rectangle. Pip or a body entering it can fire events.', mode: 'zone' },
  { id: 'exit', label: 'Room exit', icon: '⇥', hint: 'A passage to another room (connected world). Drag it on the room edge.', mode: 'exit' },
  { id: 'link', label: 'Link', icon: '⤳', hint: 'Click a trigger (zone, pad, object), then click targets and pick an action.', mode: 'link' },
];

export function itemsFor(layer: LayerId): Item[] {
  switch (layer) {
    case 'terrain': return TERRAIN;
    case 'bg': case 'fg': return DECOR;
    case 'objects': return OBJECTS;
    case 'zones': return ZONES;
    case 'images': return [];
  }
}

export const findItem = (id: string): Item | undefined => [...TERRAIN, ...OBJECTS, ...DECOR, ...ZONES].find((i) => i.id === id);
export const itemForGlyph = (layer: LayerId, g: string): Item | undefined =>
  layer === 'terrain' ? TERRAIN.find((i) => i.glyph === g) : layer === 'bg' || layer === 'fg' ? DECOR.find((i) => i.glyph === g) : undefined;

export const glyphOf = (it: Item | undefined): TileGlyph | string | undefined => it?.glyph;
