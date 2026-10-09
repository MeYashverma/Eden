# EDEN — A Living World Sandbox

**EDEN** is a browser-based 3D world sandbox: an endless, procedurally generated
landscape of mountains, forests, rivers and coasts — populated by wildlife that
hunts, grazes and migrates, and by people with names, homes, jobs and daily
routines — that you can explore, sculpt, build in and watch evolve across
seasons and years.

Everything runs client-side. There is no backend, no account, no API key.
After the first load the game works from browser cache.

---

## Quick start

```bash
npm install        # requires Node 18+
npm run dev        # development server at http://localhost:5173
```

Production build:

```bash
npm run build      # type-check + bundle into dist/
npm run preview    # serve the production build locally
```

Tests:

```bash
npm test           # vitest suite (world generation, simulation, saves, deployment)
```

## Play

1. **Continue / New World** from the main menu (the menu itself runs over a live world).
2. Walk to the settlement marked on your map (`M`) and press `E` near a villager —
   then follow them through a day.
3. Press `B` for terrain sculpting and building tools, `N` for live world
   statistics, `G` for god tools, `C` to cycle cameras (third person, first
   person, free-fly, city overview).
4. `Esc` → **Save world**. Saves live in your browser (IndexedDB); export a
   portable JSON copy from the World Gallery.

Full key bindings: [docs/CONTROLS.md](docs/CONTROLS.md).

## Deploying to GitHub Pages

The build is fully static with **relative asset paths** (`base: './'`), so it
works under any repository subpath.

**Option A — GitHub Actions (recommended)**

1. Push this repository to GitHub.
2. In the repo settings → *Pages* → set **Source** to **GitHub Actions**.
3. The included workflow (`.github/workflows/deploy.yml`) builds and publishes
   `dist/` on every push to `main`.

**Option B — manual**

```bash
npm run build
# publish the contents of dist/ to the gh-pages branch or Pages artifact
```

Then open `https://<user>.github.io/<repo>/`.

## Documentation

| Document | Contents |
| --- | --- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Engine, world generation, simulation design, threading, performance |
| [docs/FEATURES.md](docs/FEATURES.md) | What is implemented, in detail |
| [docs/CONTROLS.md](docs/CONTROLS.md) | Key bindings, gamepad & touch, camera modes |
| [docs/LIMITATIONS.md](docs/LIMITATIONS.md) | Honest scope notes, approximations, known issues |
| [docs/TESTING.md](docs/TESTING.md) | Automated tests, how to run them, results |
| [docs/EXTENDING.md](docs/EXTENDING.md) | Adding species, biomes, buildings, tools, simulation systems |
| [docs/ASSETS.md](docs/ASSETS.md) | Asset manifest & acknowledgments (all procedural) |

## Technology

- **TypeScript + Three.js + Vite** — chosen for reliable game logic, a mature
  WebGL renderer with PBR/shadows/post-processing, and a static build that
  deploys to GitHub Pages without a server.
- **Procedural everything** — terrain, textures, trees, buildings, people,
  animals and sound are generated in code. No third-party asset files, no
  licensing exposure, works offline.
- **Deterministic seed-based world generation** — the same seed reproduces the
  same terrain, rivers, settlements and wildlife placement.
- **Coarse hydrological simulation** — rain runs downhill, pools into lakes,
  floods fields, and responds when you dig channels or dam a stream.
- **Utility AI** — animals and citizens choose actions from needs, perception
  and opportunity. Predators only hunt what they can see or remember.
- **IndexedDB saves** with portable JSON export/import and versioned schemas.

## License

This project is a personal, non-commercial work. Dependencies (Three.js, Vite,
TypeScript) remain under their own licenses — see docs/ASSETS.md.
