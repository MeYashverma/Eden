/**
 * Settlement system: seeded village generation with road networks, homes,
 * workplaces and farms — and a lightweight city simulation (housing,
 * employment, food stocks, growth) that lets settlements change over time.
 */

import * as THREE from 'three';
import { RNG, hashCombine, seededRng } from '../core/rng';
import { clamp, lerp, TAU } from '../core/math';
import type { WorldGen } from '../world/worldGen';
import type { Hydrology } from '../world/hydrology';
import {
  createBuildingMaterials, buildStructure, buildWell, buildTower, buildDock, buildField,
  type BuildingType, type SharedBuildingMaterials,
} from './buildings';

export interface BuildingRecord {
  id: number;
  type: BuildingType;
  x: number;
  z: number;
  y: number;
  rotation: number;
  width: number;
  depth: number;
  height: number;
  level: number;
  residents: number[];
  workplaces: number;
  condition: number; // 0..1 maintenance
  constructed: boolean; // false = under construction
  constructionProgress: number;
  hasField: boolean;
  fieldCrop: string;
  fieldGrowth: number;
}

export interface RoadSegment {
  points: Array<{ x: number; z: number; y: number }>;
  width: number;
}

export interface SettlementRecord {
  id: number;
  name: string;
  x: number;
  z: number;
  seedSalt: number;
  buildings: BuildingRecord[];
  roads: RoadSegment[];
  stocks: { food: number; timber: number; stone: number; goods: number; money: number };
  prosperity: number; // 0..1
  pollution: number; // 0..1
  foundedDay: number;
  discovered: boolean;
  populationTarget: number;
}

export interface SettlementBundle {
  record: SettlementRecord;
  group: THREE.Group;
}

const SETTLEMENT_NAMES = [
  'Willowmere', 'Stonebrook', 'Greenhollow', 'Ashford', 'Riverbend', 'Oakenshield',
  'Fernhollow', 'Mistwick', 'Thornbury', 'Clearwater', 'Brackenfell', 'Elderglen',
  'Foxglove', 'Hartwell', 'Larkspur', 'Millhaven', 'Northreach', 'Redford',
  'Silvercreek', 'Wrenfield', 'Amberdale', 'Coldhollow', 'Dunmarsh', 'Kettleford',
];

const FIRST_NAMES = [
  'Aiden', 'Bram', 'Cora', 'Della', 'Edric', 'Fenna', 'Gareth', 'Hale', 'Isla', 'Jory',
  'Kira', 'Lorne', 'Maren', 'Nell', 'Orin', 'Perrin', 'Quill', 'Rosalind', 'Sten', 'Tessa',
  'Ulric', 'Vera', 'Wynn', 'Yara', 'Ansel', 'Brynn', 'Cedric', 'Dahlia', 'Ewan', 'Faye',
];
const LAST_NAMES = [
  'Ashby', 'Brook', 'Carver', 'Dunmore', 'Elmsworth', 'Fletcher', 'Greaves', 'Holloway',
  'Iver', 'Kettle', 'Locke', 'Mercer', 'Norwood', 'Oakley', 'Prentice', 'Quarry',
  'Ridge', 'Sawyer', 'Thatcher', 'Underhill', 'Wainwright', 'Yarrow',
];

