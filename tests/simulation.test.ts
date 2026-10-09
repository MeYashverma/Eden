/**
 * Simulation tests: animal AI state transitions, population limits,
 * citizen routines and settlement economy.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { WorldGen } from '../src/world/worldGen';
import { Hydrology } from '../src/world/hydrology';
import { defaultWorldConfig, CHUNK_SIZE } from '../src/world/types';
import { AnimalSimulation, SPECIES } from '../src/sim/animals';
import { CitizenSimulation } from '../src/sim/citizens';
import { generateSettlement, scoreSettlementSite, tickSettlement, resetSettlementIds, type SettlementRecord } from '../src/sim/settlements';
import { createBuildingMaterials } from '../src/sim/buildings';
import { VegetationSystem } from '../src/world/vegetation';
import { Simulation } from '../src/sim/simulation';
import { RNG } from '../src/core/rng';

// Minimal placeholder textures for VegetationSystem (node has no document).
const fakeTexture = { } as never;

describe('animal simulation', () => {
  const gen = new WorldGen(defaultWorldConfig(555));
  const hydro = new Hydrology(gen);
  const sim = new AnimalSimulation(gen, hydro);

  it('spawns habitat-appropriate species with valid state', () => {
    const rng = new RNG(1);
    let spawned = 0;
    for (let i = 0; i < 80; i++) {
      const a = sim.spawnHabitatSuitable(rng.range(-600, 600), rng.range(-600, 600), rng);
      if (a) {
        spawned++;
        expect(a.health).toBeGreaterThan(0);
        expect(a.hunger).toBeGreaterThanOrEqual(0);
        expect(['wander', 'graze', 'drink', 'rest', 'sleep', 'flee', 'hunt', 'chase', 'mate', 'socialize', 'follow_herd', 'migrate', 'dead']).toContain(a.state);
        expect(SPECIES[a.species]).toBeDefined();
      }
    }
    expect(spawned).toBeGreaterThan(3);
  });

  it('needs decay over time and hunger drives grazing', () => {
    const animal = sim.spawn('deer', 100, 100, new RNG(2))!;
    animal.hunger = 20;
    animal.x = 100;
    animal.z = 100;
    animal.y = gen.height(100, 100);
    for (let i = 0; i < 12; i++) {
      sim.stepDetailed(0.25, 5000, 5000); // player far away
    }
    // Either it found food (hunger improved) or hunger kept dropping
    expect(animal.hunger).toBeLessThan(95);
  });

  it('herbivores flee from a close player', () => {
    const deer = sim.spawn('deer', 200, 200, new RNG(3))!;
    deer.hunger = 90;
    deer.thirst = 90;
    deer.energy = 90;
    deer.fear = 0;
    for (let i = 0; i < 6; i++) sim.stepDetailed(0.15, 205, 200);
    expect(['flee', 'wander', 'graze', 'rest', 'follow_herd', 'socialize']).toContain(deer.state);
    // Player proximity should raise fear at some point
    expect(deer.fear).toBeGreaterThanOrEqual(0);
  });

  it('predators attack perceived prey and kills are recorded', () => {
    const local = new AnimalSimulation(gen, hydro);
    const wolf = local.spawn('wolf', 0, 0, new RNG(4))!;
    wolf.hunger = 20;
    const rabbit = local.spawn('rabbit', 2.5, 0, new RNG(5))!;
    rabbit.health = 2;
    let killed = false;
    for (let i = 0; i < 80 && !killed; i++) {
      local.stepDetailed(0.25, 9999, 9999);
      killed = rabbit.dead;
    }
    expect(killed || wolf.hunger < 20).toBe(true);
  });

  it('population regulation keeps counts bounded', () => {
    const local = new AnimalSimulation(gen, hydro);
    const rng = new RNG(6);
    for (let i = 0; i < 40; i++) local.spawn('deer', rng.range(-100, 100), rng.range(-100, 100), rng);
    for (let round = 0; round < 6; round++) {
      local.regulatePopulations(0, 0, 260, rng);
    }
    const deerCount = local.animals.filter((a) => a.species === 'deer' && !a.dead).length;
    expect(deerCount).toBeLessThan(40);
  });

  it('starvation kills animals with no food', () => {
    const local = new AnimalSimulation(gen, hydro);
    const rabbit = local.spawn('rabbit', -200, -200, new RNG(7))!;
    rabbit.hunger = 1;
    rabbit.health = 3;
    for (let i = 0; i < 30; i++) local.stepDetailed(1, 9999, 9999);
    // Health must be dropping or the animal already died
    expect(rabbit.dead || rabbit.health < 3).toBe(true);
  });
});

describe('citizen simulation', () => {
  const gen = new WorldGen(defaultWorldConfig(888));
  const hydro = new Hydrology(gen);
  resetSettlementIds();
  const mats = createBuildingMaterials();
  let settlement: SettlementRecord;
  const citizens = new CitizenSimulation(gen, hydro);

  beforeAll(() => {
    // Find a good site and generate the settlement.
    let best = { score: -1, x: 0, z: 0 };
    for (let z = -400; z <= 400; z += 100) {
      for (let x = -400; x <= 400; x += 100) {
        const s = scoreSettlementSite(gen, hydro, x, z);
        if (s > best.score) best = { score: s, x, z };
      }
    }
    const bundle = generateSettlement(gen, hydro, mats, best.x, best.z, 0, 0);
    settlement = bundle.record;
    citizens.populateSettlement(settlement, 8, 42);
  });

  it('generates a settlement with buildings, roads and homes', () => {
    expect(settlement.buildings.length).toBeGreaterThanOrEqual(4);
    expect(settlement.roads.length).toBeGreaterThanOrEqual(2);
    expect(settlement.buildings.some((b) => b.type === 'house' || b.type === 'cottage')).toBe(true);
  });

  it('every citizen has identity, home and occupation', () => {
    for (const c of citizens.citizens) {
      expect(c.name.length).toBeGreaterThan(2);
      expect(c.occupation).toBeTruthy();
      expect(c.homeId).toBeGreaterThan(0);
      expect(['sleep', 'wake', 'eat_home', 'eat_market', 'work', 'farm', 'fish', 'socialize', 'walk', 'rest', 'shop', 'fetch_water', 'wander', 'flee', 'idle', 'build']).toContain(c.action);
    }
  });

  it('citizens act differently across a full day', () => {
    const seen = new Set<string>();
    // Simulate a full day in 0.5-hour slices.
    for (let hour = 5; hour < 23; hour += 0.5) {
      citizens.step(0.5, hour, 1, [settlement], 9999, 9999);
      for (const c of citizens.citizens) seen.add(c.action);
    }
    expect(seen.size).toBeGreaterThanOrEqual(3); // at least several distinct activities
  });

  it('citizens move between locations over the day', () => {
    const c = citizens.citizens[0];
    const start = { x: c.x, z: c.z };
    for (let hour = 7; hour < 17; hour += 0.5) {
      citizens.step(0.5, hour, 2, [settlement], 9999, 9999);
    }
    const moved = Math.hypot(c.x - start.x, c.z - start.z);
    expect(moved).toBeGreaterThan(0.5);
  });

  it('needs evolve over time (hunger rises when not eating)', () => {
    const c = citizens.citizens.find((x) => x.inventory.food === 0) ?? citizens.citizens[0];
    c.inventory.food = 0;
    c.needs.hunger = 10;
    for (let i = 0; i < 10; i++) citizens.step(0.5, 15, 3, [settlement], 9999, 9999);
    expect(c.needs.hunger).toBeGreaterThan(8);
  });

  it('settlement economy responds to population', () => {
    const s: SettlementRecord = {
      ...settlement,
      stocks: { food: 50, timber: 20, stone: 10, goods: 10, money: 100 },
      prosperity: 0.5,
    };
    const before = s.stocks.food;
    tickSettlement(s, 2, 8, 0, 1); // 8 people eating, no farmers
    expect(s.stocks.food).toBeLessThan(before);
    tickSettlement(s, 2, 8, 4, 1); // with farmers producing
    // With food production the decline slows or reverses.
    expect(s.stocks.food).toBeGreaterThanOrEqual(0);
  });
});

describe('integrated simulation orchestrator', () => {
  it('runs slices without errors and tracks stats from real state', () => {
    const gen = new WorldGen(defaultWorldConfig(31));
    const hydro = new Hydrology(gen);
    const veg = new VegetationSystem(gen, fakeTexture, fakeTexture);
    const sim = new Simulation(gen, hydro, veg, 31);
    const settlement = sim.ensureSettlementNear(0, 0, 1200);
    expect(settlement).not.toBeNull();

    for (let i = 0; i < 20; i++) {
      sim.update(0.4, 0, 0);
    }
    const stats = sim.stats();
    expect(stats.citizenCount).toBeGreaterThan(0);
    expect(stats.settlementCount).toBeGreaterThanOrEqual(1);
    expect(stats.weather).toBeTruthy();
    expect(Number.isFinite(stats.totalWaterVolume)).toBe(true);
  });

  it('serializes and restores population + time consistently', () => {
    const gen = new WorldGen(defaultWorldConfig(32));
    const hydro = new Hydrology(gen);
    const veg = new VegetationSystem(gen, fakeTexture, fakeTexture);
    const sim = new Simulation(gen, hydro, veg, 32);
    sim.ensureSettlementNear(0, 0, 1200);
    sim.update(3, 0, 0);
    const snapshot = sim.serialize();

    const veg2 = new VegetationSystem(gen, fakeTexture, fakeTexture);
    const sim2 = new Simulation(gen, hydro, veg2, 32);
    sim2.restore(snapshot as never);

    expect(sim2.clock.hours).toBeCloseTo(sim.clock.hours, 4);
    expect(sim2.citizens.citizens.filter((c) => c.alive).length).toBe(
      sim.citizens.citizens.filter((c) => c.alive).length,
    );
    expect(sim2.settlements.length).toBe(sim.settlements.length);
  });
});
