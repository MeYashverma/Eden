/** Shared world types and constants. */

export const CHUNK_SIZE = 128; // metres per chunk edge
export const CHUNK_SEGMENTS = 64; // quads per edge → 2 m vertex spacing
export const SEA_LEVEL = 0;

export type BiomeId =
  | 'deep_ocean'
  | 'shallow_ocean'
  | 'beach'
  | 'wetland'
  | 'grassland'
  | 'temperate_forest'
  | 'dense_woodland'
  | 'tropical_forest'
  | 'boreal_forest'
  | 'tundra'
  | 'desert'
  | 'alpine'
  | 'river';

export interface WorldGenConfig {
  seed: number;
  /** Scales all terrain frequencies. 1 = default world size feel. */
  terrainScale: number;
  /** 0.4 (flat) … 1.6 (extreme mountains). */
  mountainIntensity: number;
  /** 0.4 (arid) … 1.6 (flood-prone). Controls rain, rivers, sea level. */
  waterAbundance: number;
  /** 0.2 … 1.8 multiplier on vegetation density. */
  forestDensity: number;
  /** 0.2 … 1.8 multiplier on animal spawn rates. */
  wildlifeAbundance: number;
  /** 0.2 … 1.8 multiplier on settlement frequency. */
  settlementDensity: number;
  /** 0.2 … 1.8 multiplier on resource deposit frequency. */
  resourceAbundance: number;
  /** −1 cold … +1 hot global climate bias. */
  climate: number;
}

export function defaultWorldConfig(seed: number): WorldGenConfig {
  return {
    seed,
    terrainScale: 1,
    mountainIntensity: 1,
    waterAbundance: 1,
    forestDensity: 1,
    wildlifeAbundance: 1,
    settlementDensity: 1,
    resourceAbundance: 1,
    climate: 0,
  };
}

export interface ChunkCoord {
  cx: number;
  cz: number;
}

export function chunkKey(cx: number, cz: number): string {
  return `${cx},${cz}`;
}

export interface EnvironmentalSample {
  height: number;
  slope: number; // 0..1
  temperature: number; // °C approximation
  moisture: number; // 0..1
  waterDepth: number; // metres of standing water at this point
  flow: number; // relative river flow (0..1)
  biome: BiomeId;
  fertility: number; // 0..1 soil fertility
}
