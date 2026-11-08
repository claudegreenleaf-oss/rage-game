# Die Trying: Build Spec

A 2D browser puzzle-platformer in the rage-game style (traps spring, floors vanish, signs lie) where **your corpses stay behind and become your tools**. The traps that kill you are also how you solve each level. It should feel unfair the first time and obvious the second. The difficulty comes from thinking, not from precise jumps.

Read this whole file before writing code. The sections marked **Rules** are binding. Level maps are design intent: tune the geometry so the stated **invariants** hold. The automated replay tests decide whether a level works.

---

## 1. Pillars

1. **Death is a resource.** Every death leaves a body you can stand on, push, bounce on, or use to weigh down a plate.
2. **Unfair once, then fair.** Surprise deaths are expected and they pay you with a corpse. Everything is deterministic: no randomness, and no pixel-perfect execution. After one death the trick is always readable.
3. **The level forgets, the dead remember.** On respawn the level resets. Only corpses carry over.
4. **Snappy and cute.** The game reacts instantly, with squash and stretch, hit-stop and a sound on every action. The dark comedy stays cartoonish and never gets gory.
5. **Few rules, deep combinations.** Each rule fits in one sentence and is taught by one level.

---

## 2. Tech (Rules)

- **Phaser 3** (latest 3.x) + **TypeScript** (strict) + **Vite**. Desktop browser, keyboard only.
- **Simulation core is pure TypeScript, with no Phaser imports** (`src/sim/`). It covers physics, corpses, hazards, triggers and win/lose. Phaser (`src/render/`, `src/scenes/`) only reads the sim state to draw it, and feeds it input.
- **Fixed 60 Hz timestep.** Use an accumulator in the render loop and step the sim in whole ticks. Never use `Math.random` or `Date` inside the sim. Cosmetic randomness (particles) uses a seeded RNG on the render side only.
- Custom AABB tile physics in the sim. Do not use Phaser Arcade/Matter for gameplay, because replays need determinism.
- Libraries: **ZzFX** (sound effects), **lz-string** (share codes), **Vitest** (sim and replay tests), **Playwright** (one browser smoke test). Add nothing else without a reason.
- All art is drawn in code (Phaser Graphics or generated textures). There are no image files.
- `localStorage` is used only for progress, settings and editor drafts. Wrap every access in try/catch, and the game must run fine without it.
- Deploy: a GitHub Actions workflow builds on push to `main` and publishes to **GitHub Pages**. Set Vite's `base` to match.

### Suggested layout
```
src/
  sim/        world.ts, player.ts, corpse.ts, hazards.ts, triggers.ts, physics.ts, replay.ts, types.ts
  levels/     act1/*.json, act2/*.json, act3/*.json, index.ts
  solutions/  L01.txt … L12.txt        (input scripts, see §9)
  render/     draw-player.ts, draw-corpse.ts, draw-tiles.ts, fx.ts, palette.ts
  scenes/     Boot, Title, LevelSelect, Game, Pause, ActCard, Credits, Editor
  audio/      sfx.ts (ZzFX presets), music.ts
  editor/     tools, panels, share.ts
tests/        replays.test.ts, sim.test.ts, smoke.spec.ts
```

---

## 3. Controls

| Key | Action |
|---|---|
| ← → / A D | Move |
| Space / ↑ / W | Jump (hold for a higher jump) |
| ↓ / S | Drop through a bone platform |
| R | Restart the level **and clear all corpses** |
| Esc | Pause |
| M | Mute |

There is no grab key and no suicide key. Deaths come from the level.

---

## 4. Player: Pip

A tiny round critter, part hamster and part mouse. Peach body, thick dark outline, big round ears, huge eyes with a highlight, pink blush, stubby feet and a little tail.

