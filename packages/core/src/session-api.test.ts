import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import {
  beget, branchReport, consumeVessel, describeDecision, frequencyReport, hallOf, heldBooks, hashSeed,
  loseLibraryCopy, marry, newGame, place, resumeGame, spellbookDef, gainSpellbook, standingMoved,
  tableView, viewOf,
  type ChronicleEntry, type GameSession,
} from '@ed/core';
import {
  buildPair, earlyComesFirst, parseArgs, renderAnswerKey, renderReaderSheet, stripClockTells,
} from '../../../tools/blind-reader-material.js';

const content = loadContent();

/**
 * THE FAÇADE, DRIVEN THE WAY A CLIENT DRIVES IT.
 *
 * The simulation underneath is well covered. The API over it was not: one
 * function in five on `GameSession` had never been called by anything, and the
 * gaps were not scattered — they were the verbs a UI needs and the harness's
 * own diagnostics. `declineHand` is a real move a player can make. `hallOf`,
 * `branchReport` and `frequencyReport` are what the editor's Instruments tab
 * reads. `describeDecision` is what the harness prints when it is bisecting a
 * run, which is to say the thing you reach for when something is already
 * wrong — the worst possible moment to find out it throws.
 *
 * This drives a short game through the public surface and asserts each verb
 * returns something coherent. It is deliberately not a balance test: it does
 * not care what happens, only that asking produces an answer.
 */

/** Turn years until the docket has something of `kind` on it, or give up. */
function advanceUntil(g: GameSession, kind: 'choice' | 'record' | 'match', limit = 400) {
  for (let i = 0; i < limit; i++) {
    const found = g.pending.find((p) => p.kind === kind);
    if (found) return found;
    const before = g.year;
    g.advance(1);
    // A docket that stops the clock means `advance` returned without turning
    // the year. Answer nothing here — the caller decides what to do with it.
    if (g.year === before && !g.pending.length) return undefined;
  }
  return undefined;
}

/**
 * WHAT THE JUMP DID, AND WHO IS ALLOWED TO WORK IT OUT (issue #54).
 *
 * Every number in the header is a level, so after turning a clock the player's
 * only real question — did that go well? — had no answer on screen: 252 crowns
 * reads the same whether it was 190 and climbing or 610 and collapsing.
 *
 * `AdvanceResult.changed` is the engine's own account of it, and it is the
 * engine's on purpose. A client diffing snapshots it took for itself would be
 * keeping private simulation bookkeeping in Vue — a second idea of when a year
 * happened, which is how these things start.
 */
/**
 * THE WHOLE BOOK (issue #48).
 *
 * `view()` carries the last `VIEW_CHRONICLE_LINES` entries, and the comment on
 * that constant has always said what it leaves out — *"the whole book is a
 * separate read"* — while the separate read was never written. So the player
 * wrote a book for a thousand years and could see the last sixty lines of it,
 * in a game that is about what gets written down.
 */
describe('reading the book, not the window', () => {
  it('still has the first entry long after the window has rolled past it', () => {
    const g = newGame(content, { seed: 1042, decider: 'chronicler' });
    const first = g.book()[0];
    expect(first, 'the book is empty before a year has turned').toBeTruthy();

    for (let i = 0; i < 300; i++) g.advance(1);

    const whole = g.book();
    const window = g.view().chronicle;
    expect(whole.length, 'three hundred years wrote fewer entries than the window holds')
      .toBeGreaterThan(window.length);
    // The claim: the window has moved off the beginning, and the book has not.
    expect(window.some((e) => e.year === first!.year && e.text === first!.text)).toBe(false);
    expect(whole[0]).toEqual(first);
  });

  it('reads a span of years when asked for one', () => {
    // 909 no longer reliably reaches 1150: its own line breaks in 1074 under
    // the founding-century mortality issue #42 makes visible. 910 survives
    // the 200 years this test needs.
    const g = newGame(content, { seed: 910, decider: 'chronicler' });
    for (let i = 0; i < 200; i++) g.advance(1);

    const span = g.book({ from: 1100, to: 1150 });
    expect(span.length).toBeGreaterThan(0);
    for (const e of span) {
      expect(e.year).toBeGreaterThanOrEqual(1100);
      expect(e.year).toBeLessThanOrEqual(1150);
    }
    // Inclusive at both ends, and a subset of the whole.
    expect(span.length).toBeLessThan(g.book().length);
  });

  /**
   * Oldest first, which is the order a book is read in — and the reverse of the
   * panel, which answers "what just happened". A reader handed the panel's
   * order would run the thousand years backwards.
   */
  it('comes back in the order it was written', () => {
    const g = newGame(content, { seed: 8080, decider: 'chronicler' });
    for (let i = 0; i < 120; i++) g.advance(1);

    const years = g.book().map((e) => e.year);
    expect(years.length).toBeGreaterThan(1);
    for (let i = 1; i < years.length; i++) expect(years[i]!).toBeGreaterThanOrEqual(years[i - 1]!);
  });

  /** The blank is the artefact, and it survives the read that goes looking for it. */
  it('keeps the omissions, which are the point of reading it', () => {
    const g = newGame(content, { seed: 1042, decider: 'chronicler' });
    for (let i = 0; i < 400; i++) g.advance(1);
    // Not asserting there ARE blanks in a chronicler-run — it never omits.
    // Asserting the read does not quietly drop a null-texted entry if there is
    // one, which is the shape a "tidy the empties" refactor would take.
    expect(g.book().every((e) => e.text === null || typeof e.text === 'string')).toBe(true);
  });
});

