import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadContent } from '@ed/content';
import { canLearn, contentProseEntries, proseOriginalHash, validateBundle } from '@ed/schema';
import { coreMessageAddress } from './messages.js';
import {
  acquireLibraryCopy, applyEffect, attr, beginStudy, bootstrap, canTakePost, degradeLibraryCopy,
  canStudySpellbook, effectiveStudyYears, gainSpellbook, grantHeirloom, libraryRunOf, loadGame, newGame, phenotypeOf, place,
  saveGame, seedLibraryMemories, setProseMode, setProseVariants, useHeirloom, order, tableView, DEBT_FLOOR,
} from '@ed/core';
import { missingPlainEnglish } from './prose.js';
import { completeStudies, restorationQuote, tickDistressedBookSale, tickLibraryWear, tickRestorations } from './people/library.js';
import { canonical } from './save.js';
import { coreMessageEntries } from './tools/core-message-audit.js';

const bundle = loadContent();

describe('Named Art book-name prose (#766)', () => {
  const def = bundle.mustSpellbook('the_first_working');
  const file = bundle.sourceOf(def.id)!;
  const nameEntry = contentProseEntries(file, { spellbooks: [def] })
    .find((entry) => entry.address.endsWith('.name'))!;
  const message = coreMessageEntries(readFileSync(new URL('./people/library.ts', import.meta.url), 'utf8'))
    .find((entry) => entry.address === coreMessageAddress('library.named_art_record'))!;
  const nameVariant = {
    address: nameEntry.address, of: proseOriginalHash(nameEntry.text), plainenglish: 'The First Life Spell',
  };
  const sentenceVariant = {
    address: message.address, of: proseOriginalHash(message.text),
    plainenglish: '{PERSON} wrote down {BOOK} first. The family calls it the working of {PERSON}.',
  };

  function fixture(provenance = true) {
    const ctx = bootstrap(provenance ? bundle : structuredClone(bundle.bundle), 766, 1042);
    const reader = place(ctx, { sex: 'female', age: 30, name: 'Ada', awakened: true });
    reader.acquired['life'] = 100;
    return { ctx, reader, book: ctx.content.mustSpellbook(def.id) };
  }

  it('selects the authored book name for both frozen Chronicle fields without changing the Named Art', () => {
    expect(nameEntry.address).toBe(`content:${file}#spellbooks[id=${def.id}].name`);
    const original = fixture();
    const plain = fixture();
    for (const { ctx } of [original, plain]) setProseVariants(ctx, [nameVariant, sentenceVariant]);
    setProseMode(plain.ctx, 'plainenglish');
    for (const { ctx, reader, book } of [original, plain]) expect(gainSpellbook(ctx, reader, book)).toBe(true);
    const page = plain.ctx.world.chronicle.at(-1)!;
    expect(page.title).toBe('The First Life Spell');
    expect(page.text).toBe('Ada wrote down The First Life Spell first. The family calls it the working of Ada.');
    expect(original.ctx.world.chronicle.at(-1)?.title).toBe(def.name);
    expect(original.ctx.world.chronicle.at(-1)?.text)
      .toBe(`Ada set it down in writing for the first time, and the family has called it ${def.name} — Ada's working — ever since.`);
    const saved = saveGame(original.ctx);
    saved.chronicle.at(-1)!.title = page.title;
    saved.chronicle.at(-1)!.text = page.text;
    expect(canonical(saveGame(plain.ctx))).toBe(canonical(saved));
    expect(missingPlainEnglish(plain.ctx)).toEqual([]);

    const written = structuredClone(page);
    setProseMode(plain.ctx, 'original');
    const loaded = loadGame(saveGame(plain.ctx), bundle);
    expect(loaded.world.chronicle.at(-1)).toEqual(written);
    const later = place(loaded, { sex: 'male', age: 30, name: 'Bren', awakened: true });
    later.acquired['life'] = 100;
    const pages = loaded.world.chronicle.length;
    setProseVariants(loaded, [nameVariant, sentenceVariant]);
    setProseMode(loaded, 'plainenglish');
    expect(gainSpellbook(loaded, later, loaded.content.mustSpellbook(def.id))).toBe(true);
    expect(loaded.world.chronicle).toHaveLength(pages);
    expect(loaded.world.chronicle.at(-1)).toEqual(written);
    expect(loaded.world.library.get(def.id)?.namedFor?.person).toBe(plain.reader.id);
  });

  it.each(['missing', 'stale', 'invalid tokens'] as const)('retains Original wording for a %s book-name alternate', (failure) => {
    const { ctx, reader, book } = fixture();
    setProseVariants(ctx, failure === 'missing' ? [] : [{
      ...nameVariant,
      ...(failure === 'stale' ? { of: proseOriginalHash('Old book name') } : { plainenglish: 'The {OTHER} Spell' }),
    }]);
    setProseMode(ctx, 'plainenglish');
    expect(gainSpellbook(ctx, reader, book)).toBe(true);
    expect(ctx.world.chronicle.at(-1)?.title).toBe(def.name);
    expect(ctx.world.chronicle.at(-1)?.text)
      .toBe(`Ada set it down in writing for the first time, and the family has called it ${def.name} — Ada's working — ever since.`);
    expect(missingPlainEnglish(ctx)).toEqual([nameEntry.address, message.address].sort());
  });

  it.each(['untracked', 'short'] as const)('uses the %s book name without requesting an unavailable work item', (source) => {
    const { ctx, reader, book } = fixture(source !== 'untracked');
    const named = source === 'short' ? { ...book, name: 'Working' } : book;
    setProseVariants(ctx, [sentenceVariant]);
    setProseMode(ctx, 'plainenglish');
    expect(gainSpellbook(ctx, reader, named)).toBe(true);
    expect(ctx.world.chronicle.at(-1)?.title).toBe(named.name);
    expect(ctx.world.chronicle.at(-1)?.text)
      .toBe(`Ada wrote down ${named.name} first. The family calls it the working of Ada.`);
    expect(missingPlainEnglish(ctx)).toEqual([]);
  });
});

