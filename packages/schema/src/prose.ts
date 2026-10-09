import { z } from 'zod';
import type { Issue } from './validate.js';

/**
 * THE VOICE CONTRACT, applied to anything long enough to have a shape.
 *
 * A body of five sentences or fewer is a note. Past that it is prose, and it is
 * held to `.claude/skills/rothfuss-prose/reference/prose-manual.md`. Most of
 * that spec is judgement, but a useful minority is countable, and the countable
 * part is where imitation usually fails — so count it.
 *
 * All warnings, never errors. A linter that blocks writers gets disabled within
 * a fortnight. The value is that a body failing four of these at once is
 * genuinely off-voice, and the panel makes that visible in a way a style guide
 * in another folder never will.
 */
export const PROSE_SENTENCE_THRESHOLD = 5;

/**
 * The frame (concept §2, Layer 1; issue #13) is quieter and shorter than the
 * tale around it — "the game cuts to the last night for ninety seconds" — so it answers
 * to a tighter budget than the standard five sentences.
 */
export const FRAME_PROSE_SENTENCE_THRESHOLD = 3;

export function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function proseIssues(where: string, body: string, threshold: number = PROSE_SENTENCE_THRESHOLD): Issue[] {
  const out: Issue[] = [];
  const sentences = splitSentences(body);
  if (sentences.length <= threshold) return out;

  const words = body.split(/\s+/).filter(Boolean);
  const lens = sentences.map((s) => s.split(/\s+/).length);
  const warn = (rule: string, message: string) =>
    out.push({ level: 'warning', rule, where, message });

  // Strong verbs over verb+adverb (prose spec §5.2)
  const adverbs = words.filter((w) => /ly[.,;:!?"']*$/i.test(w) && w.length > 5).length;
  if (adverbs / words.length > 0.025) {
    warn('prose/adverbs', `adverb density ${(100 * adverbs / words.length).toFixed(1)}% — strong verbs over verb+adverb`);
  }

  // The jagged profile: long, long, short (§2.1-2.3)
  const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
  const sd = Math.sqrt(lens.reduce((a, b) => a + (b - mean) ** 2, 0) / lens.length);
  if (sd < 5) warn('prose/rhythm', `flat rhythm (sentence-length sd ${sd.toFixed(1)}) — vary the cadence`);

  // Paragraphs land on a short sentence (§2.1)
  const last = lens[lens.length - 1]!;
  if (last > 12) warn('prose/landing', `no landing — final sentence is ${last} words; land on something short`);

  // Never explain the punch line (§2.1)
  if (lens.length >= 2 && last <= 12 && lens[lens.length - 2]! <= 12) {
    warn('prose/landing', 'explained landing — two short closers in a row; cut one');
  }

  // Age is carried by content, not grammar (§5.4)
  const archaic = body.match(/\b(ere|mayhap|betwixt|whilst|'twas|forsooth|verily)\b/gi);
  if (archaic) warn('prose/archaism', `archaism: ${[...new Set(archaic.map((a) => a.toLowerCase()))].join(', ')}`);

  // Sound and temperature before sight (§7)
  const first = sentences[0]!.toLowerCase();
  const visual = /\b(saw|looked|bright|dark|colour|color|gleam|shone|visible)\b/.test(first);
  const sensed = /\b(cold|warm|heat|quiet|loud|silence|smell|sound|damp|dry|still)\b/.test(first);
  if (visual && !sensed) warn('prose/opening', 'sight-first opening — reach for sound or temperature before sight');

  // A slot token in the landing breaks the close on some fills (§16.1)
  if (/\{[A-Z_][A-Z0-9_]*\}/.test(sentences[sentences.length - 1]!)) {
    warn('prose/landing', 'variable in the landing — a five-syllable name destroys a four-beat close');
  }

  return out;
}


/**
 * WHICH AUTHORED WORDING TO USE FOR TEXT THAT HAS NOT YET BECOME HISTORY.
 *
 * This is deliberately presentation state, not save state. Once prose is
 * committed to the Chronicle, frame or Library the rendered words themselves
 * are the artefact and survive later mode changes unchanged.
 */
export const ProseModeS = z.enum(['original', 'plainenglish']);
export type ProseMode = z.infer<typeof ProseModeS>;

/**
 * One alternate authored wording, keyed by #411's stable work-item address.
 *
 * The original remains where it is authored today; duplicating it here would
 * create two sources of truth. Migration therefore adds only the counterpart.
 */
export const ProseVariantS = z.object({
  address: z.string().min(1),
  /** Short fingerprint of the Original wording this counterpart was reviewed against. */
  of: z.string().regex(/^[0-9a-f]{16}$/).optional(),
  plainenglish: z.string().min(1),
});
export type ProseVariant = z.infer<typeof ProseVariantS>;

/**
 * Content fields whose string values are player-facing narrative prose.
 *
 * This vocabulary is shared by the #411 worklist and the editor. Keeping it
 * here prevents the authoring tool from growing a second hand-maintained list
 * of event/arc/character prose fields that can drift from the migration audit.
 */
export const CONTENT_PROSE_KEYS: ReadonlySet<string> = new Set([
  'text', 'body', 'label', 'chronicle', 'blurb', 'title', 'absentBody', 'description',
  'teller', 'bias', 'opening', 'subject', 'provenance', 'owed', 'name', 'given', 'line', 'place',
  'closing', 'because', 'cause', 'thesis', 'notarisedBy',
  'friendsPrompt', 'housePrompt', 'namePrompt', 'campaignText', 'inheritedLine',
  'situation', 'says',
]);

/** Preserve uppercase slot names and lower/mixed-case runtime substitutions alike. */
const CONTENT_INTERPOLATION = /\{[A-Za-z][A-Za-z0-9_]*\}/g;

export function contentInterpolationTokens(text: string): string[] {
  return text.match(CONTENT_INTERPOLATION) ?? [];
}

function proseWordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function isContentProse(text: string): boolean {
  return /[A-Za-z]/.test(text) && proseWordCount(text) >= 2;
}

/** Use the same prose eligibility in the worklist and variant-address validation. */
export function isContentProseField(key: string, text: string): boolean {
  // A tale's one-word bias (e.g. "gloating") is visible beside its teller
  // and text, and proseForTale has a Plain English seam for it. The migration
  // worklist must enumerate those fields even though most other narrative
  // strings need two or more words to distinguish them from identifiers.
  return CONTENT_PROSE_KEYS.has(key)
    && (isContentProse(text) || (key === 'bias' && /[A-Za-z]/.test(text)));
}

export type ContentProsePathSegment =
  | { kind: 'key'; key: string }
  | { kind: 'index'; index: number }
  | { kind: 'identity'; field: 'id' | 'key'; value: string };

export interface ContentProseEntry {
  address: string;
  text: string;
  words: number;
  interpolations: string[];
  /** True when this wording lives under a tier: frame event. */
  frameTier: boolean;
  /** Structural path used by the editor to edit Original without parsing the address string. */
  path: ContentProsePathSegment[];
}

function authoredIdentity(value: unknown): { field: 'id' | 'key'; value: string } | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  if (typeof row.id === 'string') return { field: 'id', value: row.id };
  if (typeof row.key === 'string') return { field: 'key', value: row.key };
  return undefined;
}

function segmentText(segment: ContentProsePathSegment): string {
  switch (segment.kind) {
    case 'key': return segment.key;
    case 'index': return `[${segment.index}]`;
    case 'identity': return `[${segment.field}=${encodeURIComponent(segment.value)}]`;
  }
}

function pathText(path: readonly ContentProsePathSegment[]): string {
  let out = '';
  for (const segment of path) {
    const text = segmentText(segment);
    if (segment.kind === 'key') out += out ? `.${text}` : text;
    else out += text;
  }
  return out;
}

/**
 * Walk authored data exactly once for both #411's migration worklist and #414's
 * dual-prose editor. Array identity prefers authored id/key over position, so
 * rewording or reordering an event does not orphan its Plain English partner.
 */
export function contentProseEntries(file: string, document: unknown): ContentProseEntry[] {
  const out: ContentProseEntry[] = [];

  const visit = (
    value: unknown,
    key: string,
    path: ContentProsePathSegment[],
    frameTier: boolean,
  ): void => {
    if (typeof value === 'string') {
      if (!isContentProseField(key, value)) return;
      out.push({
        address: `content:${file}#${pathText(path)}`,
        text: value,
        words: proseWordCount(value),
        interpolations: contentInterpolationTokens(value),
        frameTier,
        path,
      });
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        const identity = authoredIdentity(item);
        visit(
          item,
          key,
          [...path, identity
            ? { kind: 'identity', field: identity.field, value: identity.value }
            : { kind: 'index', index }],
          frameTier,
        );
      });
      return;
    }

    if (!value || typeof value !== 'object') return;
    const row = value as Record<string, unknown>;
    const nextFrame = frameTier || row.tier === 'frame';
    for (const [childKey, child] of Object.entries(row)) {
      visit(child, childKey, [...path, { kind: 'key', key: childKey }], nextFrame);
    }
  };

  visit(document, '', [], false);
  return out;
}

/** Mutate one Original prose field using the structural path returned above. */
export function setContentProseText(
  document: unknown,
  path: readonly ContentProsePathSegment[],
  text: string,
): boolean {
  if (!document || typeof document !== 'object' || path.length === 0) return false;
  let current: unknown = document;

  for (let i = 0; i < path.length - 1; i++) {
    const segment = path[i]!;
    if (segment.kind === 'key') {
      if (!current || typeof current !== 'object' || Array.isArray(current)) return false;
      current = (current as Record<string, unknown>)[segment.key];
    } else if (segment.kind === 'index') {
      if (!Array.isArray(current)) return false;
      current = current[segment.index];
    } else {
      if (!Array.isArray(current)) return false;
      current = current.find((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
        return (item as Record<string, unknown>)[segment.field] === segment.value;
      });
    }
  }

  const last = path[path.length - 1]!;
  if (last.kind !== 'key' || !current || typeof current !== 'object' || Array.isArray(current)) return false;
  (current as Record<string, unknown>)[last.key] = text;
  return true;
}

/**
 * A catalogue cannot have two answers for one stable prose identity.
 *
 * Storage is intentionally not smuggled into ContentBundle here: every bundle
 * collection must have a real CONTENT_LAYOUT source. #414 can add that authoring
 * source explicitly; #412 only defines the validated identity/value contract
 * and the runtime seam that consumes it.
 */
export const ProseCatalogueS = z.array(ProseVariantS).superRefine((variants, ctx) => {
  const seen = new Set<string>();
  for (let i = 0; i < variants.length; i++) {
    const address = variants[i]!.address;
    if (seen.has(address)) {
      ctx.addIssue({
        code: 'custom',
        path: [i, 'address'],
        message: `duplicate prose variant address '${address}'`,
      });
    }
    seen.add(address);
  }
});
export type ProseCatalogue = z.infer<typeof ProseCatalogueS>;

/**
 * Migration gate primitive: compare #411 work-item addresses with the authored
 * catalogue. #415 can therefore report zero missing without running the game.
 */
export function missingPlainEnglishAddresses(
  narrativeAddresses: readonly string[],
  variants: readonly ProseVariant[],
): string[] {
  const present = new Set(variants.map((variant) => variant.address));
  return [...new Set(narrativeAddresses)].filter((address) => !present.has(address)).sort();
}