describe('the account a jump comes back with', () => {
  it('adds up to the change it claims to describe', () => {
    const g = newGame(content, { seed: 1042, decider: 'chronicler' });
    const before = g.view().treasury;
    // Founding recovers one, before a year has turned. The claim is about the
    // DISTANCE the jump covers, so the starting point has to be the start.
    const clausesBefore = g.view().clausesRecovered;

    let treasury = 0;
    let clauses = 0;
    for (let i = 0; i < 40; i++) {
      const turned = g.advance(1);
      treasury += turned.changed.treasury;
      clauses += turned.changed.clauses;
    }

    // The sum of the years is the distance travelled. A missed year or a
    // flipped sign is invisible in any single reading and obvious here.
    expect(treasury).toBe(g.view().treasury - before);
    expect(clauses).toBe(g.view().clausesRecovered - clausesBefore);
    // Forty years of a house cost or earn SOMETHING; a delta that was always
    // zero would satisfy the equality above perfectly.
    expect(treasury).not.toBe(0);
  });

  it('says nothing at all about a call that turned no years', () => {
    const g = newGame(content, { seed: 1042 });
    // Up to a docket, which is where `advance` returns without turning one.
    for (let i = 0; i < 400 && !g.pending.length; i++) g.advance(1);
    expect(g.pending.length, 'never reached a decision to be stopped by').toBeGreaterThan(0);

    const blocked = g.advance(25);
    expect(blocked.stoppedBy).toBe('decision');
    expect(blocked.years).toEqual([]);
    // Not zeroes with tiers on them — nothing. A header decorated with "(0)"
    // is the noise the change exists to remove.
    expect(standingMoved(blocked.changed)).toBe(false);
    expect(blocked.changed.respect).toBeUndefined();
    expect(blocked.changed.arm).toBeUndefined();
  });

  /** A tier is reported only by the jump that moved it. */
  it('marks a respect tier on the year it moves and no other', () => {
    const g = newGame(content, { seed: 909, decider: 'chronicler' });
    let moves = 0;
    let quiet = 0;
    for (let i = 0; i < 300; i++) {
      const { changed } = g.advance(1);
      if (changed.respect) {
        moves += 1;
        expect(changed.respect.from).not.toBe(changed.respect.to);
      } else quiet += 1;
    }
    expect(moves, 'respect never moved in three hundred years').toBeGreaterThan(0);
    expect(quiet, 'respect moved every single year, which is not a tier').toBeGreaterThan(moves);
  });
});