**Feel (tune by playing; starting values in tiles and seconds):**
- Hitbox 0.75 × 0.8. Run speed 7 t/s, reaching full speed in about 0.06 s and stopping in about 0.05 s. No ice-skating.
- Jump apex 2.4 tiles with the button held, about 1.2 when tapped. Running jump distance about 4.5 tiles.
- Coyote time 0.1 s, jump buffer 0.1 s, cap on fall speed.
- Auto step-up of 0.3 tiles so tiny lips (like a corpse lying flush in spikes) never snag.
- Pip weighs **1** for pressure plates.
- No fall damage.

**Animation:** idle bob and blinking; eyes look toward the movement direction; squash on landing and stretch on jumping; dust puffs on jump and landing; a little leaning run cycle. On death, use hit-stop (about 80 ms), a white flash, a small camera punch-zoom and a screen shake that scales with the death type, then the corpse appears. Respawn takes 0.35 s: a puff at spawn and Pip pops out with a hop.

---

## 5. Corpses (Rules: the core mechanic)

### 5.1 Lifecycle
- A death that leaves a body creates a **Fresh** corpse where Pip died.
- **Every death that leaves a body ages all existing corpses by one stage.** Deaths with no body (pit, laser) age nothing.
- **Cap: 3 corpses.** When a 4th would appear, the oldest (always a Skeleton) crumbles to **dust** with a poof, then the new body appears.
- The HUD shows three slots, each with a tiny icon of that corpse's current stage, plus a death counter.
- **R** clears every corpse and restarts the level.

### 5.2 Stages

| Stage | Look | Shape | Physics | Weight |
|---|---|---|---|---|
| **Fresh** | Pip on its back, X eyes, tongue out | 1.0 × 0.8 solid | Solid on all sides. Heavy push (2 t/s). | **2** |
| **Rot** | Droopy and green-tinged, a fly or two orbiting | 1.0 × 0.45 solid | **Bouncy:** landing on it from above launches Pip to about 5.5 tiles above the floor it rests on. Walking onto it sideways does not bounce. Medium push (3.5 t/s). | **1** |
| **Skeleton** | Cute cartoon bones, a skull with big round sockets | 1.0 × 0.2 | **One-way platform:** solid only from above. Pip can jump up through it and press ↓ to drop through. Light: slides fast when pushed (6 t/s, low friction). | **0** |

Show each change of stage clearly: the corpse shivers for 0.15 s, then pops into the new shape with a little puff, a wet *blorp* (Rot) or a *clack* (Skeleton).

### 5.3 How you die shapes the body

| Death | Result |
|---|---|
| **Spikes** (floor, ceiling, or wall) | The body is **pinned** in place and can't be pushed. Floor spikes: it lies flush and covers them, so that tile is safe to walk on. Wall spikes: it sticks out as a 1-tile **ledge**. Ceiling spikes: Pip falls and becomes an ordinary body where it lands (or pinned, if it lands on spikes). |
| **Crusher** | A **slab**: a full-width body 0.25 tall. It keeps its stage's weight and behaviour (a rot slab still bounces; a skeleton slab is one-way). |
| **Dropper / saw** | An ordinary body where Pip died. |
| **Water** | A **raft**: it floats on the surface and drifts with the current. Its stage behaviour still applies. |
| **Pit** (fell off the map) | No body. |
| **Laser** | Vaporized. No body. |

### 5.4 Corpses in the world
- Corpses have gravity, collide with tiles and each other, and stack. Weight passes down a stack, so a body on a body on a plate counts both.
- A corpse **pushed or dropped onto spikes gets pinned** and covers them.
- **Crushers flatten** any corpse under them into a slab. **Lasers vaporize** corpses. **Pits** delete them. **Water** makes them rafts.
- Moving platforms and conveyors carry corpses.
- **Sliding doors and the runaway exit are blocked by Fresh and Rot bodies.** Skeletons are too small to block them and get shoved aside.

### 5.5 Respawn rule
When Pip respawns, **every level object resets to its start state**: tiles, traps, droppers, platforms, doors, currents, timers and signs. Corpses keep their world position and then obey physics. A corpse that was riding a platform falls if the platform moved away. If a reset tile would overlap a corpse, push the corpse up to the nearest free spot. **A corpse on a plate keeps holding it down across respawns.** This is the main puzzle lever.

