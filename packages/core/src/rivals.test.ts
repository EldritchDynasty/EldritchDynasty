import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import type { RivalPerson } from '@ed/schema';
import {
  RELATIONSHIP_THREAD_RECALL_MULTIPLIER,
  RIVAL_LINEAGE_HOUSES, RIVAL_REOFFER_AFTER, RIVAL_REOFFER_CHANCE,
  addGrudge, announceAuction, beget, digestOf, findRivalPerson,
  growRivalLineage, loadGame, mintRecipe, outsiderThreadWeight, pickRivalCandidate,
  place, queueChoice, queueRecord, relationshipThreadAuctionSeller, relationshipThreadRecallMultiplier,
  relationshipThreads, rivalReofferChance, rollRecipe, saveGame, testRng, testWorld,
  tickRelationships, tickRivals,
} from '@ed/core';

const bundle = loadContent();

/**
 * RIVAL-HOUSE DESCENT (issue #24 item 6).
 *
 * The design accepted for this item is that every person's genome is already
 * materialized from their OWN house's real gene pool (`people/factory.ts`),
 * so what needed proving is DESCENT: that a rival bride dealt to the Match
 * traces to a named rival ancestor through real meiosis, rather than being an
 * independent draw every time. That is what these tests assert — the
 * mechanism, not a seed.
 */

function genomesEqual(a: RivalPerson['genome'], b: RivalPerson['genome']): boolean {
  const same = (x: Int16Array, y: Int16Array) => x.length === y.length && x.every((v, i) => v === y[i]);
  return same(a.autosomal[0], b.autosomal[0]) && same(a.autosomal[1], b.autosomal[1])
    && same(a.sex[0], b.sex[0])
    && (a.sex[1] === null ? b.sex[1] === null : b.sex[1] !== null && same(a.sex[1], b.sex[1]));
}

function lineageShape(people: RivalPerson[]) {
  const index = new Map(people.map((p, i) => [p.id, i] as const));
  const relation = (id: string | undefined) => id === undefined ? undefined : index.get(id);
  return people.map((p) => ({
    house: p.house,
    sex: p.sex,
    born: p.born,
    died: p.died,
    left: p.left,
    mother: relation(p.mother),
    father: relation(p.father),
    spouse: relation(p.spouse),
  }));
}

