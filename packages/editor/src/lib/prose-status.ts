import {
  contentInterpolationTokens,
  proseOriginalHash,
  type ContentProseEntry,
  type ProseVariant,
} from '@ed/schema';

export interface ProseVariantStatus {
  ok: boolean;
  text: string;
}

function counts(tokens: readonly string[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const token of tokens) out.set(token, (out.get(token) ?? 0) + 1);
  return out;
}

/**
 * A placeholder match alone does not mean a Plain English variant will render.
 * Runtime also requires a fingerprint of the exact current Original. Display
 * that same contract in the editor instead of assuring an author that an
 * unreviewed/stale counterpart is ready for readers.
 */
export function proseVariantStatus(
  entry: Pick<ContentProseEntry, 'text' | 'interpolations'>,
  variant: Pick<ProseVariant, 'plainenglish' | 'of'> | undefined,
): ProseVariantStatus {
  if (!variant?.plainenglish) {
    return { ok: false, text: 'Plain English is missing.' };
  }
  if (variant.of !== proseOriginalHash(entry.text)) {
    return { ok: false, text: 'Plain English needs review against the current Original.' };
  }

  const original = counts(entry.interpolations);
  const translated = counts(contentInterpolationTokens(variant.plainenglish));
  const tokens = [...new Set([...original.keys(), ...translated.keys()])].sort();
  const missing: string[] = [];
  const extra: string[] = [];

  for (const token of tokens) {
    const wanted = original.get(token) ?? 0;
    const got = translated.get(token) ?? 0;
    for (let i = got; i < wanted; i++) missing.push(token);
    for (let i = wanted; i < got; i++) extra.push(token);
  }

  if (missing.length || extra.length) {
    return {
      ok: false,
      text: [
        missing.length ? `missing ${missing.join(', ')}` : '',
        extra.length ? `extra ${extra.join(', ')}` : '',
      ].filter(Boolean).join(' · '),
    };
  }

  return {
    ok: true,
    text: entry.interpolations.length ? 'Placeholders match.' : 'No placeholders to preserve.',
  };
}