---

## 6. Level elements

| Glyph | Element | Notes |
|---|---|---|
| `#` | Solid | Charcoal rounded blocks |
| `.` | Empty | |
| `S` | Spawn | |
| `D` | Exit door | Reaching it wins. Some doors troll (slide, run away). |
| `^` `v` `>` `<` | Spikes: floor, ceiling, left wall, right wall | Coral red |
| `p` | Pop-up spike | Hidden until triggered, then snaps up with a *shing* |
| `d` | Dropper | Looks exactly like the ceiling. Shakes for 0.25 s (dust trickles) then falls when Pip passes under. Leaves a normal body. Resets on respawn. |
| `C` | Crusher | Block that slams down when triggered, holds for 1 s, rises. Flattens Pip and corpses into slabs. |
| `X` | Fake tile | Looks solid; isn't. |
| `=` | Troll tile | Solid until an event drops, moves or removes it. |
| `_` | Plate | Pressed at weight ≥ 1. Shows its required weight as pips (●) and current weight. |
| `3` | Heavy plate | Pressed at weight ≥ 3. Same display. |
| `\|` | Gate | Linked to a plate. Opens while the plate is pressed, with a satisfying chunk. |
| `~` | Water | Drowns Pip, making a raft. The current direction is set per level and can change through events. |
| `M` | Moving platform | A path of points, a speed, and a start condition (always, on touch, on trigger) |
| `L` `:` | Laser emitter, beam | The beam can be steady, blinking, or linked to a plate |
| `z` | Blinking laser | Pattern set per level |
| `>>` `<<` (on the floor row) | Conveyor | Moves Pip and corpses at 2 t/s |
| `?` | Sign | Text set per level (§7) |

A gap in the bottom wall is a bottomless pit.

### 6.1 Events (the troll engine)
Each level has a list of `{ trigger, actions, once?: boolean }`. Everything re-arms on respawn.

- **Triggers:** `playerEnters(zone)`, `corpseEnters(zone)`, `plateDown(id)` / `plateUp(id)`, `timer(ticks)` (since spawn), `deathCountAtLeast(n)` (deaths in this level, which survive respawn), `playerOn(objectId)`.
- **Actions:** `dropTiles`, `removeTiles`, `addTiles`, `moveTiles(path, speed)`, `popSpike`, `fireCrusher`, `fireDropper`, `toggleGate`, `moveDoor(path, speed)`, `setCurrent(dir, speed)`, `laser(on|off|blink)`, `sign(id, text)`, `shake(strength)`, `sfx(name)`.

This system must cover every troll in §8 with no per-level code. The editor (§10) builds exactly these structures.

---

## 7. Signs (the antagonist)

An unseen, smug level designer talks only through wooden signs. Signs pop up with an overshoot tween and a wooden *tock*. Pip doesn't have to touch them; the text shows when Pip is within 3 tiles. Some signs **lie**. A sign may set text per death count, e.g. `{0: "SAFE →", 1: "See? Safe.", 3: "Okay that one's on me."}`.

A global pool of taunts, keyed by death count, appears on a small sign at spawn after respawning:
1: "Oops." · 3: "Again? Bold." · 5: "Have you tried not dying?" · 10: "I'm keeping these, by the way." · 20: "Your family's here. All of them." · 50: "I could watch this all day. I do."

Keep the tone dry and cheeky, never mean-spirited. Lines are short (≤ 40 characters where possible).

---

## 8. Levels

12 levels in 3 acts. Each act opens with a title card: an iris wipe, the act name bouncing in, and one sign line.
Every level has the 3-corpse cap. Maps use the §6 glyphs. **Invariants are the binding part: tune sizes so they hold.**

### Act 1: Fresh Meat (learn the corpse rules)

