/**
 * Wildlife simulation.
 *
 * Every animal is an individual agent with age, health, hunger, thirst,
 * energy, fear and a life stage. Behaviour comes from a utility scorer over
 * perceived opportunities (food, water, threats, mates, rest) — predators
 * only hunt what they can perceive or remember, herbivores graze, drink,
 * flee and herd. Population dynamics (birth, death, carrying capacity,
 * predation pressure) keep herds and packs in ecological balance.
 *
 * Detail levels: animals near the player tick at full rate with rendering;
 * far animals tick at reduced rate; regional population counters continue
 * while no individuals are simulated.
 */

import { RNG, hashCombine, hash01 } from '../core/rng';
import { clamp, lerp, moveTowards, rotateTowards, angleDelta, TAU } from '../core/math';
import type { WorldGen } from '../world/worldGen';
import type { Hydrology } from '../world/hydrology';
import type { AnimalActivity } from './agentRenderers';
import * as THREE from 'three';

export type Diet = 'grazer' | 'browser' | 'predator' | 'omnivore' | 'fish' | 'insectivore' | 'granivore';

export interface SpeciesDef {
  id: string;
  label: string;
  diet: Diet;
  speed: number;
  runSpeed: number;
  size: number; // scale
  maxHealth: number;
  metabolism: number; // hunger gain per game hour
  thirstRate: number;
  perception: number;
  panicDistance: number;
  comfortDistance: number;
  lifespanYears: number;
  gestationDays: number;
  litterSize: [number, number];
  maxGroup: number;
  prey: string[];
  predators: string[];
  habitats: string[]; // biome names
  waterNeed: number; // 0..1 affinity
  herding: number;
  nocturnal: boolean;
  domestic: boolean;
  valueMeat: number;
}

