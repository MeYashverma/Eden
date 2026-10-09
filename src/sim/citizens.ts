/**
 * Human life simulation.
 *
 * Each citizen has an identity, household, occupation, needs (hunger, energy,
 * social, comfort), mood, skills, relationships and a working memory. A
 * utility scorer chooses what to do next from needs + time of day + world
 * state: eat at home or the market, work the fields or fish, socialise in the
 * plaza, fetch water, sleep. Citizens walk real paths between their home,
 * workplace and gathering spots — you can follow one through a whole day.
 *
 * Schedules respond to conditions: a hungry citizen seeks food wherever it
 * exists, a frightened one flees danger, and when work is done they gather.
 */

import { RNG, hashCombine, seededRng } from '../core/rng';
import { clamp, lerp, rotateTowards, TAU, angleDelta } from '../core/math';
import type { WorldGen } from '../world/worldGen';
import type { Hydrology } from '../world/hydrology';
import type { SettlementRecord, BuildingRecord } from './settlements';
import { generatePersonName } from './settlements';
import { pickHumanColors, type HumanActivity, type HumanRenderInput } from './agentRenderers';
import * as THREE from 'three';

export type CitizenAction =
  | 'sleep' | 'wake' | 'eat_home' | 'eat_market' | 'work' | 'farm' | 'fish'
  | 'socialize' | 'walk' | 'rest' | 'shop' | 'fetch_water' | 'wander' | 'flee' | 'idle' | 'build';

export type Occupation =
  | 'farmer' | 'fisher' | 'lumberjack' | 'builder' | 'shopkeeper' | 'innkeeper'
  | 'merchant' | 'guard' | 'laborer' | 'homemaker' | 'child' | 'elder';

export interface CitizenRelationship {
  targetId: number;
  affinity: number; // -1..1
  familiarity: number; // 0..1
  type: 'stranger' | 'acquaintance' | 'friend' | 'family' | 'partner' | 'rival';
}

export interface CitizenMemory {
  day: number;
  text: string;
  weight: number;
}

export interface Citizen {
  id: number;
  name: string;
  age: number; // years
  sex: 0 | 1;
  settlementId: number;
  homeId: number;
  workplaceId: number;
  occupation: Occupation;
  x: number;
  y: number;
  z: number;
  yaw: number;
  speed: number;
  phase: number;
  action: CitizenAction;
  activity: HumanActivity;
  targetX: number;
  targetZ: number;
  timer: number;
  needs: { hunger: number; energy: number; social: number; comfort: number };
  mood: number; // 0..1
  health: number;
  money: number;
  skills: Record<string, number>;
  relationships: CitizenRelationship[];
  memories: CitizenMemory[];
  inventory: { food: number; wood: number; goods: number };
  colors: { skin: number; hair: number; shirt: number; pants: number };
  scale: number;
  atHome: boolean;
  frightened: boolean;
  alive: boolean;
  walkDistance: number;
}

export interface CitizenEvent {
  day: number;
  text: string;
  x: number;
  z: number;
  kind: 'social' | 'work' | 'need' | 'life' | 'danger';
}

const OCCUPATIONS: Occupation[] = [
  'farmer', 'fisher', 'lumberjack', 'builder', 'shopkeeper', 'innkeeper', 'merchant', 'guard', 'laborer',
];

export class CitizenSimulation {
  citizens: Citizen[] = [];
  events: CitizenEvent[] = [];
  private nextId = 1;
  births = 0;
  deaths = 0;
  dayCounter = 0;

  constructor(private gen: WorldGen, private hydro: Hydrology) {}

