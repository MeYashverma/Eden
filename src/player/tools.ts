/**
 * Player tools: terrain sculpting, material painting, vegetation planting,
 * building placement and contextual interaction. All edits flow through
 * TerrainEdits / Simulation so they persist and affect collision, hydrology
 * and navigation immediately.
 */

import * as THREE from 'three';
import type { WorldGen } from '../world/worldGen';
import type { Hydrology } from '../world/hydrology';
import type { ChunkManager } from '../world/chunks';
import type { VegetationSystem, PlacedObject } from '../world/vegetation';
import type { Simulation } from '../sim/simulation';
import type { BrushMode } from '../world/terrainEdits';
import { buildStructure, buildWell, buildTower, type BuildingType, type SharedBuildingMaterials } from '../sim/buildings';
import { clamp } from '../core/math';
import { RNG } from '../core/rng';
import { TerrainEdits } from '../world/terrainEdits';

export type ToolId =
  | 'none'
  | 'raise' | 'lower' | 'smooth' | 'flatten'
  | 'paint_grass' | 'paint_dirt' | 'paint_rock' | 'paint_sand' | 'paint_snow' | 'paint_gravel'
  | 'plant_tree' | 'plant_bush' | 'plant_flower' | 'remove_vegetation'
  | 'build_house' | 'build_cottage' | 'build_barn' | 'build_shop' | 'build_well' | 'build_tower' | 'build_road'
  | 'water_channel'
  | 'inspect' | 'interact';

export interface ToolDef {
  id: ToolId;
  label: string;
  icon: string;
  category: 'terrain' | 'nature' | 'build' | 'utility';
  brushRadius?: number;
  strength?: number;
  description: string;
}

export const TOOLS: ToolDef[] = [
  { id: 'raise', label: 'Raise', icon: 'terrain-up', category: 'terrain', brushRadius: 12, strength: 1.1, description: 'Lift the land. Hold to build hills.' },
  { id: 'lower', label: 'Lower', icon: 'terrain-down', category: 'terrain', brushRadius: 12, strength: 1.1, description: 'Carve downward into soil and rock.' },
  { id: 'smooth', label: 'Smooth', icon: 'terrain-smooth', category: 'terrain', brushRadius: 16, strength: 1.2, description: 'Soften ridges and rough ground.' },
  { id: 'flatten', label: 'Level', icon: 'terrain-flat', category: 'terrain', brushRadius: 14, strength: 1, description: 'Flatten toward the centre height.' },
  { id: 'water_channel', label: 'Channel', icon: 'water', category: 'terrain', brushRadius: 9, strength: 0.9, description: 'Dig a channel that guides water.' },
  { id: 'paint_grass', label: 'Grass', icon: 'paint', category: 'terrain', brushRadius: 10, strength: 1, description: 'Paint a grass surface layer.' },
  { id: 'paint_dirt', label: 'Soil', icon: 'paint', category: 'terrain', brushRadius: 10, strength: 1, description: 'Paint exposed soil.' },
  { id: 'paint_rock', label: 'Rock', icon: 'paint', category: 'terrain', brushRadius: 10, strength: 1, description: 'Paint bare rock.' },
  { id: 'paint_sand', label: 'Sand', icon: 'paint', category: 'terrain', brushRadius: 10, strength: 1, description: 'Paint sand.' },
  { id: 'paint_snow', label: 'Snow', icon: 'paint', category: 'terrain', brushRadius: 10, strength: 1, description: 'Paint snow cover.' },
  { id: 'paint_gravel', label: 'Gravel', icon: 'paint', category: 'terrain', brushRadius: 10, strength: 1, description: 'Paint gravel.' },
  { id: 'plant_tree', label: 'Tree', icon: 'tree', category: 'nature', description: 'Plant a sapling where it can thrive.' },
  { id: 'plant_bush', label: 'Bush', icon: 'leaf', category: 'nature', description: 'Plant a shrub.' },
  { id: 'plant_flower', label: 'Flowers', icon: 'flower', category: 'nature', description: 'Scatter wildflowers.' },
  { id: 'remove_vegetation', label: 'Clear', icon: 'axe', category: 'nature', brushRadius: 6, description: 'Remove trees and bushes (yields timber).' },
  { id: 'build_house', label: 'House', icon: 'home', category: 'build', description: 'Place a family home.' },
  { id: 'build_cottage', label: 'Cottage', icon: 'home', category: 'build', description: 'Place a small cottage.' },
  { id: 'build_barn', label: 'Barn', icon: 'barn', category: 'build', description: 'Place a barn with a crop field.' },
  { id: 'build_shop', label: 'Shop', icon: 'shop', category: 'build', description: 'Place a shop.' },
  { id: 'build_well', label: 'Well', icon: 'water', category: 'build', description: 'Place a village well.' },
  { id: 'build_tower', label: 'Tower', icon: 'tower', category: 'build', description: 'Place a watchtower.' },
  { id: 'water_channel', label: 'Channel', icon: 'water', category: 'build', brushRadius: 9, strength: 0.9, description: 'Dig a water channel.' },
  { id: 'inspect', label: 'Inspect', icon: 'info', category: 'utility', description: 'Inspect whatever you point at.' },
  { id: 'interact', label: 'Interact', icon: 'hand', category: 'utility', description: 'Use the world with your hands.' },
];