describe('a game runs through the public API', () => {
  it('newGame lands on the founding cast, at the year it was asked for', () => {
    const g = newGame(content, { seed: 1042, startYear: 1042 });

    expect(g.year).toBe(1042);
    const view = g.view();
    expect(view.year).toBe(1042);
    expect(view.house.length).toBeGreaterThan(0);
    expect(view.generation).toBeGreaterThanOrEqual(0);
  });

  it('advance turns years, and stops the clock when the docket fills', () => {
    const g = newGame(content, { seed: 1042 });
    const result = g.advance(60);

    if (result.stoppedBy === 'decision') {
      expect(result.pending.length).toBeGreaterThan(0);
      expect(g.year).toBeLessThan(1042 + 60);
    } else {
      expect(result.years).toHaveLength(60);
      expect(g.year).toBe(1042 + 60);
    }
  });

  it('the chronicler decider never stops, because nothing is ever asked', () => {
    const g = newGame(content, { seed: 1042, decider: 'chronicler' });
    const result = g.advance(120);

    expect(result.stoppedBy).toBeUndefined();
    expect(result.years).toHaveLength(120);
    expect(g.pending).toHaveLength(0);
  });

  it('choose answers a choice standing on the docket', () => {
    const g = newGame(content, { seed: 1042 });
    const decision = advanceUntil(g, 'choice');
    if (!decision || decision.kind !== 'choice') return; // seed did not reach one; not this test's business

    const open = decision.choices.find((c) => c.available);
    expect(open, 'a decision on the docket has at least one answerable branch').toBeDefined();

    const before = g.pending.length;
    const res = g.choose(decision.id, open!.id);

    expect(res.ok).toBe(true);
    expect(g.pending.length).toBeLessThan(before);
  });

  it('record answers a Record block, and the chronicle grows by it', () => {
    const g = newGame(content, { seed: 1042 });
    const decision = advanceUntil(g, 'record');
    if (!decision || decision.kind !== 'record') return;

    expect(decision.options.length).toBeGreaterThan(0);
    expect(g.record(decision.id, 'record')).toBe(true);
    expect(g.view().chronicle.length).toBeGreaterThan(0);
  });

  /**
   * `declineHand` had never been called by any test. It is a real answer — the
   * house waits for a better year — and the only one that resolves a match
   * without a marriage.
   */
  it('declineHand takes none of the cards, and clears the decision', () => {
    const g = newGame(content, { seed: 1042 });
    const decision = advanceUntil(g, 'match');
    if (!decision || decision.kind !== 'match') return;

    const before = g.pending.length;
    expect(g.declineHand(decision.id)).toBe(true);
    expect(g.pending.length).toBeLessThan(before);

    const declined = g.ctx.world.decisionLog.filter((d) => d.kind === 'match' && !d.card);
    expect(declined.length).toBeGreaterThan(0);
  });

  it('match takes one of the cards it was dealt', () => {
    const g = newGame(content, { seed: 7007 });
    const decision = advanceUntil(g, 'match');
    if (!decision || decision.kind !== 'match') return;

    expect(decision.cards.length).toBeGreaterThan(0);
    const res = g.match(decision.id, decision.cards[0]!.id);
    expect(res.ok).toBe(true);
  });

  it('refuses a decision id it has never heard of, rather than throwing', () => {
    const g = newGame(content, { seed: 1042 });

    expect(g.record('dec_nonesuch', 'record').ok).toBe(false);
    expect(g.declineHand('dec_nonesuch')).toBe(false);
    expect(g.choose('dec_nonesuch', 'whatever').ok).toBe(false);
    expect(g.send('dec_nonesuch').ok).toBe(false);
  });

  it('letHimDecide clears the whole docket through the same commit path', () => {
    const g = newGame(content, { seed: 1042 });
    g.advance(200);

    g.letHimDecide();

    expect(g.pending).toHaveLength(0);
  });

  /**
   * Naming is an OFFER, not a power: `renameChild` answers a name standing in
   * `pendingNames` and refuses anyone else. That is the whole reason it is a
   * replay hook — it moves `takenNames`, which every later name roll reads.
   */
  it('name answers a newborn the game offered, and refuses anyone it did not', () => {
    const g = newGame(content, { seed: 1042, decider: 'chronicler' });
    for (let i = 0; i < 200 && !g.ctx.world.pendingNames.length; i++) g.advance(1);

    const offer = g.ctx.world.pendingNames[0];
    expect(offer, 'a run of two centuries offers at least one name').toBeDefined();
    const child = g.ctx.world.people.get(offer!.person)!;

    expect(g.name(child.id, 'Alira')).toBe(true);
    expect(child.name).toBe('Alira');
    expect(g.ctx.takenNames.has('Alira')).toBe(true);

    // Somebody nobody offered, an empty name, and the same child twice.
    expect(g.name('per_nonesuch', 'Nobody')).toBe(false);
    expect(g.name(child.id, '   ')).toBe(false);
    expect(g.name(child.id, 'Alira Again')).toBe(false);

    const named = g.ctx.world.decisionLog.filter((d) => d.kind === 'name');
    expect(named).toHaveLength(1);
  });

  it('keepSuggestedNames empties the naming queue without renaming anybody', () => {
    const g = newGame(content, { seed: 1042, decider: 'chronicler' });
    g.advance(120);

    expect(() => g.keepSuggestedNames()).not.toThrow();
  });

  it('save round-trips through resumeGame onto the same world', () => {
    const g = newGame(content, { seed: 1042, decider: 'chronicler' });
    g.advance(150);

    const resumed = resumeGame(g.save(), content);

    expect(resumed.year).toBe(g.year);
    expect(resumed.view().treasury).toBe(g.view().treasury);
    expect(resumed.view().generation).toBe(g.view().generation);
    expect(resumed.view().chronicle.length).toBe(g.view().chronicle.length);
  });
});
describe('the library read model', () => {
  it('heldBooks lists the shelf, and loseLibraryCopy takes one off it', () => {
    const g = newGame(content, { seed: 1042 });
    // The house opens with the books `houses.yaml` says it has been keeping
    // (issue #41), so this counts the change rather than the total.
    const founding = heldBooks(g.ctx).length;
    expect(founding).toBeGreaterThan(0);

    const book = content.spellbooks.find((b) => !heldBooks(g.ctx).some((h) => h.id === String(b.id)))!;
    const reader = place(g.ctx, { sex: 'male', age: 30, name: 'A Reader', awakened: true });
    gainSpellbook(g.ctx, reader, spellbookDef(g.ctx, String(book.id))!);

    expect(heldBooks(g.ctx).length).toBe(founding + 1);
    expect(loseLibraryCopy(g.ctx, String(book.id))).toBe(true);
    expect(heldBooks(g.ctx)).toHaveLength(founding);

    // Losing what the house never had is a no-op, not an error.
    expect(loseLibraryCopy(g.ctx, String(book.id))).toBe(false);
  });
});

