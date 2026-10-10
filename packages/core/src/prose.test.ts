import { describe, expect, it } from 'vitest';
import { coreMessageAddress, msg } from './messages.js';
import { outcomeChronicleEffectAddress, outcomeTextAddress, proseForOutcome } from './prose.js';
import { loadBundle, loadContent } from '@ed/content';
import { canonical } from './save.js';
import { contentProseEntries, missingPlainEnglishAddresses, proseOriginalAt, ProseCatalogueS, proseOriginalHash } from '@ed/schema';
import type { EventTemplate, Outcome } from '@ed/schema';
import {
  commitOutcome, loadGame, missingPlainEnglish, newGame, proseForTale, queueChoice, queueRecord, renderProse, resolveRecord, saveGame, setProseMode, setProseVariants, testRng, testWorld,
} from '@ed/core';

const ADDRESS =
  'content:events/the_ladder.yaml#events[id=the_race_silted_through].interaction.choices[id=ask_him].outcomes[id=done_by_evening].text';
const TITLE_ADDRESS =
  'content:events/the_ladder.yaml#events[id=the_race_silted_through].title';
const RECORD_ADDRESS =
  'content:events/the_ladder.yaml#events[id=the_race_silted_through].record.options.record.chronicle';
const CHOICE_LABEL_ADDRESS =
  'content:events/the_ladder.yaml#events[id=the_race_silted_through].interaction.choices[id=ask_him].label';
const RECORD_SUBJECT_ADDRESS =
  'content:events/the_ladder.yaml#events[id=the_race_silted_through].record.subject';

describe('live trait names in the selected prose mode (#957)', () => {
  it('translates eligible names in the view, falls back safely, and never changes saves', () => {
    const session = newGame(loadContent());
    const { ctx } = session;
    const trait = ctx.content.traits.find((item) => String(item.id) === 'reads_the_signs');
    if (!trait) throw new Error('The reads_the_signs fixture is missing');
    const address = `content:${ctx.content.sourceOf(String(trait.id))}#traits[id=${encodeURIComponent(String(trait.id))}].name`;
    const original = session.view().traits;
    const snapshot = canonical(saveGame(ctx));
    const variant = {
      address, of: proseOriginalHash(trait.name), plainenglish: 'Reads the clues',
    };

    setProseVariants(ctx, [variant]);
    session.setProseMode('plainenglish');
    expect(session.view().traits).toEqual(original.map((item) =>
      item.trait === trait.id ? { ...item, name: variant.plainenglish } : item));
    expect(missingPlainEnglish(ctx)).not.toContain(address);
    // Other multiword trait names still use Original until a variant is authored.
    expect(missingPlainEnglish(ctx))
      .toContain('content:traits.yaml#traits[id=competent_physician].name');

    setProseVariants(ctx, [{ ...variant, of: proseOriginalHash('Older trait wording') }]);
    expect(session.view().traits).toEqual(original);
    expect(missingPlainEnglish(ctx)).toContain(address);

    session.setProseMode('original');
    expect(session.view().traits).toEqual(original);
    expect(canonical(saveGame(ctx))).toBe(snapshot);
  });
});

describe('live attribute names in the selected prose mode (#959)', () => {
  it('translates eligible names, keeps one-word names, and falls back on stale wording', () => {
    const session = newGame(loadContent());
    const { ctx } = session;
    const attribute = ctx.content.attributes.find((item) => String(item.id) === 'max_age');
    if (!attribute) throw new Error('The max_age fixture is missing');
    const address = `content:${ctx.content.sourceOf(String(attribute.id))}#attributes[id=${encodeURIComponent(String(attribute.id))}].name`;
    const original = session.view().attributes;
    const snapshot = canonical(saveGame(ctx));
    const variant = {
      address, of: proseOriginalHash(attribute.name), plainenglish: 'Oldest Possible Age',
    };

    setProseVariants(ctx, [variant]);
    session.setProseMode('plainenglish');
    expect(session.view().attributes).toEqual(original.map((item) =>
      item.attr === attribute.id ? { ...item, name: variant.plainenglish } : item));
    expect(missingPlainEnglish(ctx)).not.toContain(address);
    expect(missingPlainEnglish(ctx))
      .toContain('content:attributes.yaml#attributes[id=eldritch_power].name');

    setProseVariants(ctx, [{ ...variant, of: proseOriginalHash('Older attribute wording') }]);
    expect(session.view().attributes).toEqual(original);
    expect(missingPlainEnglish(ctx)).toContain(address);

    session.setProseMode('original');
    expect(session.view().attributes).toEqual(original);
    expect(canonical(saveGame(ctx))).toBe(snapshot);
  });
});

