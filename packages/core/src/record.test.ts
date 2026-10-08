import { describe, expect, it } from 'vitest';
import { CONTENT_ROOT, loadContent } from '@ed/content';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { asId, ClaimS, proseOriginalHash } from '@ed/schema';
import {
  applyEffect, applyRecord, beget, bootstrap, deriveRecordView, marry,
  pedigreeF, place, poolScore, realizedHomozygosityOf, resolveClaim, revealPower, visibleRecordView,
} from '@ed/core';

const bundle = loadContent();

describe('resolving a claim', () => {
  it('resolves its target the same way an effect does', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const p = place(ctx, { sex: 'male', age: 30 });
    const resolved = resolveClaim(
      { kind: 'attr', target: { slot: 'X' }, attr: 'madness', value: 40 },
      ctx,
      { X: p.id },
    );
    expect(resolved).toEqual([{ kind: 'attr', person: p.id, attr: 'madness', value: 40 }]);
  });

  it('a death claim with no year fills in the resolution year', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const p = place(ctx, { sex: 'female', age: 30 });
    const [claim] = resolveClaim({ kind: 'death', target: { slot: 'X' }, cause: 'a fall' }, ctx, { X: p.id });
    expect(claim).toEqual({ kind: 'death', person: p.id, year: ctx.world.year, cause: 'a fall' });
  });
});

describe('deriveRecordView — the record layer (issue #19)', () => {
  it('with no claims ever made, shows nothing diverging', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const p = place(ctx, { sex: 'male', age: 30 });
    const view = deriveRecordView(ctx, p.id);
    expect(view.attrs.size).toBe(0);
    expect(view.divergence.size).toBe(0);
    expect([...view.claimedTraits]).toEqual([...p.traits].map(String));
  });

  it('an attribute claim that disagrees with the truth is sigil drift', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const p = place(ctx, { sex: 'male', age: 30 });
    p.madness = 40;
    ctx.world.chronicle.push({
      year: ctx.world.year, weight: 'line', text: 'claimed', named: false,
      claims: [{ kind: 'attr', person: p.id, attr: 'madness', value: 0 }],
    });

    const view = deriveRecordView(ctx, p.id);
    expect(view.attrs.get('madness')).toBe(0);
    expect(view.divergence.has('attr:madness')).toBe(true);
  });

  it('an attribute claim close enough to the truth is not drift — chronicler rounding, not a lie', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const p = place(ctx, { sex: 'male', age: 30 });
    p.madness = 40;
    ctx.world.chronicle.push({
      year: ctx.world.year, weight: 'line', text: 'claimed', named: false,
      claims: [{ kind: 'attr', person: p.id, attr: 'madness', value: 40.4 }],
    });
    expect(deriveRecordView(ctx, p.id).divergence.size).toBe(0);
  });

  it('a non-recordable attribute claim is ignored entirely', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const p = place(ctx, { sex: 'male', age: 30 });
    ctx.world.chronicle.push({
      year: ctx.world.year, weight: 'line', text: 'claimed', named: false,
      claims: [{ kind: 'attr', person: p.id, attr: 'nonexistent_attribute', value: 999 }],
    });
    const view = deriveRecordView(ctx, p.id);
    expect(view.attrs.has('nonexistent_attribute')).toBe(false);
    expect(view.divergence.size).toBe(0);
  });

  it('a trait claim that adds a trait the person does not hold is drift', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const p = place(ctx, { sex: 'male', age: 30 });
    ctx.world.chronicle.push({
      year: ctx.world.year, weight: 'line', text: 'claimed', named: false,
      claims: [{ kind: 'trait', person: p.id, trait: 'hard_hands', has: true }],
    });
    const view = deriveRecordView(ctx, p.id);
    expect(view.claimedTraits.has('hard_hands')).toBe(true);
    expect(view.divergence.has('trait:hard_hands')).toBe(true);
  });

  it('a trait claim that removes a trait the person actually holds is also drift', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const p = place(ctx, { sex: 'male', age: 30, traits: ['hard_hands'] });
    ctx.world.chronicle.push({
      year: ctx.world.year, weight: 'line', text: 'claimed', named: false,
      claims: [{ kind: 'trait', person: p.id, trait: 'hard_hands', has: false }],
    });
    const view = deriveRecordView(ctx, p.id);
    expect(view.claimedTraits.has('hard_hands')).toBe(false);
    expect(view.divergence.has('trait:hard_hands')).toBe(true);
  });

  it('a claimed death for someone alive and well is sigil drift — the vessel rite\'s own shape', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const p = place(ctx, { sex: 'female', age: 25 });
    ctx.world.chronicle.push({
      year: ctx.world.year, weight: 'line', text: 'claimed', named: false,
      claims: [{ kind: 'death', person: p.id, year: ctx.world.year, cause: 'went north' }],
    });
    const view = deriveRecordView(ctx, p.id);
    expect(view.claimedDeath).toEqual({ year: ctx.world.year, cause: 'went north' });
    expect(view.divergence.has('death')).toBe(true);
  });

  it('a claimed death that matches the real one is not drift', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const p = place(ctx, { sex: 'male', age: 90 });
    ctx.world.people.kill(p.id, ctx.world.year, 'the years');
    ctx.world.chronicle.push({
      year: ctx.world.year, weight: 'line', text: 'claimed', named: false,
      claims: [{ kind: 'death', person: p.id, year: p.died!, cause: p.causeOfDeath! }],
    });
    expect(deriveRecordView(ctx, p.id).divergence.has('death')).toBe(false);
  });

  it('later claims about the same fact win over earlier ones', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const p = place(ctx, { sex: 'male', age: 30 });
    ctx.world.chronicle.push({
      year: ctx.world.year, weight: 'line', text: 'first', named: false,
      claims: [{ kind: 'attr', person: p.id, attr: 'strength', value: 10 }],
    });
    ctx.world.chronicle.push({
      year: ctx.world.year + 5, weight: 'line', text: 'second', named: false,
      claims: [{ kind: 'attr', person: p.id, attr: 'strength', value: 90 }],
    });
    expect(deriveRecordView(ctx, p.id).attrs.get('strength')).toBe(90);
  });
});

