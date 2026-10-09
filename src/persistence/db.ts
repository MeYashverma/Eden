/**
 * IndexedDB storage layer for world saves.
 *
 * Large save payloads live in IndexedDB (localStorage stays reserved for
 * small settings). All operations degrade gracefully: if storage is blocked,
 * unavailable or full, the game keeps running and tells the player to export.
 */

export interface SaveSlotMeta {
  id: string;
  name: string;
  created: number;
  updated: number;
  seed: number;
  worldDay: number;
  playSeconds: number;
  version: number;
  sizeBytes: number;
}

export interface SaveSlot extends SaveSlotMeta {
  data: unknown;
}

const DB_NAME = 'eden-worlds';
const DB_VERSION = 1;
const STORE = 'saves';

export class SaveDatabase {
  private db: IDBDatabase | null = null;
  available = false;
  errorMessage = '';

  async open(): Promise<boolean> {
    if (typeof indexedDB === 'undefined') {
      this.errorMessage = 'IndexedDB is unavailable in this browser.';
      return false;
    }
    try {
      this.db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE)) {
            db.createObjectStore(STORE, { keyPath: 'id' });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
        req.onblocked = () => reject(new Error('IndexedDB blocked'));
      });
      this.available = true;
      return true;
    } catch (err) {
      this.errorMessage = err instanceof Error ? err.message : String(err);
      this.available = false;
      return false;
    }
  }

  private tx(mode: IDBTransactionMode): IDBObjectStore | null {
    if (!this.db) return null;
    return this.db.transaction(STORE, mode).objectStore(STORE);
  }

  async listSlots(): Promise<SaveSlotMeta[]> {
    const store = this.tx('readonly');
    if (!store) return [];
    return new Promise((resolve) => {
      const req = store.getAll();
      req.onsuccess = () => {
        const rows = (req.result as SaveSlot[]).map((r) => ({
          id: r.id,
          name: r.name,
          created: r.created,
          updated: r.updated,
          seed: r.seed,
          worldDay: r.worldDay,
          playSeconds: r.playSeconds,
          version: r.version,
          sizeBytes: r.sizeBytes,
        }));
        rows.sort((a, b) => b.updated - a.updated);
        resolve(rows);
      };
      req.onerror = () => resolve([]);
    });
  }

  async getSlot(id: string): Promise<SaveSlot | null> {
    const store = this.tx('readonly');
    if (!store) return null;
    return new Promise((resolve) => {
      const req = store.get(id);
      req.onsuccess = () => resolve((req.result as SaveSlot) ?? null);
      req.onerror = () => resolve(null);
    });
  }

  /**
   * Resolves true only once the transaction has committed. A request can succeed
   * while the transaction later aborts (e.g. quota exceeded), so the request's
   * own onsuccess is not a reliable signal.
   */
  private write(op: (store: IDBObjectStore) => void): Promise<boolean> {
    if (!this.db) return Promise.resolve(false);
    return new Promise((resolve) => {
      let tx: IDBTransaction;
      try {
        tx = this.db!.transaction(STORE, 'readwrite');
      } catch (err) {
        this.errorMessage = err instanceof Error ? err.message : String(err);
        resolve(false);
        return;
      }
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => {
        this.errorMessage = tx.error?.message ?? 'Save transaction failed';
        resolve(false);
      };
      tx.onabort = () => {
        this.errorMessage = tx.error?.name === 'QuotaExceededError' ? 'Storage quota exceeded' : (tx.error?.message ?? 'Save transaction aborted');
        resolve(false);
      };
      try {
        op(tx.objectStore(STORE));
      } catch (err) {
        this.errorMessage = err instanceof Error ? err.message : String(err);
        try { tx.abort(); } catch { /* already finished */ }
      }
    });
  }

  async putSlot(slot: SaveSlot): Promise<boolean> {
    return this.write((store) => {
      store.put(slot);
    });
  }

  async deleteSlot(id: string): Promise<boolean> {
    return this.write((store) => {
      store.delete(id);
    });
  }

  async estimateUsage(): Promise<{ usage: number; quota: number } | null> {
    try {
      const est = await navigator.storage?.estimate?.();
      if (est) return { usage: est.usage ?? 0, quota: est.quota ?? 0 };
    } catch {
      /* not supported */
    }
    return null;
  }
}

/** Small settings live in localStorage (not save data). */
export const SettingsStore = {
  get<T>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(`eden.${key}`);
      return raw === null ? fallback : (JSON.parse(raw) as T);
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown): void {
    try {
      localStorage.setItem(`eden.${key}`, JSON.stringify(value));
    } catch {
      /* storage unavailable */
    }
  },
};
