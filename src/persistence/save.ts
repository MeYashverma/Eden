/**
 * World serialization: versioned save schema with migration hooks,
 * corruption-safe loading, and portable export/import files.
 *
 * Save contents are the meaningful state only — seed, time, weather, terrain
 * deltas, settlements, agents, vegetation edits, events, player and settings.
 * Transient particles/animations are never written.
 */

import type { SaveSlotMeta } from './db';
import { TerrainEdits } from '../world/terrainEdits';
import type { PlayerState } from '../player/player';
import type { WorldGenConfig } from '../world/types';
import type { Discovery } from '../core/discoveries';

export const SAVE_VERSION = 2;

export interface WorldSave {
  version: number;
  meta: {
    name: string;
    seed: number;
    created: number;
    updated: number;
    playSeconds: number;
  };
  config: WorldGenConfig;
  clock: { hours: number; speed: number };
  weather: unknown;
  hydro: unknown;
  terrainEdits: { d: number[]; p: number[] };
  vegetation: { planted: unknown[]; removed: number[] };
  simulation: unknown;
  player: PlayerState;
  discoveries: Discovery[];
  settings?: Record<string, unknown>;
}

export interface SaveValidation {
  ok: boolean;
  errors: string[];
  migrated?: boolean;
}

/** Validate a parsed object as a WorldSave, migrating older versions. */
export function validateSave(raw: unknown): { save: WorldSave | null; result: SaveValidation } {
  const errors: string[] = [];
  if (typeof raw !== 'object' || raw === null) {
    return { save: null, result: { ok: false, errors: ['Not a save object'] } };
  }
  let obj = raw as Record<string, unknown>;
  let migrated = false;

  const version = typeof obj.version === 'number' ? obj.version : 0;
  if (version > SAVE_VERSION) {
    return { save: null, result: { ok: false, errors: [`Save version ${version} is newer than supported ${SAVE_VERSION}`] } };
  }
  if (version < 2) {
    // v1 → v2: terrain edits format {deltas} → {d, p}
    if (obj.terrainEdits && typeof obj.terrainEdits === 'object') {
      const te = obj.terrainEdits as Record<string, unknown>;
      if (!('d' in te) && 'deltas' in te) {
        obj = {
          ...obj,
          version: 2,
          terrainEdits: { d: te.deltas as number[], p: (te.paint as number[]) ?? [] },
        };
        migrated = true;
      }
    }
  }

  const s = obj as unknown as WorldSave;
  if (typeof s.meta?.seed !== 'number') errors.push('Missing seed');
  if (!s.config) errors.push('Missing world config');
  if (!s.clock || typeof s.clock.hours !== 'number') errors.push('Missing clock');
  if (!s.player || typeof s.player.x !== 'number') errors.push('Missing player state');
  if (!s.terrainEdits) errors.push('Missing terrain edits');

  if (errors.length > 0) return { save: null, result: { ok: false, errors } };
  s.version = SAVE_VERSION;
  return { save: s, result: { ok: true, errors: [], migrated } };
}

/** Rehydrate terrain edits from save data. */
export function restoreEdits(data: { d: number[]; p: number[] } | undefined): TerrainEdits {
  return TerrainEdits.deserialize(data);
}

/** Build the export envelope (portable JSON). */
export function buildExportFile(save: WorldSave): string {
  const envelope = {
    format: 'eden-world-export',
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    save,
  };
  return JSON.stringify(envelope);
}

export function parseExportFile(text: string): { save: WorldSave | null; error: string | null } {
  try {
    const envelope = JSON.parse(text) as { format?: string; save?: unknown };
    if (envelope.format !== 'eden-world-export' && envelope.format !== undefined) {
      return { save: null, error: 'Not an EDEN export file.' };
    }
    const candidate = envelope.save ?? envelope;
    const { save, result } = validateSave(candidate);
    if (!save) return { save: null, error: result.errors.join('; ') };
    return { save, error: null };
  } catch (err) {
    return { save: null, error: err instanceof Error ? err.message : 'Corrupt export file.' };
  }
}

/** Compress with deflate-raw when the platform supports it (optional). */
export async function maybeCompress(text: string): Promise<Blob> {
  if (typeof CompressionStream !== 'undefined') {
    try {
      const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'));
      return await new Response(stream).blob();
    } catch {
      /* fall through */
    }
  }
  return new Blob([text], { type: 'application/json' });
}

export async function maybeDecompress(blob: Blob): Promise<string> {
  if (typeof DecompressionStream !== 'undefined') {
    try {
      const stream = blob.stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return await new Response(stream).text();
    } catch {
      /* not compressed */
    }
  }
  return blob.text();
}

export function downloadFile(filename: string, content: Blob | string): void {
  const blob = typeof content === 'string' ? new Blob([content], { type: 'application/json' }) : content;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function metaFromSave(save: WorldSave, id: string, sizeBytes: number): SaveSlotMeta {
  return {
    id,
    name: save.meta.name,
    created: save.meta.created,
    updated: save.meta.updated,
    seed: save.meta.seed,
    worldDay: Math.floor(save.clock.hours / 24),
    playSeconds: save.meta.playSeconds,
    version: save.version,
    sizeBytes,
  };
}
