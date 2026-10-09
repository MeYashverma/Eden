/**
 * UI manager: main menu, HUD, panels, map, inspector, god bar, toasts and
 * debug overlay. The DOM is built once and updated in place — no framework,
 * no per-frame allocations of big trees.
 */

import { icon } from './icons';
import { formatClock, formatNumber, formatDuration } from '../core/math';
import { TOOLS, type ToolId, type ToolDef } from '../player/tools';
import type { TimeSpeed } from '../core/clock';
import type { CameraMode } from '../player/player';
import type { WeatherKind } from '../world/weather';
import type { SaveSlotMeta } from '../persistence/db';
import type { WorldStats } from '../sim/ecosystem';
import type { WorldEvent } from '../sim/events';
import type { WorldGenConfig } from '../world/types';

export interface HudState {
  timeOfDay: number;
  day: number;
  season: string;
  weather: string;
  weatherKind: WeatherKind;
  speed: TimeSpeed;
  cameraMode: CameraMode;
  coords: { x: number; y: number; z: number };
  biome: string;
  location: string;
  survivalEnabled: boolean;
  health: number;
  stamina: number;
  hunger: number;
  thirst: number;
  warmth: number;
  fps: number;
  interactionPrompt: string | null;
  activeTool: string | null;
  toolHint: string | null;
}

export interface UICallbacks {
  onNewWorld: (config: Partial<WorldGenConfig> & { seed: number; name: string }) => void;
  onContinue: () => void;
  onLoadSlot: (id: string) => void;
  onDeleteSlot: (id: string) => void;
  onRenameSlot: (id: string, name: string) => void;
  onSaveNow: (name?: string) => void;
  onExportWorld: () => void;
  onImportWorld: (file: File) => void;
  onSetSpeed: (speed: TimeSpeed) => void;
  onSetCamera: (mode: CameraMode) => void;
  onSelectTool: (tool: ToolId | null) => void;
  onSettingChange: (key: string, value: unknown) => void;
  onGodAction: (action: string, value?: unknown) => void;
  onResume: () => void;
  onRegenerate: () => void;
  onResetWorld: () => void;
  onShowPanel: (name: string) => void;
  onClosePanel: () => void;
  onMapWaypoint: (x: number, z: number) => void;
  onTrackEntity: (kind: string, id: string) => void;
  onInteract: (candidateId: string) => void;
  onAudioUnlock: () => void;
}

export interface SettingsValues {
  quality: 'low' | 'medium' | 'high' | 'ultra' | 'custom';
  renderDistance: number;
  shadowQuality: number;
  postProcessing: boolean;
  foliage: number;
  simulationDensity: number;
  showMinimap: boolean;
  showDebug: boolean;
  masterVolume: number;
  ambienceVolume: number;
  effectsVolume: number;
  uiVolume: number;
  muted: boolean;
  fov: number;
  invertY: boolean;
  sensitivity: number;
  survival: boolean;
  autosaveMinutes: number;
}

export class UIManager {
  private roots: {
    boot: HTMLElement;
    bootFill: HTMLElement;
    bootStatus: HTMLElement;
    menu: HTMLElement;
    hud: HTMLElement;
    panels: HTMLElement;
    toasts: HTMLElement;
    fatal: HTMLElement;
    fatalMessage: HTMLElement;
  };
  private hudEls!: {
    clock: HTMLElement;
    meta: HTMLElement;
    weatherIcon: HTMLElement;
    speedBtns: Map<TimeSpeed, HTMLButtonElement>;
    bars: HTMLElement;
    location: HTMLElement;
    prompt: HTMLElement;
    hotbar: HTMLElement;
    minimap: HTMLElement;
    camLabel: HTMLElement;
  };
  private inspectorEl: HTMLElement | null = null;
  private debugEl: HTMLElement | null = null;
  private godEl: HTMLElement | null = null;
  private activePanel: string | null = null;
  private panelBody: HTMLElement | null = null;
  private panelTitle: HTMLElement | null = null;
  private settings: SettingsValues;
  private cb: UICallbacks;
  private lastPrompt = '';
  private menuVisible = true;

  minimapCanvas: HTMLCanvasElement;
  mapCanvas: HTMLCanvasElement | null = null;
  openPanelName: string | null = null;

  constructor(cb: UICallbacks, settings: SettingsValues) {
    this.cb = cb;
    this.settings = settings;
    this.roots = {
      boot: document.getElementById('boot-screen')!,
      bootFill: document.getElementById('boot-progress-fill')!,
      bootStatus: document.getElementById('boot-status')!,
      menu: document.getElementById('main-menu')!,
      hud: document.getElementById('hud-root')!,
      panels: document.getElementById('panel-root')!,
      toasts: document.getElementById('toast-root')!,
      fatal: document.getElementById('fatal-error')!,
      fatalMessage: document.getElementById('fatal-message')!,
    };
    this.minimapCanvas = document.createElement('canvas');
    this.buildMenu();
    this.buildHud();
  }

  // ------------------------------------------------------------- boot

  setBootProgress(pct: number, status: string): void {
    const p = Math.max(0, Math.min(100, pct));
    this.roots.bootFill.style.width = `${p}%`;
    this.roots.bootStatus.textContent = status;
    this.roots.boot.querySelector('.boot-progress')?.setAttribute('aria-valuenow', String(Math.round(p)));
  }

  finishBoot(): void {
    this.roots.boot.classList.add('fading');
    setTimeout(() => this.roots.boot.classList.add('hidden'), 750);
  }

  showFatal(message: string): void {
    this.roots.fatal.classList.remove('hidden');
    this.roots.fatalMessage.textContent = message;
    document.getElementById('fatal-reload')?.addEventListener('click', () => location.reload());
  }

  // ------------------------------------------------------------- menu

