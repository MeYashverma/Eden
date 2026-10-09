/**
 * Sparse terrain modifications applied on top of deterministic base terrain.
 *
 * Storage is a grid of per-cell height deltas (2 m cells) plus material paint.
 * Chunks sample this layer when they build their mesh, so edits and base
 * terrain share the same continuous surface — chunk seams stay seamless and
 * saves only need the sparse delta, never whole heightfields.
 */

export const EDIT_CELL = 2;

export interface TerrainPaintCell {
  mat: number; // material layer id
  weight: number; // 0..1
}

export type BrushMode =
  | 'raise'
  | 'lower'
  | 'smooth'
  | 'flatten'
  | 'paint'
  | 'water_channel'
  | 'revegetate';

export class TerrainEdits {
  /** key = ix * 1e6 + iz (offset to allow negatives) → height delta in metres */
  readonly deltas = new Map<number, number>();
  /** key → painted material override */
  readonly paint = new Map<number, number>();
  /** count of brush operations applied (for stats/saves) */
  opCount = 0;

  private static key(ix: number, iz: number): number {
    return (ix + 500000) * 1000000 + (iz + 500000);
  }

  static worldToCell(x: number, z: number): [number, number] {
    return [Math.floor(x / EDIT_CELL), Math.floor(z / EDIT_CELL)];
  }

  deltaAt(x: number, z: number): number {
    const [ix, iz] = TerrainEdits.worldToCell(x, z);
    // Bilinear-ish: average the 4 nearest cells for a smoother surface.
    const fx = x / EDIT_CELL - ix - 0.5;
    const fz = z / EDIT_CELL - iz - 0.5;
    const x0 = Math.floor(fx);
    const z0 = Math.floor(fz);
    const tx = fx - x0;
    const tz = fz - z0;
    const d00 = this.deltas.get(TerrainEdits.key(ix + x0, iz + z0)) ?? 0;
    const d10 = this.deltas.get(TerrainEdits.key(ix + x0 + 1, iz + z0)) ?? 0;
    const d01 = this.deltas.get(TerrainEdits.key(ix + x0, iz + z0 + 1)) ?? 0;
    const d11 = this.deltas.get(TerrainEdits.key(ix + x0 + 1, iz + z0 + 1)) ?? 0;
    return (
      d00 * (1 - tx) * (1 - tz) +
      d10 * tx * (1 - tz) +
      d01 * (1 - tx) * tz +
      d11 * tx * tz
    );
  }

  paintAt(x: number, z: number): TerrainPaintCell | null {
    const [ix, iz] = TerrainEdits.worldToCell(x, z);
    const m = this.paint.get(TerrainEdits.key(ix, iz));
    return m === undefined ? null : { mat: m, weight: 1 };
  }

