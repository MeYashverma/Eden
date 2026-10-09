/**
 * Chunked terrain streaming.
 *
 * The world is an endless grid of CHUNK_SIZE tiles. Chunks generate on demand
 * around the player, are built off a budgeted queue (no generation spikes),
 * and unload when far away. A coarse "far ring" of large tiles carries the
 * landscape out to the horizon into the haze. Heights come from the shared
 * deterministic field, so seams always match and saves only store deltas.
 */

import * as THREE from 'three';
import { CHUNK_SIZE, CHUNK_SEGMENTS, SEA_LEVEL, type BiomeId } from './types';
import type { WorldGen } from './worldGen';
import type { Hydrology } from './hydrology';
import { clamp, lerp, smoothstep, posHash01 } from '../core/math';
import { simplex2 } from '../core/noise';

export interface ChunkMeshBundle {
  cx: number;
  cz: number;
  terrain: THREE.Mesh;
  water: THREE.Mesh | null;
  built: number;
}

/** Biome tint for large-scale colour variation (applied as vertex colour). */
const BIOME_TINT: Record<BiomeId, [number, number, number]> = {
  deep_ocean: [0.75, 0.8, 0.8],
  shallow_ocean: [0.8, 0.85, 0.85],
  beach: [1.02, 1.0, 0.92],
  wetland: [0.82, 0.95, 0.78],
  grassland: [0.95, 1.02, 0.85],
  temperate_forest: [0.85, 1.0, 0.82],
  dense_woodland: [0.75, 0.95, 0.72],
  tropical_forest: [0.8, 1.05, 0.72],
  boreal_forest: [0.78, 0.92, 0.82],
  tundra: [0.92, 0.95, 0.9],
  desert: [1.05, 1.0, 0.85],
  alpine: [0.95, 0.95, 0.95],
  river: [0.85, 0.95, 0.9],
};

