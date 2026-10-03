import { describe, expect, it } from 'vitest';
import { loadBundle } from '@ed/content';
import { missingPlainEnglishAddresses, ProseCatalogueS } from '@ed/schema';
import type { EventTemplate, Outcome } from '@ed/schema';
import {
  commitOutcome, loadGame, missingPlainEnglish, queueChoice, queueRecord, resolveRecord, saveGame, setProseMode, setProseVariants, testRng, testWorld,
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
      { address: ADDRESS, plainenglish: 'The work is finished before evening.' },
      { address: TITLE_ADDRESS, plainenglish: 'The Silted Race' },
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
      { address: ADDRESS, plainenglish: 'The work is finished before evening.' },
      { address: RECORD_ADDRESS, plainenglish: 'The plain-English record wording.' },
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
    setProseVariants(ctx, [
      { address: TITLE_ADDRESS, plainenglish: 'The Silted Race' },
      { address: CHOICE_LABEL_ADDRESS, plainenglish: 'Ask him to handle it.' },
      { address: RECORD_SUBJECT_ADDRESS, plainenglish: 'What should we write down?' },
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
    const variants = [{ address: ADDRESS, plainenglish: 'The work is finished before evening.' }];
    setProseVariants(original, variants);
    setProseVariants(plain, variants);
    setProseMode(plain, 'plainenglish');

    commitOutcome(original, event, outcome, {}, undefined, testRng('same-outcome'));
    commitOutcome(plain, event, outcome, {}, undefined, testRng('same-outcome'));

    expect(plain.world.decisionLog).toEqual(original.world.decisionLog);
    expect(plain.world.chronicle.at(-1)?.text).not.toBe(original.world.chronicle.at(-1)?.text);
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
    setProseVariants(ctx, [{ address: secondAddress, plainenglish: 'The second branch finished.' }]);
    setProseMode(ctx, 'plainenglish');

    const resolved = commitOutcome(ctx, ambiguous, second, {}, 'second_branch', testRng('duplicate-outcome-id'));

    expect(resolved.text).toBe('The second branch finished.');
    expect(missingPlainEnglish(ctx)).toEqual([]);
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
