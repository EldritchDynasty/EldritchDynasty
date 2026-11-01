import { z } from 'zod';
import { CampaignIdS } from './campaign.js';
import { EndingIdS } from './ending.js';
import { ResolvedClaimS } from './claim.js';
import { TaleFormS } from './tale.js';

/**
 * THE LIBRARY OF HOUSES (issue #70).
 *
 * This is deliberately NOT a TaleDef. A TaleDef is authored content whose
 * `about` event happens in the live run; a library page is the surviving
 * record of a run that is already over. It also deliberately stores no hidden
 * truth: only what that family's own book said, plus whether the world ever
 * caught a discrepancy attached to that page.
 */
export const LIBRARY_FORMAT = 1;
export const LIBRARY_RUN_CAP = 24;
export const LIBRARY_ENTRY_CAP = 12;
export const LIBRARY_MEMORY_CAP = 4;

export const LibraryEntryS = z.object({
  /** Stable within the source run: the chronicle entry id where one existed. */
  id: z.string(),
  /** The family's own words. This is what later houses quote back. */
  said: z.string().min(1),
  year: z.number(),
  record: z.enum(['record', 'omit', 'embellish']).optional(),
  discrepancy: z.object({
    id: z.string(),
    state: z.enum(['open', 'proven', 'buried']),
  }).optional(),
  /**
   * Historical person ids to the names that run knew them by. Claims keep the
   * existing ResolvedClaim vocabulary rather than inventing a second closed
   * union merely because their subjects are now dead.
   */
  people: z.record(z.string(), z.string()).default({}),
  claims: z.array(ResolvedClaimS),
});
export type LibraryEntry = z.infer<typeof LibraryEntryS>;

const LibraryRunMetaS = z.object({
  /** A deterministic fingerprint of this finished account, used for de-dupe. */
  id: z.string(),
  seed: z.number(),
  campaign: CampaignIdS,
  endedYear: z.number(),
  house: z.string().min(1),
  ending: z.object({ id: EndingIdS, title: z.string().min(1) }),
});

export const LibraryRunS = LibraryRunMetaS.extend({
  entries: z.array(LibraryEntryS).max(LIBRARY_ENTRY_CAP),
});
export type LibraryRun = z.infer<typeof LibraryRunS>;

export const RunLibraryS = z.object({
  format: z.literal(LIBRARY_FORMAT),
  runs: z.array(LibraryRunS).max(LIBRARY_RUN_CAP),
});
export type RunLibrary = z.infer<typeof RunLibraryS>;

/**
 * What one new run actually imported. This belongs in the save: deleting or
 * editing the installation-level library after bootstrap must not rewrite a
 * live run.
 *
 * `claims` is the later account. `sourceClaims` is what the older book
 * said. Neither is hidden truth; they are two attributed records.
 */
export const LibraryMemoryS = z.object({
  id: z.string(),
  sourceRun: z.string(),
  sourceHouse: z.string(),
  sourceYear: z.number(),
  sourceText: z.string(),
  form: TaleFormS,
  teller: z.string().min(1),
  bias: z.string().min(1),
  text: z.string().min(1),
  about: z.string(),
  since: z.number(),
  mutations: z.number().int().nonnegative(),
  people: z.record(z.string(), z.string()).default({}),
  sourceClaims: z.array(ResolvedClaimS),
  claims: z.array(ResolvedClaimS),
});
export type LibraryMemory = z.infer<typeof LibraryMemoryS>;

export function emptyRunLibrary(): RunLibrary {
  return { format: LIBRARY_FORMAT, runs: [] };
}

/**
 * Library data is player-editable on desktop and ordinary local storage in a
 * browser. One malformed historical run must not stop a new game from
 * starting, so validation is intentionally per run and per entry.
 */
export function readRunLibrary(raw: unknown): RunLibrary {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return emptyRunLibrary();
  const root = raw as { format?: unknown; runs?: unknown };
  if (root.format !== LIBRARY_FORMAT || !Array.isArray(root.runs)) return emptyRunLibrary();

  // A restored or edited Library may contain multiple valid copies of one
  // history. Match appendLibraryRun: the last valid copy wins, and takes its
  // place at the end of the reading order rather than using another slot.
  const runsById = new Map<string, LibraryRun>();
  for (const candidate of root.runs) {
    if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const object = candidate as Record<string, unknown>;
    const meta = LibraryRunMetaS.safeParse(object);
    if (!meta.success) continue;
    const rawEntries = Array.isArray(object.entries) ? object.entries : [];
    const entries = rawEntries.flatMap((entry) => {
      const parsed = LibraryEntryS.safeParse(entry);
      return parsed.success ? [parsed.data] : [];
    }).slice(-LIBRARY_ENTRY_CAP);
    const run = { ...meta.data, entries };
    runsById.delete(run.id);
    runsById.set(run.id, run);
  }

  return { format: LIBRARY_FORMAT, runs: [...runsById.values()].slice(-LIBRARY_RUN_CAP) };
}

export function appendLibraryRun(library: RunLibrary, run: LibraryRun): RunLibrary {
  const withoutOldCopy = library.runs.filter((held) => held.id !== run.id);
  return {
    format: LIBRARY_FORMAT,
    runs: [...withoutOldCopy, run].slice(-LIBRARY_RUN_CAP),
  };
}
