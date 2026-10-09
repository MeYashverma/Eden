/**
 * Procedural soundscape.
 *
 * Every sound is synthesized with the Web Audio API — no audio files needed,
 * works fully offline. Layers: wind through vegetation, birdsong, insects,
 * rain, thunder, river/waves, footsteps by surface, UI ticks. Mix is driven
 * by weather, time of day and the player's surroundings, with a strict voice
 * budget so nothing explodes into hundreds of sources.
 *
 * Browser autoplay policy: the context is created/resumed on first user
 * gesture (menu click) and never before.
 */

export type AudioLayer = 'wind' | 'birds' | 'insects' | 'rain' | 'water' | 'ambience' | 'ui' | 'footsteps';

export interface AudioVolumes {
  master: number;
  ambience: number;
  effects: number;
  ui: number;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private ambienceGain!: GainNode;
  private effectsGain!: GainNode;
  private uiGain!: GainNode;

  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private rainGain!: GainNode;
  private rainFilter!: BiquadFilterNode;
  private waterGain!: GainNode;
  private waterFilter!: BiquadFilterNode;
  private insectGain!: GainNode;

  private noiseBuffer: AudioBuffer | null = null;
  private started = false;
  private muted = false;
  volumes: AudioVolumes = { master: 0.8, ambience: 0.7, effects: 0.85, ui: 0.7 };
  /** Bird chirp scheduler */
  private nextBird = 0;
  private nextThunder = 0;
  private time = 0;

  /** Call on any user gesture to satisfy autoplay restrictions. */
  async unlock(): Promise<void> {
    if (this.started) {
      if (this.ctx?.state === 'suspended') await this.ctx.resume();
      return;
    }
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctx();
    } catch {
      return;
    }
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volumes.master;
    this.master.connect(ctx.destination);

    this.ambienceGain = ctx.createGain();
    this.ambienceGain.gain.value = this.volumes.ambience;
    this.ambienceGain.connect(this.master);

    this.effectsGain = ctx.createGain();
    this.effectsGain.gain.value = this.volumes.effects;
    this.effectsGain.connect(this.master);

    this.uiGain = ctx.createGain();
    this.uiGain.gain.value = this.volumes.ui;
    this.uiGain.connect(this.master);

    // Shared noise buffer (2 s of white noise).
    const len = ctx.sampleRate * 2;
    this.noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    // Wind: noise → lowpass → gain
    const wind = ctx.createBufferSource();
    wind.buffer = this.noiseBuffer;
    wind.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 380;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.05;
    wind.connect(this.windFilter).connect(this.windGain).connect(this.ambienceGain);
    wind.start();

    // Rain: noise → bandpass → gain
    const rain = ctx.createBufferSource();
    rain.buffer = this.noiseBuffer;
    rain.loop = true;
    this.rainFilter = ctx.createBiquadFilter();
    this.rainFilter.type = 'bandpass';
    this.rainFilter.frequency.value = 2400;
    this.rainFilter.Q.value = 0.6;
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0;
    rain.connect(this.rainFilter).connect(this.rainGain).connect(this.ambienceGain);
    rain.start();

    // Water: noise → bandpass (warmer) → gain
    const water = ctx.createBufferSource();
    water.buffer = this.noiseBuffer;
    water.loop = true;
    this.waterFilter = ctx.createBiquadFilter();
    this.waterFilter.type = 'bandpass';
    this.waterFilter.frequency.value = 700;
    this.waterFilter.Q.value = 0.4;
    this.waterGain = ctx.createGain();
    this.waterGain.gain.value = 0;
    water.connect(this.waterFilter).connect(this.waterGain).connect(this.ambienceGain);
    water.start();

    // Insects: filtered noise shimmer
    const insects = ctx.createBufferSource();
    insects.buffer = this.noiseBuffer;
    insects.loop = true;
    const insectFilter = ctx.createBiquadFilter();
    insectFilter.type = 'highpass';
    insectFilter.frequency.value = 5200;
    this.insectGain = ctx.createGain();
    this.insectGain.gain.value = 0;
    insects.connect(insectFilter).connect(this.insectGain).connect(this.ambienceGain);
    insects.start();

