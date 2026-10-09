/**
 * Acceptance probe: save round-trip size and consistency measurements.
 * Run: npx vite-node scripts/presave.ts
 */
import { buildExportFile, parseExportFile, validateSave, SAVE_VERSION, type WorldSave } from '../src/persistence/save.ts';
import { TerrainEdits } from '../src/world/terrainEdits.ts';
import { defaultWorldConfig } from '../src/world/types.ts';

const edits = new TerrainEdits();
for (let i = 0; i < 50; i++) {
  edits.applyBrush(i * 6 - 150, (i * 13) % 200 - 100, 10, 1.2, 'raise', () => 20);
}
const probeX = -150, probeZ = -100; // brush centre of i=0
const save: WorldSave = {
  version: SAVE_VERSION,
  meta: { name: 'Probe', seed: 1, created: 1, updated: 2, playSeconds: 3600 },
  config: defaultWorldConfig(1),
  clock: { hours: 100, speed: 1 },
  weather: { kind: 'fair', state: { kind: 'fair', cloudCover: 0.3, precipitation: 0, windStrength: 0.3, windAngle: 1, fogAmount: 0.1, tempOffset: 0, storm: 0, hydroBalance: 1 }, hoursLeft: 6 },
  hydro: { waterBalance: 1 },
  terrainEdits: edits.serialize(),
  vegetation: { planted: [], removed: [] },
  simulation: { clock: { hours: 100, speed: 1 } },
  player: { x: 0, y: 20, z: 0, yaw: 0, pitch: 0, health: 100, stamina: 100, hunger: 90, thirst: 90, warmth: 80, cameraMode: 'third', thirdDistance: 7 },
  discoveries: [],
};

const text = buildExportFile(save);
console.log(`export size: ${(text.length / 1024).toFixed(1)} kB for ${edits.cellCount} edit cells`);

const { save: parsed, error } = parseExportFile(text);
if (error) throw new Error('round-trip failed: ' + error);
const { result } = validateSave(parsed);
console.log('validateSave:', result.ok ? 'ok' : result.errors);
const restored = TerrainEdits.deserialize(parsed!.terrainEdits);
console.log(`edit cells after round-trip: ${restored.cellCount} (was ${edits.cellCount})`);
console.log(`sample delta: ${restored.deltaAt(probeX, probeZ).toFixed(3)} vs ${edits.deltaAt(probeX, probeZ).toFixed(3)}`);