  private buildMenu(): void {
    const menu = this.roots.menu;
    menu.innerHTML = `
      <div class="menu-brand">
        <h1>EDEN</h1>
        <p class="tagline">an entire little world — and almost everything in it can change</p>
      </div>
      <div class="menu-list">
        <button class="menu-item primary" data-action="continue">${icon('play', 19)}<span>Continue<span class="sub" id="menu-continue-sub">Resume your latest world</span></span></button>
        <button class="menu-item" data-action="new">${icon('plus', 19)}<span>New World<span class="sub">Generate a fresh seed</span></span></button>
        <button class="menu-item" data-action="load">${icon('folder', 19)}<span>Load World<span class="sub">Browse saved worlds</span></span></button>
        <button class="menu-item" data-action="gallery">${icon('grid', 19)}<span>World Gallery<span class="sub">Export, import & manage</span></span></button>
        <button class="menu-item" data-action="settings">${icon('settings', 19)}<span>Settings<span class="sub">Graphics, audio, gameplay</span></span></button>
        <button class="menu-item" data-action="controls">${icon('keyboard', 19)}<span>Controls<span class="sub">Key bindings & camera</span></span></button>
        <button class="menu-item" data-action="credits">${icon('info', 19)}<span>Credits<span class="sub">Technology & asset acknowledgments</span></span></button>
      </div>
      <div class="menu-footer">
        <span>Procedural world · runs entirely in your browser</span>
        <span id="menu-version">v1.0</span>
      </div>
    `;
    menu.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
      if (!btn) return;
      this.cb.onAudioUnlock();
      const action = btn.dataset.action;
      switch (action) {
        case 'continue': this.cb.onContinue(); break;
        case 'new': this.openNewWorldPanel(); break;
        case 'load': this.openSavesPanel('load'); break;
        case 'gallery': this.openSavesPanel('gallery'); break;
        case 'settings': this.openSettingsPanel(); break;
        case 'controls': this.openControlsPanel(); break;
        case 'credits': this.openCreditsPanel(); break;
      }
    });
  }

  setMenuVisible(visible: boolean, hasSave = false): void {
    this.menuVisible = visible;
    this.roots.menu.classList.toggle('hidden', !visible);
    this.roots.hud.classList.toggle('hidden', visible);
    const cont = this.roots.menu.querySelector('[data-action="continue"]') as HTMLButtonElement | null;
    if (cont) cont.disabled = !hasSave;
    const sub = document.getElementById('menu-continue-sub');
    if (sub) sub.textContent = hasSave ? 'Resume your latest world' : 'No saved world yet';
    if (visible) {
      this.closePanel();
      document.exitPointerLock?.();
    }
  }

  // ------------------------------------------------------------- HUD

  private buildHud(): void {
    const hud = this.roots.hud;
    hud.innerHTML = `
      <div class="hud-top-left">
        <div class="hud-clock">
          <div class="weather-icon" id="hud-weather-icon">${icon('sun', 26)}</div>
          <div>
            <div class="time" id="hud-time">06:30</div>
            <div class="meta" id="hud-meta">Spring · Day 1 · Fair</div>
          </div>
        </div>
      </div>
      <div class="hud-top-right">
        <div class="speed-control" id="hud-speeds"></div>
        <button class="btn btn-icon" id="hud-camera" title="Camera (C)">${icon('eye', 17)}</button>
        <button class="btn btn-icon" id="hud-map-btn" title="World Map (M)">${icon('map', 17)}</button>
        <button class="btn btn-icon" id="hud-stats" title="World Stats (N)">${icon('chart', 17)}</button>
        <button class="btn btn-icon" id="hud-settings" title="Menu (Esc)">${icon('settings', 17)}</button>
      </div>
      <div class="hud-bottom-left">
        <div class="hud-bars hidden" id="hud-bars"></div>
        <div class="hud-location" id="hud-location">…</div>
      </div>
      <div class="hud-bottom-center">
        <div class="interaction-prompt hidden" id="hud-prompt"></div>
        <div class="tool-hotbar" id="hud-hotbar"></div>
      </div>
      <div class="hud-minimap" id="hud-minimap-wrap">
        <div class="minimap-label">Map</div>
      </div>
    `;

    const speeds = hud.querySelector('#hud-speeds')!;
    const speedBtns = new Map<TimeSpeed, HTMLButtonElement>();
    for (const s of [0, 1, 4, 16, 64] as TimeSpeed[]) {
      const b = document.createElement('button');
      b.className = 'speed-btn' + (s === 1 ? ' active' : '');
      b.textContent = s === 0 ? '❚❚' : `${s}×`;
      b.title = s === 0 ? 'Pause' : `Speed ${s}×`;
      b.addEventListener('click', () => {
        this.cb.onAudioUnlock();
        this.cb.onSetSpeed(s);
      });
      speeds.appendChild(b);
      speedBtns.set(s, b);
    }

    const bars = hud.querySelector('#hud-bars') as HTMLElement;
    bars.innerHTML = ['health', 'stamina', 'hunger', 'thirst', 'warmth']
      .map(
        (k) => `
        <div class="bar-row bar-${k}">
          ${icon(k === 'health' ? 'heart' : k === 'stamina' ? 'bolt' : k === 'hunger' ? 'paw' : k === 'thirst' ? 'water' : 'sun', 14)}
          <div class="bar-track"><div class="bar-fill" id="bar-${k}" style="width:100%"></div></div>
        </div>`,
      )
      .join('');

    const hotbar = hud.querySelector('#hud-hotbar') as HTMLElement;
    const hotTools: ToolId[] = ['raise', 'lower', 'smooth', 'flatten', 'plant_tree', 'remove_vegetation', 'build_house', 'inspect'];
    hotTools.forEach((t, i) => {
      const def = TOOLS.find((d) => d.id === t)!;
      const slot = document.createElement('button');
      slot.className = 'tool-slot';
      slot.title = `${def.label} — ${def.description}`;
      slot.dataset.tool = t;
      slot.innerHTML = `${icon(def.icon, 20)}<span class="key">${i + 1}</span>`;
      slot.addEventListener('click', () => {
        this.cb.onAudioUnlock();
        this.cb.onSelectTool(t);
      });
      hotbar.appendChild(slot);
    });

    this.minimapCanvas.addEventListener('click', () => this.openMapPanel());
    hud.querySelector('#hud-minimap-wrap')!.appendChild(this.minimapCanvas);

    hud.querySelector('#hud-camera')!.addEventListener('click', () => {
      const order: CameraMode[] = ['third', 'first', 'fly', 'overview'];
      // cycle is engine-driven; just request the next mode
      this.cb.onSettingChange('cycleCamera', true);
    });
    hud.querySelector('#hud-map-btn')!.addEventListener('click', () => this.openMapPanel());
    hud.querySelector('#hud-stats')!.addEventListener('click', () => this.openStatsPanel());
    hud.querySelector('#hud-settings')!.addEventListener('click', () => this.openPauseMenu());

    this.hudEls = {
      clock: hud.querySelector('#hud-time') as HTMLElement,
      meta: hud.querySelector('#hud-meta') as HTMLElement,
      weatherIcon: hud.querySelector('#hud-weather-icon') as HTMLElement,
      speedBtns,
      bars,
      location: hud.querySelector('#hud-location') as HTMLElement,
      prompt: hud.querySelector('#hud-prompt') as HTMLElement,
      hotbar,
      minimap: hud.querySelector('#hud-minimap-wrap') as HTMLElement,
      camLabel: hud.querySelector('#hud-camera') as HTMLElement,
    };
  }

  updateHud(state: HudState): void {
    this.hudEls.clock.textContent = formatClock(state.timeOfDay);
    this.hudEls.meta.textContent = `${state.season} · Day ${state.day + 1} · ${state.weather}`;
    const wIcon =
      state.weatherKind.includes('rain') ? 'rain' :
      state.weatherKind === 'thunderstorm' ? 'storm' :
      state.weatherKind === 'snow' || state.weatherKind === 'blizzard' ? 'snow' :
      state.weatherKind === 'fog' ? 'fog' :
      state.weatherKind === 'cloudy' ? 'cloud' : 'sun';
    this.hudEls.weatherIcon.innerHTML = icon(wIcon, 26);

    for (const [s, b] of this.hudEls.speedBtns) {
      b.classList.toggle('active', s === state.speed);
    }

    if (state.survivalEnabled) {
      this.hudEls.bars.classList.remove('hidden');
      for (const k of ['health', 'stamina', 'hunger', 'thirst', 'warmth'] as const) {
        const el = document.getElementById(`bar-${k}`);
        if (el) el.style.width = `${Math.round(state[k])}%`;
      }
    } else {
      this.hudEls.bars.classList.add('hidden');
    }

    this.hudEls.location.innerHTML = `${state.location}<br><span class="coords">${state.biome} · ${formatNumber(state.coords.x, 0)}, ${formatNumber(state.coords.y, 0)}, ${formatNumber(state.coords.z, 0)} · ${formatNumber(state.fps, 0)} fps</span>`;

    if (state.interactionPrompt !== this.lastPrompt) {
      this.lastPrompt = state.interactionPrompt ?? '';
      if (state.interactionPrompt) {
        this.hudEls.prompt.classList.remove('hidden');
        this.hudEls.prompt.innerHTML = `<span class="key-hint">E</span><span>${state.interactionPrompt}</span>`;
      } else {
        this.hudEls.prompt.classList.add('hidden');
      }
    }

    for (const slot of this.hudEls.hotbar.querySelectorAll('.tool-slot')) {
      slot.classList.toggle('active', slot.getAttribute('data-tool') === state.activeTool);
    }

    this.hudEls.minimap.style.display = this.settings.showMinimap ? '' : 'none';
  }

  // ------------------------------------------------------------- panels

  openPanel(name: string, title: string, bodyHtml: string, footerHtml = ''): HTMLElement {
    this.closePanel();
    this.openPanelName = name;
    this.activePanel = name;
    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.dataset.panel = name;
    panel.innerHTML = `
      <div class="panel-header">
        <h2>${title}</h2>
        <button class="btn btn-icon" data-close>${icon('close', 16)}</button>
      </div>
      <div class="panel-body">${bodyHtml}</div>
      ${footerHtml ? `<div class="panel-footer">${footerHtml}</div>` : ''}
    `;
    panel.querySelector('[data-close]')!.addEventListener('click', () => {
      this.closePanel();
      this.cb.onClosePanel();
    });
    this.roots.panels.appendChild(panel);
    this.panelBody = panel.querySelector('.panel-body');
    this.panelTitle = panel.querySelector('h2');
    return panel;
  }

  closePanel(): void {
    const existing = this.roots.panels.querySelector('.panel');
    if (existing) existing.remove();
    this.activePanel = null;
    this.openPanelName = null;
    this.mapCanvas = null;
    this.panelBody = null;
  }

  get isPanelOpen(): boolean {
    return this.activePanel !== null;
  }

  // ---- new world ----
  openNewWorldPanel(): void {
    const seed = Math.floor(Math.random() * 1e9);
    const panel = this.openPanel(
      'new',
      'New World',
      `
      <label class="field">
        <div class="label-row"><span>World name</span></div>
        <input type="text" id="nw-name" value="Eden ${new Date().toLocaleDateString()}" maxlength="40"/>
      </label>
      <label class="field">
        <div class="label-row"><span>Seed</span></div>
        <div style="display:flex; gap:8px">
          <input type="text" id="nw-seed" value="${seed}"/>
          <button class="btn" id="nw-reroll">${icon('refresh', 15)}</button>
        </div>
      </label>
      <div class="section-title">Terrain</div>
      <label class="field">
        <div class="label-row"><span>Mountain intensity</span><span class="value" id="v-mount">1.0</span></div>
        <input type="range" id="nw-mount" min="0.4" max="1.6" step="0.1" value="1"/>
      </label>
      <label class="field">
        <div class="label-row"><span>Water abundance</span><span class="value" id="v-water">1.0</span></div>
        <input type="range" id="nw-water" min="0.4" max="1.6" step="0.1" value="1"/>
      </label>
      <div class="section-title">Life & landscape</div>
      <label class="field">
        <div class="label-row"><span>Forest density</span><span class="value" id="v-forest">1.0</span></div>
        <input type="range" id="nw-forest" min="0.2" max="1.8" step="0.1" value="1"/>
      </label>
      <label class="field">
        <div class="label-row"><span>Wildlife abundance</span><span class="value" id="v-wild">1.0</span></div>
        <input type="range" id="nw-wild" min="0.2" max="1.8" step="0.1" value="1"/>
      </label>
      <label class="field">
        <div class="label-row"><span>Settlement density</span><span class="value" id="v-settle">1.0</span></div>
        <input type="range" id="nw-settle" min="0.2" max="1.8" step="0.1" value="1"/>
      </label>
      <label class="field">
        <div class="label-row"><span>Climate bias</span><span class="value" id="v-climate">0.0</span></div>
        <input type="range" id="nw-climate" min="-1" max="1" step="0.1" value="0"/>
      </label>
      `,
      `<button class="btn" data-cancel>Cancel</button><button class="btn btn-primary" id="nw-create">${icon('plus', 15)} Create World</button>`,
    );

    const bind = (id: string, out: string, fmt: (v: number) => string = (v) => v.toFixed(1)) => {
      const input = panel.querySelector(`#${id}`) as HTMLInputElement;
      const label = panel.querySelector(`#${out}`)!;
      input.addEventListener('input', () => (label.textContent = fmt(parseFloat(input.value))));
    };
    bind('nw-mount', 'v-mount');
    bind('nw-water', 'v-water');
    bind('nw-forest', 'v-forest');
    bind('nw-wild', 'v-wild');
    bind('nw-settle', 'v-settle');
    bind('nw-climate', 'v-climate', (v) => v.toFixed(1));

    panel.querySelector('#nw-reroll')!.addEventListener('click', () => {
      (panel.querySelector('#nw-seed') as HTMLInputElement).value = String(Math.floor(Math.random() * 1e9));
    });
    panel.querySelector('[data-cancel]')!.addEventListener('click', () => this.closePanel());
    panel.querySelector('#nw-create')!.addEventListener('click', () => {
      const name = (panel.querySelector('#nw-name') as HTMLInputElement).value || 'Eden';
      const seedStr = (panel.querySelector('#nw-seed') as HTMLInputElement).value;
      const seedNum = /^\d+$/.test(seedStr) ? parseInt(seedStr, 10) : hashStr(seedStr);
      this.cb.onNewWorld({
        seed: seedNum,
        name,
        mountainIntensity: parseFloat((panel.querySelector('#nw-mount') as HTMLInputElement).value),
        waterAbundance: parseFloat((panel.querySelector('#nw-water') as HTMLInputElement).value),
        forestDensity: parseFloat((panel.querySelector('#nw-forest') as HTMLInputElement).value),
        wildlifeAbundance: parseFloat((panel.querySelector('#nw-wild') as HTMLInputElement).value),
        settlementDensity: parseFloat((panel.querySelector('#nw-settle') as HTMLInputElement).value),
        climate: parseFloat((panel.querySelector('#nw-climate') as HTMLInputElement).value),
      });
    });
  }

  // ---- saves ----
  openSavesPanel(mode: 'load' | 'gallery', slots: SaveSlotMeta[] = []): void {
    const canManage = mode === 'gallery';
    const panel = this.openPanel(
      'saves',
      canManage ? 'World Gallery' : 'Load World',
      `<div class="slot-list" id="slot-list">
        <div class="empty-state">${icon('folder', 38)}<div>Loading saved worlds…</div></div>
      </div>`,
      canManage
        ? `<button class="btn" id="sv-import">${icon('upload', 15)} Import</button>
           <button class="btn" id="sv-export">${icon('download', 15)} Export current</button>
           <button class="btn btn-primary" id="sv-new">${icon('plus', 15)} New World</button>`
        : `<button class="btn" data-cancel>Cancel</button>`,
    );

    const renderSlots = (list: SaveSlotMeta[]) => {
      const el = panel.querySelector('#slot-list')!;
      if (list.length === 0) {
        el.innerHTML = `<div class="empty-state">${icon('folder', 38)}<div>No saved worlds yet.<br/>Create one and it will appear here.</div></div>`;
        return;
      }
      el.innerHTML = list
        .map(
          (s) => `
        <div class="slot-card" data-id="${s.id}">
          <div class="slot-icon">${icon('cube', 20)}</div>
          <div class="slot-info">
            <div class="slot-name">${escapeHtml(s.name)}</div>
            <div class="slot-meta">seed ${s.seed} · day ${s.worldDay} · ${formatDuration(s.playSeconds)} · ${(s.sizeBytes / 1024).toFixed(0)} KB · ${new Date(s.updated).toLocaleString()}</div>
          </div>
          <div class="slot-actions">
            <button class="btn btn-sm" data-load="${s.id}">${icon('play', 13)} Load</button>
            <button class="btn btn-sm" data-export="${s.id}" title="Export">${icon('download', 13)}</button>
            <button class="btn btn-sm btn-danger" data-delete="${s.id}" title="Delete">${icon('trash', 13)}</button>
          </div>
        </div>`,
        )
        .join('');
    };
    renderSlots(slots);

    panel.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const load = t.closest('[data-load]') as HTMLElement | null;
      const del = t.closest('[data-delete]') as HTMLElement | null;
      const exp = t.closest('[data-export]') as HTMLElement | null;
      if (load) {
        this.cb.onLoadSlot(load.dataset.load!);
      } else if (del) {
        if (confirm('Delete this save permanently?')) this.cb.onDeleteSlot(del.dataset.delete!);
      } else if (exp) {
        this.cb.onExportWorld();
      }
    });
    panel.querySelector('[data-cancel]')?.addEventListener('click', () => this.closePanel());
    panel.querySelector('#sv-new')?.addEventListener('click', () => this.openNewWorldPanel());
    panel.querySelector('#sv-import')?.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json';
      input.addEventListener('change', () => {
        if (input.files?.[0]) this.cb.onImportWorld(input.files[0]);
      });
      input.click();
    });
    panel.querySelector('#sv-export')?.addEventListener('click', () => this.cb.onExportWorld());

    // Engine refreshes the list asynchronously via updateSaveSlots.
    this._slotRenderer = renderSlots;
  }

  private _slotRenderer: ((slots: SaveSlotMeta[]) => void) | null = null;

  updateSaveSlots(slots: SaveSlotMeta[]): void {
    this._slotRenderer?.(slots);
  }

  // ---- settings ----
  openSettingsPanel(inGame = false): void {
    const s = this.settings;
    const panel = this.openPanel(
      'settings',
      'Settings',
      `
      <div class="section-title">Graphics</div>
      <div class="setting-row">
        <div class="desc"><div class="title">Quality preset</div><div class="sub">Balances detail against performance</div></div>
        <div class="control">
          <div class="seg" id="set-quality">
            ${(['low', 'medium', 'high', 'ultra', 'custom'] as const).map((q) => `<button data-q="${q}" class="${s.quality === q ? 'active' : ''}">${q[0].toUpperCase() + q.slice(1)}</button>`).join('')}
          </div>
        </div>
      </div>
      <div class="setting-row">
        <div class="desc"><div class="title">Render distance</div><div class="sub">How far terrain and vegetation draw</div></div>
        <div class="control"><input type="range" id="set-distance" min="320" max="1280" step="40" value="${s.renderDistance}"/><span class="value" id="v-distance">${s.renderDistance}m</span></div>
      </div>
      <div class="setting-row">
        <div class="desc"><div class="title">Foliage density</div><div class="sub">Trees, bushes and grass coverage</div></div>
        <div class="control"><input type="range" id="set-foliage" min="0.3" max="1.6" step="0.1" value="${s.foliage}"/></div>
      </div>
      <div class="setting-row">
        <div class="desc"><div class="title">Post-processing</div><div class="sub">Bloom and tone mapping</div></div>
        <div class="control"><div class="seg" id="set-post">
          <button data-p="on" class="${s.postProcessing ? 'active' : ''}">On</button>
          <button data-p="off" class="${!s.postProcessing ? 'active' : ''}">Off</button>
        </div></div>
      </div>
      <div class="section-title">Simulation</div>
      <div class="setting-row">
        <div class="desc"><div class="title">Simulation density</div><div class="sub">How many agents simulate in detail</div></div>
        <div class="control"><input type="range" id="set-sim" min="0.4" max="1.6" step="0.1" value="${s.simulationDensity}"/></div>
      </div>
      <div class="setting-row">
        <div class="desc"><div class="title">Survival needs</div><div class="sub">Hunger, thirst and health for the player</div></div>
        <div class="control"><div class="seg" id="set-survival">
          <button data-v="on" class="${s.survival ? 'active' : ''}">On</button>
          <button data-v="off" class="${!s.survival ? 'active' : ''}">Off</button>
        </div></div>
      </div>
      <div class="setting-row">
        <div class="desc"><div class="title">Autosave</div><div class="sub">Minutes between automatic saves</div></div>
        <div class="control">
          <select id="set-autosave">
            ${[2, 5, 10, 15, 30].map((m) => `<option value="${m}" ${s.autosaveMinutes === m ? 'selected' : ''}>${m} min</option>`).join('')}
            <option value="0" ${s.autosaveMinutes === 0 ? 'selected' : ''}>Off</option>
          </select>
        </div>
      </div>
      <div class="section-title">Audio</div>
      <div class="setting-row">
        <div class="desc"><div class="title">Master volume</div></div>
        <div class="control"><input type="range" id="set-master" min="0" max="1" step="0.05" value="${s.masterVolume}"/></div>
      </div>
      <div class="setting-row">
        <div class="desc"><div class="title">Ambience</div></div>
        <div class="control"><input type="range" id="set-amb" min="0" max="1" step="0.05" value="${s.ambienceVolume}"/></div>
      </div>
      <div class="setting-row">
        <div class="desc"><div class="title">Effects</div></div>
        <div class="control"><input type="range" id="set-eff" min="0" max="1" step="0.05" value="${s.effectsVolume}"/></div>
      </div>
      <div class="setting-row">
        <div class="desc"><div class="title">Mute all</div></div>
        <div class="control"><div class="seg" id="set-mute">
          <button data-v="on" class="${s.muted ? 'active' : ''}">Muted</button>
          <button data-v="off" class="${!s.muted ? 'active' : ''}">Sound</button>
        </div></div>
      </div>
      <div class="section-title">Camera & interface</div>
      <div class="setting-row">
        <div class="desc"><div class="title">Field of view</div></div>
        <div class="control"><input type="range" id="set-fov" min="55" max="100" step="1" value="${s.fov}"/></div>
      </div>
      <div class="setting-row">
        <div class="desc"><div class="title">Mouse sensitivity</div></div>
        <div class="control"><input type="range" id="set-sens" min="0.3" max="2.5" step="0.1" value="${s.sensitivity}"/></div>
      </div>
      <div class="setting-row">
        <div class="desc"><div class="title">Invert vertical look</div></div>
        <div class="control"><div class="seg" id="set-invy">
          <button data-v="on" class="${s.invertY ? 'active' : ''}">Inverted</button>
          <button data-v="off" class="${!s.invertY ? 'active' : ''}">Normal</button>
        </div></div>
      </div>
      <div class="setting-row">
        <div class="desc"><div class="title">Show minimap</div></div>
        <div class="control"><div class="seg" id="set-minimap">
          <button data-v="on" class="${s.showMinimap ? 'active' : ''}">Show</button>
          <button data-v="off" class="${!s.showMinimap ? 'active' : ''}">Hide</button>
        </div></div>
      </div>
      `,
      inGame
        ? `<button class="btn btn-danger" id="set-mainmenu">Main Menu</button><button class="btn btn-primary" data-close-btn>Done</button>`
        : `<button class="btn btn-primary" data-close-btn>Done</button>`,
    );

    const q = panel.querySelector('#set-quality')!;
    q.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('[data-q]') as HTMLElement | null;
      if (!b) return;
      q.querySelectorAll('button').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      this.cb.onSettingChange('quality', b.dataset.q);
    });

    const range = (id: string, key: string, fmt?: (v: number) => string) => {
      const el = panel.querySelector(`#${id}`) as HTMLInputElement;
      el.addEventListener('input', () => {
        const v = parseFloat(el.value);
        if (fmt) {
          const out = panel.querySelector(`#v-${id.split('-')[1]}`);
          if (out) out.textContent = fmt(v);
        }
        this.cb.onSettingChange(key, v);
      });
    };
    range('set-distance', 'renderDistance', (v) => `${v}m`);
    range('set-foliage', 'foliage');
    range('set-sim', 'simulationDensity');
    range('set-master', 'masterVolume');
    range('set-amb', 'ambienceVolume');
    range('set-eff', 'effectsVolume');
    range('set-fov', 'fov');
    range('set-sens', 'sensitivity');

    const seg = (id: string, key: string, map: (v: string) => unknown) => {
      const el = panel.querySelector(`#${id}`);
      el?.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest('[data-v],[data-p]') as HTMLElement | null;
        if (!b) return;
        el.querySelectorAll('button').forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        this.cb.onSettingChange(key, map(b.dataset.v ?? b.dataset.p ?? ''));
      });
    };
    seg('set-post', 'postProcessing', (v) => v === 'on');
    seg('set-survival', 'survival', (v) => v === 'on');
    seg('set-mute', 'muted', (v) => v === 'on');
    seg('set-invy', 'invertY', (v) => v === 'on');
    seg('set-minimap', 'showMinimap', (v) => v === 'on');

    panel.querySelector('#set-autosave')?.addEventListener('change', (e) => {
      this.cb.onSettingChange('autosaveMinutes', parseInt((e.target as HTMLSelectElement).value, 10));
    });
    panel.querySelector('#set-mainmenu')?.addEventListener('click', () => {
      this.cb.onSettingChange('toMainMenu', true);
    });
    panel.querySelector('[data-close-btn]')?.addEventListener('click', () => {
      this.closePanel();
      this.cb.onClosePanel();
    });
  }

  // ---- controls ----
  openControlsPanel(): void {
    const rows: Array<[string, string]> = [
      ['Move', 'W A S D'],
      ['Look', 'Mouse'],
      ['Jump', 'Space'],
      ['Sprint', 'Shift'],
      ['Crouch / descend', 'Ctrl'],
      ['Interact', 'E'],
      ['Secondary action', 'F'],
      ['Inventory / status', 'Tab'],
      ['World map', 'M'],
      ['Inspect target', 'I'],
      ['Build & terrain tools', 'B'],
      ['World statistics', 'N'],
      ['Camera mode', 'C'],
      ['God mode', 'G'],
      ['Debug overlay', 'F3'],
      ['Time speed', '0 / 1 / 2 / 3 / 4'],
      ['Quick tools', '1 – 8'],
      ['Pause / back', 'Esc'],
      ['Undo terrain edit', 'Ctrl+Z'],
      ['Rotate building', 'R / mouse wheel'],
    ];
    this.openPanel(
      'controls',
      'Controls',
      `
      <p style="color:var(--text-dim); margin-bottom:16px; font-size:12.5px">
        Standard keyboard & mouse layout. Gamepad and touch are supported where practical.
        Pointer lock activates when you click the world.
      </p>
      <div class="keys-grid">
        ${rows.map(([a, b]) => `<div class="key-row"><span>${a}</span><span class="keycap">${b}</span></div>`).join('')}
      </div>
      <div class="section-title">Camera modes</div>
      <p style="color:var(--text-dim); font-size:12.5px">
        Third person (default) · first person · free-fly observer · city overview.
        Cycle with <b>C</b>. The free camera ignores terrain and is ideal for watching the world.
      </p>
      `,
    );
  }

  // ---- credits ----
  openCreditsPanel(): void {
    this.openPanel(
      'credits',
      'Credits & Acknowledgments',
      `
      <div class="section-title">EDEN</div>
      <p style="color:var(--text-dim); font-size:12.5px; margin-bottom:14px">
        A living world sandbox designed and built as an independent, non-commercial project.
        Every terrain, texture, model, animation and sound in the game is generated
        procedurally at runtime — there are no third-party asset files to license.
      </p>
      <div class="section-title">Technology</div>
      <div class="entity-list">
        <div class="entity-row"><div class="dot"></div><div class="name">Three.js</div><div class="detail">Rendering (MIT License)</div></div>
        <div class="entity-row"><div class="dot"></div><div class="name">Vite</div><div class="detail">Build tooling (MIT License)</div></div>
        <div class="entity-row"><div class="dot"></div><div class="name">TypeScript</div><div class="detail">Language (Apache-2.0)</div></div>
        <div class="entity-row"><div class="dot"></div><div class="name">Web Audio API</div><div class="detail">Procedural soundscape</div></div>
      </div>
      <div class="section-title">Design inspirations</div>
      <p style="color:var(--text-dim); font-size:12.5px">
        Broadly inspired by the sandbox, life-sim, wilderness and city-building genres.
        No proprietary assets, names or content from other games are used.
      </p>
      <div class="section-title">Asset manifest</div>
      <p style="color:var(--text-dim); font-size:12.5px">
        All runtime assets are procedural (see docs/ASSETS.md in the repository).
        Texture, model and audio generators live in <code>src/render/textures.ts</code>,
        <code>src/sim/models.ts</code> and <code>src/audio/audio.ts</code>.
      </p>
      `,
    );
  }

  // ---- stats ----
  openStatsPanel(stats?: WorldStats, events?: WorldEvent[]): void {
    const panel = this.openPanel('stats', 'World Statistics', `<div id="stats-live">Gathering world data…</div>`);
    if (stats) this.updateStats(stats, events ?? []);
    panel.dataset.live = '1';
  }

  updateStats(stats: WorldStats, events: WorldEvent[]): void {
    const el = document.getElementById('stats-live');
    if (!el) return;
    const speciesRows = Object.entries(stats.populationBySpecies)
      .sort((a, b) => b[1] - a[1])
      .map(([sp, n]) => `<div class="entity-row"><div class="dot" style="background:${n > 0 ? 'var(--green)' : 'var(--red)'}"></div><div class="name">${sp}</div><div class="detail">${n}</div></div>`)
      .join('');
    const eventRows = events
      .slice(-14)
      .reverse()
      .map(
        (e) => `
        <div class="entity-row">
          <div class="dot" style="background:${e.kind === 'danger' ? 'var(--red)' : e.kind === 'ecology' ? 'var(--green)' : e.kind === 'settlement' ? 'var(--blue)' : 'var(--accent)'}"></div>
          <div class="name" style="font-size:12px">${escapeHtml(e.text)}</div>
          <div class="detail">day ${e.day}</div>
        </div>`,
      )
      .join('');

    el.innerHTML = `
      <div class="stat-grid">
        <div class="stat-card"><div class="stat-label">World age</div><div class="stat-value">${stats.worldAgeDays}</div><div class="stat-sub">days · ${stats.season}</div></div>
        <div class="stat-card"><div class="stat-label">Population</div><div class="stat-value">${stats.citizenCount}</div><div class="stat-sub">${stats.citizenBirths} births · ${stats.citizenDeaths} deaths</div></div>
        <div class="stat-card"><div class="stat-label">Wildlife</div><div class="stat-value">${stats.animalCount}</div><div class="stat-sub">${stats.animalBirths} births · ${stats.animalDeaths} deaths</div></div>
        <div class="stat-card"><div class="stat-label">Predators / prey</div><div class="stat-value">${stats.predatorCount} / ${stats.preyCount}</div><div class="stat-sub">live counts</div></div>
        <div class="stat-card"><div class="stat-label">Settlements</div><div class="stat-value">${stats.settlementCount}</div><div class="stat-sub">${stats.settlementNames.join(', ') || '—'}</div></div>
        <div class="stat-card"><div class="stat-label">Food stores</div><div class="stat-value">${formatNumber(stats.totalFood)}</div><div class="stat-sub">across settlements</div></div>
        <div class="stat-card"><div class="stat-label">Prosperity</div><div class="stat-value">${Math.round(stats.totalProsperity * 100)}%</div><div class="stat-sub">pollution ${Math.round(stats.pollution * 100)}%</div></div>
        <div class="stat-card"><div class="stat-label">Rain (24h)</div><div class="stat-value">${stats.rainLast24h.toFixed(1)}</div><div class="stat-sub">game hours · balance ${stats.hydroBalance.toFixed(2)}</div></div>
        <div class="stat-card"><div class="stat-label">Water quality</div><div class="stat-value">${Math.round(stats.averageWaterQuality * 100)}%</div><div class="stat-sub">window average</div></div>
        <div class="stat-card"><div class="stat-label">Trees (loaded)</div><div class="stat-value">${formatNumber(stats.treeCount)}</div><div class="stat-sub">in active chunks</div></div>
        <div class="stat-card"><div class="stat-label">Terrain edits</div><div class="stat-value">${formatNumber(stats.editedCells)}</div><div class="stat-sub">modified cells</div></div>
        <div class="stat-card"><div class="stat-label">Frame rate</div><div class="stat-value">${formatNumber(stats.fps, 0)}</div><div class="stat-sub">fps · ${stats.weather}</div></div>
      </div>
      <div class="section-title">Population by species</div>
      <div class="entity-list">${speciesRows || '<div class="empty-state">No wildlife yet.</div>'}</div>
      <div class="section-title">World event log</div>
      <div class="entity-list">${eventRows || '<div class="empty-state">The world is quiet… for now.</div>'}</div>
    `;
  }

  // ---- map ----
  openMapPanel(): HTMLElement {
    const panel = this.openPanel(
      'map',
      'World Map',
      `
      <div class="map-wrap"><canvas id="world-map-canvas"></canvas></div>
      <div class="map-controls">
        <button class="btn btn-sm" id="map-center">${icon('compass', 14)} Center on player</button>
        <button class="btn btn-sm" id="map-waypoint">${icon('flag', 14)} Add waypoint at centre</button>
        <button class="btn btn-sm" id="map-zoom-in">${icon('plus', 14)}</button>
        <button class="btn btn-sm" id="map-zoom-out">−</button>
      </div>
      <div class="map-legend">
        <div class="legend-item"><div class="legend-swatch" style="background:#2c5484"></div>Deep water</div>
        <div class="legend-item"><div class="legend-swatch" style="background:#2a5c80"></div>Shallow water</div>
        <div class="legend-item"><div class="legend-swatch" style="background:#769c5c"></div>Grassland</div>
        <div class="legend-item"><div class="legend-swatch" style="background:#487644"></div>Forest</div>
        <div class="legend-item"><div class="legend-swatch" style="background:#c6ac76"></div>Desert / beach</div>
        <div class="legend-item"><div class="legend-swatch" style="background:#a8a8a4"></div>Alpine</div>
        <div class="legend-item"><div class="legend-swatch" style="background:#d8a24a"></div>Settlement</div>
        <div class="legend-item"><div class="legend-swatch" style="background:#7ec98f"></div>Discovery</div>
      </div>
      `,
    );
    this.mapCanvas = panel.querySelector('#world-map-canvas');
    panel.querySelector('#map-center')!.addEventListener('click', () => this.cb.onSettingChange('mapCenter', true));
    panel.querySelector('#map-waypoint')!.addEventListener('click', () => this.cb.onSettingChange('mapWaypoint', true));
    panel.querySelector('#map-zoom-in')!.addEventListener('click', () => this.cb.onSettingChange('mapZoom', 0.8));
    panel.querySelector('#map-zoom-out')!.addEventListener('click', () => this.cb.onSettingChange('mapZoom', 1.25));
    return panel;
  }

  // ---- pause menu ----
  openPauseMenu(): void {
    const panel = this.openPanel(
      'pause',
      'Paused',
      `
      <div class="entity-list">
        <div class="entity-row" data-pa="resume"><div class="dot" style="background:var(--accent)"></div><div class="name">Resume</div><div class="detail">Esc</div></div>
        <div class="entity-row" data-pa="save"><div class="dot"></div><div class="name">Save world</div><div class="detail">Write to browser storage</div></div>
        <div class="entity-row" data-pa="settings"><div class="dot"></div><div class="name">Settings</div><div class="detail">Graphics · audio · gameplay</div></div>
        <div class="entity-row" data-pa="controls"><div class="dot"></div><div class="name">Controls</div><div class="detail">Key bindings</div></div>
        <div class="entity-row" data-pa="export"><div class="dot"></div><div class="name">Export world</div><div class="detail">Download portable save</div></div>
        <div class="entity-row" data-pa="god"><div class="dot" style="background:var(--accent)"></div><div class="name">God tools</div><div class="detail">Weather, time, spawns (G)</div></div>
        <div class="entity-row" data-pa="menu"><div class="dot" style="background:var(--red)"></div><div class="name">Return to main menu</div><div class="detail">World keeps its last autosave</div></div>
      </div>
      `,
    );
    panel.addEventListener('click', (e) => {
      const row = (e.target as HTMLElement).closest('[data-pa]') as HTMLElement | null;
      if (!row) return;
      switch (row.dataset.pa) {
        case 'resume': this.closePanel(); this.cb.onResume(); break;
        case 'save': this.cb.onSaveNow(); this.toast('World saved.', 'settlement'); break;
        case 'settings': this.openSettingsPanel(true); break;
        case 'controls': this.openControlsPanel(); break;
        case 'export': this.cb.onExportWorld(); break;
        case 'god': this.closePanel(); this.cb.onGodAction('toggle'); break;
        case 'menu': this.cb.onSettingChange('toMainMenu', true); break;
      }
    });
  }

  // ---- inspector ----
  showInspector(data: {
    title: string;
    kind: string;
    rows: Array<[string, string]>;
    actions?: Array<{ id: string; label: string }>;
    onAction?: (id: string) => void;
    onClose?: () => void;
  }): void {
    this.hideInspector();
    const el = document.createElement('div');
    el.className = 'inspector';
    el.innerHTML = `
      <h3>${escapeHtml(data.title)}</h3>
      <div class="kind">${escapeHtml(data.kind)}</div>
      ${data.rows.map(([k, v]) => `<div class="row"><span class="k">${escapeHtml(k)}</span><span>${escapeHtml(v)}</span></div>`).join('')}
      ${data.actions ? `<div class="actions">${data.actions.map((a) => `<button class="btn btn-sm" data-act="${a.id}">${escapeHtml(a.label)}</button>`).join('')}</div>` : ''}
      <div class="actions"><button class="btn btn-sm" data-act="close">Close</button></div>
    `;
    el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
      if (!b) return;
      if (b.dataset.act === 'close') {
        this.hideInspector();
        data.onClose?.();
      } else {
        data.onAction?.(b.dataset.act!);
      }
    });
    document.getElementById('hud-root')!.appendChild(el);
    this.inspectorEl = el;
  }

  hideInspector(): void {
    this.inspectorEl?.remove();
    this.inspectorEl = null;
  }

  // ---- god bar ----
  toggleGodBar(show: boolean, onAction: (action: string, value?: unknown) => void): void {
    if (!show) {
      this.godEl?.remove();
      this.godEl = null;
      return;
    }
    if (this.godEl) {
      this.godEl.remove();
      this.godEl = null;
      return;
    }
    const el = document.createElement('div');
    el.className = 'god-bar';
    el.innerHTML = `
      <h3>${icon('god', 13)} God tools</h3>
      <div class="god-grid">
        <button class="btn btn-sm" data-g="weather:clear">Clear sky</button>
        <button class="btn btn-sm" data-g="weather:thunderstorm">Storm</button>
        <button class="btn btn-sm" data-g="weather:snow">Snow</button>
        <button class="btn btn-sm" data-g="weather:heatwave">Heatwave</button>
        <button class="btn btn-sm" data-g="time:day">Set noon</button>
        <button class="btn btn-sm" data-g="time:night">Set midnight</button>
        <button class="btn btn-sm" data-g="spawn:deer">Spawn deer</button>
        <button class="btn btn-sm" data-g="spawn:wolf">Spawn wolf</button>
        <button class="btn btn-sm" data-g="event:drought">Drought</button>
        <button class="btn btn-sm" data-g="event:rain">Heavy rain</button>
        <button class="btn btn-sm" data-g="speed:64">Fast forward</button>
        <button class="btn btn-sm" data-g="speed:0">Pause</button>
      </div>
      <p style="font-size:10.5px; color:var(--text-faint); margin-top:9px">Every action is validated — invalid commands are refused safely.</p>
    `;
    el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('[data-g]') as HTMLElement | null;
      if (!b) return;
      const [action, value] = b.dataset.g!.split(':');
      onAction(action, value);
    });
    this.roots.hud.appendChild(el);
    this.godEl = el;
  }

  // ---- toasts ----
  toast(message: string, kind: 'info' | 'ecology' | 'danger' | 'settlement' | 'discovery' = 'info', ttl = 6200): void {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    const iconName = kind === 'danger' ? 'alert' : kind === 'ecology' ? 'leaf' : kind === 'settlement' ? 'home' : kind === 'discovery' ? 'compass' : 'info';
    el.innerHTML = `${icon(iconName, 15)}<div>${escapeHtml(message)}</div>`;
    this.roots.toasts.appendChild(el);
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 550);
    }, ttl);
    // Keep the stack bounded
    while (this.roots.toasts.children.length > 5) this.roots.toasts.firstChild?.remove();
  }

  // ---- debug ----
  setDebug(show: boolean): void {
    if (!show) {
      this.debugEl?.remove();
      this.debugEl = null;
      return;
    }
    if (!this.debugEl) {
      const el = document.createElement('div');
      el.className = 'debug-overlay';
      this.roots.hud.appendChild(el);
      this.debugEl = el;
    }
  }

  updateDebug(lines: Array<[string, string]>): void {
    if (!this.debugEl) return;
    this.debugEl.innerHTML = lines.map(([k, v]) => `<div class="row"><span class="dim">${k}</span><span>${v}</span></div>`).join('');
  }

  // ---- welcome card ----
  showWelcome(onClose: () => void): void {
    const el = document.createElement('div');
    el.className = 'welcome-card';
    el.innerHTML = `
      <h2>Welcome to your world</h2>
      <p>A fresh landscape is already alive: rivers run, weather turns, animals graze and a settlement of people is going about their day.</p>
      <div class="hints">
        <div class="hint"><span class="keycap">WASD</span> Move</div>
        <div class="hint"><span class="keycap">Mouse</span> Look</div>
        <div class="hint"><span class="keycap">E</span> Interact</div>
        <div class="hint"><span class="keycap">B</span> Build & sculpt</div>
        <div class="hint"><span class="keycap">M</span> World map</div>
        <div class="hint"><span class="keycap">N</span> World statistics</div>
        <div class="hint"><span class="keycap">C</span> Camera</div>
        <div class="hint"><span class="keycap">Esc</span> Menu</div>
      </div>
      <p style="font-size:12px; color:var(--text-faint)">Find the settlement on your map and follow a villager through their day — or head for the wilderness and watch the herds.</p>
      <div style="display:flex; justify-content:flex-end; margin-top:18px">
        <button class="btn btn-primary" id="welcome-go">Begin exploring</button>
      </div>
    `;
    el.querySelector('#welcome-go')!.addEventListener('click', () => {
      el.remove();
      onClose();
    });
    document.getElementById('hud-root')!.appendChild(el);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