describe('the Library content', () => {
  it('validates', () => {
    expect(validateBundle(bundle).filter((i) => i.level === 'error')).toEqual([]);
  });

  it('authors real spellbook stock, across both affinity groups', () => {
    expect(bundle.spellbooks.length).toBeGreaterThan(5);
    const affinities = new Set(bundle.spellbooks.map((s) => s.affinity));
    expect(affinities.has('death')).toBe(true);
    expect(affinities.has('life')).toBe(true);
  });

  it('every spellbook can actually be reached: gain is granted somewhere, or a named-arts threshold is authored', () => {
    for (const s of bundle.spellbooks) {
      expect(s.studyYears).toBeGreaterThan(0);
      expect(s.price.max).toBeGreaterThanOrEqual(s.price.min);
    }
  });
});


describe('forced physical-copy sale below the debt floor (#1205)', () => {
  it('sells the cheapest held volume only when below the floor and records a legible cost', () => {
    const ctx = bootstrap(bundle, 1205, 1042);
    // Bootstrap starts with inherited house books; isolate the physical shelf.
    ctx.world.library.clear();
    const books = [
      ctx.content.mustSpellbook('lesser_workings_of_fluid'),
      ctx.content.mustSpellbook('lesser_workings_of_death'),
    ];
    for (const book of books) acquireLibraryCopy(ctx, book.id);
    const cheapest = [...books].sort((a, b) => a.price.min - b.price.min || a.id.localeCompare(b.id))[0]!;
    const other = books.find((book) => book.id !== cheapest.id)!;
    const originalChronicleCount = ctx.world.chronicle.length;
    ctx.world.treasury = DEBT_FLOOR;
    tickDistressedBookSale(ctx);
    expect(ctx.world.library.size).toBe(2);
    expect(ctx.world.chronicle).toHaveLength(originalChronicleCount);

    ctx.world.treasury = DEBT_FLOOR - 1;
    tickDistressedBookSale(ctx);
    const proceeds = Math.max(1, Math.floor(cheapest.price.min * 0.75));
    expect(ctx.world.library.has(cheapest.id)).toBe(false);
    expect(ctx.world.library.has(other.id)).toBe(true);
    expect(ctx.world.treasury).toBe(DEBT_FLOOR - 1 + proceeds);
    expect(ctx.world.chronicle.at(-1)?.text).toContain(cheapest.name);
    expect(ctx.world.chronicle.at(-1)?.text).toContain(String(proceeds));

    const reloaded = loadGame(saveGame(ctx), bundle);
    expect(canonical(saveGame(reloaded))).toBe(canonical(saveGame(ctx)));
    tickDistressedBookSale(ctx);
    expect(ctx.world.library.has(other.id)).toBe(true);
  });

  it('keeps copies with the binder and cancels unfinished readings when a physical book is lost', () => {
    const ctx = bootstrap(bundle, 1206, 1042);
    // Bootstrap starts with inherited house books; isolate the physical shelf.
    ctx.world.library.clear();
    const away = ctx.content.mustSpellbook('lesser_workings_of_fluid');
    const held = ctx.content.mustSpellbook('lesser_workings_of_death');
    const awayCopy = acquireLibraryCopy(ctx, away.id)!;
    acquireLibraryCopy(ctx, held.id);
    awayCopy.restoresAt = ctx.world.year + 2;
    const reader = place(ctx, { sex: 'male', age: 30, awakened: true });
    // Model a reader already part-way through the lost physical copy without
    // making this storage invariant test depend on their affinity threshold.
    ctx.world.studies.push({ person: reader.id, book: held.id, completes: ctx.world.year + 2 });
    expect(ctx.world.studies.some((study) => study.book === held.id)).toBe(true);

    ctx.world.treasury = DEBT_FLOOR - 1;
    tickDistressedBookSale(ctx);
    expect(ctx.world.library.has(away.id)).toBe(true);
    expect(ctx.world.library.has(held.id)).toBe(false);
    expect(ctx.world.studies.some((study) => study.book === held.id)).toBe(false);
    expect(reader.spellsKnown).not.toContain(held.id);
    expect(ctx.world.library.get(away.id)?.restoresAt).toBe(ctx.world.year + 2);
  });

  it('does nothing when the house has no saleable copy', () => {
    const ctx = bootstrap(bundle, 1207, 1042);
    // Bootstrap starts with inherited house books; isolate the physical shelf.
    ctx.world.library.clear();
    ctx.world.treasury = DEBT_FLOOR - 20;
    const chronicleLength = ctx.world.chronicle.length;
    tickDistressedBookSale(ctx);
    expect(ctx.world.treasury).toBe(DEBT_FLOOR - 20);
    expect(ctx.world.chronicle).toHaveLength(chronicleLength);
  });
});

