/**
 * Deterministic procedural world generation.
 *
 * The terrain is a pure function of (seed, x, z) composed of:
 *   - a continental mask (domain-warped low-frequency noise) shaping oceans,
 *   - plains / hills / ridged mountain ranges masked by continent structure,
 *   - shallow lake basins,
 *   - river channels carved from a regional drainage graph (flow accumulation).
 *
 * Chunk meshes, physics, vegetation and the map all sample this same function,
 * so neighbouring chunks are inherently seamless and the same seed always
 * produces the same world.
 */

import { fbm, ridged, warpedFbm, billow, smoothstep, clamp, lerp, simplex2 } from '../core/noise';
import { hashCombine } from '../core/rng';
import { SEA_LEVEL, type BiomeId, type EnvironmentalSample, type WorldGenConfig } from './types';
import { TerrainEdits } from './terrainEdits';

/** Drainage regions are 2048 m tiles; flow accumulation runs on a 32 m grid. */
const REGION_SIZE = 2048;
const DRAIN_CELL = 32;
const DRAIN_N = REGION_SIZE / DRAIN_CELL; // 64
const DRAIN_MARGIN = 4;

interface DrainageRegion {
  rx: number;
  rz: number;
  /** flow accumulation per cell, grid (N+2M)^2 */
  acc: Float32Array;
  /** base terrain height per cell (for slope-aware routing) */
  height: Float32Array;
  lastUsed: number;
}

export class WorldGen {
  readonly config: WorldGenConfig;
  readonly edits: TerrainEdits;
  private regions = new Map<string, DrainageRegion>();
  private useCounter = 0;
  /** River threshold in accumulated upstream cells. */
  private readonly riverThreshold: number;

  constructor(config: WorldGenConfig, edits?: TerrainEdits) {
    this.config = config;
    this.edits = edits ?? new TerrainEdits();
    this.riverThreshold = lerp(90, 28, clamp((config.waterAbundance - 0.4) / 1.2, 0, 1));
  }

  // ---------------------------------------------------------------- terrain

  /** Base terrain height (metres) before player edits. Sea level is y = 0. */
  baseHeight(x: number, z: number): number {
    let h = this.baseHeightNoRivers(x, z);
    // River carving from drainage accumulation.
    const river = this.riverMask(x, z);
    if (river > 0.003) {
      const carve = Math.pow(river, 1.35) * (2.2 + 4.5 * river);
      const hills = warpedFbm(this.config.seed + 37, (x * this.config.terrainScale) / 820, (z * this.config.terrainScale) / 820, 0.5, { octaves: 5 }) * 26;
      const flatness = 1 - smoothstep(0.05, 0.35, Math.abs(hills) / 26);
      h -= carve * (0.65 + 0.35 * flatness);
    }
    return h;
  }

  /** Full composed height including player edits. */
  height(x: number, z: number): number {
    return this.baseHeight(x, z) + this.edits.deltaAt(x, z);
  }

  /** Cheap approximate slope 0..1 from finite differences of composed height. */
  slope(x: number, z: number, eps = 2): number {
    const hL = this.height(x - eps, z);
    const hR = this.height(x + eps, z);
    const hD = this.height(x, z - eps);
    const hU = this.height(x, z + eps);
    const dx = (hR - hL) / (2 * eps);
    const dz = (hU - hD) / (2 * eps);
    return clamp(Math.sqrt(dx * dx + dz * dz) / 1.6, 0, 1);
  }

  // ------------------------------------------------------------- drainage

