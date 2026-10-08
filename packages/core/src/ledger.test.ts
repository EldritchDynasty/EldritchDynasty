import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { asId, contentProseEntries, type ActiveAge, type Person } from '@ed/schema';
import {
  bootstrap, loadGame, missingPlainEnglish, place, revealClause, saveGame, setProseMode, setProseVariants,
} from '@ed/core';

const bundle = loadContent();

/**
 * THE CLAUSE-REVEAL RULES, ASSERTED DIRECTLY.
 *
 * `ledger.slow.test.ts` measures what a thousand-year run RECOVERS, which is
 * the right test for the balance and the wrong one for the rules: it takes
 * fifty seconds, and every one of its numbers moves when anything upstream of
 * the Ledger moves. When the economy bug was found — houses pinned to the
 * debt floor could not pay an archivist, so they recovered two clauses of
 * nine — every rule in `revealClause` was working correctly and the suite
 * still went red, because nothing separated "the rules are wrong" from "the
 * house was too poor to reach them".
 *
 * These do the separating. Each one builds the exact world state its rule is
 * about and calls `revealClause` once. They are fast, they do not care what
 * the economy is doing, and between them they pin every branch of the
 * function — so a future change that quietly drops one has to fail HERE,
 * naming the rule, rather than as a drifted median four files away.
 */

/** The one thing `revealClause` demands of the house: somebody keeping records. */
function hireArchivist(ctx: ReturnType<typeof bootstrap>): Person {
  return place(ctx, {
    sex: 'female',
    age: 34,
    name: 'The Test Archivist',
    contract: {
      role: 'archivist',
      term: 'lifetime',
      wage: 5,
      loyalty: 66,
      boundTo: 'house_gearithy',
      onEmployerDeath: 'passes_to_heir',
      debt: 0,
      knowsSecrets: [],
    },
  });
}

function hireChronicler(ctx: ReturnType<typeof bootstrap>): Person {
  return place(ctx, {
    sex: 'male',
    age: 34,
    name: 'The Test Chronicler',
    contract: {
      role: 'chronicler',
      term: 'lifetime',
      wage: 5,
      loyalty: 52,
      boundTo: 'house_gearithy',
      onEmployerDeath: 'passes_to_heir',
      debt: 0,
      knowsSecrets: [asId('what_the_archive_holds')],
    },
  });
}

/** An Age sitting active and already named — the state a clause is paid in. */
function activeNamed(age: string): ActiveAge {
  return { age, began: 1042, named: true, namedAt: 1042, paid: { standing: false } };
}

describe('Ledger content contract', () => {
  it('starts with exactly the one authored opening clause', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const opening = bundle.clauses.filter((clause) => clause.known);
    expect(opening).toHaveLength(1);
    expect([...ctx.world.clausesRecovered]).toEqual(opening.map((clause) => clause.id));
  });

  it('keeps the nine-clause contract explicit', () => {
    expect(bundle.clauses).toHaveLength(9);
  });
});

