/**
 * Ecosystem aggregates and world statistics.
 *
 * Every number here is measured from the live simulation — populations from
 * the animal/citizen registries, water from hydrology, vegetation from the
 * vegetation system, weather from the weather machine. Nothing is invented.
 */

import type { AnimalSimulation } from './animals';
import type { CitizenSimulation } from './citizens';
import type { SettlementRecord } from './settlements';
import type { Hydrology } from '../world/hydrology';
import type { WeatherSystem } from '../world/weather';
import type { WorldClock } from '../core/clock';
import type { VegetationSystem } from '../world/vegetation';
import { SPECIES } from './animals';

export interface WorldStats {
  worldAgeDays: number;
  season: string;
  timeOfDay: string;
  weather: string;
  totalPopulation: number;
  citizenCount: number;
  citizenBirths: number;
  citizenDeaths: number;
  animalCount: number;
  animalBirths: number;
  animalDeaths: number;
  predatorCount: number;
  preyCount: number;
  populationBySpecies: Record<string, number>;
  waterCoverage: number; // 0..1 in simulation window
  averageWaterQuality: number;
  totalWaterVolume: number;
  rainLast24h: number;
  hydroBalance: number;
  settlementCount: number;
  settlementNames: string[];
  totalFood: number;
  totalProsperity: number;
  pollution: number;
  treeCount: number;
  editedCells: number;
  fps: number;
}

export class EcosystemTracker {
  history: Array<{ day: number; animals: number; citizens: number; food: number }> = [];

  compute(
    clock: WorldClock,
    weather: WeatherSystem,
    animals: AnimalSimulation,
    citizens: CitizenSimulation,
    settlements: SettlementRecord[],
    hydro: Hydrology,
    veg: VegetationSystem,
    fps: number,
  ): WorldStats {
    const pops = animals.populationBySpecies;
    let predator = 0;
    let prey = 0;
    let animalTotal = 0;
    for (const [sp, n] of Object.entries(pops)) {
      animalTotal += n;
      const def = SPECIES[sp];
      if (def && def.diet === 'predator') predator += n;
      else prey += n;
    }
    const aliveCitizens = citizens.citizens.filter((c) => c.alive);
    const food = settlements.reduce((s, x) => s + x.stocks.food, 0);
    const prosperity = settlements.length > 0
      ? settlements.reduce((s, x) => s + x.prosperity, 0) / settlements.length
      : 0;
    const pollution = settlements.length > 0
      ? settlements.reduce((s, x) => s + x.pollution, 0) / settlements.length
      : 0;

    const stats: WorldStats = {
      worldAgeDays: clock.day,
      season: clock.season,
      timeOfDay: clock.timeOfDay.toFixed(1),
      weather: weather.state.kind,
      totalPopulation: aliveCitizens.length + animalTotal,
      citizenCount: aliveCitizens.length,
      citizenBirths: citizens.births,
      citizenDeaths: citizens.deaths,
      animalCount: animalTotal,
      animalBirths: animals.births,
      animalDeaths: animals.deaths,
      predatorCount: predator,
      preyCount: prey,
      populationBySpecies: pops,
      waterCoverage: hydro.totalWater > 0 ? Math.min(1, hydro.totalWater / 4000) : 0,
      averageWaterQuality: hydro.averageQuality,
      totalWaterVolume: hydro.totalWater,
      rainLast24h: weather.rainHours24,
      hydroBalance: hydro.waterBalance,
      settlementCount: settlements.length,
      settlementNames: settlements.map((s) => s.name),
      totalFood: food,
      totalProsperity: prosperity,
      pollution,
      treeCount: veg.countTrees(),
      editedCells: veg.gen.edits.cellCount,
      fps,
    };

    if (clock.day !== this.history[this.history.length - 1]?.day && clock.day % 2 === 0) {
      this.history.push({ day: clock.day, animals: animalTotal, citizens: aliveCitizens.length, food });
      if (this.history.length > 360) this.history.shift();
    }
    return stats;
  }

  serialize(): { history: Array<{ day: number; animals: number; citizens: number; food: number }> } {
    return { history: this.history };
  }

  restore(data: { history: Array<{ day: number; animals: number; citizens: number; food: number }> } | undefined): void {
    if (data) this.history = data.history ?? [];
  }
}