export function generatePersonName(rng: RNG): string {
  return `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;
}

let nextBuildingId = 1;
let nextSettlementId = 1;

export function resetSettlementIds(): void {
  nextBuildingId = 1;
  nextSettlementId = 1;
}

/** Score a candidate site for settlement viability. */
export function scoreSettlementSite(gen: WorldGen, hydro: Hydrology, x: number, z: number): number {
  const sample = gen.sample(x, z);
  if (sample.height < 1.5 || sample.height > 85) return -1;
  if (sample.slope > 0.22) return -1;
  if (sample.biome === 'deep_ocean' || sample.biome === 'shallow_ocean' || sample.biome === 'alpine') return -1;

  let score = (1 - sample.slope) * 2.2;
  // Water access within ~140 m, but not on a floodplain tile.
  let nearWater = 0;
  for (let r = 30; r <= 150; r += 30) {
    for (let a = 0; a < TAU; a += Math.PI / 6) {
      const sx = x + Math.cos(a) * r;
      const sz = z + Math.sin(a) * r;
      const surf = hydro.surfaceAt(sx, sz);
      if (surf !== null && surf - gen.height(sx, sz) > 0.1) {
        nearWater = Math.max(nearWater, 1 - r / 220);
      }
    }
  }
  score += nearWater * 2.6;
  // Farming potential
  score += sample.fertility * 2.1;
  // Prefer temperate biomes
  if (['grassland', 'temperate_forest', 'dense_woodland'].includes(sample.biome)) score += 1.4;
  if (sample.biome === 'desert' || sample.biome === 'tundra') score -= 1.2;
  // Flat building space around the site
  let flat = 0;
  for (let a = 0; a < TAU; a += Math.PI / 5) {
    const sx = x + Math.cos(a) * 70;
    const sz = z + Math.sin(a) * 70;
    if (gen.slope(sx, sz) < 0.3) flat++;
  }
  score += (flat / 10) * 1.8;
  return score;
}

/**
 * Generate a complete settlement at a site: plaza, roads, houses, workplace,
 * farms, well — deterministic from seed + position.
 */
export function generateSettlement(
  gen: WorldGen,
  hydro: Hydrology,
  mats: SharedBuildingMaterials,
  x: number,
  z: number,
  seedSalt = 0,
  nameIndex?: number,
): SettlementBundle {
  const rng = seededRng(gen.config.seed, Math.round(x / 32), Math.round(z / 32), 7733 + seedSalt);
  const name = nameIndex !== undefined
    ? SETTLEMENT_NAMES[nameIndex % SETTLEMENT_NAMES.length]
    : rng.pick(SETTLEMENT_NAMES);

  const record: SettlementRecord = {
    id: nextSettlementId++,
    name,
    x,
    z,
    seedSalt,
    buildings: [],
    roads: [],
    stocks: { food: 85, timber: 55, stone: 35, goods: 28, money: 240 },
    prosperity: 0.55,
    pollution: 0,
    foundedDay: 0,
    discovered: false,
    populationTarget: 8 + rng.int(0, 8),
  };

  const group = new THREE.Group();
  group.name = `settlement-${name}`;
  const groundY = gen.height(x, z);

  // ---- plaza & well -------------------------------------------------------
  const well = buildWell(mats);
  well.group.position.set(x, groundY, z);
  group.add(well.group);
  record.buildings.push({
    id: nextBuildingId++,
    type: 'well',
    x, z, y: groundY,
    rotation: 0,
    width: well.width,
    depth: well.depth,
    height: well.height,
    level: 1,
    residents: [],
    workplaces: 1,
    condition: 1,
    constructed: true,
    constructionProgress: 1,
    hasField: false,
    fieldCrop: '',
    fieldGrowth: 0,
  });

  // ---- roads: spokes from the plaza ---------------------------------------
  const spokes = rng.int(3, 4);
  const roadTargets: Array<{ x: number; z: number; angle: number }> = [];
  for (let i = 0; i < spokes; i++) {
    const angle = (i / spokes) * TAU + rng.range(-0.35, 0.35);
    const length = rng.range(95, 165);
    const tx = x + Math.cos(angle) * length;
    const tz = z + Math.sin(angle) * length;
    roadTargets.push({ x: tx, z: tz, angle });

    const points: Array<{ x: number; z: number; y: number }> = [];
    const steps = 14;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const px = lerp(x, tx, t) + Math.sin(t * Math.PI) * rng.range(-4, 4) * (s > 0 && s < steps ? 1 : 0);
      const pz = lerp(z, tz, t) + Math.cos(t * Math.PI) * rng.range(-4, 4) * (s > 0 && s < steps ? 1 : 0);
      points.push({ x: px, z: pz, y: gen.height(px, pz) + 0.12 });
    }
    record.roads.push({ points, width: 3.4 });
  }

  // ---- buildings along roads ----------------------------------------------
  const buildingSlots: Array<{ x: number; z: number; rot: number; type: BuildingType }> = [];
  for (const target of roadTargets) {
    const housesAlong = rng.int(2, 4);
    for (let h = 0; h < housesAlong; h++) {
      const t = 0.22 + (h / housesAlong) * 0.62;
      const side = h % 2 === 0 ? 1 : -1;
      const px = lerp(x, target.x, t) + Math.cos(target.angle + Math.PI / 2) * side * rng.range(11, 17);
      const pz = lerp(z, target.z, t) + Math.sin(target.angle + Math.PI / 2) * side * rng.range(11, 17);
      const rot = Math.atan2(x - px, z - pz) + rng.range(-0.18, 0.18);
      const sample = gen.sample(px, pz);
      if (sample.slope > 0.3 || sample.height < 0.8) continue;
      const typeRoll = rng.next();
      const type: BuildingType =
        typeRoll < 0.58 ? 'house' :
        typeRoll < 0.72 ? 'cottage' :
        typeRoll < 0.82 ? 'barn' :
        typeRoll < 0.9 ? 'shop' :
        typeRoll < 0.96 ? 'tavern' : 'warehouse';
      buildingSlots.push({ x: px, z: pz, rot, type });
    }
    // Farms at the outskirts
    const fx = lerp(x, target.x, 0.85) + Math.cos(target.angle + Math.PI / 2) * rng.range(16, 30) * (rng.chance(0.5) ? 1 : -1);
    const fz = lerp(z, target.z, 0.85) + Math.sin(target.angle + Math.PI / 2) * rng.range(16, 30) * (rng.chance(0.5) ? 1 : -1);
    if (gen.slope(fx, fz) < 0.28 && gen.height(fx, fz) > 0.8) {
      buildingSlots.push({ x: fx, z: fz, rot: rng.range(0, TAU), type: 'barn' });
    }
  }

  for (const slot of buildingSlots) {
    const kit = buildStructure({ type: slot.type, rng, mats, rotation: slot.rot });
    kit.group.position.set(slot.x, gen.height(slot.x, slot.z), slot.z);
    group.add(kit.group);

    const rec: BuildingRecord = {
      id: nextBuildingId++,
      type: slot.type,
      x: slot.x,
      z: slot.z,
      y: gen.height(slot.x, slot.z),
      rotation: slot.rot,
      width: kit.width,
      depth: kit.depth,
      height: kit.height,
      level: 1,
      residents: [],
      workplaces: slot.type === 'barn' ? 3 : slot.type === 'shop' || slot.type === 'tavern' ? 2 : slot.type === 'warehouse' ? 2 : 0,
      condition: 1,
      constructed: true,
      constructionProgress: 1,
      hasField: slot.type === 'barn',
      fieldCrop: ['wheat', 'potato', 'cabbage', 'carrot'][rng.int(0, 3)],
      fieldGrowth: rng.range(0.15, 0.8),
    };
    record.buildings.push(rec);

    // Farm field beside barns
    if (rec.hasField) {
      const field = buildField(12, 9, mats.fabric, rec.fieldGrowth);
      field.position.set(slot.x + Math.cos(slot.rot) * 11, gen.height(slot.x + Math.cos(slot.rot) * 11, slot.z + Math.sin(slot.rot) * 11), slot.z + Math.sin(slot.rot) * 11);
      field.rotation.y = slot.rot;
      group.add(field);
    }
  }

  // A watchtower and dock if near water
  if (rng.chance(0.45)) {
    const angle = rng.range(0, TAU);
    const tx = x + Math.cos(angle) * 70;
    const tz = z + Math.sin(angle) * 70;
    const tower = buildTower(mats);
    tower.group.position.set(tx, gen.height(tx, tz), tz);
    group.add(tower.group);
    record.buildings.push({
      id: nextBuildingId++, type: 'tower', x: tx, z: tz, y: gen.height(tx, tz), rotation: rng.range(0, TAU),
      width: tower.width, depth: tower.depth, height: tower.height, level: 1, residents: [], workplaces: 1,
      condition: 1, constructed: true, constructionProgress: 1, hasField: false, fieldCrop: '', fieldGrowth: 0,
    });
  }

  // Dock: search for shoreline near settlement
  for (let a = 0; a < TAU; a += Math.PI / 10) {
    const sx = x + Math.cos(a) * 65;
    const sz = z + Math.sin(a) * 65;
    const h = gen.height(sx, sz);
    const surf = hydro.surfaceAt(sx, sz);
    if (h > -1.2 && h < 1.2 && surf !== null && Math.abs(surf - h) < 1.5) {
      const dock = buildDock(mats, 7);
      const rot = Math.atan2(x - sx, z - sz);
      dock.group.position.set(sx, surf - 0.35, sz);
      dock.group.rotation.y = rot;
      group.add(dock.group);
      record.buildings.push({
        id: nextBuildingId++, type: 'dock', x: sx, z: sz, y: surf, rotation: rot,
        width: dock.width, depth: dock.depth, height: 0.5, level: 1, residents: [], workplaces: 2,
        condition: 1, constructed: true, constructionProgress: 1, hasField: false, fieldCrop: '', fieldGrowth: 0,
      });
      break;
    }
  }

  return { record, group };
}

/** Build ribbon geometry for a road following terrain. */
export function buildRoadMesh(road: RoadSegment, gen: WorldGen): THREE.Mesh {
  const positions: number[] = [];
  const uvs: number[] = [];
  const index: number[] = [];
  const pts = road.points;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(pts.length - 1, i + 1)];
    const dx = next.x - prev.x;
    const dz = next.z - prev.z;
    const len = Math.hypot(dx, dz) || 1;
    const nx = -dz / len;
    const nz = dx / len;
    const half = road.width / 2;
    const lx = p.x + nx * half;
    const lz = p.z + nz * half;
    const rx = p.x - nx * half;
    const rz = p.z - nz * half;
    const ly = gen.height(lx, lz) + 0.16;
    const ry = gen.height(rx, rz) + 0.16;
    positions.push(lx, ly, lz, rx, ry, rz);
    uvs.push(0, i * 0.35, 1, i * 0.35);
    if (i < pts.length - 1) {
      const b = i * 2;
      index.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: 0x6b5740, roughness: 0.98, polygonOffset: true, polygonOffsetFactor: -1 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Settlement economy & growth. Called on game-hour slices.
 * Returns a human-readable event string if something notable happened.
 */
export function tickSettlement(settlement: SettlementRecord, hours: number, population: number, foodProduced: number, day: number): string | null {
  const s = settlement;
  // Food consumption
  s.stocks.food -= population * 0.28 * hours;
  // Production from farms and jobs
  s.stocks.food += foodProduced * hours;
  s.stocks.timber += population * 0.06 * hours * (1 - s.pollution);
  s.stocks.goods += population * 0.03 * hours * clamp(s.stocks.timber / 40, 0.2, 1.4);
  s.stocks.money += population * 0.05 * hours * s.prosperity;

  // Pollute local water slightly with population
  s.pollution = clamp(s.pollution + population * 0.0004 * hours - 0.0006 * hours, 0, 1);

  // Prosperity from food security + housing
  const housing = s.buildings.filter((b) => b.type === 'house' || b.type === 'cottage').length * 4;
  const foodSecurity = clamp(s.stocks.food / Math.max(1, population * 6), 0, 1.5);
  const employed = clamp(population / Math.max(1, s.buildings.reduce((sum, b) => sum + b.workplaces, 0)), 0, 1.2);
  s.prosperity = clamp(lerp(s.prosperity, clamp(0.25 + foodSecurity * 0.35 + employed * 0.25 + (housing > population ? 0.15 : -0.1), 0, 1), hours * 0.02), 0, 1);

  // Growth: new construction when prosperous and food surplus
  if (s.prosperity > 0.62 && s.stocks.food > population * 8 && population >= s.populationTarget - 1) {
    s.populationTarget += 1;
    return `${s.name} is growing — new settlers are expected.`;
  }
  // Hardship
  if (s.stocks.food < population * 1.2) {
    s.stocks.food = Math.max(0, s.stocks.food);
    return `${s.name}'s granaries are running low.`;
  }
  if (s.stocks.food <= 0 && population > 2) {
    return `Food crisis in ${s.name}!`;
  }
  return null;
}

export function serializeSettlements(list: SettlementRecord[]): SettlementRecord[] {
  return list.map((s) => ({ ...s, buildings: s.buildings.map((b) => ({ ...b })) }));
}
