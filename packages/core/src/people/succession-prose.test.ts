import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { proseOriginalHash, type ProseMode } from '@ed/schema';
import { coreMessageAddress } from '../messages.js';
import { setProseMode, setProseVariants } from '../prose.js';
import { beget, place, testRng, testWorld } from '../testing.js';
import { coreMessageEntries } from '../tools/core-message-audit.js';
import { dismissRetainer, inheritPost } from './succession.js';

const content = loadContent();
const originals = {
  'service.dismissed': '{PERSON} was dismissed from the house.',
  'service.unpaid': "{PERSON} was not kept on, the quarter's wages being what they were.",
  'service.destitute': '{PERSON} left the house, there being nothing left to pay them with.',
  'service.freed': '{PERSON} was freed by the will of the one who hired them, owing nothing.',
  'service.employer_died': '{PERSON} was released from service, the one who hired them being some years dead.',
  'service.inherited_post': "{HEIR} took up {LAST}'s post, which had been in that family nearly as long as the seal.",
  'service.wanderer_unannounced': '{PERSON} arrived, and nobody had sent for them.',
};

function serviceContext(mode: ProseMode, key: keyof typeof originals, plainenglish: string) {
  const ctx = testWorld(content, 840);
  setProseVariants(ctx, [{
    address: coreMessageAddress(key),
    of: proseOriginalHash(originals[key]),
    plainenglish,
  }]);
  setProseMode(ctx, mode);
  return ctx;
}

function staffContract(boundTo: string, term: 'yearly' | 'hereditary' = 'yearly') {
  return {
    role: 'archivist' as const,
    term,
    wage: 6,
    loyalty: 70,
    boundTo,
    onEmployerDeath: 'passes_to_heir' as const,
    debt: 0,
    knowsSecrets: [],
  };
}

describe('staff service uses prospective Chronicle prose (#840)', () => {
  it('pins all seven exact Original templates and their stable keys', () => {
    const source = readFileSync(new URL('./succession.ts', import.meta.url), 'utf8');
    const found = coreMessageEntries(source)
      .filter((entry) => entry.address.startsWith('core:messages#service.'));
    expect(Object.fromEntries(found.map((entry) => [entry.address, entry.text])))
      .toEqual(Object.fromEntries(
        Object.entries(originals).map(([key, text]) => [coreMessageAddress(key), text]),
      ));
  });

  it('dismisses the same retainer with Original or translated words and keeps the released fact', () => {
    const plain = 'The house dismissed {PERSON} from service.';
    for (const mode of ['original', 'plainenglish'] as const) {
      const ctx = serviceContext(mode, 'service.dismissed', plain);
      const servant = place(ctx, { sex: 'female', age: 30, name: 'Seren' });
      servant.contract = staffContract(ctx.world.playerHouse);
      const ended = dismissRetainer(ctx, servant, testRng('dismissal'));
      const expected = mode === 'original'
        ? 'Seren was dismissed from the house.'
        : 'The house dismissed Seren from service.';
      expect(ended?.text).toBe(expected);
      expect(ended?.reason).toBe('dismissed');
      expect(servant.contract).toBeUndefined();
      expect(ctx.world.chronicle.some((entry) => entry.text === expected)).toBe(true);
    }
  });

  it('inherits the same hereditary post while translating its Chronicle entry', () => {
    const plain = '{HEIR} inherited the staff position previously held by {LAST}.';
    for (const mode of ['original', 'plainenglish'] as const) {
      const ctx = serviceContext(mode, 'service.inherited_post', plain);
      const parent = place(ctx, { sex: 'male', age: 60, name: 'Old Keeper' });
      const child = place(ctx, { sex: 'female', age: 24, name: 'New Keeper' });
      beget(ctx, child, undefined, parent);
      parent.contract = staffContract(ctx.world.playerHouse, 'hereditary');
      ctx.world.people.kill(parent.id, ctx.world.year, 'a fever');

      expect(inheritPost(ctx, 'archivist')?.id).toBe(child.id);
      expect(child.contract?.role).toBe('archivist');
      const expected = mode === 'original'
        ? "New Keeper took up Old Keeper's post, which had been in that family nearly as long as the seal."
        : 'New Keeper inherited the staff position previously held by Old Keeper.';
      expect(ctx.world.chronicle.some((entry) => entry.text === expected)).toBe(true);
    }
  });
});
