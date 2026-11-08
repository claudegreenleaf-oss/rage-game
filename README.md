# Die Trying

A pixel-art puzzle-platformer set in a vast, abandoned, overgrown high-tech laboratory, in the rage-game style (traps spring, floors vanish, signs lie), where **your corpses stay behind and become your tools**. Every death leaves a body you can stand on, push, bounce on, or use to weigh down a plate. It should feel unfair the first time and obvious the second.

**Play:** https://claudegreenleaf-oss.github.io/rage-game/

Built with Phaser 3, TypeScript and Vite. All art is generated in code (a pixel sprite atlas and bitmap font built at boot), the soundtrack is public-domain Erik Satie (the Gymnopédies and Ogives) played on a synthesized felt piano, and the sound effects are soft, synthesized ZzFX. The original design is in [`Spec.md`](Spec.md); see [Changes from the spec](#changes-from-the-spec) for what playtesting changed.

## How to play

| Key | Action |
|---|---|
| ← → / A D | Move |
| Space / ↑ / W | Jump (hold for a higher jump) |
| ↓ / S | Drop through a bone platform |
| ↓ + walk away | Drag a body or crate you're touching (pull it off a wall) |
| Jump into a vine | Grab it; ← → pump the swing, jump leaps off, ↓ slides down |
| Into a wall while falling | Wall-slide; jump to wall-jump (exploration zones only) |
| R | Restart the room and clear all corpses |
| Tab | Map |
| Esc | Pause |
| M | Mute |

The rules, each taught by one level:

- **Bodies stay.** Up to three. The fourth death turns the oldest to dust.
- **Every death ages the others.** Fresh (solid, weight 2) → Rot (bouncy, weight 1) → Skeleton (a one-way bone platform, weight 0). Pits and lasers leave no body and age nothing.
- **How you die shapes the body.** Spikes pin it (a floor spike becomes safe to walk on, a wall spike becomes a ledge), crushers make slabs, water makes rafts.
- **The level forgets, the dead remember.** On respawn every trap, platform, door and sign resets. Corpses keep their place, so a body on a plate keeps holding it down.

If you've died well past a level's par since your last restart, the HUD suggests **R**: a bad pile of bodies is always one keypress from a clean slate.

**New game** drops you into the lab: one connected, scrolling world of exploration zones (vine swings over coolant, wall-jump shafts, crates, crumbling floors, lifts, hidden rooms, shortcuts, checkpoints, lab notes and specimen jars to find) linking **16 puzzle chambers in 4 acts**: Fresh Meat, Rot, Bare Bones and The Core (the hardest), then playable credits. **Chambers** on the title screen plays any chamber on its own.

### Level editor

Open it from the title screen. Everything is customizable:

- **Build:** terrain, hazards and every object (vines, crates, crumbling floors, checkpoints, lab notes, lights, room exits included) with brush, rectangle, line, fill, eyedropper, stamp and select/copy/paste/flip tools; pan and zoom, a minimap, rooms up to 200×60.
- **Art:** paint background and foreground decor (32 lab tiles: panels, windows, monitors, tanks, pipes, vines, moss, ferns, bones…) on separate layers, or **import any image** and pixelate it to 2–32 colours (with dithering) as a parallax background or foreground.
- **Sound:** a sound designer for every game sound (all ZzFX parameters, live preview, presets, randomize/mutate), stored per level.
- **Music:** a piano-roll composer with six soft instruments (drums as a grid), BPM, 3/4 or 4/4, and templates (including a Satie-like waltz), or pick a built-in track.
- **Rules:** corpse cap, aging on/off, gravity, jump height, run speed, bounce height, wall-jump.
- **Logic:** the full troll engine: trigger zones linked to actions (dropping and moving tiles, pop-up spikes, crushers, droppers, gates, doors, currents, lasers, signs, shakes, sounds).

Press **P** to playtest from the cursor (Shift+P from the spawn); beat your level from the spawn to mark it **Verified**, then **Share** copies a link (`#lvl=…`, lz-string compressed) that opens straight into the level; pasting a code on the title screen does the same. Drafts autosave; Import/Export use JSON files; Ctrl+Z / Ctrl+Shift+Z undo and redo; Ctrl+K opens a command palette. Every shipped level is in the template gallery.

## Run it

```sh
npm install
npm run dev        # http://localhost:5173/rage-game/
npm run build      # production build in dist/
npm run preview    # serve the build
```

Requires Node 20+. The game also runs without `localStorage` (progress just won't persist).

## Test it

```sh
npm test           # everything: Vitest (Node) then the Playwright browser smoke test
npm run test:unit  # Vitest only: solution replays, rule unit tests, level invariants
npm run test:smoke # Playwright only (first run: npx playwright install chromium)
```

- `tests/replays.test.ts` runs every solution script in `src/solutions/` through the pure simulation at full speed and asserts the level is won **with the intended number of deaths**, then prints a table of level, solved, deaths and time.
- `tests/sim.test.ts` covers the core rules: movement feel, corpse aging and the cap, death-type results, weight through stacks, the respawn reset rule, Rot bounce height, Skeleton one-way and drop-through, and doors blocked by Fresh and Rot but not Skeletons.
- `tests/invariants.test.ts` encodes each level's binding invariants from the spec, mostly by brute-forcing families of jumps (for example, "you can't jump straight from the last stop to the bank").
- `tests/smoke.spec.ts` boots the production build, starts L1 with real key presses and checks the death counter goes up, and that the game runs with `localStorage` disabled.

CI (`.github/workflows/deploy.yml`) typechecks, runs all of the above, builds, and deploys `dist/` to GitHub Pages on every push to `main`.

### Writing solution scripts

Solutions are tiny input scripts compiled to one input bitmask per tick (`left, right, jump, down, restart`), run-length encoded:

```
right 40        # hold right for 40 ticks (60 ticks = 1 s)
right+jump 12
wait 30
left 8
```

`npm run trace L06` replays `src/solutions/L06.txt` and prints Pip, the corpses and key events after every line, which is how the shipped solutions were tuned.

## Architecture

```
src/sim/       Pure TypeScript simulation, no Phaser: fixed 60 Hz, integer units (1 tile = 240),
               custom swept-AABB physics, corpses, hazards, the event engine, replays.
src/levels/    Shipped levels as JSON (act1–act3, extra/credits.json).
src/solutions/ One solution script per level.
src/render/    Code-drawn art: tiles, Pip, corpses, particles, the level renderer.
src/scenes/    Phaser scenes: Boot, Title, LevelSelect, ActCard, Game, Hud, Pause, Credits, End.
src/audio/     ZzFX sound presets and a small tracker for the per-act music loops.
src/editor/    The level editor (document model, palette, DOM panels, share codes).
scripts/       Dev tools: level authoring from ASCII maps, trace and movement metrics.
tests/         Vitest suites and the Playwright smoke test.
```

The simulation never touches `Math.random`, `Date` or the DOM, so a run is fully determined by the level and the inputs; the renderer only reads sim state and feeds it input. Cosmetic randomness (particles) uses a seeded RNG on the render side.

## Changes from the spec

Playtesting with the owner changed the direction after the spec's v1 was built and deployed:

- **Pixel art** in an abandoned, overgrown high-tech lab instead of flat vector pastels; a close follow camera (about 20 tiles across) instead of fitting the whole level on screen.
- **A connected world** (Campaign of rooms joined by exits) instead of a level-by-level campaign; the original chambers plug in through `world.json`'s `attach` overlay so their files, solutions and tests are unchanged.
- **New mechanics:** wall-slide/jump (exploration zones only, so puzzles stay fair), verlet vines, crates, crumbling floors, checkpoints, relics; dragging bodies with ↓ (fixes bodies stuck against walls); an R prompt when you're far past par.
- **Act 4 "The Core"** (L13–L16).
- **Audio:** Satie on a synthesized piano, soft ASMR-like effects.
- **Plates** are flush floor sensors (nothing snags on them).

## Level JSON format

Levels are plain JSON, exactly what the editor saves and what share codes carry:

```jsonc
{
  "version": 1,
  "id": "L01",
  "name": "Trust Me",
  "act": 1,                       // backdrop mood (1–3)
  "width": 22, "height": 6,       // up to 32 × 18 tiles
  "tiles": [                      // `height` rows of `width` terrain glyphs
    "######################",
    "#........#############",
    "#........#############",
    "#........vvvv#########",
    "#.........^^.........#",
    "######################"
  ],
  "current": { "dir": 1, "speed": 2 },   // optional starting water current (tiles/s)
  "objects": [
    { "type": "spawn", "id": "spawn", "x": 1, "y": 4 },
    { "type": "door",  "id": "door",  "x": 20, "y": 4 },
    { "type": "sign",  "id": "s1", "x": 4, "y": 4, "text": { "0": "SAFE →  just walk", "1": "See? Safe." } },
    { "type": "popup", "id": "p1", "x": 18, "y": 4 }
  ],
  "zones":  [ { "id": "popzone", "x": 16, "y": 4, "w": 2, "h": 1 } ],
  "events": [
    { "trigger": { "type": "playerEnters", "zone": "popzone" },
      "actions": [ { "type": "popSpike", "target": "p1" } ],
      "once": true }
  ]
}
```

**Terrain glyphs:** `#` solid · `.` empty · `X` fake (looks solid, isn't) · `=` troll tile (solid until an event) · `^ v > <` spikes (floor, ceiling, left wall, right wall) · `~` water · `}` `{` conveyor right / left · `%` crumbling floor. A gap in the bottom wall is a bottomless pit.

Rooms in the connected world add `kind` (`chamber` or `zone`), `biome`, `abilities`, `exits` (`{ id, x, y, w, h, to, toExit }` on the room edge), and optional customization: `decor` (`bg`/`fg` grids of decor chars), `images` (palette-indexed pixel art), `audio` (`sfx` overrides, `theme` song, built-in `music`) and `rules`. `src/levels/world.json` lists the rooms, the start, map layout and the chamber attachments.

**Objects** (positions in tiles, top-left):

| type | fields |
|---|---|
| `spawn` | — |
| `door` | `runaway?` (legs: flees, hops over Pip, blocked by Fresh/Rot bodies) |
| `sign` | `text`: death count → line (the highest count reached is shown) |
| `popup` | hidden spike, raised by `popSpike` |
| `dropper` | `by?`: `["player"]` (default) and/or `"door"` |
| `crusher` | `w`, `h`, `period?` (ticks between slams; 0 = events only), `phase?` |
| `plate` | `w`, `need` (weight to press: Pip 1, Fresh 2, Rot 1, Skeleton 0) |
| `gate` | `h` (hangs down from `y`), `plate?` (open while pressed) |
| `platform` | `w`, `path` (waypoints), `speed` (tiles/s), `start` (`always`/`touch`/`trigger`), `loop?`, `oneWay?` |
| `laser` | `dir`, `emitter`, `len?` (0 = to the wall), `mode` (`on`/`off`/`blink`/`plate`), `on?`/`off?`/`phase?`, `plate?`, `hidden?` |
| `label` | `text`, `size?` (decorative text, centred on `x, y`) |
| `vine` | `len` (tiles; hangs from under the tile at `x, y`) |
| `crate` | pushable, stackable, weight 2, never ages, resets on respawn |
| `bench` | checkpoint |
| `relic` | `kind` (`note`/`jar`), `text?` (lore) |
| `light` | `color?`, `radius?`, `flicker?` (decorative) |

**Events** are `{ trigger, actions, once? }` and re-arm on every respawn. Each action may carry a `delay` in ticks.

- Triggers: `playerEnters(zone)`, `corpseEnters(zone)`, `plateDown(plate)`, `plateUp(plate)`, `timer(ticks)` since spawn, `deathCountAtLeast(n)`, `playerOn(target)` (an object id, `@raft` or `@corpse`).
- Actions: `dropTiles`, `removeTiles`, `addTiles` (`rect`), `moveTiles` (`rect`, `path` offsets, `speed`), `popSpike`, `fireCrusher`, `fireDropper`, `toggleGate`, `startPlatform` (`target`), `moveDoor` (`target`, `path`, `speed`), `setCurrent` (`dir`, `speed`), `laser` (`target`, `mode`), `sign` (`target`, `text`), `shake` (`strength`), `sfx` (`name`).

`verified: true` is set by the editor when the creator has beaten the level in playtest; it is cleared by any edit.
