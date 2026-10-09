# Scope notes & known limitations

EDEN is an honest engineering project: a coherent world sandbox with real
systems behind every claim. Where a system is an approximation rather than a
full physical simulation, it is listed here.

## Simulation fidelity

- **Hydrology** is a shallow-water / virtual-pipe approximation on a 16 m
  grid around the player — it conserves mass and flows downhill, but does not
  model wave dynamics, groundwater or erosion deposition in detail. Rivers
  come from a drainage accumulation model, not from long-term erosion.
- **Weather** is a per-region state machine with climate feedback (drought
  lowers the water balance; rain raises it), not a GCM. Local weather is one
  coherent system — you will not see a storm over one hill and sun over the next.
- **Economy** is stocks + simple lerp dynamics (supply/demand style), not a
  full agent-based market. Villagers buy food conceptually; prices respond to
  supply.
- **Population growth** uses logistic caps and event-driven birth/death rolls
  rather than full genetics. Speciation is out of scope.

## Simulation update mode

All simulation runs on the main thread in fixed game-time slices (≤15 game
minutes each). Generation and streaming use a budgeted queue to protect frame
times, and detail is layered by distance. This keeps the codebase free of
worker/serialization bugs, at the cost of parallel throughput a Web Worker
would give. The module boundaries (pure worldgen, data-only save) were designed
so a worker split is a contained future change.

## Rendering

- Reflections are sky-fresnel approximations (no planar water reflections).
- Shadows come from one directional light; contact/ambient occlusion is
  baked into materials rather than screen-space.
- Post-processing (ACES + bloom) is optional and quality-gated.
- "Infinite" terrain means the streaming budget keeps ~350 m of detailed
  world around you plus a far ring to the horizon — not literally unbounded
  unique content.

## Browser support

- Targets evergreen Chromium/Firefox/Safari with WebGL2 (graceful context-loss
  handling included). WebGL1 is not supported.
- Pointer lock and Web Audio require a user gesture — the game unlocks them on
  first click/keypress and never blocks on them.
- No third-party assets means the app works offline after first load; there are
  no CDN fonts or external service calls of any kind.

## Known issues

- Very large saves (thousands of placed objects) load slower than typical ones;
  autosave is throttled to the configured interval to avoid hitching.
- Foliage near chunk borders may pop slightly when density settings change
  (requires chunk rebuild).
- Touch controls are functional but less precise than mouse/keyboard for fine
  sculpting.
- The map is rasterised per frame while open at high zoom on very old devices
  and can cost a few ms; close it for maximum FPS.

## Testing honesty

Automated tests cover determinism, terrain continuity, hydrology behaviour,
agent state machines, schedules, economy direction, save round-trips and
deployment constraints (see docs/TESTING.md). Rendering quality, feel and
visual output cannot be asserted automatically — those were validated by
probe scripts (heightfield sampling, settlement composition, save size) and
need human visual review on the live build.
