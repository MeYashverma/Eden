/**
 * Simulation orchestrator.
 *
 * Steps every living system on fixed game-time slices (so fast-forward keeps
 * agents consistent), owns the shared registries, and exposes the data that
 * UI, saves and stats consume. Rendering-side consumers (instanced agents)
 * read from the same records — no shadow state.
 */

import { RNG, hashCombine } from '../core/rng';
import { clamp, TAU } from '../core/math';
import type { WorldGen } from '../world/worldGen';
import type { Hydrology } from '../world/hydrology';
import { WorldClock } from '../core/clock';
import { WeatherSystem } from '../world/weather';
import { AnimalSimulation, SPECIES } from './animals';
import { CitizenSimulation } from './citizens';
import {
  generateSettlement, tickSettlement, scoreSettlementSite, buildRoadMesh,
  type SettlementRecord, type SettlementBundle,
  resetSettlementIds,
} from './settlements';
import { createBuildingMaterials, type SharedBuildingMaterials } from './buildings';
import { EcosystemTracker, type WorldStats } from './ecosystem';
import { WorldEventLog } from './events';
import { VegetationSystem } from '../world/vegetation';
import type { AnimalRenderInput } from './agentRenderers';
import * as THREE from 'three';

export class Simulation {
  clock = new WorldClock();
  weather: WeatherSystem;
  animals: AnimalSimulation;
  citizens: CitizenSimulation;
  events = new WorldEventLog();
  ecosystem = new EcosystemTracker();
  settlements: SettlementRecord[] = [];
  settlementBundles = new Map<number, SettlementBundle>();
  buildingMaterials: SharedBuildingMaterials;
  readonly group = new THREE.Group();

  private rng: RNG;
  private sliceAccum = 0;
  fps = 60;
  /** Live tree removals/timber harvested by the player. */
  timberHarvested = 0;

  constructor(
    public gen: WorldGen,
    public hydro: Hydrology,
    public veg: VegetationSystem,
    seed: number,
  ) {
    this.weather = new WeatherSystem(seed);
    this.animals = new AnimalSimulation(gen, hydro);
    this.citizens = new CitizenSimulation(gen, hydro);
    this.buildingMaterials = createBuildingMaterials();
    this.rng = new RNG(hashCombine(seed, 9187));
    this.group.name = 'simulation';
    resetSettlementIds();
  }

  /**
   * Ensure a settlement exists near a location (chunk-of-influence approach:
   * settlements are placed once, deterministically, and persist).
   */
  ensureSettlementNear(x: number, z: number, maxDist = 900): SettlementRecord | null {
    // Already one nearby?
    for (const s of this.settlements) {
      if (Math.hypot(s.x - x, s.z - z) < maxDist) return s;
    }

    // Deterministic candidate search on a ring grid around the point.
    let best = { score: -1, x: 0, z: 0 };
    for (let r = 180; r <= 760; r += 65) {
      for (let a = 0; a < TAU; a += Math.PI / 7) {
        const cx = x + Math.cos(a) * r;
        const cz = z + Math.sin(a) * r;
        const score = scoreSettlementSite(this.gen, this.hydro, cx, cz);
        if (score > best.score) best = { score, x: cx, z: cz };
      }
    }
    if (best.score < 1.5) return null;

    const bundle = generateSettlement(
      this.gen,
      this.hydro,
      this.buildingMaterials,
      best.x,
      best.z,
      this.settlements.length,
    );
    bundle.record.foundedDay = this.clock.day;
    this.settlements.push(bundle.record);
    this.settlementBundles.set(bundle.record.id, bundle);
    this.group.add(bundle.group);

    // Road ribbons along the settlement's road network.
    for (const road of bundle.record.roads) {
      bundle.group.add(buildRoadMesh(road, this.gen));
    }

    // Founding population
    const founders = Math.min(bundle.record.populationTarget, 7 + this.rng.int(0, 4));
    this.citizens.populateSettlement(bundle.record, founders, this.gen.config.seed);

    // Farm animals near farms
    const farm = bundle.record.buildings.find((b) => b.type === 'barn');
    if (farm) {
      for (let i = 0; i < 4; i++) {
        const a = this.rng.range(0, TAU);
        const d = this.rng.range(8, 18);
        this.animals.spawn(this.rng.chance(0.55) ? 'sheep' : 'chicken', farm.x + Math.cos(a) * d, farm.z + Math.sin(a) * d, this.rng);
      }
    }
    // Dogs and cats in the settlement
    for (let i = 0; i < 2; i++) {
      const sp = i === 0 ? 'dog' : 'cat';
      this.animals.spawn(sp, bundle.record.x + this.rng.range(-25, 25), bundle.record.z + this.rng.range(-25, 25), this.rng);
    }

    this.events.add('settlement', `${bundle.record.name} was founded — a new settlement takes root.`, best.x, best.z, this.clock);
    return bundle.record;
  }

  /** Add a player-placed building. */
  addBuilding(
    settlement: SettlementRecord,
    type: SettlementRecord['buildings'][number]['type'],
    x: number,
    z: number,
    rotation: number,
  ): void {
    const rec: SettlementRecord['buildings'][number] = {
      id: Math.floor(Math.random() * 1e9),
      type,
      x, z,
      y: this.gen.height(x, z),
      rotation,
      width: 8,
      depth: 7,
      height: 6,
      level: 1,
      residents: [],
      workplaces: type === 'barn' ? 3 : type === 'shop' ? 2 : 0,
      condition: 1,
      constructed: false,
      constructionProgress: 0.05,
      hasField: type === 'barn',
      fieldCrop: 'wheat',
      fieldGrowth: 0,
    };
    settlement.buildings.push(rec);
  }