describe('applyRecord actually attaches claims (issue #19 end to end)', () => {
  it('an embellished option\'s claims land on the chronicle entry it rewrites', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const child = place(ctx, { sex: 'male', age: 10 });
    child.madness = 20;

    const event = bundle.events.find((e) => e.id === 'the_drowning')!;
    ctx.world.chronicle.push({ id: 'entry_1', year: ctx.world.year, weight: 'paragraph', text: 'placeholder', named: false });

    applyRecord(ctx, event, 'entry_1', 'embellish', { CHILD: child.id });

    const entry = ctx.world.chronicle.find((c) => c.id === 'entry_1')!;
    expect(entry.claims).toEqual([{ kind: 'attr', person: child.id, attr: 'madness', value: 0 }]);

    const view = deriveRecordView(ctx, child.id);
    expect(view.divergence.has('attr:madness')).toBe(true);
  });

  it('the same event writes a truthful claim or a divergent lie about the same person (issue #138)', () => {
    const honest = bootstrap(bundle, 138, 1042);
    const forged = bootstrap(bundle, 138, 1042);
    const honestChild = place(honest, { sex: 'male', age: 10 });
    const forgedChild = place(forged, { sex: 'male', age: 10 });
    expect(forgedChild.id).toBe(honestChild.id);
    honestChild.madness = 20;
    forgedChild.madness = 20;

    const event = bundle.events.find((e) => e.id === 'the_drowning')!;
    honest.world.chronicle.push({
      id: 'paired_page', year: honest.world.year, weight: 'paragraph', text: 'placeholder', named: false,
    });
    forged.world.chronicle.push({
      id: 'paired_page', year: forged.world.year, weight: 'paragraph', text: 'placeholder', named: false,
    });

    applyRecord(honest, event, 'paired_page', 'record', { CHILD: honestChild.id });
    applyRecord(forged, event, 'paired_page', 'embellish', { CHILD: forgedChild.id });

    const honestEntry = honest.world.chronicle.find((c) => c.id === 'paired_page')!;
    const forgedEntry = forged.world.chronicle.find((c) => c.id === 'paired_page')!;
    expect(honestEntry.claims?.[0]?.person).toBe(honestChild.id);
    expect(forgedEntry.claims?.[0]?.person).toBe(forgedChild.id);
    expect(honestEntry.claims).not.toEqual(forgedEntry.claims);

    const honestView = deriveRecordView(honest, honestChild.id);
    const forgedView = deriveRecordView(forged, forgedChild.id);
    expect(honestView.attrs.has('madness')).toBe(false);
    expect(honestView.divergence.has('attr:madness')).toBe(false);
    expect(forgedView.attrs.get('madness')).toBe(0);
    expect(forgedView.divergence.has('attr:madness')).toBe(true);
  });

  it('omit carries no claims — the blank is the artefact', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const child = place(ctx, { sex: 'male', age: 10 });
    const event = bundle.events.find((e) => e.id === 'the_drowning')!;
    ctx.world.chronicle.push({ id: 'entry_2', year: ctx.world.year, weight: 'paragraph', text: 'placeholder', named: false });

    applyRecord(ctx, event, 'entry_2', 'omit', { CHILD: child.id });
    expect(ctx.world.chronicle.find((c) => c.id === 'entry_2')!.claims).toBeUndefined();
  });
});