export const SPECIES: Record<string, SpeciesDef> = {
  deer: {
    id: 'deer', label: 'Red Deer', diet: 'grazer', speed: 1.8, runSpeed: 8.4, size: 1,
    maxHealth: 60, metabolism: 2.6, thirstRate: 2.2, perception: 34, panicDistance: 22, comfortDistance: 14,
    lifespanYears: 12, gestationDays: 34, litterSize: [1, 2], maxGroup: 8,
    prey: [], predators: ['wolf', 'bear', 'fox'], habitats: ['temperate_forest', 'grassland', 'dense_woodland', 'boreal_forest'],
    waterNeed: 0.55, herding: 0.8, nocturnal: false, domestic: false, valueMeat: 3,
  },
  rabbit: {
    id: 'rabbit', label: 'Hare', diet: 'browser', speed: 1.6, runSpeed: 9.2, size: 0.85,
    maxHealth: 18, metabolism: 3.4, thirstRate: 2.6, perception: 22, panicDistance: 17, comfortDistance: 9,
    lifespanYears: 5, gestationDays: 12, litterSize: [2, 5], maxGroup: 10,
    prey: [], predators: ['wolf', 'fox', 'bear'], habitats: ['grassland', 'temperate_forest', 'tundra', 'shrubland'],
    waterNeed: 0.4, herding: 0.5, nocturnal: false, domestic: false, valueMeat: 1,
  },
  wolf: {
    id: 'wolf', label: 'Grey Wolf', diet: 'predator', speed: 2.4, runSpeed: 9.6, size: 1.05,
    maxHealth: 75, metabolism: 2.9, thirstRate: 2.0, perception: 48, panicDistance: 26, comfortDistance: 18,
    lifespanYears: 10, gestationDays: 30, litterSize: [2, 4], maxGroup: 7,
    prey: ['deer', 'rabbit', 'boar'], predators: [], habitats: ['boreal_forest', 'tundra', 'temperate_forest', 'alpine'],
    waterNeed: 0.5, herding: 0.9, nocturnal: false, domestic: false, valueMeat: 2,
  },
  fox: {
    id: 'fox', label: 'Red Fox', diet: 'omnivore', speed: 2.1, runSpeed: 8.2, size: 0.8,
    maxHealth: 34, metabolism: 3.1, thirstRate: 2.2, perception: 36, panicDistance: 18, comfortDistance: 11,
    lifespanYears: 8, gestationDays: 18, litterSize: [2, 4], maxGroup: 3,
    prey: ['rabbit'], predators: ['wolf'], habitats: ['temperate_forest', 'grassland', 'dense_woodland', 'tundra'],
    waterNeed: 0.45, herding: 0.25, nocturnal: true, domestic: false, valueMeat: 1,
  },
  boar: {
    id: 'boar', label: 'Wild Boar', diet: 'omnivore', speed: 1.5, runSpeed: 6.8, size: 1.05,
    maxHealth: 70, metabolism: 3.6, thirstRate: 2.4, perception: 26, panicDistance: 15, comfortDistance: 10,
    lifespanYears: 12, gestationDays: 32, litterSize: [2, 4], maxGroup: 6,
    prey: ['rabbit'], predators: ['bear'], habitats: ['temperate_forest', 'dense_woodland', 'tropical_forest', 'grassland'],
    waterNeed: 0.5, herding: 0.6, nocturnal: false, domestic: false, valueMeat: 3,
  },
  bear: {
    id: 'bear', label: 'Brown Bear', diet: 'omnivore', speed: 1.9, runSpeed: 7.6, size: 1.35,
    maxHealth: 130, metabolism: 3.8, thirstRate: 2.2, perception: 38, panicDistance: 20, comfortDistance: 16,
    lifespanYears: 22, gestationDays: 45, litterSize: [1, 2], maxGroup: 2,
    prey: ['deer', 'boar'], predators: [], habitats: ['boreal_forest', 'alpine', 'temperate_forest', 'tundra'],
    waterNeed: 0.65, herding: 0.15, nocturnal: false, domestic: false, valueMeat: 5,
  },
  bird: {
    id: 'bird', label: 'Songbird', diet: 'granivore', speed: 2.2, runSpeed: 11, size: 0.75,
    maxHealth: 10, metabolism: 4.2, thirstRate: 3, perception: 28, panicDistance: 14, comfortDistance: 7,
    lifespanYears: 6, gestationDays: 10, litterSize: [2, 4], maxGroup: 14,
    prey: [], predators: ['fox'], habitats: ['temperate_forest', 'grassland', 'tropical_forest', 'wetland', 'dense_woodland'],
    waterNeed: 0.4, herding: 0.95, nocturnal: false, domestic: false, valueMeat: 0,
  },
  fish: {
    id: 'fish', label: 'River Fish', diet: 'fish', speed: 1.1, runSpeed: 3.2, size: 0.9,
    maxHealth: 8, metabolism: 1.6, thirstRate: 0, perception: 12, panicDistance: 6, comfortDistance: 4,
    lifespanYears: 5, gestationDays: 20, litterSize: [3, 8], maxGroup: 20,
    prey: [], predators: ['bear', 'bird'], habitats: ['deep_ocean', 'shallow_ocean', 'river', 'wetland'],
    waterNeed: 1, herding: 0.85, nocturnal: false, domestic: false, valueMeat: 1,
  },
  sheep: {
    id: 'sheep', label: 'Sheep', diet: 'grazer', speed: 1.2, runSpeed: 4.6, size: 0.9,
    maxHealth: 40, metabolism: 2.8, thirstRate: 2.2, perception: 20, panicDistance: 14, comfortDistance: 9,
    lifespanYears: 12, gestationDays: 30, litterSize: [1, 2], maxGroup: 12,
    prey: [], predators: ['wolf'], habitats: ['grassland', 'temperate_forest'],
    waterNeed: 0.55, herding: 0.95, nocturnal: false, domestic: true, valueMeat: 2,
  },
  chicken: {
    id: 'chicken', label: 'Chicken', diet: 'granivore', speed: 0.9, runSpeed: 3.4, size: 0.7,
    maxHealth: 12, metabolism: 3.8, thirstRate: 2.8, perception: 14, panicDistance: 10, comfortDistance: 6,
    lifespanYears: 8, gestationDays: 8, litterSize: [2, 5], maxGroup: 10,
    prey: [], predators: ['fox', 'wolf'], habitats: ['grassland', 'temperate_forest'],
    waterNeed: 0.5, herding: 0.9, nocturnal: false, domestic: true, valueMeat: 1,
  },
  dog: {
    id: 'dog', label: 'Dog', diet: 'omnivore', speed: 2.2, runSpeed: 8.8, size: 0.85,
    maxHealth: 45, metabolism: 3, thirstRate: 2.4, perception: 32, panicDistance: 12, comfortDistance: 10,
    lifespanYears: 13, gestationDays: 30, litterSize: [2, 4], maxGroup: 3,
    prey: ['rabbit'], predators: [], habitats: ['grassland', 'temperate_forest'],
    waterNeed: 0.5, herding: 0.6, nocturnal: false, domestic: true, valueMeat: 0,
  },
  cat: {
    id: 'cat', label: 'Cat', diet: 'predator', speed: 1.7, runSpeed: 7.2, size: 0.7,
    maxHealth: 28, metabolism: 2.6, thirstRate: 1.8, perception: 30, panicDistance: 12, comfortDistance: 8,
    lifespanYears: 15, gestationDays: 24, litterSize: [2, 4], maxGroup: 2,
    prey: ['rabbit', 'bird'], predators: [], habitats: ['grassland', 'temperate_forest'],
    waterNeed: 0.3, herding: 0.15, nocturnal: true, domestic: true, valueMeat: 0,
  },
};