describe('live Age names in the selected prose mode (#921)', () => {
  function fixture() {
    const session = newGame(loadContent());
    const { ctx } = session;
    ctx.world.year = 1080;
    ctx.world.age.active = [
      { age: 'the_wars', began: 1060, named: true, namedAt: 1070, paid: { standing: false } },
      { age: 'the_plague', began: 1079, named: false, paid: { standing: false } },
    ];
    ctx.world.age.ended = [
      { age: 'the_long_peace', began: 1042, ended: 1050, named: true, namedAt: 1045 },
      { age: 'the_withering', began: 1051, ended: 1055, named: false },
    ];
    const variants = ctx.content.ages.map((age) => ({
      address: `content:${ctx.content.sourceOf(age.id)}#ages[id=${age.id}].name`,
      of: proseOriginalHash(age.name), plainenglish: `Plain: ${age.name}`,
    }));
    setProseVariants(ctx, variants);
    return { session, ctx, variants };
  }

  const ageMisses = (session: ReturnType<typeof newGame>) => missingPlainEnglish(session.ctx)
    .filter((address) => address.startsWith('content:ages/') && address.endsWith('.name'));

  it('switches named active and ended Ages while leaving unnamed Ages and saved history alone', () => {
    const { session, ctx } = fixture();
    const original = session.view().ages;
    const saved = canonical(saveGame(ctx));
    expect(original.map((age) => age.name)).toEqual(['The Long Peace', undefined, 'The Wars', undefined]);
    session.setProseMode('plainenglish');
    const plain = session.view().ages;
    expect(plain).toEqual(original.map((age) => age.name === undefined
      ? age : { ...age, name: `Plain: ${age.name}` }));
    expect(ageMisses(session)).toEqual([]);
    expect(canonical(saveGame(ctx))).toBe(saved);
    session.setProseMode('original');
    expect(session.view().ages).toEqual(original);
    expect(plain[0]!.name).toBe('Plain: The Long Peace');
    expect(original[0]!.name).toBe('The Long Peace');
  });

  it.each(['missing', 'stale', 'tokens'] as const)('reports %s named variants without exposing unnamed Ages', (failure) => {
    const { session, ctx, variants } = fixture();
    const original = session.view().ages;
    setProseVariants(ctx, failure === 'missing' ? [] : variants.map((variant) => ({
      ...variant,
      ...(failure === 'stale' ? { of: proseOriginalHash('old name') }
        : { plainenglish: `${variant.plainenglish} {EXTRA}` }),
    })));
    session.setProseMode('plainenglish');
    expect(session.view().ages).toEqual(original);
    expect(ageMisses(session)).toEqual([
      'content:ages/ages.yaml#ages[id=the_long_peace].name',
      'content:ages/ages.yaml#ages[id=the_wars].name',
    ]);
  });
});

function fixture() {
  const bundle = loadBundle();
  const authored = bundle.events.find((event) => event.id === 'the_race_silted_through')!;
  const outcome: Outcome = {
    id: 'done_by_evening',
    weight: 100,
    text: 'The work is done before evening, and the old wording stays in the book.',
    tags: [],
    effects: [],
  };
  if (authored.interaction.kind !== 'choice') throw new Error('fixture event is no longer a choice');
  const event: EventTemplate = {
    ...authored,
    slots: {},
    interaction: {
      ...authored.interaction,
      choices: authored.interaction.choices.map((choice) => choice.id === 'ask_him'
        ? { ...choice, outcomes: choice.outcomes.map((item) => item.id === outcome.id ? outcome : item) }
        : choice),
    },
  };
  return { bundle, event, outcome };
}

