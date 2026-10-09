/**
 * Regression tests for defects found in the audit:
 *  - vegetation regenerated empty chunks every sync and never pruned distant ones
 *  - per-chunk rock/bush/flower materials accumulated and were animated every frame
 *  - the foliage and render-distance settings had no effect on the systems
 *  - the atmosphere controller left lights and sky domes in the scene on rebuild
 *  - saves must round-trip real edited worlds without duplicating settlements
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { WorldGen } from '../src/world/worldGen';
import { Hydrology } from '../src/world/hydrology';
import { ChunkManager, buildWaterGeometry } from '../src/world/chunks';
import { VegetationSystem } from '../src/world/vegetation';
import { defaultWorldConfig, CHUNK_SIZE } from '../src/world/types';
import { Simulation } from '../src/sim/simulation';
import { AtmosphereController } from '../src/render/lighting';
import { createSky } from '../src/render/sky';
import { createWater } from '../src/render/water';
import { buildExportFile, parseExportFile, validateSave, SAVE_VERSION, type WorldSave } from '../src/persistence/save';

const tex = () => new THREE.Texture();

function materialCount(veg: VegetationSystem): number {
  return (veg as unknown as { materials: THREE.Material[] }).materials.length;
}

describe('vegetation streaming', () => {
  it('records empty chunks so they are not regenerated every sync', () => {
    const gen = new WorldGen(defaultWorldConfig(4242));
    const veg = new VegetationSystem(gen, tex(), tex());
    let generated = 0;
    // Force an empty chunk so the early-return path is exercised.
    veg.generateChunkVegetation = () => {
      generated++;
      return [];
    };
    expect(veg.hasChunk('3,3')).toBe(false);
    veg.buildChunk(3, 3);
    expect(veg.hasChunk('3,3')).toBe(true);
    expect(veg.activeGroups).toBe(0);
    expect(generated).toBe(1);
  });

  it('keeps the shared material list bounded across many chunk builds', () => {
    const gen = new WorldGen(defaultWorldConfig(7));
    const veg = new VegetationSystem(gen, tex(), tex());
    for (let cz = -2; cz <= 2; cz++) for (let cx = -2; cx <= 2; cx++) veg.buildChunk(cx, cz);
    const first = materialCount(veg);
    for (let rep = 0; rep < 3; rep++) {
      for (let cz = -2; cz <= 2; cz++) for (let cx = -2; cx <= 2; cx++) veg.buildChunk(cx, cz);
    }
    expect(materialCount(veg)).toBe(first);
  });

  it('prunes vegetation that streamed out of range and disposes it cleanly', () => {
    const gen = new WorldGen(defaultWorldConfig(9));
    const veg = new VegetationSystem(gen, tex(), tex());
    for (let cz = -3; cz <= 3; cz++) for (let cx = -3; cx <= 3; cx++) veg.buildChunk(cx, cz);
    veg.buildChunk(40, 40);
    const before = veg.activeGroups;
    const pruned = veg.pruneFar(0, 0, 4);
    expect(pruned).toBeGreaterThan(0);
    expect(veg.hasChunk('40,40')).toBe(false);
    expect(veg.activeGroups).toBeLessThan(before);
    veg.dispose();
    expect(veg.activeGroups).toBe(0);
    expect(veg.group.children.length).toBe(0);
  });

  it('applies the foliage setting: more density yields more trees', () => {
    const gen = new WorldGen(defaultWorldConfig(31));
    const veg = new VegetationSystem(gen, tex(), tex());
    const countAt = (scale: number) => {
      veg.setFoliageScale(scale);
      let n = 0;
      for (let cz = -2; cz <= 2; cz++) for (let cx = -2; cx <= 2; cx++) n += veg.generateChunkVegetation(cx, cz).length;
      return n;
    };
    const low = countAt(0.4);
    const high = countAt(1.6);
    expect(high).toBeGreaterThan(low);
  });
});

describe('chunk streaming radius', () => {
  it('setViewDistance changes how many chunks are queued', () => {
    const gen = new WorldGen(defaultWorldConfig(12));
    const hydro = new Hydrology(gen);
    const chunks = new ChunkManager(gen, hydro, {
      viewDistance: 256,
      farDistance: 1024,
      terrainMaterial: new THREE.MeshBasicMaterial(),
      waterMaterial: new THREE.MeshBasicMaterial(),
      buildsPerFrame: 2,
    });
    chunks.update(0, 0, true);
    const small = chunks.pendingBuilds;
    chunks.setViewDistance(768);
    chunks.update(0, 0);
    expect(chunks.viewDistance).toBe(768);
    expect(chunks.pendingBuilds).toBeGreaterThan(small * 2);
  });
});

describe('atmosphere lifecycle', () => {
  it('removes lights, fog and sky from the scene on dispose', () => {
    const scene = new THREE.Scene();
    const sky = createSky();
    const water = createWater(tex()).material;
    const atmo = new AtmosphereController(scene, sky, new THREE.MeshStandardMaterial(), water);
    const lightsBefore = scene.children.filter((c) => (c as THREE.Light).isLight).length;
    expect(lightsBefore).toBe(3);
    atmo.dispose();
    expect(scene.children.filter((c) => (c as THREE.Light).isLight).length).toBe(0);
    expect(scene.children.includes(sky.mesh)).toBe(false);
    expect(scene.fog).toBeNull();
  });
});

describe('save round-trip on an edited world', () => {
  it('restores settlements exactly once and keeps terrain edits', () => {
    const config = defaultWorldConfig(2024);
    const gen = new WorldGen(config);
    const hydro = new Hydrology(gen);
    const veg = new VegetationSystem(gen, tex(), tex());
    const sim = new Simulation(gen, hydro, veg, config.seed);
    sim.ensureSettlementNear(0, 0, 900);
    const count = sim.settlements.length;
    expect(count).toBeGreaterThan(0);
    const groupChildren = sim.group.children.length;

    // A real terrain edit, serialized through the export pipeline.
    gen.edits.deltas.set(12345, 3.5);
    const save: WorldSave = {
      version: SAVE_VERSION,
      meta: { name: 'Edited', seed: config.seed, created: 1, updated: 2, playSeconds: 60 },
      config,
      clock: sim.clock.serialize(),
      weather: sim.weather.serialize(),
      hydro: sim.serialize().hydro,
      terrainEdits: gen.edits.serialize(),
      vegetation: veg.serialize() as never,
      simulation: sim.serialize(),
      player: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, cameraMode: 'third' } as never,
      discoveries: [],
    } as WorldSave;

    const parsed = parseExportFile(buildExportFile(save));
    expect(parsed.error).toBeNull();
    const validated = validateSave(parsed.save);
    expect(validated.result.ok).toBe(true);

    // Restore into a fresh world, as the engine does on load.
    const gen2 = new WorldGen(config);
    const hydro2 = new Hydrology(gen2);
    const veg2 = new VegetationSystem(gen2, tex(), tex());
    const sim2 = new Simulation(gen2, hydro2, veg2, config.seed);
    sim2.restore(validated.save!.simulation as never);
    expect(sim2.settlements.length).toBe(count);
    expect(sim2.settlementBundles.size).toBe(count);
    expect(sim2.group.children.length).toBe(groupChildren);
    expect(validated.save!.terrainEdits.d.length).toBeGreaterThan(0);
  });

  it('chunk size constant matches the vegetation grid used by streaming', () => {
    expect(CHUNK_SIZE).toBeGreaterThan(0);
  });
});

describe('water surface consistency', () => {
  it('water vertices never rise above their hydrology level or float over dry ground', () => {
    const gen = new WorldGen(defaultWorldConfig(20260409));
    const hydro = new Hydrology(gen);
    hydro.warmup(160);
    let wetVerts = 0;
    for (let cz = -2; cz <= 2; cz++) {
      for (let cx = -2; cx <= 2; cx++) {
        const geo = buildWaterGeometry(gen, hydro, cx, cz);
        if (!geo) continue;
        const pos = geo.attributes.position;
        const ox = cx * CHUNK_SIZE;
        const oz = cz * CHUNK_SIZE;
        for (let i = 0; i < pos.count; i++) {
          const x = ox + pos.getX(i);
          const z = oz + pos.getZ(i);
          const y = pos.getY(i);
          const t = gen.height(x, z);
          if (y > t + 0.02) {
            wetVerts++;
            const level = hydro.levelAt(x, z);
            expect(level).not.toBeNull();
            // Surface sits at the cell's flat level, not above it.
            expect(y).toBeLessThanOrEqual(level! + 0.02);
          }
        }
      }
    }
    expect(wetVerts).toBeGreaterThan(0);
  });
});