export type AnimalState =
  | 'wander' | 'graze' | 'drink' | 'rest' | 'sleep' | 'flee' | 'hunt' | 'chase'
  | 'mate' | 'socialize' | 'follow_herd' | 'migrate' | 'dead';

export interface Animal {
  id: number;
  species: string;
  x: number;
  z: number;
  y: number;
  yaw: number;
  age: number; // game days
  health: number;
  hunger: number; // 0..100 (full = fed)
  thirst: number;
  energy: number;
  fear: number;
  state: AnimalState;
  activity: AnimalActivity;
  targetX: number;
  targetZ: number;
  timer: number;
  phase: number;
  speed: number;
  group: number;
  sex: 0 | 1;
  pregnant: number; // days remaining
  scale: number;
  tint: THREE.Color;
  lastThreatX: number;
  lastThreatZ: number;
  knownPreyId: number;
  detailed: boolean;
  dead: boolean;
  deathCause: string;
}

export interface AnimalEvent {
  kind: 'birth' | 'death' | 'hunt' | 'kill' | 'flee' | 'spotted';
  species: string;
  x: number;
  z: number;
  detail: string;
}

export class AnimalSimulation {
  animals: Animal[] = [];
  private nextId = 1;
  private gen: WorldGen;
  private hydro: Hydrology;
  events: AnimalEvent[] = [];
  births = 0;
  deaths = 0;
  kills = 0;
  /** Abstract regional counts for populations not currently instantiated. */
  abstractCounts: Record<string, number> = {};
  maxDetailed = 220;

  constructor(gen: WorldGen, hydro: Hydrology) {
    this.gen = gen;
    this.hydro = hydro;
  }

  /** Spawn a population around a point using habitat suitability. */
  populateAround(x: number, z: number, radius: number, abundance = 1, rng?: RNG): void {
    const r = rng ?? new RNG(hashCombine(this.gen.config.seed, Math.round(x), Math.round(z), 55));
    const count = Math.floor(radius / 22 * abundance);
    for (let i = 0; i < count; i++) {
      const a = r.range(0, TAU);
      const d = Math.sqrt(r.next()) * radius;
      const px = x + Math.cos(a) * d;
      const pz = z + Math.sin(a) * d;
      this.spawnHabitatSuitable(px, pz, r);
    }
  }

  spawnHabitatSuitable(x: number, z: number, r: RNG): Animal | null {
    const sample = this.gen.sample(x, z);
    const options = Object.values(SPECIES).filter((s) => !s.domestic && s.habitats.includes(sample.biome));
    if (options.length === 0) return null;
    const def = options[r.int(0, options.length - 1)];
    // Reject unsuitable spots for this species.
    if (def.diet === 'fish' && !this.hydro.isWater(x, z) && sample.biome !== 'deep_ocean' && sample.biome !== 'shallow_ocean') return null;
    return this.spawn(def.id, x, z, r);
  }

  spawn(species: string, x: number, z: number, r?: RNG, groupHint = -1): Animal | null {
    const def = SPECIES[species];
    if (!def) return null;
    const rng = r ?? new RNG(hashCombine(this.nextId, Math.round(x * 3), Math.round(z * 3)));
    const y = this.gen.height(x, z);
    const tint = new THREE.Color().setHSL(
      species === 'bird' ? rng.range(0, 1) : rng.range(0.05, 0.11),
      rng.range(0.15, 0.42),
      rng.range(0.32, 0.62),
    );
    const animal: Animal = {
      id: this.nextId++,
      species,
      x, z, y,
      yaw: rng.range(0, TAU),
      age: rng.range(0, def.lifespanYears * 300),
      health: def.maxHealth,
      hunger: rng.range(45, 95),
      thirst: rng.range(45, 95),
      energy: rng.range(55, 100),
      fear: 0,
      state: 'wander',
      activity: 'idle',
      targetX: x,
      targetZ: z,
      timer: rng.range(1, 6),
      phase: rng.range(0, TAU),
      speed: 0,
      group: groupHint >= 0 ? groupHint : this.nextId,
      sex: rng.chance(0.5) ? 1 : 0,
      pregnant: 0,
      scale: def.size * rng.range(0.85, 1.15),
      tint,
      lastThreatX: 0,
      lastThreatZ: 0,
      knownPreyId: -1,
      detailed: true,
      dead: false,
      deathCause: '',
    };
    this.animals.push(animal);
    return animal;
  }