/**
 * WHAT A CLIENT NEEDS THAT IS NOT A NUMBER ON THE WORLD.
 *
 * Every field here was added because the slice could not draw something
 * without it, and each has the same failure mode if it goes: the client keeps
 * working and shows the player something slightly false. The house prints as
 * `house_gearithy`; the tree flattens into a roster because nothing joins a
 * parent to a child; a card announces a woman's Fecundity, which nobody in
 * this world has a number for.
 */
describe('the two ends of the run, through the façade', () => {
  it('offers the prologue, takes an answer, and never offers it twice', () => {
    const g = newGame(content, { seed: 1042 });

    const prologue = g.prologue()!;
    expect(prologue.triad).toHaveLength(3);
    expect(prologue.founded).toBeUndefined();

    const choice = {
      houseName: 'The House of Salt',
      heirloom: String(prologue.heirlooms[0]!.heirloom),
      grudge: String(prologue.grudges[0]!.house),
    };
    expect(g.found(choice).ok).toBe(true);
    expect(g.prologue()!.founded?.houseName).toBe('The House of Salt');
    expect(g.found(choice).ok).toBe(false);
    expect(g.view().houseName).toBe('The House of Salt');
  });

  it('has no epilogue until there has been a last night', () => {
    const g = newGame(content, { seed: 1042 });
    expect(g.epilogue()).toBeUndefined();
    expect(g.view().ending).toBeUndefined();
  });
});

describe('family planning fields do not read hidden blood', () => {
  it('keeps succession and relevance identical when only an unwoken genome changes', () => {
    const a = newGame(content, { seed: 268 });
    const b = newGame(content, { seed: 268 });
    const pa = place(a.ctx, { sex: 'male', age: 23, name: 'Unwoken Test Son' });
    const pb = place(b.ctx, { sex: 'male', age: 23, name: 'Unwoken Test Son' });

    pb.genome = { kind: 'lazy', pool: 'commons', seed: hashSeed('hidden-mundane', pb.name) };
    pb.phenotype = undefined;

    const ma = a.view().halls.flatMap((h) => h.members).find((m) => m.id === pa.id)!;
    const mb = b.view().halls.flatMap((h) => h.members).find((m) => m.id === pb.id)!;

    expect(pa.awakening.awakened).toBe(false);
    expect(pb.awakening.awakened).toBe(false);
    expect(ma.succession).toBe(mb.succession);
    expect(ma.relevance).toEqual(mb.relevance);
  });

  it('finds authored Chronicle pages that explicitly cast a person', () => {
    const g = newGame(content, { seed: 269 });
    const person = g.ctx.world.people.household(g.ctx.world.playerHouse, g.year)[0]!;
    g.ctx.world.chronicle.push({
      id: 'chr_test_mention',
      year: g.year,
      weight: 'paragraph',
      text: person.name + ' stood in the written scene.',
      named: false,
      people: [person.id],
    });

    expect(g.mentions(person.id)).toContain('chr_test_mention');
  });
});

