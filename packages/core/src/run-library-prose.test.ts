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

  it('archives a reviewed ending title without changing the historical run when settings change', () => {
    const ending = content.ending('broken_line');
    if (!ending) throw new Error('Expected multiword ending title');
    const endingFile = content.sourceOf(String(ending.id));
    if (!endingFile) throw new Error('Expected ending provenance');
    const endingAddress = `content:${endingFile}#endings[id=${encodeURIComponent(String(ending.id))}].title`;
    const title = 'The Family Line Has Ended';
    expect(contentProseEntries(endingFile, { endings: [ending] })
      .some((entry) => entry.address === endingAddress)).toBe(true);

    const game = newGame(content, { seed: 413, campaign: 'short', decider: 'chronicler' });
    game.ctx.world.ending = { id: ending.id, year: 1342 };
    const original = libraryRunOf(game.ctx);
    if (!original) throw new Error('Expected a finished run');

    setProseVariants(game.ctx, [{ address: endingAddress, of: proseOriginalHash(ending.title), plainenglish: title }]);
    setProseMode(game.ctx, 'plainenglish');
    const translated = libraryRunOf(game.ctx);
    expect(translated?.ending.title).toBe(title);
    expect(translated?.ending.id).toBe(original.ending.id);
    expect(translated?.id).toBe(original.id);
    expect(missingPlainEnglish(game.ctx)).not.toContain(endingAddress);

    setProseMode(game.ctx, 'original');
    expect(libraryRunOf(game.ctx)?.ending.title).toBe(ending.title);
    expect(translated?.ending.title).toBe(title);
  });

  it('selects a reviewed rival house name before freezing a Library retelling', () => {
    const previous = priorRun();
    const current = newGame(content, { seed: 411, campaign: 'short', decider: 'chronicler' });
    const original = seedLibraryMemories(current.ctx, [previous])
      .find((item) => item.sourceText === claimText);
    if (!original) throw new Error('Expected a baseline inherited memory');
    const house = content.houses.find((row) => !row.isPlayerHouse
      && original.teller.includes(row.name));
    if (!house) throw new Error('Expected a named rival in the Library teller');
    const houseFile = content.sourceOf(String(house.id));
    if (!houseFile) throw new Error('Expected rival source provenance');
    const houseAddress = `content:${houseFile}#houses[id=${encodeURIComponent(String(house.id))}].name`;
    const translatedName = 'The Other Household';
    expect(contentProseEntries(houseFile, { houses: [house] })
      .some((entry) => entry.address === houseAddress)).toBe(true);

    const plain = newGame(content, { seed: 411, campaign: 'short', decider: 'chronicler' });
    setProseVariants(plain.ctx, [{
      address: houseAddress, of: proseOriginalHash(house.name), plainenglish: translatedName,
    }]);
    setProseMode(plain.ctx, 'plainenglish');
    const memory = seedLibraryMemories(plain.ctx, [previous])
      .find((item) => item.sourceText === claimText);
    if (!memory) throw new Error('Expected translated inherited memory');
    expect(memory.teller).toContain(translatedName);
    expect(memory.teller).not.toContain(house.name);
    expect(memory.sourceHouse).toBe(original.sourceHouse);
    expect(memory.claims).toEqual(original.claims);
    expect(missingPlainEnglish(plain.ctx)).not.toContain(houseAddress);
  });
});
