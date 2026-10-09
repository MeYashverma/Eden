/**
 * World clock: continuous simulation time, seasons and speed control.
 *
 * Time advances in game-hours. Simulation systems step in fixed slices even
 * under fast-forward so no agent is skipped or left in an invalid state.
 */

export type TimeSpeed = 0 | 1 | 4 | 16 | 64;

export const SPEEDS: TimeSpeed[] = [0, 1, 4, 16, 64];
export const DAY_LENGTH_MINUTES = 24; // real minutes per game day at 1×
export const DAYS_PER_SEASON = 15;
export const DAYS_PER_YEAR = DAYS_PER_SEASON * 4;

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

export class WorldClock {
  /** Game hours elapsed since world creation. */
  hours = 6.5; // start at morning
  speed: TimeSpeed = 1;
  /** Real seconds per game hour at 1×. */
  readonly secondsPerHour = (DAY_LENGTH_MINUTES * 60) / 24;

  get timeOfDay(): number {
    return ((this.hours % 24) + 24) % 24;
  }

  get day(): number {
    return Math.floor(this.hours / 24);
  }

  get dayOfYear(): number {
    return Math.floor(this.hours / 24) % DAYS_PER_YEAR;
  }

  /** 0..1 through the year. 0 = spring 1st. */
  get yearPhase(): number {
    return (this.hours / 24 / DAYS_PER_YEAR) % 1;
  }

  get season(): Season {
    const p = this.yearPhase;
    if (p < 0.25) return 'spring';
    if (p < 0.5) return 'summer';
    if (p < 0.75) return 'autumn';
    return 'winter';
  }

  /** Seasonal temperature multiplier: +1 mid-summer, −1 mid-winter. */
  get seasonalTempFactor(): number {
    return Math.cos((this.yearPhase - 0.5) * Math.PI * 2);
  }

  /** Game hours advanced per real second at current speed. */
  get hoursPerSecond(): number {
    return this.speed / this.secondsPerHour;
  }

  /**
   * Advance time, invoking `onSlice` for each fixed 15-minute game slice so
   * fast-forward never skips agent decisions.
   */
  advance(realSeconds: number, onSlice?: (sliceHours: number) => void): number {
    if (this.speed === 0) return 0;
    const maxSlice = 0.25; // 15 game minutes per simulation slice
    let remaining = realSeconds * this.hoursPerSecond;
    let advanced = 0;
    while (remaining > 1e-6) {
      const slice = Math.min(maxSlice, remaining);
      this.hours += slice;
      advanced += slice;
      remaining -= slice;
      onSlice?.(slice);
    }
    return advanced;
  }

  serialize(): { hours: number; speed: TimeSpeed } {
    return { hours: this.hours, speed: this.speed };
  }

  restore(data: { hours: number; speed: TimeSpeed }): void {
    this.hours = data.hours;
    this.speed = data.speed;
  }
}

export const SEASON_LABEL: Record<Season, string> = {
  spring: 'Spring',
  summer: 'Summer',
  autumn: 'Autumn',
  winter: 'Winter',
};
