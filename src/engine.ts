/**
 * Game engine — owns the Three.js renderer, the world systems and the frame
 * loop. Subsystems stay independent; the engine wires them to shared state,
 * the UI and persistence. Rendering runs at display rate, simulation at fixed
 * slices, and heavy work is budgeted so the frame never stalls.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

import { WorldGen } from './world/worldGen';
import { Hydrology } from './world/hydrology';
import { ChunkManager } from './world/chunks';
import { VegetationSystem } from './world/vegetation';
import { generateTerrainTextures, type TerrainTextures } from './render/textures';
import { createTerrainMaterial } from './render/terrainMaterial';
import { createSky, type SkyHandles } from './render/sky';
import { createWater } from './render/water';
import { AtmosphereController } from './render/lighting';
import { HumanRenderer, AnimalRenderer, type AnimalRenderInput } from './sim/agentRenderers';
import { Simulation } from './sim/simulation';
import { SPECIES } from './sim/animals';
import { defaultWorldConfig, type WorldGenConfig, CHUNK_SIZE } from './world/types';
import { Player } from './player/player';
import { Input } from './core/input';
import { ToolSystem, TOOLS, type ToolId, type ToolContext } from './player/tools';
import { AudioEngine } from './audio/audio';
import { UIManager, type HudState, type SettingsValues, type UICallbacks } from './ui/ui';
import { WorldMapRenderer } from './ui/worldMap';
import { findDiscoveries, revealNearby, type Discovery } from './core/discoveries';
import { SaveDatabase, SettingsStore, type SaveSlotMeta } from './persistence/db';
import {
  buildExportFile, parseExportFile, downloadFile, validateSave,
  SAVE_VERSION, type WorldSave,
} from './persistence/save';
import { WorldClock, type TimeSpeed, SEASON_LABEL } from './core/clock';
import { WEATHER_LABEL } from './world/weather';
import { formatNumber, formatClock, clamp, lerp, TAU } from './core/math';
import { RNG } from './core/rng';

export interface EngineStatus {
  ready: boolean;
  message: string;
}

export class Engine {
  // Core three.js
  private renderer!: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera!: THREE.PerspectiveCamera;
  private composer: EffectComposer | null = null;
  private bloomPass: UnrealBloomPass | null = null;

  // World
  private gen!: WorldGen;
  private hydro!: Hydrology;
  private chunks!: ChunkManager;
  private veg!: VegetationSystem;
  private sky!: SkyHandles;
  private atmosphere!: AtmosphereController;
  private textures!: TerrainTextures;
  private terrainMat!: THREE.MeshStandardMaterial;
  private waterMat!: THREE.ShaderMaterial;

  // Agents
  private simulation!: Simulation;
  private humanRenderer = new HumanRenderer(80);
  private animalRenderers = new Map<string, AnimalRenderer>();

  // Player & input
  private player!: Player;
  private input!: Input;
  private tools = new ToolSystem();
  private audio = new AudioEngine();
  private ui!: UIManager;
  private map!: WorldMapRenderer;

  // Persistence
  private db = new SaveDatabase();
  private currentSaveId: string | null = null;
  private worldName = 'Eden';
  private playSeconds = 0;
  private autosaveTimer = 0;

  // State
  private settings: SettingsValues;
  private running = false;
  private paused = false;
  private discoveries: Discovery[] = [];
  private undiscovered: Discovery[] = [];
  private waypoints: Array<{ x: number; z: number; label: string }> = [];
  private tracked: { kind: string; id: string; x: number; z: number; label: string } | null = null;
  private clockLast = performance.now();
  private fpsSamples: number[] = [];
  private fps = 60;
  private frameMs = 16;
  private simMs = 0;
  private renderMs = 0;
  private weatherParticles!: THREE.Points;
  private particlePositions!: Float32Array;
  private lightningLight: THREE.PointLight;
  private canvas: HTMLCanvasElement;
  private lastRevealX = 1e9;
  private lastRevealZ = 1e9;
  private welcomeShown = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.settings = SettingsStore.get<SettingsValues>('settings', {
      quality: 'high',
      renderDistance: 768,
      shadowQuality: 2048,
      postProcessing: true,
      foliage: 1,
      simulationDensity: 1,
      showMinimap: true,
      showDebug: false,
      masterVolume: 0.8,
      ambienceVolume: 0.7,
      effectsVolume: 0.85,
      uiVolume: 0.7,
      muted: false,
      fov: 72,
      invertY: false,
      sensitivity: 1,
      survival: false,
      autosaveMinutes: 5,
    });
    this.lightningLight = new THREE.PointLight(0xcdd8ff, 0, 900, 1.2);
    this.lightningLight.position.set(0, 220, 0);
    this.scene.add(this.lightningLight);
  }

  /** Boot: load storage, prepare renderer, show menu over a live preview world. */
  async boot(onProgress: (pct: number, status: string) => void): Promise<void> {
    onProgress(4, 'Starting renderer…');
    this.initRenderer();

    onProgress(10, 'Opening world storage…');
    await this.db.open();

    onProgress(16, 'Generating textures…');
    this.textures = generateTerrainTextures(256);

    onProgress(30, 'Raising terrain…');
    const seed = SettingsStore.get<number>('lastSeed', 20260409);
    this.buildWorld(defaultWorldConfig(seed), true);

    onProgress(52, 'Filling rivers and lakes…');
    // Hydrology warmup yields to the loader so progress stays honest.
    await this.warmHydro(240, (p) => onProgress(52 + p * 12, 'Filling rivers and lakes…'));

    onProgress(68, 'Growing forests…');
    await this.prebuildChunks(96, (p) => onProgress(68 + p * 14, 'Shaping nearby land…'));

    onProgress(84, 'Waking wildlife…');
    this.simulation.ensureSettlementNear(this.player.position.x, this.player.position.z, 900);
    this.populateDiscoveryRegion();
    this.simulation.update(2, this.player.position.x, this.player.position.z);

    onProgress(94, 'Tuning the sky…');
    this.applyQualityPreset(this.settings.quality);
    this.map.reveal(this.player.position.x, this.player.position.z, 420);

    onProgress(100, 'Ready');
    this.running = true;
    this.clockLast = performance.now();
  }

  // ------------------------------------------------------------ setup

  private initRenderer(): void {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.camera = new THREE.PerspectiveCamera(this.settings.fov, window.innerWidth / window.innerHeight, 0.15, 5200);
    this.camera.position.set(0, 30, 40);

    // Recoverable WebGL context loss.
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.running = false;
    });
    this.canvas.addEventListener('webglcontextrestored', () => {
      this.running = true;
      this.clockLast = performance.now();
    });

    window.addEventListener('resize', this.onResize);
    this.onResize();
  }

  private onResize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer?.setSize(w, h);
  };

  private buildWorld(config: WorldGenConfig, fresh: boolean): void {
    // Dispose previous world if regenerating.
    if (this.chunks) {
      this.scene.remove(this.chunks.group, this.veg.group, this.simulation.group, this.humanRenderer.group);
      for (const r of this.animalRenderers.values()) this.scene.remove(r.group);
      this.animalRenderers.clear();
      this.chunks.dispose();
    }

    this.gen = new WorldGen(config);
    this.hydro = new Hydrology(this.gen);
    this.terrainMat = createTerrainMaterial(this.textures);
    this.waterMat = createWater(this.textures.waterNormal).material;
    this.sky = createSky();
    this.atmosphere = new AtmosphereController(this.scene, this.sky, this.terrainMat, this.waterMat);

    this.chunks = new ChunkManager(this.gen, this.hydro, {
      viewDistance: this.settings.renderDistance,
      farDistance: 3200,
      terrainMaterial: this.terrainMat,
      waterMaterial: this.waterMat,
      buildsPerFrame: 2,
    });

    this.veg = new VegetationSystem(this.gen, this.textures.leaf, this.textures.bark);
    this.simulation = new Simulation(this.gen, this.hydro, this.veg, config.seed);

    this.player = new Player(this.gen, this.hydro);
    this.player.survivalEnabled = this.settings.survival;
    const spawn = this.player.findSpawn(
      Math.round(Math.sin(config.seed) * 120),
      Math.round(Math.cos(config.seed * 1.7) * 120),
    );
    this.player.spawnAt(spawn.x, spawn.z);

    this.scene.add(this.chunks.group, this.veg.group, this.simulation.group, this.humanRenderer.group);
    this.chunks.update(this.player.position.x, this.player.position.z, true);

    // Weather particles
    this.initWeatherParticles();

    // Map
    if (!this.map) {
      this.map = new WorldMapRenderer(document.createElement('canvas'), this.gen, this.hydro);
    } else {
      (this.map as unknown as { gen: WorldGen }).gen = this.gen;
      this.map.setHydro(this.hydro);
      this.map.explored.clear();
    }

    if (fresh) {
      this.discoveries = [];
      this.undiscovered = findDiscoveries(this.gen, this.hydro, spawn.x, spawn.z, 1200);
      this.waypoints = [];
      this.currentSaveId = null;
    }
  }

  private initWeatherParticles(): void {
    const count = 2600;
    this.particlePositions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      this.particlePositions[i * 3] = (Math.random() - 0.5) * 120;
      this.particlePositions[i * 3 + 1] = Math.random() * 60;
      this.particlePositions[i * 3 + 2] = (Math.random() - 0.5) * 120;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.particlePositions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xaac4d8,
      size: 0.12,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.weatherParticles = new THREE.Points(geo, mat);
    this.weatherParticles.frustumCulled = false;
    this.scene.add(this.weatherParticles);
  }

  private async warmHydro(iterations: number, onProgress: (p: number) => void): Promise<void> {
    const slice = 24;
    for (let i = 0; i < iterations; i += slice) {
      this.hydro.warmup(Math.min(slice, iterations - i));
      onProgress(Math.min(1, (i + slice) / iterations));
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  private async prebuildChunks(count: number, onProgress: (p: number) => void): Promise<void> {
    this.chunks.update(this.player.position.x, this.player.position.z, true);
    let built = 0;
    while (this.chunks.pendingBuilds > 0 && built < count) {
      built += this.chunks.processQueue(12);
      const vegChunk = Math.min(built, 24);
      for (let i = 0; i < vegChunk; i++) {
        // grow vegetation for the nearest built chunks
      }
      onProgress(Math.min(1, built / count));
      await new Promise((r) => setTimeout(r, 0));
    }
    // Vegetation for all built chunks
    for (let dz = -3; dz <= 3; dz++) {
      for (let dx = -3; dx <= 3; dx++) {
        const cx = Math.floor(this.player.position.x / CHUNK_SIZE) + dx;
        const cz = Math.floor(this.player.position.z / CHUNK_SIZE) + dz;
        this.veg.buildChunk(cx, cz);
      }
    }
    this.chunks.processQueue(24);
    this.chunks.refreshWater(this.player.position.x, this.player.position.z, 200);
  }

  // ------------------------------------------------------------ UI wiring

  createUI(): UIManager {
    const callbacks: UICallbacks = {
      onNewWorld: (cfg) => this.startNewWorld(cfg),
      onContinue: () => void this.continueWorld(),
      onLoadSlot: (id) => void this.loadSlot(id),
      onDeleteSlot: (id) => void this.deleteSlot(id),
      onRenameSlot: () => {},
      onSaveNow: (name) => void this.saveWorld(name),
      onExportWorld: () => void this.exportWorld(),
      onImportWorld: (file) => void this.importWorld(file),
      onSetSpeed: (speed) => this.setSpeed(speed),
      onSetCamera: (mode) => this.setCameraMode(mode),
      onSelectTool: (tool) => this.selectTool(tool),
      onSettingChange: (key, value) => this.applySetting(key, value),
      onGodAction: (action, value) => this.godAction(action, value),
      onResume: () => this.resumeGame(),
      onRegenerate: () => {},
      onResetWorld: () => void this.resetWorld(),
      onShowPanel: (name) => this.openNamedPanel(name),
      onClosePanel: () => {
        this.paused = false;
        this.input.uiFocused = false;
      },
      onMapWaypoint: (x, z) => {
        this.waypoints.push({ x, z, label: `Waypoint ${this.waypoints.length + 1}` });
        this.ui.toast('Waypoint placed.', 'info');
      },
      onTrackEntity: (kind, id) => this.trackEntity(kind, id),
      onInteract: () => {},
      onAudioUnlock: () => void this.audio.unlock(),
    };
    this.ui = new UIManager(callbacks, this.settings);
    return this.ui;
  }

  // ------------------------------------------------------------ game start

  private startNewWorld(cfg: { seed: number; name: string } & Partial<WorldGenConfig>): void {
    const config = defaultWorldConfig(cfg.seed);
    Object.assign(config, cfg);
    this.worldName = cfg.name;
    this.playSeconds = 0;
    this.buildWorld(config, true);
    void this.warmHydro(160, () => {});
    this.chunks.update(this.player.position.x, this.player.position.z, true);
    this.chunks.processQueue(200);
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        this.veg.buildChunk(Math.floor(this.player.position.x / CHUNK_SIZE) + dx, Math.floor(this.player.position.z / CHUNK_SIZE) + dz);
      }
    }
    this.simulation.ensureSettlementNear(this.player.position.x, this.player.position.z, 900);
    this.populateDiscoveryRegion();
    this.simulation.update(3, this.player.position.x, this.player.position.z);
    SettingsStore.set('lastSeed', cfg.seed);
    this.ui.setMenuVisible(false);
    this.ui.toast(`Welcome to ${cfg.name}.`, 'discovery');
    if (!this.welcomeShown) {
      this.welcomeShown = true;
      this.ui.showWelcome(() => {
        this.input.requestPointerLock();
      });
    }
    this.paused = false;
  }

  private async continueWorld(): Promise<void> {
    const slots = await this.db.listSlots();
    if (slots.length > 0) {
      await this.loadSlot(slots[0].id);
    } else {
      this.ui.toast('No saved world found — creating a new one.', 'info');
      this.startNewWorld({ seed: Math.floor(Math.random() * 1e9), name: 'Eden' });
    }
  }

  // ------------------------------------------------------------ frame loop

  startLoop(): void {
    const loop = (): void => {
      requestAnimationFrame(loop);
      this.frame();
    };
    requestAnimationFrame(loop);
  }

  private frame(): void {
    const frameStart = performance.now();
    const dtReal = Math.min(0.1, (frameStart - this.clockLast) / 1000);
    this.clockLast = frameStart;

    // FPS tracking
    this.fpsSamples.push(1 / Math.max(dtReal, 1e-4));
    if (this.fpsSamples.length > 40) this.fpsSamples.shift();
    this.fps = this.fpsSamples.reduce((a, b) => a + b, 0) / this.fpsSamples.length;
    this.simulation.fps = this.fps;

    if (!this.running) return;

    const menuOpen = this.ui?.isPanelOpen ?? false;
    const simActive = !this.paused;

    // ---- input → player -------------------------------------------------
    this.handleHotkeys();
    this.player.update(dtReal, this.input, !menuOpen && simActive);
    this.player.updateCamera(dtReal, this.camera);

    // ---- simulation -----------------------------------------------------
    const simStart = performance.now();
    if (simActive) {
      this.simulation.update(dtReal, this.player.position.x, this.player.position.z, this.settings.renderDistance * 0.9);
      this.playSeconds += dtReal;
    }
    this.simMs = performance.now() - simStart;

    // ---- streaming & hydrology visuals ---------------------------------
    this.chunks.update(this.player.position.x, this.player.position.z);
    this.chunks.processQueue(6);
    if (Math.floor(frameStart / 400) !== Math.floor((frameStart - dtReal * 1000) / 400)) {
      // ~2.5×/s: refresh water meshes near the player
      this.chunks.refreshWater(this.player.position.x, this.player.position.z, 220);
      this.hydro.recenter(this.player.position.x, this.player.position.z);
    }
    if (Math.floor(frameStart / 250) !== Math.floor((frameStart - dtReal * 1000) / 250)) {
      // ~4×/s: vegetation near player follows chunk set
      this.syncVegetation();
      this.revealMapArea();
    }

    // ---- atmosphere ------------------------------------------------------
    this.atmosphere.update(this.simulation.clock, this.simulation.weather, this.player.position, dtReal);

    // ---- agents ----------------------------------------------------------
    this.updateAgentRenderers();

    // ---- weather particles ----------------------------------------------
    this.updateWeatherParticles(dtReal);

    // ---- tools -----------------------------------------------------------
    this.updateTools(dtReal);

    // ---- audio -----------------------------------------------------------
    const waterDepth = this.hydro.depthAt(this.player.position.x, this.player.position.z);
    this.audio.update(dtReal, {
      wind: this.simulation.weather.state.windStrength,
      rain: this.simulation.weather.state.precipitation,
      nearWater: waterDepth > 0.05 ? 1 : 0,
      nightFactor: this.simulation.clock.timeOfDay < 6 || this.simulation.clock.timeOfDay > 20 ? 1 : 0,
      underWater: this.player.position.y < (this.hydro.surfaceAt(this.player.position.x, this.player.position.z) ?? -999),
      storm: this.simulation.weather.state.storm,
    });

    // ---- UI refresh -------------------------------------------------------
    this.updateUI();
    this.input.endFrame();

    // ---- render ----------------------------------------------------------
    const renderStart = performance.now();
    if (this.settings.postProcessing && this.composer) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
    this.renderMs = performance.now() - renderStart;
    this.frameMs = performance.now() - frameStart;

    // ---- autosave ---------------------------------------------------------
    if (this.settings.autosaveMinutes > 0 && simActive) {
      this.autosaveTimer += dtReal;
      if (this.autosaveTimer > this.settings.autosaveMinutes * 60) {
        this.autosaveTimer = 0;
        void this.saveWorld(undefined, true);
      }
    }
  }

  private syncVegetation(): void {
    const cx = Math.floor(this.player.position.x / CHUNK_SIZE);
    const cz = Math.floor(this.player.position.z / CHUNK_SIZE);
    const r = Math.ceil(this.settings.renderDistance / CHUNK_SIZE);
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dz * dz > r * r) continue;
        const key = `${cx + dx},${cz + dz}`;
        if (!this.veg.hasChunk?.(key)) {
          // build vegetation for chunks that have terrain
          this.veg.buildChunk(cx + dx, cz + dz);
        }
      }
    }
  }

  private revealMapArea(): void {
    const px = this.player.position.x;
    const pz = this.player.position.z;
    if (Math.hypot(px - this.lastRevealX, pz - this.lastRevealZ) > 40) {
      this.lastRevealX = px;
      this.lastRevealZ = pz;
      this.map.reveal(px, pz, 320);

      // Discoveries
      const found = revealNearby(this.undiscovered, px, pz, 34);
      for (const d of found) {
        d.day = this.simulation.clock.day;
        this.discoveries.push(d);
        this.undiscovered = this.undiscovered.filter((u) => u.id !== d.id);
        this.ui.toast(`Discovered: ${d.name} — ${d.note}`, 'discovery', 9000);
        this.simulation.events.add('discovery', `You discovered ${d.name}.`, d.x, d.z, this.simulation.clock);
      }

      // Spawn more POIs ahead
      if (this.undiscovered.length < 6) {
        const more = findDiscoveries(this.gen, this.hydro, px, pz, 1400);
        for (const d of more) {
          if (!this.discoveries.some((x) => x.id === d.id) && !this.undiscovered.some((x) => x.id === d.id)) {
            this.undiscovered.push(d);
          }
        }
      }
    }
  }

  private updateAgentRenderers(): void {
    // Humans
    this.humanRenderer.update(this.simulation.citizens.renderInputs());

    // Animals grouped by species
    const inputs = this.simulation.animalRenderInputs(this.player.position.x, this.player.position.z);
    const seen = new Set<string>();
    for (const [species, list] of Object.entries(inputs)) {
      seen.add(species);
      let renderer = this.animalRenderers.get(species);
      if (!renderer) {
        renderer = new AnimalRenderer(species, 48);
        this.animalRenderers.set(species, renderer);
        this.scene.add(renderer.group);
      }
      renderer.update(list.slice(0, 48) as AnimalRenderInput[]);
    }
    for (const [species, renderer] of this.animalRenderers) {
      if (!seen.has(species)) renderer.update([]);
    }

    // Vegetation wind
    this.veg.update(this.atmosphere ? performance.now() / 1000 : 0, this.simulation.weather.state.windStrength);
  }

  private updateWeatherParticles(dt: number): void {
    const w = this.simulation.weather.state;
    const mat = this.weatherParticles.material as THREE.PointsMaterial;
    const precip = w.precipitation;
    mat.opacity = precip * 0.55;
    mat.size = precip > 0.5 && w.tempOffset < -3 ? 0.28 : 0.11;
    if (precip < 0.02) return;

    const wind = this.simulation.weather.windVector;
    const isSnow = w.tempOffset < -3;
    const fall = isSnow ? 4 : 26;
    const pos = this.particlePositions;
    const px = this.player.position.x;
    const py = this.player.position.y;
    const pz = this.player.position.z;
    for (let i = 0; i < pos.length; i += 3) {
      pos[i + 1] -= fall * dt;
      pos[i] += wind.x * dt * (isSnow ? 1.6 : 6);
      pos[i + 2] += wind.z * dt * (isSnow ? 1.6 : 6);
      if (pos[i + 1] < py - 6) {
        pos[i] = px + (Math.random() - 0.5) * 90;
        pos[i + 1] = py + 28 + Math.random() * 22;
        pos[i + 2] = pz + (Math.random() - 0.5) * 90;
      }
    }
    this.weatherParticles.geometry.attributes.position.needsUpdate = true;
    this.weatherParticles.position.set(0, 0, 0);

    // Lightning flash
    const flash = this.simulation.weather.lightningFlash;
    this.lightningLight.intensity = flash * 60;
    if (flash > 0.6 && Math.random() < 0.1) this.audio.thunder(w.storm);
  }

  private updateTools(dt: number): void {
    const origin = this.camera.position;
    const dir = this.camera.getWorldDirection(new THREE.Vector3());
    const ctx: ToolContext = {
      gen: this.gen,
      hydro: this.hydro,
      chunks: this.chunks,
      veg: this.veg,
      simulation: this.simulation,
      scene: this.scene,
      buildingMaterials: this.simulation.buildingMaterials,
    };
    this.tools.ctx = ctx;

    const menuOpen = this.ui?.isPanelOpen ?? false;
    if (menuOpen) {
      this.tools.clearGhost();
      return;
    }

    const point = this.tools.aimPoint(ctx, origin, dir);
    const active = this.tools.activeTool;

    if (active !== 'none' && active !== 'inspect' && active !== 'interact') {
      this.tools.updateGhost(point, ctx);
    }

    const mouseDown = this.input.mouseButtons.has(0) && !this.input.uiFocused;
    if (mouseDown && point) {
      const sculpt = active === 'raise' || active === 'lower' || active === 'smooth' || active === 'flatten' || active === 'water_channel' || active.startsWith('paint_');
      if (sculpt) {
        this.tools.applyBrush(point, dt);
      }
    }
    if (!mouseDown) this.tools.endBrush();

    // Click one-shot actions
    if (this.input.mouseButtons.has(0) && point && (active.startsWith('plant_') || active === 'remove_vegetation' || active.startsWith('build_'))) {
      if (!this.clickLatch) {
        this.clickLatch = true;
        const result = this.tools.useTool(point, ctx);
        if (result.message) this.ui.toast(result.message, result.ok ? 'info' : 'danger', 3200);
        if (active.startsWith('build_') && result.ok) this.audio.ui('success');
        // Rebuild hydrology window after edits
        this.hydro.invalidateTerrain(point.x - 40, point.z - 40, point.x + 40, point.z + 40);
      }
    } else {
      this.clickLatch = false;
    }

    // Interaction prompt
    if (point) {
      const candidates = this.tools.findInteraction(point, ctx);
      const near = candidates[0];
      if (near && near.distance < 9) {
        this.hoveredInteraction = near;
      } else {
        this.hoveredInteraction = null;
      }
    } else {
      this.hoveredInteraction = null;
    }

    // E to interact
    if (this.input.actionPressed('interact') && this.hoveredInteraction) {
      const c = this.hoveredInteraction;
      if (c.kind === 'citizen') {
        const citizen = c.data as { name: string; occupation: string; mood: number; needs: { hunger: number; energy: number; social: number }; action: string };
        this.ui.showInspector({
          title: citizen.name,
          kind: `Citizen · ${citizen.occupation}`,
          rows: [
            ['Activity', citizen.action],
            ['Mood', `${Math.round(citizen.mood * 100)}%`],
            ['Hunger', `${Math.round(100 - citizen.needs.hunger)}%`],
            ['Energy', `${Math.round(citizen.needs.energy)}%`],
            ['Social', `${Math.round(100 - citizen.needs.social)}%`],
          ],
          actions: [{ id: 'track', label: 'Track on map' }],
          onAction: () => this.trackEntity('citizen', c.id),
        });
      } else if (c.kind === 'animal') {
        const a = c.data as { species: string; state: string; health: number; hunger: number; age: number };
        this.ui.showInspector({
          title: SPECIES[a.species]?.label ?? a.species,
          kind: 'Wildlife',
          rows: [
            ['State', a.state],
            ['Health', `${Math.round(a.health)}`],
            ['Fed', `${Math.round(a.hunger)}%`],
            ['Age (days)', `${Math.floor(a.age)}`],
          ],
        });
      } else if (c.kind === 'building') {
        const b = c.data as { type: string; condition: number };
        this.ui.showInspector({
          title: c.label,
          kind: 'Building',
          rows: [
            ['Type', b.type],
            ['Condition', `${Math.round(b.condition * 100)}%`],
          ],
        });
      } else if (c.kind === 'water') {
        const q = this.hydro.qualityAt(c.x, c.z);
        this.ui.showInspector({
          title: 'Water',
          kind: 'Environment',
          rows: [
            ['Quality', `${Math.round(q * 100)}%`],
            ['Depth', `${this.hydro.depthAt(c.x, c.z).toFixed(2)} m`],
            ['Flow', `${this.gen.riverMask(c.x, c.z).toFixed(2)}`],
          ],
        });
      }
      this.audio.ui('click');
    }

    // F secondary action: toggle flashlight-like highlight (night lamp)
    if (this.input.actionPressed('secondary')) {
      this.player.cameraMode === 'first' ? (this.player.cameraMode = 'third') : (this.player.cameraMode = 'first');
    }
  }

  private clickLatch = false;
  private hoveredInteraction: import('./player/tools').InteractionCandidate | null = null;
  private inMenu = true;

  setInMenu(inMenu: boolean): void {
    this.inMenu = inMenu;
  }

  private handleHotkeys(): void {
    const input = this.input;
    if (this.inMenu) return;

    // Escape always works: closes the current panel or opens the pause menu.
    if (input.keyPressed(input.bindings.pause)) {
      if (this.ui.isPanelOpen) {
        this.ui.closePanel();
        this.paused = false;
        this.input.uiFocused = false;
      } else {
        this.paused = true;
        this.input.uiFocused = true;
        this.ui.openPauseMenu();
      }
      return;
    }
    if (input.uiFocused) return;

    if (input.actionPressed('map')) {
      if (this.ui.openPanelName === 'map') {
        this.ui.closePanel();
        this.paused = false;
        this.input.uiFocused = false;
      } else {
        this.paused = true;
        this.input.uiFocused = true;
        this.ui.openMapPanel();
      }
    }
    if (input.actionPressed('stats')) {
      this.paused = true;
      this.input.uiFocused = true;
      this.ui.openStatsPanel(this.simulation.stats(), this.simulation.events.events);
    }
    if (input.actionPressed('build')) {
      if (this.ui.openPanelName === 'build') {
        this.ui.closePanel();
        this.paused = false;
        this.input.uiFocused = false;
      } else {
        this.openBuildPanel();
      }
    }
    if (input.actionPressed('inventory')) {
      this.openStatusPanel();
    }
    if (input.actionPressed('cameraToggle')) {
      const order: Array<import('./player/player').CameraMode> = ['third', 'first', 'fly', 'overview'];
      const idx = order.indexOf(this.player.cameraMode);
      this.setCameraMode(order[(idx + 1) % order.length]);
    }
    if (input.actionPressed('godMode')) {
      this.ui.toggleGodBar(true, (a, v) => this.godAction(a, v));
    }
    if (input.actionPressed('debug')) {
      this.settings.showDebug = !this.settings.showDebug;
      this.ui.setDebug(this.settings.showDebug);
    }

    // Time speed: keys 0..4 (also mirrored in the HUD control).
    const speedMap: Array<[string, TimeSpeed]> = [
      ['Digit0', 0], ['Digit1', 1], ['Digit2', 4], ['Digit3', 16], ['Digit4', 64],
    ];
    for (const [code, speed] of speedMap) {
      if (input.keyPressed(code)) this.setSpeed(speed);
    }

    // Tool hotbar 5-8 (1-4 are speeds; tools also on the on-screen bar / B menu)
    const toolHotbar: Array<[string, ToolId]> = [
      ['Digit5', 'plant_tree'],
      ['Digit6', 'remove_vegetation'],
      ['Digit7', 'build_house'],
      ['Digit8', 'inspect'],
    ];
    for (const [code, tool] of toolHotbar) {
      if (input.keyPressed(code)) this.selectTool(tool);
    }

    // Ctrl+Z undo
    if (input.keysDown.has('ControlLeft') && input.keyPressed('KeyZ')) {
      if (this.tools.ctx) {
        const r = this.tools.undoTerrain(this.tools.ctx);
        this.chunks.markDirty(this.player.position.x, this.player.position.z, 80);
        this.ui.toast(r.message, 'info', 2500);
      }
    }

    // R rotates buildings
    if (input.keyPressed('KeyR')) {
      this.tools.placementRotation += Math.PI / 8;
    }
    if (input.wheel !== 0 && this.tools.activeTool.startsWith('build_')) {
      this.tools.placementRotation += Math.sign(input.wheel) * 0.12;
    }
  }

  // ------------------------------------------------------------ UI updates

  private updateUI(): void {
    if (!this.ui) return;
    const clock = this.simulation.clock;
    const sample = this.gen.sample(this.player.position.x, this.player.position.z, clock.yearPhase);
    const settlement = this.simulation.settlements.find(
      (s) => Math.hypot(s.x - this.player.position.x, s.z - this.player.position.z) < 220,
    );
    const poi = this.discoveries.find(
      (d) => Math.hypot(d.x - this.player.position.x, d.z - this.player.position.z) < 160,
    );
    const location = settlement ? settlement.name : poi ? poi.name : sample.biome === 'deep_ocean' || sample.biome === 'shallow_ocean' ? 'Open Water' : 'Wilderness';

    const hudState: HudState = {
      timeOfDay: clock.timeOfDay,
      day: clock.day,
      season: SEASON_LABEL[clock.season],
      weather: WEATHER_LABEL[this.simulation.weather.state.kind],
      weatherKind: this.simulation.weather.state.kind,
      speed: clock.speed,
      cameraMode: this.player.cameraMode,
      coords: { x: this.player.position.x, y: this.player.position.y, z: this.player.position.z },
      biome: sample.biome.replace(/_/g, ' '),
      location,
      survivalEnabled: this.settings.survival,
      health: this.player.health,
      stamina: this.player.stamina,
      hunger: this.player.hunger,
      thirst: this.player.thirst,
      warmth: this.player.warmth,
      fps: this.fps,
      interactionPrompt: this.hoveredInteraction ? `Inspect ${this.hoveredInteraction.label}` : null,
      activeTool: this.tools.activeTool === 'none' ? null : this.tools.activeTool,
      toolHint: null,
    };
    this.ui.updateHud(hudState);

    // Minimap
    if (this.settings.showMinimap && this.ui.minimapCanvas.isConnected) {
      this.map.render(
        {
          playerX: this.player.position.x,
          playerZ: this.player.position.z,
          playerYaw: this.player.yaw,
          settlements: this.simulation.settlements,
          discoveries: this.discoveries,
          waypoints: this.waypoints,
          citizens: [],
          trackedX: this.tracked?.x,
          trackedZ: this.tracked?.z,
          trackedLabel: this.tracked?.label,
        },
        'mini',
        this.ui.minimapCanvas,
      );
    }

    // Map panel
    if (this.ui.openPanelName === 'map' && this.ui.mapCanvas) {
      if (!this.ui.mapCanvas.hasAttribute('data-bound')) {
        this.ui.mapCanvas.setAttribute('data-bound', '1');
        (this.map as unknown as { canvas: HTMLCanvasElement }).canvas = this.ui.mapCanvas;
        this.map.attachInteraction();
      }
      this.map.render({
        playerX: this.player.position.x,
        playerZ: this.player.position.z,
        playerYaw: this.player.yaw,
        settlements: this.simulation.settlements,
        discoveries: this.discoveries,
        waypoints: this.waypoints,
        citizens: this.simulation.citizens.citizens.map((c) => ({ x: c.x, z: c.z, name: c.name })),
        trackedX: this.tracked?.x,
        trackedZ: this.tracked?.z,
        trackedLabel: this.tracked?.label,
      }, 'full', this.ui.mapCanvas);
    }

    // Stats panel
    if (this.ui.openPanelName === 'stats') {
      this.ui.updateStats(this.simulation.stats(), this.simulation.events.events);
    }

    // Debug overlay
    if (this.settings.showDebug) {
      this.ui.updateDebug([
        ['FPS', `${this.fps.toFixed(0)}  (${(1000 / Math.max(this.fps, 1)).toFixed(1)} ms)`],
        ['Frame', `${this.frameMs.toFixed(2)} ms · sim ${this.simMs.toFixed(2)} ms · render ${this.renderMs.toFixed(2)} ms`],
        ['Draw calls', `${this.renderer.info.render.calls}`],
        ['Triangles', `${formatNumber(this.renderer.info.render.triangles)}`],
        ['Chunks', `${this.chunks.activeCount} active · ${this.chunks.farCount} far · ${this.chunks.pendingBuilds} queued`],
        ['Vegetation groups', `${this.veg.activeGroups}`],
        ['Agents', `${this.simulation.citizens.citizens.filter((c) => c.alive).length} humans · ${this.simulation.animals.animals.length} animals detailed`],
        ['Memory (geo)', `${(this.renderer.info.memory.geometries)} geo · ${this.renderer.info.memory.textures} tex`],
        ['Weather', `${WEATHER_LABEL[this.simulation.weather.state.kind]} · water balance ${this.hydro.waterBalance.toFixed(2)}`],
        ['Time', `${formatClock(clock.timeOfDay)} day ${clock.day} · ${clock.speed}×`],
      ]);
    }
  }

  // ------------------------------------------------------------ actions

  setSpeed(speed: TimeSpeed): void {
    this.simulation.clock.speed = speed;
    this.audio.ui('click');
  }

  setCameraMode(mode: import('./player/player').CameraMode): void {
    this.player.cameraMode = mode;
    const labels: Record<string, string> = { third: 'Third person', first: 'First person', fly: 'Free camera', overview: 'City overview' };
    this.ui.toast(`${labels[mode]}.`, 'info', 1800);
  }

  selectTool(tool: ToolId | null): void {
    if (!tool || tool === 'inspect') {
      this.tools.setTool('none');
    } else {
      this.tools.setTool(tool);
    }
    this.audio.ui('click');
  }

  private openBuildPanel(): void {
    this.paused = true;
    this.input.uiFocused = true;
    const categories = ['terrain', 'nature', 'build', 'utility'] as const;
    const body = categories
      .map((cat) => {
        const tools = TOOLS.filter((t) => t.category === cat);
        return `
        <div class="section-title">${cat}</div>
        <div class="stat-grid">
          ${tools
            .map(
              (t) => `
            <div class="stat-card" data-tool="${t.id}" style="cursor:pointer">
              <div class="stat-label">${t.label}</div>
              <div class="stat-value" style="font-size:15px">${t.description}</div>
            </div>`,
            )
            .join('')}
        </div>`;
      })
      .join('');
    const panel = this.ui.openPanel('build', 'Build & Terrain Tools', body);
    panel.addEventListener('click', (e) => {
      const card = (e.target as HTMLElement).closest('[data-tool]') as HTMLElement | null;
      if (!card) return;
      this.selectTool(card.dataset.tool as ToolId);
      this.ui.closePanel();
      this.paused = false;
      this.input.uiFocused = false;
    });
  }

  private openStatusPanel(): void {
    this.paused = true;
    this.input.uiFocused = true;
    const p = this.player;
    this.ui.openPanel(
      'status',
      'Survival & Status',
      `
      <div class="stat-grid">
        <div class="stat-card"><div class="stat-label">Health</div><div class="stat-value">${Math.round(p.health)}%</div></div>
        <div class="stat-card"><div class="stat-label">Stamina</div><div class="stat-value">${Math.round(p.stamina)}%</div></div>
        <div class="stat-card"><div class="stat-label">Hunger</div><div class="stat-value">${Math.round(p.hunger)}%</div></div>
        <div class="stat-card"><div class="stat-label">Thirst</div><div class="stat-value">${Math.round(p.thirst)}%</div></div>
      </div>
      <div class="section-title">World</div>
      <div class="stat-grid">
        <div class="stat-card"><div class="stat-label">Mode</div><div class="stat-value" style="font-size:15px">${this.settings.survival ? 'Survival' : 'Explorer'}</div></div>
        <div class="stat-card"><div class="stat-label">Play time</div><div class="stat-value" style="font-size:15px">${Math.floor(this.playSeconds / 60)} min</div></div>
        <div class="stat-card"><div class="stat-label">Discoveries</div><div class="stat-value">${this.discoveries.length}</div></div>
        <div class="stat-card"><div class="stat-label">Timber harvested</div><div class="stat-value">${this.simulation.timberHarvested}</div></div>
      </div>
      `,
    );
  }

  private openNamedPanel(name: string): void {
    if (name === 'map') this.ui.openMapPanel();
    else if (name === 'stats') this.ui.openStatsPanel(this.simulation.stats(), this.simulation.events.events);
    else if (name === 'settings') this.ui.openSettingsPanel(true);
    else if (name === 'build') this.openBuildPanel();
    else if (name === 'saves') void this.refreshSaveSlots();
  }

  private async refreshSaveSlots(): Promise<void> {
    const slots = await this.db.listSlots();
    this.ui.updateSaveSlots(slots);
  }

  resumeGame(): void {
    this.paused = false;
    this.input.uiFocused = false;
    this.ui.closePanel();
    this.canvas.focus();
    this.input.requestPointerLock();
  }

  private applySetting(key: string, value: unknown): void {
    switch (key) {
      case 'quality':
        this.settings.quality = value as SettingsValues['quality'];
        this.applyQualityPreset(this.settings.quality);
        break;
      case 'renderDistance':
        this.settings.renderDistance = value as number;
        this.chunks.update(this.player.position.x, this.player.position.z, true);
        break;
      case 'foliage':
        this.settings.foliage = value as number;
        break;
      case 'postProcessing':
        this.settings.postProcessing = value as boolean;
        this.setupComposer();
        break;
      case 'simulationDensity':
        this.settings.simulationDensity = value as number;
        break;
      case 'survival':
        this.settings.survival = value as boolean;
        this.player.survivalEnabled = this.settings.survival;
        break;
      case 'masterVolume':
        this.settings.masterVolume = value as number;
        this.audio.setVolume('master', value as number);
        break;
      case 'ambienceVolume':
        this.settings.ambienceVolume = value as number;
        this.audio.setVolume('ambience', value as number);
        break;
      case 'effectsVolume':
        this.settings.effectsVolume = value as number;
        this.audio.setVolume('effects', value as number);
        break;
      case 'muted':
        this.settings.muted = value as boolean;
        this.audio.setMuted(value as boolean);
        break;
      case 'fov':
        this.settings.fov = value as number;
        this.camera.fov = value as number;
        this.camera.updateProjectionMatrix();
        break;
      case 'sensitivity':
        this.settings.sensitivity = value as number;
        break;
      case 'invertY':
        this.settings.invertY = value as boolean;
        break;
      case 'showMinimap':
        this.settings.showMinimap = value as boolean;
        break;
      case 'autosaveMinutes':
        this.settings.autosaveMinutes = value as number;
        break;
      case 'cycleCamera': {
        const order: Array<import('./player/player').CameraMode> = ['third', 'first', 'fly', 'overview'];
        const idx = order.indexOf(this.player.cameraMode);
        this.setCameraMode(order[(idx + 1) % order.length]);
        break;
      }
      case 'toMainMenu':
        void this.saveWorld(undefined, true).then(() => {
          this.paused = true;
          this.input.uiFocused = true;
          this.ui.closePanel();
          this.ui.setMenuVisible(true, this.currentSaveId !== null);
        });
        break;
      case 'mapCenter':
        this.map.view.centerX = this.player.position.x;
        this.map.view.centerZ = this.player.position.z;
        break;
      case 'mapWaypoint':
        this.waypoints.push({ x: this.map.view.centerX, z: this.map.view.centerZ, label: `Waypoint ${this.waypoints.length + 1}` });
        break;
      case 'mapZoom': {
        const f = value as number;
        this.map.view.zoom = clamp(this.map.view.zoom * f, 0.12, 8);
        break;
      }
    }
    SettingsStore.set('settings', this.settings);
    this.audio.ui('click');
  }

  private applyQualityPreset(preset: SettingsValues['quality']): void {
    const presets = {
      low: { renderDistance: 384, shadow: 512, post: false, pixelRatio: 1 },
      medium: { renderDistance: 576, shadow: 1024, post: true, pixelRatio: 1.25 },
      high: { renderDistance: 768, shadow: 2048, post: true, pixelRatio: 1.5 },
      ultra: { renderDistance: 1152, shadow: 3072, post: true, pixelRatio: 1.75 },
    };
    if (preset === 'custom') return;
    const p = presets[preset];
    this.settings.renderDistance = p.renderDistance;
    this.settings.shadowQuality = p.shadow;
    this.settings.postProcessing = p.post;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, p.pixelRatio));
    this.atmosphere.setQuality(p.shadow, preset === 'low' ? 1 : 2.2);
    if (this.chunks) {
      (this.chunks as unknown as { opts: { viewDistance: number } }).opts.viewDistance = p.renderDistance;
      this.chunks.update(this.player.position.x, this.player.position.z, true);
    }
    this.setupComposer();
    SettingsStore.set('settings', this.settings);
  }

  private setupComposer(): void {
    if (!this.settings.postProcessing) {
      this.composer = null;
      return;
    }
    if (!this.composer) {
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.22, 0.55, 0.92);
      this.composer.addPass(this.bloomPass);
      this.composer.addPass(new OutputPass());
    }
    this.composer.setSize(window.innerWidth, window.innerHeight);
  }

  private godAction(action: string, value?: unknown): void {
    const clock = this.simulation.clock;
    switch (action) {
      case 'toggle':
        this.ui.toggleGodBar(true, (a, v) => this.godAction(a, v));
        break;
      case 'weather': {
        const kind = String(value) as import('./world/weather').WeatherKind;
        this.simulation.weather.forceWeather(kind);
        this.ui.toast(`Weather set to ${WEATHER_LABEL[kind]}.`, 'info', 2500);
        break;
      }
      case 'time': {
        const tod = value === 'day' ? 12 : 0;
        clock.hours = Math.floor(clock.hours / 24) * 24 + tod;
        break;
      }
      case 'spawn': {
        const species = String(value);
        if (SPECIES[species]) {
          const ang = Math.random() * TAU;
          this.simulation.animals.spawn(
            species,
            this.player.position.x + Math.cos(ang) * 22,
            this.player.position.z + Math.sin(ang) * 22,
          );
          this.ui.toast(`Spawned ${SPECIES[species].label}.`, 'ecology', 2500);
        } else {
          this.ui.toast('Unknown species — command refused.', 'danger', 2500);
        }
        break;
      }
      case 'event': {
        if (value === 'drought') {
          this.simulation.weather.state.hydroBalance = 0.55;
          this.simulation.events.add('danger', 'A supernatural drought descends.', this.player.position.x, this.player.position.z, clock);
        } else if (value === 'rain') {
          this.simulation.weather.forceWeather('heavy_rain', 24);
          this.simulation.weather.state.hydroBalance = 1.4;
        }
        break;
      }
      case 'speed': {
        const s = Number(value) as TimeSpeed;
        if ([0, 1, 4, 16, 64].includes(s)) this.setSpeed(s);
        break;
      }
      default:
        this.ui.toast('Unknown god command (ignored safely).', 'danger', 2500);
    }
  }

  private trackEntity(kind: string, id: string): void {
    if (kind === 'citizen') {
      const c = this.simulation.citizens.citizens.find((x) => `citizen-${x.id}` === id);
      if (c) this.tracked = { kind, id, x: c.x, z: c.z, label: c.name };
    } else if (kind === 'animal') {
      const a = this.simulation.animals.animals.find((x) => `animal-${x.id}` === id);
      if (a) this.tracked = { kind, id, x: a.x, z: a.z, label: a.species };
    }
  }

  private populateDiscoveryRegion(): void {
    const spawn = this.player.position;
    this.undiscovered = findDiscoveries(this.gen, this.hydro, spawn.x, spawn.z, 1400);
  }

  // ------------------------------------------------------------ persistence

  private buildSave(): WorldSave {
    return {
      version: SAVE_VERSION,
      meta: {
        name: this.worldName,
        seed: this.gen.config.seed,
        created: Date.now(),
        updated: Date.now(),
        playSeconds: this.playSeconds,
      },
      config: this.gen.config,
      clock: this.simulation.clock.serialize(),
      weather: this.simulation.weather.serialize(),
      hydro: this.simulation.serialize().hydro,
      terrainEdits: this.gen.edits.serialize(),
      vegetation: this.veg.serialize() as unknown as { planted: unknown[]; removed: number[] },
      simulation: this.simulation.serialize(),
      player: this.player.serialize(),
      discoveries: this.discoveries,
    };
  }

  async saveWorld(name?: string, silent = false): Promise<boolean> {
    if (name) this.worldName = name;
    const save = this.buildSave();
    const id = this.currentSaveId ?? `world-${Date.now().toString(36)}`;
    this.currentSaveId = id;
    const json = JSON.stringify(save);
    const ok = await this.db.putSlot({
      id,
      name: this.worldName,
      created: save.meta.created,
      updated: Date.now(),
      seed: save.meta.seed,
      worldDay: Math.floor(save.clock.hours / 24),
      playSeconds: this.playSeconds,
      version: SAVE_VERSION,
      sizeBytes: json.length,
      data: save,
    });
    if (!silent) {
      this.ui.toast(ok ? 'World saved.' : 'Save failed — storage unavailable. Use Export.', ok ? 'settlement' : 'danger');
      this.audio.ui(ok ? 'success' : 'error');
    }
    return ok;
  }

  async loadSlot(id: string): Promise<void> {
    const slot = await this.db.getSlot(id);
    if (!slot) {
      this.ui.toast('Save could not be read.', 'danger');
      return;
    }
    const { save, result } = validateSave(slot.data);
    if (!save) {
      this.ui.toast(`Corrupt save: ${result.errors.join('; ')}`, 'danger', 8000);
      return;
    }
    this.applySave(save);
    this.currentSaveId = id;
    this.ui.setMenuVisible(false);
    this.ui.toast(`Loaded ${save.meta.name}.`, 'settlement');
    this.paused = false;
  }

  private applySave(save: WorldSave): void {
    const config = save.config ?? defaultWorldConfig(save.meta.seed);
    this.worldName = save.meta.name;
    this.playSeconds = save.meta.playSeconds ?? 0;
    this.buildWorld(config, false);

    // Terrain edits
    const edits = save.terrainEdits ?? { d: [], p: [] };
    for (let i = 0; i < edits.d.length; i += 2) this.gen.edits.deltas.set(edits.d[i], edits.d[i + 1]);
    for (let i = 0; i < edits.p.length; i += 2) this.gen.edits.paint.set(edits.p[i], edits.p[i + 1]);

    // Vegetation
    this.veg.restore(save.vegetation as never);

    // Simulation state
    this.simulation.restore(save.simulation as never);

    // Player
    this.player.restore(save.player);
    this.player.survivalEnabled = this.settings.survival;

    this.discoveries = save.discoveries ?? [];
    this.undiscovered = findDiscoveries(this.gen, this.hydro, this.player.position.x, this.player.position.z, 1400)
      .filter((d) => !this.discoveries.some((x) => x.id === d.id));

    // Rebuild world view around the player
    void this.warmHydro(120, () => {});
    this.chunks.update(this.player.position.x, this.player.position.z, true);
    this.chunks.processQueue(200);
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        this.veg.buildChunk(Math.floor(this.player.position.x / CHUNK_SIZE) + dx, Math.floor(this.player.position.z / CHUNK_SIZE) + dz);
      }
    }
    this.chunks.refreshWater(this.player.position.x, this.player.position.z, 260);
    this.map.reveal(this.player.position.x, this.player.position.z, 500);
  }

  async deleteSlot(id: string): Promise<void> {
    await this.db.deleteSlot(id);
    if (this.currentSaveId === id) this.currentSaveId = null;
    const slots = await this.db.listSlots();
    this.ui.updateSaveSlots(slots);
    this.ui.toast('Save deleted.', 'info');
  }

  async exportWorld(): Promise<void> {
    const save = this.buildSave();
    const text = buildExportFile(save);
    downloadFile(`${this.worldName.replace(/\s+/g, '-').toLowerCase()}-eden.json`, text);
    this.ui.toast('World exported as JSON.', 'settlement');
  }

  async importWorld(file: File): Promise<void> {
    const text = await file.text();
    const { save, error } = parseExportFile(text);
    if (!save) {
      this.ui.toast(`Import failed: ${error}`, 'danger', 7000);
      return;
    }
    this.applySave(save);
    await this.saveWorld(save.meta.name);
    this.ui.setMenuVisible(false);
    this.ui.toast(`Imported ${save.meta.name}.`, 'settlement');
    this.paused = false;
  }

  async resetWorld(): Promise<void> {
    this.gen.edits.clear();
    this.ui.toast('Terrain edits cleared.', 'info');
    this.chunks.update(this.player.position.x, this.player.position.z, true);
    this.chunks.markDirty(this.player.position.x, this.player.position.z, 400);
  }

  // ------------------------------------------------------------ accessors

  get audioEngine(): AudioEngine {
    return this.audio;
  }

  get uiManager(): UIManager {
    return this.ui;
  }

  get inputManager(): Input {
    return this.input;
  }

  initInput(): void {
    this.input = new Input(this.canvas);
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.input?.dispose();
    this.audio.dispose();
    this.renderer?.dispose();
  }
}