describe('Ledger pages in the selected prose mode', () => {
  const clause = bundle.clauses.find((item) => item.id === 'clause_of_the_blood_entire')!;
  const base = `content:clauses.yaml#clauses[id=${clause.id}]`;
  const plain = { name: 'The Whole Bloodline', text: 'The whole bloodline owes the debt. Dividing it among heirs does not reduce it.' };

  it.each([
    { mode: 'original' as const, translatedName: false, translatedText: false, provenance: true },
    { mode: 'plainenglish' as const, translatedName: true, translatedText: true, provenance: true },
    { mode: 'plainenglish' as const, translatedName: true, translatedText: false, provenance: true },
    { mode: 'plainenglish' as const, translatedName: false, translatedText: false, provenance: false },
  ])('writes the selected fields with Original fallback: %j', ({ mode, translatedName, translatedText, provenance }) => {
    const ctx = bootstrap(provenance ? bundle : structuredClone(bundle.bundle), 1042, 1042);
    hireArchivist(ctx);
    const active = activeNamed('the_long_peace');
    setProseVariants(ctx, [
      { address: `${base}.name`, plainenglish: plain.name },
      ...(translatedText ? [{ address: `${base}.text`, plainenglish: plain.text }] : []),
    ]);
    setProseMode(ctx, mode);

    const entries = contentProseEntries('clauses.yaml', { clauses: [clause] });
    expect(entries.map((entry) => entry.address)).toContain(`${base}.name`);
    expect(entries.map((entry) => entry.address)).toContain(`${base}.text`);
    expect(revealClause(ctx, active)).toBe(clause.id);
    expect(active.paid.clause).toBe(clause.id);
    expect(ctx.world.clausesRecovered.has(clause.id)).toBe(true);
    expect(ctx.world.chronicle.at(-1)).toMatchObject({
      weight: 'illuminated', named: true,
      title: translatedName ? plain.name : clause.name,
      text: translatedText ? plain.text : clause.text,
    });
    expect(missingPlainEnglish(ctx)).toEqual(
      mode === 'plainenglish' && provenance && !translatedText ? [`${base}.text`] : [],
    );
    expect(revealClause(ctx, active)).toBeUndefined();
  });

  it('preserves written wording across mode changes and reload while later reveals use the new mode', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    hireArchivist(ctx);
    revealClause(ctx, activeNamed('the_long_peace'));
    const originalPage = structuredClone(ctx.world.chronicle.at(-1)!);
    setProseMode(ctx, 'plainenglish');
    expect(ctx.world.chronicle.at(-1)).toEqual(originalPage);

    const restored = loadGame(saveGame(ctx), bundle);
    setProseMode(restored, 'plainenglish');
    expect(restored.world.chronicle.at(-1)).toEqual(originalPage);
    const next = restored.content.clauses
      .filter((item) => item.ages.includes('the_long_peace') && !restored.world.clausesRecovered.has(item.id))
      .sort((a, b) => a.weight - b.weight)[0]!;
    const address = `content:clauses.yaml#clauses[id=${next.id}]`;
    setProseVariants(restored, [
      { address: `${address}.name`, plainenglish: 'The Newly Read Clause' },
      { address: `${address}.text`, plainenglish: 'The words chosen for the next page.' },
    ]);
    expect(revealClause(restored, activeNamed('the_long_peace'))).toBe(next.id);
    expect(restored.world.chronicle.slice(-2)).toEqual([
      originalPage,
      expect.objectContaining({ title: 'The Newly Read Clause', text: 'The words chosen for the next page.' }),
    ]);
    setProseMode(restored, 'original');
    expect(loadGame(saveGame(restored), bundle).world.chronicle).toEqual(restored.world.chronicle);
  });
});