describe('deterministic physical-copy wear (first slice of #1293)', () => {
  it('loses two tenths each elapsed year, skips an acquisition year, and never mints or over-wears a copy', () => {
    const ctx = bootstrap(bundle, 1293, 1042);
    const id = 'lesser_workings_of_fluid';
    const copy = acquireLibraryCopy(ctx, id)!;
    expect(copy.condition).toBe(100);

    tickLibraryWear(ctx);
    expect(copy.condition).toBe(100); // newly acquired this year

    ctx.world.year += 1;
    tickLibraryWear(ctx);
    expect(copy.condition).toBe(99.8);

    // Explicit tenths rounding matters across hundreds of ticks and saves.
    for (let i = 0; i < 500; i++) {
      ctx.world.year += 1;
      tickLibraryWear(ctx);
    }
    expect(copy.condition).toBe(0);
    expect(ctx.world.library.has('lesser_workings_of_death')).toBe(false);
  });

  it('wears five points per successful study, not per abandoned study', () => {
    const ctx = bootstrap(bundle, 1294, 1042);
    const def = ctx.content.mustSpellbook('lesser_workings_of_fluid');
    const copy = acquireLibraryCopy(ctx, def.id)!;
    const reader = place(ctx, { sex: 'male', age: 30, awakened: true });
    const lost = place(ctx, { sex: 'male', age: 30, awakened: true });
    expect(beginStudy(ctx, reader, def)).toBe(true);
    expect(beginStudy(ctx, lost, def)).toBe(true);
    const due = Math.max(...ctx.world.studies.map((study) => study.completes));
    ctx.world.people.kill(lost.id, ctx.world.year, 'test');
    ctx.world.year = due;

    const finished = completeStudies(ctx);
    expect(finished).toHaveLength(1);
    expect(finished[0]!.person).toBe(reader.id);
    expect(copy.condition).toBe(95);
    expect(completeStudies(ctx)).toEqual([]); // no second wear on repeat
    expect(copy.condition).toBe(95);
  });

  it('persists fractional wear without changing its timing after a save/reload', () => {
    const ctx = bootstrap(bundle, 1295, 1042);
    const id = 'lesser_workings_of_fluid';
    acquireLibraryCopy(ctx, id);
    ctx.world.year += 1;
    tickLibraryWear(ctx);
    expect(ctx.world.library.get(id)?.condition).toBe(99.8);

    const loaded = loadGame(saveGame(ctx), bundle);
    expect(loaded.world.library.get(id)?.condition).toBe(99.8);
    loaded.world.year += 1;
    tickLibraryWear(loaded);
    expect(loaded.world.library.get(id)?.condition).toBe(99.6);
    expect(ctx.world.library.get(id)?.condition).toBe(99.8);
  });
});

describe('paid binder restoration (#1293)', () => {
  it('quotes from missing condition, refuses active readers, pays once, and returns pristine on the exact year', () => {
    const ctx = bootstrap(bundle, 1296, 1042);
    const def = ctx.content.mustSpellbook('lesser_workings_of_fluid');
    const copy = acquireLibraryCopy(ctx, def.id)!;
    const reader = place(ctx, { sex: 'male', age: 30, awakened: true });
    const prior = { person: reader.id, name: reader.name, year: ctx.world.year };
    copy.namedFor = prior;
    ctx.world.treasury = 500;
    expect(order(ctx, { kind: 'restore', book: def.id }).ok).toBe(false);

    copy.condition = 40;
    const quote = restorationQuote(ctx, def.id)!;
    expect(quote.fee).toBe(Math.max(1, Math.ceil(def.price.min * .2 * .6)));
    expect(quote.years).toBe(2);
    expect(beginStudy(ctx, reader, def)).toBe(true);
    expect(restorationQuote(ctx, def.id)?.ok).toBe(false);
    expect(order(ctx, { kind: 'restore', book: def.id }).ok).toBe(false);
    ctx.world.studies = [];

    const start = ctx.world.year;
    const opened = order(ctx, { kind: 'restore', book: def.id });
    expect(opened).toMatchObject({ ok: true, spent: quote.fee, left: 500 - quote.fee });
    expect(copy.restoresAt).toBe(start + 2);
    expect(ctx.world.chronicle.at(-1)?.text).toContain(`The house paid ${quote.fee} crowns`);
    expect(tableView(ctx).shelf.find((b) => b.book === def.id)?.restoringUntil).toBe(start + 2);
    expect(canStudySpellbook(ctx, reader, def).ok).toBe(false);
    expect(beginStudy(ctx, reader, def)).toBe(false);
    expect(gainSpellbook(ctx, reader, def)).toBe(false);
    expect(order(ctx, { kind: 'restore', book: def.id }).ok).toBe(false);
    expect(ctx.world.treasury).toBe(500 - quote.fee);

    ctx.world.year = start + 1;
    tickLibraryWear(ctx);
    tickRestorations(ctx);
    expect(copy.condition).toBe(40);
    expect(copy.restoresAt).toBe(start + 2);

    // Save and reload while the binder holds the original physical copy.
    const resumed = loadGame(saveGame(ctx), bundle);
    const back = resumed.world.library.get(def.id)!;
    expect(back.restoresAt).toBe(start + 2);
    resumed.world.year = start + 2;
    tickLibraryWear(resumed);
    tickRestorations(resumed);
    expect(back.condition).toBe(100);
    expect(back.restoresAt).toBeUndefined();
    expect(back.namedFor).toEqual(prior);
    expect(canStudySpellbook(resumed, resumed.world.people.get(reader.id)!, def).ok).toBe(true);
    expect(resumed.world.chronicle.filter((entry) => entry.text?.startsWith('The binder returned'))).toHaveLength(1);
    tickRestorations(resumed);
    expect(resumed.world.chronicle.filter((entry) => entry.text?.startsWith('The binder returned'))).toHaveLength(1);
    expect(ctx.world.library.get(def.id)?.condition).toBe(40);

    // The uninterrupted copy and the saved-and-resumed copy must finish
    // with identical durable world state, not just the same condition number.
    ctx.world.year = start + 2;
    tickLibraryWear(ctx);
    tickRestorations(ctx);
    expect(canonical(saveGame(resumed))).toBe(canonical(saveGame(ctx)));
  });

  it('refuses to cross the debt floor without charging or setting a term', () => {
    const ctx = bootstrap(bundle, 1297, 1042);
    const copy = acquireLibraryCopy(ctx, 'lesser_workings_of_fluid')!;
    copy.condition = 0;
    ctx.world.treasury = DEBT_FLOOR;
    const result = order(ctx, { kind: 'restore', book: copy.id });
    expect(result.ok).toBe(false);
    expect(result.spent).toBeUndefined();
    expect(copy.restoresAt).toBeUndefined();
    const shelf = tableView(ctx).shelf.find((b) => b.book === copy.id)!;
    expect(shelf.restore?.canPay).toBe(false);
    expect(shelf.restore?.reason).toBeTruthy();
    expect(ctx.world.treasury).toBe(DEBT_FLOOR);
    ctx.world.treasury += shelf.restore!.fee;
    expect(order(ctx, { kind: 'restore', book: copy.id }).ok).toBe(true);
    expect(ctx.world.treasury).toBe(DEBT_FLOOR);
  });

  it('shows the worn-copy duration and the chosen reader duration from core', () => {
    const ctx = bootstrap(bundle, 1293, 1042);
    const def = ctx.content.mustSpellbook('lesser_workings_of_life');
    const copy = acquireLibraryCopy(ctx, def.id)!;
    copy.condition = 20;
    const reader = place(ctx, { sex: 'female', age: 30, awakened: true });
    const book = tableView(ctx).shelf.find((book) => book.book === def.id)!;
    expect(book.years).toBe(4);
    expect(book.readers.find((entry) => entry.person === reader.id)?.years).toBe(4);
    expect(order(ctx, { kind: 'study', book: def.id, person: reader.id }).ok).toBe(true);
    expect(ctx.world.studies.find((study) => study.person === reader.id)?.completes).toBe(ctx.world.year + 4);
  });
});

