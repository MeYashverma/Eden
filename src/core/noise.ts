/**
 * Coherent gradient noise for terrain and environmental fields.
 *
 * Implements 2D simplex noise plus fractal constructions (fbm, ridged,
 * domain-warped) used by world generation. Pure and deterministic: the same
 * (seed, x, y) always produces the same value.
 */

import { hashCombine } from './rng';

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;

const GRAD2 = new Float32Array([
  1, 1, -1, 1, 1, -1, -1, -1,
  1, 0, -1, 0, 1, 0, -1, 0,
  0, 1, 0, -1, 0, 1, 0, -1,
  1, 1, -1, 1, 1, -1, -1, -1,
]);

/** Wrap an integer into [0, 256) so shared lattice corners hash identically. */
function wrap256(v: number): number {
  return ((v % 256) + 256) % 256;
}

/** Simplex noise in 2D, output approximately in [-1, 1]. */
export function simplex2(seed: number, x: number, y: number): number {
  const s = (seed | 0) * 0x9e3779b9;
  const skew = (x + y) * F2;
  const i = Math.floor(x + skew);
  const j = Math.floor(y + skew);
  const t = (i + j) * G2;
  const x0 = x - (i - t);
  const y0 = y - (j - t);

  let i1 = 0;
  let j1 = 1;
  if (x0 > y0) {
    i1 = 1;
    j1 = 0;
  }

  const x1 = x0 - i1 + G2;
  const y1 = y0 - j1 + G2;
  const x2 = x0 - 1 + 2 * G2;
  const y2 = y0 - 1 + 2 * G2;

  const ii = wrap256(i);
  const jj = wrap256(j);

  let n = 0;

  let t0 = 0.5 - x0 * x0 - y0 * y0;
  if (t0 > 0) {
    const gi = (hashCombine(s, ii, jj) % 16) * 2;
    t0 *= t0;
    n += t0 * t0 * (GRAD2[gi] * x0 + GRAD2[gi + 1] * y0);
  }
  let t1 = 0.5 - x1 * x1 - y1 * y1;
  if (t1 > 0) {
    const gi = (hashCombine(s, wrap256(ii + i1), wrap256(jj + j1)) % 16) * 2;
    t1 *= t1;
    n += t1 * t1 * (GRAD2[gi] * x1 + GRAD2[gi + 1] * y1);
  }
  let t2 = 0.5 - x2 * x2 - y2 * y2;
  if (t2 > 0) {
    const gi = (hashCombine(s, wrap256(ii + 1), wrap256(jj + 1)) % 16) * 2;
    t2 *= t2;
    n += t2 * t2 * (GRAD2[gi] * x2 + GRAD2[gi + 1] * y2);
  }

  return 70 * n;
}

export interface FbmOpts {
  octaves?: number;
  lacunarity?: number;
  gain?: number;
  frequency?: number;
}

/** Fractal Brownian motion — layered noise for rolling terrain. */
export function fbm(seed: number, x: number, y: number, opts: FbmOpts = {}): number {
  const octaves = opts.octaves ?? 5;
  const lacunarity = opts.lacunarity ?? 2.0;
  const gain = opts.gain ?? 0.5;
  let freq = opts.frequency ?? 1;
  let amp = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * simplex2(seed + o * 101, x * freq, y * freq);
    norm += amp;
    freq *= lacunarity;
    amp *= gain;
  }
  return sum / norm;
}

/** Ridged multifractal — sharp crests for mountain ranges. */
export function ridged(seed: number, x: number, y: number, opts: FbmOpts = {}): number {
  const octaves = opts.octaves ?? 5;
  const lacunarity = opts.lacunarity ?? 2.1;
  const gain = opts.gain ?? 0.55;
  let freq = opts.frequency ?? 1;
  let amp = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const n = 1 - Math.abs(simplex2(seed + o * 131, x * freq, y * freq));
    sum += amp * n * n;
    norm += amp;
    freq *= lacunarity;
    amp *= gain;
  }
  return sum / norm;
}

/** Billowy noise — rounded hills and dunes. */
export function billow(seed: number, x: number, y: number, opts: FbmOpts = {}): number {
  const octaves = opts.octaves ?? 4;
  let freq = opts.frequency ?? 1;
  let amp = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * (Math.abs(simplex2(seed + o * 173, x * freq, y * freq)) * 2 - 1);
    norm += amp;
    freq *= 2.03;
    amp *= 0.5;
  }
  return sum / norm;
}

/**
 * Domain-warped fbm: feeds one noise field into another's coordinates to
 * produce meandering ridges, valleys and coastlines instead of blobby noise.
 */
export function warpedFbm(
  seed: number,
  x: number,
  y: number,
  warpStrength = 0.35,
  opts: FbmOpts = {},
): number {
  const qx = fbm(seed + 7919, x, y, { octaves: 3, frequency: opts.frequency ?? 1 });
  const qy = fbm(seed + 104729, x, y, { octaves: 3, frequency: opts.frequency ?? 1 });
  return fbm(seed, x + warpStrength * qx, y + warpStrength * qy, opts);
}

/** Smoothly remap v from [a,b] to [0,1] with clamping. */
export function smoothstep(a: number, b: number, v: number): number {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a || 1e-6)));
  return t * t * (3 - 2 * t);
}

/** Linear remap with clamp. */
export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}
