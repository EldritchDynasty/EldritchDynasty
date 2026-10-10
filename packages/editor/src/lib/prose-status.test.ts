import { describe, expect, it } from 'vitest';
import { contentInterpolationTokens, proseOriginalHash } from '@ed/schema';
import { proseVariantStatus } from './prose-status';

const original = '{PERSON} read {BOOK}. {BOOK} was old.';
const entry = { text: original, interpolations: contentInterpolationTokens(original) };
const reviewed = (plainenglish: string) => ({ plainenglish, of: proseOriginalHash(original) });

describe('the Plain English editor review verdict (#945)', () => {
  it('distinguishes missing and genuinely reviewed wording', () => {
    expect(proseVariantStatus(entry, undefined)).toEqual({
      ok: false, text: 'Plain English is missing.',
    });
    expect(proseVariantStatus(entry, reviewed('{PERSON} read {BOOK}. {BOOK} was old.'))).toEqual({
      ok: true, text: 'Placeholders match.',
    });
  });

  it('does not show a green verdict when the Original changed after review', () => {
    const changedOriginal = '{PERSON} read the old {BOOK}. {BOOK} was worn.';
    expect(proseVariantStatus(
      { text: changedOriginal, interpolations: contentInterpolationTokens(changedOriginal) },
      reviewed('{PERSON} read {BOOK}. {BOOK} was old.'),
    )).toEqual({
      ok: false, text: 'Plain English needs review against the current Original.',
    });
  });

  it('flags legacy variants with no reviewed fingerprint', () => {
    expect(proseVariantStatus(entry, {
      plainenglish: '{PERSON} read {BOOK}. {BOOK} was old.',
    })).toEqual({
      ok: false, text: 'Plain English needs review against the current Original.',
    });
  });

  it('reports missing and extra placeholders, including repeated tokens', () => {
    expect(proseVariantStatus(entry, reviewed('{PERSON} read {BOOK}.'))).toEqual({
      ok: false, text: 'missing {BOOK}',
    });
    expect(proseVariantStatus(entry, reviewed('{PERSON} read {BOOK}. {BOOK} was {HEIR}.'))).toEqual({
      ok: false, text: 'extra {HEIR}',
    });
    expect(proseVariantStatus(entry, reviewed('{PERSON} read {HEIR}. {BOOK} was old.'))).toEqual({
      ok: false, text: 'missing {BOOK} · extra {HEIR}',
    });
  });

  it('allows a current Original without interpolation tokens', () => {
    const text = 'The archive was silent.';
    expect(proseVariantStatus({ text, interpolations: [] }, {
      of: proseOriginalHash(text),
      plainenglish: 'The archive was quiet.',
    })).toEqual({ ok: true, text: 'No placeholders to preserve.' });
  });
});
