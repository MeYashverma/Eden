/**
 * Coarse hydrological simulation (simplified virtual-pipe model).
 *
 * A moving grid of 16 m cells around the player stores standing-water depth.
 * Each step routes water downhill into neighbouring cells, so rivers run,
 * rain fills depressions into lakes, excavations flood, dams back water up,
 * and droughts dry channels out. A warm-up pass at world start settles the
 * network so a new world already has believable rivers and lakes.
 *
 * This is an approximation of fluid dynamics — mass-conserving shallow flow,
 * not a full Navier–Stokes solve — and is documented as such.
 */

import { clamp, smoothstep } from '../core/noise';
import { SEA_LEVEL } from './types';
import type { WorldGen } from './worldGen';

export const HYDRO_CELL = 16;
export const HYDRO_N = 112; // 112 × 16 m = 1792 m window

export interface HydrologyState {
  water: Float32Array;
  quality: Float32Array;
  ox: number;
  oz: number;
}

export class Hydrology {
  readonly gen: WorldGen;
  water = new Float32Array(HYDRO_N * HYDRO_N);
  quality = new Float32Array(HYDRO_N * HYDRO_N).fill(1);
  private inflow = new Float32Array(HYDRO_N * HYDRO_N);
  private terrain = new Float32Array(HYDRO_N * HYDRO_N);
  private wetCount = 0;
  /** world coords of cell (0,0) centre */
  ox = 0;
  oz = 0;
  /** global modifier: 1 = normal, <1 drought, >1 flood conditions */
  waterBalance = 1;
  /** total metres of water currently in the window (for stats) */
  totalWater = 0;
  averageQuality = 1;

  constructor(gen: WorldGen) {
    this.gen = gen;
    this.recenter(0, 0, true);
  }

  /** Move the simulation window to keep (x,z) near the centre. */
  recenter(x: number, z: number, force = false): void {
    const targetOx = Math.floor(x / HYDRO_CELL) * HYDRO_CELL - ((HYDRO_N / 2) | 0) * HYDRO_CELL;
    const targetOz = Math.floor(z / HYDRO_CELL) * HYDRO_CELL - ((HYDRO_N / 2) | 0) * HYDRO_CELL;
    const dx = Math.round((targetOx - this.ox) / HYDRO_CELL);
    const dz = Math.round((targetOz - this.oz) / HYDRO_CELL);
    if (!force && dx === 0 && dz === 0) return;

    const newWater = new Float32Array(HYDRO_N * HYDRO_N);
    const newQuality = new Float32Array(HYDRO_N * HYDRO_N).fill(1);
    for (let iz = 0; iz < HYDRO_N; iz++) {
      const sz = iz - dz;
      for (let ix = 0; ix < HYDRO_N; ix++) {
        const sx = ix - dx;
        if (sx >= 0 && sz >= 0 && sx < HYDRO_N && sz < HYDRO_N) {
          newWater[iz * HYDRO_N + ix] = this.water[sz * HYDRO_N + sx];
          newQuality[iz * HYDRO_N + ix] = this.quality[sz * HYDRO_N + sx];
        } else {
          // New cells inherit the settled river/ocean baseline immediately.
          const wx = targetOx + ix * HYDRO_CELL;
          const wz = targetOz + iz * HYDRO_CELL;
          const t = this.gen.height(wx, wz);
          const river = this.gen.riverMask(wx, wz);
          let w = 0;
          if (t < SEA_LEVEL) w = SEA_LEVEL - t;
          else if (river > 0.02) w = Math.max(0, river * 2.4 - 0.12) * this.waterBalance;
          newWater[iz * HYDRO_N + ix] = w;
        }
      }
    }
    this.water = newWater;
    this.quality = newQuality;
    this.ox = targetOx;
    this.oz = targetOz;
    this.rebuildTerrainCache();
  }

