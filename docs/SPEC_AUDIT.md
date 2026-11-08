# Spec audit

Section-by-section check of [`Spec.md`](../Spec.md) against the build. "Changed" marks a deliberate departure made at the owner's direction during playtesting (see the README's *Changes from the spec*). Every "Verified" line names the test, script or check that proves it.

## §1 Pillars

| Pillar | Status | Evidence |
|---|---|---|
| Death is a resource | Done | Bodies stand, push, bounce, weigh plates; `tests/sim.test.ts` (corpse lifecycle, weight, Rot, Skeleton). |
| Unfair once, then fair; deterministic | Done | Sim uses integer units, no `Math.random`/`Date` (grep of `src/sim`: comments only); `tests/replays.test.ts` asserts identical results across runs. |
| The level forgets, the dead remember | Done | `respawn reset rule` tests (corpse on platform falls; corpse on plate keeps it down). |
| Snappy and cute | Done (pixel art, changed) | Squash/stretch, hit-stop (5 ticks in sim), flash, punch, shake, particles, ragdoll death tumble. |
| Few rules, deep combinations | Done | One level teaches each rule (Act 1); Acts 2–4 combine them. |

## §2 Tech (Rules)

| Rule | Status | Evidence |
|---|---|---|
| Phaser 3 latest 3.x + TS strict + Vite | Verified | `phaser@3.90.0`, `"strict": true`, Vite 7. |
| Sim is pure TS, no Phaser in `src/sim` | Verified | grep: 0 files in `src/sim` import Phaser; Vitest runs the sim in Node. |
| Fixed 60 Hz, accumulator, whole ticks; no `Math.random`/`Date` in sim; seeded cosmetic RNG | Verified | `src/scenes/Game.ts` accumulator (`STEP_MS`, catch-up cap); `src/render/rng.ts`. |
| Custom AABB tile physics (no Arcade/Matter for gameplay) | Verified | `src/sim/physics.ts` swept AABB. |
| Libraries: ZzFX, lz-string, Vitest, Playwright only | Verified | `package.json` deps: phaser, zzfx, lz-string; dev: vitest, playwright, typescript, vite, tsx, @types/node. |
| All art drawn in code, no image files | Verified | `git ls-files` has no image files; atlas, font and terrain are generated at boot (`src/render/pixel/*`). |
| `localStorage` only for progress/settings/drafts, in try/catch; runs without it | Verified | `src/progress.ts`, `src/editor/model.ts`; Playwright "runs without localStorage" (Chromium + Firefox). |
| GitHub Actions build on push to `main` → GitHub Pages; Vite `base` matches | Verified | `.github/workflows/deploy.yml`; base `/rage-game/`; live at https://claudegreenleaf-oss.github.io/rage-game/. |

## §3 Controls

All spec keys work (← → / A D, Space / ↑ / W with variable height, ↓ drop-through, R restart and clear corpses, Esc pause, M mute). Added: ↓ + walk away drags a body (softlock fix), vine grab/swing, wall-slide/jump in exploration zones, Tab map. No suicide key.

## §4 Player

| Item | Status | Evidence |
|---|---|---|
| Hitbox 0.75 × 0.8; run 7 t/s; accel ~0.06 s; stop ~0.05 s | Verified | `constants.ts`; `tests/sim.test.ts` "reaches full speed… stops…". |
| Apex 2.4 held / ~1.2 tapped; running jump ~4.5 tiles | Verified | Same file: apex 2.41 / 1.15, gap 4.2–5.2. |
| Coyote 0.1 s, buffer 0.1 s, fall cap, step-up 0.3, weight 1, no fall damage | Verified | `constants.ts`; "steps up onto low lips" test. |
| Animation: idle bob, blink, look, squash/stretch, dust, run cycle, death hit-stop/flash/punch/shake, 0.35 s respawn | Done | Sprite frames + pose code in `src/render/level-view.ts`; screenshots. |

## §5 Corpses

| Rule | Status | Evidence |
|---|---|---|
| Fresh on body-leaving death; every such death ages the others; pit/laser age nothing | Verified | "every death that leaves a body ages the others…", "pit and laser deaths leave no body…". |
| Cap 3, oldest to dust | Verified | Same test; L01 invariant "a 4th death uncovers a spike". |
| Stages: shapes, weights 2/1/0, push speeds, Rot bounce ~5.5 tiles, Skeleton one-way + drop-through | Verified | "push speeds…", "landing on Rot launches…", "Skeletons are one-way…". |
| Death types: spikes pin (floor flush, wall ledge, ceiling drops), crusher slab, dropper body, water raft, pit/laser none | Verified | "how you die shapes the body" suite. |
| Stacking, weight through stacks, pinned when pushed onto spikes, crushers flatten, lasers vaporize, platforms/conveyors carry, doors blocked by Fresh/Rot not Skeleton | Verified | "weight passes down a stack", door suite, L06/L07/L11 replays. |
| Respawn reset rule | Verified | Respawn suite + L02/L06/L07/L10 replays. |

## §6 Level elements and §6.1 events

Every glyph is implemented (solid, spawn, door incl. runaway, four spike directions, pop-up, dropper, crusher, fake, troll, plate, heavy plate, gate, water with current, moving platform, laser steady/blink/plate, blinking laser, conveyors, signs, bottomless pits). The event engine supports every trigger (`playerEnters`, `corpseEnters`, `plateDown/Up`, `timer`, `deathCountAtLeast`, `playerOn`) and action (`dropTiles`, `removeTiles`, `addTiles`, `moveTiles`, `popSpike`, `fireCrusher`, `fireDropper`, `toggleGate`, `moveDoor`, `setCurrent`, `laser`, `sign`, `shake`, `sfx`), with delays and `once`; every troll in §8 is data, no per-level code. Changed: plates are flush floor sensors.

