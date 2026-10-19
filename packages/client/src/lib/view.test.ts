import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as ts from 'typescript';
import { loadContent } from '@ed/content';
import {
  autoResolveAll, bootstrap, phenotypeOf, place, resolveChoice, resolveRecord, stepYear, testRng, viewOf,
} from '@ed/core';
import type { SimCtx, TableView } from '@ed/core';
import { loadRevealed, revealStorageKey, revealTransition, saveRevealed, type RevealElement } from './reveal';

const SRC = join(import.meta.dirname, '..');

/**
 * EVERY FIELD ON THE READ MODEL REACHES A TEMPLATE (issue #47).
 *
 * `verbs.test.ts` walks the verbs; this walks the other half. The epic that
 * asked for it says why:
 *
 *   > A field nothing reads is a bug, not a stub (invariant 11); a view field
 *   > nothing draws is the same bug one layer out. `ascension.best` exists
 *   > because invariant 14 insists the house remembers its high-water mark,
 *   > and no pixel anywhere prints it. Nothing throws. It looks precisely like
 *   > a working game.
 *
 * Five of that epic's twelve issues were this exact bug — `assize.pressure`,
 * `ascension.best`, `foremost.power`, `foremost.spells`, and the whole
 * chronicle beyond the last sixty lines — and every one of them was found by
 * a person reading the code months later rather than by anything mechanical.
 * This is the tripwire that would have caught them on the day they landed.
 *
 * It is a tripwire and not a proof: it asks whether the NAME appears in a
 * template, which a field could satisfy by coincidence. That is the same
 * bargain `verbs.test.ts` strikes, and it costs nothing against the failure
 * it catches, which is a field nobody drew at all.
 */
function templates(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) templates(path, out);
    else if (entry.endsWith('.vue')) out.push(path);
  }
  return out;
}

/**
 * Leave actual script strings and template expressions intact; only comment
 * tokens are documentation. A line-based regex cannot distinguish an inline
 * " // blocked" from the two slashes inside a URL or quoted text (#1606).
 */
function withoutScriptComments(source: string): string {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, source);
  const templateBraces: number[] = [];
  let result = '';
  let last = 0;
  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
    // Scanners do not automatically re-scan the closing } of \${expression}
    // as a template tail. Preserve strings and nested interpolations instead
    // of mistaking their literal // for a comment.
    if (kind === ts.SyntaxKind.TemplateHead) templateBraces.push(0);
    else if (kind === ts.SyntaxKind.OpenBraceToken && templateBraces.length) {
      templateBraces[templateBraces.length - 1]!++;
    } else if (kind === ts.SyntaxKind.CloseBraceToken && templateBraces.length) {
      const depth = templateBraces.length - 1;
      if (templateBraces[depth] === 0) {
        kind = scanner.reScanTemplateToken(false);
        if (kind === ts.SyntaxKind.TemplateTail) templateBraces.pop();
      } else {
        templateBraces[depth]!--;
      }
    }
    if (kind !== ts.SyntaxKind.SingleLineCommentTrivia
      && kind !== ts.SyntaxKind.MultiLineCommentTrivia) continue;
    result += source.slice(last, scanner.getTokenPos());
    result += source.slice(scanner.getTokenPos(), scanner.getTextPos()).replace(/[^\r\n]/g, ' ');
    last = scanner.getTextPos();
  }
  return result + source.slice(last);
}

/** Ignore Vue/JS/CSS documentation without losing executable field references. */
function withoutVueComments(source: string): string {
  const stripMarkupComments = (markup: string) => markup
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/[^\r\n]*/gm, '');

  let output = '';
  let last = 0;
  for (const script of source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    const start = script.index!;
    const whole = script[0];
    const body = script[1]!;
    const bodyStart = whole.indexOf('>') + 1;
    output += stripMarkupComments(source.slice(last, start));
    output += whole.slice(0, bodyStart) + withoutScriptComments(body) + whole.slice(bodyStart + body.length);
    last = start + whole.length;
  }
  return output + stripMarkupComments(source.slice(last));
}

const drawn = templates(SRC).map((p) => withoutVueComments(readFileSync(p, 'utf8'))).join('\n');

/**
 * Views taken off runs old enough to have filled their optional fields — a
 * guardian, an Age, a tale in circulation, a secret out of the house, an
 * embellished page. A fresh world would leave half of these absent and the
 * walk would never see them.
 *
 * TWO seeds, unioned, and the walk reads EVERY element of every array
 * (issue #336). The fixture used to be one seed read through the first
 * element of each list, and when content moved it was re-seeded until the
 * field it had just surfaced went away again — 1043 reached `discrepancyId`,
 * so the file moved to 1044, which by `68a69db` carried the field too and
 * still passed, because its first chronicle entry was not embellished. An
 * optional field lives on SOME elements; a walk of one element is blind to
 * exactly the fields this tripwire exists for. `REACHED` below says which
 * optional fields the fixture must actually carry, so a fixture that stops
 * reaching one fails by name instead of passing by vacuum.
 *
 * Played once per file: the walk and its guards share one key set.
 */
