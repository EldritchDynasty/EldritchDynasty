import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { proseOriginalHash } from '@ed/schema';
import { matchFuture, missingPlainEnglish, newGame, type MatchCard } from '@ed/core';
import { coreMessageAddress } from './messages.js';

/** A photographed Match card: all fields are already public, none are genetics. */
function card(patch: Partial<MatchCard> = {}): MatchCard {
  return {
    id: 'future_reading',
    kind: 'household',
    name: 'Dala',
    sex: 'female',
    age: 20,
    house: 'house_test',
    houseName: 'House Test',
    blurb: '',
    dowry: 40,
    kinship: 0,
    line: 'unknown',
    lineSeen: 0,
    words: '',
    papersAsked: 0,
    papersShown: 0,
    panel: { issue: [], woken: [], said: [], ourBook: [] },
    available: true,
    ...patch,
  };
}

function variant(key: string, original: string, plainenglish: string) {
  return { address: coreMessageAddress(`match.future.${key}`), of: proseOriginalHash(original), plainenglish };
}

describe('localised Match futures (#986)', () => {
  it('renders a blood winner through stable message identities without changing its score, confidence or save', () => {
    const session = newGame(loadContent());
    const shown = card({ kinship: 0.0625, blood: 'deep', line: 'ordinary', lineSeen: 3 });
    const frozenCard = structuredClone(shown);
    const saved = JSON.stringify(session.save());
    const original = matchFuture(shown);
    expect(original).toEqual({
      kind: 'blood',
      label: 'Blood',
      confidence: 'clear',
      reasons: [
        'the family papers put this match among close kin',
        'House Test is spoken of as deep blood',
      ],
    });

    session.setProseVariants([
      variant('label.blood', 'Blood', 'Family blood'),
      variant('reason.blood.close-kin', 'the family papers put this match among close kin',
        'the family records show these are close relatives'),
      variant('reason.blood.deep', '{houseName} is spoken of as deep blood',
        '{houseName} is known for its old blood'),
    ]);
    session.setProseMode('plainenglish');
    const translated = session.matchFuture(shown);
    expect(translated).toEqual({
      ...original,
      label: 'Family blood',
      reasons: [
        'the family records show these are close relatives',
        'House Test is known for its old blood',
      ],
    });
    expect(missingPlainEnglish(session.ctx)).toEqual([]);
    expect(shown).toEqual(frozenCard);

    session.setProseMode('original');
    expect(session.matchFuture(shown)).toEqual(original);
    expect(JSON.stringify(session.save())).toBe(saved);
  });

  it('retains a mixed tie and a priority override while translating only the winning reasons', () => {
    const session = newGame(loadContent());
    const shown = card({ kinship: 0.0625, line: 'fertile', lineSeen: 3 });
    const tied = session.matchFuture(shown);
    expect(tied.kind).toBe('blood');
    expect(tied.confidence).toBe('mixed');
    expect(tied.competing).toBe('continuity');

    const prioritised = matchFuture(shown, ['continuity']);
    expect(prioritised.kind).toBe('continuity');
    expect(prioritised.confidence).toBe('clear');
    expect(prioritised.reasons).toEqual([
      'these years make continuity unusually important',
      'the line is called full on 3 completed lives',
    ]);

    session.setProseVariants([
      variant('label.continuity', 'Continuity', 'Family future'),
      variant('reason.priority.continuity', 'these years make continuity unusually important',
        'keeping the family going matters more in these years'),
      variant('reason.continuity.full.many', 'the line is called full on {n} completed lives',
        'the line is considered strong based on {n} completed lives'),
    ]);
    session.setProseMode('plainenglish');
    const translated = session.matchFuture(shown, ['continuity']);
    expect(translated).toEqual({
      ...prioritised,
      label: 'Family future',
      reasons: [
        'keeping the family going matters more in these years',
        'the line is considered strong based on 3 completed lives',
      ],
    });
    expect(missingPlainEnglish(session.ctx)).toEqual([]);

    // No message for a losing case is requested or counted missing.
    expect(missingPlainEnglish(session.ctx)).not.toContain(coreMessageAddress('match.future.label.blood'));
  });

  it('keeps exact Original singular/plural and substituted child counts', () => {
    const session = newGame(loadContent());
    const shown = card({
      line: 'fertile',
      lineSeen: 1,
      panel: {
        issue: [{ name: 'Cesse', relation: 'her mother', borne: 5, grown: 4 }],
        woken: [], said: [], ourBook: [],
      },
    });
    const original = session.matchFuture(shown);
    expect(original.kind).toBe('continuity');
    expect(original.reasons).toEqual([
      'the line is called full on 1 completed life',
      '4 of 5 children in the named line grew up',
    ]);
    session.setProseVariants([
      variant('label.continuity', 'Continuity', 'Family future'),
      variant('reason.continuity.full.one', 'the line is called full on {n} completed life',
        'the line is considered strong from {n} completed life'),
      variant('reason.continuity.full.many', 'the line is called full on {n} completed lives',
        'the line is considered strong from {n} completed lives'),
      variant('reason.continuity.children', '{grown} of {borne} children in the named line grew up',
        '{grown} out of {borne} children in the recorded family reached adulthood'),
    ]);
    session.setProseMode('plainenglish');
    expect(session.matchFuture(shown).reasons).toEqual([
      'the line is considered strong from 1 completed life',
      '4 out of 5 children in the recorded family reached adulthood',
    ]);
    expect(session.matchFuture({ ...shown, lineSeen: 3 }).reasons[0])
      .toBe('the line is considered strong from 3 completed lives');
    expect(missingPlainEnglish(session.ctx)).toEqual([]);
  });

  it('uses Original fallback and records missing, stale and invalid-token translations', () => {
    const session = newGame(loadContent());
    const shown = card();
    const original = matchFuture(shown);
    session.setProseMode('plainenglish');
    expect(session.matchFuture(shown)).toEqual(original);
    expect(missingPlainEnglish(session.ctx)).toEqual([
      coreMessageAddress('match.future.label.mystery'),
      coreMessageAddress('match.future.reason.mystery.empty-panel'),
      coreMessageAddress('match.future.reason.mystery.unknown'),
    ].sort());

    session.setProseVariants([
      variant('label.mystery', 'Older label', 'Unknown'),
      variant('reason.mystery.unknown', 'no completed line anybody here has watched',
        'we have watched {extra} completed line'),
    ]);
    expect(session.matchFuture(shown)).toEqual(original);
    expect(missingPlainEnglish(session.ctx)).toContain(coreMessageAddress('match.future.label.mystery'));
    expect(missingPlainEnglish(session.ctx)).toContain(coreMessageAddress('match.future.reason.mystery.unknown'));
    expect(missingPlainEnglish(session.ctx)).toContain(coreMessageAddress('match.future.reason.mystery.empty-panel'));
  });
});