describe('a rival house grows its own shadow lineage', () => {
  it('seeds two founding couples, drawn from the house\'s own pool, the first time it grows', () => {
    const ctx = testWorld(bundle, 501, 1042);
    growRivalLineage(ctx, 'house_marrow');

    const lineage = ctx.world.rivalLineages.get('house_marrow');
    expect(lineage?.people.length).toBe(4);
    expect(lineage?.people.filter((p) => p.sex === 'male').length).toBe(2);
    expect(lineage?.people.filter((p) => p.sex === 'female').length).toBe(2);
    // Paired, and paired with each other — no founder arrives unmarried.
    for (const p of lineage!.people) {
      expect(p.spouse, `${p.id} has no spouse`).toBeDefined();
      const spouse = lineage!.people.find((q) => q.id === p.spouse);
      expect(spouse?.spouse).toBe(p.id);
    }
  });

  it('is deterministic: the same seed and year seed identical founders', () => {
    const a = testWorld(bundle, 777, 1042);
    const b = testWorld(bundle, 777, 1042);
    growRivalLineage(a, 'house_marrow');
    growRivalLineage(b, 'house_marrow');

    const pa = a.world.rivalLineages.get('house_marrow')!.people;
    const pb = b.world.rivalLineages.get('house_marrow')!.people;
    expect(pa.map((p) => p.id)).toEqual(pb.map((p) => p.id));
    for (let i = 0; i < pa.length; i++) {
      expect(genomesEqual(pa[i]!.genome, pb[i]!.genome), `founder ${i} diverged`).toBe(true);
    }
  });

  it('grows every configured house through named ancestry', () => {
    const ctx = testWorld(bundle, 909, 1042);
    for (let i = 0; i < 200; i++) {
      ctx.world.year += 1;
      tickRivals(ctx);
    }

    for (const houseId of RIVAL_LINEAGE_HOUSES) {
      const lineage = ctx.world.rivalLineages.get(houseId);
      expect(lineage, `${houseId} never grew a lineage`).toBeDefined();
      const byId = new Map(lineage!.people.map((p) => [p.id, p]));
      const children = lineage!.people.filter((p) => p.mother && p.father);
      expect(children.length, `${houseId} produced no births in two hundred years`).toBeGreaterThan(0);

      for (const child of children) {
        const mother = byId.get(child.mother!);
        const father = byId.get(child.father!);
        expect(mother, `${child.id}'s mother ${child.mother} is not in ${houseId}`).toBeDefined();
        expect(father, `${child.id}'s father ${child.father} is not in ${houseId}`).toBeDefined();
        expect(mother!.sex).toBe('female');
        expect(father!.sex).toBe('male');
      }

    }
  });

  it('uses 40 as a soft growth cap, not a hard post-year population clamp', () => {
    const ctx = testWorld(bundle, 910, 1042);
    growRivalLineage(ctx, 'house_marrow');
    const lineage = ctx.world.rivalLineages.get('house_marrow')!;
    const genome = lineage.people[0]!.genome;

    // Fill the living lineage to the documented threshold with young people,
    // so mortality cannot lower it before the growth decision is made.
    for (let i = lineage.people.length; i < 40; i++) {
      lineage.people.push({
        id: `riv_cap_${i}`,
        house: 'house_marrow',
        sex: i % 2 === 0 ? 'female' : 'male',
        born: 1022,
        genome,
      });
    }
    expect(lineage.people.filter((p) => p.died === undefined && p.left === undefined)).toHaveLength(40);
    const before = lineage.people.length;

    ctx.world.year += 1;
    growRivalLineage(ctx, 'house_marrow');

    // Internal marriages may change relationship fields, but a year that
    // reaches the growth step at 40 living people cannot add outsiders or
    // children. A natural year can finish at 41+ when it STARTED below 40
    // and several births succeeded; that is why MAX_LIVING is a soft cap.
    expect(lineage.people).toHaveLength(before);
  });

  it('keeps all six house streams independent across two centuries of births, deaths and marriages', () => {
    const together = testWorld(bundle, 314, 1042);
    const solos = new Map(RIVAL_LINEAGE_HOUSES.map((houseId) =>
      [houseId, testWorld(bundle, 314, 1042)] as const));

    for (let i = 0; i < 200; i++) {
      together.world.year += 1;
      tickRivals(together);
      for (const [houseId, alone] of solos) {
        alone.world.year += 1;
        growRivalLineage(alone, houseId);
      }
    }

    for (const houseId of RIVAL_LINEAGE_HOUSES) {
      const a = solos.get(houseId)!.world.rivalLineages.get(houseId)!.people;
      const b = together.world.rivalLineages.get(houseId)!.people;

      // Rival ids intentionally differ because all six share one id counter.
      // Normalize relationships to lineage-local insertion order, then prove
      // every other fact — including all genomes — is exactly the same.
      expect(lineageShape(b), `${houseId} changed shape beside the other houses`).toEqual(lineageShape(a));
      expect(b).toHaveLength(a.length);
      for (let i = 0; i < a.length; i++) {
        expect(
          genomesEqual(a[i]!.genome, b[i]!.genome),
          `${houseId} genome ${i} moved beside the other houses`,
        ).toBe(true);
      }
    }
  });

  it('is bit-neutral across the saved world when no house is configured to grow one', () => {
    const ctx = testWorld(bundle, 1234, 1042);
    const before = digestOf(ctx);

    tickRivals(ctx, []);

    // This is stronger than checking the two fields rivals normally writes:
    // the save digest covers the whole persistent world. Repeating this no-op
    // phase every year therefore cannot move an otherwise identical run.
    expect(digestOf(ctx)).toBe(before);
    expect(ctx.world.rivalLineages.size).toBe(0);
    expect(ctx.world.counters.rival).toBe(0);
  });

  it('names exactly the six rival houses in scope, and every one has a gene pool to draw from', () => {
    expect(RIVAL_LINEAGE_HOUSES).toEqual([
      'house_marrow',
      'house_calder',
      'house_ilm',
      'house_bracc',
      'house_hesk',
      'house_yssanne',
    ]);
    for (const houseId of RIVAL_LINEAGE_HOUSES) {
      expect(bundle.houses.some((h) => h.id === houseId && h.genePool !== undefined), houseId).toBe(true);
    }
  });
});