describe('the forging path (issue #19)', () => {
  it('forge_lineage moves claimedParents and leaves trueParents alone', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const bride = place(ctx, { sex: 'female', age: 20 });
    const stranger = place(ctx, { sex: 'female', age: 55 });
    const trueMother = bride.trueParents.mother;

    applyEffect(
      { kind: 'forge_lineage', target: { slot: 'BRIDE' }, parent: 'mother', claimedAs: 'GRANDMOTHER', notarisedBy: 'a defunct house', generations: 3 },
      ctx,
      { BRIDE: bride.id, GRANDMOTHER: stranger.id },
    );

    expect(bride.claimedParents.mother).toBe(stranger.id);
    expect(bride.trueParents.mother).toBe(trueMother);
    expect(bride.lineageDocuments.some((d) => d.forged)).toBe(true);
  });

  it('is a no-op when the claimed slot was never cast', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const bride = place(ctx, { sex: 'female', age: 20 });
    const before = { ...bride.claimedParents };

    applyEffect(
      { kind: 'forge_lineage', target: { slot: 'BRIDE' }, parent: 'mother', claimedAs: 'GRANDMOTHER', notarisedBy: 'nobody', generations: 3 },
      ctx,
      { BRIDE: bride.id },
    );
    expect(bride.claimedParents).toEqual(before);
  });
});

describe('pedigreeF vs realized homozygosity disagreeing (issue #19)', () => {
  it('pedigreeF reads the claimed pedigree — forging it to unrelated strangers erases the common ancestry it would otherwise show', () => {
    const ctx = bootstrap(bundle, 1042, 1042);

    // A real full-sibling pairing on paper: `beget` sets parentage bookkeeping
    // (`trueParents`/`claimedParents`), which is exactly what `pedigreeF`
    // walks — it does not touch genomes, so this is the honest test of the
    // DOCUMENT-reading half of the disagreement.
    const gpa = place(ctx, { sex: 'male', age: 70, name: 'GrandpaX' });
    const gma = place(ctx, { sex: 'female', age: 68, name: 'GrandmaX' });
    const son = place(ctx, { sex: 'male', age: 30, name: 'SonX' });
    const daughter = place(ctx, { sex: 'female', age: 28, name: 'DaughterX' });
    beget(ctx, son, gma, gpa);
    beget(ctx, daughter, gma, gpa);
    marry(ctx, son, daughter);
    const child = place(ctx, { sex: 'male', age: 1, name: 'ChildX' });
    beget(ctx, child, daughter, son);

    const honestF = pedigreeF(ctx, child.id);
    // Full-sib mating, two shared grandparents at n1=n2=1: F = 2 * 0.5^3 = 0.25.
    expect(honestF).toBeCloseTo(0.25, 5);

    // Now forge the documents: two unrelated strangers stand in as parents.
    // `realizedHomozygosityOf` reads the GENOME (see the next test) and is
    // computed independently of any of this — the two numbers disagreeing is
    // the forged-dowry economy working, not a bug to reconcile.
    const strangerA = place(ctx, { sex: 'female', age: 50, name: 'StrangerA' });
    const strangerB = place(ctx, { sex: 'male', age: 52, name: 'StrangerB' });
    child.claimedParents = { mother: strangerA.id, father: strangerB.id };

    const forgedF = pedigreeF(ctx, child.id);
    expect(forgedF, 'a forged pedigree naming unrelated strangers should show no common ancestry').toBe(0);
    expect(forgedF).toBeLessThan(honestF);
  });

  it('realized homozygosity is unmoved by a claimedParents edit — it reads the genome, not the documents', () => {
    const ctx = bootstrap(bundle, 909, 1042);
    const p = place(ctx, { sex: 'male', age: 30 });
    const before = realizedHomozygosityOf(ctx, p.id);
    p.claimedParents = { mother: asId('nobody'), father: asId('nobody_else') };
    expect(realizedHomozygosityOf(ctx, p.id)).toBe(before);
  });
});

