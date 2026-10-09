/**
 * Acceptance probe: settlement composition survey across seeds.
 * Run: npx vite-node scripts/presettle.ts
 */
import { WorldGen } from '../src/world/worldGen.ts';
import { Hydrology } from '../src/world/hydrology.ts';
import { defaultWorldConfig } from '../src/world/types.ts';
import { createBuildingMaterials } from '../src/sim/buildings.ts';
import { generateSettlement, scoreSettlementSite, resetSettlementIds } from '../src/sim/settlements.ts';

const mats = createBuildingMaterials();
const seeds = [1, 42, 777, 20250101, 424242];

for (const seed of seeds) {
  resetSettlementIds();
  const gen = new WorldGen(defaultWorldConfig(seed));
  const hydro = new Hydrology(gen);

  let best = { score: -1, x: 0, z: 0 };
  for (let z = -500; z <= 500; z += 125) {
    for (let x = -500; x <= 500; x += 125) {
      const s = scoreSettlementSite(gen, hydro, x, z);
      if (s > best.score) best = { score: s, x, z };
    }
  }
  const bundle = generateSettlement(gen, hydro, mats, best.x, best.z, 0);
  const rec = bundle.record;
  const byType: Record<string, number> = {};
  for (const b of rec.buildings) byType[b.type] = (byType[b.type] ?? 0) + 1;
  console.log(
    `seed=${seed} site=(${best.x},${best.z}) score=${best.score.toFixed(2)} ` +
    `buildings=${rec.buildings.length} roads=${rec.roads.length} ` +
    `docks=${byType.dock ?? 0} fields=${byType.field ?? 0} names="${rec.name}"`,
    byType,
  );
}