function expectRivalBrideMinted(
  houseId: string,
  templateId: string,
  seed: number,
  daughterId: string,
): void {
  const ctx = testWorld(bundle, seed, 1042);

  // A real founding couple, grown the ordinary way, so both parent genomes
  // came from this house's pool. Add an eligible daughter by hand so this
  // Match-path test is not at the mercy of the year a natural birth lands;
  // the tests above separately prove natural rival children use real meiosis.
  growRivalLineage(ctx, houseId);
  const lineage = ctx.world.rivalLineages.get(houseId)!;
  const father = lineage.people.find((p) => p.sex === 'male')!;
  const mother = lineage.people.find((p) => p.sex === 'female')!;
  const daughter: RivalPerson = {
    id: daughterId, house: houseId, sex: 'female', born: 1022,
    mother: mother.id, father: father.id, genome: mother.genome,
  };
  lineage.people.push(daughter);

  const template = bundle.characterTemplates.find((t) => t.id === templateId);
  expect(template, `content dropped ${templateId}, which this test targets on purpose`).toBeDefined();

  const recipe = rollRecipe(template!, ctx, testRng(`rival-mint-${houseId}`));
  expect(recipe.rivalId, `${houseId} has one eligible daughter and the recipe did not find her`).toBe(daughter.id);
  expect(recipe.sex).toBe('female');
  expect(recipe.age).toBe(1042 - daughter.born);

  expect(findRivalPerson(ctx, houseId, daughter.id)?.left).toBeUndefined();

  const person = mintRecipe(recipe, template!, ctx);
  expect(person.genome.kind).toBe('materialized');
  if (person.genome.kind === 'materialized') {
    expect(genomesEqual(person.genome.genome, daughter.genome)).toBe(true);
  }

  // She has left the lineage — spent into the player's world, and not
  // eligible to be dealt, married or born from inside it again.
  expect(findRivalPerson(ctx, houseId, daughter.id)?.left).toBe(1042);
  expect(
    pickRivalCandidate(ctx, houseId, 'female', { min: 0, max: 99 }, testRng(`recheck-${houseId}`)),
  ).toBeUndefined();
}

describe('the Match spends a rival card into a real person', () => {
  it('mints house_marrow descent instead of redrawing its genome from the pool', () => {
    expectRivalBrideMinted('house_marrow', 'suitor_of_deep_blood', 55, 'riv_test_marrow_daughter');
  });

  it('does the same for a second configured house, not only the Stage-1 house', () => {
    expectRivalBrideMinted('house_hesk', 'suitor_of_hesk', 56, 'riv_test_hesk_daughter');
  });
});

function rememberedHeskSuitor(seed = 214) {
  const ctx = testWorld(bundle, seed, 1042);
  growRivalLineage(ctx, 'house_hesk');
  const lineage = ctx.world.rivalLineages.get('house_hesk')!;
  const father = lineage.people.find((p) => p.sex === 'male')!;
  const mother = lineage.people.find((p) => p.sex === 'female')!;
  const daughter: RivalPerson = {
    id: 'riv_rejected_hesk',
    house: 'house_hesk',
    sex: 'female',
    born: 1025,
    mother: mother.id,
    father: father.id,
    genome: mother.genome,
  };
  lineage.people.push(daughter);
  const template = bundle.characterTemplates.find((t) => t.id === 'suitor_of_hesk')!;

  // One card is enough to establish that the house met her. Not minting the
  // recipe is the rejection: she remains shadow genealogy, not a Person.
  const first = rollRecipe(template, ctx, testRng('rejected-hesk-first'));
  expect(first.rivalId).toBe(daughter.id);
  expect(findRivalPerson(ctx, 'house_hesk', daughter.id)?.courtship?.name).toBe(first.name);
  return { ctx, daughter, template, first };
}

