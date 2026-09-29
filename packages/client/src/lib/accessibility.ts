/** Reading choices belong to the reader, not to a saved world. */
export type TextScale = 'standard' | 'large' | 'largest';
export type ReadingFont = 'book' | 'readable';

export interface AccessibilityPreferences {
  textScale: TextScale;
  readingFont: ReadingFont;
  /** Presentation only: never answers a decision or changes a saved world. */
  skipSeenProse: boolean;
  /** Presentation only: reader-controlled motion, never part of SavedGame. */
  reduceMotion: boolean;
}

export const ACCESSIBILITY_STORAGE_KEY = 'eldritch-dynasty:reading';
export const SEEN_PROSE_STORAGE_KEY = 'eldritch-dynasty:seen-prose';

export const DEFAULT_ACCESSIBILITY: AccessibilityPreferences = {
  textScale: 'standard',
  readingFont: 'book',
  skipSeenProse: false,
  reduceMotion: false,
};

function isTextScale(value: unknown): value is TextScale {
  return value === 'standard' || value === 'large' || value === 'largest';
}

function isReadingFont(value: unknown): value is ReadingFont {
  return value === 'book' || value === 'readable';
}

/** A bad or older preference must never stop the title screen from opening. */
export function loadAccessibility(storage: Pick<Storage, 'getItem'> | null): AccessibilityPreferences {
  if (!storage) return { ...DEFAULT_ACCESSIBILITY };
  try {
    const parsed = JSON.parse(storage.getItem(ACCESSIBILITY_STORAGE_KEY) ?? 'null') as {
      textScale?: unknown;
      readingFont?: unknown;
      skipSeenProse?: unknown;
      reduceMotion?: unknown;
    } | null;
    return {
      textScale: isTextScale(parsed?.textScale) ? parsed.textScale : DEFAULT_ACCESSIBILITY.textScale,
      readingFont: isReadingFont(parsed?.readingFont) ? parsed.readingFont : DEFAULT_ACCESSIBILITY.readingFont,
      skipSeenProse: parsed?.skipSeenProse === true,
      reduceMotion: parsed?.reduceMotion === true,
    };
  } catch {
    return { ...DEFAULT_ACCESSIBILITY };
  }
}

export function applyAccessibility(
  root: HTMLElement,
  preferences: AccessibilityPreferences,
): void {
  root.dataset.textScale = preferences.textScale;
  root.dataset.readingFont = preferences.readingFont;
  root.dataset.reduceMotion = preferences.reduceMotion ? 'true' : 'false';
  // A percentage preserves the browser/OS base size the reader already chose;
  // every client size is rem-based, so the whole existing ladder follows it.
  root.style.fontSize = preferences.textScale === 'largest'
    ? '130%'
    : preferences.textScale === 'large' ? '115%' : '';
}