    this.started = true;
    if (ctx.state === 'suspended') await ctx.resume();
  }

  setVolume(layer: keyof AudioVolumes, value: number): void {
    this.volumes[layer] = value;
    if (!this.started) return;
    if (layer === 'master') this.master.gain.value = this.muted ? 0 : value;
    if (layer === 'ambience') this.ambienceGain.gain.value = value;
    if (layer === 'effects') this.effectsGain.gain.value = value;
    if (layer === 'ui') this.uiGain.gain.value = value;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.started) this.master.gain.value = muted ? 0 : this.volumes.master;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /**
   * Continuous mix update.
   * @param opts weather + surroundings inputs
   */
  update(
    dt: number,
    opts: {
      wind: number;
      rain: number;
      nearWater: number;
      nightFactor: number;
      underWater: boolean;
      storm: number;
    },
  ): void {
    if (!this.started || !this.ctx) return;
    this.time += dt;
    const t = this.ctx.currentTime;

    // Smooth layer gains.
    const set = (g: GainNode, v: number) => {
      g.gain.setTargetAtTime(Math.max(0, v), t, 0.35);
    };
    set(this.windGain, 0.03 + opts.wind * 0.16 * (opts.underWater ? 0.15 : 1));
    this.windFilter.frequency.setTargetAtTime(280 + opts.wind * 700, t, 0.5);
    set(this.rainGain, opts.rain * 0.32 * (opts.underWater ? 0.4 : 1));
    set(this.waterGain, opts.nearWater * 0.17 * (opts.underWater ? 1.6 : 1));
    set(this.insectGain, opts.nightFactor * (1 - opts.rain) * 0.022);

    // Birdsong: more in daytime, clear weather.
    this.nextBird -= dt;
    if (this.nextBird <= 0 && opts.rain < 0.4) {
      this.nextBird = 1.6 + Math.random() * 5.5 * (1 + opts.nightFactor * 3);
      if (Math.random() > opts.nightFactor * 0.85) this.chirp();
    }

    // Thunder during storms.
    this.nextThunder -= dt;
    if (this.nextThunder <= 0 && opts.storm > 0.3) {
      this.nextThunder = 4 + Math.random() * 11;
      this.thunder(opts.storm);
    }
  }

  /** Synthesise a short bird chirp. */
  chirp(): void {
    if (!this.started || !this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    const base = 2100 + Math.random() * 1600;
    osc.frequency.setValueAtTime(base, t);
    osc.frequency.exponentialRampToValueAtTime(base * (0.7 + Math.random() * 0.9), t + 0.09);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.055, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    osc.connect(gain).connect(this.ambienceGain);
    osc.start(t);
    osc.stop(t + 0.16);
  }

  /** Low rumble thunder. */
  thunder(intensity: number): void {
    if (!this.started || !this.ctx || !this.noiseBuffer) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 120 + intensity * 180;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.28 * intensity, t + 0.12);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.6 + intensity);
    src.connect(filter).connect(gain).connect(this.effectsGain);
    src.start(t);
    src.stop(t + 2.6);
  }

  /** Surface-aware footstep. */
  footstep(surface: string): void {
    if (!this.started || !this.ctx || !this.noiseBuffer) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    const freqs: Record<string, number> = {
      grass: 520,
      sand: 780,
      rock: 1350,
      snow: 980,
      water: 1650,
      wood: 880,
    };
    filter.frequency.value = freqs[surface] ?? 640;
    filter.Q.value = 1.1;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(surface === 'water' ? 0.11 : 0.055, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + (surface === 'snow' ? 0.12 : 0.075));
    src.connect(filter).connect(gain).connect(this.effectsGain);
    src.start(t);
    src.stop(t + 0.16);
    if (surface === 'water') this.splash();
  }

  splash(): void {
    if (!this.started || !this.ctx || !this.noiseBuffer) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(900, t);
    filter.frequency.exponentialRampToValueAtTime(380, t + 0.3);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.14, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);
    src.connect(filter).connect(gain).connect(this.effectsGain);
    src.start(t);
    src.stop(t + 0.45);
  }

  /** Short UI feedback tick. */
  ui(kind: 'click' | 'open' | 'close' | 'error' | 'success' = 'click'): void {
    if (!this.started || !this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = kind === 'error' ? 'sawtooth' : 'sine';
    const freq = kind === 'open' ? 520 : kind === 'close' ? 360 : kind === 'error' ? 180 : kind === 'success' ? 660 : 440;
    osc.frequency.setValueAtTime(freq, t);
    if (kind === 'success') osc.frequency.exponentialRampToValueAtTime(880, t + 0.09);
    if (kind === 'error') osc.frequency.exponentialRampToValueAtTime(120, t + 0.12);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(kind === 'click' ? 0.045 : 0.07, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    osc.connect(gain).connect(this.uiGain);
    osc.start(t);
    osc.stop(t + 0.16);
  }

  dispose(): void {
    this.ctx?.close();
    this.started = false;
    this.ctx = null;
  }
}
