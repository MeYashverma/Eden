/**
 * World event log and emergent events.
 *
 * Events are written in plain language and arise from the simulation state —
 * droughts shrink water and gather wildlife, floods damage crops, fires change
 * habitats, shortages ripple through settlements. Nothing here is scripted
 * window dressing: each entry corresponds to an actual state change.
 */

import { RNG, hashCombine } from '../core/rng';
import { clamp } from '../core/math';
import type { WorldClock } from '../core/clock';
import type { WeatherSystem } from '../world/weather';
import type { Hydrology } from '../world/hydrology';
import type { AnimalSimulation } from './animals';
import type { CitizenSimulation } from './citizens';
import type { SettlementRecord } from './settlements';
import { WEATHER_LABEL } from '../world/weather';

export interface WorldEvent {
  id: number;
  day: number;
  hour: number;
  text: string;
  kind: 'weather' | 'ecology' | 'settlement' | 'player' | 'danger' | 'discovery';
  x: number;
  z: number;
}

export class WorldEventLog {
  events: WorldEvent[] = [];
  private nextId = 1;
  private droughtActive = false;
  private floodActive = false;
  private fireActive = false;
  fireCells: Array<{ x: number; z: number; strength: number }> = [];

  add(kind: WorldEvent['kind'], text: string, x: number, z: number, clock: WorldClock): WorldEvent {
    const e: WorldEvent = {
      id: this.nextId++,
      day: clock.day,
      hour: clock.timeOfDay,
      text,
      kind,
      x,
      z,
    };
    this.events.push(e);
    if (this.events.length > 220) this.events.shift();
    return e;
  }

