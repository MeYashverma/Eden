/**
 * Deterministic pseudo-random number generation.
 *
 * Every stochastic decision in EDEN (terrain, vegetation, agents, events) is
 * derived from integer hashes of stable keys so the same world seed always
 * regenerates the same world.
 */

/** 32-bit integer hash of a string (FNV-1a). */
export function hashString(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Mix three 32-bit values into one well-distributed hash. */
export function hash3(x: number, y: number, z: number): number {
  let h = (x | 0) * 374761393 + (y | 0) * 668265263 + (z | 0) * 2147483647;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** Combine an arbitrary number of integers into one hash. */
export function hashCombine(...nums: number[]): number {
  let h = 0x9e3779b9;
  for (const n of nums) {
    h = (h ^ (n | 0)) >>> 0;
    h = Math.imul(h, 0x85ebca6b) >>> 0;
    h = (h ^ (h >>> 13)) >>> 0;
  }
  return h >>> 0;
}

/** Normalize a 32-bit hash to the [0, 1) range. */
export function hash01(...nums: number[]): number {
  return hashCombine(...nums) / 4294967296;
}

/**
 * Fast, high-quality 32-bit PRNG (mulberry32). Deterministic for a seed.
 */
export class RNG {
  private state: number;

  constructor(seed: number | string) {
    this.state = (typeof seed === 'string' ? hashString(seed) : seed >>> 0) || 1;
  }

  /** Next float in [0, 1). */
  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Float in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }

  /** Gaussian-ish value from the sum of three uniforms, mean 0, ~unit spread. */
  gauss(): number {
    return (this.next() + this.next() + this.next()) * 2 - 3;
  }

  /** Current internal state (for save/restore of a live generator). */
  getState(): number {
    return this.state;
  }

  setState(s: number): void {
    this.state = s >>> 0 || 1;
  }
}

/** Convenience: a fresh deterministic RNG for a hierarchical key. */
export function seededRng(...key: Array<number | string>): RNG {
  return new RNG(hashCombine(...key.map((k) => (typeof k === 'string' ? hashString(k) : k | 0))));
}
