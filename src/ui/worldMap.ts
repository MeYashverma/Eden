/**
 * World map — rasterised from the actual world field (heights, biomes, water,
 * roads, settlements) with explored-area memory, waypoints, zoom & pan.
 * The minimap shares this renderer at low zoom.
 */

import { WorldGen } from '../world/worldGen';
import type { Hydrology } from '../world/hydrology';
import type { SettlementRecord } from '../sim/settlements';
import type { Discovery } from '../core/discoveries';
import { clamp, lerp } from '../core/math';
import { SEA_LEVEL, type BiomeId } from '../world/types';

const BIOME_COLORS: Record<BiomeId, [number, number, number]> = {
  deep_ocean: [28, 52, 84],
  shallow_ocean: [42, 92, 128],
  beach: [196, 178, 128],
  wetland: [78, 118, 86],
  grassland: [118, 158, 92],
  temperate_forest: [72, 118, 68],
  dense_woodland: [54, 96, 56],
  tropical_forest: [52, 118, 62],
  boreal_forest: [56, 92, 74],
  tundra: [148, 156, 142],
  desert: [198, 172, 118],
  alpine: [168, 168, 164],
  river: [68, 122, 158],
};

export interface MapView {
  centerX: number;
  centerZ: number;
  /** metres per pixel */
  zoom: number;
}

export interface MapEntities {
  playerX: number;
  playerZ: number;
  playerYaw: number;
  settlements: SettlementRecord[];
  discoveries: Discovery[];
  waypoints: Array<{ x: number; z: number; label: string }>;
  citizens: Array<{ x: number; z: number; name: string }>;
  trackedX?: number;
  trackedZ?: number;
  trackedLabel?: string;
}

export class WorldMapRenderer {
  private canvas: HTMLCanvasElement;
  private gen: WorldGen;
  private hydro: Hydrology | null = null;
  /** Explored memory: 0..255 per cell in a coarse grid keyed by region. */
  explored = new Map<string, number>();
  view: MapView = { centerX: 0, centerZ: 0, zoom: 1.2 };
  private dragging = false;
  private lastPointer = { x: 0, y: 0 };

  constructor(canvas: HTMLCanvasElement, gen: WorldGen, hydro?: Hydrology) {
    this.canvas = canvas;
    this.gen = gen;
    this.hydro = hydro ?? null;
  }

  setHydro(hydro: Hydrology): void {
    this.hydro = hydro;
  }

