import { describe, expect, it } from 'vitest';
import { loadBundle } from '@ed/content';
import { contentProseEntries, proseOriginalHash } from '@ed/schema';
import {
  missingPlainEnglish, proseForClause, proseForTale, setProseMode, setProseVariants, testWorld,
} from '@ed/core';

describe('Plain English content worklist eligibility (#1104)', () => {
  it('does not report a phantom missing counterpart for a single-word clause name', () => {
    const ctx = testWorld(loadBundle());
    const clause = ctx.content.clauses.find((item) => item.id === 'clause_of_substitution');
    if (!clause) throw new Error('Substitution clause fixture is missing');
    const file = ctx.content.sourceOf(clause.id);
    if (!file) throw new Error('Substitution clause source is missing');
    const base = `content:${file}#clauses[id=${encodeURIComponent(clause.id)}]`;
    const nameAddress = `${base}.name`;
    const textAddress = `${base}.text`;

    expect(contentProseEntries(file, { clauses: [clause] }).map((item) => item.address))
      .not.toContain(nameAddress);
    setProseMode(ctx, 'plainenglish');
    expect(proseForClause(ctx, clause)).toEqual({ name: clause.name, text: clause.text });
    expect(missingPlainEnglish(ctx)).not.toContain(nameAddress);
    expect(missingPlainEnglish(ctx)).toContain(textAddress);
  });

  it('still translates eligible clause names and text, and refuses stale Originals', () => {
    const ctx = testWorld(loadBundle());
    const clause = ctx.content.clauses.find((item) => item.id === 'clause_of_the_term');
    if (!clause) throw new Error('The Term clause fixture is missing');
    const file = ctx.content.sourceOf(clause.id);
    if (!file) throw new Error('The Term source is missing');
    const base = `content:${file}#clauses[id=${encodeURIComponent(clause.id)}]`;
    const nameAddress = `${base}.name`;
    const name = 'The length of the agreement';
    const text = 'The agreement lasts five hundred years from the signing, including the day it was signed. It cannot be extended. Neither party may miss collection.';
    const variants = [
      { address: nameAddress, of: proseOriginalHash(clause.name), plainenglish: name },
      { address: `${base}.text`, of: proseOriginalHash(clause.text), plainenglish: text },
    ];
    setProseVariants(ctx, variants);
    setProseMode(ctx, 'plainenglish');

    expect(proseForClause(ctx, clause)).toEqual({ name, text });
    expect(missingPlainEnglish(ctx)).toEqual([]);

    setProseVariants(ctx, [{ ...variants[0]!, of: '0000000000000000' }, variants[1]!]);
    expect(proseForClause(ctx, clause)).toEqual({ name: clause.name, text });
    expect(missingPlainEnglish(ctx)).toContain(nameAddress);
  });

  it('preserves migration coverage for single-word tale bias', () => {
    const ctx = testWorld(loadBundle());
    const tale = ctx.content.tales.find((item) => item.bias.trim().split(/\s+/).length === 1);
    if (!tale) throw new Error('A single-word tale bias fixture is missing');
    const file = ctx.content.sourceOf(tale.id);
    if (!file) throw new Error('Tale source is missing');
    const address = `content:${file}#tales[id=${encodeURIComponent(tale.id)}].bias`;
    expect(contentProseEntries(file, { tales: [tale] }).map((item) => item.address))
      .toContain(address);
    setProseMode(ctx, 'plainenglish');
    proseForTale(ctx, tale);
    expect(missingPlainEnglish(ctx)).toContain(address);

    setProseVariants(ctx, [{
      address, of: proseOriginalHash(tale.bias), plainenglish: 'wants the audience to agree',
    }]);
    expect(proseForTale(ctx, tale).bias).toBe('wants the audience to agree');
    expect(missingPlainEnglish(ctx)).not.toContain(address);
  });
});