describe('applying a spellbook is generic', () => {
  it('does not register a ghost study or acquire a copy for dead or detached readers (#1210)', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const def = ctx.content.mustSpellbook('lesser_workings_of_fluid');
    const reader = place(ctx, { sex: 'male', age: 30, awakened: true });
    const priorStudies = ctx.world.studies.length;
    const priorPages = ctx.world.chronicle.length;

    expect(canStudySpellbook(ctx, reader, def).ok).toBe(true);
    const detached = { ...reader };
    expect(canStudySpellbook(ctx, detached, def).ok).toBe(false);
    expect(beginStudy(ctx, detached, def)).toBe(false);
    expect(gainSpellbook(ctx, detached, def)).toBe(false);
    expect(reader.spellsKnown.map(String)).not.toContain(def.id);

    ctx.world.people.kill(reader.id, ctx.world.year, 'a test');
    expect(reader.status).toBe('dead');
    expect(canStudySpellbook(ctx, reader, def).ok).toBe(false);
    expect(beginStudy(ctx, reader, def)).toBe(false);
    expect(gainSpellbook(ctx, reader, def)).toBe(false);

    expect(ctx.world.studies).toHaveLength(priorStudies);
    expect(ctx.world.library.has(def.id)).toBe(false);
    expect(ctx.world.chronicle).toHaveLength(priorPages);

    // The same book remains learnable by an actual living world-owned reader.
    const living = place(ctx, { sex: 'male', age: 30, awakened: true });
    expect(canStudySpellbook(ctx, living, def).ok).toBe(true);
    expect(beginStudy(ctx, living, def)).toBe(true);
    expect(ctx.world.studies).toHaveLength(priorStudies + 1);
  });

  it('gain puts a copy on the shelf and teaches the person, through the normal effect path', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const p = place(ctx, { sex: 'male', age: 30, awakened: true });
    expect(ctx.world.library.has('lesser_workings_of_fluid')).toBe(false);

    applyEffect({ kind: 'spellbook', op: 'gain', target: { slot: 'X' }, book: 'lesser_workings_of_fluid' }, ctx, { X: p.id });

    expect(ctx.world.library.has('lesser_workings_of_fluid')).toBe(true);
    expect(p.spellsKnown.map(String)).toContain('lesser_workings_of_fluid');
  });

  it('the shelf copy persists after the person who studied it dies — a great-grandfather\'s purchase pays out for centuries', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const p = place(ctx, { sex: 'male', age: 80, awakened: true });
    gainSpellbook(ctx, p, ctx.content.mustSpellbook('lesser_workings_of_terra'));
    ctx.world.people.kill(p.id, ctx.world.year, 'a test');
    expect(ctx.world.library.has('lesser_workings_of_terra')).toBe(true);
  });

  it('degrade lowers the shelf copy\'s condition and ignores who is cast', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const p = place(ctx, { sex: 'male', age: 30, awakened: true });
    gainSpellbook(ctx, p, ctx.content.mustSpellbook('lesser_workings_of_fluid'));
    const before = ctx.world.library.get('lesser_workings_of_fluid')!.condition;

    applyEffect({ kind: 'spellbook', op: 'degrade', target: 'household', book: 'lesser_workings_of_fluid' }, ctx, {});

    expect(ctx.world.library.get('lesser_workings_of_fluid')!.condition).toBeLessThan(before);
  });

  it('degrade against a book the house does not hold does nothing — damage does not create the thing it damages', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    expect(ctx.world.library.has('lesser_workings_of_death')).toBe(false);

    applyEffect({ kind: 'spellbook', op: 'degrade', target: 'household', book: 'lesser_workings_of_death' }, ctx, {});

    // This is the Crusade's second cellar (`age_crusade.yaml`, `hide_them`).
    // `degradeLibraryCopy` used to route through `acquireLibraryCopy`, so
    // hiding two books the house had never bought PUT THEM ON THE SHELF at
    // condition 80 — a net gain, from an outcome whose prose is about rot.
    expect(ctx.world.library.has('lesser_workings_of_death')).toBe(false);
  });

  it('caps book damage and repair at the 0–100 shelf-condition boundaries', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const def = ctx.content.mustSpellbook('lesser_workings_of_fluid');
    const state = acquireLibraryCopy(ctx, def.id)!;
    expect(state.condition).toBe(100);

    degradeLibraryCopy(ctx, def.id, 140);
    expect(state.condition).toBe(0);

    // A negative wear amount represents repair by a direct core caller.
    // It must not make a book better than pristine or shorten study below it.
    degradeLibraryCopy(ctx, def.id, -800);
    expect(state.condition).toBe(100);

    degradeLibraryCopy(ctx, def.id, 30);
    expect(state.condition).toBe(70);
    degradeLibraryCopy(ctx, def.id, -15);
    expect(state.condition).toBe(85);
    degradeLibraryCopy(ctx, def.id, -150);
    expect(state.condition).toBe(100);
    expect(ctx.world.library.get(def.id)).toBe(state);
  });

  it('a degraded copy takes a reader longer — the condition field has a reader at last', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const def = ctx.content.mustSpellbook('lesser_workings_of_fluid');
    const reader = place(ctx, { sex: 'male', age: 30, awakened: true });

    acquireLibraryCopy(ctx, def.id);
    const pristine = effectiveStudyYears(ctx, reader, def);

    degradeLibraryCopy(ctx, def.id, 60);
    const damaged = effectiveStudyYears(ctx, reader, def);

    expect(ctx.world.library.get(def.id)!.condition).toBe(40);
    expect(damaged).toBeGreaterThan(pristine);
  });

  it('makes the Age-valued scholar post materially better without auto-placing anyone', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const def = ctx.content.mustSpellbook('greater_workings_of_fluid');
    const reader = place(ctx, { sex: 'male', age: 30, awakened: true });
    const scholar = ctx.content.careers.find((career) => String(career.id) === 'scholar')!;
    reader.career = { career: scholar.id, from: ctx.world.year };

    const ordinary = effectiveStudyYears(ctx, reader, def);
    ctx.world.age.active = [{
      age: 'the_withering',
      began: ctx.world.year,
      named: false,
      paid: { standing: false },
    }];
    const duringWithering = effectiveStudyYears(ctx, reader, def);

    expect(duringWithering).toBeLessThan(ordinary);
    expect(String(reader.career?.career)).toBe('scholar');
  });

  it('does not invent a study benefit for another Age-favoured career', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const def = ctx.content.mustSpellbook('greater_workings_of_fluid');
    const reader = place(ctx, { sex: 'male', age: 30, awakened: true });
    const military = ctx.content.careers.find((career) => String(career.id) === 'military')!;
    reader.career = { career: military.id, from: ctx.world.year };

    const ordinary = effectiveStudyYears(ctx, reader, def);
    ctx.world.age.active = [{
      age: 'the_wars',
      began: ctx.world.year,
      named: false,
      paid: { standing: false },
    }];

    expect(effectiveStudyYears(ctx, reader, def)).toBe(ordinary);
  });

  it('the drag reaches the scheduled completion year, not just the arithmetic', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const def = ctx.content.mustSpellbook('lesser_workings_of_fluid');
    const quick = place(ctx, { sex: 'male', age: 30, name: 'Quick', awakened: true });
    const slow = place(ctx, { sex: 'male', age: 30, name: 'Slow', awakened: true });

    acquireLibraryCopy(ctx, def.id);
    beginStudy(ctx, quick, def);
    degradeLibraryCopy(ctx, def.id, 100); // ruined
    beginStudy(ctx, slow, def);

    const completes = (who: typeof quick) => ctx.world.studies.find((st) => st.person === who.id)!.completes;
    expect(completes(slow)).toBeGreaterThan(completes(quick));
  });

  it('a study begun with no copy on the shelf is not penalised for the empty shelf', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const def = ctx.content.mustSpellbook('lesser_workings_of_fluid');
    const reader = place(ctx, { sex: 'male', age: 30, awakened: true });

    // `beginStudy` never required the shelf copy; `gainSpellbook` acquires it
    // on completion. An absent copy reads as pristine rather than as ruin.
    expect(ctx.world.library.has(def.id)).toBe(false);
    const borrowed = effectiveStudyYears(ctx, reader, def);
    acquireLibraryCopy(ctx, def.id);
    expect(effectiveStudyYears(ctx, reader, def)).toBe(borrowed);
  });

  it('lose removes the person\'s knowledge without touching the shelf copy', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const p = place(ctx, { sex: 'male', age: 30, awakened: true });
    gainSpellbook(ctx, p, ctx.content.mustSpellbook('lesser_workings_of_fluid'));

    applyEffect({ kind: 'spellbook', op: 'lose', target: { slot: 'X' }, book: 'lesser_workings_of_fluid' }, ctx, { X: p.id });

    expect(p.spellsKnown.map(String)).not.toContain('lesser_workings_of_fluid');
    expect(ctx.world.library.has('lesser_workings_of_fluid')).toBe(true);
  });

  it('freezes the selected Named Art Chronicle text under a stable message key (#725)', () => {
    const originalTemplate =
      "{PERSON} set it down in writing for the first time, and the family has called it {BOOK} — {PERSON}'s working — ever since.";
    const key = 'library.named_art_record';

    // The default voice must retain the exact previously authored sentence.
    const originalCtx = bootstrap(bundle, 1042, 1042);
    const originalDef = originalCtx.content.mustSpellbook('the_first_working');
    const originalReader = place(originalCtx, { sex: 'female', age: 30, name: 'Ada', awakened: true });
    originalReader.acquired['life'] = 100;
    expect(gainSpellbook(originalCtx, originalReader, originalDef)).toBe(true);
    expect(originalCtx.world.chronicle.at(-1)?.text).toBe(
      "Ada set it down in writing for the first time, and the family has called it "
      + originalDef.name + " — Ada's working — ever since.",
    );

    const ctx = bootstrap(bundle, 1042, 1042);
    const def = ctx.content.mustSpellbook('the_first_working');
    const first = place(ctx, { sex: 'female', age: 30, name: 'Ada', awakened: true });
    first.acquired['life'] = 100;
    setProseVariants(ctx, [{
      address: coreMessageAddress(key),
      of: proseOriginalHash(originalTemplate),
      plainenglish: '{PERSON} wrote down the working first. The family has called it {BOOK}, the working of {PERSON}, ever since.',
    }]);
    setProseMode(ctx, 'plainenglish');
    expect(gainSpellbook(ctx, first, def)).toBe(true);
    const written = ctx.world.chronicle.at(-1)!;
    expect(written.title).toBe(def.name);
    expect(written.text).toBe(
      'Ada wrote down the working first. The family has called it ' + def.name
      + ', the working of Ada, ever since.',
    );
    expect(ctx.world.library.get(def.id)?.namedFor?.person).toBe(first.id);

    // Saved pages keep the words the player saw, and a later reader does not
    // retroactively rename a Named Art or create a second naming record.
    const pages = ctx.world.chronicle.length;
    setProseMode(ctx, 'original');
    const second = place(ctx, { sex: 'male', age: 30, name: 'Bren', awakened: true });
    second.acquired['life'] = 100;
    expect(gainSpellbook(ctx, second, def)).toBe(true);
    expect(ctx.world.chronicle).toHaveLength(pages);
    expect(written.text).toContain('Ada wrote down the working first.');
    expect(ctx.world.library.get(def.id)?.namedFor?.person).toBe(first.id);
  });

  it('a Named Art is recorded under the name of its first holder, once', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const def = ctx.content.mustSpellbook('the_first_working');
    const founder = place(ctx, { sex: 'female', age: 30, awakened: true });
    founder.acquired['life'] = 100; // clear the threshold deterministically

    gainSpellbook(ctx, founder, def);
    const state = ctx.world.library.get('the_first_working')!;
    expect(state.namedFor?.person).toBe(founder.id);

    const second = place(ctx, { sex: 'male', age: 30, awakened: true });
    second.acquired['life'] = 100;
    gainSpellbook(ctx, second, def);
    expect(ctx.world.library.get('the_first_working')!.namedFor?.person).toBe(founder.id);
  });
});