describe('prospective prose selection', () => {
  it('loads the authored catalogue from content without host-side injection', () => {
    const { bundle } = fixture();
    bundle.proseVariants.push({
      address: ADDRESS,
      plainenglish: 'The authored catalogue reaches the runtime directly.',
    });

    const session = newGame(bundle, { proseMode: 'plainenglish' });

    expect(session.ctx.prose.mode).toBe('plainenglish');
    expect(session.ctx.prose.variants.get(ADDRESS)?.plainenglish)
      .toBe('The authored catalogue reaches the runtime directly.');
  });

  it('falls back to current Original when its reviewed fingerprint becomes stale', () => {
    const { bundle } = fixture();
    const ctx = testWorld(bundle);
    const original = 'The book is safe in the tower.';
    const changed = 'The book was stolen from the tower.';
    const reviewed = 'The book is safe.';
    setProseVariants(ctx, [{
      address: ADDRESS, of: proseOriginalHash(original), plainenglish: reviewed,
    }]);
    setProseMode(ctx, 'plainenglish');

    expect(renderProse(ctx, ADDRESS, original)).toBe(reviewed);
    expect(missingPlainEnglish(ctx)).toEqual([]);

    // The author edits Original without reviewing the counterpart. Its stable
    // address survives, but showing the old translation would change meaning.
    expect(renderProse(ctx, ADDRESS, changed)).toBe(changed);
    expect(missingPlainEnglish(ctx)).toEqual([ADDRESS]);

    // Re-review and reload the catalogue to clear the missing marker.
    setProseVariants(ctx, [{
      address: ADDRESS, of: proseOriginalHash(changed), plainenglish: 'The book was stolen.',
    }]);
    expect(renderProse(ctx, ADDRESS, changed)).toBe('The book was stolen.');
    expect(missingPlainEnglish(ctx)).toEqual([]);

    setProseMode(ctx, 'original');
    expect(renderProse(ctx, ADDRESS, changed)).toBe(changed);
  });

  it('rejects runtime variants whose interpolation tokens differ even with a current fingerprint', () => {
    const ctx = testWorld(loadBundle());
    const original = 'The {HEAD} showed {house} to {HEAD} before {endYear}.';
    const of = proseOriginalHash(original);

    // Ordering of tokens in a translated sentence may differ, but the exact
    // multiset (including repeated and lower-case placeholders) must survive.
    setProseVariants(ctx, [{
      address: ADDRESS, of,
      plainenglish: 'Before {endYear}, {house} saw {HEAD} speak to {HEAD}.',
    }]);
    setProseMode(ctx, 'plainenglish');
    expect(renderProse(ctx, ADDRESS, original))
      .toBe('Before {endYear}, {house} saw {HEAD} speak to {HEAD}.');
    expect(missingPlainEnglish(ctx)).toEqual([]);

    for (const plainenglish of [
      'Before {endYear}, the house saw {HEAD} speak to {HEAD}.', // dropped {house}
      'Before {endYear}, {house} saw {HEAD} speak.', // dropped a repeated {HEAD}
      'Before {EndYear}, {house} saw {HEAD} speak to {HEAD}.', // changed case
      'Before {endYear}, {house} saw {HEAD} speak to {HEAD} and {teller}.', // added one
    ]) {
      setProseVariants(ctx, [{ address: ADDRESS, of, plainenglish }]);
      expect(renderProse(ctx, ADDRESS, original)).toBe(original);
      expect(missingPlainEnglish(ctx)).toEqual([ADDRESS]);
    }

    // Presentation mode never changes the source string or the game state.
    setProseMode(ctx, 'original');
    expect(renderProse(ctx, ADDRESS, original)).toBe(original);
  });

  it('keeps core message values when a variant drops an underscore-leading token', () => {
    const ctx = testWorld(loadBundle());
    const key = 'test.underscored';
    const address = coreMessageAddress(key);
    const original = '{_NAME} asked {HEAD} about {_NAME}.';
    const of = proseOriginalHash(original);
    const values = { _NAME: 'Ada', HEAD: 'Bren' };
    setProseMode(ctx, 'plainenglish');

    // The variant's source fingerprint matches, but dropping a repeated
    // {_NAME} must not hide a value. The common scanner and msg() must agree.
    setProseVariants(ctx, [{
      address, of, plainenglish: '{HEAD} told everyone about {_NAME}.',
    }]);
    expect(msg(ctx, key, original, values)).toBe('Ada asked Bren about Ada.');
    expect(missingPlainEnglish(ctx)).toEqual([address]);

    // Valid variants may reorder every token without losing any occurrence.
    setProseVariants(ctx, [{
      address, of, plainenglish: 'Before {HEAD} answered, {_NAME} spoke to {_NAME}.',
    }]);
    expect(msg(ctx, key, original, values)).toBe('Before Bren answered, Ada spoke to Ada.');
    expect(missingPlainEnglish(ctx)).toEqual([]);
  });

  it('loads legacy rows without fingerprints but marks them missing rather than rendering them', () => {
    const { bundle } = fixture();
    const ctx = testWorld(bundle);
    setProseVariants(ctx, [{ address: ADDRESS, plainenglish: 'The direct version.' }]);
    setProseMode(ctx, 'plainenglish');

    const original = 'Any original wording.';
    expect(renderProse(ctx, ADDRESS, original)).toBe(original);
    expect(missingPlainEnglish(ctx)).toEqual([ADDRESS]);
  });

  it('exposes one-word tale bias in the worklist and translates every visible tale field', () => {
    const ctx = testWorld(loadBundle());
    const tale = ctx.content.tales[0]!;
    const base = `content:tales.yaml#tales[id=${encodeURIComponent(tale.id)}]`;
    const tellerAddress = `${base}.teller`;
    const biasAddress = `${base}.bias`;
    const textAddress = `${base}.text`;
    const plainTeller = 'The singers of the house';
    const plainBias = 'They want the house to remember its loss.';
    const plainText = 'The seal was lent but never returned.';

    // A bias like "wistful" is one word, but it is player-visible and
    // proseForTale already offers an authored Plain English counterpart.
    const entries = contentProseEntries('tales.yaml', { tales: [tale] });
    expect(entries.map((entry) => entry.address)).toContain(biasAddress);
    expect(proseOriginalAt(ctx.content, biasAddress)).toBe(tale.bias);

    setProseVariants(ctx, [
      { address: tellerAddress, of: proseOriginalHash(tale.teller), plainenglish: plainTeller },
      { address: biasAddress, of: proseOriginalHash(tale.bias), plainenglish: plainBias },
      { address: textAddress, of: proseOriginalHash(tale.text), plainenglish: plainText },
    ]);
    setProseMode(ctx, 'plainenglish');
    expect(proseForTale(ctx, tale)).toEqual({
      teller: plainTeller, bias: plainBias, text: plainText,
    });
    expect(missingPlainEnglish(ctx)).toEqual([]);

    // Without counterparts, every visible field is an actionable migration
    // gap, including the one-word bias the old worklist silently omitted.
    setProseVariants(ctx, []);
    expect(proseForTale(ctx, tale)).toEqual({
      teller: tale.teller, bias: tale.bias, text: tale.text,
    });
    expect(missingPlainEnglish(ctx)).toEqual([tellerAddress, biasAddress, textAddress].sort());
  });

  it('reports migration gaps statically and rejects duplicate stable identities', () => {
    expect(missingPlainEnglishAddresses(
      ['content:a#body', 'content:b#body'],
      [{ address: 'content:a#body', plainenglish: 'A direct sentence.' }],
    )).toEqual(['content:b#body']);

    expect(() => ProseCatalogueS.parse([
      { address: 'content:a#body', plainenglish: 'First.' },
      { address: 'content:a#body', plainenglish: 'Second.' },
    ])).toThrow(/duplicate prose variant address/);
  });

  it('freezes written pages while later pages use the selected authored variant', () => {
    const { bundle, event, outcome } = fixture();
    const ctx = testWorld(bundle);
    const namedEvent: EventTemplate = { ...event, frequency: 'rare' };
    setProseVariants(ctx, [
      { address: ADDRESS, of: proseOriginalHash(outcome.text!), plainenglish: 'The work is finished before evening.' },
      { address: TITLE_ADDRESS, of: proseOriginalHash(event.title), plainenglish: 'The Silted Race' },
    ]);

    const first = commitOutcome(ctx, namedEvent, outcome, {}, undefined, testRng('prose-original'));
    expect(first.text).toBe(outcome.text);
    expect(ctx.world.chronicle.at(-1)?.title).toBe(event.title);

    setProseMode(ctx, 'plainenglish');
    const second = commitOutcome(ctx, namedEvent, outcome, {}, undefined, testRng('prose-plain'));

    expect(second.text).toBe('The work is finished before evening.');
    expect(ctx.world.chronicle.slice(-2).map((page) => page.text)).toEqual([
      outcome.text,
      'The work is finished before evening.',
    ]);
    expect(ctx.world.chronicle.slice(-2).map((page) => page.title)).toEqual([
      event.title,
      'The Silted Race',
    ]);
    expect(missingPlainEnglish(ctx)).toEqual([]);
  });


  it('selects and freezes a Chronicle-effect variant using its exact outcome and effect index (#802)', () => {
    const bundle = loadBundle();
    const event = bundle.events.find((entry) => entry.id === 'the_cross_reference')!;
    expect(event).toBeDefined();
    if (event.interaction.kind !== 'choice') throw new Error('Bramme scene is not a choice');
    const choice = event.interaction.choices.find((entry) => entry.id === 'pay_him')!;
    const outcome = choice.outcomes.find((entry) => entry.id === 'the_page_unfindable')!;
    const effectIndex = outcome.effects.findIndex((effect) => effect.kind === 'chronicle');
    const effect = outcome.effects[effectIndex];
    if (effect?.kind !== 'chronicle') throw new Error('fixture needs a Chronicle effect');

    const address = `content:events/burying.yaml#events[id=the_cross_reference].interaction.choices[id=pay_him].outcomes[id=the_page_unfindable].effects[${effectIndex}].text`;
    const plain = 'The house paid the archivist at Bramme to copy its records.';
    const ctx = testWorld(bundle);
    setProseVariants(ctx, [{ address, of: proseOriginalHash(effect.text), plainenglish: plain }]);

    const linesWritten = () => ctx.world.chronicle.filter((page) => page.weight === 'line');
    commitOutcome(ctx, event, outcome, {}, choice.id, testRng('chronicle-effect-original'));
    expect(linesWritten().at(-1)?.text).toBe(effect.text);

    setProseMode(ctx, 'plainenglish');
    commitOutcome(ctx, event, outcome, {}, choice.id, testRng('chronicle-effect-plain'));
    expect(linesWritten().slice(-2).map((page) => page.text)).toEqual([effect.text, plain]);
    expect(missingPlainEnglish(ctx)).not.toContain(address);

    // A variant removed or made stale must fall back to Original. Previously
    // written pages keep their selected literal text after a mode change.
    setProseVariants(ctx, [{ address, of: '0000000000000000', plainenglish: plain }]);
    commitOutcome(ctx, event, outcome, {}, choice.id, testRng('chronicle-effect-stale'));
    expect(linesWritten().slice(-3).map((page) => page.text)).toEqual([effect.text, plain, effect.text]);
    expect(missingPlainEnglish(ctx)).toContain(address);
    setProseMode(ctx, 'original');
    expect(linesWritten().slice(-3).map((page) => page.text)).toEqual([effect.text, plain, effect.text]);
  });

  it('freezes a pending Record option before a later mode switch', () => {
    const { bundle, event, outcome } = fixture();
    const recorded: EventTemplate = {
      ...event,
      record: {
        subject: 'What should the book say?',
        options: {
          record: { chronicle: 'The original record wording.', effects: [], claims: [] },
          omit: { chronicle: null, effects: [] },
          embellish: {
            chronicle: 'The original embellished wording.',
            effects: [],
            claims: [],
            discrepancy: { id: 'fixture_prose_lie', severity: 'minor', provableBy: ['archive'] },
          },
        },
      },
    };
    const ctx = testWorld(bundle);
    setProseVariants(ctx, [
      { address: ADDRESS, of: proseOriginalHash(outcome.text!), plainenglish: 'The work is finished before evening.' },
      { address: RECORD_ADDRESS, of: proseOriginalHash('The original record wording.'), plainenglish: 'The plain-English record wording.' },
    ]);

    const first = commitOutcome(ctx, recorded, outcome, {}, undefined, testRng('record-first'));
    const firstDocket = queueRecord(ctx, recorded, first.entryId)!;

    setProseMode(ctx, 'plainenglish');
    expect(resolveRecord(ctx, firstDocket.id, 'record').line).toBe('The original record wording.');

    const second = commitOutcome(ctx, recorded, outcome, {}, undefined, testRng('record-second'));
    const secondDocket = queueRecord(ctx, recorded, second.entryId)!;
    expect(resolveRecord(ctx, secondDocket.id, 'record').line).toBe('The plain-English record wording.');

    expect(ctx.world.chronicle.slice(-2).map((page) => page.text)).toEqual([
      'The original record wording.',
      'The plain-English record wording.',
    ]);
  });

  it('selects and freezes pending choice labels and Record prompts', () => {
    const { bundle, event } = fixture();
    const recorded: EventTemplate = {
      ...event,
      record: {
        subject: 'What should the book say?',
        options: {
          record: { chronicle: 'The original record wording.', effects: [], claims: [] },
          omit: { chronicle: null, effects: [] },
          embellish: {
            chronicle: 'The original embellished wording.',
            effects: [],
            claims: [],
            discrepancy: { id: 'fixture_prompt_lie', severity: 'minor', provableBy: ['archive'] },
          },
        },
      },
    };
    const ctx = testWorld(bundle);
    const authoredChoice = recorded.interaction.kind === 'choice'
      ? recorded.interaction.choices.find((item) => item.id === 'ask_him')
      : undefined;
    if (!authoredChoice) throw new Error('fixture is missing ask_him choice');
    setProseVariants(ctx, [
      { address: TITLE_ADDRESS, of: proseOriginalHash(event.title), plainenglish: 'The Silted Race' },
      { address: CHOICE_LABEL_ADDRESS, of: proseOriginalHash(authoredChoice.label), plainenglish: 'Ask him to handle it.' },
      { address: RECORD_SUBJECT_ADDRESS, of: proseOriginalHash('What should the book say?'), plainenglish: 'What should we write down?' },
    ]);
    setProseMode(ctx, 'plainenglish');

    const choice = queueChoice(ctx, recorded, recorded.body, {}, []);
    expect(choice.event.title).toBe('The Silted Race');
    expect(choice.choices.find((candidate) => candidate.id === 'ask_him')?.label)
      .toBe('Ask him to handle it.');

    const record = queueRecord(ctx, recorded, 'fixture-entry')!;
    expect(record.subject).toBe('What should we write down?');

    setProseMode(ctx, 'original');
    expect(choice.event.title).toBe('The Silted Race');
    expect(choice.choices.find((candidate) => candidate.id === 'ask_him')?.label)
      .toBe('Ask him to handle it.');
    expect(record.subject).toBe('What should we write down?');
  });


  it('changes rendered words without changing the structured decision', () => {
    const { bundle, event, outcome } = fixture();
    const original = testWorld(bundle, 912);
    const plain = testWorld(bundle, 912);
    const variants = [{ address: ADDRESS, of: proseOriginalHash(outcome.text!), plainenglish: 'The work is finished before evening.' }];
    setProseVariants(original, variants);
    setProseVariants(plain, variants);
    setProseMode(plain, 'plainenglish');

    commitOutcome(original, event, outcome, {}, undefined, testRng('same-outcome'));
    commitOutcome(plain, event, outcome, {}, undefined, testRng('same-outcome'));

    expect(plain.world.decisionLog).toEqual(original.world.decisionLog);
    expect(plain.world.chronicle.at(-1)?.text).not.toBe(original.world.chronicle.at(-1)?.text);
  });

  it('rejects a mismatched choice when identical Original text and outcome ids occur in two branches (#856)', () => {
    const { bundle, event, outcome } = fixture();
    if (event.interaction.kind !== 'choice') throw new Error('fixture event is no longer a choice');

    const original = 'The two choices have the same Original ending.';
    const first: Outcome = { ...outcome, id: 'shared_result', text: original };
    const second: Outcome = { ...outcome, id: 'shared_result', text: original };
    const ambiguous: EventTemplate = {
      ...event,
      interaction: {
        ...event.interaction,
        choices: [
          { ...event.interaction.choices[0]!, id: 'first_branch', outcomes: [first] },
          { ...event.interaction.choices[1]!, id: 'second_branch', outcomes: [second] },
        ],
      },
    };
    const base = 'content:events/the_ladder.yaml#events[id=the_race_silted_through].interaction.choices';
    const firstAddress = `${base}[id=first_branch].outcomes[id=shared_result].text`;
    const secondAddress = `${base}[id=second_branch].outcomes[id=shared_result].text`;
    const ctx = testWorld(bundle);
    setProseVariants(ctx, [
      { address: firstAddress, of: proseOriginalHash(original), plainenglish: 'The first choice ends here.' },
      { address: secondAddress, of: proseOriginalHash(original), plainenglish: 'The second choice ends here.' },
    ]);
    setProseMode(ctx, 'plainenglish');

    // Same id and same Original fingerprint do not prove branch membership.
    expect(outcomeTextAddress(ctx, ambiguous, first, 'second_branch')).toBeUndefined();
    expect(outcomeChronicleEffectAddress(ctx, ambiguous, first, 0, 'second_branch')).toBeUndefined();
    expect(proseForOutcome(ctx, ambiguous, first, 'second_branch')).toBe(original);

    // A copied outcome is also untrusted, even when it has the right id.
    expect(outcomeTextAddress(ctx, ambiguous, { ...first }, 'first_branch')).toBeUndefined();

    // Actual selections still resolve each branch's independent wording.
    expect(outcomeTextAddress(ctx, ambiguous, first, 'first_branch')).toBe(firstAddress);
    expect(outcomeTextAddress(ctx, ambiguous, second, 'second_branch')).toBe(secondAddress);
    expect(proseForOutcome(ctx, ambiguous, first, 'first_branch')).toBe('The first choice ends here.');
    expect(proseForOutcome(ctx, ambiguous, second, 'second_branch')).toBe('The second choice ends here.');
  });

  it('uses the exact choice identity when two branches reuse an outcome id', () => {
    const { bundle, event, outcome } = fixture();
    if (event.interaction.kind !== 'choice') throw new Error('fixture event is no longer a choice');

    const first: Outcome = { ...outcome, id: 'shared_result', text: 'The first branch used the shared result.' };
    const second: Outcome = { ...outcome, id: 'shared_result', text: 'The second branch used the shared result.' };
    const ambiguous: EventTemplate = {
      ...event,
      interaction: {
        ...event.interaction,
        choices: [
          { ...event.interaction.choices[0]!, id: 'first_branch', outcomes: [first] },
          { ...event.interaction.choices[1]!, id: 'second_branch', outcomes: [second] },
        ],
      },
    };
    const secondAddress =
      'content:events/the_ladder.yaml#events[id=the_race_silted_through].interaction.choices[id=second_branch].outcomes[id=shared_result].text';
    const ctx = testWorld(bundle);
    setProseVariants(ctx, [{ address: secondAddress, of: proseOriginalHash(second.text!), plainenglish: 'The second branch finished.' }]);
    setProseMode(ctx, 'plainenglish');

    const resolved = commitOutcome(ctx, ambiguous, second, {}, 'second_branch', testRng('duplicate-outcome-id'));

    expect(resolved.text).toBe('The second branch finished.');
    expect(missingPlainEnglish(ctx)).toEqual([]);
  });


  it('renders the names of pledged books and heirlooms using reviewed Plain English', () => {
    const bundle = loadBundle();
    const book = bundle.spellbooks.find((item) => item.name.split(/\s+/).length > 1)!;
    const heirloom = bundle.heirlooms.find((item) => item.name.split(/\s+/).length > 1)!;
    expect(book).toBeDefined();
    expect(heirloom).toBeDefined();

    const bookAddress = `content:spellbooks.yaml#spellbooks[id=${encodeURIComponent(book.id)}].name`;
    const heirloomAddress = `content:heirlooms.yaml#heirlooms[id=${encodeURIComponent(heirloom.id)}].name`;
    const session = newGame(bundle, { proseMode: 'plainenglish' });
    session.ctx.world.marriagePromises.push(
      { toHouse: 'house_marrow', year: 1080, lot: book.id },
      { toHouse: 'house_marrow', year: 1081, lot: heirloom.id },
      { toHouse: 'house_marrow', year: 1082, lot: 'unknown_lot' },
    );
    const originalPromises = structuredClone(session.ctx.world.marriagePromises);

    const plainBook = 'The plain book name';
    const plainHeirloom = 'The plain heirloom name';
    setProseVariants(session.ctx, [
      { address: bookAddress, of: proseOriginalHash(book.name), plainenglish: plainBook },
      { address: heirloomAddress, of: proseOriginalHash(heirloom.name), plainenglish: plainHeirloom },
    ]);

    // `view()` renders more than the promises — the family's relevance reasons
    // among them (#780) — so the misses this case owns are the two lot names.
    const lotMisses = () => missingPlainEnglish(session.ctx)
      .filter((address) => address === bookAddress || address === heirloomAddress);
    const first = session.view().marriagePromises;
    expect(first.map((promise) => promise.lotName))
      .toEqual([plainBook, plainHeirloom, 'unknown_lot']);
    expect(first.map((promise) => [promise.year, promise.lot]))
      .toEqual([[1080, book.id], [1081, heirloom.id], [1082, 'unknown_lot']]);
    expect(session.ctx.world.marriagePromises).toEqual(originalPromises);
    expect(lotMisses()).toEqual([]);

    session.setProseMode('original');
    expect(session.view().marriagePromises.map((promise) => promise.lotName))
      .toEqual([book.name, heirloom.name, 'unknown_lot']);

    session.setProseMode('plainenglish');
    setProseVariants(session.ctx, [
      { address: bookAddress, of: '0000000000000000', plainenglish: plainBook },
    ]);
    expect(session.view().marriagePromises.map((promise) => promise.lotName))
      .toEqual([book.name, heirloom.name, 'unknown_lot']);
    expect(lotMisses()).toEqual([bookAddress, heirloomAddress].sort());
    expect(session.ctx.world.marriagePromises).toEqual(originalPromises);
  });

  it('reports an unmigrated address and never persists the presentation mode', () => {
    const { bundle, event } = fixture();
    const ctx = testWorld(bundle);
    const missing: Outcome = {
      id: 'not_migrated_yet',
      weight: 100,
      text: 'Original fallback remains playable.',
      tags: [],
      effects: [],
    };
    const missingEvent: EventTemplate = {
      ...event,
      interaction: { kind: 'narration', outcomes: [missing] },
    };

    setProseMode(ctx, 'plainenglish');
    const result = commitOutcome(ctx, missingEvent, missing, {}, undefined, testRng('missing'));
    expect(result.text).toBe(missing.text);
    expect(missingPlainEnglish(ctx)).toEqual([
      'content:events/the_ladder.yaml#events[id=the_race_silted_through].interaction.outcomes[id=not_migrated_yet].text',
    ]);

    const resumed = loadGame(JSON.parse(JSON.stringify(saveGame(ctx))), bundle);
    expect(resumed.prose.mode).toBe('original');
    expect(resumed.world.chronicle.at(-1)?.text).toBe(missing.text);
  });
});

