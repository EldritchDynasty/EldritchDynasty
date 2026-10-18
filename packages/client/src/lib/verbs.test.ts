import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { loadContent } from '@ed/content';
import { GameSession } from '@ed/core';
import { createGame } from './game.js';
import type { Platform } from '../platform.js';

const SRC = join(import.meta.dirname, '..');

/**
 * EVERY VERB THE PLAYER HAS, REACHABLE FROM SOMETHING THEY CAN CLICK.
 *
 * This repository fails by doing nothing, and a client is the best place in it
 * to fail that way: a verb that is never wired looks exactly like a verb
 * nobody happened to use. `send` is the one to picture — name the party and
 * let what they are between them decide the branch. Leave it unwired and every
 * `party` decider in the content resolves through `letHimDecide` instead, the
 * game plays, nothing throws, and the finding arrives in month four.
 *
 * So the chain is checked in two links, and neither end of it is a list
 * anybody maintains:
 *
 *   GameSession's methods  →  called in `game.ts`  →  an action a template calls
 *
 * The first list comes off the prototype and the second off the store itself,
 * so adding a verb to `session.ts` or an action to the store fails this until
 * it is wired all the way through.
 */
function walk(dir: string, ext: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, ext, out);
    else if (entry.endsWith(ext)) out.push(path);
  }
  return out;
}

const templates = walk(SRC, '.vue');
const clientSource = [...walk(SRC, '.ts'), ...templates]
  .filter((p) => !p.endsWith('.test.ts'))
  // POSIX separators on the RECORDED path, because every rule below matches it
  // with `endsWith('lib/game.ts')` and the like. On Windows `walk` returns
  // `...\lib\game.ts`, so those exclusions silently matched nothing and the
  // two files that are ALLOWED to import the simulation were reported as
  // offenders. The read still uses the real path.
  .map((path) => ({ path: path.replace(/\\/g, '/'), text: readFileSync(path, 'utf8') }));

const store = readFileSync(join(SRC, 'lib/game.ts'), 'utf8');

const SESSION = readFileSync(
  join(SRC, '../../core/src/session.ts'),
  'utf8',
);

/** Block comments, line comments, and an HTML comment in a template. */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * The methods, not the getters. `year` and `pending` are read off the view as
 * values — `view()` is values only by contract, and a client that read the
 * live getters instead would be holding two clocks.
 */
const VERBS = Object.getOwnPropertyNames(GameSession.prototype).filter((name) => {
  if (name === 'constructor') return false;
  const d = Object.getOwnPropertyDescriptor(GameSession.prototype, name);
  return typeof d?.value === 'function';
});

describe('every verb reaches the player', () => {
  it('GameSession has the verbs the client was written against', () => {
    // A sanity check on the reflection above: if this ever comes back empty
    // the two tests below would pass by vacuum.
    expect(VERBS).toContain('send');
    expect(VERBS.length).toBeGreaterThan(8);
  });

  it.each(VERBS)('the store calls session.%s', (verb) => {
    expect(store).toContain(`.${verb}(`);
  });

  it.each(Object.keys(createGame(loadContent()).actions))(
    'a template calls actions.%s',
    (action) => {
      expect(templates.some((path) => readFileSync(path, 'utf8').includes(`actions.${action}(`)))
        .toBe(true);
    },
  );
});

/**
 * A VERB WHOSE ANSWER NOBODY READS (issue #84).
 *
 * The test above catches an action no `.vue` file CALLS. It does not catch an
 * action whose RESULT no `.vue` file draws, and that is the same bug one layer
 * in: the button works, the world moves, the screen is never wrong, and the
 * player is simply never told what their decision did.
 *
 * It shipped twice at once. `resolveChoice` has returned the rendered outcome
 * prose since it was written and `choose` dropped it — 304 answers a run on
 * seed 7, 78% of everything the player is asked. And `match` faithfully
 * returned a `MatchResolution` to nobody while sixteen cards drawn takeable
 * refused with a reason no panel drew (issue #83).
 *
 * The list is DERIVED, from the return types in `session.ts`, and not kept
 * here: a verb answering the docket returns a `…Resolution`, so a new one
 * joins this test by existing. The rule is that the store must bind the
 * result and read something off it — `return result` is not reading it, which
 * is precisely what `match` used to do.
 */
