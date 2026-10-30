import { downloadBlob } from './lib/download.js';

/** Distinct from a selected but unreadable save. Only browser picker cancellation yields this. */
export const BROWSER_IMPORT_CANCELLED = Symbol('browser-import-cancelled');

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
  /**
   * Optional: put plain text on the device clipboard, rejecting if it could
   * not. A host without one gets `copyTextInBrowser`, which every shipped
   * WebView also runs.
   */
  copyText?(text: string): Promise<void>;
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
  copyText?(text: string): Promise<void>;
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

/** The host stores opaque JSON objects, not a duplicate game schema.
 * Check the serialized root, rather than the input type: toJSON() can turn an
 * apparent object into a scalar or array. Every valid JSON object begins
 * with '{' under JSON.stringify's compact output. Refuse other roots before
 * touching Storage, preserving the last readable save/Library. The same
 * guard protects browser exports; optional indentation preserves readable
 * interchange JSON without a second serialization or separate schema.
 */
function readableBrowserJSON(value: unknown, space?: number): string {
  const serialized = JSON.stringify(value, null, space);
  if (serialized === undefined || !serialized.startsWith('{')) {
    throw new TypeError('the browser cannot persist a non-object JSON record');
  }
  return serialized;
}

/**
 * Storage must distinguish an absent record from a present JSON value that
 * cannot be a saved game or Library. Leave nested validation to core.
 */
function readableBrowserRecord(value: unknown, name: string): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`the browser ${name} record is invalid`);
  }
  return value;
}

/**
 * Copy for a page in any browser or WebView. The asynchronous Clipboard API
 * first; where it is missing or refused (an insecure origin, a WebView that
 * withholds the permission) the older selected-textarea copy, which needs only
 * the click that called it. Rejects if neither took, so the caller can say so
 * rather than claim a copy that did not happen. Focus goes back where it was.
 */
export async function copyTextInBrowser(text: string): Promise<void> {
  const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(text);
      return;
    } catch {
      // Fall through to the older path.
    }
  }
  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') {
    throw new Error('this browser cannot copy');
  }
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.setAttribute('aria-hidden', 'true');
  area.style.position = 'fixed';
  area.style.top = '0';
  area.style.left = '-9999px';
  area.style.opacity = '0';
  document.body.appendChild(area);
  try {
    // The copy takes the focused element's selection.
    area.focus();
    area.select();
    if (!document.execCommand('copy')) throw new Error('the browser refused to copy');
  } finally {
    area.remove();
    focused?.focus();
  }
}

/** The full demo implementation: durable local saves and download/file import. */
export function browserPlatform(): Platform {
  return {
    async listSaves() {
      const storage = browserStorage();
      if (!storage) throw new Error('this browser does not permit saved data');
      const saves: SaveSummary[] = [];
      // A failed enumeration is not evidence that saves were deleted. Let
      // callers report Retry (or retain an earlier list) rather than claiming
      // an empty library on a transient Storage.length error.
      const count = storage.length;
      let readableKeys = 0;
      for (let i = 0; i < count; i++) {
        let key: string | null;
        try {
          key = storage.key(i);
          // Even a null key is a successful lookup: the store may have
          // changed during enumeration. Only exceptions prove an outage.
          readableKeys++;
        } catch {
          // One failing key lookup says nothing about other saved slots.
          continue;
        }
        if (!key?.startsWith(PREFIX)) continue;
        const slot = key.slice(PREFIX.length);
        try {
          const text = storage.getItem(key);
          saves.push(text ? summary(slot, JSON.parse(text)) : { slot });
        } catch {
          // An unreadable run is still a saved slot. Show its name rather
          // than silently hiding the entry; readSave rejects invalid JSON
          // without taking any of the other, healthy runs away.
          saves.push({ slot });
        }
      }
      // A nonempty store where EVERY key lookup threw is not an empty set of
      // saved runs. Reject so the client retains its last known list and offers
      // Retry; partial enumeration continues to expose healthy slots.
      if (count > 0 && readableKeys === 0) {
        throw new Error('save key enumeration unavailable');
      }
      return saves.sort((a, b) => String(b.savedAt ?? '').localeCompare(String(a.savedAt ?? '')) || a.slot.localeCompare(b.slot));
    },

    async readSave(slot) {
      const storage = browserStorage();
      if (!storage) throw new Error('this browser does not permit saved data');
      const text = storage.getItem(PREFIX + slot);
      // Missing is not the same as unreadable: an existing corrupt slot must
      // reject rather than masquerade as an absent run (#1252). In particular,
      // JSON.parse('null') succeeds but cannot represent a saved game.
      if (text === null) return null;
      return readableBrowserRecord(JSON.parse(text), 'save');
    },

    async writeSave(slot, save) {
      const storage = browserStorage();
      if (!storage) throw new Error('this browser does not permit saved data');
      storage.setItem(PREFIX + slot, readableBrowserJSON(save));
    },

    async deleteSave(slot) {
      const storage = browserStorage();
      if (!storage) throw new Error('this browser does not permit saved data');
      storage.removeItem(PREFIX + slot);
    },

    async readLibrary() {
      const storage = browserStorage();
      // An unavailable Storage is not proof of an empty Library. Fail closed:
      // the client can retry, without replacing an existing profile.
      if (!storage) throw new Error('this browser does not permit saved data');
      const text = storage.getItem(LIBRARY_KEY);
      if (text === null) return null;
      // A present but unreadable record must reject. Treating corrupt JSON
      // (including an empty string or literal null) as absence risks erasure.
      return readableBrowserRecord(JSON.parse(text), 'Library of Houses');
    },

    async writeLibrary(library) {
      const storage = browserStorage();
      if (!storage) throw new Error('this browser does not permit saved data');
      storage.setItem(LIBRARY_KEY, readableBrowserJSON(library));
    },

    // Achievements are a platform/profile concern. The browser deliberately
    // has no backend and therefore treats an unlock as successfully ignored.
    async unlockAchievement() {},

    async readUserContent() {
      return {};
    },

    async exportSave(save) {
      const blob = new Blob([readableBrowserJSON(save, 2)], { type: 'application/json' });
      downloadBlob(blob, `eldritch-${summary('run', save).year ?? 'run'}.json`);
    },

    async importSave() {
      return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/json,.json,.edsave';
        // Cancelling the native picker does not dispatch a change event.
        input.addEventListener('cancel', () => resolve(BROWSER_IMPORT_CANCELLED), { once: true });
        input.onchange = () => {
          const file = input.files?.[0];
          if (!file) { resolve(BROWSER_IMPORT_CANCELLED); return; }
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

    copyText: copyTextInBrowser,

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
