// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { loadBundle } from '@ed/content';
import { browserPlatform } from '../platform.js';
import { createGame } from './game.js';

const EVENT_ID = 'the_race_silted_through';
const OUTCOME_ID = 'done_by_evening';
const ORIGINAL = 'The race is cleared before evening in the original wording.';
const PLAIN = 'The channel is clear before evening.';
const ADDRESS =
  'content:events/the_ladder.yaml#events[id=the_race_silted_through].interaction.outcomes[id=done_by_evening].text';

function fixtureBundle() {
  const bundle = loadBundle();
  const authored = bundle.events.find((event) => event.id === EVENT_ID);
  if (!authored) throw new Error('prose-setting fixture event is missing');

  // Keep the assembled bundle object so its source-provenance WeakMap remains
  // intact. Only the event pool is narrowed for this client test.
  const fixture = {
    ...authored,
    conditions: undefined,
    slots: {},
    weight: 1_000_000,
    cooldownYears: 1,
    body: ORIGINAL,
    interaction: {
      kind: 'narration' as const,
      outcomes: [{
        id: OUTCOME_ID,
        weight: 100,
        text: ORIGINAL,
        tags: [],
        effects: [],
      }],
    },
  };
  bundle.events.splice(0, bundle.events.length, fixture);
  bundle.proseVariants.splice(0, bundle.proseVariants.length, { address: ADDRESS, plainenglish: PLAIN });
  return bundle;
}

function stepUntil(
  game: ReturnType<typeof createGame>,
  predicate: () => boolean,
  limit = 120,
): void {
  for (let i = 0; i < limit && !predicate(); i++) {
    game.actions.advance(1);
    if (game.docket.value.length) game.actions.letHimDecide();
    if (game.view.value?.namesWanted.length) game.actions.keepSuggestedNames();
  }
  expect(predicate(), 'fixture event did not fire within the measured window').toBe(true);
}

describe('Plain English client setting (#413)', () => {
  it('changes future prose while preserving Chronicle wording already written', () => {
    window.localStorage.clear();
    const game = createGame(fixtureBundle(), browserPlatform());

    game.actions.setProseMode('plainenglish');
    game.actions.begin(1042, 'short');

    stepUntil(game, () => game.actions.book().some(
      (entry) => entry.eventId === EVENT_ID && entry.text === PLAIN,
    ));

    const first = game.actions.book().find(
      (entry) => entry.eventId === EVENT_ID && entry.text === PLAIN,
    );
    expect(first?.id).toBeTruthy();

    game.actions.setProseMode('original');
    stepUntil(game, () => game.actions.book().some(
      (entry) => entry.eventId === EVENT_ID && entry.text === ORIGINAL,
    ));

    const pages = game.actions.book().filter((entry) => entry.eventId === EVENT_ID);
    expect(pages.find((entry) => entry.id === first!.id)?.text).toBe(PLAIN);
    expect(pages.some((entry) => entry.text === ORIGINAL)).toBe(true);
  });
});