const VIEW_SEEDS = [1043, 1044];

/**
 * PLAYED, NOT MERELY RUN (#341). `discrepancyId` sits only on an embellished
 * page, and the chronicler that `runYears` plays embellishes about one run in
 * three — so when #341's content re-rolled both seeds, neither reached it, and
 * re-seeding would only have bought time until the next content change. This
 * player answers each choice with its first available option through the
 * player's own path, which is what raises a Record block, and writes every
 * Record larger. The optional fields are then reached by construction rather
 * than by the dice.
 */
function play(ctx: SimCtx, years: number): void {
  const rng = testRng('view-fixture');
  for (let y = 0; y < years; y++) {
    stepYear(ctx, false);
    for (let guard = 0; ctx.world.pendingDecisions.length && guard < 50; guard++) {
      const d = ctx.world.pendingDecisions[0]!;
      if (d.kind === 'record' && resolveRecord(ctx, d.id, 'embellish').ok) continue;
      const first = d.kind === 'choice' ? d.choices.find((c) => c.available) : undefined;
      if (first && resolveChoice(ctx, d.id, first.id, rng).ok) continue;
      autoResolveAll(ctx, rng);
    }
  }
}

function agedViews(): Record<string, unknown>[] {
  return [
    ...VIEW_SEEDS.map((seed) => {
      const ctx = bootstrap(loadContent(), seed, 1042);
      play(ctx, 400);
      return viewOf(ctx) as unknown as Record<string, unknown>;
    }),
    climbingView(),
  ];
}

/**
 * A house with a woken man on the ladder, BUILT rather than played (#1801).
 * `ascension.foremost` names only a man known to express, and both played
 * seeds can reach the term — or the end of the line — with nobody woken: when
 * #1801 lifted the men's waking odds, both did, and `blocked` left the walk.
 * A field the ladder panel exists for is reached by construction, not dice.
 */
function climbingView(): Record<string, unknown> {
  const ctx = bootstrap(loadContent(), VIEW_SEEDS[0]!, 1042);
  for (let i = 0; i < 200; i++) {
    const p = place(ctx, { sex: 'male', age: 24, name: `Ladder Witness ${i}`, awakened: true });
    if (phenotypeOf(p, ctx.genetics, ctx.world.year).eldritch.canExpress) break;
    ctx.world.people.kill(p.id, ctx.world.year, 'not the man this fixture needs');
  }
  // A frame outcome is optional in the played seeds and may disappear after
  // unrelated content rebalances. Build its saved shape from an authored frame
  // so the read-model reachability test is deterministic, not seed-mined.
  const frame = ctx.content.events.find((event) => event.tier === 'frame' && event.interaction.kind === 'narration');
  if (!frame || frame.interaction.kind !== 'narration' || !frame.interaction.outcomes[0]) {
    throw new Error('view fixture needs an authored frame outcome');
  }
  ctx.world.frame.entries.push({
    year: ctx.world.year, eventId: frame.id,
    outcomeId: frame.interaction.outcomes[0].id, text: frame.body,
  });
  return viewOf(ctx) as unknown as Record<string, unknown>;
}

/** Every key name the read model actually carries, nested fields included. */
function keysOf(o: unknown, depth = 0, out = new Set<string>()): Set<string> {
  if (depth > 4 || o === null || typeof o !== 'object') return out;
  if (Array.isArray(o)) {
    // EVERY element, not the first (issue #336). One element is the shape only
    // when no field is optional, and an optional field — a page's
    // `discrepancyId`, a `cause`, `claims` — is exactly the kind that sits on
    // the fortieth entry and not the first.
    for (const item of o) keysOf(item, depth, out);
    return out;
  }
  for (const [key, value] of Object.entries(o)) {
    out.add(key);
    // `attrs` maps are keyed by CONTENT ids — `mind`, `charm`, `thermal` — and
    // those are authored data, not fields of this read model. Walking into one
    // would have the test demand a template mentioning every attribute in the
    // game by name.
    if (key === 'attrs') continue;
    keysOf(value, depth + 1, out);
  }
  return out;
}

/**
 * Fields the client deliberately does not draw, each with the reason.
 *
 * It is kept short, and honest below rather than by
 * intention: the first draft of it had twelve entries and eleven of them were
 * excusing fields the client already drew. An exceptions list nobody checks
 * grows until it is the whole read model, and then the tripwire is a comment.
 */