  /** Perceived threats & prey for one animal (no omniscience). */
  private perceive(a: Animal): { threats: Animal[]; prey: Animal[]; mates: Animal[]; playerDist: number; playerX: number; playerZ: number } {
    const def = SPECIES[a.species];
    const threats: Animal[] = [];
    const prey: Animal[] = [];
    const mates: Animal[] = [];
    const per = def.perception * (a.fear > 40 ? 1.25 : 1);
    for (const other of this.animals) {
      if (other.id === a.id || other.dead) continue;
      const d = Math.hypot(other.x - a.x, other.z - a.z);
      if (d > per) continue;
      if (def.predators.includes(other.species)) threats.push(other);
      if (def.prey.includes(other.species)) prey.push(other);
      if (other.species === a.species && other.sex !== a.sex && other.age > 300) mates.push(other);
    }
    return { threats, prey, mates, playerDist: Infinity, playerX: 0, playerZ: 0 };
  }

  /**
   * Full agent tick for detailed animals.
   * @param hours game hours advanced in this step
   * @param playerX player position for presence effects
   */
  stepDetailed(hours: number, playerX: number, playerZ: number, huntingPressure = 0): void {
    const births: Animal[] = [];
    for (const a of this.animals) {
      if (a.dead || !a.detailed) continue;
      const def = SPECIES[a.species];

      // ---- needs ----
      a.age += hours / 24;
      a.hunger = clamp(a.hunger - def.metabolism * hours * (a.activity === 'run' ? 1.8 : 1), 0, 100);
      a.thirst = clamp(a.thirst - def.thirstRate * hours, 0, 100);
      a.energy = clamp(a.energy - hours * (a.speed > def.speed * 1.2 ? 4 : 1.1) + (a.state === 'rest' || a.state === 'sleep' ? hours * 14 : 0), 0, 100);
      a.fear = Math.max(0, a.fear - hours * 22);

      // Ageing & starvation
      if (a.age > def.lifespanYears * 365) {
        this.kill(a, 'old age');
        continue;
      }
      if (a.hunger <= 0) a.health -= hours * 2.4;
      if (a.thirst <= 0) a.health -= hours * 3.2;
      if (a.health <= 0) {
        this.kill(a, a.hunger <= 0 ? 'starvation' : 'dehydration');
        continue;
      }
      if (a.hunger > 40 && a.thirst > 40 && a.health < def.maxHealth) {
        a.health = clamp(a.health + hours * 1.2, 0, def.maxHealth);
      }

      // Pregnancy
      if (a.pregnant > 0) {
        a.pregnant -= hours / 24;
        if (a.pregnant <= 0) {
          const litter = Math.floor(hash01(a.id, this.births) * (def.litterSize[1] - def.litterSize[0] + 1)) + def.litterSize[0];
          const sameSpecies = this.animals.filter((o) => o.species === a.species).length;
          const cap = this.carryingCapacity(def);
          for (let i = 0; i < litter && sameSpecies + i < cap; i++) {
            const baby = this.spawn(a.species, a.x + (i - litter / 2) * 1.5, a.z + (i % 2) * 1.2, undefined, a.group);
            if (baby) {
              baby.age = 0;
              baby.scale *= 0.55;
              this.births++;
              births.push(baby);
            }
          }
        }
      }

      // ---- perception & decisions ----
      const p = this.perceive(a);
      const playerD = Math.hypot(playerX - a.x, playerZ - a.z);
      const waterHere = this.hydro.surfaceAt(a.x, a.z) !== null;

      // Player threat: predators wary of hunters, prey of all players when close.
      let playerThreat = 0;
      if (playerD < def.panicDistance) {
        playerThreat = (1 - playerD / def.panicDistance) * (def.diet === 'predator' ? 0.55 : 1) * (1 + huntingPressure);
      }

      // Choose behaviour via utility scores.
      const scores: Record<AnimalState, number> = {
        wander: 0.22,
        graze: 0,
        drink: 0,
        rest: 0,
        sleep: 0,
        flee: playerThreat * 1.6 + (p.threats.length > 0 ? 0.9 : 0) + a.fear / 120,
        hunt: 0,
        chase: 0,
        mate: 0,
        socialize: 0,
        follow_herd: 0,
        migrate: 0,
        dead: 0,
      };

      const foodScore = 1 - a.hunger / 100;
      const thirstScore = 1 - a.thirst / 100;
      const tired = 1 - a.energy / 100;

      if (def.diet === 'predator') {
        scores.hunt = p.prey.length > 0 ? foodScore * 1.5 : foodScore * 0.35;
        scores.chase = a.state === 'hunt' && a.knownPreyId >= 0 ? 1.4 : 0;
      } else if (def.diet === 'fish') {
        scores.graze = foodScore * 1.1;
      } else {
        scores.graze = foodScore * 1.25 * (waterHere && def.diet !== 'browser' ? 0.7 : 1);
      }
      scores.drink = thirstScore * 1.5 * (this.nearestWater(a) ? 1 : 0.25);
      scores.rest = tired * 1.1 * (a.fear < 25 ? 1 : 0.1);
      scores.sleep = (def.nocturnal ? this.isDay() : !this.isDay()) ? 0.05 : tired * 1.35;
      scores.mate = a.age > 300 && a.hunger > 55 && p.mates.length > 0 && a.pregnant <= 0 ? 0.75 : 0;
      scores.socialize = def.herding * 0.35 * (p.mates.length + p.threats.length * 0);
      scores.follow_herd = def.herding * 0.3;
      scores.migrate = foodScore * 0.3 * (this.localGrazingPressure(a) > 2.2 ? 1.2 : 0.08);

      let best: AnimalState = 'wander';
      let bestScore = -1;
      for (const [k, v] of Object.entries(scores)) {
        if (v > bestScore) {
          bestScore = v;
          best = k as AnimalState;
        }
      }
      if (a.fear > 70) best = 'flee';
      a.state = best;

      // ---- act ----
      const terrainSlope = this.gen.slope(a.x, a.z);
      const moveSpeed = a.state === 'flee' ? def.runSpeed : a.state === 'chase' ? def.runSpeed * 0.9 : a.state === 'wander' ? def.speed * 0.55 : def.speed;

      switch (a.state) {
        case 'graze': {
          a.activity = 'graze';
          a.speed = 0;
          a.hunger = clamp(a.hunger + hours * (def.diet === 'fish' ? 6 : 9), 0, 100);
          // Nudge across grazing ground.
          a.timer -= hours;
          if (a.timer <= 0) {
            a.timer = 2.5;
            const ang = hash01(a.id, Math.floor(a.phase * 10)) * TAU;
            a.targetX = a.x + Math.cos(ang) * 9;
            a.targetZ = a.z + Math.sin(ang) * 9;
            a.state = 'wander';
          }
          break;
        }
        case 'drink': {
          const w = this.nearestWater(a);
          if (w) {
            this.steerTo(a, w.x, w.z, moveSpeed, dtHours(hours), terrainSlope);
            if (Math.hypot(a.x - w.x, a.z - w.z) < 3) {
              a.thirst = clamp(a.thirst + hours * 18, 0, 100);
              a.activity = 'idle';
              a.speed = 0;
            } else {
              a.activity = 'walk';
            }
          }
          break;
        }
        case 'rest': {
          a.activity = 'rest';
          a.speed = 0;
          a.energy = clamp(a.energy + hours * 12, 0, 100);
          break;
        }
        case 'sleep': {
          a.activity = 'rest';
          a.speed = 0;
          a.energy = clamp(a.energy + hours * 16, 0, 100);
          break;
        }
        case 'flee': {
          a.activity = 'flee';
          a.fear = clamp(a.fear + hours * 30, 0, 100);
          // Run from the most immediate threat (player or predator).
          let fx = 0;
          let fz = 0;
          if (playerThreat > 0.15) {
            fx += (a.x - playerX) * playerThreat * 2;
            fz += (a.z - playerZ) * playerThreat * 2;
          }
          for (const t of p.threats) {
            const d = Math.max(1, Math.hypot(a.x - t.x, a.z - t.z));
            fx += ((a.x - t.x) / d) * 40;
            fz += ((a.z - t.z) / d) * 40;
            a.lastThreatX = t.x;
            a.lastThreatZ = t.z;
          }
          if (Math.abs(fx) + Math.abs(fz) > 0.01) {
            a.targetX = a.x + fx * 0.5;
            a.targetZ = a.z + fz * 0.5;
          }
          this.steerTo(a, a.targetX, a.targetZ, moveSpeed, dtHours(hours), terrainSlope);
          break;
        }
        case 'hunt':
        case 'chase': {
          let target: Animal | null = a.knownPreyId >= 0 ? this.byId(a.knownPreyId) : null;
          if (!target || target.dead || Math.hypot(target.x - a.x, target.z - a.z) > def.perception * 1.4) {
            target = p.prey[0] ?? null;
            a.knownPreyId = target ? target.id : -1;
          }
          if (target) {
            a.activity = 'run';
            a.state = 'chase';
            this.steerTo(a, target.x, target.z, def.runSpeed * 0.92, dtHours(hours), terrainSlope);
            const d = Math.hypot(a.x - target.x, a.z - target.z);
            if (d < 1.6) {
              // Attack
              const dmg = hours * 160 * (def.diet === 'predator' ? 1 : 0.45);
              target.health -= dmg;
              target.fear = 100;
              target.state = 'flee';
              if (target.health <= 0) {
                this.kill(target, `hunted by ${def.label}`, a);
                a.hunger = clamp(a.hunger + 55 * SPECIES[target.species].valueMeat, 0, 100);
                a.knownPreyId = -1;
                this.kills++;
                this.events.push({ kind: 'kill', species: a.species, x: a.x, z: a.z, detail: `${def.label} took down a ${SPECIES[target.species].label}` });
              }
            }
          } else {
            a.state = 'wander';
            a.activity = 'walk';
            this.wander(a, dtHours(hours), moveSpeed * 0.6, terrainSlope);
          }
          break;
        }
        case 'mate': {
          const mate = p.mates[0];
          if (mate) {
            a.activity = 'walk';
            this.steerTo(a, mate.x, mate.z, moveSpeed, dtHours(hours), terrainSlope);
            if (Math.hypot(a.x - mate.x, a.z - mate.z) < 2.2 && a.sex === 0 && a.pregnant <= 0) {
              a.pregnant = def.gestationDays;
              a.state = 'wander';
            }
          }
          break;
        }
        case 'follow_herd':
        case 'socialize': {
          const mates = this.animals.filter((o) => o.species === a.species && o.group === a.group && o.id !== a.id);
          if (mates.length > 0) {
            const cx = mates.reduce((s, m) => s + m.x, 0) / mates.length;
            const cz = mates.reduce((s, m) => s + m.z, 0) / mates.length;
            const d = Math.hypot(cx - a.x, cz - a.z);
            if (d > 8) {
              a.activity = 'walk';
              this.steerTo(a, cx, cz, moveSpeed, dtHours(hours), terrainSlope);
            } else {
              a.activity = 'idle';
              a.speed = 0;
            }
          } else {
            this.wander(a, dtHours(hours), moveSpeed * 0.5, terrainSlope);
          }
          break;
        }
        case 'migrate': {
          a.activity = 'walk';
          this.steerTo(a, a.targetX, a.targetZ, moveSpeed * 0.85, dtHours(hours), terrainSlope);
          if (Math.hypot(a.x - a.targetX, a.z - a.targetZ) < 12) {
            const ang = hash01(a.id, Math.floor(a.phase * 5)) * TAU;
            a.targetX = a.x + Math.cos(ang) * 90;
            a.targetZ = a.z + Math.sin(ang) * 90;
          }
          break;
        }
        default: {
          // wander
          a.activity = a.speed > 0.4 ? 'walk' : 'idle';
          this.wander(a, dtHours(hours), moveSpeed, terrainSlope);
        }
      }

      // Keep fish in water, land animals out of deep water.
      const water = this.hydro.surfaceAt(a.x, a.z);
      const isFish = def.diet === 'fish';
      const depth = water !== null ? water - this.gen.height(a.x, a.z) : 0;
      if (isFish && (water === null || depth < 0.45)) {
        const w = this.nearestWater(a, 60);
        if (w) this.steerTo(a, w.x, w.z, def.runSpeed, dtHours(hours), terrainSlope);
      } else if (!isFish && depth > 1.3) {
        // steer out of deep water toward shore
        this.steerTo(a, a.targetX, a.targetZ, moveSpeed, dtHours(hours), terrainSlope, true);
      }

      a.phase += hours * 8 * (0.3 + a.speed / 3);
    }

    // Remove long-dead carcasses after a while (keeps arrays bounded).
    this.animals = this.animals.filter((a) => !a.dead || performance.now() - (a as unknown as { _deadAt: number })._deadAt < 120000);
    this.emitEvents();
  }

