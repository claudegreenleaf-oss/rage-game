# Die Trying

A 2D browser puzzle-platformer in the rage-game style (traps spring, floors vanish, signs lie) where **your corpses stay behind and become your tools**. Every death leaves a body you can stand on, push, bounce on, or use to weigh down a plate. It should feel unfair the first time and obvious the second.

**Play:** https://claudegreenleaf-oss.github.io/rage-game/

Built with Phaser 3, TypeScript and Vite. All art is drawn in code and every sound is ZzFX. The full design is in [`Spec.md`](Spec.md).

## How to play

| Key | Action |
|---|---|
| ← → / A D | Move |
| Space / ↑ / W | Jump (hold for a higher jump) |
| ↓ / S | Drop through a bone platform |
| R | Restart the level and clear all corpses |
| Esc | Pause |
| M | Mute |

The rules, each taught by one level:

- **Bodies stay.** Up to three. The fourth death turns the oldest to dust.
- **Every death ages the others.** Fresh (solid, weight 2) → Rot (bouncy, weight 1) → Skeleton (a one-way bone platform, weight 0). Pits and lasers leave no body and age nothing.
- **How you die shapes the body.** Spikes pin it (a floor spike becomes safe to walk on, a wall spike becomes a ledge), crushers make slabs, water makes rafts.
- **The level forgets, the dead remember.** On respawn every trap, platform, door and sign resets. Corpses keep their place, so a body on a plate keeps holding it down.

There are 12 levels in 3 acts, then playable credits. Beating Act 1 unlocks the level editor (open the game with `?editor` to unlock it straight away).

### Level editor

Paint terrain and hazards, place objects, draw trigger zones and link them to actions (the full troll engine: dropping and moving tiles, pop-up spikes, crushers, droppers, gates, doors, currents, lasers, signs, shakes and sounds). Press **P** to playtest; beat your level to mark it **Verified**, then **Share** copies a link (`#lvl=…`, lz-string compressed) that opens straight into the level. Pasting a code on the title screen does the same. Ctrl+S saves a draft in the browser; Import/Export use JSON files; Ctrl+Z / Ctrl+Shift+Z undo and redo. Every shipped level can be opened, edited and re-verified from **Open ▾**.

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

**Terrain glyphs:** `#` solid · `.` empty · `X` fake (looks solid, isn't) · `=` troll tile (solid until an event) · `^ v > <` spikes (floor, ceiling, left wall, right wall) · `~` water · `}` `{` conveyor right / left. A gap in the bottom wall is a bottomless pit.

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

**Events** are `{ trigger, actions, once? }` and re-arm on every respawn. Each action may carry a `delay` in ticks.

- Triggers: `playerEnters(zone)`, `corpseEnters(zone)`, `plateDown(plate)`, `plateUp(plate)`, `timer(ticks)` since spawn, `deathCountAtLeast(n)`, `playerOn(target)` (an object id, `@raft` or `@corpse`).
- Actions: `dropTiles`, `removeTiles`, `addTiles` (`rect`), `moveTiles` (`rect`, `path` offsets, `speed`), `popSpike`, `fireCrusher`, `fireDropper`, `toggleGate`, `startPlatform` (`target`), `moveDoor` (`target`, `path`, `speed`), `setCurrent` (`dir`, `speed`), `laser` (`target`, `mode`), `sign` (`target`, `text`), `shake` (`strength`), `sfx` (`name`).

`verified: true` is set by the editor when the creator has beaten the level in playtest; it is cleared by any edit.