  /** Apply a circular brush. `strength` is metres for sculpt modes. */
  applyBrush(
    x: number,
    z: number,
    radius: number,
    strength: number,
    mode: BrushMode,
    baseHeightAt: (x: number, z: number) => number,
    paintMat = 0,
  ): void {
    this.opCount++;
    const r2 = radius * radius;
    const minIx = Math.floor((x - radius) / EDIT_CELL);
    const maxIx = Math.ceil((x + radius) / EDIT_CELL);
    const minIz = Math.floor((z - radius) / EDIT_CELL);
    const maxIz = Math.ceil((z + radius) / EDIT_CELL);

    if (mode === 'flatten') {
      const target = baseHeightAt(x, z) + this.deltaAt(x, z);
      for (let ix = minIx; ix <= maxIx; ix++) {
        for (let iz = minIz; iz <= maxIz; iz++) {
          const wx = ix * EDIT_CELL + EDIT_CELL / 2;
          const wz = iz * EDIT_CELL + EDIT_CELL / 2;
          const d2 = (wx - x) * (wx - x) + (wz - z) * (wz - z);
          if (d2 > r2) continue;
          const t = 1 - Math.sqrt(d2) / radius;
          const falloff = t * t * (3 - 2 * t);
          const key = TerrainEdits.key(ix, iz);
          const cur = baseHeightAt(wx, wz) + (this.deltas.get(key) ?? 0);
          const next = cur + (target - cur) * falloff * Math.min(1, strength);
          this.deltas.set(key, next - baseHeightAt(wx, wz));
        }
      }
      return;
    }

    if (mode === 'smooth') {
      const snapshot = new Map<number, number>();
      for (let ix = minIx; ix <= maxIx; ix++) {
        for (let iz = minIz; iz <= maxIz; iz++) {
          const wx = ix * EDIT_CELL + EDIT_CELL / 2;
          const wz = iz * EDIT_CELL + EDIT_CELL / 2;
          const d2 = (wx - x) * (wx - x) + (wz - z) * (wz - z);
          if (d2 > r2) continue;
          const key = TerrainEdits.key(ix, iz);
          let sum = 0;
          let n = 0;
          for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
              sum += baseHeightAt(wx + dx * EDIT_CELL, wz + dz * EDIT_CELL) + (this.deltas.get(TerrainEdits.key(ix + dx, iz + dz)) ?? 0);
              n++;
            }
          }
          snapshot.set(key, sum / n);
        }
      }
      for (const [key, avg] of snapshot) {
        const ix = Math.floor(key / 1000000) - 500000;
        const iz = (key % 1000000) - 500000;
        const wx = ix * EDIT_CELL + EDIT_CELL / 2;
        const wz = iz * EDIT_CELL + EDIT_CELL / 2;
        const d2 = (wx - x) * (wx - x) + (wz - z) * (wz - z);
        const t = 1 - Math.sqrt(d2) / radius;
        const falloff = t * t * (3 - 2 * t);
        const cur = baseHeightAt(wx, wz) + (this.deltas.get(key) ?? 0);
        const next = cur + (avg - cur) * falloff * Math.min(1, strength);
        this.deltas.set(key, next - baseHeightAt(wx, wz));
      }
      return;
    }

    if (mode === 'paint') {
      for (let ix = minIx; ix <= maxIx; ix++) {
        for (let iz = minIz; iz <= maxIz; iz++) {
          const wx = ix * EDIT_CELL + EDIT_CELL / 2;
          const wz = iz * EDIT_CELL + EDIT_CELL / 2;
          const d2 = (wx - x) * (wx - x) + (wz - z) * (wz - z);
          if (d2 > r2) continue;
          const t = 1 - Math.sqrt(d2) / radius;
          if (t * t * (3 - 2 * t) > 0.25) {
            this.paint.set(TerrainEdits.key(ix, iz), paintMat);
          }
        }
      }
      return;
    }

    // raise / lower / water_channel / revegetate (height part)
    for (let ix = minIx; ix <= maxIx; ix++) {
      for (let iz = minIz; iz <= maxIz; iz++) {
        const wx = ix * EDIT_CELL + EDIT_CELL / 2;
        const wz = iz * EDIT_CELL + EDIT_CELL / 2;
        const d2 = (wx - x) * (wx - x) + (wz - z) * (wz - z);
        if (d2 > r2) continue;
        const t = 1 - Math.sqrt(d2) / radius;
        const falloff = t * t * (3 - 2 * t);
        const key = TerrainEdits.key(ix, iz);
        const cur = this.deltas.get(key) ?? 0;
        if (mode === 'lower' || mode === 'water_channel') {
          this.deltas.set(key, cur - strength * falloff);
        } else {
          this.deltas.set(key, cur + strength * falloff);
        }
      }
    }
  }

  /** Total number of edited cells (bounded — brush output is quantised to 2 m). */
  get cellCount(): number {
    return this.deltas.size;
  }

  serialize(): { d: number[]; p: number[] } {
    const d: number[] = [];
    for (const [k, v] of this.deltas) {
      d.push(k, Math.round(v * 1000) / 1000);
    }
    const p: number[] = [];
    for (const [k, v] of this.paint) {
      p.push(k, v);
    }
    return { d, p };
  }

  static deserialize(data: { d: number[]; p: number[] } | undefined): TerrainEdits {
    const e = new TerrainEdits();
    if (!data) return e;
    for (let i = 0; i < data.d.length; i += 2) e.deltas.set(data.d[i], data.d[i + 1]);
    for (let i = 0; i < data.p.length; i += 2) e.paint.set(data.p[i], data.p[i + 1]);
    return e;
  }

  clear(): void {
    this.deltas.clear();
    this.paint.clear();
    this.opCount = 0;
  }
}