## §7 Signs

Proximity signs (3 tiles), per-death-count text, event overrides, the global taunt pool (1, 3, 5, 10, 20, 50). Changed per playtesting: one message on screen at a time, never over Pip or mechanics; hint lines at higher death counts.

## §8 Levels

All 12 spec levels ship with solution scripts that win at their intended death counts (`tests/replays.test.ts`), plus Act 4 (L13–L16) and the playable credits. Binding invariants are tests in `tests/invariants.test.ts` and `tests/act4.test.ts` (brute-force move searches, for example "can't clear the strip with a jump", "you can't jump straight from the last stop to the bank", "you can't catch the door with no bodies"). Geometry was tuned where the spec maps didn't satisfy their own invariants (L01 corridor, L04 ledge, L06 one-way platform and bank, L09 floor spike, L10 dropper position); L11 and L12 were designed from the descriptions. A full chamber campaign run through the real title → act cards → levels → credits → End flow passed in Chromium with every level winning at its intended death count.

**Connected world (added):** 25 rooms (atrium, three hubs, four wing zones of up to 112 × 60 tiles, 16 chambers, credits) with 50 route-verified relics. `tests/worldmap.test.ts` validates every link and plays a scripted full run from the atrium through every zone and chamber to the credits (chambers use their standalone solutions, entered at their own spawn). The same recorded run (32,451 ticks, 41 deaths) was replayed in the browser's real world mode: all 25 rooms, reaching the credits, no page errors.

## §9 Replays and verification

| Item | Status |
|---|---|
| One input bitmask per tick; replay `{ levelId, levelHash, inputs }` RLE | Verified (`src/sim/replay.ts`; round-trip test) |
| Solution DSL, scripts for every level, deaths included | Verified (`src/solutions/*.txt`) |
| Vitest: run each solution, assert won + deaths, print table | Verified |
| Unit tests for every listed rule | Verified (`tests/sim.test.ts`) |
| Playwright smoke: boot, start L1, death counter increases | Verified (Chromium + Firefox, locally and in CI) |
| `npm test` runs all; CI runs it before deploying | Verified |

## §10 Level editor

Everything in §10 (32 × 18 canvas, palette tabs, paint/erase, hover preview, linking with dotted lines, inspector, P playtest / Esc back with state kept, Ctrl+S, import/export, Verified + share codes `#lvl=` with lz-string, paste on title, undo/redo, shipped levels in the same format), verified by driving it in a browser: open → paint → place → link → playtest → win → Verified → share → open the link in a fresh browser. Expanded at the owner's request: pan/zoom, more tools, layers, decor painting, image pixelation, a sound designer, a music composer, rule tweaks, templates, command palette, unlocked from the start.

## §11 Art and feel

Changed: pixel art in an abandoned, overgrown high-tech lab (owner's direction) instead of flat vector pastels; per-act palettes and parallax; the juice checklist is implemented (squash/stretch, hit-stop, shake, particles, overshoot tweens, sinking plates, shaking droppers, bouncing death counter, iris wipe on the door, corpse idle details). Hidden traps look like normal tiles until revealed.

## §12 Audio

ZzFX presets for every listed sound (redesigned soft at the owner's request); music per act. Changed: the soundtrack is public-domain Erik Satie (Gymnopédies 1–3, Ogives 1–4) on a synthesized felt piano. Mute is saved; audio starts on first input.

**In-game audio (verified):** captured from a real Chrome's audio output (PulseAudio sink) while playing the title and L01: the audio context runs, the title piano sits around -25 to -30 dBFS, gameplay sounds peak at 0.6-0.7 over the music, nothing clips; the win fanfare was measured too loud (about 4x the music) and turned down 8.5 dB.

## §13 Screens

Title (logo, bobbing Pip, rotating taunt sign, menu incl. editor and paste code, mute), level select (4 acts × 4), HUD (fading level name, corpse slots, bouncing death counter), pause (resume, restart, level select, mute), progress (unlocked, best deaths, total deaths, settings).

**Robustness found by testing on a real GPU:** on ANGLE's Vulkan backend, a cold WebGL process rejected Phaser's first framebuffers and the game booted to a blank screen (0/4 cold boots). `src/main.ts` now rebuilds the game when that specific boot error occurs: 4/4 cold boots on Vulkan and on ANGLE/OpenGL.

## §15 Done means

| Item | Status |
|---|---|
| `npm test` passes: all solution replays with expected deaths, all rule tests | Verified locally and in CI |
| Every level's invariants hold, encoded as tests | Verified |
| Steady 60 fps in Chrome and Firefox; works without `localStorage` | Verified on real hardware (RTX A6000) over the entire world run, all 25 rooms: Chrome (ANGLE/Vulkan) 59.8 fps average, p99 frame 16.8 ms, 99.9% of frames under 20 ms; Firefox 59.5 fps, p99 17.1 ms, 99.9%; zero GPU readback stalls. Storage-free run verified in both browsers |
| Editor rebuilds, playtests, verifies and shares any level; link opens in a fresh browser | Verified |
| Deployed to GitHub Pages from `main` via Actions | Verified |
| `README.md` covers play, run, test, level format | Done |
