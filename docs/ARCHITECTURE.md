# Technical architecture

## Stack decision

**TypeScript + Three.js + Vite** was chosen after weighing the alternatives:

- *Babylon.js / PlayCanvas* — comparable, but Three.js has the richest set of
  reference implementations for custom terrain/water shaders and the smallest
  surface area for a fully custom pipeline.
- *Raw WebGL/WebGPU* — too much engine work for the budget; WebGPU adoption is
  still uneven across browsers and the spec explicitly wants graceful fallback.
- *Heavyweight frameworks (React-three-fiber etc.)* — valuable for product UIs,
  but a game loop with thousands of dynamic objects benefits from a direct
  scene graph; the UI here is a thin hand-built DOM layer instead.

Vite gives instant dev feedback and a static production bundle with **relative
asset paths** (`base: './'`), which is what GitHub Pages subpath hosting needs.

## Module map

```
src/
  main.ts             entry: boot, menu hand-off, fatal error surface
  engine.ts           frame loop; wires every subsystem; persistence actions
  core/
    noise.ts          simplex2D, fbm, ridged, billow, domain warp (pure)
    rng.ts            seeded RNG + hierarchical hashes (determinism backbone)
    clock.ts          world time, seasons, speed with fixed slices
    input.ts          keyboard/mouse/gamepad/touch, pointer lock, bindings
    discoveries.ts    points of interest + proximity reveal
  world/
    types.ts          chunk constants, biome ids, world config
    worldGen.ts       height field, drainage (rivers), climate, scatter
    terrainEdits.ts   sparse 2 m height/paint delta layer (player edits)
    hydrology.ts      coarse water simulation (virtual pipes) + quality
    chunks.ts         chunk meshes, streaming queue, far ring, raycast
    vegetation.ts     instanced trees/bushes/rocks/flowers, wind, planting
    weather.ts        weather state machine + climate balance (drought/wet)
  render/
    textures.ts       procedural canvas textures (albedo + normal maps)
    terrainMaterial.ts PBR splat blending injected into MeshStandardMaterial
    sky.ts            analytic sky dome: sun, moon, stars, clouds
    water.ts          depth-aware water shader (fresnel, foam, absorption)
    lighting.ts       atmosphere controller: sun/moon/fog/colours per frame
  sim/
    models.ts         procedural human/animal part geometry
    agentRenderers.ts instanced humans & animals with procedural animation
    animals.ts        species defs, individual agents, utility AI, populations
    citizens.ts       humans: needs, schedules, jobs, relationships
    buildings.ts      modular architecture kit (walls/roofs/doors/details)
    settlements.ts    village generation, roads, settlement economy
    ecosystem.ts      measured world statistics
    events.ts         emergent world events + event log
    simulation.ts     orchestrator: fixed-slice stepping of all systems
  player/
    player.ts         movement, terrain collision, swimming, survival
    tools.ts          terrain brushes, planting, building, interaction
  ui/
    ui.ts             menu, HUD, panels, inspector, god bar, toasts
    worldMap.ts       canvas map rasterised from the world field
    icons.ts          inline SVG icon set
    styles.css        full interface stylesheet
  audio/audio.ts      procedural Web Audio soundscape
  persistence/
    db.ts             IndexedDB wrapper + settings in localStorage
    save.ts           versioned save schema, validation, export/import
```

## World generation

The terrain is a **pure function** of `(seed, x, z)`:

1. **Continental mask** — domain-warped low-frequency noise decides ocean
   basins vs landmasses (~60/40 land/sea).
2. **Relief layers** — fbm plains, warped hills, and a ridged multifractal
   masked into coherent mountain *ranges* (not scattered cones).
3. **Lake basins** — billow noise hollows shallow depressions in flat land.
4. **River carving** — a per-region D8 drainage graph computes flow
   accumulation on a 32 m grid (region size 2048 m, LRU-cached); channels are
   carved with depth proportional to accumulated flow.