  /** Mark an area explored (radius in metres). */
  reveal(x: number, z: number, radius: number): void {
    const cell = 64;
    const r = Math.ceil(radius / cell);
    const cx = Math.round(x / cell);
    const cz = Math.round(z / cell);
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dz * dz > r * r) continue;
        const key = `${cx + dx},${cz + dz}`;
        this.explored.set(key, 255);
      }
    }
  }

  isExplored(x: number, z: number): boolean {
    const cell = 64;
    return this.explored.has(`${Math.round(x / cell)},${Math.round(z / cell)}`);
  }

  attachInteraction(): void {
    const el = this.canvas;
    el.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.lastPointer = { x: e.clientX, y: e.clientY };
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const rect = el.getBoundingClientRect();
      const mpp = this.metresPerPixel(rect.width);
      this.view.centerX -= (e.clientX - this.lastPointer.x) * mpp;
      this.view.centerZ -= (e.clientY - this.lastPointer.y) * mpp;
      this.lastPointer = { x: e.clientX, y: e.clientY };
    });
    el.addEventListener('pointerup', () => {
      this.dragging = false;
    });
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 1.18 : 0.85;
      this.view.zoom = clamp(this.view.zoom * factor, 0.12, 8);
    }, { passive: false });
  }

  private metresPerPixel(cssWidth: number): number {
    return this.view.zoom * (1000 / Math.max(1, cssWidth));
  }

  /**
   * Draw the map. `mode` is 'full' (map panel) or 'mini' (HUD minimap).
   * Pass `target` to render into a specific canvas (minimap vs panel).
   */
  render(entities: MapEntities, mode: 'full' | 'mini' = 'full', target?: HTMLCanvasElement): void {
    const canvas = target ?? this.canvas;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = canvas.clientWidth || 300;
    const h = canvas.clientHeight || 300;
    if (canvas.width !== Math.floor(w * dpr)) canvas.width = Math.floor(w * dpr);
    if (canvas.height !== Math.floor(h * dpr)) canvas.height = Math.floor(h * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const mpp = this.metresPerPixel(w);
    const halfW = (w / 2) * mpp;
    const halfH = (h / 2) * mpp;

    const img = ctx.createImageData(w, h);
    const data = img.data;
    const step = mode === 'mini' ? 2 : 1;

    for (let py = 0; py < h; py += step) {
      for (let px = 0; px < w; px += step) {
        const wx = this.view.centerX + (px - w / 2) * mpp;
        const wz = this.view.centerZ + (py - h / 2) * mpp;
        const height = this.gen.baseHeight(wx, wz);
        const sample = this.gen.sample(wx, wz);
        const color = BIOME_COLORS[sample.biome];

        // Elevation shading: sun from the north-west.
        const hx = this.gen.baseHeight(wx + mpp * 2, wz);
        const shade = clamp(1 + (height - hx) * 0.045, 0.62, 1.32);
        const fogOfWar = !this.isExplored(wx, wz) && mode === 'mini' ? 0.55 : this.isExplored(wx, wz) ? 1 : 0.62;

        // River mask adds water lines
        const river = this.gen.riverMask(wx, wz);
        let r = color[0] * shade;
        let g = color[1] * shade;
        let b = color[2] * shade;
        if (river > 0.12 && height > SEA_LEVEL - 0.5) {
          r = lerp(r, 52, river * 0.85);
          g = lerp(g, 112, river * 0.85);
          b = lerp(b, 158, river * 0.85);
        }
        // Live hydrology water
        if (this.hydro) {
          const surf = this.hydro.surfaceAt(wx, wz);
          if (surf !== null && surf > height + 0.05) {
            r = lerp(r, 46, 0.7);
            g = lerp(g, 100, 0.7);
            b = lerp(b, 140, 0.7);
          }
        }

        for (let dy = 0; dy < step; dy++) {
          for (let dx = 0; dx < step; dx++) {
            const i = ((py + dy) * w + (px + dx)) * 4;
            data[i] = r * fogOfWar;
            data[i + 1] = g * fogOfWar;
            data[i + 2] = b * fogOfWar;
            data[i + 3] = 255;
          }
        }
      }
    }
    ctx.putImageData(img, 0, 0);

    // ---- overlays --------------------------------------------------------
    const toScreen = (x: number, z: number): [number, number] => [
      (x - this.view.centerX) / mpp + w / 2,
      (z - this.view.centerZ) / mpp + h / 2,
    ];

    // Roads
    for (const s of entities.settlements) {
      if (!this.isExplored(s.x, s.z) && mode === 'full') {
        // still show roads of discovered settlements only
        if (!s.discovered) continue;
      }
      for (const road of s.roads) {
        ctx.strokeStyle = 'rgba(222, 200, 160, 0.75)';
        ctx.lineWidth = mode === 'mini' ? 1 : 1.6;
        ctx.beginPath();
        road.points.forEach((p, i) => {
          const [sx, sy] = toScreen(p.x, p.z);
          if (i === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        });
        ctx.stroke();
      }
    }

    // Settlement markers
    for (const s of entities.settlements) {
      if (!s.discovered && mode === 'mini') continue;
      const [sx, sy] = toScreen(s.x, s.z);
      if (sx < -20 || sy < -20 || sx > w + 20 || sy > h + 20) continue;
      ctx.fillStyle = 'rgba(216, 162, 74, 0.95)';
      ctx.beginPath();
      ctx.arc(sx, sy, mode === 'mini' ? 3 : 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(20, 16, 10, 0.8)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      if (mode === 'full') {
        ctx.font = '600 11px system-ui';
        ctx.fillStyle = 'rgba(240, 230, 210, 0.95)';
        ctx.fillText(s.name, sx + 8, sy + 3);
      }
    }

    // Discoveries
    for (const d of entities.discoveries) {
      const [sx, sy] = toScreen(d.x, d.z);
      if (sx < -10 || sy < -10 || sx > w + 10 || sy > h + 10) continue;
      ctx.fillStyle = 'rgba(126, 201, 143, 0.9)';
      ctx.beginPath();
      ctx.moveTo(sx, sy - 5);
      ctx.lineTo(sx + 4, sy + 3);
      ctx.lineTo(sx - 4, sy + 3);
      ctx.closePath();
      ctx.fill();
      if (mode === 'full') {
        ctx.font = '10px system-ui';
        ctx.fillStyle = 'rgba(190, 220, 195, 0.85)';
        ctx.fillText(d.name, sx + 7, sy + 2);
      }
    }

    // Waypoints
    for (const wp of entities.waypoints) {
      const [sx, sy] = toScreen(wp.x, wp.z);
      ctx.strokeStyle = 'rgba(216, 162, 74, 0.9)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(sx, sy - 7);
      ctx.lineTo(sx, sy + 7);
      ctx.moveTo(sx - 5, sy);
      ctx.lineTo(sx + 5, sy);
      ctx.stroke();
      if (mode === 'full' && wp.label) {
        ctx.font = '10px system-ui';
        ctx.fillStyle = 'rgba(216, 162, 74, 0.9)';
        ctx.fillText(wp.label, sx + 7, sy - 5);
      }
    }

    // Tracked target
    if (entities.trackedX !== undefined && entities.trackedZ !== undefined) {
      const [sx, sy] = toScreen(entities.trackedX, entities.trackedZ);
      ctx.strokeStyle = 'rgba(122, 184, 216, 0.95)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(sx, sy, 9, 0, Math.PI * 2);
      ctx.stroke();
      if (entities.trackedLabel) {
        ctx.font = '600 10px system-ui';
        ctx.fillStyle = 'rgba(122, 184, 216, 0.95)';
        ctx.fillText(entities.trackedLabel, sx + 11, sy + 3);
      }
    }

    // Player arrow
    const [px, py] = toScreen(entities.playerX, entities.playerZ);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(-entities.playerYaw + Math.PI);
    ctx.fillStyle = '#f2e8d4';
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(5.5, 6);
    ctx.lineTo(0, 2.5);
    ctx.lineTo(-5.5, 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Frame + compass for the full map
    if (mode === 'full') {
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
      ctx.font = '600 10px system-ui';
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.fillText('N', w / 2 - 3, 16);
      // Scale bar
      const barMetres = 100;
      const barPx = barMetres / mpp;
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillRect(14, h - 22, barPx, 3);
      ctx.fillText(`${barMetres} m`, 14, h - 28);
    }
  }

  /** Convert a canvas point to world coordinates. */
  canvasToWorld(cssX: number, cssY: number): { x: number; z: number } {
    const rect = this.canvas.getBoundingClientRect();
    const mpp = this.metresPerPixel(rect.width);
    return {
      x: this.view.centerX + (cssX - rect.width / 2) * mpp,
      z: this.view.centerZ + (cssY - rect.height / 2) * mpp,
    };
  }

  serialize(): Array<[number, number]> {
    return [...this.explored.keys()].map((k) => {
      const [x, z] = k.split(',').map(Number);
      return [x, z] as [number, number];
    });
  }

  restore(cells: Array<[number, number]> | undefined): void {
    if (!cells) return;
    this.explored.clear();
    for (const [x, z] of cells) this.explored.set(`${x},${z}`, 255);
  }
}