  private isDay(): boolean {
    return this._daytime;
  }
  _daytime = true;

  private nearestWater(a: Animal, radius = 42): { x: number; z: number } | null {
    // Sample a few directions for the closest water surface.
    let best: { x: number; z: number } | null = null;
    let bestD = radius * radius;
    for (let i = 0; i < 12; i++) {
      const ang = (i / 12) * TAU;
      for (const rad of [8, 18, 32, radius]) {
        const x = a.x + Math.cos(ang) * rad;
        const z = a.z + Math.sin(ang) * rad;
        const surf = this.hydro.surfaceAt(x, z);
        if (surf !== null && surf - this.gen.height(x, z) > 0.15) {
          const d = (x - a.x) * (x - a.x) + (z - a.z) * (z - a.z);
          if (d < bestD) {
            bestD = d;
            best = { x, z };
          }
        }
      }
    }
    return best;
  }

  private localGrazingPressure(a: Animal): number {
    let n = 0;
    for (const o of this.animals) {
      if (o.id === a.id || o.dead) continue;
      if (SPECIES[o.species].diet !== 'grazer' && SPECIES[o.species].diet !== 'browser') continue;
      if (Math.hypot(o.x - a.x, o.z - a.z) < 40) n++;
    }
    return n;
  }

  private carryingCapacity(def: SpeciesDef): number {
    const base = def.diet === 'predator' ? 14 : def.diet === 'fish' ? 60 : 34;
    return Math.floor(base * this.gen.config.wildlifeAbundance);
  }

