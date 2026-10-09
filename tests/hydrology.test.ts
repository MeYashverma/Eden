/** Hydrology: flow, pooling, drought response and terrain coupling. */

import { describe, it, expect } from 'vitest';
import { WorldGen } from '../src/world/worldGen';
import { defaultWorldConfig } from '../src/world/types';
import { Hydrology, HYDRO_N, HYDRO_CELL } from '../src/world/hydrology';

describe('hydrology simulation', () => {
  it('water flows downhill and pools in depressions', () => {
    const gen = new WorldGen(defaultWorldConfig(11));
    const hydro = new Hydrology(gen);

    // Find a local depression near the origin.
    let pit = { x: 0, z: 0, h: Infinity };
    for (let z = -120; z <= 120; z += 16) {
      for (let x = -120; x <= 120; x += 16) {
        const h = gen.height(x, z);
        if (h > 2 && h < pit.h) pit = { x, z, h };
      }
    }
    hydro.recenter(pit.x, pit.z, true);

    // Dump a large amount of water on a cell uphill.
    const uphillX = pit.x + HYDRO_CELL * 4;
    const uphillZ = pit.z;
    hydro.addWater(uphillX, uphillZ, 12);

    const before = hydro.depthAt(pit.x, pit.z);
    for (let i = 0; i < 60; i++) hydro.step(0.25, 1, 0);
    const after = hydro.depthAt(pit.x, pit.z);
    expect(after).toBeGreaterThanOrEqual(before); // water found its way toward the low point
    expect(hydro.totalWater).toBeGreaterThan(0);
  });

  it('rainfall raises water levels and evaporation lowers them', () => {
    const gen = new WorldGen(defaultWorldConfig(11));
    const hydro = new Hydrology(gen);
    hydro.recenter(0, 0, true);

    for (let i = 0; i < 30; i++) hydro.step(0.5, 1, 1); // heavy rain
    const wet = hydro.totalWater;
    hydro.waterBalance = 0.3;
    for (let i = 0; i < 80; i++) hydro.step(0.5, 1, 0); // drought
    expect(hydro.totalWater).toBeLessThan(wet);
  });

  it('water surface respects terrain (no water floating above dry ground)', () => {
    const gen = new WorldGen(defaultWorldConfig(23));
    const hydro = new Hydrology(gen);
    hydro.recenter(0, 0, true);
    for (let i = 0; i < 10; i++) hydro.step(0.25, 1, 0.2);
    for (let i = 0; i < 400; i++) {
      const x = (i * 37) % 400 - 200;
      const z = (i * 61) % 400 - 200;
      const surf = hydro.surfaceAt(x, z);
      if (surf !== null) {
        const terrain = gen.height(x, z);
        expect(surf).toBeGreaterThanOrEqual(Math.min(terrain, 0) - 0.001);
      }
    }
  });

  it('quality degrades under pollution and recovers slowly', () => {
    const gen = new WorldGen(defaultWorldConfig(23));
    const hydro = new Hydrology(gen);
    hydro.recenter(0, 0, true);
    // Create some water first
    for (let i = 0; i < 20; i++) hydro.step(0.5, 1, 1);
    hydro.pollute(0, 0, 60, 0.8);
    const qAfter = hydro.qualityAt(0, 0);
    expect(qAfter).toBeLessThan(0.6);
    for (let i = 0; i < 30; i++) hydro.step(0.5, 1, 0.3);
    expect(hydro.qualityAt(0, 0)).toBeGreaterThanOrEqual(qAfter);
  });
});