  private rebuildTerrainCache(): void {
    for (let iz = 0; iz < HYDRO_N; iz++) {
      for (let ix = 0; ix < HYDRO_N; ix++) {
        this.terrain[iz * HYDRO_N + ix] = this.gen.height(
          this.ox + ix * HYDRO_CELL,
          this.oz + iz * HYDRO_CELL,
        );
      }
    }
  }

  /** Refresh cached terrain after the player edits heights in this window. */
  invalidateTerrain(x0: number, z0: number, x1: number, z1: number): void {
    const ix0 = clamp(Math.floor((x0 - this.ox) / HYDRO_CELL), 0, HYDRO_N - 1);
    const iz0 = clamp(Math.floor((z0 - this.oz) / HYDRO_CELL), 0, HYDRO_N - 1);
    const ix1 = clamp(Math.ceil((x1 - this.ox) / HYDRO_CELL), 0, HYDRO_N - 1);
    const iz1 = clamp(Math.ceil((z1 - this.oz) / HYDRO_CELL), 0, HYDRO_N - 1);
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        this.terrain[iz * HYDRO_N + ix] = this.gen.height(
          this.ox + ix * HYDRO_CELL,
          this.oz + iz * HYDRO_CELL,
        );
      }
    }
  }

  private cellAt(x: number, z: number): number {
    const ix = clamp(Math.round((x - this.ox) / HYDRO_CELL), 0, HYDRO_N - 1);
    const iz = clamp(Math.round((z - this.oz) / HYDRO_CELL), 0, HYDRO_N - 1);
    return iz * HYDRO_N + ix;
  }

  /**
   * Advance the simulation.
   * @param dtReal real seconds
   * @param hoursPerSecond current time-compression (game hours per real second)
   * @param rainfall 0..1 from weather
   */
  step(dtReal: number, hoursPerSecond: number, rainfall: number): void {
    const dtH = Math.min(0.5, dtReal * hoursPerSecond); // game hours, clamped
    const n = HYDRO_N;
    const inflow = this.inflow;
    inflow.fill(0);

    const rainM = rainfall * 0.012 * this.waterBalance * dtH; // metres per game hour
    const evapM = 0.004 * dtH;

    for (let iz = 1; iz < n - 1; iz++) {
      for (let ix = 1; ix < n - 1; ix++) {
        const i = iz * n + ix;
        const t = this.terrain[i];
        let w = this.water[i];

        // Ocean cells stay pinned to sea level.
        if (t < SEA_LEVEL - 0.15) {
          this.water[i] = SEA_LEVEL - t;
          continue;
        }

        // Rainfall + river headwater feed − evaporation.
        w += rainM * (1 + this.gen.riverMask(this.ox + ix * HYDRO_CELL, this.oz + iz * HYDRO_CELL) * 2);
        if (this.waterBalance > 1) w += (this.waterBalance - 1) * 0.01 * dtH;
        w -= evapM * (1 - smoothstep(0, 0.5, w) * 0.4);
        if (w <= 0) {
          this.water[i] = 0;
          continue;
        }

        // Distribute outflow downhill.
        const hI = t + w;
        let out0 = Math.max(0, hI - (this.terrain[i - 1] + this.water[i - 1]));
        let out1 = Math.max(0, hI - (this.terrain[i + 1] + this.water[i + 1]));
        let out2 = Math.max(0, hI - (this.terrain[i - n] + this.water[i - n]));
        let out3 = Math.max(0, hI - (this.terrain[i + n] + this.water[i + n]));
        const total = out0 + out1 + out2 + out3;
        if (total > 1e-5) {
          // Stability: move at most half the cell's water per step.
          const scale = Math.min(0.5, w * 0.5 / total) * total;
          const s = scale / total;
          out0 *= s; out1 *= s; out2 *= s; out3 *= s;
          const moved = out0 + out1 + out2 + out3;
          this.water[i] = w - moved;
          inflow[i - 1] += out0;
          inflow[i + 1] += out1;
          inflow[i - n] += out2;
          inflow[i + n] += out3;
        } else {
          this.water[i] = w;
        }
      }
    }

    // Apply inflows + quality diffusion (quality mixes with neighbours slowly).
    let wet = 0;
    let totalW = 0;
    let qSum = 0;
    for (let i = 0; i < n * n; i++) {
      const w = this.water[i] + inflow[i];
      this.water[i] = w;
      if (w > 0.02) {
        wet++;
        totalW += w;
        // Quality: slowly recovers toward clean, faster when water is flowing.
        const q = this.quality[i];
        this.quality[i] = clamp(q + (1 - q) * 0.02 * dtH * (1 + Math.min(2, inflow[i] * 30)), 0, 1);
        qSum += this.quality[i];
      }
    }
    this.wetCount = wet;
    this.totalWater = totalW;
    this.averageQuality = wet > 0 ? qSum / wet : 1;
  }

  /** Settle the network so a freshly generated world already has rivers/lakes. */
  warmup(iterations = 240): void {
    for (let i = 0; i < iterations; i++) {
      this.step(0.25, 1, 0.55);
    }
  }

  /** Water surface height (world Y) or null if dry. */
  surfaceAt(x: number, z: number): number | null {
    const ix = clamp(Math.round((x - this.ox) / HYDRO_CELL), 0, HYDRO_N - 1);
    const iz = clamp(Math.round((z - this.oz) / HYDRO_CELL), 0, HYDRO_N - 1);
    const i = iz * HYDRO_N + ix;
    const t = this.gen.height(x, z); // composed height includes edits
    if (t < SEA_LEVEL) return SEA_LEVEL;
    const w = this.water[i];
    // River channels always carry some water unless drought has set in.
    const river = this.gen.riverMask(x, z) * clamp(this.waterBalance, 0.15, 1);
    const channelW = river > 0.02 ? Math.max(0, river * 2.4 - 0.12) : 0;
    const depth = Math.max(w, channelW);
    if (depth < 0.05) return null;
    // Surface sits above the *local* channel floor, not the 16 m cell average.
    return t + Math.max(0.12, depth);
  }

  depthAt(x: number, z: number): number {
    const s = this.surfaceAt(x, z);
    if (s === null) return 0;
    return Math.max(0, s - this.gen.height(x, z));
  }

  isWater(x: number, z: number): boolean {
    return this.surfaceAt(x, z) !== null;
  }

  qualityAt(x: number, z: number): number {
    const i = this.cellAt(x, z);
    return this.quality[i];
  }

  /** Pollute a region (industry, floods carrying waste). */
  pollute(x: number, z: number, radius: number, amount: number): void {
    const r = Math.ceil(radius / HYDRO_CELL);
    const cx = clamp(Math.round((x - this.ox) / HYDRO_CELL), r, HYDRO_N - 1 - r);
    const cz = clamp(Math.round((z - this.oz) / HYDRO_CELL), r, HYDRO_N - 1 - r);
    for (let iz = cz - r; iz <= cz + r; iz++) {
      for (let ix = cx - r; ix <= cx + r; ix++) {
        const i = iz * HYDRO_N + ix;
        this.quality[i] = clamp(this.quality[i] - amount, 0, 1);
      }
    }
  }

  /** Dump water into a cell (player dam break, flood event, waterfall). */
  addWater(x: number, z: number, metres: number): void {
    const i = this.cellAt(x, z);
    this.water[i] = Math.max(0, this.water[i] + metres);
  }

  serialize(): HydrologyState {
    return { water: this.water.slice(), quality: this.quality.slice(), ox: this.ox, oz: this.oz };
  }

  restore(state: HydrologyState): void {
    this.water.set(state.water);
    this.quality.set(state.quality);
    this.ox = state.ox;
    this.oz = state.oz;
    this.rebuildTerrainCache();
  }
}