describe('revealClause (concept §18)', () => {
  it('pays a house that is keeping records', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    hireArchivist(ctx);
    const active = activeNamed('the_long_peace');

    const paid = revealClause(ctx, active);
    expect(paid, 'a named clause-bearing Age paid nothing to a house with an archivist').toBeTruthy();
    expect(ctx.world.clausesRecovered.has(paid!)).toBe(true);
    expect(active.paid.clause).toBe(paid);
  });

  it('also pays a house whose Chronicler is keeping the record', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    hireChronicler(ctx);
    const active = activeNamed('the_long_peace');

    const paid = revealClause(ctx, active);
    expect(paid, 'a named clause-bearing Age paid nothing to a house with a Chronicler').toBeTruthy();
    expect(active.paid.clause).toBe(paid);
  });

  /**
   * The load-bearing rule, and the one with no other guard on it. It is the
   * whole reason the Ledger is something the player causes rather than
   * something the calendar does — and deleting the check would leave every
   * slow assertion in `ledger.slow.test.ts` comfortably green, because
   * recovering MORE clauses breaks none of them.
   */
  it('pays nothing to a house with nobody writing it down', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const before = ctx.world.clausesRecovered.size;
    const active = activeNamed('the_long_peace');

    expect(revealClause(ctx, active)).toBeUndefined();
    expect(ctx.world.clausesRecovered.size).toBe(before);
    expect(active.paid.clause).toBeUndefined();
  });

  /**
   * Paid at NAMING, not at onset: a clause arriving in the chronicle is how
   * the player learns the Age was a real thing and not weather.
   */
  it('pays nothing until the chronicle has named the Age', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    hireArchivist(ctx);
    const unnamed: ActiveAge = { age: 'the_long_peace', began: 1042, named: false, paid: { standing: false } };

    expect(revealClause(ctx, unnamed)).toBeUndefined();
    expect(unnamed.paid.clause).toBeUndefined();
  });

  it('pays each Age exactly once, however many years it runs', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    hireArchivist(ctx);
    const active = activeNamed('the_long_peace');

    const first = revealClause(ctx, active);
    expect(first).toBeTruthy();
    expect(revealClause(ctx, active), 'the same Age paid twice').toBeUndefined();
    expect(revealClause(ctx, active)).toBeUndefined();
  });

  it('pays nothing for an Age excused the clause duty', () => {
    const excused = bundle.ages.find((a) => !a.clauseBearing);
    if (!excused) return; // all Ages currently bear clauses; nothing to assert
    const ctx = bootstrap(bundle, 1042, 1042);
    hireArchivist(ctx);
    expect(revealClause(ctx, activeNamed(excused.id))).toBeUndefined();
  });

  /**
   * PER-AGE ASSIGNMENT (issue #4). `revealClause` draws from the ACTIVE Age's
   * own assigned set rather than global weight order — which is what makes
   * WHICH clauses a run recovers depend on which Ages it drew, rather than
   * only how many. Asserted against every Age, so an Age added to content
   * without a clause assignment cannot pay out somebody else's clause.
   */
  it('only ever pays a clause the active Age is assigned', () => {
    for (const age of bundle.ages) {
      if (!age.clauseBearing) continue;
      const ctx = bootstrap(bundle, 1042, 1042);
      hireArchivist(ctx);

      const paid = revealClause(ctx, activeNamed(age.id));
      if (!paid) continue; // this Age's clauses were all opening-clause already
      const clause = bundle.clauses.find((c) => c.id === paid)!;
      expect(clause.ages, `${age.id} paid out '${paid}', which is not assigned to it`).toContain(age.id);
    }
  });

  /**
   * "An Age whose assigned clauses are already gone simply pays nothing this
   * time" — so a clause-bearing Age occurring is NOT the same thing as a
   * clause reveal, and the difference is what stops a long run from handing
   * over all nine by 1400.
   */
  it('pays nothing once the Age\'s own clauses are all recovered', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    hireArchivist(ctx);
    for (const c of bundle.clauses) ctx.world.clausesRecovered.add(c.id);

    const active = activeNamed('the_long_peace');
    expect(revealClause(ctx, active)).toBeUndefined();
    expect(active.paid.clause).toBeUndefined();
  });

  /**
   * Low weight first: the early clauses establish that the debt is real and
   * exact, the late ones close the doors the player has been walking toward.
   */
  it('reveals an Age\'s assigned clauses in weight order', () => {
    const age = 'the_long_peace';
    const assigned = bundle.clauses
      .filter((c) => c.ages.includes(age) && !c.known)
      .sort((a, b) => a.weight - b.weight);
    expect(assigned.length, `${age} has fewer than two assignable clauses to order`)
      .toBeGreaterThan(1);

    const ctx = bootstrap(bundle, 1042, 1042);
    hireArchivist(ctx);
    const got: string[] = [];
    for (let i = 0; i < assigned.length; i++) {
      const paid = revealClause(ctx, activeNamed(age));
      if (paid) got.push(paid);
    }
    expect(got).toEqual(assigned.map((c) => c.id));
  });
});
