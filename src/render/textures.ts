/**
 * Procedural texture generation.
 *
 * All surface textures are generated at boot from seeded noise on canvas
 * elements — no external downloads, fully offline, no licensing exposure.
 * Each generator returns tiling albedo/normal/roughness data suitable for
 * PBR materials. See docs/ASSETS.md for the asset manifest.
 */

import * as THREE from 'three';
import { simplex2, fbm, clamp, lerp, smoothstep } from '../core/noise';

export interface TerrainTextures {
  grass: THREE.Texture;
  dirt: THREE.Texture;
  rock: THREE.Texture;
  sand: THREE.Texture;
  snow: THREE.Texture;
  gravel: THREE.Texture;
  detailNormal: THREE.Texture;
  waterNormal: THREE.Texture;
  bark: THREE.Texture;
  leaf: THREE.Texture;
}

function makeCanvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D, ImageData] {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  return [canvas, ctx, ctx.createImageData(size, size)];
}

/** Wrap-aware fbm for seamless tiling: samples noise on a torus. */
function tileFbm(seed: number, u: number, v: number, freq: number, octaves = 4): number {
  // 4-way cross blend of the plane noise produces seamless tiles.
  const f = (x: number, y: number) => fbm(seed, x * freq, y * freq, { octaves });
  const a = f(u, v);
  const b = f(u - 1, v);
  const c = f(u, v - 1);
  const d = f(u - 1, v - 1);
  return (
    a * u * v +
    b * (1 - u) * v +
    c * u * (1 - v) +
    d * (1 - u) * (1 - v)
  );
}

function tileSimplex(seed: number, u: number, v: number, freq: number): number {
  const f = (x: number, y: number) => simplex2(seed, x * freq, y * freq);
  return (
    f(u, v) * u * v +
    f(u - 1, v) * (1 - u) * v +
    f(u, v - 1) * u * (1 - v) +
    f(u - 1, v - 1) * (1 - u) * (1 - v)
  );
}

interface LayerSpec {
  seed: number;
  base: [number, number, number];
  variation: [number, number, number];
  grain: number;
  ridgeAmount: number;
  speckle: number;
  contrast: number;
}