describe('the read model a client draws', () => {
  it('names the house rather than handing over its id', () => {
    const view = newGame(content, { seed: 1042 }).view();

    expect(view.houseName).not.toBe(view.house);
    expect(view.houseName.length).toBeGreaterThan(0);
  });

  it('names every attribute and trait the content has, and keeps the list open', () => {
    const view = newGame(content, { seed: 1042 }).view();

    expect(view.attributes.map((a) => a.attr).sort())
      .toEqual(content.attributes.map((a) => String(a.id)).sort());
    expect(view.traits.map((t) => t.trait).sort())
      .toEqual(content.traits.map((t) => String(t.id)).sort());
    expect(view.attributes.every((a) => a.name.length > 0)).toBe(true);
  });

  it('joins the family up: parents, the line the book gives them, and a living spouse', () => {
    const g = newGame(content, { seed: 1042 });
    const father = place(g.ctx, { sex: 'male', age: 40, name: 'A Father' });
    const mother = place(g.ctx, { sex: 'female', age: 38, name: 'A Mother' });
    const child = place(g.ctx, { sex: 'female', age: 10, name: 'A Daughter' });
    marry(g.ctx, father, mother);
    beget(g.ctx, child, mother, father);

    const members = g.view().halls.flatMap((h) => h.members);
    const drawn = members.find((m) => m.id === child.id)!;
    const drawnFather = members.find((m) => m.id === father.id)!;

    expect(drawn.parents).toEqual({ mother: mother.id, father: father.id });
    // The tree hangs off the CLAIMED line, which a forgery moves and the truth
    // does not. Here they agree, because nobody has written anything yet.
    expect(drawn.record.parents).toEqual(drawn.parents);
    expect(drawnFather.spouse?.id).toBe(mother.id);
    expect(drawnFather.spouse?.name).toBe(mother.name);
    expect(drawn.spouse).toBeUndefined();
  });

  /**
   * §22 asks for a mark on the tree that is not the mark for death, and the
   * tree draws the LIVING household — so a person the rite consumed had to
   * either stay in the hall or vanish exactly like a corpse. The read model is
   * the only place that difference can be made, and it is made here rather
   * than in `halls`, which the simulation reads and where a consumed woman
   * would still be marriageable.
   */
  it('keeps a consumed Vessel on the tree, greyed, and out of the living house', () => {
    const g = newGame(content, { seed: 1042 });
    const him = g.ctx.world.people.living().find((p) => p.castSlots.includes('head'))!;
    const her = place(g.ctx, { sex: 'female', age: 20, name: 'The Given' });
    beget(g.ctx, her, undefined, him);

    expect(consumeVessel(g.ctx, him, her).ok).toBe(true);

    const drawn = g.view().halls.flatMap((h) => h.members).find((m) => m.id === her.id);
    expect(drawn, 'the rite took her off the tree entirely').toBeTruthy();
    expect(drawn!.status).toBe('vessel_consumed');
    expect(drawn!.parents.father).toBe(him.id);
    // And she is gone from everything the simulation reads.
    expect(g.ctx.world.people.household(g.ctx.world.playerHouse, g.year).map((p) => p.id))
      .not.toContain(her.id);
    expect(g.view().halls.flatMap((h) => h.members).every((m) => m.status === 'alive'
      || m.status === 'vessel_consumed')).toBe(true);
  });

  it('withholds the name of an Age until the chronicle has named it', () => {
    const g = newGame(content, { seed: 1042 });
    const def = content.ages[0]!;
    g.ctx.world.age.active.push({ age: String(def.id), began: g.year, named: false, paid: { standing: false } });

    const running = g.view().ages.find((a) => a.age === String(def.id))!;
    expect(running.register).toBe(def.register);
    expect(running.name).toBeUndefined();

    // Named years later — §20's rule one, and the only thing that opens it.
    g.ctx.world.age.active[g.ctx.world.age.active.length - 1]!.named = true;
    expect(g.view().ages.find((a) => a.age === String(def.id))!.name).toBe(def.name);
  });

  it('says which attributes the record has actually spoken about', () => {
    const g = newGame(content, { seed: 1042 });
    const member = g.view().halls.flatMap((h) => h.members)[0]!;

    // Nothing has been written down in the founding year, so the record claims
    // nothing — while `record.attrs` is still fully populated, because a UI
    // that wants the fallback should have it. The two are not the same
    // statement, and drawing the second as if it were the first is the bug
    // this field exists to prevent.
    expect(member.record.claimed).toEqual([]);
    expect(Object.keys(member.record.attrs).length).toBeGreaterThan(0);
    for (const attr of member.record.claimed) {
      expect(member.record.attrs).toHaveProperty(attr);
    }
  });
});

