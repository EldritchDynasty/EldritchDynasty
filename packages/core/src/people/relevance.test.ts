import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { proseOriginalHash } from '@ed/schema';
import { coreMessageAddress } from '../messages.js';
import { setProseMode, setProseVariants } from '../prose.js';
import { place, testWorld } from '../testing.js';
import { relevantPeople } from './relevance.js';

const ORIGINAL = "the house's reader of the Ledger";
const PLAIN_ENGLISH = 'reads the Ledger for the house';

describe('Ledger-reader relevance hint (#836)', () => {
  it('shows the current prose mode for archivists and chroniclers without changing who is relevant', () => {
    const ctx = testWorld(loadContent(), 836);
    const archivist = place(ctx, { sex: 'male', age: 34, name: 'Ledger Archivist' });
    const chronicler = place(ctx, { sex: 'female', age: 39, name: 'Ledger Chronicler' });
    const steward = place(ctx, { sex: 'male', age: 40, name: 'Hall Steward' });

    const contract = {
      term: 'yearly' as const,
      wage: 6,
      loyalty: 60,
      boundTo: archivist.id,
      onEmployerDeath: 'passes_to_heir' as const,
      debt: 0,
      knowsSecrets: [],
    };
    archivist.contract = { ...contract, role: 'archivist' };
    chronicler.contract = { ...contract, role: 'chronicler' };
    steward.contract = { ...contract, role: 'steward' };
    ctx.world.houseAmbition = 'restore_ledger';

    setProseVariants(ctx, [{
      address: coreMessageAddress('relevance.ledger_reader'),
      of: proseOriginalHash(ORIGINAL),
      plainenglish: PLAIN_ENGLISH,
    }]);

    setProseMode(ctx, 'original');
    const original = relevantPeople(ctx);
    expect(original.get(archivist.id)).toContain(ORIGINAL);
    expect(original.get(chronicler.id)).toContain(ORIGINAL);
    expect(original.get(steward.id) ?? []).not.toContain(ORIGINAL);

    setProseMode(ctx, 'plainenglish');
    const translated = relevantPeople(ctx);
    expect(translated.get(archivist.id)).toContain(PLAIN_ENGLISH);
    expect(translated.get(chronicler.id)).toContain(PLAIN_ENGLISH);
    expect(translated.get(steward.id) ?? []).not.toContain(PLAIN_ENGLISH);
    expect(translated.get(archivist.id)).not.toContain(ORIGINAL);
    expect(ctx.prose.missing.has(coreMessageAddress('relevance.ledger_reader'))).toBe(false);
  });
});
