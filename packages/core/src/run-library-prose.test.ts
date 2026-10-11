import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { contentProseEntries, proseOriginalHash } from '@ed/schema';
import {
  libraryRunOf, missingPlainEnglish, newGame, seedLibraryMemories, setProseMode, setProseVariants,
} from '@ed/core';

const content = loadContent();
const claimText = 'A witness entered the claim in the family chronicle.';

describe('Plain English inherited Library claims (#410)', () => {
  const trait = content.trait('reads_the_signs');
  if (!trait) throw new Error('Expected the existing named trait');
  const file = content.sourceOf(String(trait.id));
  if (!file) throw new Error('Expected trait source provenance');
  const address = `content:${file}#traits[id=${encodeURIComponent(String(trait.id))}].name`;
  const translated = 'Notices the Clues';

  function priorRun() {
    const source = newGame(content, { seed: 410, campaign: 'short', decider: 'chronicler' });
    const person = source.ctx.world.people.household(source.ctx.world.playerHouse, source.year)[0]!;
    source.ctx.world.chronicle.push({
      id: 'library_trait_translation',
      year: source.year,
      weight: 'paragraph',
      text: claimText,
      named: true,
      claims: [{ kind: 'trait', person: person.id, trait: trait!.id, has: true }],
    });
    source.ctx.world.ending = { id: 'forgotten', year: 1342 };
    const result = libraryRunOf(source.ctx);
    if (!result) throw new Error('Expected a finished Library run');
    return result;
  }

  function retell(mode: 'original' | 'plainenglish', of = proseOriginalHash(trait!.name)) {
    const session = newGame(content, { seed: 411, campaign: 'short', decider: 'chronicler' });
    setProseVariants(session.ctx, [{ address, of, plainenglish: translated }]);
    setProseMode(session.ctx, mode);
    const memory = seedLibraryMemories(session.ctx, [priorRun()])
      .find((item) => item.sourceText === claimText);
    if (!memory) throw new Error('The contradicable trait claim was not selected');
    return { ctx: session.ctx, memory };
  }

  it('uses the worklist address for a named trait in a frozen inherited reading', () => {
    expect(contentProseEntries(file!, { traits: [trait!] }).some((entry) => entry.address === address)).toBe(true);

    const original = retell('original');
    const plain = retell('plainenglish');
    expect(original.memory.text).toContain(trait!.name);
    expect(plain.memory.text).toContain(translated);
    expect(plain.memory.text).not.toContain(trait!.name);
    expect(plain.memory.claims).toEqual(original.memory.claims);
    expect(plain.memory.sourceClaims).toEqual(original.memory.sourceClaims);
    expect(missingPlainEnglish(plain.ctx)).not.toContain(address);

    // The translated memory is a historical page and does not change when
    // the presentation preference changes for the current game.
    const frozen = plain.memory.text;
    setProseMode(plain.ctx, 'original');
    expect(plain.ctx.world.libraryMemories.find((m) => m.id === plain.memory.id)?.text).toBe(frozen);
  });

  it('uses Original when the reviewed wording has become stale', () => {
    const stale = retell('plainenglish', proseOriginalHash('Older trait title'));
    expect(stale.memory.text).toContain(trait!.name);
    expect(stale.memory.text).not.toContain(translated);
    expect(missingPlainEnglish(stale.ctx)).toContain(address);
  });
});
