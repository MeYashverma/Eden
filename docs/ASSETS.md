# Asset manifest & acknowledgments

## Procedural assets (generated in code, zero external files)

| Asset | Where generated | Notes |
| --- | --- | --- |
| Terrain material maps (albedo + normal): grass, dirt, rock, sand, snow, gravel | `src/render/textures.ts` | Canvas noise + Sobel normal maps |
| Tree bark / leaf atlases, bush, flowers, pine needles | `src/render/textures.ts` | Canvas-drawn; used in instanced vegetation |
| Sky (gradient, sun, moon, stars, clouds) | `src/render/sky.ts` | Analytic shader + fbm clouds |
| Water surface | `src/render/water.ts` | Procedural waves/foam in shader |
| Human & animal bodies | `src/sim/models.ts` | Primitive-composed geometry with per-agent tinting |
| Buildings (houses, barns, shops, taverns, warehouses, wells, towers, docks, fields, fences) | `src/sim/buildings.ts` | Modular kit: walls/roofs/doors/windows/chimneys |
| Weather particles (rain/snow) | `src/engine.ts` | Recycled Points cloud |
| Icons & logo mark | `src/ui/icons.ts`, `index.html` | Inline SVG set (~55 icons) + favicon |
| All sounds (ambience, wind, rain, thunder, birds, footsteps, tools, UI) | `src/audio/audio.ts` | Web Audio synthesis (oscillators, noise, filters) |

There are **no third-party models, textures, audio files, fonts or icon
packs** in the repository or the build output. No attribution for assets is
required. System font stacks only — no webfonts.

## Software dependencies (build-time / runtime libraries)

| Package | License | Role |
| --- | --- | --- |
| three | MIT | Rendering (runtime) |
| vite | MIT | Dev server + build |
| typescript | Apache-2.0 | Language/compiler |
| vitest | MIT | Test runner |
| @types/three, @types/node, @types/web | MIT | Type definitions |

## Favicon

`public/favicon.svg` is an original mark created for this project (SVG, no
external license).
