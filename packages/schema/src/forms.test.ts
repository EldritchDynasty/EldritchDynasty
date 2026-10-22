import { describe, expect, it } from 'vitest';
import {
  contentInterpolationTokens, genderedPronounsIn, grammarOfSex, parseForm, PERSON_FORMS, PRONOUN_FORMS,
  renameSlotTokens, renderForm, slotTokens,
} from '@ed/schema';

/**
 * THE TOKEN GRAMMAR (#1867, step 0). One parser for `{SLOT}` and
 * `{SLOT.form}`, because six hand-copied patterns each read `{HEAD.they}` as
 * plain text — and a pronoun the engine does not see is a pronoun it renders
 * raw, in the chronicle.
 */
describe('slot forms', () => {
  it('gives every form for every grammar, and singular they takes plural agreement', () => {
    const sentence = (g: Parameters<typeof renderForm>[0]) =>
      `${renderForm(g, 'They')} ${renderForm(g, 'is')} late; ${renderForm(g, 'they')} walk${renderForm(g, 's')} in with `
      + `${renderForm(g, 'their')} own key, which is ${renderForm(g, 'theirs')}, and let${renderForm(g, 's')} ${renderForm(g, 'themself')} in.`;
    expect(sentence('masculine')).toBe('He is late; he walks in with his own key, which is his, and lets himself in.');
    expect(sentence('feminine')).toBe('She is late; she walks in with her own key, which is hers, and lets herself in.');
    expect(sentence('neutral')).toBe('They are late; they walk in with their own key, which is theirs, and let themself in.');
    expect(sentence('plural')).toBe('They are late; they walk in with their own key, which is theirs, and let themselves in.');
  });

  it('defines every form for every grammar', () => {
    for (const g of ['masculine', 'feminine', 'neutral', 'plural'] as const) {
      for (const f of PERSON_FORMS) expect(renderForm(g, f), `${g}.${f}`).toBeTypeOf('string');
    }
  });

  it('capitalises a pronoun form, and refuses a capitalised verb form or a misspelling', () => {
    for (const f of PRONOUN_FORMS) {
      const cap = f.charAt(0).toUpperCase() + f.slice(1);
      expect(parseForm(cap)).toEqual({ form: f, capital: true });
    }
    expect(parseForm('Is')).toBeUndefined();
    expect(parseForm('S')).toBeUndefined();
    expect(parseForm('thier')).toBeUndefined();
    expect(parseForm('THEY')).toBeUndefined();
    expect(renderForm('masculine', 'thier')).toBeUndefined();
  });

  it('reads sex as masculine or feminine — the founder is the one exception, and it is not made here', () => {
    expect(grammarOfSex('male')).toBe('masculine');
    expect(grammarOfSex('female')).toBe('feminine');
  });

  it('parses plain and form tokens with their positions, and ignores runtime lower-case placeholders', () => {
    expect(slotTokens('{HEAD} set down {HEAD.their} cup for {year}.')).toEqual([
      { raw: '{HEAD}', slot: 'HEAD', index: 0 },
      { raw: '{HEAD.their}', slot: 'HEAD', form: 'their', index: 16 },
    ]);
  });

  /**
   * The Original/Plain English parity check counts what this counts. A
   * variant that drops `{HEAD.their}` for a hand-written "his" has dropped
   * the founder's grammar with it, and must not pass as equivalent.
   */
  it('counts a form token as an interpolation, so a variant cannot drop it', () => {
    expect(contentInterpolationTokens('{HEAD} took {HEAD.their} cup.').sort())
      .toEqual(['{HEAD.their}', '{HEAD}']);
    expect(contentInterpolationTokens('{HEAD} took his cup.')).toEqual(['{HEAD}']);
  });

  it('finds hand-written gendered pronouns as words, not inside other words', () => {
    expect(genderedPronounsIn('He gave her his word; she kept hers.').sort())
      .toEqual(['he', 'her', 'hers', 'his', 'she']);
    expect(genderedPronounsIn('The shepherd threw the theme into the heather.')).toEqual([]);
  });

  it('renames a slot with its forms, and leaves a slot whose name merely starts the same', () => {
    expect(renameSlotTokens('{SON} and {SON.their} cup, beside {SONS}.', 'SON', 'HEIR'))
      .toBe('{HEIR} and {HEIR.their} cup, beside {SONS}.');
  });
});
