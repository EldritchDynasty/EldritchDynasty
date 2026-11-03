import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import {
  CAMPAIGNS, canonical, libraryRunOf, newGame,
} from '@ed/core';
import type { CampaignId, SavedGame } from '@ed/schema';

const content = loadContent();

function fixedLibraryRun(campaign: CampaignId = 'short') {
  const source = newGame(content, { seed: 9090, campaign, decider: 'chronicler' });
  const person = source.ctx.world.people.household(source.ctx.world.playerHouse, source.year)[0]!;
  source.ctx.world.chronicle.push({
    id: 'library_gate_page',
    // A Demonstration ends in 1075; its inherited page must be from its own years.
    year: campaign === 'demo' ? CAMPAIGNS.demo.startYear + 2 : 1200,
    weight: 'paragraph',
    text: `${person.name} was entered in the book as untouched by the rite.`,
    named: true,
    record: 'embellish',
    claims: [{ kind: 'attr', person: person.id, attr: 'madness', value: 0 }],
  });
  source.ctx.world.ending = { id: 'forgotten', year: CAMPAIGNS[campaign].endYear };
  return libraryRunOf(source.ctx)!;
}

function withoutNarrativeMemory(save: SavedGame): string {
  const { libraryMemories: _libraryMemories, counters, ...mechanical } = save;
  const { library: _libraryCounter, ...legacyCounters } = counters;
  // Format 23, the imported memories, and their world-local id cursor are the
  // narrative persistence layer. Everything else must remain byte-identical.
  return canonical({ ...mechanical, counters: legacyCounters, format: 22 });
}

describe('Library of Houses has no material advantage', () => {
  function expectNeutrality(oldHouse: ReturnType<typeof fixedLibraryRun>, seeds: readonly number[]): void {
    // The source campaign (Short or Demonstration) may change the inherited
    // words, not any system of the later Short Line.
    // Stronger than a mean-within-margin check: every paired seed must finish
    // with the same treasury, respect, genomes, acreage, ladder, and ending,
    // because no simulation system is allowed to read libraryMemories.
    for (const seed of seeds) {
      const empty = newGame(content, { seed, campaign: 'short', decider: 'chronicler' });
      const seeded = newGame(content, {
        seed,
        campaign: 'short',
        decider: 'chronicler',
        libraryRuns: [oldHouse],
      });

      empty.advance(CAMPAIGNS.short.years + 1);
      seeded.advance(CAMPAIGNS.short.years + 1);

      expect(seeded.ctx.world.libraryMemories.length, `seed ${seed} imported nothing`).toBeGreaterThan(0);
      expect(
        withoutNarrativeMemory(seeded.save()),
        `seed ${seed}: the library changed something material`,
      ).toBe(withoutNarrativeMemory(empty.save()));
    }
  }

  it('keeps paired Short Lines byte-identical outside the narrative memory field', () => {
    expectNeutrality(fixedLibraryRun(), [811, 912, 1013, 1114]);
  });

  it('imports a completed Demonstration page without changing later Short Line mechanics #2555', () => {
    const demo = fixedLibraryRun('demo');
    expect(demo.campaign).toBe('demo');
    expect(demo.entries.length).toBeGreaterThan(0);
    expectNeutrality(demo, [811, 912]);
  });
});