export function saveAccessibility(
  storage: Pick<Storage, 'setItem'> | null,
  preferences: AccessibilityPreferences,
): void {
  if (!storage) return;
  try {
    storage.setItem(ACCESSIBILITY_STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // A private or full store is not a reason to take the game away. The
    // preference still applies for this session through the document root.
  }
}


/**
 * Exact prose identity, not an authored id. If an author changes even one
 * character, the new line is unseen and must be offered to the reader.
 */
export type SeenProseKind = 'chapter-opening' | 'prologue' | 'scene';

export function seenProseKey(kind: SeenProseKind, text: string): string {
  return `${kind}\u0000${text}`;
}

export function loadSeenProse(storage: Pick<Storage, 'getItem'> | null): Set<string> {
  if (!storage) return new Set();
  try {
    const parsed = JSON.parse(storage.getItem(SEEN_PROSE_STORAGE_KEY) ?? '[]');
    return new Set(Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : []);
  } catch {
    return new Set();
  }
}

export function hasSeenProse(
  storage: Pick<Storage, 'getItem'> | null,
  key: string,
): boolean {
  return loadSeenProse(storage).has(key);
}

export function rememberSeenProse(
  storage: Pick<Storage, 'getItem' | 'setItem'> | null,
  key: string,
): void {
  if (!storage) return;
  try {
    const seen = loadSeenProse(storage);
    if (seen.has(key)) return;
    seen.add(key);
    storage.setItem(SEEN_PROSE_STORAGE_KEY, JSON.stringify([...seen]));
  } catch {
    // A reading convenience is never a reason to make the game unavailable.
  }
}


export type ChapterReplayBeat =
  | { kind: 'opening'; text: string }
  | { kind: 'closing' };

export type ReplayBeat =
  | ChapterReplayBeat
  | { kind: 'prologue'; text: string }
  | { kind: 'scene'; event: string; authored: string };

export type ReplayDisposition = 'show' | 'skip' | 'fast' | 'mark';

function assertNever(value: never, what: string): never {
  throw new Error(`unhandled ${what}: ${JSON.stringify(value)}`);
}

/** The exact passive signing text whose identity survives across runs. */
export function prologueSeenText(
  opening: string,
  triad: readonly { given: string; owed: string }[],
  thesis: string,
): string {
  return [opening, ...triad.flatMap((beat) => [beat.given, beat.owed]), thesis].join('\u0000');
}

/**
 * One pure boundary between reader history and every recurring reading surface.
 *
 * - Age openings may disappear only after an exact repeat and an explicit opt-in.
 * - The passive prologue beats are never skipped; an exact repeat may reveal at once.
 * - A repeated authored scene is marked, never hidden.
 * - Closings are verdicts on this house and never enter reader history.
 *
 * A new beat kind must choose one of those contracts here before it can compile.
 */
export function replayDisposition(
  storage: Pick<Storage, 'getItem' | 'setItem'> | null,
  skipSeenProse: boolean,
  beat: ReplayBeat,
): ReplayDisposition {
  switch (beat.kind) {
    case 'closing':
      return 'show';

    case 'opening': {
      const key = seenProseKey('chapter-opening', beat.text);
      if (skipSeenProse && hasSeenProse(storage, key)) return 'skip';
      rememberSeenProse(storage, key);
      return 'show';
    }

    case 'prologue': {
      const key = seenProseKey('prologue', beat.text);
      return skipSeenProse && hasSeenProse(storage, key) ? 'fast' : 'show';
    }

    case 'scene': {
      // Filled names are deliberately absent. What the reader has met before
      // is the authored scene, not this run's cast.
      const key = seenProseKey('scene', `${beat.event}\u0000${beat.authored}`);
      if (hasSeenProse(storage, key)) return 'mark';
      rememberSeenProse(storage, key);
      return 'show';
    }

    default:
      return assertNever(beat, 'replay beat');
  }
}

/**
 * Compatibility wrapper for Chapter.vue. Keeping the existing two-result
 * contract makes the expansion above local: a chapter can still only show or
 * skip, while other reading surfaces gain their own dispositions.
 */
export function chapterReplayDisposition(
  storage: Pick<Storage, 'getItem' | 'setItem'> | null,
  skipSeenProse: boolean,
  beat: ChapterReplayBeat,
): 'show' | 'skip' {
  return replayDisposition(storage, skipSeenProse, beat) === 'skip' ? 'skip' : 'show';
}

export interface InitialProloguePresentation {
  shown: number;
  inheritedVisible: boolean;
}

/**
 * The inherited Library line is deliberately outside the replay identity.
 *
 * A returning reader may fast-reveal the signing they have already read, but
 * the new run's inherited account is new run-specific prose and remains on the
 * first screen whenever it exists.
 */
export function initialProloguePresentation(
  storage: Pick<Storage, 'getItem' | 'setItem'> | null,
  skipSeenProse: boolean,
  text: string,
  triadLength: number,
  hasInherited: boolean,
): InitialProloguePresentation {
  return {
    shown: initialPrologueShown(storage, skipSeenProse, text, triadLength),
    inheritedVisible: hasInherited,
  };
}

/**
 * The prologue owns one small piece of presentation state: how many passive
 * beats have been revealed. Keeping the reader-history transition here makes
 * it testable without mounting a second Vue/jsdom runtime.
 */
export function initialPrologueShown(
  storage: Pick<Storage, 'getItem' | 'setItem'> | null,
  skipSeenProse: boolean,
  text: string,
  triadLength: number,
): number {
  return replayDisposition(storage, skipSeenProse, { kind: 'prologue', text }) === 'fast'
    ? triadLength
    : 0;
}

export function revealPrologueBeat(
  storage: Pick<Storage, 'getItem' | 'setItem'> | null,
  text: string,
  shown: number,
  triadLength: number,
): number {
  const next = Math.min(triadLength, shown + 1);
  if (next === triadLength) {
    rememberSeenProse(storage, seenProseKey('prologue', text));
  }
  return next;
}