describe('keyed core-message interpolation (#706)', () => {
  it('substitutes upper, lower, mixed-case and repeated placeholders', () => {
    const ctx = testWorld(loadBundle());
    const original = '{HEAD} served {years} years, until {endYear}; {HEAD} remembers {_LEGACY}.';
    expect(msg(ctx, 'test.mixed_case', original, {
      HEAD: 'The Head',
      years: '500',
      endYear: '1542',
      _LEGACY: 'the oath',
    })).toBe('The Head served 500 years, until 1542; The Head remembers the oath.');
  });

  it('rejects missing lower and mixed-case values rather than exposing raw placeholders', () => {
    const ctx = testWorld(loadBundle());
    expect(() => msg(ctx, 'test.missing_years', 'The term lasts {years} years.'))
      .toThrow('Missing {years} in core message test.missing_years');
    expect(() => msg(ctx, 'test.missing_end', 'The term ends at {endYear}.', {
      endyear: '1542',
    })).toThrow('Missing {endYear} in core message test.missing_end');
  });

  it('interpolates reviewed Plain English variants without changing Original mode', () => {
    const ctx = testWorld(loadBundle());
    const key = 'test.rendering';
    const original = '{HEAD} keeps {years} years in the book.';
    const plainenglish = 'For {years} years, {HEAD} keeps the record.';
    setProseVariants(ctx, [{
      address: coreMessageAddress(key),
      of: proseOriginalHash(original),
      plainenglish,
    }]);

    const values = { HEAD: 'Mara', years: '500' };
    expect(msg(ctx, key, original, values)).toBe('Mara keeps 500 years in the book.');

    setProseMode(ctx, 'plainenglish');
    expect(msg(ctx, key, original, values)).toBe('For 500 years, Mara keeps the record.');

    // Token mismatch is rejected by renderProse; the Original remains playable.
    setProseVariants(ctx, [{
      address: coreMessageAddress(key),
      of: proseOriginalHash(original),
      plainenglish: 'For {years} years, Mara keeps the record.',
    }]);
    expect(msg(ctx, key, original, values)).toBe('Mara keeps 500 years in the book.');
  });
});