#### L1 · Trust Me
Teaches: spikes pin bodies and make them safe to walk on; the cap.
```
######################
#........####........#
#........####........#
#........vvvv........#
#S..?.....^^......p?D#
######################
```
- ?1 says `SAFE →  just walk`, then `See? Safe.` after death 1.
- A 1-tall tunnel with ceiling spikes over a 2-wide floor-spike strip makes jumping impossible.
- Troll: pop-up spike `p` fires when Pip enters the 2 tiles before it. ?2 says `Almost there!`
- **Solution:** die on each spike (2), die on the pop-up (3), walk across your family.
- **Invariants:** you can't clear the strip with a jump; exactly 3 deaths solve it; a 4th death in the tunnel uncovers a spike (lesson: the cap).

#### L2 · Dead Weight
Teaches: plates, weight, crusher slabs, fake floor.
```
######################
#....................#
#.......CC...........#
#....................#
#....................#
#....................#
#S.?....__.....|.XX.D#
#################..###
```
- Gate `|` runs from floor to ceiling and is linked to plate `__`.
- ?1: `Stand on the button. Nothing bad will happen.` After death 1: `Something bad happened. Unrelated.`
- Troll 1: the crusher slams 0.5 s after Pip stands on the plate. The slab keeps the plate down, so the gate stays open.
- Troll 2: the `XX` fake floor over a pit before the door. Pip falls, no body. Jump it next time.
- **Invariants:** you can't step off the plate and reach the gate before it closes; the slab alone holds the plate.

#### L3 · Leg Up
Teaches: pushing bodies; baiting a dropper.
```
######################
#.....d...........d..#
#....................#
#.................?D.#
#...............######
#...............######
#S.?............######
######################
```
- ?1: `Push things. It's good for you.`
- The dropper at col 6 kills Pip on the first run. Push the body to the 3-high ledge, hop up.
- Troll: a second dropper over the door. ?2: `Welcome! Mind your head.` Once you know it's there, step in and back out to bait it, then walk in.
- **Invariants:** the ledge can't be jumped from the floor; one Fresh body is enough to climb; dying to the second dropper turns body 1 into Rot, which still works as a bounce pad (no soft-lock).

#### L4 · Growing Old
Teaches: Rot bounce, and that deaths age the other bodies.
```
########################
#....d....d.........d..#
#......................#
#......................#
#..................?.D.#
#..................#####
#..................#####
#..................#####
#..................#####
#S.?...............#####
########################
```
- The ledge is 5 high: too tall for a Fresh body plus a jump.
- ?1: `Old you is softer. Use that.`
- **Solution:** die to dropper 1, then dropper 2. Body 1 is now Rot. Push it near the ledge, jump onto it, bounce up.
- Troll: a dropper over the door. That death ages everything: body 1 becomes a Skeleton (no bounce), body 2 becomes Rot. Push body 2 instead. ?2 after that death: `Every death ages the others. I don't make the rules. (I do.)`
- **Invariants:** a Rot bounce clears the ledge; a Fresh body doesn't; the 3-death state is still solvable.

### Act 2: Rot (the level fights back)

#### L5 · Shallow End
Teaches: water rafts, currents, events that change the level mid-run.
```
######################
#....................#
#....................#
#..............?..D..#
#.?............#######
#S.............#######
########~~~~~~~#######
########~~~~~~~#######
######################
```
- ?1 (lie): `Shallow end →`.
- The current flows right. Drowned bodies float as rafts and pile up against the right wall.
- Troll: 0.4 s after Pip stands on a raft, the current reverses (slowly, 1.2 t/s) and carries the rafts back left. Hop across quickly; the timing is generous.
- **Invariants:** the pool can't be jumped; 3 rafts at the right wall leave a gap you can jump from the bank; you can climb from a raft to the ledge.

#### L6 · Last Stop
Teaches: the respawn rule. Corpses fall when the platform under them resets.
```
##########################
#........................#
#.............d..........#
#........................#
#.?....................D.#
#S....................####
##MM..................####
##^^^^^^^^^^^^^^^^^^^^####
##########################
```
- The platform moves right when Pip steps on and stops partway: the "last stop".
- ?1: `Please remain seated until the vehicle has come to a complete stop.`
- Troll: a dropper over the last stop kills Pip as the platform arrives. The body rides the platform; on respawn the platform resets and **the body drops into the spike pit**, pinned, as a stepping stone.
- **Solution:** let the dropper get you, ride again, drop onto your body in the pit before the dropper lands, then jump onward. You'll probably need a second stepping-stone body from a short jump. A Rot body's bounce is a valid shortcut.
- **Invariants:** you can't jump straight from the last stop to the bank; one stepping stone isn't enough by plain jumps; two stones (or a Rot bounce) are.