  /** Create the founding population of a settlement. */
  populateSettlement(settlement: SettlementRecord, count: number, seed: number): Citizen[] {
    const rng = seededRng(seed, settlement.id, 4242);
    const created: Citizen[] = [];
    const homes = settlement.buildings.filter((b) => b.type === 'house' || b.type === 'cottage');
    const jobs = settlement.buildings.filter((b) => b.workplaces > 0);

    for (let i = 0; i < count; i++) {
      const age = rng.next() < 0.22 ? rng.range(6, 17) : rng.range(18, 68);
      const sex = rng.chance(0.5) ? 1 : 0;
      const home = homes.length > 0 ? homes[i % homes.length] : settlement.buildings[0];
      const job = jobs.length > 0 ? jobs[i % jobs.length] : settlement.buildings[0];
      const occupation: Occupation = age < 15 ? 'child' : age > 62 ? 'elder' : this.jobForBuilding(job.type, rng);
      const colors = pickHumanColors(() => rng.next());
      const px = home.x + rng.range(-6, 6);
      const pz = home.z + rng.range(-6, 6);
      const citizen: Citizen = {
        id: this.nextId++,
        name: generatePersonName(rng),
        age,
        sex,
        settlementId: settlement.id,
        homeId: home.id,
        workplaceId: job.id,
        occupation,
        x: px,
        y: this.gen.height(px, pz),
        z: pz,
        yaw: rng.range(0, TAU),
        speed: 0,
        phase: rng.range(0, TAU),
        action: 'idle',
        activity: 'idle',
        targetX: px,
        targetZ: pz,
        timer: rng.range(0, 3),
        needs: { hunger: rng.range(35, 75), energy: rng.range(55, 95), social: rng.range(35, 80), comfort: rng.range(50, 90) },
        mood: rng.range(0.5, 0.75),
        health: 100,
        money: rng.range(8, 60),
        skills: { farming: rng.range(0, 1), building: rng.range(0, 1), social: rng.range(0, 1) },
        relationships: [],
        memories: [],
        inventory: { food: rng.range(1, 4), wood: 0, goods: rng.range(0, 2) },
        colors,
        scale: age < 15 ? lerp(0.62, 0.92, (age - 6) / 11) : rng.range(0.92, 1.08),
        atHome: true,
        frightened: false,
        alive: true,
        walkDistance: 0,
      };

      // Seed family/friendship links within the settlement.
      if (i > 0 && rng.chance(0.5)) {
        const other = created[rng.int(0, created.length - 1)];
        const type = rng.chance(0.35) ? 'family' : 'friend';
        citizen.relationships.push({ targetId: other.id, affinity: rng.range(0.3, 0.85), familiarity: rng.range(0.4, 0.9), type });
        other.relationships.push({ targetId: citizen.id, affinity: rng.range(0.3, 0.85), familiarity: rng.range(0.4, 0.9), type });
      }

      this.citizens.push(citizen);
      created.push(citizen);
    }
    return created;
  }

  private jobForBuilding(type: string, rng: RNG): Occupation {
    switch (type) {
      case 'barn': return rng.chance(0.7) ? 'farmer' : 'laborer';
      case 'shop': return 'shopkeeper';
      case 'tavern': return 'innkeeper';
      case 'warehouse': return rng.chance(0.5) ? 'merchant' : 'laborer';
      case 'tower': return 'guard';
      case 'dock': return rng.chance(0.6) ? 'fisher' : 'merchant';
      default: return rng.pick(OCCUPATIONS);
    }
  }

  buildingById(settlement: SettlementRecord, id: number): BuildingRecord | null {
    return settlement.buildings.find((b) => b.id === id) ?? null;
  }

