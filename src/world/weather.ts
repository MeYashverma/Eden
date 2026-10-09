/**
 * Weather simulation: a season-biased state machine driving cloud cover,
 * precipitation, wind, fog, storms and longer climate phenomena (drought,
 * wet spells). Outputs feed rendering, hydrology, farming, animals and NPCs.
 */

import { RNG, hashCombine } from '../core/rng';
import { clamp, lerp, smoothstep } from '../core/noise';
import type { Season } from '../core/clock';

export type WeatherKind =
  | 'clear'
  | 'fair'
  | 'cloudy'
  | 'light_rain'
  | 'heavy_rain'
  | 'thunderstorm'
  | 'fog'
  | 'snow'
  | 'blizzard'
  | 'heatwave';

export interface WeatherState {
  kind: WeatherKind;
  /** 0..1 */
  cloudCover: number;
  /** 0..1 rain/snow intensity */
  precipitation: number;
  /** metres/second-ish scalar for shaders and particles */
  windStrength: number;
  windAngle: number;
  /** 0..1 */
  fogAmount: number;
  /** °C offset applied to ambient temperature */
  tempOffset: number;
  /** 0..1 storm severity for lightning/visuals */
  storm: number;
  /** longer-term water balance: <1 drought, >1 wet period */
  hydroBalance: number;
}

interface KindProfile {
  cloud: number;
  precip: number;
  wind: number;
  fog: number;
  temp: number;
  storm: number;
  duration: [number, number]; // game hours
}

const PROFILES: Record<WeatherKind, KindProfile> = {
  clear: { cloud: 0.12, precip: 0, wind: 0.25, fog: 0.05, temp: 1.5, storm: 0, duration: [8, 26] },
  fair: { cloud: 0.32, precip: 0, wind: 0.35, fog: 0.1, temp: 0.5, storm: 0, duration: [6, 20] },
  cloudy: { cloud: 0.62, precip: 0, wind: 0.45, fog: 0.15, temp: -0.5, storm: 0, duration: [4, 16] },
  light_rain: { cloud: 0.8, precip: 0.35, wind: 0.5, fog: 0.3, temp: -1.5, storm: 0, duration: [3, 12] },
  heavy_rain: { cloud: 0.92, precip: 0.8, wind: 0.7, fog: 0.42, temp: -2.5, storm: 0.15, duration: [2, 9] },
  thunderstorm: { cloud: 0.97, precip: 1, wind: 1, fog: 0.5, temp: -3, storm: 1, duration: [1.5, 6] },
  fog: { cloud: 0.55, precip: 0, wind: 0.12, fog: 0.85, temp: -1, storm: 0, duration: [3, 10] },
  snow: { cloud: 0.85, precip: 0.55, wind: 0.45, fog: 0.35, temp: -6, storm: 0, duration: [4, 16] },
  blizzard: { cloud: 0.98, precip: 1, wind: 1, fog: 0.75, temp: -12, storm: 0.5, duration: [2, 7] },
  heatwave: { cloud: 0.08, precip: 0, wind: 0.2, fog: 0.05, temp: 9, storm: 0, duration: [12, 36] },
};

const TRANSITIONS: Record<WeatherKind, Array<[WeatherKind, number]>> = {
  clear: [['fair', 0.35], ['cloudy', 0.25], ['heatwave', 0.06], ['fog', 0.12], ['clear', 0.22]],
  fair: [['clear', 0.3], ['cloudy', 0.35], ['light_rain', 0.12], ['fog', 0.08], ['fair', 0.15]],
  cloudy: [['fair', 0.3], ['light_rain', 0.22], ['heavy_rain', 0.12], ['clear', 0.16], ['cloudy', 0.2]],
  light_rain: [['cloudy', 0.3], ['heavy_rain', 0.22], ['thunderstorm', 0.1], ['fog', 0.1], ['light_rain', 0.28]],
  heavy_rain: [['light_rain', 0.32], ['thunderstorm', 0.18], ['cloudy', 0.3], ['heavy_rain', 0.2]],
  thunderstorm: [['heavy_rain', 0.4], ['light_rain', 0.25], ['cloudy', 0.25], ['thunderstorm', 0.1]],
  fog: [['cloudy', 0.3], ['fair', 0.32], ['light_rain', 0.12], ['fog', 0.26]],
  snow: [['cloudy', 0.25], ['blizzard', 0.15], ['snow', 0.35], ['fog', 0.25]],
  blizzard: [['snow', 0.55], ['cloudy', 0.25], ['blizzard', 0.2]],
  heatwave: [['clear', 0.5], ['fair', 0.25], ['heatwave', 0.25]],
};