describe('the ChronicleQuery claim predicate (issue #19, extending v1)', () => {
  it('a record pool can score off claims of a given kind', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    ctx.world.chronicle.push({
      year: ctx.world.year, weight: 'line', text: 'x', named: false,
      claims: [{ kind: 'attr', person: 'p1', attr: 'madness', value: 0 }],
    });
    ctx.world.chronicle.push({ year: ctx.world.year, weight: 'line', text: 'y', named: false });

    const score = poolScore(ctx, { kind: 'record', against: { hasClaim: { kind: 'attr', attr: 'madness' }, measure: 'count' } }, {});
    expect(score).toBe(1);
  });

  it('narrows by attr/trait name and does not match a different one', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    ctx.world.chronicle.push({
      year: ctx.world.year, weight: 'line', text: 'x', named: false,
      claims: [{ kind: 'attr', person: 'p1', attr: 'strength', value: 10 }],
    });
    const score = poolScore(ctx, { kind: 'record', against: { hasClaim: { kind: 'attr', attr: 'madness' }, measure: 'count' } }, {});
    expect(score).toBe(0);
  });
});

describe('reveal_signs — the perception layer\'s modifier, closed here (issue #19)', () => {
  it('below the reveal threshold, the household sees the record, not the truth', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const p = place(ctx, { sex: 'male', age: 30 });
    p.madness = 40;
    ctx.world.chronicle.push({
      year: ctx.world.year, weight: 'line', text: 'x', named: false,
      claims: [{ kind: 'attr', person: p.id, attr: 'madness', value: 0 }],
    });
    // The founding cast already carries one sign-reader (0.7) — under the
    // 1.0 threshold on its own, which is the point: one is not enough.
    const roster = ctx.world.people.household(ctx.world.playerHouse, ctx.world.year);
    expect(revealPower(ctx, roster)).toBeLessThan(1);
    expect(visibleRecordView(ctx, p.id, roster).attrs.get('madness')).toBe(0);
  });

  it('enough sign-reading power in the household sees through the record entirely', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const p = place(ctx, { sex: 'male', age: 30 });
    p.madness = 40;
    ctx.world.chronicle.push({
      year: ctx.world.year, weight: 'line', text: 'x', named: false,
      claims: [{ kind: 'attr', person: p.id, attr: 'madness', value: 0 }],
    });
    // Two sign-readers (0.7 each) clear the 1.0 threshold.
    place(ctx, { sex: 'female', age: 40, traits: ['reads_the_signs'] });
    place(ctx, { sex: 'female', age: 45, traits: ['reads_the_signs'] });

    const roster = ctx.world.people.household(ctx.world.playerHouse, ctx.world.year);
    expect(revealPower(ctx, roster)).toBeGreaterThanOrEqual(1);
    const view = visibleRecordView(ctx, p.id, roster);
    expect(view.attrs.get('madness')).toBeCloseTo(40, 5);
    expect(view.divergence.size).toBe(0);
  });
});