/**
 * §29's FIRST RULE, at the boundary where it actually matters.
 *
 * The Assize is on the read model on purpose — invariant 13, the world reacts
 * and says so. Bearing is its opposite and must never appear: *no stat, no
 * meter, no bar*. The moment a client can draw this number it stops being a
 * thing the house did and becomes a thing the house has, and a thing the house
 * has gets optimised — which is exactly what §29 says must not happen to it.
 *
 * `prose/bearing` holds the content side of the same rule. This holds the
 * client side, which is the half a validation rule can never see.
 */
describe('bearing is never on the read model', () => {
  it('gives a client no way to read what the world remembers', () => {
    const s = newGame(content, { seed: 4242, decider: 'chronicler' });
    for (let i = 0; i < 60; i++) s.advance();
    const v = s.view();

    // THE MODEL, NOT THE PROSE. `chronicle`, `frame` and `docket` carry
    // authored sentences, and an author is allowed to write the word proud in
    // a body about a wall the village is proud of — which is exactly what
    // seed 4242 does. This scan used to pass over the whole serialised view
    // and got away with it only because 78% of the chronicle window was one
    // sentence about putting a book back on the shelf (issue #82). It was a
    // rule holding for a reason that had nothing to do with the rule.
    //
    // The claim is about FIELDS: nothing on the read model reports what the
    // world has come to think of the house's carriage (§29). The house's own
    // record is not a field, and the player is meant to read it.
    const view = JSON.stringify({ ...v, chronicle: [], frame: [], docket: [] });

    // Not a vacuous pass: the view has to be a real read model with the
    // Assize's own number on it, which is the thing bearing is NOT.
    expect(view.length).toBeGreaterThan(500);
    expect(view).toContain('pressure');
    for (const word of ['bearing', 'carriage', 'pride', 'proud', 'arrogance', 'hubris', 'vanity']) {
      expect(view.toLowerCase(), `the read model exposes '${word}'`).not.toContain(word);
    }
  });
});

describe('the table read model', () => {
  it('lists the posts, what one costs, who holds it and who could', () => {
    const g = newGame(content, { seed: 1042 });
    const holder = place(g.ctx, { sex: 'male', age: 30, name: 'A Captain', career: { career: 'military' } });

    const posts = tableView(g.ctx).posts;
    const military = posts.find((p) => p.career === 'military')!;

    expect(posts.map((p) => p.career).sort()).toEqual(content.careers.map((c) => String(c.id)).sort());
    expect(military.fee).toBeGreaterThan(0);
    expect(military.holders.map((h) => h.person)).toContain(holder.id);
    // He holds it already, so he is not among the people who could be put in it.
    expect(military.eligible.map((e) => e.person)).not.toContain(holder.id);
    // A child is nobody's officer.
    const child = place(g.ctx, { sex: 'male', age: 6, name: 'A Boy' });
    expect(tableView(g.ctx).posts.find((p) => p.career === 'military')!.eligible.map((e) => e.person))
      .not.toContain(child.id);
  });

  it('lists who the market may be shown, and flags the ones kept back', () => {
    const g = newGame(content, { seed: 1042 });
    const daughter = place(g.ctx, { sex: 'female', age: 20, name: 'A Marriageable Daughter' });
    const child = place(g.ctx, { sex: 'female', age: 4, name: 'A Small Girl' });

    const before = tableView(g.ctx).market;
    expect(before.map((m) => m.person)).toContain(daughter.id);
    // The client does not get to pick an age for this. `eligibleToMarry` does.
    expect(before.map((m) => m.person)).not.toContain(child.id);
    expect(before.find((m) => m.person === daughter.id)!.held).toBe(false);

    expect(g.order({ kind: 'withhold', person: daughter.id, hold: true }).ok).toBe(true);
    const after = tableView(g.ctx).market.find((m) => m.person === daughter.id)!;
    expect(after.held).toBe(true);
    expect(after.since).toBe(g.year);
  });

  it('lists who is still young enough to be taught, and stops offering them once paid for', () => {
    const g = newGame(content, { seed: 1042 });
    const pupil = place(g.ctx, { sex: 'female', age: 9, name: 'A Pupil' });
    const grown = place(g.ctx, { sex: 'male', age: 44, name: 'A Grown Man' });

    expect(tableView(g.ctx).pupils.map((p) => p.person)).toContain(pupil.id);
    expect(tableView(g.ctx).pupils.map((p) => p.person)).not.toContain(grown.id);

    expect(g.order({ kind: 'tutor', person: pupil.id, attr: 'strength' }).ok).toBe(true);
    expect(tableView(g.ctx).pupils.map((p) => p.person)).not.toContain(pupil.id);
  });
});