export class WeatherSystem {
  state: WeatherState = {
    kind: 'fair',
    cloudCover: 0.32,
    precipitation: 0,
    windStrength: 0.35,
    windAngle: 0.8,
    fogAmount: 0.1,
    tempOffset: 0.5,
    storm: 0,
    hydroBalance: 1,
  };

  private target = { ...this.state };
  private hoursLeft = 12;
  private climateHours = 0;
  private lightningTimer = 0;
  lightningFlash = 0;
  /** Recent conditions for stats (game-hours of rain in the last day). */
  rainHours24 = 0;

  constructor(private seed: number) {
    this.pickNext('fair', 10);
  }

  private rng(daySalt: number): RNG {
    return new RNG(hashCombine(this.seed, Math.floor(daySalt), 17041));
  }

  private pickNext(from: WeatherKind, salt: number): void {
    const rng = this.rng(salt);
    const table = TRANSITIONS[from];
    let roll = rng.next();
    let chosen: WeatherKind = from;
    for (const [kind, p] of table) {
      roll -= p;
      if (roll <= 0) {
        chosen = kind;
        break;
      }
    }
    const prof = PROFILES[chosen];
    this.state.kind = chosen;
    this.target = {
      kind: chosen,
      cloudCover: prof.cloud,
      precipitation: prof.precip,
      windStrength: prof.wind,
      windAngle: this.state.windAngle + rng.range(-1.2, 1.2),
      fogAmount: prof.fog,
      tempOffset: prof.temp,
      storm: prof.storm,
      hydroBalance: this.state.hydroBalance,
    };
    this.hoursLeft = rng.range(prof.duration[0], prof.duration[1]);
  }

  /** Blend weather kind toward season realities (snow only when cold). */
  private seasonalBias(season: Season, temperature: number, salt: number): void {
    const rng = this.rng(salt + 31);
    if (temperature < -2 && (this.state.kind === 'light_rain' || this.state.kind === 'heavy_rain')) {
      this.state.kind = this.state.kind === 'heavy_rain' ? 'blizzard' : 'snow';
      const prof = PROFILES[this.state.kind];
      this.target.cloudCover = prof.cloud;
      this.target.precipitation = prof.precip;
      this.target.tempOffset = prof.temp;
    } else if (temperature > 2 && this.state.kind === 'snow') {
      this.state.kind = 'light_rain';
    }
    // Dry seasons make droughts more likely, wet seasons seed floods.
    if (season === 'summer' && rng.chance(0.2)) {
      this.climateHours = rng.range(48, 120);
    } else if (season === 'winter' && rng.chance(0.15)) {
      this.climateHours = rng.range(24, 72);
    }
  }