#### L7 · Lights Out
Teaches: lasers vaporize everything (no body, no aging); delivering a body to a plate.
```
########################
#.....d..........L.....#
#................:.....#
#................:.....#
#S.?.............:..?.D#
###########.############
###########z############
###########_############
########################
```
- Laser `L` blocks the exit and turns off while plate `_` (at the bottom of a 1-wide shaft) is pressed.
- ?1: `Lasers are perfectly safe. For lasers.`
- The dropper gives you a body. Push it into the shaft.
- Troll: the blinking laser `z` across the shaft is invisible until it first fires. It zaps the first body you push in. After that it is visible and blinks on a readable rhythm (1 s on, 1 s off), so time the push.
- Pip falling into the shaft is stuck, and the blinker eventually zaps them (no body).
- **Invariants:** one body on the plate turns off the exit laser; the push can be timed from a standstill.

#### L8 · Runaway
Teaches: bodies block moving things. A chaotic breather.
```
##########################
#...d.....d.....d........#
#........................#
#........................#
#S.?...........D.........#
##########################
```
- The exit door has little legs. When Pip is within 3 tiles, it scurries away at 4 t/s.
- Troll: corner it against a wall and it **hops over Pip** with a smirk. ?1 after that: `Doors can jump. Didn't you know?`
- It **can't get past a Fresh or Rot body**: it stops and trembles. Use a dropper body as a wall and herd the door into it.
- Each dropper falls when the door runs under it ("calling for help").
- **Invariants:** you can't catch the door with no bodies; one well-placed body is enough.

### Act 3: Bare Bones (plan your deaths)

#### L9 · Hang In There
Teaches: wall-spike ledges; skeleton one-way; using a death elsewhere to age a body into Rot.
```
#########
#.....D.#
#...#####
#...#####
#>..#####
#...#####
#..<#####
#...#####
#>..#####
#S..#####
#########
```
- A shaft with wall spikes. Each death on a wall spike pins a body there as a ledge.
- ?1: `Hang in there.`
- **Solution:** jump into the low spike (body 1), climb onto it, jump into the right spike (body 2), then die once more (body 3) so body 2 turns to Rot. Bounce from it straight up to the exit. Body 1 is now a Skeleton, so you can jump up through it from below.
- **Invariants:** you can't reach the exit with Fresh ledges alone; the Rot bounce from the middle ledge clears it; the Skeleton ledge never blocks the climb.

#### L10 · Family Reunion
Teaches: weight adds up, and aging changes weight live.
```
########################
#....d....d............#
#......................#
#......................#
#S.?...........|...d..D#
############3###########
############3###########
########################
```
- A heavy plate (weight 3) at the bottom of a 1-wide, 2-deep well. Gate `|` opens while weight ≥ 3. The plate shows `●●○` style live weight.
- ?1: `Bring the whole family.`
- **Solution:** two dropper bodies pushed into the well: Rot (1) + Fresh (2) = 3.
- Troll: the dropper by the door kills Pip once. That death ages the well (Skeleton 0 + Rot 1 = 1) and the gate slams. Rebuild the weight with new bodies (a Skeleton weighs 0, so feed in fresh ones), then bait the door dropper.
- **Invariants:** the well holds 3 stacked bodies; a correct weight is reachable after any number of extra deaths; the live weight readout always makes the state clear.