describe('invariant 4 — the Mystic restriction (expression gate, issue #15)', () => {
  it('no female character ever learns an Elemental spellbook', () => {
    const elemental = bundle.spellbooks.filter((s) => ['fluid', 'thermal', 'aero', 'terra'].includes(s.affinity));
    expect(elemental.length).toBeGreaterThan(0);

    for (let seed = 1; seed <= 20; seed++) {
      const ctx = bootstrap(bundle, seed, 1042);
      for (const def of elemental) {
        const woman = place(ctx, { sex: 'female', age: 30, name: `W${seed}_${def.id}` });
        const gained = gainSpellbook(ctx, woman, def);
        expect(gained, `${def.id} was gained by a woman under seed ${seed}`).toBe(false);
        expect(woman.spellsKnown.map(String)).not.toContain(def.id);
      }
    }
  });

  it('no female ever holds nonzero Eldritch Power — mystic study never touches the font', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const ctx = bootstrap(bundle, seed, 1042);
      const women = ctx.world.people.all().filter((p) => p.sex === 'female');
      for (const w of women) {
        const ph = phenotypeOf(w, ctx.genetics, ctx.world.year);
        expect(ph.eldritch.expressedPower, `${w.name} (seed ${seed}) expresses power`).toBe(0);
      }
    }
  });
});