  private wander(a: Animal, hours: number, speed: number, slope: number): void {
    a.timer -= hours;
    if (a.timer <= 0) {
      a.timer = 2 + hash01(a.id, Math.floor(a.phase * 7)) * 6;
      const ang = hash01(a.id, Math.floor(a.phase * 3)) * TAU;
      const dist = 8 + hash01(a.phase * 13, a.id) * 22;
      a.targetX = a.x + Math.cos(ang) * dist;
      a.targetZ = a.z + Math.sin(ang) * dist;
    }
    if (Math.hypot(a.x - a.targetX, a.z - a.targetZ) > 1.5) {
      a.activity = a.speed > 0.5 ? 'walk' : 'idle';
      this.steerTo(a, a.targetX, a.targetZ, speed, dtHours(hours), slope);
    } else {
      a.speed = 0;
      a.activity = 'idle';
    }
  }

  private steerTo(a: Animal, tx: number, tz: number, speed: number, dt: number, slope: number, avoidWater = false): void {
    const dx = tx - a.x;
    const dz = tz - a.z;
    const dist = Math.hypot(dx, dz) || 1;
    let desiredYaw = Math.atan2(-dz, dx) - Math.PI / 2;

    // Avoid steep slopes by turning aside.
    const aheadX = a.x + Math.cos(desiredYaw) * 3;
    const aheadZ = a.z + Math.sin(desiredYaw) * 3;
    const aheadSlope = this.gen.slope(aheadX, aheadZ);
    if (aheadSlope > 0.62 || (avoidWater && this.hydro.surfaceAt(aheadX, aheadZ) !== null)) {
      desiredYaw += 1.15;
    }

    a.yaw = rotateTowards(a.yaw, desiredYaw, dt * 2.8);
    const move = speed * dt * 0.6;
    const nx = a.x + Math.sin(a.yaw - Math.PI / 2) * -move;
    const nz = a.z + Math.cos(a.yaw - Math.PI / 2) * move;
    // Only accept moves that don't climb impossible grades.
    const hNow = this.gen.height(a.x, a.z);
    const hNext = this.gen.height(nx, nz);
    if (Math.abs(hNext - hNow) < 1.6 || speed > 4) {
      a.x = nx;
      a.z = nz;
    } else {
      a.yaw += 1.2;
    }
    a.y = this.gen.height(a.x, a.z);
    a.speed = speed;
  }

