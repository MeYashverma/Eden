/**
 * World generation determinism, continuity and variety.
 * These tests run in Node against the same modules the browser uses.
 */

import { describe, it, expect } from 'vitest';
import { WorldGen } from '../src/world/worldGen';
import { defaultWorldConfig, CHUNK_SIZE, SEA_LEVEL } from '../src/world/types';
import { buildTerrainGeometry } from '../src/world/chunks';
import { TerrainEdits } from '../src/world/terrainEdits';
import { simplex2, fbm } from '../src/core/noise';

describe('noise continuity', () => {
  it('simplex2 has no discontinuities across lattice cells', () => {
    let worst = 0;
    for (let y = -3; y < 3; y += 0.25) {
      let prev = simplex2(77, -3, y);
      for (let x = -2.998; x < 3; x += 0.002) {
        const cur = simplex2(77, x, y);
        worst = Math.max(worst, Math.abs(cur - prev));
        prev = cur;
      }
    }
    // A continuous field sampled at Δ=0.002 must move tiny amounts.
    expect(worst).toBeLessThan(0.12);
  });

  it('fbm is finite and bounded', () => {
    for (let i = 0; i < 200; i++) {
      const v = fbm(123, i * 0.37, i * -0.21);
      expect(Number.isFinite(v)).toBe(true);
      expect(Math.abs(v)).toBeLessThanOrEqual(1.05);
    }
  });
});

describe('terrain generation', () => {
  const gen = new WorldGen(defaultWorldConfig(4242));

  it('is deterministic for the same seed', () => {
    const gen2 = new WorldGen(defaultWorldConfig(4242));
    for (let i = 0; i < 300; i++) {
      const x = (i * 97) % 4000 - 2000;
      const z = (i * 57) % 4000 - 2000;
      expect(gen.height(x, z)).toBeCloseTo(gen2.height(x, z), 8);
    }
  });

  it('produces different worlds for different seeds', () => {
    const a = new WorldGen(defaultWorldConfig(1));
    const b = new WorldGen(defaultWorldConfig(999983));
    let totalDiff = 0;
    for (let i = 0; i < 200; i++) {
      const x = (i * 37) % 3000 - 1500;
      const z = (i * 53) % 3000 - 1500;
      totalDiff += Math.abs(a.height(x, z) - b.height(x, z));
    }
    expect(totalDiff / 200).toBeGreaterThan(2);
  });

  it('heights are finite and within plausible bounds', () => {
    for (let i = 0; i < 500; i++) {
      const h = gen.height(i * 13.7 - 3000, i * -7.3 + 2000);
      expect(Number.isFinite(h)).toBe(true);
      expect(h).toBeGreaterThan(-120);
      expect(h).toBeLessThan(600);
    }
  });

  it('neighbouring samples are continuous (no cliffs from seams)', () => {
    let maxJump = 0;
    for (let z = -400; z <= 400; z += 4) {
      let prev = gen.height(-400, z);
      for (let x = -396; x <= 400; x += 4) {
        const h = gen.height(x, z);
        maxJump = Math.max(maxJump, Math.abs(h - prev));
        prev = h;
      }
    }
    // 4 m steps: even mountains shouldn't jump 40 m per step.
    expect(maxJump).toBeLessThan(40);
  });

  it('a land-rich mix of biomes exists in a 4 km window', () => {
    const biomes = new Set<string>();
    let land = 0;
    let water = 0;
    for (let z = -2000; z <= 2000; z += 100) {
      for (let x = -2000; x <= 2000; x += 100) {
        const s = gen.sample(x, z);
        biomes.add(s.biome);
        if (s.height < SEA_LEVEL - 0.5) water++;
        else land++;
      }
    }
    expect(biomes.size).toBeGreaterThanOrEqual(4);
    expect(land).toBeGreaterThan(water * 0.5); // not an ocean world
  });

  it('chunk geometry is seamless with its neighbours', () => {
    const a = buildTerrainGeometry(gen, 0, 0);
    const b = buildTerrainGeometry(gen, 1, 0);
    const posA = a.getAttribute('position');
    const posB = b.getAttribute('position');
    const n = Math.sqrt(posA.count); // 65
    // Right edge of chunk (0,0) vs left edge of chunk (1,0)
    for (let iz = 0; iz < n; iz++) {
      const rightIdx = iz * n + (n - 1);
      const leftIdx = iz * n;
      const ax = posA.getX(rightIdx); // local x in chunk (0,0) → world = ax
      const ay = posA.getY(rightIdx);
      const bx = posB.getX(leftIdx) + CHUNK_SIZE; // local x in chunk (1,0) → world
      const by = posB.getY(leftIdx);
      expect(ay).toBeCloseTo(by, 4);
      expect(ax).toBeCloseTo(bx, 4);
    }
    a.dispose();
    b.dispose();
  });
});

describe('terrain edits', () => {
  it('raise/lower brushes change height and persist through serialization', () => {
    const gen = new WorldGen(defaultWorldConfig(7));
    const base = gen.height(100, 100);
    gen.edits.applyBrush(100, 100, 10, 2, 'raise', (x, z) => gen.baseHeight(x, z));
    const raised = gen.height(100, 100);
    expect(raised).toBeGreaterThan(base + 0.8);

    const serialized = gen.edits.serialize();
    const restored = TerrainEdits.deserialize(serialized);
    const gen2 = new WorldGen(defaultWorldConfig(7), restored);
    expect(gen2.height(100, 100)).toBeCloseTo(raised, 3);
  });

  it('lower brush digs down and smooth keeps surface continuous', () => {
    const gen = new WorldGen(defaultWorldConfig(7));
    gen.edits.applyBrush(50, 50, 8, 1.5, 'lower', (x, z) => gen.baseHeight(x, z));
    expect(gen.height(50, 50)).toBeLessThan(gen.baseHeight(50, 50));
    // Continuity across the edited area
    let prev = gen.height(30, 50);
    for (let x = 32; x <= 70; x += 2) {
      const h = gen.height(x, 50);
      expect(Math.abs(h - prev)).toBeLessThan(3);
      prev = h;
    }
  });
});
