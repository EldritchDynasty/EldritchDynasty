import { describe, expect, it } from 'vitest';
import { SigningQuestionS, SigningTermS } from './signing.js';

const baseAnswer = (id: string) => ({
  id,
  says: `Answer ${id}`,
  given: 'Something is given.',
  owed: 'Something is owed.',
  terms: {
    given: [{ kind: 'treasury' as const, amount: 40 }],
    owed: [{ kind: 'treasury' as const, amount: -40 }],
  },
});

describe('The Examination signing schema (#343)', () => {
  it('accepts exactly three paid-for answers', () => {
    const question = SigningQuestionS.parse({
      id: 'the_ford',
      situation: 'A cart waits in the flooded ford.',
      answers: [baseAnswer('back'), baseAnswer('warden'), baseAnswer('wait')],
    });

    expect(question.answers).toHaveLength(3);
    expect(() => SigningQuestionS.parse({
      ...question,
      answers: question.answers.slice(0, 2),
    })).toThrow();
  });

  it('keeps term kinds closed and bounded', () => {
    expect(SigningTermS.parse({
      kind: 'bias',
      who: ['founder'],
      attr: 'strength',
      amount: 0.15,
    })).toMatchObject({ kind: 'bias', attr: 'strength' });

    expect(SigningTermS.parse({
      kind: 'tithe',
      who: ['founders_wife'],
      amount: 0.05,
    })).toMatchObject({ kind: 'tithe', amount: 0.05 });

    expect(SigningTermS.parse({
      kind: 'respect',
      steps: -1,
    })).toEqual({ kind: 'respect', steps: -1 });

    expect(() => SigningTermS.parse({
      kind: 'bias',
      who: ['founder'],
      attr: 'strength',
      amount: 0.75,
    })).toThrow();

    expect(() => SigningTermS.parse({
      kind: 'tithe',
      who: ['founder'],
      amount: 0.25,
    })).toThrow();

    expect(() => SigningTermS.parse({ kind: 'madness', amount: 10 })).toThrow();
    expect(() => SigningTermS.parse({ kind: 'eldritch', amount: 10 })).toThrow();
  });

  it('uses the shared grudge-inheritance vocabulary', () => {
    expect(SigningTermS.parse({
      kind: 'grudge',
      house: 'house_calder',
      severity: 30,
      inheritance: 'heir_only',
    })).toMatchObject({
      kind: 'grudge',
      inheritance: 'heir_only',
    });

    expect(() => SigningTermS.parse({
      kind: 'grudge',
      house: 'house_calder',
      severity: 30,
      inheritance: 'forever',
    })).toThrow();
  });

  it('requires answer ids to be unique within a question', () => {
    expect(() => SigningQuestionS.parse({
      id: 'the_ford',
      situation: 'A cart waits in the flooded ford.',
      answers: [baseAnswer('same'), baseAnswer('same'), baseAnswer('other')],
    })).toThrow(/answer ids must be unique/);
  });

  it('requires stable slug ids and non-empty choice copy', () => {
    const answer = baseAnswer('valid_answer');
    expect(() => SigningQuestionS.parse({
      id: 'Not A Slug',
      situation: 'A situation.',
      answers: [answer, baseAnswer('two'), baseAnswer('three')],
    })).toThrow();

    expect(() => SigningQuestionS.parse({
      id: 'valid_question',
      situation: '',
      answers: [answer, baseAnswer('two'), baseAnswer('three')],
    })).toThrow();
  });
});
