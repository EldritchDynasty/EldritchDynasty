import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { CAMPAIGNS, epilogueOf, setProseMode, setProseVariants, testWorld } from '@ed/core';

// #2206: these are the exact spoken terms of the shipped campaigns; the game
// supplies the number of years, and the ending's Dunsanian copy spells it out.
const WORDS = {
  demo: 'thirty-three',
  short: 'three hundred',
  long: 'five hundred',
} as const;

const content = loadContent();

describe('ending prose is truthful about each campaign term (#2206)', () => {
  for (const campaign of Object.values(CAMPAIGNS)) {
    for (const mode of ['original', 'plainenglish'] as const) {
      it(`renders every ending for ${campaign.id} in ${mode} without stating the wrong term`, () => {
        for (const def of content.endings) {
          // Deliberately render the same authored ending in each profile, even
          // when its normal selection gate would exclude it. That protects
          // future profile changes and catches copy hidden behind a gate.
          const ctx = testWorld(content, 2206, campaign.endYear);
          ctx.world.campaign = campaign.id;
          ctx.world.ending = { id: def.id, year: campaign.endYear };
          setProseVariants(ctx, content.proseVariants);
          setProseMode(ctx, mode);

          const view = epilogueOf(ctx);
          expect(view).toBeDefined();
          expect(view!.id).toBe(def.id);

          const prose = [
            view!.opening,
            view!.closing,
            ...view!.ring.flatMap((beat) => [beat.given, beat.owed]),
          ].join(' ');

          // Only Forgotten's campaign-term copy is governed by #2206.
          // Other endings can contain independent historical references to
          // five hundred years, even when rendered under a shorter profile.
          if (def.id === 'forgotten' && campaign.id !== 'long') {
            expect(prose, `${campaign.id}/${mode}/${def.id}`).not.toContain('five hundred years');
          }

          if (def.id === 'forgotten') {
            const term = `${WORDS[campaign.id]} years`;
            expect(view!.opening).toContain(`for ${term}`);
            expect(view!.ring[0]!.owed).toContain(`for ${term}`);
            // A rendered view must not leak placeholders into the player UI.
            expect(prose).not.toMatch(/\{(?:years|termYears)\}/);
            if (campaign.id === 'long' && mode === 'original') {
              // Long Line remains byte-for-byte the original authored reading.
              expect(view!.opening).toBe(def.opening);
              expect(view!.ring[0]!.owed).toBe(def.ring.owed);
            }
          }
        }
      });
    }
  }
});
