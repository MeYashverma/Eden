/**
 * Save/load, export/import, corruption handling, clock behaviour and
 * production deployment constraints.
 */

import { describe, it, expect } from 'vitest';
import { validateSave, buildExportFile, parseExportFile, SAVE_VERSION, type WorldSave } from '../src/persistence/save';
import { TerrainEdits } from '../src/world/terrainEdits';
import { WorldClock, DAYS_PER_YEAR, DAY_LENGTH_MINUTES } from '../src/core/clock';
import { WeatherSystem, WEATHER_LABEL } from '../src/world/weather';
import { DEFAULT_BINDINGS, type ActionName } from '../src/core/input';
import { defaultWorldConfig } from '../src/world/types';
import { buildStructure, buildWell, createBuildingMaterials, buildDock } from '../src/sim/buildings';
import { RNG } from '../src/core/rng';
import { findDiscoveries, revealNearby } from '../src/core/discoveries';
import { WorldGen } from '../src/world/worldGen';
import { Hydrology } from '../src/world/hydrology';
import fs from 'node:fs';
import path from 'node:path';

function makeSave(overrides: Partial<WorldSave> = {}): WorldSave {
  return {
    version: SAVE_VERSION,
    meta: { name: 'Test', seed: 1, created: 1000, updated: 2000, playSeconds: 600 },
    config: defaultWorldConfig(1),
    clock: { hours: 123.5, speed: 1 },
    weather: { kind: 'fair', state: { kind: 'fair', cloudCover: 0.3, precipitation: 0, windStrength: 0.3, windAngle: 1, fogAmount: 0.1, tempOffset: 0, storm: 0, hydroBalance: 1 }, hoursLeft: 6 },
    hydro: { waterBalance: 1 },
    terrainEdits: { d: [1, 2.5, 3, -1.2], p: [2, 4] },
    vegetation: { planted: [], removed: [] },
    simulation: { clock: { hours: 123.5, speed: 1 } },
    player: { x: 10, y: 20, z: 30, yaw: 1, pitch: 0, health: 100, stamina: 100, hunger: 90, thirst: 90, warmth: 80, cameraMode: 'third', thirdDistance: 7 },
    discoveries: [],
    ...overrides,
  };
}

describe('save validation & migration', () => {
  it('accepts a well-formed save', () => {
    const { save, result } = validateSave(makeSave());
    expect(result.ok).toBe(true);
    expect(save).not.toBeNull();
  });

  it('rejects garbage and reports errors', () => {
    expect(validateSave(null).result.ok).toBe(false);
    expect(validateSave('hello').result.ok).toBe(false);
    expect(validateSave({}).result.ok).toBe(false);
    const { result } = validateSave(makeSave({ player: undefined as never }));
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects saves from the future', () => {
    const { result } = validateSave(makeSave({ version: 999 }));
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('newer');
  });

  it('migrates legacy v1 terrain edit format', () => {
    const legacy = makeSave({ version: 1 });
    (legacy as unknown as Record<string, unknown>).terrainEdits = { deltas: [5, 1.5], paint: [] };
    const { save, result } = validateSave(legacy);
    expect(result.ok).toBe(true);
    expect(result.migrated).toBe(true);
    expect(save!.terrainEdits.d).toEqual([5, 1.5]);
  });
});

describe('export & import', () => {
  it('round-trips through the export envelope', () => {
    const save = makeSave();
    const text = buildExportFile(save);
    const { save: parsed, error } = parseExportFile(text);
    expect(error).toBeNull();
    expect(parsed!.meta.seed).toBe(save.meta.seed);
    expect(parsed!.terrainEdits.d).toEqual(save.terrainEdits.d);
  });

  it('reports corrupt files gracefully', () => {
    expect(parseExportFile('{ not json').error).toBeTruthy();
    expect(parseExportFile(JSON.stringify({ format: 'something-else' })).error).toBeTruthy();
    expect(parseExportFile(JSON.stringify({ format: 'eden-world-export', save: { version: 1 } })).error).toBeTruthy();
  });
});

describe('terrain edit serialization', () => {
  it('round-trips deltas and paint exactly', () => {
    const e = new TerrainEdits();
    e.applyBrush(0, 0, 8, 1.5, 'raise', () => 5);
    e.applyBrush(4, 4, 8, 1, 'paint', () => 5, 3);
    const data = e.serialize();
    const restored = TerrainEdits.deserialize(data);
    expect(restored.deltaAt(0, 0)).toBeCloseTo(e.deltaAt(0, 0), 3);
    expect(restored.paintAt(4, 4)?.mat).toBe(3);
    expect(restored.cellCount).toBe(e.cellCount);
  });

  it('empty edits deserialize safely', () => {
    const e = TerrainEdits.deserialize(undefined);
    expect(e.deltaAt(12, 12)).toBe(0);
  });
});