  /**
   * Decide and act for every citizen over a game-hour slice.
   * @param hourOfDay 0..24
   */
  step(
    hours: number,
    hourOfDay: number,
    day: number,
    settlements: SettlementRecord[],
    playerX: number,
    playerZ: number,
    dangerX?: number,
    dangerZ?: number,
  ): void {
    this.dayCounter = day;
    for (const c of this.citizens) {
      if (!c.alive) continue;
      const settlement = settlements.find((s) => s.id === c.settlementId);
      if (!settlement) continue;

      // ---- needs decay --------------------------------------------------
      c.needs.hunger = clamp(c.needs.hunger + hours * 3.6, 0, 100);
      const sleeping = c.action === 'sleep';
      c.needs.energy = clamp(c.needs.energy + (sleeping ? hours * 12 : -hours * 2.1), 0, 100);
      c.needs.social = clamp(c.needs.social + hours * 1.6, 0, 100);
      c.needs.comfort = clamp(c.needs.comfort + (c.atHome && sleeping ? hours * 6 : -hours * 0.8), 0, 100);

      if (c.needs.hunger > 88) c.health = clamp(c.health - hours * 1.6, 0, 100);
      if (c.health < 100 && c.needs.hunger < 55 && c.needs.energy > 45) {
        c.health = clamp(c.health + hours * 1.1, 0, 100);
      }
      if (c.health <= 0) {
        c.alive = false;
        this.deaths++;
        this.events.push({ day, text: `${c.name} of ${settlement.name} has died.`, x: c.x, z: c.z, kind: 'life' });
        continue;
      }

      // Hunger consumes food from inventory or home settlement stocks.
      if (c.needs.hunger > 62 && c.inventory.food > 0) {
        c.inventory.food -= hours * 0.35;
        c.needs.hunger = clamp(c.needs.hunger - hours * 8, 0, 100);
      }

      // Fear response near danger (predators, storms handled by caller).
      if (dangerX !== undefined && dangerZ !== undefined) {
        const d = Math.hypot(c.x - dangerX, c.z - dangerZ);
        c.frightened = d < 28;
      } else {
        c.frightened = false;
      }

      // ---- choose action (utility scoring) -------------------------------
      const home = this.buildingById(settlement, c.homeId) ?? settlement.buildings[0];
      const work = this.buildingById(settlement, c.workplaceId) ?? settlement.buildings[0];
      const plaza = settlement.buildings.find((b) => b.type === 'well') ?? settlement.buildings[0];

      const isNight = hourOfDay < 5.5 || hourOfDay > 21.5;
      const isWorkHours = hourOfDay > 7 && hourOfDay < 18.5;

      const scores: Record<CitizenAction, number> = {
        sleep: isNight ? 0.75 + (1 - c.needs.energy / 100) * 0.8 : (1 - c.needs.energy / 100) * 0.55,
        wake: 0,
        eat_home: (1 - c.needs.hunger / 100) * 1.4 * (c.inventory.food > 0.2 ? 1.3 : 0.25) * (isNight ? 0.7 : 1),
        eat_market: (1 - c.needs.hunger / 100) * 1.1 * (settlement.stocks.food > 2 ? 1 : 0.1) * (c.money > 1 ? 1 : 0.2),
        work: isWorkHours && c.occupation !== 'child' && c.occupation !== 'elder' ? 0.9 + c.needs.energy / 220 : 0.12,
        farm: isWorkHours && (c.occupation === 'farmer' || c.occupation === 'homemaker') ? 0.85 : 0.1,
        fish: isWorkHours && c.occupation === 'fisher' ? 1.0 : 0.08,
        socialize: (1 - c.needs.social / 100) * 1.25 * (isWorkHours ? 0.55 : 1.1),
        walk: 0.18,
        rest: (1 - c.needs.energy / 100) * 0.6 * (isWorkHours ? 0.5 : 1),
        shop: c.money > 4 && c.inventory.food < 1.5 ? 0.7 : 0.12,
        fetch_water: c.needs.comfort < 45 ? 0.5 : 0.15,
        wander: 0.2,
        flee: c.frightened ? 3 : 0,
        idle: 0.16,
        build: c.occupation === 'builder' && isWorkHours ? 0.8 : 0,
      };

      let best: CitizenAction = 'idle';
      let bestScore = -1;
      for (const [k, v] of Object.entries(scores)) {
        if (v > bestScore) {
          bestScore = v;
          best = k as CitizenAction;
        }
      }
      if (c.action === 'sleep' && !isNight && c.needs.energy > 55) best = 'wake';
      c.action = best;

      // ---- act ------------------------------------------------------------
      const act = (action: CitizenAction, activity: HumanActivity, tx: number, tz: number): void => {
        c.action = action;
        c.activity = activity;
        c.targetX = tx;
        c.targetZ = tz;
      };

      switch (c.action) {
        case 'sleep': {
          act('sleep', 'sleep', home.x, home.z);
          this.moveToward(c, home.x, home.z, hours, 1.3);
          if (Math.hypot(c.x - home.x, c.z - home.z) < 4) {
            c.atHome = true;
            c.speed = 0;
          }
          break;
        }
        case 'wake': {
          act('idle', 'idle', home.x, home.z);
          c.atHome = false;
          c.needs.energy = clamp(c.needs.energy + hours * 2, 0, 100);
          break;
        }
        case 'eat_home': {
          act('eat_home', 'eat', home.x, home.z);
          this.moveToward(c, home.x, home.z, hours, 1.5);
          if (Math.hypot(c.x - home.x, c.z - home.z) < 3.5) {
            c.activity = 'eat';
            c.speed = 0;
            c.atHome = true;
            c.inventory.food = Math.max(0, c.inventory.food - hours * 0.4);
            c.needs.hunger = clamp(c.needs.hunger - hours * 14, 0, 100);
            c.needs.comfort = clamp(c.needs.comfort + hours * 4, 0, 100);
          }
          break;
        }
        case 'eat_market': {
          const wellB = plaza;
          act('eat_market', 'eat', wellB.x + 3, wellB.z + 3);
          this.moveToward(c, wellB.x + 3, wellB.z + 3, hours, 1.6);
          if (Math.hypot(c.x - wellB.x, c.z - wellB.z) < 5) {
            c.activity = 'eat';
            c.speed = 0;
            if (settlement.stocks.food > 1) {
              settlement.stocks.food -= hours * 0.55;
              c.needs.hunger = clamp(c.needs.hunger - hours * 13, 0, 100);
              c.money = Math.max(0, c.money - hours * 0.2);
            }
            c.needs.social = clamp(c.needs.social + hours * 3, 0, 100);
          }
          break;
        }
        case 'work':
        case 'farm':
        case 'build': {
          act('work', 'work', work.x, work.z);
          this.moveToward(c, work.x, work.z, hours, 1.7);
          if (Math.hypot(c.x - work.x, c.z - work.z) < 4) {
            c.activity = 'work';
            c.speed = 0;
            c.atHome = false;
            const skill = c.skills.farming ?? 0.4;
            if (c.action === 'farm' || c.occupation === 'farmer') {
              settlement.stocks.food += hours * (0.7 + skill * 0.8);
              c.skills.farming = clamp(skill + hours * 0.004, 0, 1);
              if (work.hasField) work.fieldGrowth = clamp(work.fieldGrowth + hours * 0.012, 0, 1);
            } else if (c.occupation === 'builder') {
              settlement.stocks.timber = Math.max(0, settlement.stocks.timber - hours * 0.12);
              for (const b of settlement.buildings) {
                if (!b.constructed) {
                  b.constructionProgress = clamp(b.constructionProgress + hours * 0.02, 0, 1);
                  if (b.constructionProgress >= 1) b.constructed = true;
                }
              }
            } else if (c.occupation === 'shopkeeper' || c.occupation === 'merchant') {
              settlement.stocks.goods += hours * 0.28;
              settlement.stocks.money += hours * 0.35;
            } else {
              settlement.stocks.timber += hours * 0.18;
            }
            c.money += hours * 0.42;
            c.needs.energy = clamp(c.needs.energy - hours * 1.4, 0, 100);
          }
          break;
        }
        case 'fish': {
          const dock = settlement.buildings.find((b) => b.type === 'dock');
          const fx = dock ? dock.x : settlement.x + 40;
          const fz = dock ? dock.z : settlement.z + 40;
          act('fish', 'work', fx, fz);
          this.moveToward(c, fx, fz, hours, 1.5);
          if (Math.hypot(c.x - fx, c.z - fz) < 5) {
            c.activity = 'work';
            c.speed = 0;
            settlement.stocks.food += hours * 0.85;
            c.inventory.food = Math.min(6, c.inventory.food + hours * 0.2);
          }
          break;
        }
        case 'socialize': {
          const friends = this.citizens.filter((o) => o.alive && o.id !== c.id && o.settlementId === c.settlementId);
          let tx = plaza.x;
          let tz = plaza.z;
          if (friends.length > 0) {
            // Walk to the nearest friend who is also socializing, else the plaza.
            let bestD = Infinity;
            for (const f of friends) {
              const d = Math.hypot(f.x - c.x, f.z - c.z);
              if (d < bestD && (f.action === 'socialize' || f.action === 'idle' || f.action === 'wander')) {
                bestD = d;
                tx = f.x;
                tz = f.z;
              }
            }
          }
          act('socialize', 'gesture', tx, tz);
          this.moveToward(c, tx, tz, hours, 1.45);
          const dist = Math.hypot(c.x - tx, c.z - tz);
          if (dist < 3.2) {
            c.speed = 0;
            c.activity = 'gesture';
            c.needs.social = clamp(c.needs.social - hours * 10, 0, 100);
            // Relationships grow from actual proximity + interaction.
            for (const other of this.citizens) {
              if (other.id === c.id || !other.alive) continue;
              if (Math.hypot(other.x - c.x, other.z - c.z) < 6) {
                this.bond(c, other, hours * 0.05);
              }
            }
            if (c.needs.social < 25 && c.phase % 2 < 0.02) {
              this.remember(c, `Enjoyed a good conversation in ${settlement.name}.`, day);
            }
          } else {
            c.activity = 'walk';
          }
          break;
        }
        case 'shop': {
          const shop = settlement.buildings.find((b) => b.type === 'shop') ?? plaza;
          act('shop', 'walk', shop.x, shop.z);
          this.moveToward(c, shop.x, shop.z, hours, 1.55);
          if (Math.hypot(c.x - shop.x, c.z - shop.z) < 4) {
            c.activity = 'idle';
            c.speed = 0;
            if (settlement.stocks.goods > 0.5 && c.money > 1) {
              settlement.stocks.goods -= hours * 0.2;
              settlement.stocks.money += hours * 0.35;
              c.money -= hours * 0.35;
              c.inventory.food = Math.min(6, c.inventory.food + hours * 0.5);
              c.inventory.goods = Math.min(3, c.inventory.goods + hours * 0.12);
            }
          }
          break;
        }
        case 'fetch_water': {
          act('fetch_water', 'walk', plaza.x, plaza.z);
          this.moveToward(c, plaza.x, plaza.z, hours, 1.6);
          if (Math.hypot(c.x - plaza.x, c.z - plaza.z) < 3.5) {
            c.activity = 'gesture';
            c.speed = 0;
            c.needs.comfort = clamp(c.needs.comfort + hours * 9, 0, 100);
          }
          break;
        }
        case 'flee': {
          const dx = c.x - (dangerX ?? playerX);
          const dz = c.z - (dangerZ ?? playerZ);
          const len = Math.hypot(dx, dz) || 1;
          act('flee', 'run', c.x + (dx / len) * 40, c.z + (dz / len) * 40);
          this.moveToward(c, c.targetX, c.targetZ, hours, 3.2);
          break;
        }
        case 'rest': {
          act('rest', 'sit', home.x, home.z);
          this.moveToward(c, home.x, home.z, hours, 1.2);
          if (Math.hypot(c.x - home.x, c.z - home.z) < 5) {
            c.activity = 'sit';
            c.speed = 0;
            c.needs.energy = clamp(c.needs.energy + hours * 5, 0, 100);
            c.needs.comfort = clamp(c.needs.comfort + hours * 6, 0, 100);
          }
          break;
        }
        default: {
          // wander/idle around plaza
          act('wander', 'walk', plaza.x + Math.sin(c.phase) * 12, plaza.z + Math.cos(c.phase * 1.3) * 12);
          this.moveToward(c, c.targetX, c.targetZ, hours, 1.1);
          if (Math.hypot(c.x - c.targetX, c.z - c.targetZ) < 2) {
            c.activity = 'idle';
            c.speed = 0;
          }
        }
      }

      // Mood aggregates from needs
      c.mood = clamp(
        (c.needs.hunger + c.needs.energy + c.needs.social + c.needs.comfort + c.health) / 500,
        0, 1,
      );
      c.phase += hours * (2 + c.speed * 2.2);
    }

    this.events = this.events.slice(-80);
  }