function generateLayer(size: number, spec: LayerSpec): HTMLCanvasElement {
  const [canvas, ctx, img] = makeCanvas(size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      // Large mottling
      const m1 = tileFbm(spec.seed, u, v, 6, 4);
      // Fine grain
      const m2 = tileSimplex(spec.seed + 5, u, v, 96) * spec.grain;
      // Ridged detail (cracks/veins)
      const m3 = Math.abs(tileSimplex(spec.seed + 9, u, v, 28)) * spec.ridgeAmount;
      // Speckles
      const h = (tileSimplex(spec.seed + 13, u, v, 220) * 0.5 + 0.5) * spec.speckle;

      let tone = m1 * spec.contrast + m2 + m3 + h;
      tone = clamp(tone * 0.5 + 0.5, 0, 1);

      const i = (y * size + x) * 4;
      d[i] = clamp(spec.base[0] + spec.variation[0] * tone * 255, 0, 255);
      d[i + 1] = clamp(spec.base[1] + spec.variation[1] * tone * 255, 0, 255);
      d[i + 2] = clamp(spec.base[2] + spec.variation[2] * tone * 255, 0, 255);
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** Sobel normal map from a height function h(u,v) → [0,1]. */
function heightToNormal(size: number, heightFn: (u: number, v: number) => number, strength: number): THREE.CanvasTexture {
  const [canvas, ctx, img] = makeCanvas(size);
  const d = img.data;
  const hAt = (x: number, y: number) => {
    const u = ((x % size) + size) % size / size;
    const v = ((y % size) + size) % size / size;
    return heightFn(u, v);
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (hAt(x + 1, y) - hAt(x - 1, y)) * strength;
      const dy = (hAt(x, y + 1) - hAt(x, y - 1)) * strength;
      let nx = -dx;
      let ny = -dy;
      const nz = 1;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx /= len; ny /= len;
      const i = (y * size + x) * 4;
      d[i] = (nx * 0.5 + 0.5) * 255;
      d[i + 1] = (ny * 0.5 + 0.5) * 255;
      d[i + 2] = (nz / len) * 0.5 * 255 + 127.5;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function toTexture(canvas: HTMLCanvasElement): THREE.Texture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

let cached: TerrainTextures | null = null;

export function generateTerrainTextures(size = 256): TerrainTextures {
  if (cached) return cached;

  const grass = toTexture(
    generateLayer(size, {
      seed: 101,
      base: [72, 96, 48],
      variation: [0.35, 0.42, 0.22],
      grain: 0.35,
      ridgeAmount: 0.12,
      speckle: 0.18,
      contrast: 0.55,
    }),
  );
  const dirt = toTexture(
    generateLayer(size, {
      seed: 211,
      base: [96, 72, 52],
      variation: [0.4, 0.3, 0.22],
      grain: 0.4,
      ridgeAmount: 0.22,
      speckle: 0.15,
      contrast: 0.6,
    }),
  );
  const rock = toTexture(
    generateLayer(size, {
      seed: 307,
      base: [104, 102, 98],
      variation: [0.32, 0.32, 0.3],
      grain: 0.25,
      ridgeAmount: 0.5,
      speckle: 0.1,
      contrast: 0.75,
    }),
  );
  const sand = toTexture(
    generateLayer(size, {
      seed: 401,
      base: [196, 178, 132],
      variation: [0.22, 0.2, 0.16],
      grain: 0.5,
      ridgeAmount: 0.06,
      speckle: 0.22,
      contrast: 0.35,
    }),
  );
  const snow = toTexture(
    generateLayer(size, {
      seed: 503,
      base: [226, 232, 240],
      variation: [0.1, 0.1, 0.12],
      grain: 0.3,
      ridgeAmount: 0.08,
      speckle: 0.1,
      contrast: 0.3,
    }),
  );
  const gravel = toTexture(
    generateLayer(size, {
      seed: 601,
      base: [120, 112, 100],
      variation: [0.35, 0.33, 0.3],
      grain: 0.55,
      ridgeAmount: 0.3,
      speckle: 0.3,
      contrast: 0.65,
    }),
  );

  const detailNormal = heightToNormal(
    size,
    (u, v) => clamp(0.5 + tileFbm(701, u, v, 18, 4) * 0.6 + tileSimplex(707, u, v, 70) * 0.25, 0, 1),
    2.2,
  );

  const waterNormal = heightToNormal(
    size,
    (u, v) => clamp(0.5 + tileFbm(811, u, v, 8, 4) * 0.5 + tileSimplex(823, u, v, 26) * 0.35, 0, 1),
    1.4,
  );

  const bark = toTexture(
    generateLayer(size, {
      seed: 907,
      base: [82, 62, 44],
      variation: [0.34, 0.26, 0.2],
      grain: 0.2,
      ridgeAmount: 0.55,
      speckle: 0.08,
      contrast: 0.8,
    }),
  );
  const leaf = toTexture(
    generateLayer(size, {
      seed: 953,
      base: [58, 92, 44],
      variation: [0.3, 0.4, 0.2],
      grain: 0.45,
      ridgeAmount: 0.15,
      speckle: 0.25,
      contrast: 0.5,
    }),
  );

  cached = { grass, dirt, rock, sand, snow, gravel, detailNormal, waterNormal, bark, leaf };
  return cached;
}

/** Small tiling canvas texture for UI backgrounds (subtle paper/stone grain). */
export function generateUiNoiseTexture(size = 128): THREE.Texture {
  const [canvas, ctx, img] = makeCanvas(size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = fbm(4242, x / size * 10, y / size * 10, { octaves: 3 }) * 0.5 + 0.5;
      const i = (y * size + x) * 4;
      const v = 18 + n * 14;
      d[i] = v; d[i + 1] = v + 2; d[i + 2] = v; d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}