export function buildTerrainGeometry(
  gen: WorldGen,
  cx: number,
  cz: number,
  segs = CHUNK_SEGMENTS,
  size = CHUNK_SIZE,
): THREE.BufferGeometry {
  const ox = cx * size;
  const oz = cz * size;
  const step = size / segs;
  const n = segs + 1;
  const vertCount = n * n;

  const positions = new Float32Array(vertCount * 3);
  const normals = new Float32Array(vertCount * 3);
  const colors = new Float32Array(vertCount * 3);
  const slopeA = new Float32Array(vertCount);
  const heightA = new Float32Array(vertCount);
  const moistA = new Float32Array(vertCount);
  const paintA = new Float32Array(vertCount);
  const paintWA = new Float32Array(vertCount);
  const uvs = new Float32Array(vertCount * 2);

  // Sample heights first (with a 1-cell apron for finite-diff normals).
  const heights = new Float32Array(vertCount);
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const x = ox + ix * step;
      const z = oz + iz * step;
      heights[iz * n + ix] = gen.height(x, z);
    }
  }

  const season = 0.35; // tint is refreshed globally; static variation is per-vertex
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const vi = iz * n + ix;
      const x = ox + ix * step;
      const z = oz + iz * step;
      const h = heights[vi];
      positions[vi * 3] = ix * step;
      positions[vi * 3 + 1] = h;
      positions[vi * 3 + 2] = iz * step;
      uvs[vi * 2] = ix / segs;
      uvs[vi * 2 + 1] = iz / segs;

      // Central-difference normal from the sampled field.
      const hL = heights[iz * n + Math.max(0, ix - 1)];
      const hR = heights[iz * n + Math.min(n - 1, ix + 1)];
      const hD = heights[Math.max(0, iz - 1) * n + ix];
      const hU = heights[Math.min(n - 1, iz + 1) * n + ix];
      const dx = (hR - hL) / (2 * step);
      const dz = (hU - hD) / (2 * step);
      const nx = -dx;
      const ny = 1;
      const nz = -dz;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      normals[vi * 3] = nx / len;
      normals[vi * 3 + 1] = ny / len;
      normals[vi * 3 + 2] = nz / len;

      const slope = clamp(Math.sqrt(dx * dx + dz * dz) / 1.6, 0, 1);
      slopeA[vi] = slope;
      heightA[vi] = h;

      const moist = gen.moistureAt(x, z, h);
      moistA[vi] = moist;

      const paint = gen.edits.paintAt(x, z);
      paintA[vi] = paint ? paint.mat : 0;
      paintWA[vi] = paint ? paint.weight : 0;

      // Large-scale tint variation with small positional noise.
      const sample = gen.sample(x, z, season, 1);
      const tint = BIOME_TINT[sample.biome];
      const variation = simplex2(gen.config.seed + 4211, x * 0.004, z * 0.004) * 0.06;
      const micro = posHash01(Math.round(x * 0.5), Math.round(z * 0.5)) * 0.05;
      colors[vi * 3] = clamp(tint[0] + variation + micro, 0.55, 1.25);
      colors[vi * 3 + 1] = clamp(tint[1] + variation * 0.8 + micro, 0.55, 1.25);
      colors[vi * 3 + 2] = clamp(tint[2] + variation * 0.6 + micro, 0.55, 1.25);
    }
  }

  const index = new Uint32Array(segs * segs * 6);
  let ii = 0;
  for (let iz = 0; iz < segs; iz++) {
    for (let ix = 0; ix < segs; ix++) {
      const a = iz * n + ix;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      // Flip diagonal per cell to avoid directional shading artifacts.
      if ((ix + iz) % 2 === 0) {
        index[ii++] = a; index[ii++] = c; index[ii++] = b;
        index[ii++] = b; index[ii++] = c; index[ii++] = d;
      } else {
        index[ii++] = a; index[ii++] = c; index[ii++] = d;
        index[ii++] = a; index[ii++] = d; index[ii++] = b;
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setAttribute('aSlope', new THREE.BufferAttribute(slopeA, 1));
  geo.setAttribute('aHeight', new THREE.BufferAttribute(heightA, 1));
  geo.setAttribute('aMoisture', new THREE.BufferAttribute(moistA, 1));
  geo.setAttribute('aPaint', new THREE.BufferAttribute(paintA, 1));
  geo.setAttribute('aPaintW', new THREE.BufferAttribute(paintWA, 1));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Water surface mesh for one chunk: a coarse grid where wet, storing depth and
 * flow as attributes for the water shader (colour absorption, foam, current).
 */
export function buildWaterGeometry(
  gen: WorldGen,
  hydro: Hydrology,
  cx: number,
  cz: number,
): THREE.BufferGeometry | null {
  const segs = 32;
  const step = CHUNK_SIZE / segs;
  const n = segs + 1;
  const ox = cx * CHUNK_SIZE;
  const oz = cz * CHUNK_SIZE;

  const surfaces = new Float32Array(n * n);
  const depths = new Float32Array(n * n);
  const flows = new Float32Array(n * n);
  let wet = 0;

  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const x = ox + ix * step;
      const z = oz + iz * step;
      const t = gen.height(x, z);
      const s = hydro.surfaceAt(x, z);
      const vi = iz * n + ix;
      if (s !== null && s > t - 0.5) {
        surfaces[vi] = Math.max(s, t + 0.05);
        depths[vi] = Math.max(0, surfaces[vi] - t);
        flows[vi] = gen.riverMask(x, z);
        if (depths[vi] > 0.05) wet++;
      } else {
        surfaces[vi] = t - 2;
        depths[vi] = 0;
        flows[vi] = 0;
      }
    }
  }

  if (wet === 0) return null;

  const positions: number[] = [];
  const normals: number[] = [];
  const depthAttr: number[] = [];
  const flowAttr: number[] = [];
  const index: number[] = [];
  const vertMap = new Int32Array(n * n).fill(-1);

  const getVert = (ix: number, iz: number): number => {
    const vi = iz * n + ix;
    if (vertMap[vi] >= 0) return vertMap[vi];
    const idx = positions.length / 3;
    positions.push(ix * step, surfaces[vi], iz * step);
    normals.push(0, 1, 0);
    depthAttr.push(depths[vi]);
    flowAttr.push(flows[vi]);
    vertMap[vi] = idx;
    return idx;
  };

  for (let iz = 0; iz < segs; iz++) {
    for (let ix = 0; ix < segs; ix++) {
      const d0 = depths[iz * n + ix];
      const d1 = depths[iz * n + ix + 1];
      const d2 = depths[(iz + 1) * n + ix];
      const d3 = depths[(iz + 1) * n + ix + 1];
      if (Math.max(d0, d1, d2, d3) < 0.06) continue;
      const a = getVert(ix, iz);
      const b = getVert(ix + 1, iz);
      const c = getVert(ix, iz + 1);
      const d = getVert(ix + 1, iz + 1);
      index.push(a, c, b, b, c, d);
    }
  }

  if (index.length === 0) return null;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('aDepth', new THREE.Float32BufferAttribute(depthAttr, 1));
  geo.setAttribute('aFlow', new THREE.Float32BufferAttribute(flowAttr, 1));
  geo.setIndex(index);
  geo.computeBoundingSphere();
  return geo;
}

export interface ChunkManagerOptions {
  viewDistance: number;
  farDistance: number;
  terrainMaterial: THREE.Material;
  waterMaterial: THREE.Material;
  buildsPerFrame: number;
}

export class ChunkManager {
  readonly group = new THREE.Group();
  private gen: WorldGen;
  private hydro: Hydrology;
  private opts: ChunkManagerOptions;
  private chunks = new Map<string, ChunkMeshBundle>();
  private farChunks = new Map<string, THREE.Mesh>();
  private queue: Array<{ cx: number; cz: number; priority: number }> = [];
  private centerCx = Number.NaN;
  private centerCz = Number.NaN;
  chunksBuilt = 0;
  chunksUnloaded = 0;
  pendingBuilds = 0;

  constructor(gen: WorldGen, hydro: Hydrology, opts: ChunkManagerOptions) {
    this.gen = gen;
    this.hydro = hydro;
    this.opts = opts;
    this.group.name = 'terrain';
  }

  setMaterials(terrainMaterial: THREE.Material, waterMaterial: THREE.Material): void {
    this.opts.terrainMaterial = terrainMaterial;
    this.opts.waterMaterial = waterMaterial;
    for (const c of this.chunks.values()) {
      c.terrain.material = terrainMaterial;
      if (c.water) c.water.material = waterMaterial;
    }
    for (const m of this.farChunks.values()) m.material = terrainMaterial;
  }

  /** Update streaming focus; call when the player moves (or every second). */
  update(playerX: number, playerZ: number, force = false): void {
    const cx = Math.floor(playerX / CHUNK_SIZE);
    const cz = Math.floor(playerZ / CHUNK_SIZE);
    if (!force && cx === this.centerCx && cz === this.centerCz) return;
    this.centerCx = cx;
    this.centerCz = cz;

    const radius = Math.ceil(this.opts.viewDistance / CHUNK_SIZE);
    const wanted = new Set<string>();
    this.queue.length = 0;

    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const d2 = dx * dx + dz * dz;
        if (d2 > radius * radius) continue;
        const key = `${cx + dx},${cz + dz}`;
        wanted.add(key);
        if (!this.chunks.has(key)) {
          this.queue.push({ cx: cx + dx, cz: cz + dz, priority: d2 });
        }
      }
    }
    this.queue.sort((a, b) => a.priority - b.priority);
    this.pendingBuilds = this.queue.length;

    // Unload distant chunks.
    for (const [key, bundle] of this.chunks) {
      if (!wanted.has(key)) {
        this.group.remove(bundle.terrain);
        bundle.terrain.geometry.dispose();
        if (bundle.water) {
          this.group.remove(bundle.water);
          bundle.water.geometry.dispose();
        }
        this.chunks.delete(key);
        this.chunksUnloaded++;
      }
    }

    this.updateFarRing(cx, cz);
  }

  /** Coarse distant terrain for horizon depth and aerial perspective. */
  private updateFarRing(cx: number, cz: number): void {
    const FAR_SIZE = 512;
    const farSegs = 12;
    const inner = this.opts.viewDistance * 0.85;
    const outer = this.opts.farDistance;
    const cfx = Math.floor((cx * CHUNK_SIZE) / FAR_SIZE);
    const cfz = Math.floor((cz * CHUNK_SIZE) / FAR_SIZE);
    const rad = Math.ceil(outer / FAR_SIZE);
    const wanted = new Set<string>();

    for (let dz = -rad; dz <= rad; dz++) {
      for (let dx = -rad; dx <= rad; dx++) {
        const wx = (cfx + dx) * FAR_SIZE;
        const wz = (cfz + dz) * FAR_SIZE;
        // Skip tiles fully inside the detailed area.
        const near =
          wx + FAR_SIZE > -inner && wx < inner &&
          wz + FAR_SIZE > -inner && wz < inner;
        const dist = Math.hypot(wx + FAR_SIZE / 2 - cx * CHUNK_SIZE, wz + FAR_SIZE / 2 - cz * CHUNK_SIZE);
        if (near || dist > outer) continue;
        const key = `${cfx + dx},${cfz + dz}`;
        wanted.add(key);
        if (!this.farChunks.has(key)) {
          const geo = buildTerrainGeometry(this.gen, Math.round(wx / CHUNK_SIZE), Math.round(wz / CHUNK_SIZE), farSegs, FAR_SIZE);
          const mesh = new THREE.Mesh(geo, this.opts.terrainMaterial);
          mesh.position.set(wx, 0, wz);
          mesh.receiveShadow = false;
          mesh.castShadow = false;
          mesh.renderOrder = -1;
          this.farChunks.set(key, mesh);
          this.group.add(mesh);
        }
      }
    }

    for (const [key, mesh] of this.farChunks) {
      if (!wanted.has(key)) {
        this.group.remove(mesh);
        mesh.geometry.dispose();
        this.farChunks.delete(key);
      }
    }
  }

  /** Build queued chunks within a time budget (ms). Returns builds done. */
  processQueue(budgetMs: number): number {
    const start = performance.now();
    let built = 0;
    while (this.queue.length > 0 && performance.now() - start < budgetMs) {
      const job = this.queue.shift()!;
      this.buildChunk(job.cx, job.cz);
      built++;
    }
    this.pendingBuilds = this.queue.length;
    return built;
  }

  buildChunk(cx: number, cz: number): ChunkMeshBundle | null {
    const key = `${cx},${cz}`;
    const existing = this.chunks.get(key);
    if (existing) return existing;

    const geo = buildTerrainGeometry(this.gen, cx, cz);
    const terrain = new THREE.Mesh(geo, this.opts.terrainMaterial);
    terrain.position.set(cx * CHUNK_SIZE, 0, cz * CHUNK_SIZE);
    terrain.receiveShadow = true;
    terrain.castShadow = true;
    terrain.matrixAutoUpdate = false;
    terrain.updateMatrix();

    const waterGeo = buildWaterGeometry(this.gen, this.hydro, cx, cz);
    let water: THREE.Mesh | null = null;
    if (waterGeo) {
      water = new THREE.Mesh(waterGeo, this.opts.waterMaterial);
      water.position.set(cx * CHUNK_SIZE, 0, cz * CHUNK_SIZE);
      water.renderOrder = 2;
      water.matrixAutoUpdate = false;
      water.updateMatrix();
      this.group.add(water);
    }

    this.group.add(terrain);
    const bundle: ChunkMeshBundle = { cx, cz, terrain, water, built: performance.now() };
    this.chunks.set(key, bundle);
    this.chunksBuilt++;
    return bundle;
  }

  /** Rebuild one chunk (after terrain edits or water changes). */
  rebuild(cx: number, cz: number): void {
    const key = `${cx},${cz}`;
    const existing = this.chunks.get(key);
    if (existing) {
      this.group.remove(existing.terrain);
      existing.terrain.geometry.dispose();
      if (existing.water) {
        this.group.remove(existing.water);
        existing.water.geometry.dispose();
      }
      this.chunks.delete(key);
    }
    this.buildChunk(cx, cz);
  }

  /** Mark chunks overlapping a world-space circle dirty (edits, water shifts). */
  markDirty(x: number, z: number, radius: number): void {
    const minCx = Math.floor((x - radius) / CHUNK_SIZE);
    const maxCx = Math.floor((x + radius) / CHUNK_SIZE);
    const minCz = Math.floor((z - radius) / CHUNK_SIZE);
    const maxCz = Math.floor((z + radius) / CHUNK_SIZE);
    for (let cz = minCz; cz <= maxCz; cz++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        this.rebuild(cx, cz);
      }
    }
  }

  /** Refresh water meshes only (hydrology tick) within a radius of the player. */
  refreshWater(x: number, z: number, radius: number): void {
    const minCx = Math.floor((x - radius) / CHUNK_SIZE);
    const maxCx = Math.floor((x + radius) / CHUNK_SIZE);
    const minCz = Math.floor((z - radius) / CHUNK_SIZE);
    const maxCz = Math.floor((z + radius) / CHUNK_SIZE);
    for (let cz = minCz; cz <= maxCz; cz++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const bundle = this.chunks.get(`${cx},${cz}`);
        if (!bundle) continue;
        const geo = buildWaterGeometry(this.gen, this.hydro, cx, cz);
        if (bundle.water) {
          this.group.remove(bundle.water);
          bundle.water.geometry.dispose();
          bundle.water = null;
        }
        if (geo) {
          const water = new THREE.Mesh(geo, this.opts.waterMaterial);
          water.position.set(cx * CHUNK_SIZE, 0, cz * CHUNK_SIZE);
          water.renderOrder = 2;
          water.matrixAutoUpdate = false;
          water.updateMatrix();
          bundle.water = water;
          this.group.add(water);
        }
      }
    }
  }

  get activeCount(): number {
    return this.chunks.size;
  }

  get farCount(): number {
    return this.farChunks.size;
  }

  /** Raycast-friendly terrain intersection using the analytic heightfield. */
  raycastTerrain(origin: THREE.Vector3, dir: THREE.Vector3, maxDist = 200): { point: THREE.Vector3; distance: number } | null {
    const p = origin.clone();
    const step = 1.5;
    let t = 0;
    while (t < maxDist) {
      p.addScaledVector(dir, step);
      t += step;
      const h = this.gen.height(p.x, p.z);
      if (p.y <= h) {
        // Refine with bisection.
        let lo = t - step;
        let hi = t;
        for (let i = 0; i < 6; i++) {
          const mid = (lo + hi) / 2;
          const pm = origin.clone().addScaledVector(dir, mid);
          if (pm.y <= this.gen.height(pm.x, pm.z)) hi = mid;
          else lo = mid;
        }
        const hit = origin.clone().addScaledVector(dir, hi);
        hit.y = this.gen.height(hit.x, hit.z);
        return { point: hit, distance: hi };
      }
    }
    return null;
  }

  dispose(): void {
    for (const c of this.chunks.values()) {
      c.terrain.geometry.dispose();
      if (c.water) c.water.geometry.dispose();
    }
    for (const m of this.farChunks.values()) m.geometry.dispose();
    this.chunks.clear();
    this.farChunks.clear();
    this.queue.length = 0;
  }
}
