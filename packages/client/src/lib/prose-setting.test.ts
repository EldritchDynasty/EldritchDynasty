// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadBundle } from '@ed/content';
import { proseOriginalHash, type ProseMode, type ProseVariant } from '@ed/schema';
import { browserPlatform } from '../platform.js';
import { createGame } from './game.js';
import { createProseModeSelector } from './prose-selection.js';

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
  bundle.proseVariants.splice(0, bundle.proseVariants.length, {
    address: ADDRESS, of: proseOriginalHash(ORIGINAL), plainenglish: PLAIN,
  });
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
  it('rehydrates the lazy catalogue for a persisted Plain English preference (#410)', () => {
    // The startup route must use the same asynchronous installer as the
    // on-screen selector. setProseMode() alone has no variants to display.
    const app = readFileSync(join(import.meta.dirname, '..', 'App.vue'), 'utf8');
    const startup = 'void selectProseMode(accessibility.value.proseMode);';
    expect(app).toContain(startup);
    expect(app.indexOf(startup)).toBeGreaterThan(app.indexOf('const selectProseMode = createProseModeSelector('));
    expect(app).not.toContain('actions.setProseMode(accessibility.value.proseMode);');
    expect(app).toContain('installPlainEnglishCatalogue,');
    expect(app).toContain("import { createProseModeSelector } from './lib/prose-selection'");
  });

  it('refreshes uncommitted prose immediately when the reader changes mode', () => {
    window.localStorage.clear();
    const bundle = loadBundle();
    const prologue = bundle.prologue[0]!;
    const original = prologue.opening;
    const address = `content:prologue.yaml#prologue[id=${prologue.id}].opening`;
    bundle.proseVariants.splice(
      0,
      bundle.proseVariants.length,
      { address, of: proseOriginalHash(original), plainenglish: 'The signing happened on the last night of the old year.' },
    );

    const game = createGame(bundle, browserPlatform());
    game.actions.begin(1042, 'short');

    expect(game.prologue.value?.opening).toBe(original);

    game.actions.setProseMode('plainenglish');
    expect(game.prologue.value?.opening).toBe(
      'The signing happened on the last night of the old year.',
    );

    game.actions.setProseMode('original');
    expect(game.prologue.value?.opening).toBe(original);
  });

  it('refreshes an uncommitted reading surface when optional prose arrives late (#728)', () => {
    window.localStorage.clear();
    const bundle = loadBundle();
    const opening = bundle.prologue[0]!;
    const original = opening.opening;
    const address = `content:prologue.yaml#prologue[id=${opening.id}].opening`;
    const game = createGame(bundle, browserPlatform(), { proseVariants: [] });
    game.actions.begin(1042, 'short');
    game.actions.setProseMode('plainenglish');
    expect(game.prologue.value?.opening).toBe(original);

    game.actions.setProseVariants([{
      address,
      of: proseOriginalHash(original),
      plainenglish: 'The signing happened after the last night of the old year.',
    }]);
    expect(game.prologue.value?.opening).toBe('The signing happened after the last night of the old year.');

    game.actions.setProseMode('original');
    expect(game.prologue.value?.opening).toBe(original);
  });

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

/** Flush requests in a controlled order without depending on dynamic-import timing. */
function pendingProse() {
  let resolve!: (variants: readonly ProseVariant[]) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<readonly ProseVariant[]>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe('lazy Plain English selection order (#1024)', () => {
  it('does not let an older failed load undo a newer successful Plain English selection', async () => {
    const first = pendingProse();
    const second = pendingProse();
    const selected: ProseMode[] = [];
    const accepted: Array<readonly ProseVariant[]> = [];
    let requests = 0;
    const select = createProseModeSelector(
      (mode) => selected.push(mode),
      () => ++requests === 1 ? first.promise : second.promise,
      (variants) => { accepted.push(variants); },
    );

    const old = select('plainenglish');
    await select('original');
    const current = select('plainenglish');
    const newest: readonly ProseVariant[] = [];
    second.resolve(newest);
    await current;
    first.reject(new Error('old offline request failed'));
    await old;

    expect(selected).toEqual(['plainenglish', 'original', 'plainenglish']);
    expect(accepted).toEqual([newest]);
  });

  it('does not install the result of an obsolete request after choosing Original', async () => {
    const pending = pendingProse();
    const selected: ProseMode[] = [];
    const accepted: Array<readonly ProseVariant[]> = [];
    const select = createProseModeSelector(
      (mode) => selected.push(mode),
      () => pending.promise,
      (variants) => { accepted.push(variants); },
    );

    const old = select('plainenglish');
    await select('original');
    pending.resolve([]);
    await old;

    expect(selected).toEqual(['plainenglish', 'original']);
    expect(accepted).toEqual([]);
  });

  it('still restores Original if the current Plain English load fails offline', async () => {
    const pending = pendingProse();
    const selected: ProseMode[] = [];
    const accepted: Array<readonly ProseVariant[]> = [];
    const select = createProseModeSelector(
      (mode) => selected.push(mode),
      () => pending.promise,
      (variants) => { accepted.push(variants); },
    );

    const current = select('plainenglish');
    pending.reject(new Error('offline'));
    await current;

    expect(selected).toEqual(['plainenglish', 'original']);
    expect(accepted).toEqual([]);
  });
  it('does not replace the current catalogue when the older import succeeds last', async () => {
    const first = pendingProse();
    const second = pendingProse();
    const accepted: Array<readonly ProseVariant[]> = [];
    let requests = 0;
    const select = createProseModeSelector(
      () => undefined,
      () => ++requests === 1 ? first.promise : second.promise,
      (variants) => { accepted.push(variants); },
    );

    const old = select('plainenglish');
    const current = select('plainenglish');
    const latest = [{ address: 'core:messages#latest', of: '0123456789abcdef', plainenglish: 'Latest.' }];
    second.resolve(latest);
    await current;
    const stale = [{ address: 'core:messages#stale', of: '0123456789abcdef', plainenglish: 'Stale.' }];
    first.resolve(stale);
    await old;

    expect(accepted).toEqual([latest]);
  });

});