const ANSWERING = [...SESSION.matchAll(/^ {2}(\w+)\([^)]*\):\s*(\w*Resolution)\b/gm)]
  .map((m) => ({ verb: m[1]!, type: m[2]! }));

describe('a verb the player answers with says what it did', () => {
  it('finds the answering verbs in session.ts', () => {
    // Without this the table below passes by vacuum the first time somebody
    // renames a resolution type, which is the failure mode of every derived
    // list in this repository.
    expect(ANSWERING.map((a) => a.verb).sort()).toEqual(['choose', 'match', 'record', 'send']);
  });

  it.each(ANSWERING)('the store reads what session.$verb returns', ({ verb }) => {
    const code = stripComments(store);
    const call = new RegExp(`(?:const|let)\\s+(\\w+)\\s*=[^;]*\\.${verb}\\(`, 'g');
    const bound = [...code.matchAll(call)];

    expect(bound.map((m) => m[1]), `nothing in the store binds the result of session.${verb}`)
      .not.toEqual([]);

    // Bound AND read, WITHIN THE ACTION THAT BOUND IT. Searching the whole
    // store for `result.` passes on any file that happens to use that name
    // somewhere else — which is how the first cut of this test declared the
    // old `match` clean while its result went nowhere. The body ends at the
    // action separator the store is written with, `\n    },`.
    const read = bound.some((m) => {
      const from = m.index! + m[0].length;
      const end = code.indexOf('\n    },', from);
      const body = code.slice(from, end === -1 ? undefined : end);
      return new RegExp(`\\b${m[1]}\\s*\\??\\.`).test(body);
    });
    expect(read, `the store never reads a field off session.${verb}'s result`).toBe(true);
  });

  /**
   * And the far end of the chain: what the store held has to be drawn. The
   * outcome is the middle beat of decide → see what it did → decide again,
   * and a store field no template renders is the same bug in a new place.
   */
  it('a template draws the held outcome', () => {
    expect(templates.some((path) => /\boutcome\b/.test(readFileSync(path, 'utf8')))).toBe(true);
    expect(templates.some((path) => /\brefusedCard\b/.test(readFileSync(path, 'utf8')))).toBe(true);
  });
});

describe('the client stays on its side of the seam', () => {
  /**
   * `session.ctx` is reachable on purpose — the editor needs it for previews —
   * and that makes it the shortcut a client reaches for the first time the
   * read model is missing something. It is not a shortcut. It is live
   * simulation state that changes under the render, which is what the
   * editor's version counter exists to work around, and a client that reads
   * it has quietly stopped being written against the seam.
   *
   * If the UI needs something it cannot get here, the missing thing is a verb
   * on `session.ts`.
   */
  it('nothing reaches into ctx', () => {
    // Comments off first: two files explain WHY they do not do this, and a
    // rule that fails on its own reasoning gets deleted rather than obeyed.
    const offenders = clientSource.filter((f) => /\.ctx\b/.test(stripComments(f.text)));
    expect(offenders.map((f) => f.path)).toEqual([]);
  });

  it('only the store imports the simulation for anything but a type', () => {
    const offenders = clientSource
      .filter((f) => !f.path.endsWith('lib/game.ts') && !f.path.endsWith('lib/content.ts'))
      .filter((f) => /^\s*import\s+(?!type\b)[^;]*from\s+'@ed\/(core|schema)'/m.test(f.text));
    expect(offenders.map((f) => f.path)).toEqual([]);
  });
});

describe('campaign dates stay behind the client seam (#66)', () => {
  it('has no product-year literal in production client source', () => {
    const offenders = clientSource
      .map((f) => ({ ...f, text: stripComments(f.text) }))
      .filter((f) => /\b(?:1042|1342|1542|2042)\b/.test(f.text));

    expect(
      offenders.map((f) => f.path),
      'campaign years belong on SessionView/CAMPAIGN_CHOICES, not in Vue or client logic',
    ).toEqual([]);
  });
});