function blindEntry(year: number, text: string | null, title?: string): ChronicleEntry {
  return {
    year,
    weight: 'line',
    ...(title ? { title } : {}),
    text,
    named: false,
  };
}

function blindFixture(): ChronicleEntry[] {
  const out: ChronicleEntry[] = [];
  for (let year = 1043; year < 1208; year += 2) {
    out.push(blindEntry(year, `The house bought land while Alice held office in ${year}.`, 'A Long Line'));
  }
  for (let year = 1377; year < 1541; year += 2) {
    out.push(blindEntry(year, `Alice's old bargain still cost the house in ${year}.`, year === 1539 ? 'the Term' : undefined));
  }
  return out;
}

describe('blind-reader material (#85)', () => {
  it('removes direct clock tells without deleting the historical evidence', () => {
    const cleaned = stripClockTells('In A Long Line, Alice bought Blackacre in 1451.');
    expect(cleaned).toBe('In the line, Alice bought Blackacre in [year].');
    expect(cleaned).toContain('Alice');
    expect(cleaned).toContain('Blackacre');
  });

  it('takes equal pages from inside the early and late thirds and excludes the Term', () => {
    const pair = buildPair(blindFixture(), 8500, 'A', 12);
    expect(pair.first.entries).toHaveLength(12);
    expect(pair.second.entries).toHaveLength(12);

    const all = [...pair.first.entries, ...pair.second.entries]
      .flatMap((e) => [e.title ?? '', e.text ?? ''])
      .join('\n');
    expect(all).not.toMatch(/\b(?:10|11|12|13|14|15)\d{2}\b/);
    expect(all).not.toMatch(/\b(?:Long|Short) Line\b/i);
    expect(all).not.toMatch(/\bTerm\b/i);
    expect(all).toMatch(/Alice/);
  });

  it('randomises order reproducibly and keeps the answer out of the reader sheet', () => {
    const first = buildPair(blindFixture(), 8500, 'A', 10);
    const repeat = buildPair(blindFixture(), 8500, 'A', 10);
    const neighbour = buildPair(blindFixture(), 8501, 'A', 10);

    expect(first.first.period).toBe(repeat.first.period);
    expect(earlyComesFirst(8500)).not.toBe(earlyComesFirst(8501));
    expect(first.first.period).not.toBe(neighbour.first.period);

    const material = { pairs: [neighbour], skipped: [] };
    const reader = renderReaderSheet(material);
    const key = renderAnswerKey(material);

    expect(reader).not.toContain('seed 8501');
    expect(reader).not.toMatch(/= early|= late|later = A[12]/i);
    expect(key).toContain('seed 8501');
    expect(key).toMatch(/later = A[12]/);
  });

  it('parses an explicit output directory and bounded positive counts', () => {
    const opts = parseArgs(['--out', 'tmp/x', '--pairs', '5', '--lines', '14', '--seed-start', '9000']);
    expect(opts.pairs).toBe(5);
    expect(opts.lines).toBe(14);
    expect(opts.seedStart).toBe(9000);
    expect(opts.outDir).toMatch(/tmp[/\\]x$/);
    expect(() => parseArgs(['--pairs', '0'])).toThrow(/positive integer/);
  });
});
