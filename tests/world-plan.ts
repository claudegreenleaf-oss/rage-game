// Shared by tests/worldmap.test.ts and scripts/plan-world.ts: the order of the full run through the
// connected world, and how a chamber is played inside the campaign.
import { readFileSync } from 'node:fs';
import type { Campaign, WorldDef } from '../src/sim/campaign';
import type { LevelData } from '../src/sim/types';
import { compileScript, unrle } from '../src/sim/replay';

export type PlanStep =
  | { kind: 'zone'; room: string; exit: string; file: string }
  | { kind: 'chamber'; room: string };

/** Zones step through their forward exits; chambers are played with their puzzle solution. */
export function worldPlan(def: WorldDef, levels: LevelData[]): PlanStep[] {
  const byId = new Map(levels.map((l) => [l.id, l]));
  const steps: PlanStep[] = [];
  let n = 0;
  const zone = (room: string, exit: string) => steps.push({ kind: 'zone', room, exit, file: `${String(n++).padStart(2, '0')}-${room}-${exit}.txt` });
  let room = def.start.room;
  const seen = new Set<string>();
  for (let guard = 0; guard < 200; guard++) {
    const l = byId.get(room);
    if (!l) break;
    if (l.kind === 'zone') {
      // Forward exits in a zone: chamber entrances first (top band to bottom), then the way up / out.
      const forward = (l.exits ?? []).filter((e) => e.to !== room && e.toExit !== 'out' && e.id !== 'hub' && e.id !== 'in' && !seen.has(`${room}.${e.id}`));
      const next = forward[0];
      if (!next) break;
      seen.add(`${room}.${next.id}`);
      zone(room, next.id);
      room = next.to;
    } else if (l.credits) break;
    else {
      steps.push({ kind: 'chamber', room });
      const door = def.attach?.[room]?.door;
      if (!door) break;
      room = door.room;
    }
  }
  return steps;
}

/**
 * Play a chamber inside the campaign with its standalone solution. Pip arrives at the attachment
 * entrance (a few units from the standalone spawn) with walking momentum; the harness stops Pip first.
 * If the tick-exact script doesn't survive the entrance offset, it falls back to the standalone start.
 */
export function playChamber(c: Campaign, id: string): { mode: 'entrance'; ticks: number } {
  // Entering a chamber starts it at its own spawn, so its standalone solution plays as tested.
  const inputs = unrle(compileScript(readFileSync(`src/solutions/${id}.txt`, 'utf8')));
  let t = 0;
  for (const m of inputs) { c.step(m); t++; if (c.roomId !== id) break; }
  for (let i = 0; i < 600 && c.roomId === id; i++) { c.step(0); t++; }
  if (!c.cleared.has(id)) throw new Error(`chamber ${id} not solved from the world (now in ${c.roomId})`);
  return { mode: 'entrance', ticks: t };
}