const NOT_DRAWN: Record<string, string> = {
  outcomeId: 'which branch of a template resolved. The player meets the prose; the id is for replay',
  blocked: 'the precise gate string is for tooling/deep inspection; the header draws diagnosis text and hint instead',
  // Decided in issue #336. `applyRecord` sets it on every embellished page and
  // nowhere else, so it is present exactly when `record === 'embellish'`,
  // which `Entry.vue` already marks "as the house tells it". The id itself is
  // a key into `world.discrepancies`, which no view carries: there is nothing
  // for it to link to, and a mark keyed off the Discrepancy's STATE would tell
  // the player whether the page had been disproved — a reading of truth this
  // layer does not give (AGENTS.md → Do not). A page is disputed; it is never
  // labelled a lie.
  discrepancyId: 'an embellished page\'s key into world.discrepancies. The mark "as the house tells it" already draws the fact; the state behind the key is not the page\'s to show',
  // Issue #326. The echo line's own words are drawn; this is which sentence
  // frame produced them, kept so the repetition instrument can count copies
  // without reading English (#276). A reader has no use for the frame's name.
  echoFrame: 'which echo sentence frame wrote a line; structure for the repetition instrument, never prose',
};

/**
 * Fields the fixture must carry, the optional ones above all. If a content
 * change leaves the runs without one of them, this fails naming it — the fix
 * is a fixture that reaches it again, never a quieter walk.
 */
const REACHED = [
  'guardian', 'ascension', 'assize', 'chronicle', 'halls',
  'outcomeId', 'discrepancyId', 'claims', 'record', 'foremost', 'blocked',
];

describe('Vue source reachability comment filtering (#1573)', () => {
  it('does not count JSDoc, HTML, or line comments as rendered fields', () => {
    const notes = [
      '/** Independent servants must not be blocked. */',
      '<!-- blocked is only documented here -->',
      '// blocked appears in a comment, not code',
    ].join('\n');
    expect(withoutVueComments(notes)).not.toMatch(/\bblocked\b/);
    expect(withoutVueComments('<p>{{ view.blocked }}</p>')).toMatch(/\bblocked\b/);
  });
});

describe('Vue trailing-comment reachability (#1606)', () => {
  it('ignores inline JS comments without swallowing URLs, template strings or actual view fields', () => {
    const source = [
      '<script setup lang="ts">',
      'const url = "https://example.test/safe";',
      'const quoted = "a // harmless string";',
      'const interpolated = `https://example.test/${view.guardian}`;',
      'const wrapped = `hello ${ { person: view.guardian } }`;',
      'const count = 1; // blocked is tooling-only, not a drawn field',
      'const other = 2; /* blocked remains only in documentation */',
      '</script>',
      '<template><p>{{ view.guardian }}</p></template>',
    ].join('\n');
    const result = withoutVueComments(source);
    expect(result).not.toMatch(/\bblocked\b/);
    expect(result).toContain('https://example.test/safe');
    expect(result).toContain('a // harmless string');
    expect(result).toContain('`https://example.test/${view.guardian}`');
    expect(result).toMatch(/\bguardian\b/);
    expect(withoutVueComments('<p>{{ view.blocked }}</p>')).toMatch(/\bblocked\b/);
  });
});

describe('the walk itself (issue #336)', () => {
  it('finds a key that only a later element of an array carries', () => {
    const found = keysOf({ pages: [{ year: 1100 }, { year: 1101 }, { year: 1102, discrepancyId: 'x' }] });
    expect([...found].sort()).toEqual(['discrepancyId', 'pages', 'year']);
  });
});

describe('every field on the read model reaches a template', () => {
  const keys = [...agedViews().reduce((all, v) => keysOf(v, 0, all), new Set<string>())].sort();

  it('walks views with their optional fields actually set', () => {
    // A guard on the guard: if the walk ever comes back thin, everything below
    // passes by vacuum.
    expect(keys.length).toBeGreaterThan(60);
    for (const expected of REACHED) {
      expect(keys, `the fixture no longer reaches ${expected}`).toContain(expected);
    }
  });

  it.each(keys.filter((k) => !(k in NOT_DRAWN)))(
    'a template draws `%s`',
    (key) => {
      expect(
        new RegExp(`\\b${key}\\b`).test(drawn),
        `nothing in packages/client draws \`${key}\` — draw it, or say why not in NOT_DRAWN`,
      ).toBe(true);
    },
  );

  /**
   * And the exceptions stay honest, in both directions.
   *
   * A name that leaves the read model should leave this list, and — the half
   * that matters — a name that somebody DOES draw should leave it too. An
   * excuse nobody rechecks is how a list of one becomes a list of forty, at
   * which point the tripwire above is a comment.
   */
  it('does not excuse a field the read model no longer has', () => {
    const stale = Object.keys(NOT_DRAWN).filter((k) => !keys.includes(k));
    expect(stale, 'these are excused and no longer on the view').toEqual([]);
  });

  it('does not excuse a field that is drawn anyway', () => {
    const needless = Object.keys(NOT_DRAWN).filter((k) => new RegExp(`\\b${k}\\b`).test(drawn));
    expect(needless, 'these are drawn, so the excuse is stale — delete it').toEqual([]);
  });
});