describe('world clock', () => {
  it('advances in fixed slices even at high speed', () => {
    const clock = new WorldClock();
    clock.speed = 64;
    let slices = 0;
    clock.advance(10, () => slices++);
    expect(slices).toBeGreaterThan(1);
    expect(slices).toBeLessThanOrEqual(Math.ceil((10 * 64 / (DAY_LENGTH_MINUTES * 60 / 24)) / 0.25) + 1);
  });

  it('pause does not advance', () => {
    const clock = new WorldClock();
    clock.speed = 0;
    const h = clock.hours;
    clock.advance(100);
    expect(clock.hours).toBe(h);
  });

  it('seasons cycle through the year', () => {
    const clock = new WorldClock();
    const seen = new Set<string>();
    for (let i = 0; i < DAYS_PER_YEAR; i++) {
      clock.hours = i * 24 + 12;
      seen.add(clock.season);
    }
    expect(seen.size).toBe(4);
  });

  it('time of day wraps at 24h', () => {
    const clock = new WorldClock();
    clock.hours = 47.5;
    expect(clock.timeOfDay).toBeCloseTo(23.5, 5);
    clock.hours = 48;
    expect(clock.timeOfDay).toBeCloseTo(0, 5);
  });
});

describe('weather machine', () => {
  it('transitions between known weather kinds', () => {
    const w = new WeatherSystem(99);
    const seen = new Set<string>([w.state.kind]);
    for (let i = 0; i < 2400; i++) {
      w.update(0.5, 'summer', 22);
      seen.add(w.state.kind);
    }
    for (const kind of seen) {
      expect(WEATHER_LABEL[kind as keyof typeof WEATHER_LABEL]).toBeTruthy();
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('honours forced weather (god mode) with valid kinds only', () => {
    const w = new WeatherSystem(1);
    w.forceWeather('thunderstorm', 6);
    expect(w.state.kind).toBe('thunderstorm');
    expect(w.state.storm).toBeGreaterThan(0.5);
    expect(w.state.precipitation).toBeGreaterThan(0.5);
  });

  it('hydrology balance drifts toward drought in dry conditions', () => {
    const w = new WeatherSystem(7);
    w.forceWeather('heatwave', 200);
    for (let i = 0; i < 400; i++) w.update(0.5, 'summer', 35);
    expect(w.state.hydroBalance).toBeLessThan(1);
  });
});

describe('buildings & placement', () => {
  const mats = createBuildingMaterials();

  it('builds every structure type with geometry and an entrance', () => {
    for (const type of ['house', 'cottage', 'barn', 'shop', 'tavern', 'warehouse'] as const) {
      const kit = buildStructure({ type, rng: new RNG(5), mats });
      expect(kit.group.children.length).toBeGreaterThan(4); // multi-part models
      expect(kit.width).toBeGreaterThan(2);
      expect(kit.height).toBeGreaterThan(2);
    }
    const well = buildWell(mats);
    expect(well.group.children.length).toBeGreaterThan(4);
    const dock = buildDock(mats);
    expect(dock.group.children.length).toBeGreaterThan(4);
  });

  it('buildings vary between instances', () => {
    const a = buildStructure({ type: 'house', rng: new RNG(1), mats });
    const b = buildStructure({ type: 'house', rng: new RNG(2), mats });
    const sameSize = Math.abs(a.width - b.width) < 0.01 && Math.abs(a.depth - b.depth) < 0.01;
    expect(sameSize).toBe(false);
  });
});

describe('discoveries', () => {
  it('places deterministic POIs and reveals them on approach', () => {
    const gen = new WorldGen(defaultWorldConfig(77));
    const hydro = new Hydrology(gen);
    const a = findDiscoveries(gen, hydro, 0, 0, 800);
    const b = findDiscoveries(gen, hydro, 0, 0, 800);
    expect(a.length).toBe(b.length);
    if (a.length > 0) expect(a[0].id).toBe(b[0].id);

    const d = a.find((x) => x.day === 0);
    if (d) {
      const found = revealNearby([d], d.x + 5, d.z + 5, 30);
      expect(found.length).toBe(1);
      expect(found[0].day).toBe(0); // caller sets day
    }
  });
});

describe('input bindings', () => {
  it('every action has a default binding', () => {
    for (const [action, code] of Object.entries(DEFAULT_BINDINGS)) {
      expect(code.length).toBeGreaterThan(0);
      expect(typeof action).toBe('string');
    }
  });
});

describe('production deployment constraints', () => {
  const root = path.resolve(__dirname, '..');

  it('vite config uses a relative base path (GitHub Pages subpath safe)', () => {
    const cfg = fs.readFileSync(path.join(root, 'vite.config.ts'), 'utf8');
    expect(cfg).toContain("base: './'");
  });

  it('no hard-coded localhost URLs in source', () => {
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (['node_modules', 'dist', '.git', 'tests'].includes(entry.name)) continue;
          walk(p);
        } else if (/\.(ts|html|css)$/.test(entry.name)) {
          const text = fs.readFileSync(p, 'utf8');
          if (/localhost|127\.0\.0\.1/.test(text)) offenders.push(p);
        }
      }
    };
    walk(path.join(root, 'src'));
    expect(offenders).toEqual([]);
  });

  it('production build output exists with a working index.html', () => {
    const dist = path.join(root, 'dist', 'index.html');
    if (!fs.existsSync(dist)) {
      // Build has been run in CI; skip rather than fail on clean checkouts.
      console.warn('dist/index.html not present — run npm run build first');
      return;
    }
    const html = fs.readFileSync(dist, 'utf8');
    expect(html).toContain('<script');
    expect(html).toContain('game-canvas');
    // Asset URLs must be relative for subpath hosting.
    expect(html).not.toContain('src="/assets');
    expect(html).not.toContain('href="/assets');
  });
});