  private kill(a: Animal, cause: string, killer?: Animal): void {
    if (a.dead) return;
    a.dead = true;
    a.state = 'dead';
    a.activity = 'dead';
    a.deathCause = cause;
    a.speed = 0;
    (a as unknown as { _deadAt: number })._deadAt = performance.now();
    this.deaths++;
    if (cause.startsWith('hunted') || killer) {
      this.events.push({ kind: 'kill', species: a.species, x: a.x, z: a.z, detail: `${SPECIES[a.species].label} died (${cause})` });
    }
  }

  /** Population-level tick used when few animals are detailed (far regions). */
  stepAbstract(hours: number): void {
    for (const [species, count] of Object.entries(this.abstractCounts)) {
      const def = SPECIES[species];
      if (!def || count <= 0) continue;
      const growth = count * 0.0016 * hours * (def.diet === 'predator' ? 0.5 : 1);
      const cap = this.carryingCapacity(def);
      this.abstractCounts[species] = clamp(count + growth * (1 - count / cap), 0, cap);
    }
  }

  /** Keep populations near carrying capacity around the player. */
  regulatePopulations(centerX: number, centerZ: number, radius: number, rng: RNG): void {
    const counts: Record<string, number> = {};
    const positions: Record<string, Animal[]> = {};
    for (const a of this.animals) {
      if (a.dead) continue;
      const d = Math.hypot(a.x - centerX, a.z - centerZ);
      if (d > radius) {
        // Distant animals become abstract counts and despawn.
        this.abstractCounts[a.species] = (this.abstractCounts[a.species] ?? 0) + 1;
        a.dead = true;
        (a as unknown as { _deadAt: number })._deadAt = -1e9;
        continue;
      }
      counts[a.species] = (counts[a.species] ?? 0) + 1;
      (positions[a.species] ??= []).push(a);
    }
    this.animals = this.animals.filter((a) => !a.dead);

    for (const def of Object.values(SPECIES)) {
      if (def.domestic) continue;
      const local = counts[def.id] ?? 0;
      const abstract = this.abstractCounts[def.id] ?? 0;
      const cap = this.carryingCapacity(def) * 0.35;
      if (local + abstract < cap * 0.4) {
        // Spawn a small group somewhere suitable near the player ring.
        for (let i = 0; i < 2; i++) {
          const ang = rng.range(0, TAU);
          const dist = rng.range(radius * 0.35, radius * 0.85);
          this.spawnHabitatSuitable(centerX + Math.cos(ang) * dist, centerZ + Math.sin(ang) * dist, rng);
        }
      } else if (local > cap * 1.6) {
        // Cull the weakest far-from-player animals back to abstraction.
        const arr = positions[def.id] ?? [];
        arr.sort((a, b) => Math.hypot(b.x - centerX, b.z - centerZ) - Math.hypot(a.x - centerX, a.z - centerZ));
        for (let i = 0; i < Math.ceil(arr.length * 0.12); i++) {
          const a = arr[i];
          this.abstractCounts[def.id] = (this.abstractCounts[def.id] ?? 0) + 1;
          a.dead = true;
          (a as unknown as { _deadAt: number })._deadAt = -1e9;
        }
        this.animals = this.animals.filter((a) => !a.dead);
      }
    }
  }