export interface InteractionCandidate {
  kind: 'citizen' | 'animal' | 'building' | 'tree' | 'rock' | 'water' | 'crop' | 'vehicle';
  label: string;
  id: string;
  x: number;
  y: number;
  z: number;
  distance: number;
  data?: unknown;
}

export interface ToolContext {
  gen: WorldGen;
  hydro: Hydrology;
  chunks: ChunkManager;
  veg: VegetationSystem;
  simulation: Simulation;
  scene: THREE.Scene;
  buildingMaterials: SharedBuildingMaterials;
}

export interface ToolResult {
  message: string;
  ok: boolean;
}

export class ToolSystem {
  activeTool: ToolId = 'none';
  brushRadius = 12;
  strength = 1;
  /** Rotation for building placement. */
  placementRotation = 0;
  /** Ghost preview mesh. */
  private ghost: THREE.Object3D | null = null;
  private ghostValid = false;
  /** Undo stack of terrain edit snapshots (bounded). */
  private undoStack: Array<{ d: number[]; p: number[] }> = [];
  private maxUndo = 24;

  setTool(id: ToolId): void {
    this.activeTool = id;
    const def = TOOLS.find((t) => t.id === id);
    if (def?.brushRadius) this.brushRadius = def.brushRadius;
    if (def?.strength) this.strength = def.strength;
    this.clearGhost();
  }

  private saveUndo(ctx: ToolContext): void {
    this.undoStack.push(ctx.gen.edits.serialize());
    if (this.undoStack.length > this.maxUndo) this.undoStack.shift();
  }

  undoTerrain(ctx: ToolContext): ToolResult {
    const snap = this.undoStack.pop();
    if (!snap) return { message: 'Nothing to undo.', ok: false };
    const fresh = TerrainEdits.deserialize(snap);
    ctx.gen.edits.deltas.clear();
    ctx.gen.edits.paint.clear();
    for (const [k, v] of fresh.deltas) ctx.gen.edits.deltas.set(k, v);
    for (const [k, v] of fresh.paint) ctx.gen.edits.paint.set(k, v);
    ctx.hydro.invalidateTerrain(-1e6, -1e6, 1e6, 1e6);
    return { message: 'Undid last terrain edit.', ok: true };
  }

  /** Current world point the player is aiming at. */
  aimPoint(ctx: ToolContext, origin: THREE.Vector3, dir: THREE.Vector3): THREE.Vector3 | null {
    const hit = ctx.chunks.raycastTerrain(origin, dir, 220);
    return hit ? hit.point : null;
  }