describe('a rejected rival Match can become history (issue #214)', () => {
  it('can offer the same named rival again without minting the declined card', () => {
    const { ctx, daughter, template, first } = rememberedHeskSuitor();
    const peopleBefore = ctx.world.people.all().length;

    ctx.world.year += RIVAL_REOFFER_AFTER;
    let returned: ReturnType<typeof rollRecipe> | undefined;
    for (let i = 0; i < 100 && !returned; i++) {
      const recipe = rollRecipe(template, ctx, testRng(`rejected-hesk-return-${i}`));
      if (recipe.rivalId === daughter.id) returned = recipe;
    }

    expect(returned, 'a remembered rival never passed the callback ration').toBeDefined();
    expect(returned!.name).toBe(first.name);
    expect(returned!.seed).toBe(first.seed);
    expect(ctx.world.people.all().length, 'declining or reoffering minted a phantom person').toBe(peopleBefore);

    const spouse = mintRecipe(returned!, template, ctx);
    expect(spouse.name).toBe(first.name);
    expect(findRivalPerson(ctx, 'house_hesk', daughter.id)?.left).toBe(ctx.world.year);
  });

  it('waits a market cycle and keeps callbacks occasional', () => {
    const { ctx, daughter, template } = rememberedHeskSuitor(215);
    expect(RIVAL_REOFFER_CHANCE).toBe(0.2);

    ctx.world.year += RIVAL_REOFFER_AFTER - 1;
    expect(
      pickRivalCandidate(ctx, 'house_hesk', 'female', template.ageAtArrival, testRng('too-soon'), String(template.id)),
    ).toBeUndefined();

    ctx.world.year += 1;
    let callbacks = 0;
    for (let i = 0; i < 100; i++) {
      const candidate = pickRivalCandidate(
        ctx, 'house_hesk', 'female', template.ageAtArrival, testRng(`callback-rate-${i}`), String(template.id),
      );
      if (candidate?.id === daughter.id) callbacks += 1;
    }
    expect(callbacks, 'the callback path is unreachable').toBeGreaterThan(0);
    expect(callbacks, 'a remembered candidate became mandatory').toBeLessThan(100);
  });

  it('survives save/load as the same courtship memory', () => {
    const { ctx, daughter, first } = rememberedHeskSuitor(216);
    const saved = JSON.parse(JSON.stringify(saveGame(ctx)));
    const reloaded = loadGame(saved, bundle);
    const back = findRivalPerson(reloaded, 'house_hesk', daughter.id);

    expect(back?.courtship).toEqual({
      template: first.template,
      name: first.name,
      seed: first.seed,
      offered: 1042,
      ...(first.friend ? { friend: true } : {}),
    });
  });
});



function threadedWorld(year = 1200) {
  const ctx = testWorld(bundle, 217, year);
  const head = place(ctx, { sex: 'male', age: 42, name: 'Aldren Thread', castSlots: ['head'] });
  return { ctx, head };
}

