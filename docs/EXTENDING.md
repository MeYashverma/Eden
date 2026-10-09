# Extending EDEN

The codebase is deliberately modular — most additions are data + a small
registration step.

## Add an animal species

1. Open `src/sim/animals.ts` and add an entry to `SPECIES`:

```ts
elk: {
  name: 'elk',
  speed: 7.2, size: 1.25, health: 110, hungerRate: 1.2, thirstRate: 1.1,
  diet: 'herbivore', prey: [], habitat: ['forest', 'grassland'], senses: { sight: 45, hearing: 25, smell: 30 },
  social: 'herd', herdSize: 6, activity: 'diurnal', fear: 0.8, aggression: 0.05, // …
},
```

2. Add a body plan in `src/sim/models.ts` (`buildAnimalParts`) — or reuse
   `deerParts` with different proportions.
3. Add a render entry in `src/sim/agentRenderers.ts` (`ANIMAL_RENDERERS`) and,
   if it should spawn naturally, to `HABITAT_TABLE` rows in `animals.ts`.
4. Done — spawning, AI, population caps, rendering and saves pick it up.

## Add a building type

1. Add the id to `BuildingType` in `src/sim/models.ts`.
2. Give it a kit in `src/sim/buildings.ts` (`buildStructure` switch) with a
   footprint (`width/depth/height`) and an entrance (or rely on the defaults).
3. It becomes available in the tool system (`src/player/tools.ts`) via a new
   `ToolDef` (`type: 'building'`) and in `engine.ts` build panel list.
4. Placement validation and saves work unchanged.

## Add a biome

1. Extend `BiomeId` in `src/world/types.ts`.
2. Classify it in `WorldGen.classifyBiome` (climate/slope/altitude rules).
3. Paint it in `terrainMaterial.ts` splat weights (biome → material blend).
4. Add scatter rules in `WorldGen.scatter` or `VegetationSystem.generateChunkVegetation`.

## Add a terrain tool

Add a `ToolDef` in `src/player/tools.ts` (`type: 'terrain'`, `brush: 'raise' | …`)
— or extend `TerrainEdits.applyBrush` with a new operation (e.g. `terrace`) and
reference it. Undo/redo and persistence come along for free because every
stroke is recorded as cell deltas.

## Add a weather kind

Add the profile to `PROFILES` in `src/world/weather.ts`, extend
`WeatherKind` in `types.ts`, an icon in `ui/icons.ts`, and let the state
machine transition to it — visuals, particles, audio and hydrology read the
shared state automatically.

## Add a simulation system

Implement a class with `step(...)`/`serialize()`/`restore()` and call it from
`Simulation.update` inside the fixed-slice callback. Follow the detail-level
convention (near-player full detail, far aggregate) and extend
`WorldSave.simulation` for persistence.

## Testing your changes

Add cases in `tests/` mirroring the existing suites; `npm test` runs headless.
Deterministic RNG (`src/core/rng.ts`) should be used for anything that must
reproduce across saves.