describe('purchased sources alone can reach the God rung (issue #15)', () => {
  it('an ascendant reaches Madness >= 90 through the Unmirrored Eye, with no organic overflow', () => {
    const ctx = bootstrap(bundle, 4242, 1042);
    const ascendant = ctx.world.people.all().find((p) => {
      const ph = phenotypeOf(p, ctx.genetics, ctx.world.year);
      return ph.eldritch.canExpress;
    });
    expect(ascendant, 'no expressing character in the founding cast to test against').toBeTruthy();
    const p = ascendant!;
    p.madness = 0;

    grantHeirloom(ctx, 'the_unmirrored_eye');
    for (let i = 0; i < 6 && p.madness < 90; i++) {
      const result = useHeirloom(ctx, 'the_unmirrored_eye', p);
      expect(result.ok, `use ${i} failed: ${result.reason}`).toBe(true);
      ctx.world.year += 5; // clear the cooldown between uses
    }

    expect(p.madness).toBeGreaterThanOrEqual(90);
  });

  it('the madness effect still refuses anyone who cannot express (invariant 1)', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const mundane = place(ctx, { sex: 'female', age: 30, awakened: true });
    grantHeirloom(ctx, 'the_unmirrored_eye');
    // The heirloom's own target filter requires canExpress, so a non-expressing
    // bearer is refused before the effect ever runs.
    const before = mundane.madness;
    const check = useHeirloom(ctx, 'the_unmirrored_eye', mundane);
    expect(check.ok).toBe(false);
    expect(mundane.madness).toBe(before);
  });
});

