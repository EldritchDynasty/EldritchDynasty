/** Reading choices belong to the reader, not to a saved world. */
export type TextScale = 'standard' | 'large' | 'largest';
export type ReadingFont = 'book' | 'readable';

export interface AccessibilityPreferences {
  textScale: TextScale;
  readingFont: ReadingFont;
  /** Presentation only: never answers a decision or changes a saved world. */
  skipSeenProse: boolean;
}

export const ACCESSIBILITY_STORAGE_KEY = 'eldritch-dynasty:reading';
export const SEEN_PROSE_STORAGE_KEY = 'eldritch-dynasty:seen-prose';

export const DEFAULT_ACCESSIBILITY: AccessibilityPreferences = {
  textScale: 'standard',
  readingFont: 'book',
  skipSeenProse: false,
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
    } | null;
    return {
      textScale: isTextScale(parsed?.textScale) ? parsed.textScale : DEFAULT_ACCESSIBILITY.textScale,
      readingFont: isReadingFont(parsed?.readingFont) ? parsed.readingFont : DEFAULT_ACCESSIBILITY.readingFont,
      skipSeenProse: parsed?.skipSeenProse === true,
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
export function seenProseKey(kind: 'chapter-opening', text: string): string {
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

/**
 * One pure boundary between reader history and the chapter UI. Closings are
 * deliberately representable here so the "never skip a verdict" rule is
 * executable rather than a comment in the component.
 */
export function chapterReplayDisposition(
  storage: Pick<Storage, 'getItem' | 'setItem'> | null,
  skipSeenProse: boolean,
  beat: ChapterReplayBeat,
): 'show' | 'skip' {
  if (beat.kind === 'closing') return 'show';

  const key = seenProseKey('chapter-opening', beat.text);
  if (skipSeenProse && hasSeenProse(storage, key)) return 'skip';

  rememberSeenProse(storage, key);
  return 'show';
}
