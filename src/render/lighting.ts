/**
 * Atmosphere controller: turns clock + weather into lighting, sky, fog and
 * water appearance. Sun and moon orbit the world; shadow camera follows the
 * player; colours blend continuously across dawn, day, dusk and night so
 * transitions never pop.
 */

import * as THREE from 'three';
import { clamp, lerp, smoothstep } from '../core/math';
import type { WorldClock } from '../core/clock';
import type { WeatherSystem } from '../world/weather';
import { type SkyHandles, updateSky } from './sky';
import { updateWater } from './water';
import { updateTerrainUniforms } from './terrainMaterial';

const SUNRISE = 6;
const SUNSET = 19.5;

export class AtmosphereController {
  sunLight: THREE.DirectionalLight;
  moonLight: THREE.DirectionalLight;
  hemiLight: THREE.HemisphereLight;
  sunDirection = new THREE.Vector3(0.5, 0.8, 0.3).normalize();
  moonDirection = new THREE.Vector3(-0.5, 0.8, -0.3).normalize();
  fogColor = new THREE.Color(0.72, 0.8, 0.88);
  fog: THREE.FogExp2;
  scene: THREE.Scene;

  private sky: SkyHandles;
  private terrainMat: THREE.MeshStandardMaterial;
  private waterMat: THREE.ShaderMaterial;
  private timeAccum = 0;

  // Scratch colours
  private zenith = new THREE.Color();
  private horizon = new THREE.Color();
  private sunColor = new THREE.Color();
  private tmp = new THREE.Color();
  private targetFog = new THREE.Color();

  constructor(
    scene: THREE.Scene,
    sky: SkyHandles,
    terrainMat: THREE.MeshStandardMaterial,
    waterMat: THREE.ShaderMaterial,
  ) {
    this.scene = scene;
    this.sky = sky;
    this.terrainMat = terrainMat;
    this.waterMat = waterMat;

    this.sunLight = new THREE.DirectionalLight(0xfff2dd, 2.6);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.camera.near = 1;
    this.sunLight.shadow.camera.far = 600;
    this.sunLight.shadow.camera.left = -140;
    this.sunLight.shadow.camera.right = 140;
    this.sunLight.shadow.camera.top = 140;
    this.sunLight.shadow.camera.bottom = -140;
    this.sunLight.shadow.bias = -0.0006;
    this.sunLight.shadow.normalBias = 0.4;
    this.sunLight.shadow.radius = 2.2;

    this.moonLight = new THREE.DirectionalLight(0x9db4d8, 0.0);
    this.hemiLight = new THREE.HemisphereLight(0x9dbfe0, 0x51503c, 0.75);

    scene.add(this.sunLight, this.sunLight.target, this.moonLight, this.hemiLight);

    this.fog = new THREE.FogExp2(0xb8c8d6, 0.00042);
    scene.fog = this.fog;
    scene.add(sky.mesh);
  }

  setQuality(shadowMapSize: number, shadowRadius: number): void {
    this.sunLight.shadow.mapSize.set(shadowMapSize, shadowMapSize);
    this.sunLight.shadow.radius = shadowRadius;
    if (this.sunLight.shadow.map) {
      this.sunLight.shadow.map.dispose();
      this.sunLight.shadow.map = null as unknown as THREE.WebGLRenderTarget;
    }
  }

