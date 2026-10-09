/**
 * Vegetation system: procedurally modelled trees, bushes, rocks, grass and
 * flowers, instanced per chunk with deterministic placement from the world
 * field. Canopies sway in the wind via shader displacement; placement
 * respects biome, slope, moisture and altitude.
 *
 * Trees are multi-part models (trunk, branches, canopy clusters) with
 * per-instance tint/scale/rotation — not single primitive stand-ins.
 */

import * as THREE from 'three';
import { CHUNK_SIZE, type BiomeId } from './types';
import type { WorldGen } from './worldGen';
import type { ChunkMeshBundle } from './chunks';
import { clamp, lerp, smoothstep, posHash01 } from '../core/math';
import { hashCombine, seededRng } from '../core/rng';

export type TreeSpecies = 'oak' | 'pine' | 'birch' | 'palm' | 'dead';

export interface PlacedObject {
  kind: 'tree' | 'bush' | 'rock' | 'flower';
  species: TreeSpecies | string;
  x: number;
  z: number;
  y: number;
  scale: number;
  rot: number;
  seed: number;
}

/** Wind sway injected into any vegetation material. */
function applyWind(material: THREE.Material, strength: number): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    shader.uniforms.uWindStrength = { value: strength };
    (material as unknown as { userData: { shader?: unknown } }).userData.shader = shader;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform float uTime;
         uniform float uWindStrength;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         {
           #ifdef USE_INSTANCING
             vec3 iPos = vec3(instanceMatrix[3].xyz);
           #else
             vec3 iPos = vec3(0.0);
           #endif
           float phase = iPos.x * 0.08 + iPos.z * 0.06;
           float sway = sin(uTime * 1.4 + phase) + 0.5 * sin(uTime * 2.3 + phase * 1.7);
           float heightFactor = clamp(position.y * 0.12, 0.0, 1.6);
           transformed.x += sway * uWindStrength * heightFactor * 0.22;
           transformed.z += cos(uTime * 1.1 + phase) * uWindStrength * heightFactor * 0.14;
         }`,
      );
  };
}

function tickWind(materials: THREE.Material[], time: number, wind: number): void {
  for (const m of materials) {
    const shader = (m as unknown as { userData: { shader?: { uniforms: Record<string, { value: number }> } } })
      .userData.shader;
    if (shader) {
      shader.uniforms.uTime.value = time;
      shader.uniforms.uWindStrength.value = wind;
    }
  }
}

// ---------------------------------------------------------------------------
// Procedural tree models
// ---------------------------------------------------------------------------

function mergeParts(parts: Array<{ geo: THREE.BufferGeometry; y: number; x?: number; z?: number; rx?: number; rz?: number; s?: number }>): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const matrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();

  for (const part of parts) {
    const geo = part.geo;
    const pos = geo.getAttribute('position');
    const norm = geo.getAttribute('normal');
    euler.set(part.rx ?? 0, 0, part.rz ?? 0);
    quat.setFromEuler(euler);
    const s = part.s ?? 1;
    matrix.compose(new THREE.Vector3(part.x ?? 0, part.y, part.z ?? 0), quat, new THREE.Vector3(s, s, s));
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(matrix);
      positions.push(v.x, v.y, v.z);
      if (norm) {
        n.fromBufferAttribute(norm, i).applyMatrix3(normalMatrix).normalize();
        normals.push(n.x, n.y, n.z);
      } else {
        normals.push(0, 1, 0);
      }
      colors.push(1, 1, 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geo;
}

interface TreePrototype {
  species: TreeSpecies;
  /** trunk + branches geometry (bark material) */
  wood: THREE.BufferGeometry;
  /** canopy geometry (leaf material) */
  canopy: THREE.BufferGeometry | null;
  height: number;
}

function buildOak(): TreePrototype {
  const rng = seededRng('oak-proto');
  const trunkParts: Array<{ geo: THREE.BufferGeometry; y: number; x?: number; z?: number; rx?: number; rz?: number; s?: number }> = [];
  const canopyParts: typeof trunkParts = [];

  const trunk = new THREE.CylinderGeometry(0.32, 0.52, 4.4, 7, 1);
  trunkParts.push({ geo: trunk, y: 2.2 });
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2 + rng.range(-0.3, 0.3);
    const len = rng.range(2.2, 3.4);
    const branch = new THREE.CylinderGeometry(0.09, 0.17, len, 5, 1);
    trunkParts.push({
      geo: branch,
      y: rng.range(3.4, 4.6),
      x: Math.cos(angle) * len * 0.32,
      z: Math.sin(angle) * len * 0.32,
      rz: Math.cos(angle) * 1.05,
      rx: -Math.sin(angle) * 1.05,
    });
  }
  for (let i = 0; i < 7; i++) {
    const angle = (i / 7) * Math.PI * 2 + rng.range(-0.4, 0.4);
    const r = i === 0 ? 0 : rng.range(1.1, 2.3);
    const blob = new THREE.IcosahedronGeometry(rng.range(1.5, 2.3), 1);
    canopyParts.push({
      geo: blob,
      y: rng.range(5.2, 7.4),
      x: Math.cos(angle) * r,
      z: Math.sin(angle) * r,
      s: rng.range(0.85, 1.25),
    });
  }
  return { species: 'oak', wood: mergeParts(trunkParts), canopy: mergeParts(canopyParts), height: 8.5 };
}

function buildPine(): TreePrototype {
  const rng = seededRng('pine-proto');
  const trunkParts: Array<{ geo: THREE.BufferGeometry; y: number; x?: number; z?: number; rx?: number; rz?: number; s?: number }> = [];
  const canopyParts: typeof trunkParts = [];

  const trunk = new THREE.CylinderGeometry(0.16, 0.42, 8.2, 6, 1);
  trunkParts.push({ geo: trunk, y: 4.1 });
  let y = 2.4;
  let radius = 2.5;
  for (let i = 0; i < 5; i++) {
    const cone = new THREE.ConeGeometry(radius, 3.1, 8, 1);
    canopyParts.push({ geo: cone, y: y + 1.2, rx: rng.range(-0.04, 0.04), rz: rng.range(-0.04, 0.04) });
    y += 1.45;
    radius *= 0.72;
  }
  return { species: 'pine', wood: mergeParts(trunkParts), canopy: mergeParts(canopyParts), height: 10 };
}

function buildBirch(): TreePrototype {
  const rng = seededRng('birch-proto');
  const trunkParts: Array<{ geo: THREE.BufferGeometry; y: number; x?: number; z?: number; rx?: number; rz?: number; s?: number }> = [];
  const canopyParts: typeof trunkParts = [];

  const trunk = new THREE.CylinderGeometry(0.2, 0.34, 5.8, 6, 1);
  trunkParts.push({ geo: trunk, y: 2.9 });
  for (let i = 0; i < 3; i++) {
    const angle = rng.range(0, Math.PI * 2);
    const len = rng.range(1.8, 2.6);
    trunkParts.push({
      geo: new THREE.CylinderGeometry(0.05, 0.1, len, 4, 1),
      y: rng.range(3.6, 5.2),
      x: Math.cos(angle) * 0.5,
      z: Math.sin(angle) * 0.5,
      rz: Math.cos(angle) * 1.1,
      rx: -Math.sin(angle) * 1.1,
    });
  }
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2 + rng.range(-0.5, 0.5);
    canopyParts.push({
      geo: new THREE.IcosahedronGeometry(rng.range(1.1, 1.7), 1),
      y: rng.range(5, 7.2),
      x: Math.cos(angle) * rng.range(0.4, 1.4),
      z: Math.sin(angle) * rng.range(0.4, 1.4),
    });
  }
  return { species: 'birch', wood: mergeParts(trunkParts), canopy: mergeParts(canopyParts), height: 8 };
}

function buildPalm(): TreePrototype {
  const rng = seededRng('palm-proto');
  const trunkParts: Array<{ geo: THREE.BufferGeometry; y: number; x?: number; z?: number; rx?: number; rz?: number; s?: number }> = [];
  const canopyParts: typeof trunkParts = [];

  // Curved trunk from stacked segments.
  let x = 0;
  for (let i = 0; i < 7; i++) {
    const seg = new THREE.CylinderGeometry(0.16 - i * 0.008, 0.2 - i * 0.008, 1.15, 6, 1);
    trunkParts.push({ geo: seg, y: i * 1.08 + 0.55, x, rz: -0.09 * i * 0.28 });
    x += 0.16 * i * 0.16;
  }
  // Fronds: bent elongated boxes radiating from the crown.
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2 + rng.range(-0.15, 0.15);
    const frond = new THREE.BoxGeometry(0.7, 0.08, 3.6);
    canopyParts.push({
      geo: frond,
      y: 8.1 + rng.range(-0.15, 0.15),
      x: x + Math.cos(angle) * 1.55,
      z: Math.sin(angle) * 1.55,
      rx: Math.sin(angle) * 0.32,
      rz: -Math.cos(angle) * 0.32,
    });
    const tip = new THREE.BoxGeometry(0.55, 0.07, 1.4);
    canopyParts.push({
      geo: tip,
      y: 7.55,
      x: x + Math.cos(angle) * 2.9,
      z: Math.sin(angle) * 2.9,
      rx: Math.sin(angle) * 0.75,
      rz: -Math.cos(angle) * 0.75,
    });
  }
  return { species: 'palm', wood: mergeParts(trunkParts), canopy: mergeParts(canopyParts), height: 9 };
}

function buildDead(): TreePrototype {
  const rng = seededRng('dead-proto');
  const trunkParts: Array<{ geo: THREE.BufferGeometry; y: number; x?: number; z?: number; rx?: number; rz?: number; s?: number }> = [];
  trunkParts.push({ geo: new THREE.CylinderGeometry(0.18, 0.44, 5.6, 6, 1), y: 2.8 });
  for (let i = 0; i < 6; i++) {
    const angle = rng.range(0, Math.PI * 2);
    const len = rng.range(1.6, 3.2);
    trunkParts.push({
      geo: new THREE.CylinderGeometry(0.04, 0.11, len, 4, 1),
      y: rng.range(2.4, 5.2),
      x: Math.cos(angle) * len * 0.3,
      z: Math.sin(angle) * len * 0.3,
      rz: Math.cos(angle) * rng.range(0.8, 1.3),
      rx: -Math.sin(angle) * rng.range(0.8, 1.3),
    });
  }
  return { species: 'dead', wood: mergeParts(trunkParts), canopy: null, height: 6 };
}

// ---------------------------------------------------------------------------

interface SpeciesDef {
  prototype: TreePrototype;
  barkColor: THREE.Color;
  leafColor: THREE.Color;
  /** autumn leaf tint */
  autumnColor: THREE.Color;
  biomes: Partial<Record<BiomeId, number>>; // density weight per biome
  maxSlope: number;
  altitude: [number, number];
}

export class VegetationSystem {
  readonly group = new THREE.Group();
  private prototypes: Record<TreeSpecies, TreePrototype>;
  private speciesDefs: Record<TreeSpecies, SpeciesDef>;
  private barkMats: Map<TreeSpecies, THREE.MeshStandardMaterial> = new Map();
  private leafMats: Map<TreeSpecies, THREE.MeshStandardMaterial> = new Map();
  private materials: THREE.Material[] = [];
  private chunkVegetation = new Map<string, THREE.Group>();
  /** Chunks whose vegetation has been generated (including empty ones). */
  private builtKeys = new Set<string>();
  /**
   * Geometry and materials shared by every chunk for rocks, bushes and flowers.
   * Created once per world; per-chunk builds only allocate InstancedMesh objects.
   */
  private shared: {
    rock: { geo: THREE.BufferGeometry; mat: THREE.MeshStandardMaterial };
    bush: { geo: THREE.BufferGeometry; mat: THREE.MeshStandardMaterial };
    flower: { geo: THREE.BufferGeometry; mat: THREE.MeshStandardMaterial };
  };
  /** Multiplier on tree and bush counts (the player's foliage setting). */
  private foliageScale = 1;
  /** Player-planted objects (persisted). */
  planted: PlacedObject[] = [];
  /** Player-removed vegetation keys (persisted). */
  removedKeys = new Set<number>();
  seasonPhase = 0.3;

  constructor(public gen: WorldGen, private leafTexture: THREE.Texture, private barkTexture: THREE.Texture) {
    this.group.name = 'vegetation';
    const rockGeo = new THREE.IcosahedronGeometry(1, 1);
    rockGeo.computeVertexNormals();
    const bushMat = new THREE.MeshStandardMaterial({ color: 0x3d5c2e, roughness: 0.9, flatShading: true });
    const flowerMat = new THREE.MeshStandardMaterial({ roughness: 0.8, vertexColors: true });
    this.shared = {
      rock: { geo: rockGeo, mat: new THREE.MeshStandardMaterial({ color: 0x8a8781, roughness: 0.95, flatShading: true }) },
      bush: { geo: new THREE.IcosahedronGeometry(0.9, 1), mat: bushMat },
      flower: { geo: new THREE.ConeGeometry(0.12, 0.32, 5), mat: flowerMat },
    };
    applyWind(bushMat, 0.7);
    this.materials.push(this.shared.rock.mat, bushMat, flowerMat);
    this.prototypes = {
      oak: buildOak(),
      pine: buildPine(),
      birch: buildBirch(),
      palm: buildPalm(),
      dead: buildDead(),
    };

    this.speciesDefs = {
      oak: {
        prototype: this.prototypes.oak,
        barkColor: new THREE.Color(0.42, 0.32, 0.24),
        leafColor: new THREE.Color(0.32, 0.52, 0.24),
        autumnColor: new THREE.Color(0.72, 0.5, 0.18),
        biomes: { temperate_forest: 1, dense_woodland: 0.7, grassland: 0.18, tropical_forest: 0.3, wetland: 0.15 },
        maxSlope: 0.55,
        altitude: [1, 120],
      },
      pine: {
        prototype: this.prototypes.pine,
        barkColor: new THREE.Color(0.34, 0.25, 0.18),
        leafColor: new THREE.Color(0.16, 0.36, 0.22),
        autumnColor: new THREE.Color(0.2, 0.34, 0.22),
        biomes: { boreal_forest: 1, alpine: 0.7, temperate_forest: 0.5, dense_woodland: 0.35, tundra: 0.12 },
        maxSlope: 0.72,
        altitude: [20, 210],
      },
      birch: {
        prototype: this.prototypes.birch,
        barkColor: new THREE.Color(0.82, 0.8, 0.76),
        leafColor: new THREE.Color(0.42, 0.6, 0.3),
        autumnColor: new THREE.Color(0.85, 0.72, 0.3),
        biomes: { temperate_forest: 0.6, boreal_forest: 0.5, tundra: 0.1, grassland: 0.12 },
        maxSlope: 0.5,
        altitude: [1, 140],
      },
      palm: {
        prototype: this.prototypes.palm,
        barkColor: new THREE.Color(0.55, 0.45, 0.3),
        leafColor: new THREE.Color(0.28, 0.55, 0.3),
        autumnColor: new THREE.Color(0.32, 0.52, 0.3),
        biomes: { beach: 0.9, tropical_forest: 0.45, desert: 0.08 },
        maxSlope: 0.4,
        altitude: [-2, 26],
      },
      dead: {
        prototype: this.prototypes.dead,
        barkColor: new THREE.Color(0.38, 0.33, 0.28),
        leafColor: new THREE.Color(0.4, 0.4, 0.36),
        autumnColor: new THREE.Color(0.4, 0.4, 0.36),
        biomes: { tundra: 0.35, desert: 0.2, alpine: 0.3, boreal_forest: 0.08, grassland: 0.05 },
        maxSlope: 0.6,
        altitude: [0, 230],
      },
    };

    for (const species of Object.keys(this.prototypes) as TreeSpecies[]) {
      const bark = new THREE.MeshStandardMaterial({
        color: this.speciesDefs[species].barkColor,
        map: this.barkTexture,
        roughness: 0.92,
        metalness: 0,
        vertexColors: true,
      });
      const leaf = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: this.leafTexture,
        roughness: 0.85,
        metalness: 0,
        vertexColors: true,
        side: THREE.DoubleSide,
      });
      applyWind(bark, 0.25);
      applyWind(leaf, 1);
      this.barkMats.set(species, bark);
      this.leafMats.set(species, leaf);
      this.materials.push(bark, leaf);
    }
    this.group.userData.materials = this.materials;
  }

  /** Global wind/material tick. */
  update(time: number, windStrength: number): void {
    tickWind(this.materials, time, windStrength);
    // Seasonal leaf colours
    const autumn = Math.max(0, 1 - Math.abs(this.seasonPhase - 0.625) * 8);
    for (const [species, mat] of this.leafMats) {
      const def = this.speciesDefs[species];
      mat.color.copy(def.leafColor).lerp(def.autumnColor, autumn);
    }
  }

  private objectKey(x: number, z: number): number {
    return hashCombine(this.gen.config.seed, Math.round(x * 2), Math.round(z * 2), 991);
  }

  /** Deterministic scatter for one chunk (trees, bushes, rocks, flowers). */
  generateChunkVegetation(cx: number, cz: number): PlacedObject[] {
    const out: PlacedObject[] = [];
    const cfg = this.gen.config;
    const forest = cfg.forestDensity * this.foliageScale;

    // --- trees ---
    const treeCount = Math.floor(46 * forest);
    const trees = this.gen.scatter(cx, cz, CHUNK_SIZE, treeCount, 101, (x, z, h, slope, r) => {
      if (h < 0.4 || slope > 0.75) return false;
      const sample = this.gen.sample(x, z, this.seasonPhase);
      const dens = this.gen.forestDensity(x, z);
      const biomeWeight = this.biomeTreeWeight(sample.biome);
      const chance = clamp(biomeWeight * (0.35 + dens * 0.9) * forest, 0, 0.96);
      return r < chance;
    });

    for (const t of trees) {
      const key = this.objectKey(t.x, t.z);
      if (this.removedKeys.has(key)) continue;
      const sample = this.gen.sample(t.x, t.z, this.seasonPhase);
      const species = this.pickSpecies(sample.biome, sample.height, sample.slope, t.r);
      if (!species) continue;
      const rng = seededRng(cfg.seed, key);
      out.push({
        kind: 'tree',
        species,
        x: t.x,
        z: t.z,
        y: t.h - 0.15,
        scale: rng.range(0.75, 1.45),
        rot: rng.range(0, Math.PI * 2),
        seed: key,
      });
    }

    // --- bushes ---
    const bushes = this.gen.scatter(cx, cz, CHUNK_SIZE, Math.floor(26 * forest), 202, (x, z, h, slope, r) => {
      if (h < 0.4 || slope > 0.6) return false;
      const dens = this.gen.forestDensity(x, z);
      return r < clamp(0.25 + dens * 0.5, 0, 0.8) * forest * 0.7;
    });
    for (const b of bushes) {
      const key = this.objectKey(b.x, b.z);
      if (this.removedKeys.has(key)) continue;
      const rng = seededRng(cfg.seed, key);
      out.push({ kind: 'bush', species: 'bush', x: b.x, z: b.z, y: b.h, scale: rng.range(0.6, 1.3), rot: rng.range(0, 6.28), seed: key });
    }

    // --- rocks ---
    const rocks = this.gen.scatter(cx, cz, CHUNK_SIZE, 14, 303, (x, z, h, slope, r) => {
      if (h < -1) return false;
      return r < 0.32 + slope * 0.45;
    });
    for (const rk of rocks) {
      const key = this.objectKey(rk.x, rk.z);
      if (this.removedKeys.has(key)) continue;
      const rng = seededRng(cfg.seed, key);
      out.push({ kind: 'rock', species: 'rock', x: rk.x, z: rk.z, y: rk.h - 0.1, scale: rng.range(0.5, 2.4), rot: rng.range(0, 6.28), seed: key });
    }

    // --- flowers (spring/summer) ---
    const flowerSeason = this.seasonPhase < 0.5 ? 1 : 0.25;
    const flowers = this.gen.scatter(cx, cz, CHUNK_SIZE, Math.floor(60 * flowerSeason), 404, (x, z, h, slope, r) => {
      if (h < 0.5 || slope > 0.35) return false;
      const sample = this.gen.sample(x, z, this.seasonPhase);
      return (sample.biome === 'grassland' || sample.biome === 'temperate_forest' || sample.biome === 'wetland') && r < 0.55;
    });
    for (const fl of flowers) {
      const key = this.objectKey(fl.x, fl.z);
      const rng = seededRng(cfg.seed, key);
      out.push({ kind: 'flower', species: `flower_${rng.int(0, 5)}`, x: fl.x, z: fl.z, y: fl.h, scale: rng.range(0.7, 1.2), rot: rng.range(0, 6.28), seed: key });
    }

    // Player-planted objects in this chunk.
    for (const p of this.planted) {
      const pcx = Math.floor(p.x / CHUNK_SIZE);
      const pcz = Math.floor(p.z / CHUNK_SIZE);
      if (pcx === cx && pcz === cz) out.push(p);
    }
    return out;
  }

  private biomeTreeWeight(biome: BiomeId): number {
    let max = 0;
    for (const species of Object.keys(this.speciesDefs) as TreeSpecies[]) {
      max = Math.max(max, this.speciesDefs[species].biomes[biome] ?? 0);
    }
    return max;
  }

  private pickSpecies(biome: BiomeId, height: number, slope: number, r: number): TreeSpecies | null {
    const options: Array<[TreeSpecies, number]> = [];
    for (const species of Object.keys(this.speciesDefs) as TreeSpecies[]) {
      const def = this.speciesDefs[species];
      const w = def.biomes[biome] ?? 0;
      if (w <= 0) continue;
      if (height < def.altitude[0] || height > def.altitude[1]) continue;
      if (slope > def.maxSlope) continue;
      options.push([species, w]);
    }
    if (options.length === 0) return null;
    const total = options.reduce((s, o) => s + o[1], 0);
    let roll = r * total;
    for (const [species, w] of options) {
      roll -= w;
      if (roll <= 0) return species;
    }
    return options[0][0];
  }

  /** Build instanced meshes for one chunk. */
  buildChunk(cx: number, cz: number, bundle?: ChunkMeshBundle): void {
    const key = `${cx},${cz}`;
    if (this.chunkVegetation.has(key)) this.removeChunk(key);
    const objects = this.generateChunkVegetation(cx, cz);
    this.builtKeys.add(key);
    this.treeCounts.set(key, objects.filter((o) => o.kind === 'tree').length);
    if (objects.length === 0) return;

    const group = new THREE.Group();
    group.position.set(cx * CHUNK_SIZE, 0, cz * CHUNK_SIZE);

    // Group by (kind, species)
    const buckets = new Map<string, PlacedObject[]>();
    for (const o of objects) {
      const bk = `${o.kind}:${o.species}`;
      let arr = buckets.get(bk);
      if (!arr) buckets.set(bk, (arr = []));
      arr.push(o);
    }

    const dummy = new THREE.Object3D();
    const colorScratch = new THREE.Color();

    for (const [bk, objs] of buckets) {
      const [kind, speciesStr] = bk.split(':');

      if (kind === 'tree') {
        const species = speciesStr as TreeSpecies;
        const proto = this.prototypes[species];
        const def = this.speciesDefs[species];
        const barkMat = this.barkMats.get(species)!;
        const leafMat = this.leafMats.get(species)!;

        const woodMesh = new THREE.InstancedMesh(proto.wood, barkMat, objs.length);
        woodMesh.castShadow = true;
        woodMesh.receiveShadow = true;
        let li = 0;
        const leafMesh = proto.canopy ? new THREE.InstancedMesh(proto.canopy, leafMat, objs.length) : null;
        if (leafMesh) {
          leafMesh.castShadow = true;
          leafMesh.receiveShadow = true;
        }
        for (let i = 0; i < objs.length; i++) {
          const o = objs[i];
          dummy.position.set(o.x - group.position.x, o.y, o.z - group.position.z);
          dummy.rotation.set(0, o.rot, 0);
          dummy.scale.setScalar(o.scale);
          dummy.updateMatrix();
          woodMesh.setMatrixAt(i, dummy.matrix);
          const tint = 0.85 + posHash01(Math.round(o.x), Math.round(o.z)) * 0.35;
          colorScratch.setRGB(tint, tint * 0.98, tint * 0.92);
          woodMesh.setColorAt(i, colorScratch);
          if (leafMesh) {
            leafMesh.setMatrixAt(i, dummy.matrix);
            const hueShift = posHash01(Math.round(o.z), Math.round(o.x)) * 0.25;
            colorScratch.setRGB(1 - hueShift * 0.35, 1 + hueShift * 0.12, 1 - hueShift * 0.28);
            leafMesh.setColorAt(i, colorScratch);
            li++;
          }
        }
        woodMesh.instanceMatrix.needsUpdate = true;
        if (woodMesh.instanceColor) woodMesh.instanceColor.needsUpdate = true;
        group.add(woodMesh);
        if (leafMesh) {
          leafMesh.instanceMatrix.needsUpdate = true;
          if (leafMesh.instanceColor) leafMesh.instanceColor.needsUpdate = true;
          group.add(leafMesh);
        }
      } else if (kind === 'rock') {
        const { geo, mat } = this.shared.rock;
        const mesh = new THREE.InstancedMesh(geo, mat, objs.length);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        for (let i = 0; i < objs.length; i++) {
          const o = objs[i];
          dummy.position.set(o.x - group.position.x, o.y + o.scale * 0.15, o.z - group.position.z);
          dummy.rotation.set(posHash01(i, o.seed) * 0.6, o.rot, posHash01(o.seed, i) * 0.6);
          dummy.scale.set(o.scale * 1.15, o.scale * 0.75, o.scale);
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
          const g = 0.7 + posHash01(o.seed, 7) * 0.5;
          colorScratch.setRGB(g, g * 0.98, g * 0.94);
          mesh.setColorAt(i, colorScratch);
        }
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        group.add(mesh);
      } else if (kind === 'bush') {
        const { geo, mat } = this.shared.bush;
        const mesh = new THREE.InstancedMesh(geo, mat, objs.length);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        for (let i = 0; i < objs.length; i++) {
          const o = objs[i];
          dummy.position.set(o.x - group.position.x, o.y + o.scale * 0.5, o.z - group.position.z);
          dummy.rotation.set(0, o.rot, 0);
          dummy.scale.set(o.scale * 1.3, o.scale * 0.85, o.scale * 1.3);
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
          const v = 0.75 + posHash01(o.seed, 3) * 0.5;
          colorScratch.setRGB(v * 0.85, v, v * 0.7);
          mesh.setColorAt(i, colorScratch);
        }
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        group.add(mesh);
      } else if (kind === 'flower') {
        const { geo, mat } = this.shared.flower;
        const mesh = new THREE.InstancedMesh(geo, mat, objs.length);
        for (let i = 0; i < objs.length; i++) {
          const o = objs[i];
          dummy.position.set(o.x - group.position.x, o.y + 0.16, o.z - group.position.z);
          dummy.rotation.set(0, o.rot, 0);
          dummy.scale.setScalar(o.scale);
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
          const hue = (parseInt(o.species.split('_')[1], 10) * 0.16 + 0.02) % 1;
          colorScratch.setHSL(hue, 0.75, 0.6);
          mesh.setColorAt(i, colorScratch);
        }
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        group.add(mesh);
      }
    }

    this.chunkVegetation.set(key, group);
    this.group.add(group);
  }

  removeChunk(key: string): void {
    const group = this.chunkVegetation.get(key);
    this.treeCounts.delete(key);
    this.builtKeys.delete(key);
    if (!group) return;
    this.group.remove(group);
    // Only the per-chunk instance buffers are released. Prototype geometries and
    // materials are shared by every chunk and must stay alive.
    group.traverse((obj) => {
      if ((obj as THREE.InstancedMesh).isInstancedMesh) (obj as THREE.InstancedMesh).dispose();
    });
    this.chunkVegetation.delete(key);
  }

  /** Release every chunk and the per-world prototype and material resources. */
  dispose(): void {
    for (const key of [...this.builtKeys]) this.removeChunk(key);
    for (const proto of Object.values(this.prototypes)) {
      proto.wood.dispose();
      proto.canopy?.dispose();
    }
    for (const m of this.barkMats.values()) m.dispose();
    for (const m of this.leafMats.values()) m.dispose();
    for (const m of this.materials) m.dispose();
    this.shared.rock.geo.dispose();
    this.shared.bush.geo.dispose();
    this.shared.flower.geo.dispose();
    this.barkMats.clear();
    this.leafMats.clear();
    this.materials.length = 0;
    this.group.clear();
  }

  /** Change foliage density; every built chunk is regenerated on the next sync. */
  setFoliageScale(scale: number): void {
    const next = Math.max(0.2, Math.min(2, scale));
    if (next === this.foliageScale) return;
    this.foliageScale = next;
    for (const key of [...this.builtKeys]) this.removeChunk(key);
  }

  /** Drop vegetation for chunks farther than `maxRadiusChunks` from (cx, cz). */
  pruneFar(cx: number, cz: number, maxRadiusChunks: number): number {
    let pruned = 0;
    const r2 = maxRadiusChunks * maxRadiusChunks;
    for (const key of [...this.builtKeys]) {
      const [x, z] = key.split(',').map(Number);
      const dx = x - cx;
      const dz = z - cz;
      if (dx * dx + dz * dz > r2) {
        this.removeChunk(key);
        pruned++;
      }
    }
    return pruned;
  }

  hasChunk(key: string): boolean {
    return this.builtKeys.has(key);
  }

  /**
   * Harvest/destroy vegetation near a point. Returns how many objects were
   * removed. Removals persist so regenerating the chunk keeps them gone.
   */
  removeNear(x: number, z: number, radius: number, kinds: Array<PlacedObject['kind']> = ['tree', 'bush']): number {
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const key = `${cx},${cz}`;
    const group = this.chunkVegetation.get(key);
    if (!group) return 0;
    const objects = this.generateChunkVegetation(cx, cz);
    let removed = 0;
    for (const o of objects) {
      if (!kinds.includes(o.kind)) continue;
      const d = Math.hypot(o.x - x, o.z - z);
      if (d <= radius) {
        this.removedKeys.add(o.seed);
        removed++;
      }
    }
    if (removed > 0) this.buildChunk(cx, cz);
    return removed;
  }

  /** Plant a tree/bush at a point (player action). */
  plant(kind: PlacedObject['kind'], species: string, x: number, z: number, y: number): PlacedObject {
    const obj: PlacedObject = {
      kind,
      species,
      x,
      z,
      y: y - 0.15,
      scale: 1,
      rot: Math.random() * Math.PI * 2,
      seed: this.objectKey(x, z),
    };
    this.planted.push(obj);
    this.buildChunk(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE));
    return obj;
  }

  get activeGroups(): number {
    return this.chunkVegetation.size;
  }

  /** Rough tree count estimate for stats (cached per chunk at build time). */
  private treeCounts = new Map<string, number>();

  countTrees(): number {
    let n = 0;
    for (const count of this.treeCounts.values()) n += count;
    return n;
  }

  serialize(): { planted: PlacedObject[]; removed: number[] } {
    return { planted: this.planted, removed: [...this.removedKeys] };
  }

  restore(data: { planted: PlacedObject[]; removed: number[] } | undefined): void {
    if (!data) return;
    this.planted = data.planted ?? [];
    this.removedKeys = new Set(data.removed ?? []);
  }
}