  byId(id: number): Animal | null {
    return this.animals.find((a) => a.id === id) ?? null;
  }

  get populationBySpecies(): Record<string, number> {
    const counts: Record<string, number> = { ...this.abstractCounts };
    for (const a of this.animals) {
      if (!a.dead) counts[a.species] = (counts[a.species] ?? 0) + 1;
    }
    return counts;
  }

  private pendingEvents: AnimalEvent[] = [];
  private emitEvents(): void {
    if (this.events.length > 60) this.events = this.events.slice(-60);
  }

  serialize(): { animals: Animal[]; births: number; deaths: number; abstractCounts: Record<string, number> } {
    return {
      animals: this.animals.filter((a) => !a.dead).slice(0, 400),
      births: this.births,
      deaths: this.deaths,
      abstractCounts: this.abstractCounts,
    };
  }

  restore(data: { animals: Animal[]; births: number; deaths: number; abstractCounts: Record<string, number> } | undefined): void {
    if (!data) return;
    this.animals = data.animals ?? [];
    this.births = data.births ?? 0;
    this.deaths = data.deaths ?? 0;
    this.abstractCounts = data.abstractCounts ?? {};
    this.nextId = this.animals.reduce((m, a) => Math.max(m, a.id), 0) + 1;
    for (const a of this.animals) {
      const t = a.tint as unknown as { r?: number; g?: number; b?: number };
      a.tint =
        t && typeof t === 'object' && t.r !== undefined && t.g !== undefined && t.b !== undefined
          ? new THREE.Color(t.r, t.g, t.b)
          : new THREE.Color(0.55, 0.45, 0.3);
    }
  }
}

function dtHours(hours: number): number {
  // Movement is scaled to real-ish pacing: one game hour ≈ 3.6 s at 1×.
  return clamp(hours * 3.6, 0, 0.5);
}