  /** Move a citizen toward a target at walking speed with slope-aware steering. */
  private moveToward(c: Citizen, tx: number, tz: number, hours: number, speed: number): void {
    const dt = clamp(hours * 3.6, 0, 0.45); // pacing conversion
    const dx = tx - c.x;
    const dz = tz - c.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.35) {
      c.speed = 0;
      return;
    }
    const desiredYaw = Math.atan2(-dz, dx) - Math.PI / 2;
    c.yaw = rotateTowards(c.yaw, desiredYaw, dt * 3.2);

    let move = speed * dt * 1.55;
    const nx = c.x + Math.sin(c.yaw - Math.PI / 2) * -move;
    const nz = c.z + Math.cos(c.yaw - Math.PI / 2) * move;

    // Terrain check — citizens don't climb cliffs or walk into deep water.
    const hNow = this.gen.height(c.x, c.z);
    const hNext = this.gen.height(nx, nz);
    const slope = this.gen.slope(nx, nz);
    const water = this.hydro.surfaceAt(nx, nz);
    const depth = water !== null ? water - hNext : 0;
    if (Math.abs(hNext - hNow) < 1.7 && slope < 0.72 && depth < 0.6) {
      c.x = nx;
      c.z = nz;
      c.y = hNext;
      c.walkDistance += move;
    } else {
      // Slide along the obstacle
      c.yaw += 1.4;
    }
    c.speed = speed;
  }

  private bond(a: Citizen, b: Citizen, amount: number): void {
    let rel = a.relationships.find((r) => r.targetId === b.id);
    if (!rel) {
      rel = { targetId: b.id, affinity: 0, familiarity: 0, type: 'acquaintance' };
      a.relationships.push(rel);
    }
    rel.familiarity = clamp(rel.familiarity + amount * 0.6, 0, 1);
    rel.affinity = clamp(rel.affinity + amount * 0.35, -1, 1);
    if (rel.affinity > 0.72 && rel.familiarity > 0.6 && rel.type === 'acquaintance') rel.type = 'friend';
    if (rel.affinity > 0.88 && rel.type === 'friend' && a.age > 18 && b.age > 18 && rel.familiarity > 0.82) {
      rel.type = 'partner';
      this.events.push({ day: this.dayCounter, text: `${a.name} and ${b.name} have become partners.`, x: a.x, z: a.z, kind: 'social' });
    }
  }

  private remember(c: Citizen, text: string, day: number): void {
    c.memories.push({ day, text, weight: 1 });
    if (c.memories.length > 12) c.memories.shift();
    this.events.push({ day, text: `${c.name}: ${text}`, x: c.x, z: c.z, kind: 'social' });
  }

  /** Births when partners exist and settlement is prosperous. */
  tryBirths(settlements: SettlementRecord[], day: number): void {
    for (const s of settlements) {
      const people = this.citizens.filter((c) => c.alive && c.settlementId === s.id);
      const partners = people.filter((c) => c.relationships.some((r) => r.type === 'partner'));
      const children = people.filter((c) => c.age < 15).length;
      const canGrow = partners.length >= 2 && children < people.length * 0.38 && s.prosperity > 0.42 && s.stocks.food > 18;
      if (canGrow && hashCombine(day, s.id, people.length) % 140 === 0) {
        const parent = partners[0];
        const rng = seededRng(day, s.id, parent.id);
        const home = this.buildingById(s, parent.homeId) ?? s.buildings[0];
        const colors = pickHumanColors(() => rng.next());
        const baby: Citizen = {
          id: this.nextId++,
          name: generatePersonName(rng),
          age: 0,
          sex: rng.chance(0.5) ? 1 : 0,
          settlementId: s.id,
          homeId: parent.homeId,
          workplaceId: 0,
          occupation: 'child',
          x: home.x,
          y: this.gen.height(home.x, home.z),
          z: home.z,
          yaw: 0,
          speed: 0,
          phase: 0,
          action: 'idle',
          activity: 'idle',
          targetX: home.x,
          targetZ: home.z,
          timer: 1,
          needs: { hunger: 40, energy: 80, social: 50, comfort: 70 },
          mood: 0.7,
          health: 100,
          money: 0,
          skills: { farming: 0, building: 0, social: 0.2 },
          relationships: [{ targetId: parent.id, affinity: 0.9, familiarity: 0.7, type: 'family' }],
          memories: [],
          inventory: { food: 1, wood: 0, goods: 0 },
          colors,
          scale: 0.55,
          atHome: true,
          frightened: false,
          alive: true,
          walkDistance: 0,
        };
        this.citizens.push(baby);
        this.births++;
        this.events.push({ day, text: `A child was born in ${s.name}: ${baby.name}.`, x: baby.x, z: baby.z, kind: 'life' });
      }
    }
  }

  /** Build render inputs for the visible set. */
  renderInputs(): HumanRenderInput[] {
    const out: HumanRenderInput[] = [];
    for (const c of this.citizens) {
      if (!c.alive) continue;
      out.push({
        x: c.x,
        y: c.y,
        z: c.z,
        yaw: c.yaw,
        speed: c.speed,
        activity: c.activity,
        phase: c.phase,
        skin: c.colors.skin,
        hair: c.colors.hair,
        shirt: c.colors.shirt,
        pants: c.colors.pants,
        scale: c.scale,
      });
    }
    return out;
  }

  nearestTo(x: number, z: number, maxDist = 12): Citizen | null {
    let best: Citizen | null = null;
    let bestD = maxDist * maxDist;
    for (const c of this.citizens) {
      if (!c.alive) continue;
      const d = (c.x - x) * (c.x - x) + (c.z - z) * (c.z - z);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  serialize(): { citizens: Citizen[]; births: number; deaths: number } {
    return { citizens: this.citizens.filter((c) => c.alive), births: this.births, deaths: this.deaths };
  }

  restore(data: { citizens: Citizen[]; births: number; deaths: number } | undefined): void {
    if (!data) return;
    this.citizens = data.citizens ?? [];
    this.births = data.births ?? 0;
    this.deaths = data.deaths ?? 0;
    this.nextId = this.citizens.reduce((m, c) => Math.max(m, c.id), 0) + 1;
  }
}
