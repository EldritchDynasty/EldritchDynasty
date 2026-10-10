import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { contentInterpolationTokens, proseOriginalHash } from '@ed/schema';
import { proseVariantStatus } from '../lib/prose-status';

const COMPONENTS = import.meta.dirname;

describe('dual prose authoring surface (#414)', () => {
  it('uses one shared prose-variant editor in every authored prose view', () => {
    for (const name of ['EventEditor.vue', 'ArcEditor.vue', 'CharacterEditor.vue']) {
      const source = readFileSync(join(COMPONENTS, name), 'utf8');
      expect(source, name).toContain("import ProseVariantEditor from './ProseVariantEditor.vue'");
      expect(source, name).toContain('<ProseVariantEditor');
    }
  });

  it('labels both variants, checks placeholders, and never prose-lints Plain English', () => {
    const source = readFileSync(join(COMPONENTS, 'ProseVariantEditor.vue'), 'utf8');

    expect(source).toContain('Original');
    expect(source).toContain('Plain English');
    expect(source).toContain('proseVariantStatus');
    const statusSource = readFileSync(join(COMPONENTS, '..', 'lib', 'prose-status.ts'), 'utf8');
    expect(statusSource).toContain('contentInterpolationTokens');
    expect(statusSource).toContain('proseOriginalHash');
    expect(statusSource).toContain('Placeholders match.');
    expect(statusSource).toContain('missing ');
    expect(statusSource).toContain('extra ');
    expect(source).not.toContain('proseIssues');
    expect(source).toContain('isWritableContentPath');
  });
});


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

    // Only an explicit review of the counterpart against the new Original
    // restores the successful status; editing Original never does so implicitly.
    expect(proseVariantStatus(
      { text: changedOriginal, interpolations: contentInterpolationTokens(changedOriginal) },
      {
        plainenglish: '{PERSON} read the old {BOOK}. {BOOK} was worn.',
        of: proseOriginalHash(changedOriginal),
      },
    )).toEqual({ ok: true, text: 'Placeholders match.' });
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
