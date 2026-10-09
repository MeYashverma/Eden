/**
 * Acceptance probe: hydrology warm-up metrics (water volume, quality).
 * Run: npx vite-node scripts/prewater.ts
 */
import { WorldGen } from '../src/world/worldGen.ts';
import { Hydrology, HYDRO_N } from '../src/world/hydrology.ts';
import { defaultWorldConfig, SEA_LEVEL } from '../src/world/types.ts';

const seed = Number(process.argv[2] ?? 99);
const gen = new WorldGen(defaultWorldConfig(seed));
const hydro = new Hydrology(gen);

hydro.recenter(0, 0, true);
for (let i = 0; i < 60; i++) hydro.step(0.5, 2, 1.2);

let cells = 0, qualitySum = 0;
for (let iz = 0; iz < HYDRO_N; iz++) {
  for (let ix = 0; ix < HYDRO_N; ix++) {
    const w = hydro.water[iz * HYDRO_N + ix];
    if (w > 0.02) {
      cells++;
      qualitySum += hydro.quality[iz * HYDRO_N + ix];
    }
  }
}
console.log(`seed=${seed} totalWater=${hydro.totalWater.toFixed(1)} m³  wetCells=${cells}  meanQuality=${cells ? (qualitySum / cells).toFixed(2) : 'n/a'}`);

// Drought response
hydro.waterBalance = 0.25;
const before = hydro.totalWater;
for (let i = 0; i < 120; i++) hydro.step(0.5, 2, 0);
console.log(`after drought steps: water ${before.toFixed(1)} → ${hydro.totalWater.toFixed(1)} (balance=${hydro.waterBalance.toFixed(2)})`);

// Sea level sanity around origin
let below = 0, total = 0;
for (let z = -400; z <= 400; z += 20) {
  for (let x = -400; x <= 400; x += 20) {
    total++;
    if (gen.height(x, z) < SEA_LEVEL) below++;
  }
}
console.log(`origin window: ${(100 * below / total).toFixed(0)}% below sea level`);
