import { downloadBlob } from './lib/download.js';

/**
 * The client's only door into its host.
 *
 * The game is a browser application first: this implementation is complete
 * rather than a development stub. Native shells expose the same small bridge
 * before the client starts; this module deliberately does not know which one
 * supplied it.
 */

export interface SaveSummary {
  slot: string;
  year?: number;
  savedAt?: string;
  format?: number;
}

/** Debug-only host commands used by native runtime smokes. No product UI calls these. */
export type SmokeCommand =
  | { kind: 'save'; seed: number; years: number }
  | { kind: 'resume' }
  | { kind: 'export' }
  | { kind: 'import'; path: string };

/** A validated client snapshot returned to the host for hashing and evidence. */
export interface SmokeResult {
  snapshot: unknown;
  year?: number;
  path?: string;
}

export interface Platform {
  /** Named, opaque snapshots. Their validity belongs to `loadGame` in core. */
  listSaves(): Promise<SaveSummary[]>;
  readSave(slot: string): Promise<unknown | null>;
  writeSave(slot: string, save: unknown): Promise<void>;
  deleteSave(slot: string): Promise<void>;
  /** Installation/profile-wide history of completed houses. Opaque to the host. */
  readLibrary(): Promise<unknown | null>;
  writeLibrary(library: unknown): Promise<void>;
  /** Optional profile-wide achievement backend. Browser and mobile hosts are no-ops. */
  unlockAchievement?(id: string): Promise<void>;
  /**
   * Optional user-authored YAML, keyed relative to a content root.
   * Browser and mobile hosts deliberately return an empty object.
   */
  readUserContent(): Promise<Record<string, string>>;
  /** Ask the host to write an interchange file, where that is possible. */
  exportSave(save: unknown): Promise<void>;
  /** Ask the host for an interchange file, where that is possible. */
  importSave(): Promise<unknown | null>;
  /** The last reliable notification before the host backgrounds or exits. */
  onPause(listener: () => void): () => void;
  /** A host back gesture. The browser implementation deliberately has none. */
  onBack(listener: () => boolean): () => void;
  /**
   * Optional debug-only native smoke seam.
   *
   * The host supplies transport and files; the client still drives every
   * simulation verb and validates every imported snapshot through core.
   */
  onSmokeCommand?(listener: (command: SmokeCommand) => Promise<SmokeResult>): () => void;
  writeSmokeInterchange?(save: unknown): Promise<string>;
  readSmokeInterchange?(path: string): Promise<unknown | null>;
}

interface Bridge {
  listSaves(): Promise<SaveSummary[]>;
  readSave(slot: string): Promise<unknown | null>;
  writeSave(slot: string, save: unknown): Promise<void>;
  deleteSave(slot: string): Promise<void>;
  readLibrary(): Promise<unknown | null>;
  writeLibrary(library: unknown): Promise<void>;
  unlockAchievement?(id: string): Promise<void>;
  readUserContent(): Promise<Record<string, string>>;
  exportSave(save: unknown): Promise<void>;
  importSave(): Promise<unknown | null>;
  onPause(listener: () => void): () => void;
  onBack(listener: () => boolean): () => void;
  onSmokeCommand?(listener: (command: SmokeCommand) => Promise<SmokeResult>): () => void;
  writeSmokeInterchange?(save: unknown): Promise<string>;
  readSmokeInterchange?(path: string): Promise<unknown | null>;
}

declare global {
  interface Window {
    /** Injected by a native shell before this module is evaluated. */
    edPlatform?: Bridge;
  }
}

const PREFIX = 'ed:save:';
const LIBRARY_KEY = 'ed:library';

function browserStorage(): Storage | null {
  try {
    // Access itself can throw in a private window or when site data is blocked.
    return window.localStorage;
  } catch {
    return null;
  }
}

function summary(slot: string, save: unknown): SaveSummary {
  const data = save !== null && typeof save === 'object' ? save as Record<string, unknown> : {};
  return {
    slot,
    year: typeof data.year === 'number' ? data.year : undefined,
    savedAt: typeof data.savedAt === 'string' ? data.savedAt : undefined,
    format: typeof data.format === 'number' ? data.format : undefined,
  };
}