describe('the store drives a game', () => {
  it('begins a run and turns the clock through the read model', () => {
    const game = createGame(loadContent());
    game.actions.begin(1042);

    expect(game.view.value?.year).toBe(1042);
    expect(game.table.value).not.toBeNull();
    expect(game.view.value?.halls.some((h) => h.members.length > 0)).toBe(true);

    // Twenty years, answering whatever stops the clock the way the escape
    // hatch does. Enough to prove the loop turns; the whole run is in
    // `run.slow.test.ts`, where a suite that plays a game belongs.
    for (let i = 0; i < 20; i++) {
      game.actions.advance(1);
      if (game.docket.value.length) game.actions.letHimDecide();
      if (game.view.value?.namesWanted.length) game.actions.keepSuggestedNames();
    }

    expect(game.view.value!.year).toBeGreaterThan(1042);
    expect(game.view.value!.chronicle.length).toBeGreaterThan(0);
  });

  /**
   * WAIT FOR THE BLOOD (issue #1803). The same years turned the same way, with
   * one more reason to stop: the ladder thaws, a decision arrives, or the cap.
   * A new house begins frozen, because the founding generation has not woken.
   */
  it('waits for the blood: stops at the thaw, a decision, or twenty-five years', () => {
    const game = createGame(loadContent());
    game.actions.begin(1042);
    const start = game.view.value!;
    expect(start.ascension.frozen).toEqual({ since: start.year, years: 0 });

    game.actions.advance(25, { untilThawed: true });
    const after = game.view.value!;
    const turned = after.year - start.year;
    expect(turned).toBeGreaterThanOrEqual(0);
    expect(turned).toBeLessThanOrEqual(25);
    const stoppedFor = [
      after.ascension.frozen === undefined,
      turned === 25,
      game.docket.value.length > 0,
      after.namesWanted.length > 0,
      after.ending !== undefined,
    ];
    expect(stoppedFor.some(Boolean), `stopped at ${after.year} for no reason`).toBe(true);
  });

  it('turns no year when asked to wait while the ladder is not frozen', () => {
    const game = createGame(loadContent());
    game.actions.begin(1042);
    // Play on until somebody has woken, answering what stops the clock.
    for (let i = 0; i < 120 && game.view.value!.ascension.frozen; i++) {
      game.actions.advance(1);
      if (game.docket.value.length) game.actions.letHimDecide();
      if (game.view.value?.namesWanted.length) game.actions.keepSuggestedNames();
    }
    const thawed = game.view.value!;
    if (thawed.ascension.frozen) return; // this seed never woke anybody in 120 years; the test above covers that case
    game.actions.advance(25, { untilThawed: true });
    expect(game.view.value!.year).toBe(thawed.year);
  });

  /**
   * The reason, AND which panel asked for it (issue #55). One shared string was
   * drawn in one panel while refusals came from nine, so an order refused from
   * The Papers printed its reason about 1,500px above the button just pressed
   * — off-screen, and indistinguishable from nothing having happened.
   */
  it('refuses an order the house cannot carry out, and says which panel asked', () => {
    const game = createGame(loadContent());
    game.actions.begin(1042);

    const result = game.actions.order({ kind: 'study', person: 'nobody', book: 'nothing' });

    expect(result.ok).toBe(false);
    expect(game.refusal.value?.reason).toBeTruthy();
    expect(game.refusal.value?.kind, 'the refusal cannot be drawn beside its own control').toBe('study');
    // And it is cleared by an order that works, rather than standing until
    // something else happens to fail.
    game.actions.order({ kind: 'marriages', policy: 'as_it_falls' });
    expect(game.refusal.value).toBeNull();
  });
});