  /**
   * Per-frame atmosphere update.
   * @param playerPos focus point for the shadow camera
   */
  update(clock: WorldClock, weather: WeatherSystem, playerPos: THREE.Vector3, dt: number): void {
    this.timeAccum += dt;
    weather.setAbsoluteHours(clock.hours);
    const tod = clock.timeOfDay;
    const dayAmount = smoothstep(SUNRISE - 1.2, SUNRISE + 1.4, tod) * (1 - smoothstep(SUNSET - 1.4, SUNSET + 1.2, tod));
    const twilight =
      Math.max(
        smoothstep(SUNRISE - 2.2, SUNRISE + 0.2, tod) * (1 - smoothstep(SUNRISE - 0.2, SUNRISE + 2.2, tod)),
        smoothstep(SUNSET - 2.2, SUNSET + 0.2, tod) * (1 - smoothstep(SUNSET - 0.2, SUNSET + 2.2, tod)),
      ) * 0.9;

    // Sun path: rises in the east (+x), arcs over the south (+z biased), sets west.
    const dayT = (tod - SUNRISE) / (SUNSET - SUNRISE); // 0..1 through daylight
    const sunAngle = clamp(dayT, -0.25, 1.25) * Math.PI;
    this.sunDirection.set(Math.cos(sunAngle) * 0.95, Math.sin(sunAngle), 0.32).normalize();
    this.moonDirection.copy(this.sunDirection).multiplyScalar(-1);

    const w = weather.state;

    // ---- sky colours -------------------------------------------------
    const dayZenith = this.tmp.setRGB(0.22, 0.45, 0.78).clone();
    const dayHorizon = new THREE.Color(0.68, 0.79, 0.88);
    const nightZenith = new THREE.Color(0.012, 0.02, 0.055);
    const nightHorizon = new THREE.Color(0.04, 0.055, 0.1);
    const duskZenith = new THREE.Color(0.18, 0.22, 0.42);
    const duskHorizon = new THREE.Color(0.92, 0.52, 0.28);

    this.zenith.copy(nightZenith).lerp(duskZenith, twilight).lerp(dayZenith, dayAmount);
    this.horizon.copy(nightHorizon).lerp(duskHorizon, twilight).lerp(dayHorizon, dayAmount);

    // Storm / cloud darkening
    const darken = w.cloudCover * 0.28 + w.storm * 0.22;
    this.zenith.multiplyScalar(1 - darken * 0.7);
    this.horizon.multiplyScalar(1 - darken * 0.55);

    // Sun colour: warm at low elevation, white at noon; dimmed by clouds.
    const elev = clamp(this.sunDirection.y, 0, 1);
    this.sunColor
      .setRGB(1, 0.55 + elev * 0.42, 0.3 + elev * 0.55)
      .multiplyScalar(1 - w.cloudCover * 0.55 - w.storm * 0.2);

    // Fog follows horizon, slightly brighter than sky at distance.
    this.targetFog.copy(this.horizon).lerp(this.zenith, 0.25);
    if (w.fogAmount > 0.1) this.targetFog.lerp(new THREE.Color(0.62, 0.66, 0.7), w.fogAmount * 0.5);
    this.fogColor.lerp(this.targetFog, clamp(dt * 1.4, 0, 1));
    (this.fog.color as THREE.Color).copy(this.fogColor);
    this.fog.density = lerp(this.fog.density, 0.00038 + w.fogAmount * 0.0016 + w.precipitation * 0.0004, clamp(dt, 0, 1));

    // ---- lights -------------------------------------------------------
    const sunIntensity = dayAmount * (2.9 - w.cloudCover * 1.7 - w.storm * 0.5);
    this.sunLight.intensity = Math.max(0, sunIntensity);
    this.sunLight.color.copy(this.sunColor);
    this.moonLight.intensity = (1 - dayAmount) * 0.22 * (1 - w.cloudCover * 0.6);
    this.hemiLight.intensity = 0.28 + dayAmount * 0.6 - w.cloudCover * 0.18;
    this.hemiLight.color.copy(this.zenith).lerp(new THREE.Color(1, 1, 1), 0.35);
    this.hemiLight.groundColor.copy(this.horizon).multiplyScalar(0.55);

    // Lightning flash lifts ambient briefly.
    if (weather.lightningFlash > 0.01) {
      this.hemiLight.intensity += weather.lightningFlash * 2.2;
      this.hemiLight.color.lerp(new THREE.Color(0.85, 0.9, 1), weather.lightningFlash * 0.8);
    }

    // Sun/moon follow the player so shadows stay crisp near the camera.
    const sunPos = this.sunDirection.clone().multiplyScalar(280).add(playerPos);
    this.sunLight.position.copy(sunPos);
    this.sunLight.target.position.copy(playerPos);
    this.sunLight.target.updateMatrixWorld();
    this.moonLight.position.copy(this.moonDirection.clone().multiplyScalar(280).add(playerPos));
    this.moonLight.target.position.copy(playerPos);

    // ---- sky dome ------------------------------------------------------
    updateSky(this.sky.material, {
      sunDirection: this.sunDirection,
      moonDirection: this.moonDirection,
      dayFactor: dayAmount,
      twilight,
      cloudCover: w.cloudCover,
      storm: w.storm,
      zenith: this.zenith,
      horizon: this.horizon,
      sunColor: this.sunColor,
      fogColor: this.fogColor,
    }, this.timeAccum);

    // ---- water ---------------------------------------------------------
    const wind = weather.windVector;
    updateWater(this.waterMat, {
      time: this.timeAccum,
      waveHeight: 0.18 + w.windStrength * 0.5,
      wind: new THREE.Vector2(wind.x, wind.z),
      sunDirection: this.sunDirection,
      sunColor: this.sunColor,
      skyColor: this.zenith,
      horizonColor: this.horizon,
      fogColor: this.fogColor,
      fogDensity: this.fog.density,
      deepColor: new THREE.Color(0.04, 0.14, 0.28).multiplyScalar(0.4 + dayAmount * 0.6),
      shallowColor: new THREE.Color(0.14, 0.4, 0.46).multiplyScalar(0.4 + dayAmount * 0.6),
    });

    // ---- terrain -------------------------------------------------------
    const wetness = clamp(w.precipitation * 1.1 + (weather.rainHours24 / 24) * 0.35, 0, 1);
    const snowLine = 90 + clock.seasonalTempFactor * 85;
    updateTerrainUniforms(this.terrainMat, {
      snowLine,
      wetness,
      time: this.timeAccum,
      dryness: clamp((1 - weather.state.hydroBalance) * 1.4, 0, 1),
    });
  }

  /** Current ambient temperature estimate at a position (for UI/sim). */
  estimateTemperature(clock: WorldClock, weather: WeatherSystem, height: number, baseTemp: number): number {
    return baseTemp + weather.state.tempOffset + Math.sin((clock.timeOfDay - 14) / 24 * Math.PI * 2) * 4 - height * 0.02;
  }
}