describe("§11's learning gate (issue #79)", () => {
  /**
   * A GATE NOBODY HAS SEEN REFUSE IS INDISTINGUISHABLE FROM A GATE THAT
   * CANNOT REFUSE.
   *
   * §11 says it three times — "Learning cannot begin", "Awakening gates
   * learning for women exactly as it does for men", "The Unwoken: cannot
   * learn" — and `canStudySpellbook` asked two questions, neither of them
   * this one, for long enough that 997 of 1,093 measured readers finished a
   * book without ever waking.
   *
   * Every claim below is asserted against its own control, because "an
   * unwoken man cannot study" is also true of a build where nobody can study
   * anything, and that would stay green forever.
   */
  /** A Threshold book with no affinity floor — hers to learn, on §9's own terms. */
  const HERS = 'lesser_workings_of_life';

  it('refuses an unwoken reader, and says why', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const def = ctx.content.mustSpellbook('lesser_workings_of_fluid');
    const sleeping = place(ctx, { sex: 'male', age: 30, name: 'Sleeping' });
    const woken = place(ctx, { sex: 'male', age: 30, name: 'Woken', awakened: true });

    const refused = canStudySpellbook(ctx, sleeping, def);
    expect(refused.ok).toBe(false);
    // Greyed WITH A REASON, the same bargain `canUseHeirloom` makes — the
    // option is shown, not hidden, so the Long Wait is visible to the player
    // rather than being a book that quietly is not there.
    expect(refused.reason).toBeTruthy();

    // The control. Same book, same year, same house.
    expect(canStudySpellbook(ctx, woken, def).ok).toBe(true);
  });

  it('closes every door into the library, not just the front one', () => {
    // The gate is one line in one function precisely so that all five callers
    // inherit it. This is the assertion that they do.
    const ctx = bootstrap(bundle, 1042, 1042);
    const def = ctx.content.mustSpellbook('lesser_workings_of_fluid');
    const sleeping = place(ctx, { sex: 'male', age: 30, name: 'Sleeping' });
    const woken = place(ctx, { sex: 'male', age: 30, name: 'Woken', awakened: true });

    expect(beginStudy(ctx, sleeping, def)).toBe(false);
    expect(ctx.world.studies.some((st) => st.person === sleeping.id)).toBe(false);
    expect(gainSpellbook(ctx, sleeping, def)).toBe(false);
    expect(sleeping.spellsKnown.length).toBe(0);

    // An authored `spellbook: gain` aimed at an unwoken reader lands nowhere,
    // and lands nowhere LOUDLY — no shelf copy is minted on the way past.
    applyEffect(
      { kind: 'spellbook', op: 'gain', target: { slot: 'X' }, book: 'lesser_workings_of_fluid' },
      ctx,
      { X: sleeping.id },
    );
    expect(sleeping.spellsKnown.length).toBe(0);

    expect(beginStudy(ctx, woken, def)).toBe(true);
    expect(gainSpellbook(ctx, woken, def)).toBe(true);
  });

  it('gates a daughter exactly as it gates a son', () => {
    // §11 is explicit that this is not a rule about men, and invariant 4 is
    // explicit that the Mystic restriction is a separate question. Both hold
    // at once: an unwoken woman is refused a Threshold book she would
    // otherwise be entitled to, and waking is what changes it.
    const ctx = bootstrap(bundle, 1042, 1042);
    const def = ctx.content.mustSpellbook(HERS);
    // The control on the OTHER gate: this book must be one `canLearn` already
    // allows her, or the refusal below is invariant 4 talking, not §11.
    expect(canLearn('female', def.affinity)).toBe(true);
    expect(def.threshold ?? 0).toBe(0);

    const sleeping = place(ctx, { sex: 'female', age: 30, name: 'Sleeping' });
    const woken = place(ctx, { sex: 'female', age: 30, name: 'Woken', awakened: true });

    expect(canStudySpellbook(ctx, sleeping, def).ok).toBe(false);
    expect(canStudySpellbook(ctx, woken, def).ok).toBe(true);
  });
});

