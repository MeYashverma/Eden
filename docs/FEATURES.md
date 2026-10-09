# Features

## World

- **Endless procedural terrain** — continents, mountain ranges with peaks
  hundreds of metres high, rolling hills, river-carved valleys, lake basins,
  beaches and shallow shelves. Generation is seed-deterministic and seamless.
- **Rivers and lakes from drainage flow** — flow accumulation carves channels;
  a shallow-water sim makes water pool, flow downhill, flood and dry up.
- **Biome-aware climate** — temperature from altitude + season + latitude
  noise; moisture from a separate field. Slope, altitude, climate and player
  paint all influence the terrain surface appearance.
- **Dynamic weather** — clear, fair, overcast, rain, storm, snow, fog, heatwave,
  wind each with wind, precipitation, fog, temperature and hydrology effects.
  Lightning flashes light the scene; heatwaves dry rivers; storms swell them.
- **Seasonal cycle** — days (~15 real minutes at 1×), 30-day months,
  4-season years; snow line rises and falls, foliage colour shifts, wheat turns
  golden in autumn.

## Simulation

- **Wildlife** — deer, wolves, rabbits, boar, bears, foxes, birds, fish…
  each with species traits (speed, senses, prey, habitat, social groups,
  activity patterns). Individual agents have needs (hunger, thirst, energy,
  fear, social) and a utility AI: animals graze at dawn, drink at water, herd,
  migrate, hunt what they can perceive, remember carcasses, sleep at night.
- **People** — villagers with names, ages, occupations (farmer, fisher,
  builder, smith, merchant, healer, guard, innkeeper…), homes and lives.
  They follow daily schedules (sleep, eat, work the fields or fish, socialise
  at the well at noon, gather at the tavern at dusk), meet other people,
  form relationships, and have long-term goals (buy a home, open a workshop…).
- **Settlements** — villages generate with town wells, clusters of houses,
  barns and shops, fields, fences, docks and docksides, road networks between
  them. Settlement economy tracks food/timber/stone/goods/money stocks and
  prosperity; an economy leverages/food model keeps villagers fed or hungry
  honestly (more mouths → rising prices).
- **Emergent events** — droughts, migrations, famines, disputes and festivals
  fire from live simulation state and leave a readable event log.
- **Live world statistics** — population and species counts from real state,
  births/deaths, water volume from the hydrology sim, trees, buildings,
  temperature/season/precipitation.

## Player

- **Movement** — walk, sprint, jump, swim, climb terrain; three-person
  camera modes (third person, first person, free-fly, city overview).
  Gravity is soft, terrain collision works on the same height field as
  rendering (no divergence), water slows you down and warms you less.
- **Survival elements** — health, stamina, hunger, thirst and warmth with
  readable HUD feedback (toggleable in settings for a pure creative experience).
- **Sculpting tools** — raise, lower, smooth, flatten, paint materials with
  radius/strength sliders and live brush previews; every stroke is undoable
  (Ctrl+Z) and persists into saves.
- **Build & place** — houses, cottages, barns, shops, taverns, warehouses,
  wells, towers, docks, fences, fields; trees and bushes to plant with instant
  water feedback. Ghost previews show placement before committing.
- **Interact** — press `E` near villagers, animals and buildings for an
  inspector panel: identity, needs, activity, and follow/share/dismiss actions.
  Press `F` to follow a villager through a full day.
- **Live map** — full-screen canvas map with fog-of-war exploration, zoom/pan,
  player arrow, settlements, discoveries, waypoints; minimap in the HUD.

## Interface

- Full **main menu** over a live 3D background: Continue, New World (seed and
  world sliders), World Gallery (load, export, import, delete), Settings,
  Controls, Credits.
- **Boot screen reflects real progress** — terrain, textures, settlements,
  hydrology warm-up with honest status text. Errors show a real error message.
- HUD: clock/date/season/weather, speed control (0–64×), survival bars,
  hotbar, minimap, contextual prompts, camera & location indicators.
- Panels pause the world and offer keyboard navigation; every icon button is
  inline SVG with an accessible label; the whole UI is styled (dark field
  journal theme) with readable typography and responsive layout.
- Toast notifications, debug overlay (F3), god tools (seeded weather/season/
  time/water/fire/rain/animal/population controls).
- Settings persisted: quality presets, render distance, shadows,
  post-processing, foliage density, simulation density, minimap, debug,
  master/ambience/effects/UI volume, mute, FOV, invert-Y, sensitivity,
  survival on/off, autosave interval.

## Audio

Procedural Web Audio: day/night ambient beds, wind that follows the weather,
rain, thunder, birds, crickets, footsteps, tool feedback and UI sounds —
all synthesised, all unlocked on first user gesture, all with independent
mixer channels.

## Persistence

- IndexedDB save slots with names, seed, version and last-modified dates;
  autosave at a configurable interval (default 5 minutes) or manual save (Esc).
- Portable JSON export/import with corruption detection and versioned
  migration (v1 → v2 demonstrated in tests).
- Settings and key bindings persisted in localStorage.
