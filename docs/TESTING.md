# Testing

## Running the suite

```bash
npm test          # vitest run (Node environment, no browser required)
npm run typecheck # strict TypeScript check
npm run build     # typecheck + production bundle
```

The suite runs entirely headless against the same modules the browser uses —
world generation, hydrology, simulation and persistence are all pure
TypeScript and are tested directly. Probe scripts for visual/render checks live
in `scripts/` (`npx vite-node scripts/<name>.ts`).

## What is covered

### World generation (`tests/worldgen.test.ts`)
- **Determinism** — same seed produces bit-identical heights across 300 samples;
  different seeds diverge measurably.
- **Continuity** — simplex noise has no lattice seams (Δ=0.002 sampling);
  terrain samples step < 40 m per 4 m (no cliffs or NaN cliffs).
- **Bounds & variety** — heights finite in −120…600; a 4 km window contains ≥ 4
  biomes and a land-rich (not ocean) world mix.
- **Chunk seams** — chunk (0,0) and (1,0) share identical edge vertices.
- **Terrain edits** — raise/lower brushes change height; edits survive
  serialize/deserialize and compose with base terrain; continuity holds across
  edited regions.

### Hydrology (`tests/hydrology.test.ts`)
- Water flows downhill and pools in depressions.
- Rain raises water; evaporation/drought lowers it.
- Water surface never floats above dry terrain (400 sampled points).
- Pollution degrades water quality; clean flow recovers it.

### Simulation (`tests/simulation.test.ts`)
- Habitat spawning produces valid animals with valid states.
- Needs decay over time; hunger drives behaviour.
- Herbivores respond to a close player; predators chase and kill prey; kills recorded.
- Population regulation keeps counts bounded; starvation kills.
- Settlements generate with buildings/roads/homes; every citizen has identity,
  home and occupation.
- Citizens show **different actions across a full day** (≥ 3 distinct activities),
  **move between locations** over the day, and needs evolve.
- Economy responds to population (food drops with more eaters, farmers help).
- The orchestrator runs 20 slices without error and reports stats from real state.
- Serialize → restore keeps population, time and settlements consistent.

### Saves & deployment (`tests/save.test.ts`)
- Save validation accepts good saves; rejects garbage; rejects future versions.
- Legacy v1 saves migrate automatically.
- Export/import round-trips exactly; corrupt files report errors gracefully.
- Terrain edit serialization is lossless (deltas + paint).
- Clock slices at high speed, pause freezes time, seasons cycle, 24 h wrap.
- Weather transitions across kinds; forced god-mode weather applies instantly
  and stays valid; droughts lower the hydrology balance.
- Every building type builds with multi-part geometry; buildings vary by seed.
- Discoveries are deterministic and reveal on approach.
- Input bindings cover every action.
- **Deployment constraints**: `base: './'` present in Vite config; no hard-coded
  localhost URLs in source; built `index.html` uses relative asset URLs
  (GitHub Pages subpath-safe).

## Test results (this build)

```
 Test Files  4 passed (4)
      Tests  50 passed (50)
```

| File | Tests | Status |
| --- | --- | --- |
| tests/worldgen.test.ts | 10 | ✅ pass |
| tests/hydrology.test.ts | 4 | ✅ pass |
| tests/simulation.test.ts | 14 | ✅ pass |
| tests/save.test.ts | 22 | ✅ pass |

Typecheck (`tsc --noEmit`, strict): **clean**. Production build: **succeeds**
(≈ 207 kB gzip JS + 4 kB CSS, no external requests).

## Probe scripts (visual/manual verification)

| Script | Purpose |
| --- | --- |
| `scripts/survey.ts` | height histograms, biome coverage, min/max across a 4 km grid |
| `scripts/presettle.ts` | settlement composition survey across seeds (buildings, roads, docks) |
| `scripts/prewater.ts` | hydrology warm-up metrics (water volume, quality) |
| `scripts/presave.ts` | save size and round-trip measurements |

## Known gaps in automated coverage

Rendering output, input feel, audio and pointer-lock UX require a real browser;
the suite asserts everything that can be asserted headlessly (geometry edge
equality, simulation state machines, serialization round-trips) and the
acceptance scenario (follow a villager through a day) is scripted in the game
itself (press `F`).

## Regression tests (`tests/regressions.test.ts`)
- Empty vegetation chunks are recorded (no per-sync regeneration); pruning and disposal.
- Shared rock/bush/flower materials stay bounded across chunk rebuilds.
- Foliage setting changes tree counts; render-distance setting changes streamed chunks.
- Atmosphere disposal removes lights, sky dome and fog.
- Export → import round-trip of an edited world restores each settlement exactly once.
- Water vertices never sit above their hydrology cell level (no floating sheets).

## Browser smoke test (`tests/e2e/smoke.e2e.mjs`)
Drives the real game with headless Chrome via `puppeteer-core`:

```bash
npm run dev                       # in one terminal
CHROME_PATH=/path/to/chrome EDEN_URL=http://localhost:5173/ npm run test:e2e
```

Without `CHROME_PATH` the script skips (exit 0). It covers boot, the menu, New World,
regeneration (light count stable), pause-menu save commit, gallery rename persistence,
Continue availability, leaving the menu, and fails on page errors or shader errors.
Software GL makes frame timings meaningless; they are printed for information only.