#### L11 · Assembly Line
Teaches: building a machine out of yourself.
- Layout (draw it in the editor). An upper room has a **conveyor** running right into a **crusher** that pounds every 2 s. Past the crusher is a **0.4-tall slot** only slabs fit through, then a chute that drops onto a **plate (weight ≥ 2)** in a sealed lower room. The plate opens the exit gate. A dropper hangs over the start of the conveyor.
- ?1 at the conveyor: `Free ride!` ?2 at the slot: `Employees only.`
- Pip riding the conveyor gets crushed: a Fresh slab slides through the slot onto the plate and the gate opens. ("Thanks for your contribution.")
- Troll: on the way to the exit, a pop-up spike kills Pip. The slab on the plate ages to Rot (weight 1) and the gate closes. Send another body down the line, a dropper body this time (it's crushed into a slab too), and bait the pop-up.
- **Invariants:** only slabs pass the slot; Fresh slab = 2 opens it; Rot slab + any new Fresh slab ≥ 2 reopens it.

#### L12 · Die Trying
Teaches: the final exam. **The order you die in decides the stages.**
- Three sections around a hub (draw it in the editor):
  - **A, the chimney:** a 1-wide vertical shaft with a wall spike. A body pinned there plugs it. A Fresh or Rot body blocks you; a **Skeleton** lets you jump up through and stand on it. The chimney leads to the exit area.
  - **B, the cliff:** a high ledge reachable only with a **Rot** bounce. It holds a key plate that is part of the gate logic, or the route onward.
  - **C, the press:** a plate needing **weight 2**, under a crusher. Getting crushed there leaves a **Fresh** slab that holds it.
- B and C are reachable from the hub without the chimney. The chimney is only the final route.
- **Solution:** die at **A first**, **B second**, **C third**. Now A is a Skeleton, B is Rot and C is Fresh. Any extra death breaks it (dust), so press R and plan again.
- Signs: ?1 at the hub: `Plan your funeral.` ?2 at C: `Third time's the charm.`
- **After the door:** the credits are a playable level. The names are platforms, a sign reads `Directed by: the signs`, and one last pop-up spike sits under "Thanks for playing". The end screen shows total deaths, best deaths per level and `Your bodies would like a word.`

---

## 9. Replays and verification (Rules)

- **Recording:** the sim consumes one input bitmask per tick (`left, right, jump, down, restart`). A replay is `{ levelId, levelHash, inputs }` with run-length encoding.
- **Solution scripts:** `src/solutions/Lxx.txt` in a small DSL compiled to inputs, e.g.
  ```
  right 40        # hold right for 40 ticks
  right+jump 12
  wait 30
  left 8
  ```
  Write these for every shipped level, deaths included.
- **Tests (Vitest, Node, no browser):** load each level, run its solution through the pure sim at full speed, and assert `won === true`. Also assert the death count, so a level's intended death path doesn't silently change. Print a table: level, solved, deaths, time.
- Unit tests for: corpse aging and the cap; death-type results; weight summing through stacks; the respawn reset rule (corpse on a moving platform falls; corpse on a plate keeps it down); Rot bounce height; Skeleton one-way and drop-through; door blocked by Fresh and Rot but not Skeleton.
- **Playwright smoke test:** boot the build, start L1, send keys, and see the death counter increase.
- `npm test` runs all of it. CI runs it before deploying.

---

## 10. Level editor (player-facing)

It unlocks on the title screen after beating Act 1 (and is always on in dev with `?editor`).

- **Canvas:** grid levels up to 32 × 18. The camera fits the whole level on screen; there is no scrolling in play.
- **Palette tabs:** Tiles · Hazards · Objects (spawn, door, plates, gates, platforms, conveyors, water and current) · Signs · Events. Left-drag paints, right-drag erases, and a hover preview shows what will be placed.
- **Linking:** in Events mode, drag a trigger zone (or click a plate or object), then click targets and pick an action from a small menu that covers the full §6.1 list. Links show as dotted lines while editing.
- **Inspector:** select any object to edit its properties (platform path and speed, laser pattern, sign text per death count, gate link, the level's starting current).
- **Playtest:** P plays instantly from the current state; Esc returns to the editor with the camera and selection kept.
- **Save:** Ctrl+S saves the draft locally. Import and export as JSON files.
- **Share:** a level can be shared only after its creator has beaten it in playtest (a "Verified" badge). A share code is `lz-string` compressed JSON in a URL hash (`#lvl=…`). Opening that link goes straight to the level. Pasting a code on the title screen does the same.
- Undo and redo (Ctrl+Z / Ctrl+Shift+Z).
- The shipped levels are JSON in exactly this format. Build L11 and L12 in the editor if that's easier.

---

## 11. Art and feel

- **Style:** flat vector, bold shapes, thick dark outlines (`#2b2433`), rounded corners, warm pastel palette.
  - Background: cream `#fbf3e4`, with a faint large-dot pattern parallax.
  - Solid: charcoal `#3a3346` with a lighter top edge.
  - Hazards: coral `#ff5d5d`. Lasers: hot pink with a glow. Water: teal with a wavy surface.
  - Pip: peach `#ffc9a3`, blush `#ff8fa3`.
  - Signs: warm wood `#c98b52` with dark text in a rounded, chunky font loaded from Google Fonts (e.g. "Fredoka").
  - Rot tint: sage green. Skeleton: off-white.
- **Juice checklist:** squash and stretch on every jump, land, bounce and push; hit-stop and screen shake on death; particles for dust, puffs, bone bits and splashes; overshoot tweens on signs, doors and gates; plates sink with a click; droppers shake before falling; the HUD death counter ticks up with a bounce; the level-complete iris wipe zooms on the door; corpses get tiny idle details (flies, a bone that rattles when landed on).
- **Readable:** every hazard is unmistakable *after* it's revealed. Hidden traps look exactly like the normal tile beforehand; that's the joke.

## 12. Audio
- ZzFX presets for: jump (pitch varies a little), land, step tick, death squeak and squish, Rot blorp, Skeleton clack, dust poof, plate click, gate chunk, crusher slam, dropper rumble and fall, splash, laser zap, sign tock, door scurry, level-win jingle.
- A short looping chiptune per act made with a tiny tracker or ZzFXM. Keep it quiet under the sound effects.
- M toggles mute (saved). Start audio on the first input, as browsers require.

## 13. Screens
- **Title:** "DIE TRYING" logo with Pip bobbing; a sign below changes its taunt every few seconds. Buttons: Play · Levels · Editor (locked until Act 1 is beaten) · Paste code · mute.
- **Level select:** 3 rows (acts) × 4. Each tile shows the name, its lock state and your best (fewest) deaths.
- **HUD:** the level name fades after 2 s; the corpse slots and death counter sit top-left.
- **Pause:** Resume · Restart (R) · Level select · Mute.
- **Progress** (local): unlocked levels, best deaths per level, total deaths, settings.

---

## 14. Build order

1. Sim core: tiles, Pip movement and feel, fixed step, input recording. Test movement numbers.
2. Corpses: stages, aging, cap, death-type results, pushing, stacking, weight. Unit tests.
3. Hazards and objects: spikes, droppers, crushers, plates, gates, water, platforms, lasers, conveyors, doors, plus the respawn reset rule.
4. Events and signs engine (§6.1, §7).
5. Renderer and juice for everything above. Make it feel good *before* building many levels.
6. Act 1 levels with solution scripts and replay tests.
7. Acts 2 and 3 with replays.
8. Screens, audio, progress save.
9. Editor, playtest, share codes.
10. CI and GitHub Pages deploy; Playwright smoke test.

## 15. Done means
- [ ] `npm test` passes: all 12 solution replays win with their expected death counts, and all rule unit tests pass.
- [ ] Every level's invariants hold (encode them as extra tests where practical, e.g. "solution with one fewer body fails").
- [ ] The game runs at a steady 60 fps in Chrome and Firefox and works without `localStorage`.
- [ ] The editor can rebuild any shipped level, playtest it, verify it, and share it as a link that opens correctly in a fresh browser.
- [ ] Deployed to GitHub Pages from `main` via Actions.
- [ ] A short `README.md` covers how to play, how to run, how to test, and the level JSON format.