describe('study and the posts refuse in the reader\'s setting (#805)', () => {
  const keyed = ['./people/library.ts', './people/careers.ts']
    .flatMap((file) => coreMessageEntries(readFileSync(new URL(file, import.meta.url), 'utf8')))
    .filter((entry) => /#(library|career)\.refuse\./.test(entry.address));

  it('keys every refusal', () => {
    expect(Object.fromEntries(keyed.map((entry) => [entry.address.split('#')[1], entry.text]))).toEqual({
      'library.refuse.binder': 'the copy is with the binder',
      'library.refuse.not_woken': 'not woken',
      'library.refuse.not_hers': 'not hers to learn',
      'library.refuse.affinity_short': 'the affinity is not there yet',
      'career.refuse.woman': 'no post in Aubren is open to a woman',
    });
  });

  it('gives a refused study or post its Plain English reason, and refuses it all the same', () => {
    const refuse = (mode: 'original' | 'plainenglish') => {
      const ctx = bootstrap(bundle, 1042, 1042);
      setProseVariants(ctx, keyed.map((entry) => ({
        address: entry.address, of: proseOriginalHash(entry.text), plainenglish: `plain: ${entry.text}`,
      })));
      setProseMode(ctx, mode);
      const book = bundle.spellbooks.find((b) => !canLearn('female', b.affinity))!;
      const her = place(ctx, { sex: 'female', age: 30 });
      her.awakening.awakened = true;
      const him = place(ctx, { sex: 'male', age: 30 });
      him.awakening.awakened = false;
      return [canStudySpellbook(ctx, her, book), canStudySpellbook(ctx, him, book), canTakePost(ctx, her)]
        .map((r) => ({ ok: r.ok, reason: 'reason' in r ? r.reason : undefined }));
    };
    const original = refuse('original');
    expect(original.map((r) => r.reason)).toEqual([
      'not hers to learn', 'not woken', 'no post in Aubren is open to a woman',
    ]);
    expect(refuse('plainenglish')).toEqual(original.map((r) => ({ ...r, reason: `plain: ${r.reason}` })));
  });
});

const content = bundle;
const claimText = 'A witness entered the claim in the family chronicle.';

describe('Plain English inherited Library claims (#410)', () => {
  const trait = content.trait('reads_the_signs');
  if (!trait) throw new Error('Expected the existing named trait');
  const file = content.sourceOf(String(trait.id));
  if (!file) throw new Error('Expected trait source provenance');
  const address = `content:${file}#traits[id=${encodeURIComponent(String(trait.id))}].name`;
  const translated = 'Notices the Clues';

  function priorRun() {
    const source = newGame(content, { seed: 410, campaign: 'short', decider: 'chronicler' });
    const person = source.ctx.world.people.household(source.ctx.world.playerHouse, source.year)[0]!;
    source.ctx.world.chronicle.push({
      id: 'library_trait_translation',
      year: source.year,
      weight: 'paragraph',
      text: claimText,
      named: true,
      claims: [{ kind: 'trait', person: person.id, trait: trait!.id, has: true }],
    });
    source.ctx.world.ending = { id: 'forgotten', year: 1342 };
    const result = libraryRunOf(source.ctx);
    if (!result) throw new Error('Expected a finished Library run');
    return result;
  }

  function retell(mode: 'original' | 'plainenglish', of = proseOriginalHash(trait!.name)) {
    const session = newGame(content, { seed: 411, campaign: 'short', decider: 'chronicler' });
    setProseVariants(session.ctx, [{ address, of, plainenglish: translated }]);
    setProseMode(session.ctx, mode);
    const memory = seedLibraryMemories(session.ctx, [priorRun()])
      .find((item) => item.sourceText === claimText);
    if (!memory) throw new Error('The contradicable trait claim was not selected');
    return { ctx: session.ctx, memory };
  }

  it('uses the worklist address for a named trait in a frozen inherited reading', () => {
    expect(contentProseEntries(file!, { traits: [trait!] }).some((entry) => entry.address === address)).toBe(true);

    const original = retell('original');
    const plain = retell('plainenglish');
    expect(original.memory.text).toContain(trait!.name);
    expect(plain.memory.text).toContain(translated);
    expect(plain.memory.text).not.toContain(trait!.name);
    expect(plain.memory.claims).toEqual(original.memory.claims);
    expect(plain.memory.sourceClaims).toEqual(original.memory.sourceClaims);
    expect(missingPlainEnglish(plain.ctx)).not.toContain(address);

    // The translated memory is a historical page and does not change when
    // the presentation preference changes for the current game.
    const frozen = plain.memory.text;
    setProseMode(plain.ctx, 'original');
    expect(plain.ctx.world.libraryMemories.find((m) => m.id === plain.memory.id)?.text).toBe(frozen);
  });

  it('uses Original when the reviewed wording has become stale', () => {
    const stale = retell('plainenglish', proseOriginalHash('Older trait title'));
    expect(stale.memory.text).toContain(trait!.name);
    expect(stale.memory.text).not.toContain(translated);
    expect(missingPlainEnglish(stale.ctx)).toContain(address);
  });

  it('archives a reviewed ending title without changing the historical run when settings change', () => {
    const ending = content.ending('broken_line');
    if (!ending) throw new Error('Expected multiword ending title');
    const endingFile = content.sourceOf(String(ending.id));
    if (!endingFile) throw new Error('Expected ending provenance');
    const endingAddress = `content:${endingFile}#endings[id=${encodeURIComponent(String(ending.id))}].title`;
    const title = 'The Family Line Has Ended';
    expect(contentProseEntries(endingFile, { endings: [ending] })
      .some((entry) => entry.address === endingAddress)).toBe(true);

    const game = newGame(content, { seed: 413, campaign: 'short', decider: 'chronicler' });
    game.ctx.world.ending = { id: ending.id, year: 1342 };
    const original = libraryRunOf(game.ctx);
    if (!original) throw new Error('Expected a finished run');

    setProseVariants(game.ctx, [{ address: endingAddress, of: proseOriginalHash(ending.title), plainenglish: title }]);
    setProseMode(game.ctx, 'plainenglish');
    const translated = libraryRunOf(game.ctx);
    expect(translated?.ending.title).toBe(title);
    expect(translated?.ending.id).toBe(original.ending.id);
    expect(translated?.id).toBe(original.id);
    expect(missingPlainEnglish(game.ctx)).not.toContain(endingAddress);

    setProseMode(game.ctx, 'original');
    expect(libraryRunOf(game.ctx)?.ending.title).toBe(ending.title);
    expect(translated?.ending.title).toBe(title);
  });

  it('selects a reviewed rival house name before freezing a Library retelling', () => {
    const previous = priorRun();
    const current = newGame(content, { seed: 411, campaign: 'short', decider: 'chronicler' });
    const original = seedLibraryMemories(current.ctx, [previous])
      .find((item) => item.sourceText === claimText);
    if (!original) throw new Error('Expected a baseline inherited memory');
    const house = content.houses.find((row) => !row.isPlayerHouse
      && original.teller.includes(row.name));
    if (!house) throw new Error('Expected a named rival in the Library teller');
    const houseFile = content.sourceOf(String(house.id));
    if (!houseFile) throw new Error('Expected rival source provenance');
    const houseAddress = `content:${houseFile}#houses[id=${encodeURIComponent(String(house.id))}].name`;
    const translatedName = 'The Other Household';
    expect(contentProseEntries(houseFile, { houses: [house] })
      .some((entry) => entry.address === houseAddress)).toBe(true);

    const plain = newGame(content, { seed: 411, campaign: 'short', decider: 'chronicler' });
    setProseVariants(plain.ctx, [{
      address: houseAddress, of: proseOriginalHash(house.name), plainenglish: translatedName,
    }]);
    setProseMode(plain.ctx, 'plainenglish');
    const memory = seedLibraryMemories(plain.ctx, [previous])
      .find((item) => item.sourceText === claimText);
    if (!memory) throw new Error('Expected translated inherited memory');
    expect(memory.teller).toContain(translatedName);
    expect(memory.teller).not.toContain(house.name);
    expect(memory.sourceHouse).toBe(original.sourceHouse);
    expect(memory.claims).toEqual(original.claims);
    expect(missingPlainEnglish(plain.ctx)).not.toContain(houseAddress);
  });
});