Because every consumer (mesh, collision, vegetation, map, AI) samples the same
function, chunk seams are inherently seamless and saves only need **deltas**.

### Terrain edits

Player edits live in a sparse 2 m grid of height deltas + material paint
(`TerrainEdits`). Chunks sample `baseHeight + deltaAt`, so sculpted land
updates collision, water flow and vegetation immediately — and serialises to a
few kilobytes.

## Hydrology

A moving 112×112 window of 16 m cells around the player stores standing-water
depth and quality. Each step routes water downhill (simplified virtual pipes:
outflow proportional to head difference, capped for stability), adds rainfall
and river feed, subtracts evaporation. Warm-up passes settle a fresh world so
rivers and lakes exist at spawn.

This is a shallow-water approximation, not Navier–Stokes — it conserves mass
and follows gravity, which is what the gameplay needs (dams back up, channels
drain, droughts shrink rivers, floods swell them).

## Simulation detail levels

| Distance | Treatment |
| --- | --- |
| Near player (~300 m) | Full agent AI every fixed slice; instanced rendering with animation |
| Mid (~300–420 m) | Full AI (bounded array sizes), rendering per-species capped at 48 nearest |
| Far | Agents abstract into per-species population counters with growth limits |
| Inactive chunks | Not updated; terrain is analytic so queries remain valid |

The clock advances in ≤15-game-minute **slices** even at 64× speed, so agents
never skip decisions or end up in invalid states after fast-forward.

## Rendering

- PBR `MeshStandardMaterial` extended via `onBeforeCompile` with a 6-layer
  terrain splat (grass/dirt/rock/sand/snow/gravel) driven by slope, altitude,
  moisture and player paint; two texture scales cross-fade to hide tiling.
- Procedural canvas textures with Sobel-derived normal maps; anisotropy 4.
- Sun with PCF-soft shadows following the player; hemisphere fill; moonlight.
- Custom sky dome shader: analytic scattering gradient, sun/moon disks, hash
  stars, two-layer fbm clouds, storm darkening.
- Water: custom shader — wind waves scaled by depth, fresnel sky reflection,
  sun glints, exponential depth absorption, shore foam from hydrology depth.
- Optional post chain (ACES tonemapping + subtle bloom) behind a quality flag.
- Weather particles (rain/snow) as a recycled `Points` cloud around the player.

## Performance strategy

- Chunk streaming with a per-frame build budget (≤6 ms) — no generation spikes.
- Far terrain ring (512 m tiles) carries the landscape into the haze.
- Instanced meshes everywhere: trees/rocks per chunk, human/animal *parts*
  pooled across all agents (a handful of draw calls for hundreds of agents).
- Vegetation wind and agent animation are computed in instance transforms —
  zero per-object scene-graph churn.
- Quality presets (Low→Ultra) scale render distance, shadow map, pixel ratio
  and post-processing; custom mode keeps individual sliders.
- WebGL context loss is handled (renderer paused and resumed cleanly).

## Persistence

- **IndexedDB** (`eden-worlds`) for save slots: seed + config, clock, weather,
  terrain edit deltas, vegetation plant/removal lists, settlements, agents,
  event log, discoveries, player state. Versioned schema with migration hooks
  (v1→v2 demonstrated in tests) and corruption-safe validation.
- **localStorage** for settings and key bindings only.
- **Export/import** via a portable JSON envelope (`eden-world-export`), with
  optional `CompressionStream` support detected at runtime.

## Threading note

World generation is deterministic and cheap enough per chunk (≈2.5k samples) to
run inside the frame budget queue; the heavier pieces (drainage regions, chunk
meshing) are amortised across frames. A Web Worker path fits the design
(heightfield pre-generation) and the module boundaries are set up for it, but
the shipped build keeps one thread to avoid worker/serialization overhead at
this world scale — see docs/LIMITATIONS.md.