describe('a failed Library load is not an empty profile (#1238)', () => {
  function libraryHost(): Platform & { writes: unknown[]; readCount: () => number } {
    let reads = 0;
    let existing: unknown = {
      format: 1,
      runs: [{
        id: 'before-outage', seed: 74, campaign: 'short', endedYear: 1342,
        house: 'The Prior House', ending: { id: 'forgotten', title: 'Forgotten' }, entries: [],
      }],
    };
    const writes: unknown[] = [];
    return {
      writes,
      readCount: () => reads,
      listSaves: async () => [],
      readSave: async () => null,
      writeSave: async () => undefined,
      deleteSave: async () => undefined,
      readLibrary: async () => {
        if (++reads === 1) throw new Error('Library host temporarily unavailable');
        return existing;
      },
      writeLibrary: async (next) => { writes.push(next); existing = next; },
      readUserContent: async () => ({}),
      exportSave: async () => undefined,
      importSave: async () => null,
      onPause: () => () => undefined,
      onBack: () => () => undefined,
    };
  }

  it('fails closed on an initial read error and recovers history on explicit retry', async () => {
    const host = libraryHost();
    const game = createGame(loadContent(), host);
    // The first read starts at composition and settles asynchronously.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(game.libraryReadError.value).toBe(true);
    expect(game.libraryReady.value).toBe(false);
    await expect(game.actions.clearLibrary()).rejects.toThrow('the Library is unavailable');
    await expect(game.actions.deleteLibraryRun('before-outage')).rejects.toThrow('the Library is unavailable');
    expect(host.writes).toEqual([]);

    await game.actions.retryLibrary();
    expect(host.readCount()).toBe(2);
    expect(game.libraryReadError.value).toBe(false);
    expect(game.libraryReady.value).toBe(true);
    expect(game.library.value.runs.map((run) => run.id)).toEqual(['before-outage']);
    expect(host.writes).toEqual([]);

    await game.actions.deleteLibraryRun('before-outage');
    expect(host.writes).toHaveLength(1);
    expect(game.library.value.runs).toEqual([]);
  });

  it('waits for a delayed initial read before constructing a removal snapshot', async () => {
    const host = libraryHost();
    let answer!: (library: unknown) => void;
    const pending = new Promise<unknown>((resolve) => { answer = resolve; });
    host.readLibrary = () => pending;
    const game = createGame(loadContent(), host);
    const removing = game.actions.deleteLibraryRun('before-outage');
    expect(host.writes).toEqual([]);

    answer({
      format: 1,
      runs: [
        {
          id: 'before-outage', seed: 74, campaign: 'short', endedYear: 1342,
          house: 'The Prior House', ending: { id: 'forgotten', title: 'Forgotten' }, entries: [],
        },
        {
          id: 'unrelated-house', seed: 75, campaign: 'short', endedYear: 1342,
          house: 'The Other House', ending: { id: 'forgotten', title: 'Forgotten' }, entries: [],
        },
      ],
    });
    await removing;
    expect(game.library.value.runs.map((run) => run.id)).toEqual(['unrelated-house']);
    expect(host.writes).toHaveLength(1);
    expect(host.writes[0]).toMatchObject({
      runs: [expect.objectContaining({ id: 'unrelated-house' })],
    });
  });

  it('refuses to replace a malformed existing Library root with an empty one', async () => {
    const host = libraryHost();
    host.readLibrary = async () => ({ format: 99, runs: [{ id: 'older-house' }] });
    const game = createGame(loadContent(), host);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(game.libraryReady.value).toBe(false);
    expect(game.libraryReadError.value).toBe(true);
    await expect(game.actions.clearLibrary()).rejects.toThrow('the Library is unavailable');
    expect(host.writes).toEqual([]);
  });

  it('still accepts a genuinely absent first-time Library as empty', async () => {
    const host = libraryHost();
    host.readLibrary = async () => null;
    const game = createGame(loadContent(), host);
    // Editing immediately after composition must await the authoritative read.
    await game.actions.clearLibrary();
    expect(game.libraryReadError.value).toBe(false);
    expect(game.libraryReady.value).toBe(true);
    expect(host.writes).toHaveLength(1);
    expect(host.writes[0]).toMatchObject({ format: 1, runs: [] });
  });
});

describe('the frozen-ladder notice (#1803)', () => {
  it('waits for dead decades before it speaks', async () => {
    const { frozenNoticeShown, FROZEN_NOTICE_YEARS, frozenLine } = await import('./app-shell-copy.js');
    expect(frozenNoticeShown(undefined)).toBe(false);
    expect(frozenNoticeShown({ years: 0 })).toBe(false);
    expect(frozenNoticeShown({ years: FROZEN_NOTICE_YEARS - 1 })).toBe(false);
    expect(frozenNoticeShown({ years: FROZEN_NOTICE_YEARS })).toBe(true);
    expect(frozenLine('original', 1210, 34)).toBe('No man of the blood has woken since 1210. The ladder has stood still for 34 years.');
    expect(frozenLine('plainenglish', 1210, 1)).toBe(
      'No man of the family has awakened since 1210 (1 year). The Ascension Ladder cannot advance until one does.',
    );
  });
});