  /** Continuous terrain brush while the mouse is held. */
  applyBrush(point: THREE.Vector3, dt: number): ToolResult {
    const mode = this.activeTool as BrushMode;
    const t = this as ToolSystem;
    const ctx = this.ctx;
    if (!ctx) return { message: '', ok: false };

    if (this.lastBrushTime === 0) this.saveUndo(ctx);

    const paintMap: Record<string, number> = {
      paint_grass: 0,
      paint_dirt: 1,
      paint_rock: 2,
      paint_sand: 3,
      paint_snow: 4,
      paint_gravel: 5,
    };

    if (this.activeTool in paintMap) {
      ctx.gen.edits.applyBrush(point.x, point.z, this.brushRadius, 1, 'paint', (x, z) => ctx.gen.baseHeight(x, z), paintMap[this.activeTool]);
    } else {
      const rate = clamp(this.strength * dt * 2.2, 0, 1.2);
      ctx.gen.edits.applyBrush(
        point.x,
        point.z,
        this.brushRadius,
        rate,
        mode,
        (x, z) => ctx.gen.baseHeight(x, z),
      );
    }

    // Update hydrology + chunk meshes around the edit.
    ctx.hydro.invalidateTerrain(
      point.x - this.brushRadius - 4,
      point.z - this.brushRadius - 4,
      point.x + this.brushRadius + 4,
      point.z + this.brushRadius + 4,
    );
    ctx.chunks.markDirty(point.x, point.z, this.brushRadius + 8);
    ctx.veg.buildChunk(Math.floor(point.x / 128), Math.floor(point.z / 128));
    this.lastBrushTime = performance.now();
    return { message: '', ok: true };
  }

  private lastBrushTime = 0;
  ctx: ToolContext | null = null;

  endBrush(): void {
    this.lastBrushTime = 0;
  }

  /** One-shot tool actions on a point. */
  useTool(point: THREE.Vector3, ctx: ToolContext): ToolResult {
    this.ctx = ctx;
    switch (this.activeTool) {
      case 'plant_tree':
      case 'plant_bush':
      case 'plant_flower': {
        const sample = ctx.gen.sample(point.x, point.z);
        if (sample.height < 0.3) return { message: 'Too close to water to plant.', ok: false };
        if (sample.slope > 0.55) return { message: 'Too steep for planting.', ok: false };
        const kind = this.activeTool === 'plant_tree' ? 'tree' : this.activeTool === 'plant_bush' ? 'bush' : 'flower';
        const species = kind === 'tree' ? (sample.temperature > 18 ? 'palm' : sample.temperature < 2 ? 'pine' : 'oak') : kind;
        ctx.veg.plant(kind as PlacedObject['kind'], species as string, point.x, point.z, point.y);
        return { message: `Planted ${kind}.`, ok: true };
      }
      case 'remove_vegetation': {
        const removed = ctx.veg.removeNear(point.x, point.z, this.brushRadius);
        if (removed > 0) {
          ctx.simulation.timberHarvested += removed * 2;
          return { message: `Cleared ${removed} plants (+${removed * 2} timber).`, ok: true };
        }
        return { message: 'Nothing to clear here.', ok: false };
      }
      case 'build_house':
      case 'build_cottage':
      case 'build_barn':
      case 'build_shop':
      case 'build_well':
      case 'build_tower': {
        return this.placeBuilding(point, ctx);
      }
      default:
        return { message: '', ok: false };
    }
  }

  private placeBuilding(point: THREE.Vector3, ctx: ToolContext): ToolResult {
    const sample = ctx.gen.sample(point.x, point.z);
    if (sample.height < 0.6) return { message: 'Cannot build underwater.', ok: false };
    if (sample.slope > 0.42) return { message: 'Ground too steep for foundations.', ok: false };

    this.saveUndo(ctx);
    const typeMap: Record<string, BuildingType> = {
      build_house: 'house',
      build_cottage: 'cottage',
      build_barn: 'barn',
      build_shop: 'shop',
      build_well: 'well',
      build_tower: 'tower',
    };
    const type = typeMap[this.activeTool];
    const mats = ctx.buildingMaterials;
    const kit =
      type === 'well'
        ? buildWell(mats)
        : type === 'tower'
          ? buildTower(mats)
          : buildStructure({ type, rng: new RNG(Math.floor(Math.random() * 1e9)), mats, rotation: this.placementRotation });

    kit.group.position.set(point.x, point.y - 0.05, point.z);
    kit.group.rotation.y = this.placementRotation;
    ctx.scene.add(kit.group);

    // Register with the nearest settlement (or a player-homestead record).
    const settlement = ctx.simulation.ensureSettlementNear(point.x, point.z, 400);
    if (settlement) {
      ctx.simulation.addBuilding(settlement, type, point.x, point.z, this.placementRotation);
    }
    return { message: `Placed ${type}.`, ok: true };
  }

