/**
 * Discovery system: points of interest (ruins, caves, arches, cabins, lookouts)
 * placed deterministically from the world field. They appear on the map when
 * the player gets close enough to investigate them.
 */

import { seededRng, hashCombine } from './rng';
import type { WorldGen } from '../world/worldGen';
import type { Hydrology } from '../world/hydrology';
import { TAU, clamp } from './math';

export interface Discovery {
  id: string;
  kind: 'ruins' | 'cave' | 'arch' | 'cabin' | 'lookout' | 'grove' | 'springs' | 'shipwreck';
  name: string;
  x: number;
  z: number;
  day: number;
  note: string;
}

const KIND_LABELS: Record<Discovery['kind'], string[]> = {
  ruins: ['Forgotten Ruins', 'Crumbling Walls', 'Old Foundations'],
  cave: ['Shadowed Cave', 'Echoing Hollow', 'Deep Grotto'],
  arch: ['Stone Arch', 'Natural Bridge', 'Wind Arch'],
  cabin: ['Abandoned Cabin', 'Hermit\'s Hut', 'Forester\'s Cabin'],
  lookout: ['High Lookout', 'Eagle Point', 'Overlook'],
  grove: ['Ancient Grove', 'Old Growth Stand', 'Sacred Grove'],
  springs: ['Hidden Springs', 'Mineral Pools', 'Quiet Springs'],
  shipwreck: ['Weathered Wreck', 'Old Shipwreck', 'Broken Hull'],
};

const NOTES: Record<Discovery['kind'], string> = {
  ruins: 'Weathered stones hint at a settlement that time forgot.',
  cave: 'Cool air drifts from below. Strange marks pattern the entrance.',
  arch: 'Wind and water carved this span over centuries.',
  cabin: 'Someone once lived here. The hearth is cold.',
  lookout: 'The land unfolds for miles from this vantage.',
  grove: 'These trees are older than any living memory.',
  springs: 'Clear water wells up from deep below.',
  shipwreck: 'The sea gives back its dead slowly.',
};

/** Deterministically scatter POIs across a region around a point. */
export function findDiscoveries(
  gen: WorldGen,
  hydro: Hydrology,
  cx: number,
  cz: number,
  radius: number,
): Discovery[] {
  const out: Discovery[] = [];
  const rng = seededRng(gen.config.seed, Math.round(cx / 256), Math.round(cz / 256), 31337);
  const count = Math.floor(radius / 95);
  for (let i = 0; i < count; i++) {
    const angle = rng.range(0, TAU);
    const dist = rng.range(40, radius);
    const x = cx + Math.cos(angle) * dist;
    const z = cz + Math.sin(angle) * dist;
    const sample = gen.sample(x, z);

    let kind: Discovery['kind'] | null = null;
    if (sample.height < 1.2 && sample.height > -6 && (sample.biome === 'beach' || sample.biome === 'shallow_ocean')) {
      kind = 'shipwreck';
    } else if (sample.slope > 0.55 && sample.height > 60) {
      kind = rng.chance(0.5) ? 'cave' : 'lookout';
    } else if (sample.slope > 0.35 && sample.height > 25) {
      kind = 'arch';
    } else if (sample.biome === 'dense_woodland' || sample.biome === 'temperate_forest') {
      kind = rng.chance(0.45) ? 'grove' : rng.chance(0.5) ? 'cabin' : 'ruins';
    } else if (sample.moisture > 0.72) {
      kind = 'springs';
    } else if (sample.biome === 'grassland' && rng.chance(0.4)) {
      kind = 'ruins';
    }
    if (!kind) continue;

    const id = `poi-${hashCombine(gen.config.seed, Math.round(x), Math.round(z))}`;
    const names = KIND_LABELS[kind];
    out.push({
      id,
      kind,
      name: names[rng.int(0, names.length - 1)],
      x,
      z,
      day: 0,
      note: NOTES[kind],
    });
  }
  return out;
}

/** Check proximity and reveal undiscovered POIs. */
export function revealNearby(
  discoveries: Discovery[],
  playerX: number,
  playerZ: number,
  threshold = 28,
): Discovery[] {
  const found: Discovery[] = [];
  for (const d of discoveries) {
    if (d.day !== 0) continue;
    if (Math.hypot(d.x - playerX, d.z - playerZ) < threshold) {
      found.push(d);
    }
  }
  return found;
}
