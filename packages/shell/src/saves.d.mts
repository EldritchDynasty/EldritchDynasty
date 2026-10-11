/** Hand-written because the implementation is `.mjs` — the Electron main process imports it directly, with no build step. */

/** One slot as a listing draws it. `unreadable` is set for a file that will not parse; it is reported, never dropped. */
export interface SaveListing {
  slot: string;
  bytes: number;
  format?: number;
  year?: number;
  savedAt?: string;
  unreadable?: string;
}

/** `<userData>/saves`, created if it is not there. */
export declare function requireSaveEnvelope(save: unknown): Record<string, unknown>;
export declare function saveRoot(userData: string): string;
export declare function listSaves(root: string): SaveListing[];
export declare function readSave(root: string, slot: unknown): unknown;
/** Writes atomically — beside the slot, then renamed. Throws for a blob with no numeric `format`. */
export declare function writeSave(root: string, slot: unknown, save: unknown): string;
export declare function deleteSave(root: string, slot: unknown): string;
export declare const SAVE_EXTENSION: string;