describe('the pen may claim one rung, and only while it is believed (issue #77)', () => {
  /** An embellished Record block on a fresh entry, and what it wrote. */
  function embellish(ctx: ReturnType<typeof bootstrap>, id: string) {
    const child = place(ctx, { sex: 'male', age: 10 });
    const event = bundle.events.find((e) => e.id === 'the_drowning')!;
    ctx.world.chronicle.push({ id, year: ctx.world.year, weight: 'paragraph', text: 'placeholder', named: false });
    applyRecord(ctx, event, id, 'embellish', { CHILD: child.id });
    return ctx.world.chronicle.find((c) => c.id === id)!;
  }

  it('writes the house onto the rung above the one it reached', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    ctx.world.respect = 'eminent';
    // Still standing where it got to — `rung` is now, `best` is the
    // high-water mark, and the pen may only round up from a rung the house
    // is actually holding.
    ctx.world.ascension.rung = 'adept';
    ctx.world.ascension.best = 'adept';

    expect(embellish(ctx, 'forge_1').rung).toBe('hierophant');
  });

  it('writes nothing for a house nobody has heard of', () => {
    // The credibility gate. `eminent` is the tier §22 asks for at the top of
    // the real ladder, and an unknown house has no credit to spend on a lie
    // this size — this is the lie the world is PREPARED to believe.
    const ctx = bootstrap(bundle, 1042, 1042);
    ctx.world.respect = 'known';
    ctx.world.ascension.rung = 'adept';
    ctx.world.ascension.best = 'adept';

    expect(embellish(ctx, 'forge_2').rung).toBeUndefined();
  });

  it('never gets to two rungs, however many times it is told', () => {
    // The claim is computed fresh off `world.ascension.best` every time, so
    // embellishing all century long buys exactly one rung. The book can round
    // up; it cannot invent a career.
    const ctx = bootstrap(bundle, 1042, 1042);
    ctx.world.respect = 'exalted';
    ctx.world.ascension.rung = 'touched';
    ctx.world.ascension.best = 'touched';

    for (let i = 0; i < 8; i++) {
      expect(embellish(ctx, `forge_many_${i}`).rung).toBe('adept');
    }
  });

  it('leaves a true page alone', () => {
    // `tickAscension`'s own page is the house's evidence. An embellishment
    // that landed on it would trade a rung it can prove for one it cannot.
    const ctx = bootstrap(bundle, 1042, 1042);
    ctx.world.respect = 'eminent';
    ctx.world.ascension.rung = 'adept';
    ctx.world.ascension.best = 'adept';

    const child = place(ctx, { sex: 'male', age: 10 });
    const event = bundle.events.find((e) => e.id === 'the_drowning')!;
    ctx.world.chronicle.push({
      id: 'true_page', year: ctx.world.year, weight: 'paragraph', text: 'placeholder', named: false, rung: 'adept',
    });
    applyRecord(ctx, event, 'true_page', 'embellish', { CHILD: child.id });

    expect(ctx.world.chronicle.find((c) => c.id === 'true_page')!.rung).toBe('adept');
  });

  it('writes nothing for a house that has already fallen off its own high-water mark', () => {
    // THE GATE THAT MADE THIS A VARIABLE INSTEAD OF A CONSTANT. Without it,
    // the book said more than the house did in 20 measured runs of 20: the
    // chronicler embellishes a fifth of the time and a thousand-year house is
    // eminent by the end, so a forged rung stopped being something that could
    // happen and became something that always did.
    //
    // `best` is remembered forever — a family that made a Hierophant made one
    // (invariant 14). The PEN does not get the same licence: claiming a rung
    // above one nobody in the house is standing on any more is not
    // embellishment, it is invention.
    const ctx = bootstrap(bundle, 1042, 1042);
    ctx.world.respect = 'exalted';
    ctx.world.ascension.rung = 'touched';
    ctx.world.ascension.best = 'hierophant';

    expect(embellish(ctx, 'forge_fallen').rung).toBeUndefined();
  });

  it('records and omissions claim no rung at all', () => {
    // Only the embellishment forges. A house that wrote the truth down, or
    // wrote nothing, has not claimed anything to be caught out in.
    const ctx = bootstrap(bundle, 1042, 1042);
    ctx.world.respect = 'exalted';
    ctx.world.ascension.rung = 'adept';
    ctx.world.ascension.best = 'adept';
    const child = place(ctx, { sex: 'male', age: 10 });
    const event = bundle.events.find((e) => e.id === 'the_drowning')!;

    for (const option of ['record', 'omit'] as const) {
      const id = `honest_${option}`;
      ctx.world.chronicle.push({ id, year: ctx.world.year, weight: 'paragraph', text: 'placeholder', named: false });
      applyRecord(ctx, event, id, option, { CHILD: child.id });
      expect(ctx.world.chronicle.find((c) => c.id === id)!.rung).toBeUndefined();
    }
  });
});

/**
 * #584: an unquoted comma inside a YAML flow-map claim silently split
 * the deed into a shortened text and an unknown null-valued key. The
 * schema discarded the latter, leaving an apparently valid Record.
 */
describe('Crusade chapel deed parsing (#584)', () => {
  const eventId = 'what_the_chapel_is_for';
  const fullText = 'keeps an altar stone older than the chapel, which this house did not set there';
  const address = 'content:events/age_crusade.yaml#events[id=what_the_chapel_is_for].record.options.record.claims[0].text';

  it('keeps all deed words and no extra keys when parsing the authored YAML', () => {
    const raw = readFileSync(join(CONTENT_ROOT, 'events', 'age_crusade.yaml'), 'utf8');
    const doc = parse(raw) as {
      events: Array<{ id: string; record?: {
        options: { record: { claims: Array<Record<string, unknown>> } };
      } }>;
    };
    const claim = doc.events.find((event) => event.id === eventId)?.record?.options.record.claims[0];
    expect(claim).toStrictEqual({
      kind: 'deed',
      target: { slot: 'HEAD' },
      text: fullText,
    });
  });

  it('keeps the complete gameplay claim and its reviewed Plain English fingerprint', () => {
    const claim = bundle.mustEvent(eventId).record?.options.record.claims[0];
    expect(claim).toStrictEqual({
      kind: 'deed',
      target: { slot: 'HEAD' },
      text: fullText,
    });
    const variant = bundle.proseVariants.find((row) => row.address === address);
    expect(variant?.of).toBe(proseOriginalHash(fullText));
  });
});