  /** Update/generate the placement preview ghost. */
  updateGhost(point: THREE.Vector3 | null, ctx: ToolContext): void {
    this.ctx = ctx;
    const isBuild = this.activeTool.startsWith('build_');
    if (!point || !isBuild) {
      this.clearGhost();
      return;
    }
    const sample = ctx.gen.sample(point.x, point.z);
    const valid = sample.height > 0.6 && sample.slope < 0.42;
    if (!this.ghost) {
      const mats = ctx.buildingMaterials;
      const typeMap: Record<string, BuildingType> = {
        build_house: 'house',
        build_cottage: 'cottage',
        build_barn: 'barn',
        build_shop: 'shop',
        build_well: 'well',
        build_tower: 'tower',
      };
      const type = typeMap[this.activeTool] ?? 'house';
      const kit = type === 'well' ? buildWell(mats) : type === 'tower' ? buildTower(mats) : buildStructure({ type, rng: new RNG(Math.floor(Math.random() * 1e9)), mats });
      this.ghost = kit.group;
      this.ghost.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | undefined;
        if (m) {
          const clone = m.clone();
          (clone as THREE.MeshStandardMaterial).transparent = true;
          (clone as THREE.MeshStandardMaterial).opacity = 0.55;
          (clone as THREE.MeshStandardMaterial).depthWrite = false;
          (o as THREE.Mesh).material = clone;
        }
      });
      ctx.scene.add(this.ghost);
    }
    this.ghost.position.set(point.x, point.y - 0.05, point.z);
    this.ghost.rotation.y = this.placementRotation;
    this.ghostValid = valid;
    this.ghost.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (m && m.color) {
        m.color.setHex(valid ? 0x9fd8a8 : 0xd88a8a);
      }
    });
  }

  get placementValid(): boolean {
    return this.ghostValid;
  }

  clearGhost(): void {
    if (this.ghost && this.ghost.parent) {
      this.ghost.parent.remove(this.ghost);
      this.ghost.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
      });
    }
    this.ghost = null;
    this.ghostValid = false;
  }

  /** Contextual interaction candidates near a point. */
  findInteraction(point: THREE.Vector3, ctx: ToolContext): InteractionCandidate[] {
    const out: InteractionCandidate[] = [];
    const px = point.x;
    const pz = point.z;

    const citizen = ctx.simulation.citizens.nearestTo(px, pz, 6);
    if (citizen) {
      out.push({
        kind: 'citizen',
        label: `${citizen.name} (${citizen.occupation})`,
        id: `citizen-${citizen.id}`,
        x: citizen.x,
        y: citizen.y,
        z: citizen.z,
        distance: Math.hypot(citizen.x - px, citizen.z - pz),
        data: citizen,
      });
    }

    for (const a of ctx.simulation.animals.animals) {
      if (a.dead) continue;
      const d = Math.hypot(a.x - px, a.z - pz);
      if (d < 7) {
        out.push({
          kind: 'animal',
          label: `${a.species[0].toUpperCase()}${a.species.slice(1)}`,
          id: `animal-${a.id}`,
          x: a.x,
          y: a.y,
          z: a.z,
          distance: d,
          data: a,
        });
      }
    }

    for (const s of ctx.simulation.settlements) {
      for (const b of s.buildings) {
        const d = Math.hypot(b.x - px, b.z - pz);
        if (d < Math.max(b.width, 7)) {
          out.push({
            kind: 'building',
            label: `${b.type[0].toUpperCase()}${b.type.slice(1)} — ${s.name}`,
            id: `building-${b.id}`,
            x: b.x,
            y: b.y,
            z: b.z,
            distance: d,
            data: b,
          });
        }
      }
    }

    if (ctx.hydro.surfaceAt(px, pz) !== null) {
      out.push({ kind: 'water', label: 'Water', id: 'water', x: px, y: point.y, z: pz, distance: 0 });
    }

    out.sort((a, b) => a.distance - b.distance);
    return out;
  }
}