  private regionFor(rx: number, rz: number): DrainageRegion {
    const key = `${rx},${rz}`;
    let region = this.regions.get(key);
    if (region) {
      region.lastUsed = ++this.useCounter;
      return region;
    }

    const n = DRAIN_N + DRAIN_MARGIN * 2;
    const heights = new Float32Array(n * n);
    const acc = new Float32Array(n * n);
    const ox = rx * REGION_SIZE - DRAIN_MARGIN * DRAIN_CELL;
    const oz = rz * REGION_SIZE - DRAIN_MARGIN * DRAIN_CELL;

    // Sample base heights (without river carving — carving depends on acc).
    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) {
        heights[iz * n + ix] = this.baseHeightNoRivers(ox + ix * DRAIN_CELL, oz + iz * DRAIN_CELL);
      }
    }

    // D8 flow accumulation: process cells from high to low.
    const order = new Int32Array(n * n);
    for (let i = 0; i < n * n; i++) {
      order[i] = i;
      acc[i] = 1;
    }
    const orderArr = Array.from(order);
    orderArr.sort((a, b) => heights[b] - heights[a]);

    const nbs = [
      [-1, 0], [1, 0], [0, -1], [0, 1],
      [-1, -1], [1, -1], [-1, 1], [1, 1],
    ];

    for (const cell of orderArr) {
      const ix = cell % n;
      const iz = (cell / n) | 0;
      const h = heights[cell];
      let best = -1;
      let bestDrop = 0;
      for (const [dx, dz] of nbs) {
        const jx = ix + dx;
        const jz = iz + dz;
        if (jx < 0 || jz < 0 || jx >= n || jz >= n) continue;
        const drop = h - heights[jz * n + jx];
        const dist = Math.sqrt(dx * dx + dz * dz) * DRAIN_CELL;
        const grade = drop / dist;
        if (grade > bestDrop) {
          bestDrop = grade;
          best = jz * n + jx;
        }
      }
      if (best >= 0) acc[best] += acc[cell];
    }

    region = { rx, rz, acc, height: heights, lastUsed: ++this.useCounter };
    this.regions.set(key, region);
    if (this.regions.size > 8) {
      // evict least recently used
      let oldest: DrainageRegion | null = null;
      for (const r of this.regions.values()) {
        if (!oldest || r.lastUsed < oldest.lastUsed) oldest = r;
      }
      if (oldest) this.regions.delete(`${oldest.rx},${oldest.rz}`);
    }
    return region;
  }

  /** Height without river carving — used by the drainage solver to avoid a cycle. */
  private baseHeightNoRivers(x: number, z: number): number {
    const c = this.config;
    const s = c.seed;
    const sc = c.terrainScale;
    const nx = (x * sc) / 6000;
    const nz = (z * sc) / 6000;
    // Continental mask — decides where oceans and large landmasses live.
    // Biased toward land (~60/40 land/sea) so exploration is land-rich while
    // keeping real coasts, archipelagos and ocean basins.
    const cont = warpedFbm(s + 11, nx, nz, 0.42, { octaves: 4, frequency: 1 }) * 1.12 + 0.22;
    const land = smoothstep(-0.3, 0.26, cont);
    const plains = fbm(s + 23, (x * sc) / 2600, (z * sc) / 2600, { octaves: 4 }) * 38;
    const hills = warpedFbm(s + 37, (x * sc) / 820, (z * sc) / 820, 0.5, { octaves: 5 }) * 26;
    const rangeMask = smoothstep(0.02, 0.3, warpedFbm(s + 53, (x * sc) / 3900, (z * sc) / 3900, 0.35, { octaves: 3 }));
    const ridge = ridged(s + 71, (x * sc) / 1450, (z * sc) / 1450, { octaves: 5, gain: 0.48 });
    const mountains = Math.pow(ridge, 1.45) * 330 * rangeMask * c.mountainIntensity;
    const flatness = 1 - smoothstep(0.05, 0.35, Math.abs(hills) / 26);
    const lakeField = smoothstep(0.5, 0.8, billow(s + 97, (x * sc) / 1650, (z * sc) / 1650, { octaves: 3 }));
    const lakeBasin = lakeField * flatness * land * 8.5;
    let h = -62 + land * 72 + (plains + hills) * land + mountains;
    const coast = smoothstep(-0.45, 0.02, cont);
    h = lerp(-62 + cont * 16, h, coast);
    h -= lakeBasin;
    return h;
  }

  /** 0..1 river strength. Values > 0 mean a channel crosses this point. */
  riverMask(x: number, z: number): number {
    const rx = Math.floor(x / REGION_SIZE);
    const rz = Math.floor(z / REGION_SIZE);
    const region = this.regionFor(rx, rz);
    const n = DRAIN_N + DRAIN_MARGIN * 2;
    const fx = (x - (rx * REGION_SIZE - DRAIN_MARGIN * DRAIN_CELL)) / DRAIN_CELL;
    const fz = (z - (rz * REGION_SIZE - DRAIN_MARGIN * DRAIN_CELL)) / DRAIN_CELL;
    const ix = clamp(Math.floor(fx), 0, n - 2);
    const iz = clamp(Math.floor(fz), 0, n - 2);
    const tx = clamp(fx - ix, 0, 1);
    const tz = clamp(fz - iz, 0, 1);
    const a00 = region.acc[iz * n + ix];
    const a10 = region.acc[iz * n + ix + 1];
    const a01 = region.acc[(iz + 1) * n + ix];
    const a11 = region.acc[(iz + 1) * n + ix + 1];
    const acc = a00 * (1 - tx) * (1 - tz) + a10 * tx * (1 - tz) + a01 * (1 - tx) * tz + a11 * tx * tz;
    return smoothstep(this.riverThreshold * 0.75, this.riverThreshold * 5.5, acc);
  }

  /** Approximate upstream accumulation at a point (for stats / fishing quality). */
  flowAccumulation(x: number, z: number): number {
    const rx = Math.floor(x / REGION_SIZE);
    const rz = Math.floor(z / REGION_SIZE);
    const region = this.regionFor(rx, rz);
    const n = DRAIN_N + DRAIN_MARGIN * 2;
    const fx = (x - (rx * REGION_SIZE - DRAIN_MARGIN * DRAIN_CELL)) / DRAIN_CELL;
    const fz = (z - (rz * REGION_SIZE - DRAIN_MARGIN * DRAIN_CELL)) / DRAIN_CELL;
    const ix = clamp(Math.round(fx), 0, n - 1);
    const iz = clamp(Math.round(fz), 0, n - 1);
    return region.acc[iz * n + ix];
  }

  // --------------------------------------------------------------- climate

  /** Air temperature in °C at (x,z) for a given world-time hour-of-year phase. */
  temperatureAt(x: number, z: number, height: number, seasonPhase: number, dayWarmth = 0): number {
    // Pseudo-latitude from z: 0 at origin → colder toward ±12 km.
    const lat = Math.abs(z * this.config.terrainScale) / 12000;
    const base = lerp(22, -14, lat) + this.config.climate * 8;
    const seasonal = Math.cos(seasonPhase * Math.PI * 2) * -1; // winter at phase 0.5 handled by caller
    const lapse = -height * 0.021;
    return base + seasonal * 9 + lapse + dayWarmth;
  }

  /** Annual phase 0..1 → season. 0 = spring. */
  static seasonFromPhase(phase: number): 'spring' | 'summer' | 'autumn' | 'winter' {
    const p = ((phase % 1) + 1) % 1;
    if (p < 0.25) return 'spring';
    if (p < 0.5) return 'summer';
    if (p < 0.75) return 'autumn';
    return 'winter';
  }

  /** Soil moisture 0..1 — feeds vegetation, farming and fire risk. */
  moistureAt(x: number, z: number, height: number, rainfall = 1): number {
    const wetNoise = fbm(this.config.seed + 211, x / 2100, z / 2100, { octaves: 4 }) * 0.5 + 0.5;
    const river = this.riverMask(x, z);
    const belowSea = smoothstep(3, -6, height);
    const wet = clamp(wetNoise * 0.55 + river * 0.7 + belowSea * 0.6, 0, 1);
    return clamp(wet * (0.55 + 0.45 * rainfall), 0, 1);
  }

  /** Full environmental sample used by vegetation, AI, farming and UI. */
  sample(x: number, z: number, seasonPhase = 0.3, rainfall = 1): EnvironmentalSample {
    const height = this.height(x, z);
    const slope = this.slope(x, z);
    const moisture = this.moistureAt(x, z, height, rainfall);
    const temperature = this.temperatureAt(x, z, height, seasonPhase);
    const flow = this.riverMask(x, z);
    const biome = WorldGen.classifyBiome(height, slope, moisture, temperature, flow);
    const fertility = clamp(moisture * 0.6 + (1 - slope) * 0.4 - Math.max(0, temperature - 34) * 0.02, 0, 1);
    return {
      height,
      slope,
      temperature,
      moisture,
      waterDepth: Math.max(0, SEA_LEVEL - height), // ocean depth only; hydrology adds fresh water
      flow,
      biome,
      fertility,
    };
  }

  static classifyBiome(
    height: number,
    slope: number,
    moisture: number,
    temperature: number,
    flow: number,
  ): BiomeId {
    if (height < SEA_LEVEL - 14) return 'deep_ocean';
    if (height < SEA_LEVEL - 0.6) return 'shallow_ocean';
    if (height < SEA_LEVEL + 1.6) return moisture > 0.62 && flow > 0.05 ? 'wetland' : 'beach';
    if (height > 150 || (height > 110 && slope > 0.5)) return 'alpine';
    if (temperature < -5) return slope > 0.42 ? 'alpine' : 'tundra';
    if (temperature > 21 && moisture < 0.3) return 'desert';
    if (moisture > 0.78 && slope < 0.3) return 'wetland';
    if (temperature > 19 && moisture > 0.55) return 'tropical_forest';
    if (temperature < 3 && moisture > 0.38) return 'boreal_forest';
    if (moisture > 0.62) return 'dense_woodland';
    if (moisture > 0.42) return 'temperate_forest';
    return 'grassland';
  }

  // ------------------------------------------------------------ placement

  /**
   * Deterministic scatter of a feature type inside a chunk via rejection
   * sampling. Returns positions in world space with per-item random values.
   */
  scatter(
    cx: number,
    cz: number,
    chunkSize: number,
    count: number,
    salt: number,
    accept: (x: number, z: number, h: number, slope: number, r: number) => boolean,
  ): Array<{ x: number; z: number; h: number; r: number }> {
    const out: Array<{ x: number; z: number; h: number; r: number }> = [];
    const ox = cx * chunkSize;
    const oz = cz * chunkSize;
    for (let i = 0; i < count; i++) {
      const h1 = hashCombine(this.config.seed, cx, cz, salt, i) / 4294967296;
      const h2 = hashCombine(this.config.seed, cx, cz, salt, i + 1013) / 4294967296;
      const h3 = hashCombine(this.config.seed, cx, cz, salt, i + 7919) / 4294967296;
      const x = ox + h1 * chunkSize;
      const z = oz + h2 * chunkSize;
      const h = this.height(x, z);
      const s = this.slope(x, z);
      if (accept(x, z, h, s, h3)) out.push({ x, z, h, r: h3 });
    }
    return out;
  }

  /** Vegetation noise — large-scale forest density variation 0..1. */
  forestDensity(x: number, z: number): number {
    return fbm(this.config.seed + 313, x / 900, z / 900, { octaves: 4 }) * 0.5 + 0.5;
  }

  /** Small-scale positional variation for texture / tint breakup. */
  microVariation(x: number, z: number, freq = 0.15): number {
    return simplex2(this.config.seed + 907, x * freq, z * freq);
  }
}