/**
 * #587: YAML flow-map commas silently truncated twenty-two Record deeds.
 * Keep the repair as an observable gameplay contract, not only a raw text edit.
 * A future author may intentionally reword a deed but must update this fixture.
 */
describe('authored deed claims with internal commas (#587)', () => {
  const repairedDeeds = [
  "broke a company of raiders against these walls, unaided", // age_scoped
  "came back from Bramme nine years later warranted in Terra, with his identity unproved", // arc_corran
  "learned that the rod's rule of two had been tracking fire, not the blood", // arc_rod
  "lost the Seal to the west line, which now calls itself senior", // arc_seal
  "kept the Seal in the house, in a trusted branch's keeping", // arc_seal
  "was sought out by the recruiting captain, and taken without payment", // careers
  "was released with the thanks of his colonel, having been carried from the field", // careers
  "reconsidered of his own wisdom, and the house prospered by it", // guardian
  "declined the blood, choosing service over power", // marriage
  "went to war with the house's men under another banner, not one of their own", // muster
  "gave the herald four generations and the acreage, but not the elder descent", // papers
  "was cleared at the assize on a ninety-year deed, not on the witnesses", // papers
  "received the bottle as a gift, unbought", // portions
  "engaged a physician of standing, rather than bought the flask", // portions
  "learned the iron went soft in whatever room he sat in, not only the east chamber", // rare_blood
  "answered nine days of the inquest, with every answer kept at Cawdry", // rare_church
  "could not receive the relic, the chapel being under repair", // rare_church
  "restored the house by the recall of its kin, in full number", // rare_house
  "came from the Rimefell with no document, and had three generations bought for her at Bramme", // rare_match
  "declined the foreign offer, the terms being unsuitable", // rare_match
  "gave the Seal away as a gift, to a cousin of good blood", // rites
  "agreed to be given by name as the vessel, and the house wrote her name down", // rites
  ] as const;

  it('loads all twenty-two complete deeds into the game', () => {
    const deeds = bundle.events.flatMap((event) => [
      ...(event.record?.options.record.claims ?? []),
      ...(event.record?.options.embellish.claims ?? []),
    ]).filter((claim) => claim.kind === 'deed').map((claim) => claim.text);
    expect(repairedDeeds).toHaveLength(22);
    for (const text of repairedDeeds) expect(deeds).toContain(text);
  });

  it('rejects a comma-truncated YAML flow claim instead of stripping the extra key', () => {
    const malformed = parse(
      '- { kind: deed, target: { slot: HEAD }, text: lost the Seal to the west line, which now calls itself senior }',
    ) as unknown[];
    expect(malformed).toHaveLength(1);
    expect(malformed[0]).toMatchObject({
      kind: 'deed',
      text: 'lost the Seal to the west line',
      'which now calls itself senior': null,
    });
    expect(ClaimS.safeParse(malformed[0]).success).toBe(false);

    const fixed = parse(
      '- { kind: deed, target: { slot: HEAD }, text: "lost the Seal to the west line, which now calls itself senior" }',
    ) as unknown[];
    expect(ClaimS.parse(fixed[0])).toMatchObject({
      kind: 'deed',
      text: 'lost the Seal to the west line, which now calls itself senior',
    });
  });

  it('rejects unexpected authored keys for all four structured claim kinds', () => {
    const target = { slot: 'HEAD' };
    const samples = [
      { kind: 'deed', target, text: 'kept the old chapel' },
      { kind: 'death', target, cause: 'a fall' },
      { kind: 'trait', target, trait: 'brave', has: true },
      { kind: 'attr', target, attr: 'madness', value: 12 },
    ];
    for (const sample of samples) {
      expect(ClaimS.safeParse(sample).success).toBe(true);
      expect(ClaimS.safeParse({ ...sample, 'silent extra key': null }).success).toBe(false);
    }
  });
});
