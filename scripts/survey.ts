/**
 * Acceptance probe: height histogram + biome coverage over a 4 km grid.
 * Run: npx vite-node scripts/survey.ts
 */
import { WorldGen } from '../src/world/worldGen.ts';
import { defaultWorldConfig, SEA_LEVEL } from '../src/world/types.ts';

const seed = Number(process.argv[2] ?? 12345);
const gen = new WorldGen(defaultWorldConfig(seed));

let min = Infinity, max = -Infinity, sum = 0, n = 0;
const bins: Record<string, number> = {};
const biomes: Record<string, number> = {};
let land = 0, water = 0;

for (let z = -2000; z <= 2000; z += 25) {
  for (let x = -2000; x <= 2000; x += 25) {
    const s = gen.sample(x, z);
    min = Math.min(min, s.height);
    max = Math.max(max, s.height);
    sum += s.height;
    n++;
    biomes[s.biome] = (biomes[s.biome] ?? 0) + 1;
    if (s.height < SEA_LEVEL - 0.5) water++; else land++;
    const b = Math.max(-100, Math.min(400, Math.round(s.height / 50) * 50));
    bins[b] = (bins[b] ?? 0) + 1;
  }
}

console.log(`seed=${seed}  min=${min.toFixed(1)}  max=${max.toFixed(1)}  mean=${(sum / n).toFixed(1)}`);
console.log(`land=${(100 * land / n).toFixed(1)}%  water=${(100 * water / n).toFixed(1)}%`);
console.log('biomes:', biomes);
console.log('histogram (50 m bins):');
for (const [h, c] of Object.entries(bins).sort((a, b) => Number(a[0]) - Number(b[0]))) {
  console.log(`  ${h.padStart(5)}m  ${'#'.repeat(Math.round((c / n) * 120))} ${c}`);
}