  /**
   * Emergent event driver — inspects real simulation state and reacts.
   * Runs on game-hour slices.
   */
  tick(
    hours: number,
    clock: WorldClock,
    weather: WeatherSystem,
    hydro: Hydrology,
    animals: AnimalSimulation,
    citizens: CitizenSimulation,
    settlements: SettlementRecord[],
    playerX: number,
    playerZ: number,
    rng: RNG,
  ): void {
    // ---- drought -----------------------------------------------------------
    const dry = weather.state.hydroBalance < 0.78 && weather.state.precipitation < 0.05;
    if (dry && !this.droughtActive && clock.day > 1) {
      this.droughtActive = true;
      this.add('weather', 'A dry spell settles over the land — water levels begin to fall.', playerX, playerZ, clock);
    } else if (!dry && this.droughtActive) {
      this.droughtActive = false;
      this.add('weather', 'Rain returns. Parched ground drinks deeply.', playerX, playerZ, clock);
    }

    // ---- flood ------------------------------------------------------------
    const floodRisk = weather.rainHours24 > 14 && weather.state.precipitation > 0.6;
    if (floodRisk && !this.floodActive) {
      this.floodActive = true;
      hydro.waterBalance = Math.max(hydro.waterBalance, 1.35);
      // Flood damage: crop growth and food stocks take a hit near the water.
      for (const s of settlements) {
        if (Math.hypot(s.x - playerX, s.z - playerZ) < 700) {
          for (const b of s.buildings) {
            if (b.hasField) b.fieldGrowth = clamp(b.fieldGrowth - 0.25, 0, 1);
          }
          s.stocks.food = Math.max(0, s.stocks.food - 12);
          this.add('danger', `Floodwater swells around ${s.name}. Fields are damaged.`, s.x, s.z, clock);
        }
      }
    } else if (!floodRisk && this.floodActive) {
      this.floodActive = false;
      hydro.waterBalance = Math.min(hydro.waterBalance, 1);
      this.add('weather', 'Floodwaters recede.', playerX, playerZ, clock);
    }

    // ---- wildfire -----------------------------------------------------------
    if (!this.fireActive && rng.chance(0.002 * hours * (weather.state.hydroBalance < 0.85 ? 2.4 : 1))) {
      this.fireActive = true;
      const ang = rng.range(0, Math.PI * 2);
      const dist = rng.range(60, 260);
      const fx = playerX + Math.cos(ang) * dist;
      const fz = playerZ + Math.sin(ang) * dist;
      this.fireCells.push({ x: fx, z: fz, strength: 1 });
      this.add('danger', 'Smoke rises — a wildfire has started in the wilderness.', fx, fz, clock);
    }
    if (this.fireActive) {
      const wind = weather.windVector;
      const spread = 4 + weather.state.windStrength * 10;
      for (const cell of this.fireCells) {
        cell.x += wind.x * spread * hours;
        cell.z += wind.z * spread * hours;
        cell.strength -= hours * (0.12 + weather.state.precipitation * 0.6);
      }
      this.fireCells = this.fireCells.filter((c) => c.strength > 0);
      // Rain extinguishes faster
      if (this.fireCells.length === 0) {
        this.fireActive = false;
        this.add('ecology', 'The wildfire burns out. New growth will follow in time.', playerX, playerZ, clock);
      }
    }

    // ---- wildlife sightings & balance ----------------------------------------
    const pops = animals.populationBySpecies;
    const wolves = pops.wolf ?? 0;
    const deer = pops.deer ?? 0;
    if (wolves > 0 && deer === 0 && hashCombine(clock.day, wolves) % 60 === 0) {
      this.add('ecology', 'Wolf packs roam hungry — their prey has vanished from these parts.', playerX, playerZ, clock);
    }
    if (deer > 24 && hashCombine(clock.day, deer) % 90 === 0) {
      this.add('ecology', 'Deer herds grow large in the meadows.', playerX, playerZ, clock);
    }

    // ---- settlement life ------------------------------------------------------
    for (const s of settlements) {
      if (s.stocks.food < 4 && s.stocks.food > 0 && hashCombine(clock.day, s.id) % 40 === 0) {
        this.add('settlement', `Hunger gnaws at ${s.name}. The market stalls run thin.`, s.x, s.z, clock);
      }
      if (s.prosperity > 0.8 && hashCombine(clock.day, s.id, 3) % 120 === 0) {
        this.add('settlement', `${s.name} thrives — trade is lively and granaries are full.`, s.x, s.z, clock);
      }
    }

    // ---- notable citizen moments ------------------------------------------------
    for (const ev of citizens.events.slice(-3)) {
      if (ev.day === clock.day && ev.kind === 'life') {
        this.add('settlement', ev.text, ev.x, ev.z, clock);
      }
    }
  }

  /** Fire proximity damage to animals/vegetation (called from sim). */
  applyFireEffects(animals: AnimalSimulation, hours: number): void {
    for (const cell of this.fireCells) {
      for (const a of animals.animals) {
        if (a.dead) continue;
        const d = Math.hypot(a.x - cell.x, a.z - cell.z);
        if (d < 14) {
          a.health -= hours * 60 * cell.strength;
          a.fear = 100;
          if (a.health <= 0) {
            a.dead = true;
            animals.deaths++;
          }
        }
      }
    }
    animals.animals = animals.animals.filter((a) => !a.dead);
  }

  serialize(): { events: WorldEvent[]; fireCells: Array<{ x: number; z: number; strength: number }> } {
    return { events: this.events, fireCells: this.fireCells };
  }

  restore(data: { events: WorldEvent[]; fireCells: Array<{ x: number; z: number; strength: number }> } | undefined): void {
    if (!data) return;
    this.events = data.events ?? [];
    this.fireCells = data.fireCells ?? [];
    this.nextId = this.events.reduce((m, e) => Math.max(m, e.id), 0) + 1;
    this.fireActive = this.fireCells.length > 0;
    this.droughtActive = false;
    this.floodActive = false;
  }
}

export const EVENT_ICONS: Record<WorldEvent['kind'], string> = {
  weather: 'cloud',
  ecology: 'leaf',
  settlement: 'home',
  player: 'user',
  danger: 'alert',
  discovery: 'compass',
};