/**
 * THE TABLE'S EARLY DOOR (#1450).
 *
 * The normal ten-year introduction must not hide an action whose deadline
 * arrives first. This pure fixture keeps every other Table trigger false,
 * so an advertised auction and a genuinely eligible book reader cannot
 * accidentally pass by way of a tutoring fee or a late rite.
 */
describe('Table early reveal for available orders (#1450)', () => {
  const quietTable = {
    canTutor: false,
    pupils: [],
    teachable: [],
    shelf: [],
    posts: [],
    papers: [],
    pedigreePrices: [],
    missingPrimers: [],
    ledgerSearch: { ready: false, fee: 40 },
    unmaking: { ready: false },
    vesselRite: { ready: false },
    greatRite: { ready: false },
  } as unknown as TableView;

  const quietView = {
    year: 1042,
    campaign: { startYear: 1042 },
    tales: [],
    ascension: { foremost: null },
    assize: { pressure: 0 },
    muster: null,
  } as unknown as Parameters<typeof revealTransition>[0];

  function visible(table: TableView, year = 1042): boolean {
    const result = revealTransition(
      { ...quietView, year }, table, new Set<RevealElement>(), { showEverything: false },
    );
    return result.shown.has('table') && result.newlyShown.includes('table');
  }

  it('keeps the normal ten-year floor when there is no available order', () => {
    expect(visible(quietTable)).toBe(false);
    expect(visible(quietTable, 1051)).toBe(false);
    expect(visible(quietTable, 1052)).toBe(true);
    expect(visible({ ...quietTable, auction: {
      year: 1045, lots: 0, lowestReserve: 0, items: [], heirlooms: [],
    } })).toBe(false);
  });

  it('opens for an actual free shelf study, not an unreadable shelf copy', () => {
    const book: TableView['shelf'][number] = {
      book: 'book-test', name: 'A primer', years: 4,
      readers: [], condition: 100, conditionLabel: 'pristine',
    };
    expect(visible({ ...quietTable, shelf: [book] })).toBe(false);
    expect(visible({ ...quietTable, shelf: [
      { ...book, readers: [{ person: 'reader', name: 'A reader' }] },
    ] })).toBe(true);
  });

  it('never hides a Table that was already revealed', () => {
    const previous = new Set<RevealElement>(['table']);
    const result = revealTransition(quietView, quietTable, previous, { showEverything: false });
    expect(result.shown.has('table')).toBe(true);
    expect(result.newlyShown).not.toContain('table');
  });

  it('opens while an auction with a real lot is announced', () => {
    expect(visible({ ...quietTable, auction: {
      year: 1045, lots: 1, lowestReserve: 60,
      items: [{
        id: 'test-lot', kind: 'spellbook', name: 'A primer',
        seller: 'A creditor', saleYear: 1045, reserve: 60,
      }],
      heirlooms: [],
    } })).toBe(true);
  });
});


/** Deterministic replay seeds are not unique run ids (#1543). */
describe('progressive reveal namespaces for different houses (#1543)', () => {
  const first = {
    seed: 1042,
    campaign: { id: 'short', startYear: 1042 },
    houseName: 'House Ash',
  } as unknown as Pick<import('@ed/core').SessionView, 'seed' | 'campaign' | 'houseName'>;

  it('does not carry unlocked panels from a different house with the same seed', () => {
    const records = new Map<string, string>();
    const storage = {
      getItem: (key: string) => records.get(key) ?? null,
      setItem: (key: string, value: string) => { records.set(key, value); },
    };
    const firstKey = revealStorageKey(first);
    const nextKey = revealStorageKey({ ...first, houseName: 'House Elm' });
    expect(nextKey).not.toBe(firstKey);

    saveRevealed(storage, firstKey, new Set<RevealElement>(['clock-long', 'table']));
    expect(loadRevealed(storage, firstKey)).toEqual(new Set(['clock-long', 'table']));
    expect(loadRevealed(storage, nextKey)).toEqual(new Set());
  });

  it('keeps the same namespace for a house across readings and separates campaigns', () => {
    const key = revealStorageKey(first);
    expect(revealStorageKey({ ...first })).toBe(key);
    expect(revealStorageKey({ ...first, campaign: { ...first.campaign, startYear: 1050 } })).not.toBe(key);
    expect(revealStorageKey({ ...first, seed: 1043 })).not.toBe(key);
    expect(revealStorageKey({ ...first, houseName: 'House Ash: The Younger' })).not.toBe(key);
  });
});