  /**
   * Advance weather in game-hours.
   * @param hours game hours elapsed
   * @param season current season
   * @param tempC ambient temperature at the player's location
   */
  update(hours: number, season: Season, tempC: number): void {
    if (hours <= 0) return;

    // Smoothly ease toward target profile.
    const k = clamp(hours * 0.55, 0, 1);
    this.state.cloudCover = lerp(this.state.cloudCover, this.target.cloudCover, k);
    this.state.precipitation = lerp(this.state.precipitation, this.target.precipitation, k);
    this.state.windStrength = lerp(this.state.windStrength, this.target.windStrength, k);
    this.state.fogAmount = lerp(this.state.fogAmount, this.target.fogAmount, k);
    this.state.tempOffset = lerp(this.state.tempOffset, this.target.tempOffset, k);
    this.state.storm = lerp(this.state.storm, this.target.storm, k);
    this.state.windAngle += (this.target.windAngle - this.state.windAngle) * k * 0.4;

    if (this.state.precipitation > 0.05) {
      this.rainHours24 = Math.min(24, this.rainHours24 + hours);
    } else {
      this.rainHours24 = Math.max(0, this.rainHours24 - hours * 0.4);
    }

    // Longer climate swings (drought / wet period) ease hydrology balance.
    this.climateHours -= hours;
    const dryPhase = this.state.kind === 'heatwave' || (this.state.precipitation === 0 && this.state.cloudCover < 0.25);
    const wetTarget = dryPhase ? 0.72 : this.state.precipitation > 0.5 ? 1.22 : 1;
    this.state.hydroBalance = lerp(this.state.hydroBalance, wetTarget, clamp(hours * 0.02, 0, 0.05));
    if (this.climateHours > 0 && dryPhase) {
      this.state.hydroBalance = lerp(this.state.hydroBalance, 0.55, clamp(hours * 0.01, 0, 0.03));
    }

    this.hoursLeft -= hours;
    if (this.hoursLeft <= 0) {
      const salt = Math.floor(this.hoursTotal() / 6);
      const prev = this.state.kind;
      this.pickNext(prev, salt);
      this.seasonalBias(season, tempC, salt);
    }

    // Lightning during storms.
    this.lightningFlash *= Math.exp(-hours * 14);
    if (this.state.storm > 0.35) {
      this.lightningTimer -= hours;
      if (this.lightningTimer <= 0) {
        this.lightningTimer = this.rng(this.hoursTotal()).range(0.08, 0.55);
        this.lightningFlash = 1;
      }
    }
  }

  private hoursTotalCache = 0;
  /** Track absolute game hours for RNG salt. */
  private hoursTotal(): number {
    return this.hoursTotalCache;
  }

  setAbsoluteHours(h: number): void {
    this.hoursTotalCache = h;
  }

  /** God-mode override. */
  forceWeather(kind: WeatherKind, durationHours = 12): void {
    const prof = PROFILES[kind];
    this.state.kind = kind;
    this.target = {
      kind,
      cloudCover: prof.cloud,
      precipitation: prof.precip,
      windStrength: prof.wind,
      windAngle: this.state.windAngle,
      fogAmount: prof.fog,
      tempOffset: prof.temp,
      storm: prof.storm,
      hydroBalance: this.state.hydroBalance,
    };
    this.hoursLeft = durationHours;
    // Snap the visible state so god-mode changes are immediate.
    this.state.cloudCover = prof.cloud;
    this.state.precipitation = prof.precip;
    this.state.windStrength = prof.wind;
    this.state.fogAmount = prof.fog;
    this.state.tempOffset = prof.temp;
    this.state.storm = prof.storm;
  }

  get windVector(): { x: number; z: number } {
    return { x: Math.cos(this.state.windAngle), z: Math.sin(this.state.windAngle) };
  }

  serialize(): { kind: WeatherKind; state: WeatherState; hoursLeft: number } {
    return { kind: this.state.kind, state: { ...this.state }, hoursLeft: this.hoursLeft };
  }

  restore(data: { kind: WeatherKind; state: WeatherState; hoursLeft: number }): void {
    this.state = { ...data.state };
    this.target = { ...data.state };
    this.hoursLeft = data.hoursLeft;
  }
}

export const WEATHER_LABEL: Record<WeatherKind, string> = {
  clear: 'Clear',
  fair: 'Fair',
  cloudy: 'Cloudy',
  light_rain: 'Light Rain',
  heavy_rain: 'Heavy Rain',
  thunderstorm: 'Thunderstorm',
  fog: 'Fog',
  snow: 'Snow',
  blizzard: 'Blizzard',
  heatwave: 'Heatwave',
};
