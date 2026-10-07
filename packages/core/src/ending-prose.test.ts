import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import {
  epilogueOf, setProseMode, setProseVariants, testWorld,
} from '@ed/core';

const content = loadContent();

describe('ending prose variants (#410)', () => {
  it('renders the ending and replayed signing thesis through stable Plain English addresses', () => {
    const ctx = testWorld(content);
    ctx.world.ending = { id: 'forgotten', year: ctx.world.year };
    const original = epilogueOf(ctx)!;

    setProseVariants(ctx, [
      {
        address: 'content:endings.yaml#endings[id=forgotten].title',
        plainenglish: 'The House Is Forgotten',
      },
      {
        address: 'content:endings.yaml#endings[id=forgotten].opening',
        plainenglish: 'The creditor read the whole book and collected nothing.',
      },
      {
        address: 'content:endings.yaml#endings[id=forgotten].ring.owed',
        plainenglish: 'The family kept a page for every year, but that was not enough.',
      },
      {
        address: 'content:endings.yaml#endings[id=forgotten].closing',
        plainenglish: 'The family continued without the old bargain.',
      },
      {
        address: 'content:prologue.yaml#prologue[id=the_signing].thesis',
        plainenglish: 'Later generations did not sign the bargain.',
      },
    ]);
    setProseMode(ctx, 'plainenglish');

    const plain = epilogueOf(ctx)!;
    expect(plain.title).toBe('The House Is Forgotten');
    expect(plain.opening).toBe('The creditor read the whole book and collected nothing.');
    expect(plain.ring[0]).toMatchObject({
      owed: 'The family kept a page for every year, but that was not enough.',
      changed: 'owed',
    });
    expect(plain.closing).toBe('The family continued without the old bargain.');
    expect(plain.thesis).toBe('Later generations did not sign the bargain.');

    setProseMode(ctx, 'original');
    const restored = epilogueOf(ctx)!;
    expect(restored.title).toBe(original.title);
    expect(restored.opening).toBe(original.opening);
    expect(restored.ring[0]!.owed).toBe(original.ring[0]!.owed);
    expect(restored.closing).toBe(original.closing);
    expect(restored.thesis).toBe(original.thesis);
  });
});