describe('external relationship threads (issue #217)', () => {
  it('keeps the active set to three named, provenance-bearing relationships', () => {
    const { ctx, head } = threadedWorld();
    const marrow = place(ctx, { sex: 'male', age: 38, name: 'Ors Marrow', house: 'house_marrow' });

    addGrudge(ctx, marrow.id, head.id, { severity: 70, inheritance: 'house_wide' }, 'ev_thread_quarrel');
    ctx.world.chronicle.push({
      year: 1200,
      weight: 'paragraph',
      title: 'The North Gate',
      text: 'Ors Marrow and Aldren Thread disputed who went through the north gate first.',
      eventId: 'ev_thread_quarrel',
      named: true,
    });
    ctx.world.chronicle.push({
      id: 'chr_thread_calder',
      year: 1188,
      weight: 'paragraph',
      title: 'The Crooked Account',
      text: 'The house wrote the payment larger than it was.',
      named: true,
      discrepancyId: 'disc_thread_calder',
    });
    ctx.world.discrepancies.set('disc_thread_calder', {
      severity: 'major',
      provableBy: ['house_calder'],
      state: 'open',
    });
    ctx.world.looseSecrets.push({
      secret: 'secret_thread_hesk',
      carrier: 'ret_thread',
      carrierName: 'Mara Vale',
      house: 'house_hesk',
      since: 1175,
      severity: 'major',
    });
    ctx.world.marriagePromises.push({
      toHouse: 'house_yssanne',
      year: 1191,
      lot: 'thread_marriage_lot',
    });

    const all = relationshipThreads(ctx, 10);
    const active = relationshipThreads(ctx);
    expect(all.length).toBeGreaterThanOrEqual(4);
    expect(active).toHaveLength(3);
    for (const thread of active) {
      expect(thread.name.length).toBeGreaterThan(0);
      expect(thread.origin.detail).toMatch(/\d{4}/);
      expect(thread.pressures.length).toBeGreaterThan(0);
      expect('sentiment' in thread).toBe(false);
      expect('score' in thread).toBe(false);
    }
    expect(relationshipThreads(ctx)).toEqual(relationshipThreads(ctx));
  });

  it('keeps an old origin while a grudge naturally decays into a useful obligation', () => {
    const { ctx, head } = threadedWorld();
    const marrow = place(ctx, { sex: 'female', age: 34, name: 'Sera Marrow', house: 'house_marrow' });
    const oldScene = bundle.events.find((event) => event.purposes.includes('change_relationship'));
    expect(oldScene).toBeDefined();

    ctx.world.decisionLog.push({
      kind: 'outcome',
      year: 1102,
      event: oldScene!.id,
      outcomeId: 'thread-history',
      fill: { HEAD: head.id, RIVAL: marrow.id },
    });
    addGrudge(ctx, marrow.id, head.id, { severity: 10, inheritance: 'house_wide' }, String(oldScene!.id));
    ctx.world.marriagePromises.push({
      toHouse: 'house_marrow',
      year: 1198,
      lot: 'thread_useful_lot',
    });

    const hostile = relationshipThreads(ctx, 10).find((thread) => thread.house === 'house_marrow');
    expect(hostile).toBeDefined();
    expect(hostile!.origin.year).toBe(1102);
    expect(hostile!.pressures.map((fact) => fact.kind)).toContain('grudge');
    expect(hostile!.pressures.map((fact) => fact.kind)).toContain('marriage_promise');

    for (let i = 0; i < 12; i += 1) {
      ctx.world.year += 1;
      tickRelationships(ctx);
    }

    const useful = relationshipThreads(ctx, 10).find((thread) => thread.house === 'house_marrow');
    expect(useful).toBeDefined();
    expect(useful!.origin).toEqual(hostile!.origin);
    expect(useful!.pressures.map((fact) => fact.kind)).not.toContain('grudge');
    expect(useful!.pressures.map((fact) => fact.kind)).toContain('marriage_promise');
  });

  it('lets Match, auction and outside event casting recall the same active house', () => {
    const { ctx } = threadedWorld();
    ctx.world.marriagePromises.push({
      toHouse: 'house_hesk',
      year: 1199,
      lot: 'thread_recall_lot',
    });

    const hesk = place(ctx, { sex: 'female', age: 27, name: 'Ilya Hesk', house: 'house_hesk' });
    const calder = place(ctx, { sex: 'female', age: 27, name: 'Ilya Calder', house: 'house_calder' });
    const rival = { role: 'rival' } as Parameters<typeof outsiderThreadWeight>[0];
    const ordinaryOutsider = { role: 'outsider' } as Parameters<typeof outsiderThreadWeight>[0];

    expect(RELATIONSHIP_THREAD_RECALL_MULTIPLIER).toBeGreaterThan(1);
    expect(relationshipThreadRecallMultiplier(ctx, 'house_hesk')).toBe(RELATIONSHIP_THREAD_RECALL_MULTIPLIER);
    expect(relationshipThreadRecallMultiplier(ctx, 'house_calder')).toBe(1);
    expect(rivalReofferChance(ctx, 'house_hesk')).toBe(
      RIVAL_REOFFER_CHANCE * RELATIONSHIP_THREAD_RECALL_MULTIPLIER,
    );
    expect(rivalReofferChance(ctx, 'house_calder')).toBe(RIVAL_REOFFER_CHANCE);

    expect(relationshipThreadAuctionSeller(ctx, 'house_calder')).toBe('house_hesk');
    expect(outsiderThreadWeight(rival, ctx, hesk)).toBe(RELATIONSHIP_THREAD_RECALL_MULTIPLIER);
    expect(outsiderThreadWeight(rival, ctx, calder)).toBe(1);
    expect(outsiderThreadWeight(ordinaryOutsider, ctx, hesk)).toBe(1);
  });


  it('recurs an auction seller without changing the stock the ladder can see', () => {
    const quiet = testWorld(bundle, 2171, 1200);
    const active = testWorld(bundle, 2171, 1200);
    active.world.marriagePromises.push({
      toHouse: 'house_hesk',
      year: 1199,
      lot: 'thread_recall_lot',
    });

    const quietLots = announceAuction(quiet, testRng('thread-auction'));
    const activeLots = announceAuction(active, testRng('thread-auction'));
    const stock = (lots: typeof quietLots) => lots.map((lot) => ({
      kind: lot.kind,
      refId: lot.refId,
      reserveCoin: lot.reserveCoin,
      saleYear: lot.saleYear,
    }));

    expect(stock(activeLots)).toEqual(stock(quietLots));
    expect(activeLots.some((lot) => lot.kind !== 'chronicle_page' && lot.house === 'house_hesk')).toBe(true);
  });

  it('lets old contact fade when nothing remains actionable', () => {
    const { ctx, head } = threadedWorld(1160);
    const yssene = place(ctx, { sex: 'male', age: 31, name: 'Teren Yssanne', house: 'house_yssanne' });
    const scene = bundle.events.find((event) => event.purposes.includes('change_relationship'));
    expect(scene).toBeDefined();
    ctx.world.decisionLog.push({
      kind: 'outcome',
      year: 1102,
      event: scene!.id,
      outcomeId: 'thread-fades',
      fill: { HEAD: head.id, OUTSIDER: yssene.id },
    });
    expect(relationshipThreads(ctx, 10).some((thread) => thread.house === 'house_yssanne')).toBe(true);
    ctx.world.year = 1163;
    expect(relationshipThreads(ctx, 10).some((thread) => thread.house === 'house_yssanne')).toBe(false);
  });

  it('keeps one concrete origin across generations and reuses it in choice and Record decisions', () => {
    const ctx = testWorld(bundle, 219, 1200);
    const ours = place(ctx, { sex: 'male', age: 50, name: 'Old Seat' });
    const theirs = place(ctx, { sex: 'male', age: 50, name: 'Old Marrow', house: 'house_marrow' });
    const ourHeir = place(ctx, { sex: 'male', age: 20, name: 'Young Seat' });
    const theirHeir = place(ctx, { sex: 'male', age: 20, name: 'Young Marrow', house: 'house_marrow' });
    beget(ctx, ourHeir, undefined, ours);
    beget(ctx, theirHeir, undefined, theirs);

    const scene = bundle.events.find((event) => event.purposes.includes('change_relationship'));
    expect(scene).toBeDefined();
    ctx.world.decisionLog.push({
      kind: 'outcome',
      year: 1199,
      event: scene!.id,
      outcomeId: 'thread-origin',
      fill: { HEAD: ours.id, RIVAL: theirs.id },
    });
    addGrudge(ctx, theirs.id, ours.id, { severity: 80, inheritance: 'house_wide' }, String(scene!.id));

    const first = relationshipThreads(ctx, 10).find((thread) => thread.house === 'house_marrow');
    expect(first?.origin.year).toBe(1199);
    expect(first?.origin.detail).toContain('Old Marrow');

    ctx.world.people.kill(ours.id, ctx.world.year, 'a fever');
    ctx.world.people.kill(theirs.id, ctx.world.year, 'a fever');
    ctx.world.year = 1225;
    tickRelationships(ctx);

    const inherited = relationshipThreads(ctx, 10).find((thread) => thread.house === 'house_marrow');
    expect(inherited?.origin).toEqual(first?.origin);

    const choiceEvent = bundle.events.find((event) => event.interaction.kind === 'choice');
    if (!choiceEvent) throw new Error('content has no choice event');
    const choice = queueChoice(ctx, choiceEvent, 'Young Marrow comes again.', { VISITOR: theirHeir.id }, []);
    expect(choice.callback).toBe(inherited?.origin.detail);

    const recordEvent = bundle.events.find((event) => event.record !== undefined);
    if (!recordEvent) throw new Error('content has no Record event');
    const record = queueRecord(ctx, recordEvent, 'chr_thread', { WITNESS: theirHeir.id });
    expect(record?.callback).toBe(inherited?.origin.detail);
  });
});