/** The full demo implementation: durable local saves and download/file import. */
export function browserPlatform(): Platform {
  return {
    async listSaves() {
      const storage = browserStorage();
      if (!storage) return [];
      const saves: SaveSummary[] = [];
      try {
        for (let i = 0; i < storage.length; i++) {
          const key = storage.key(i);
          if (!key?.startsWith(PREFIX)) continue;
          const slot = key.slice(PREFIX.length);
          try {
            const text = storage.getItem(key);
            if (!text) continue;
            saves.push(summary(slot, JSON.parse(text)));
          } catch {
            // An unreadable slot must not conceal the other, healthy runs.
            // The player can still resume them; readSave handles the bad slot.
          }
        }
      } catch {
        return [];
      }
      return saves.sort((a, b) => String(b.savedAt ?? '').localeCompare(String(a.savedAt ?? '')) || a.slot.localeCompare(b.slot));
    },

    async readSave(slot) {
      const storage = browserStorage();
      if (!storage) return null;
      try {
        const text = storage.getItem(PREFIX + slot);
        return text ? JSON.parse(text) : null;
      } catch {
        return null;
      }
    },

    async writeSave(slot, save) {
      const storage = browserStorage();
      if (!storage) throw new Error('this browser does not permit saved data');
      storage.setItem(PREFIX + slot, JSON.stringify(save));
    },

    async deleteSave(slot) {
      const storage = browserStorage();
      if (!storage) throw new Error('this browser does not permit saved data');
      storage.removeItem(PREFIX + slot);
    },

    async readLibrary() {
      const storage = browserStorage();
      if (!storage) return null;
      try {
        const text = storage.getItem(LIBRARY_KEY);
        return text ? JSON.parse(text) : null;
      } catch {
        return null;
      }
    },

    async writeLibrary(library) {
      const storage = browserStorage();
      if (!storage) throw new Error('this browser does not permit saved data');
      storage.setItem(LIBRARY_KEY, JSON.stringify(library));
    },

    // Achievements are a platform/profile concern. The browser deliberately
    // has no backend and therefore treats an unlock as successfully ignored.
    async unlockAchievement() {},

    async readUserContent() {
      return {};
    },

    async exportSave(save) {
      const blob = new Blob([JSON.stringify(save, null, 2)], { type: 'application/json' });
      downloadBlob(blob, `eldritch-${summary('run', save).year ?? 'run'}.json`);
    },

    async importSave() {
      return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/json,.json,.edsave';
        // Cancelling the native picker does not dispatch a change event.
        input.addEventListener('cancel', () => resolve(null), { once: true });
        input.onchange = () => {
          const file = input.files?.[0];
          if (!file) { resolve(null); return; }
          try {
            const reader = new FileReader();
            reader.onerror = () => resolve(null);
            reader.onabort = () => resolve(null);
            reader.onload = () => {
              try { resolve(JSON.parse(String(reader.result))); } catch { resolve(null); }
            };
            reader.readAsText(file);
          } catch {
            // A synchronous FileReader failure occurs after the Promise executor
            // has returned, so rejecting here would otherwise strand the import.
            resolve(null);
          }
        };
        input.click();
      });
    },

    onPause(listener) {
      if (typeof document === 'undefined' || typeof window === 'undefined') return () => undefined;
      const pause = () => { if (document.visibilityState === 'hidden') listener(); };
      document.addEventListener('visibilitychange', pause);
      window.addEventListener('pagehide', listener);
      return () => {
        document.removeEventListener('visibilitychange', pause);
        window.removeEventListener('pagehide', listener);
      };
    },

    onBack() { return () => undefined; },
  };
}

/** Resolve once at composition. No caller below `main.ts` detects its host. */
export function platformForWindow(win: Window = window): Platform {
  return win.edPlatform ?? browserPlatform();
}

let installed: Platform | undefined;

/** Set once by composition; stores and components consume the resulting value. */
export function installPlatform(platform: Platform): void {
  installed = platform;
}

export function currentPlatform(): Platform {
  return installed ?? browserPlatform();
}