  /**
   * Advance simulation by real seconds at the current clock speed.
   * Internally slices into ≤15-game-minute steps.
   */
  update(realSeconds: number, playerX: number, playerZ: number, detailRadius = 420): void {
    // Weather follows the ambient temperature at the player.
    const tempSample = this.gen.sample(playerX, playerZ, this.clock.yearPhase);
    const temp = this.gen.temperatureAt(playerX, playerZ, tempSample.height, this.clock.yearPhase, this.weather.state.tempOffset);

    this.clock.advance(realSeconds, (sliceHours) => {
      this.sliceAccum += sliceHours;
      this.weather.update(sliceHours, this.clock.season, temp);
      this.hydro.waterBalance = clamp(this.weather.state.hydroBalance, 0.35, 1.6);
      this.hydro.step(Math.min(realSeconds, 1.5), Math.max(this.clock.hoursPerSecond, 0.02), this.weather.state.precipitation);
      this.hydro.recenter(playerX, playerZ);

      this.animals._daytime = this.clock.timeOfDay > 6 && this.clock.timeOfDay < 20;
      this.animals.stepDetailed(sliceHours, playerX, playerZ, this.weather.state.precipitation > 0.3 ? 0 : 0.15);
      this.animals.stepAbstract(sliceHours);
      this.citizens.step(
        sliceHours,
        this.clock.timeOfDay,
        this.clock.day,
        this.settlements,
        playerX,
        playerZ,
        this.events.fireCells[0]?.x,
        this.events.fireCells[0]?.z,
      );
      this.citizens.tryBirths(this.settlements, this.clock.day);

      for (const s of this.settlements) {
        const pop = this.citizens.citizens.filter((c) => c.alive && c.settlementId === s.id).length;
        const farmers = this.citizens.citizens.filter((c) => c.alive && c.settlementId === s.id && c.occupation === 'farmer').length;
        const message = tickSettlement(s, sliceHours, Math.max(1, pop), farmers * 0.55, this.clock.day);
        if (message && this.sliceAccum > 2) {
          this.events.add('settlement', message, s.x, s.z, this.clock);
        }
      }

      this.events.tick(sliceHours, this.clock, this.weather, this.hydro, this.animals, this.citizens, this.settlements, playerX, playerZ, this.rng);
      this.events.applyFireEffects(this.animals, sliceHours);

      // Seasonal vegetation tint
      this.veg.seasonPhase = this.clock.yearPhase;
    });

    // Population regulation at a slower cadence.
    if (this.sliceAccum > 1.5) {
      this.sliceAccum = 0;
      this.animals.regulatePopulations(playerX, playerZ, detailRadius, this.rng);
    }
  }

  /** Animal render inputs near the player (nearest-first, capped per species). */
  animalRenderInputs(playerX = 0, playerZ = 0): Record<string, AnimalRenderInput[]> {
    const perSpecies = new Map<string, Array<{ d: number; input: AnimalRenderInput }>>();
    for (const a of this.animals.animals) {
      if (a.dead) continue;
      const d = (a.x - playerX) * (a.x - playerX) + (a.z - playerZ) * (a.z - playerZ);
      if (d > 320 * 320) continue;
      const input: AnimalRenderInput = {
        x: a.x,
        y: a.y,
        z: a.z,
        yaw: a.yaw,
        speed: a.speed,
        activity: a.activity,
        phase: a.phase,
        scale: a.scale,
        tint: a.tint,
      };
      const arr = perSpecies.get(a.species) ?? [];
      arr.push({ d, input });
      perSpecies.set(a.species, arr);
    }
    const out: Record<string, AnimalRenderInput[]> = {};
    for (const [species, arr] of perSpecies) {
      arr.sort((a, b) => a.d - b.d);
      out[species] = arr.slice(0, 48).map((x) => x.input);
    }
    return out;
  }

  stats(): WorldStats {
    return this.ecosystem.compute(
      this.clock,
      this.weather,
      this.animals,
      this.citizens,
      this.settlements,
      this.hydro,
      this.veg,
      this.fps,
    );
  }

  serialize() {
    return {
      clock: this.clock.serialize(),
      weather: this.weather.serialize(),
      hydro: {
        waterBalance: this.hydro.waterBalance,
        // Window water state is large; persist only the balance + let warmup
        // restore believable rivers/lakes on load (documented in docs/SAVES.md).
      },
      animals: this.animals.serialize(),
      citizens: this.citizens.serialize(),
      events: this.events.serialize(),
      ecosystem: this.ecosystem.serialize(),
      settlements: this.settlements.map((s) => ({ ...s, buildings: s.buildings.map((b) => ({ ...b })) })),
      timberHarvested: this.timberHarvested,
    };
  }

  restore(data: ReturnType<Simulation['serialize']> | undefined): void {
    if (!data) return;
    this.clock.restore(data.clock);
    this.weather.restore(data.weather);
    this.hydro.waterBalance = data.hydro?.waterBalance ?? 1;
    this.animals.restore(data.animals as never);
    this.citizens.restore(data.citizens as never);
    this.events.restore(data.events);
    this.ecosystem.restore(data.ecosystem as never);
    this.timberHarvested = data.timberHarvested ?? 0;
    this.settlements = data.settlements ?? [];

    // Rebuild visual bundles from restored records.
    for (const rec of this.settlements) {
      const bundle = generateSettlement(this.gen, this.hydro, this.buildingMaterials, rec.x, rec.z, rec.seedSalt ?? 0, 0);
      bundle.record = rec;
      for (const road of rec.roads) {
        bundle.group.add(buildRoadMesh(road, this.gen));
      }
      this.settlementBundles.set(rec.id, bundle);
      this.group.add(bundle.group);
    }
  }
}
