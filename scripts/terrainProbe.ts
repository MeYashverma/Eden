/** Quick terrain tuning probe (not part of the game). Run: node --experimental-strip-types scripts/terrainProbe.ts */
import { WorldGen } from '../src/world/worldGen.ts';
import { defaultWorldConfig } from '../src/world/types.ts';

const gen = new WorldGen(defaultWorldConfig(12345));

const stats = {
  min: 1e9, max: -1e9, sum: 0, n: 0,
  ocean: 0, beach: 0, land: 0, mountain: 0, river: 0, lake: 0,
};
const biomes: Record<string, number> = {};
let prevH: number[] = [];
let roughSum = 0;

for (let z = -2000; z <= 2000; z += 40) {
  for (let x = -2000; x <= 2000; x += 40) {
    const h = gen.height(x, z);
    stats.min = Math.min(stats.min, h);
    stats.max = Math.max(stats.max, h);
    stats.sum += h;
    stats.n++;
    if (h < -0.5) stats.ocean++;
    else if (h < 1.5) stats.beach++;
    else if (h > 150) stats.mountain++;
    else stats.land++;
    const r = gen.riverMask(x, z);
    if (r > 0.05) stats.river++;
    const s = gen.sample(x, z);
    biomes[s.biome] = (biomes[s.biome] ?? 0) + 1;
  }
}

console.log('height  min/mean/max:', stats.min.toFixed(1), (stats.sum / stats.n).toFixed(1), stats.max.toFixed(1));
console.log('coverage ocean/beach/land/mountain:', stats.ocean, stats.beach, stats.land, stats.mountain);
console.log('river cells:', stats.river, '/', stats.n);
console.log('biomes:', biomes);

// Continuity check: height delta between 2m neighbours should be modest on average
let maxJump = 0, jumpSum = 0, jumpN = 0;
for (let z = -500; z <= 500; z += 2) {
  let last = gen.height(-500, z);
  for (let x = -498; x <= 500; x += 2) {
    const h = gen.height(x, z);
    const d = Math.abs(h - last);
    maxJump = Math.max(maxJump, d);
    jumpSum += d; jumpN++;
    last = h;
  }
}
console.log('neighbour height delta avg/max (2m):', (jumpSum / jumpN).toFixed(3), maxJump.toFixed(2));

// Seed variation check
const gen2 = new WorldGen(defaultWorldConfig(999));
let diff = 0;
for (let i = 0; i < 200; i++) {
  const x = (i * 37) % 2000 - 1000, z = (i * 53) % 2000 - 1000;
  diff += Math.abs(gen.height(x, z) - gen2.height(x, z));
}
console.log('avg |Δh| between seeds:', (diff / 200).toFixed(2));
