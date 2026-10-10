import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { proseOriginalHash } from '@ed/schema';
import {
  applyEffect, beget, bootstrap, dealMatch, filePedigree, hashSeed, makeRng, maternalDepth,
  order, papersDemanded, papersHeld, phase, place, saveGame, loadGame, setProseMode,
  setProseVariants, testRng, testWorld, tickPapers,
  PEDIGREE_PRICE, FULL_PEDIGREE,
} from '@ed/core';
import { coreMessageAddress } from './messages.js';

const bundle = loadContent();

/**
 * THE PAPERS (concept §7, world §13).
 *
 * What is asserted here is the MECHANISM, not a sample: that the record is
 * what a match reads, that a bought grandmother reads as a real one, and that
 * the buying is catchable. The numbers a run produces live in the balance log.
 */
describe('what the record can show', () => {
  it('walks the claimed maternal line, not the blood', () => {
    const ctx = testWorld(bundle);
    const gran = place(ctx, { sex: 'female', age: 70, name: 'Gran' });
    const mother = place(ctx, { sex: 'female', age: 45, name: 'Mother' });
    const girl = place(ctx, { sex: 'female', age: 20, name: 'Girl' });
    beget(ctx, mother, gran);
    beget(ctx, girl, mother);

    expect(maternalDepth(ctx, girl.id)).toBe(2);
    expect(maternalDepth(ctx, mother.id)).toBe(1);
    expect(maternalDepth(ctx, gran.id)).toBe(0);
  });

  it('stops at the first woman whose own mother the record cannot name', () => {
    const ctx = testWorld(bundle);
    // The married-in wife: she exists, her mother never did as far as this
    // house's book is concerned. This is why a house's depth plateaus rather
    // than climbing forever, and why the forgery industry has customers.
    const stranger = place(ctx, { sex: 'female', age: 45, name: 'Stranger' });
    const girl = place(ctx, { sex: 'female', age: 20, name: 'Girl' });
    beget(ctx, girl, stranger);
    expect(maternalDepth(ctx, girl.id)).toBe(1);
  });

  it('never counts past the three generations anybody is asked for', () => {
    const ctx = testWorld(bundle);
    let last = place(ctx, { sex: 'female', age: 90, name: 'Eldest' });
    for (let i = 0; i < 6; i += 1) {
      const next = place(ctx, { sex: 'female', age: 80 - i * 10, name: `Dam${i}` });
      beget(ctx, next, last);
      last = next;
    }
    expect(maternalDepth(ctx, last.id)).toBe(FULL_PEDIGREE);
  });

  it('a cycle in the record terminates — a woman can be written as her own grandmother', () => {
    const ctx = testWorld(bundle);
    const a = place(ctx, { sex: 'female', age: 60, name: 'A' });
    const b = place(ctx, { sex: 'female', age: 40, name: 'B' });
    beget(ctx, b, a);
    // The forgery this world would absolutely produce.
    a.claimedParents = { ...a.claimedParents, mother: b.id };
    expect(() => maternalDepth(ctx, b.id)).not.toThrow();
    expect(maternalDepth(ctx, b.id)).toBeLessThanOrEqual(FULL_PEDIGREE);
  });
});

describe('what a match asks for', () => {
  it('asks a cousin for nothing and a great house for three generations', () => {
    // A cousin, however deep the blood: both sides read the same book.
    expect(papersDemanded(0, 0.0625, 0.05)).toBe(0);
    // The commonest tier — a quarryman at twenty crowns — asks for nothing.
    // World §13 puts the papers on GREAT houses, and a demand at this tier
    // closes the whole outsider market against a house with no dead women yet.
    expect(papersDemanded(20, 0, 0)).toBe(0);
    // A house whose name is worth something asks, at any price.
    expect(papersDemanded(0, 0, 0.01)).toBe(1);
    expect(papersDemanded(0, 0, 0.05)).toBe(FULL_PEDIGREE);
    // And so does a card priced like one.
    expect(papersDemanded(200, 0, 0)).toBe(FULL_PEDIGREE);
  });

  it('blocks a card on the papers, and says so in the papers\' own words', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const w = ctx.world;
    // A founding house is rich enough that the purse is not the question, and
    // young enough that the record is.
    w.treasury = 5000;
    const subjects = [...w.people.blood(w.playerHouse)].filter((p) => p.status === 'alive');
    const subject = subjects.find((p) => maternalDepth(ctx, p.id) === 0);
    expect(subject, 'no undocumented person in the founding cast').toBeTruthy();

    const offer = dealMatch(ctx, subject!, makeRng(hashSeed('papers-test', 1)));
    const blocked = offer.cards.filter((c) => !c.available && (c.blockedBy ?? '').includes('generations'));
    for (const c of blocked) {
      expect(c.papersAsked).toBeGreaterThan(c.papersShown);
      expect(c.blockedBy).toContain('maternal record');
    }
    // Every card that IS open is one the house can actually paper.
    for (const c of offer.cards.filter((x) => x.available)) {
      expect(c.papersShown).toBeGreaterThanOrEqual(c.papersAsked);
    }
  });
});

describe('buying a grandmother', () => {
  it('the order charges world §11\'s published price and files the paper', () => {
    const ctx = testWorld(bundle);
    const girl = place(ctx, { sex: 'female', age: 20, name: 'Girl' });
    ctx.world.treasury = 1000;

    expect(papersHeld(ctx, girl)).toBe(0);
    const res = order(ctx, { kind: 'pedigree', person: girl.id, grade: 'caster' });

    expect(res.ok).toBe(true);
    expect(ctx.world.treasury).toBe(1000 - PEDIGREE_PRICE.caster);
    expect(papersHeld(ctx, girl)).toBe(FULL_PEDIGREE);
    expect(girl.lineageDocuments.some((d) => d.forged)).toBe(true);
  });

  it('refuses when the house cannot raise it, and when the record already shows that much', () => {
    const ctx = testWorld(bundle);
    const girl = place(ctx, { sex: 'female', age: 20, name: 'Girl' });

    // A house may borrow down to `DEBT_FLOOR` for anything else, and does for
    // this too — so the refusal is at the floor, not at zero. At exactly 0 the
    // 120-crown pedigree lands on the floor and is allowed, which is the same
    // bargain the auction and the tutor offer.
    ctx.world.treasury = 0;
    expect(order(ctx, { kind: 'pedigree', person: girl.id, grade: 'caster' }).ok).toBe(true);

    const broke = testWorld(bundle);
    const her = place(broke, { sex: 'female', age: 20, name: 'Her' });
    broke.world.treasury = -50;
    const refused = order(broke, { kind: 'pedigree', person: her.id, grade: 'caster' });
    expect(refused.ok).toBe(false);
    expect(refused.reason).toContain('cannot raise');

    ctx.world.treasury = 1000;
    filePedigree(ctx, girl, 'caster');
    const again = order(ctx, { kind: 'pedigree', person: girl.id, grade: 'bramme' });
    expect(again.ok).toBe(false);
    expect(again.reason).toContain('already shows');
  });

  it('the papers a forgery buys open a card the record could not', () => {
    const ctx = testWorld(bundle);
    const girl = place(ctx, { sex: 'female', age: 20, name: 'Girl' });
    expect(papersHeld(ctx, girl)).toBe(0);
    filePedigree(ctx, girl, 'bramme');
    expect(papersHeld(ctx, girl)).toBe(2);
  });

  /**
   * The authored path, and the reason `forge_lineage` was only half a feature.
   * It pointed `claimedParents` at somebody else's mother — which moved the
   * genetics' idea of the pedigree and nothing else, because nothing read the
   * document it filed. It now moves the papers too, through the same walk.
   */
  it('forge_lineage moves the papers, because a bought grandmother is a grandmother on paper', () => {
    const ctx = testWorld(bundle);
    const gran = place(ctx, { sex: 'female', age: 80, name: 'Gran' });
    const dam = place(ctx, { sex: 'female', age: 55, name: 'Dam' });
    const grand = place(ctx, { sex: 'female', age: 30, name: 'Grand' });
    beget(ctx, dam, gran);
    beget(ctx, grand, dam);

    const orphan = place(ctx, { sex: 'female', age: 20, name: 'Orphan' });
    expect(papersHeld(ctx, orphan)).toBe(0);

    applyEffect(
      {
        kind: 'forge_lineage',
        target: { slot: 'HER' },
        parent: 'mother',
        claimedAs: 'THEIRS',
        notarisedBy: 'a notary at Bramme',
        generations: 3,
      },
      ctx,
      { HER: orphan.id, THEIRS: grand.id },
    );

    expect(papersHeld(ctx, orphan)).toBe(FULL_PEDIGREE);
    expect(orphan.lineageDocuments.some((d) => d.forged)).toBe(true);
  });
});

describe('and getting caught', () => {
  it('an exposed pedigree stops counting, opens a Discrepancy, and is not deleted', () => {
    const ctx = testWorld(bundle);
    const girl = place(ctx, { sex: 'female', age: 20, name: 'Girl' });
    const doc = filePedigree(ctx, girl, 'bramme');
    expect(papersHeld(ctx, girl)).toBe(2);

    doc.exposed = ctx.world.year;

    expect(papersHeld(ctx, girl)).toBe(0);
    // Repudiated, not forgotten: the house's problem afterwards is that
    // everybody has seen the pedigree it used to have.
    expect(girl.lineageDocuments).toHaveLength(1);
  });

  it('the papers phase catches forgeries and names the records that would settle it', () => {
    const ctx = testWorld(bundle);
    const before = ctx.world.discrepancies.size;
    for (let i = 0; i < 40; i += 1) {
      const p = place(ctx, { sex: 'female', age: 20, name: `Bought${i}` });
      filePedigree(ctx, p, 'bramme');
    }

    // A century of a house leaning on forty cheap pedigrees. At world §16's
    // rate this is a near-certainty rather than a coin flip, which is the
    // claim: buying the cheap one is buying time, not safety.
    for (let y = 0; y < 100; y += 1) {
      phase('papers', ctx);
      ctx.world.year += 1;
    }

    expect(ctx.world.discrepancies.size).toBeGreaterThan(before);
    const opened = [...ctx.world.discrepancies.entries()].filter(([id]) => id.startsWith('papers_'));
    expect(opened.length).toBeGreaterThan(0);
    for (const [, d] of opened) {
      expect(d.state).toBe('open');
      expect(d.provableBy).toContain('the parish roll');
    }
  });

  it('opens separate evidence records when two forgeries on one person are caught together', () => {
    const ctx = testWorld(bundle, 964);
    const person = place(ctx, { sex: 'female', age: 24, name: 'Two papers' });
    const cheap = filePedigree(ctx, person, 'bramme');
    const dear = filePedigree(ctx, person, 'caster');
    const previous = new Set(ctx.world.discrepancies.keys());
    const priorPages = ctx.world.chronicle.length;
    const alwaysExpose = { ...testRng('same-year-exposure'), bool: (_chance: number) => true };

    expect(tickPapers(ctx, alwaysExpose)).toBe(2);
    expect(cheap.exposed).toBe(ctx.world.year);
    expect(dear.exposed).toBe(ctx.world.year);
    const ids = [...ctx.world.discrepancies.keys()].filter((id) => !previous.has(id));
    expect(ids).toEqual([
      `papers_${person.id}_${ctx.world.year}`,
      `papers_${person.id}_${ctx.world.year}_2`,
    ]);
    const pages = ctx.world.chronicle.slice(priorPages);
    expect(pages.map((page) => page.discrepancyId)).toEqual(ids);
    expect(ids.every((id) => ctx.world.discrepancies.get(id)?.state === 'open')).toBe(true);
    expect(tickPapers(ctx, alwaysExpose), 'an exposed document must not be found again').toBe(0);

    const reloaded = loadGame(saveGame(ctx), bundle);
    expect(ids.every((id) => reloaded.world.discrepancies.has(id))).toBe(true);
    expect(reloaded.world.chronicle.slice(priorPages).map((page) => page.discrepancyId)).toEqual(ids);
  });

  it('a Caster pedigree outlasts a Bramme one — the price buys years, measured', () => {
    const caught = (grade: 'bramme' | 'caster'): number => {
      const ctx = testWorld(bundle, 77);
      for (let i = 0; i < 200; i += 1) {
        const p = place(ctx, { sex: 'female', age: 20, name: `${grade}${i}` });
        filePedigree(ctx, p, grade);
      }
      for (let y = 0; y < 60; y += 1) {
        phase('papers', ctx);
        ctx.world.year += 1;
      }
      return [...ctx.world.discrepancies.keys()].filter((k) => k.startsWith('papers_')).length;
    };
    expect(caught('bramme')).toBeGreaterThan(caught('caster'));
  });

  it('an exposure survives a save, or the house is forgiven by reloading', () => {
    const ctx = testWorld(bundle);
    const girl = place(ctx, { sex: 'female', age: 20, name: 'Girl' });
    const doc = filePedigree(ctx, girl, 'caster');
    doc.exposed = 1300;

    const back = loadGame(saveGame(ctx), bundle);
    const reloaded = back.world.people.get(girl.id)!;
    expect(reloaded.lineageDocuments[0]?.exposed).toBe(1300);
    expect(papersHeld(back, reloaded)).toBe(0);
  });
});

describe('the exposure page speaks the reader\'s setting (#733)', () => {
  const TITLE = 'The seal';
  const BODY = "Somebody set {PERSON}'s pedigree beside the parish roll and asked whose seal that was, "
    + '{NOTARY} being no longer anywhere anyone could point to. '
    + 'Nothing was proved. It does not need to be proved to be repeated.';

  /** One cheap forgery, ticked on fresh streams until somebody notices it. */
  function expose(mode: 'original' | 'plainenglish') {
    const ctx = testWorld(bundle);
    setProseVariants(ctx, [
      {
        address: coreMessageAddress('papers.exposed_title'),
        of: proseOriginalHash(TITLE),
        plainenglish: 'A forged seal',
      },
      {
        address: coreMessageAddress('papers.exposed'),
        of: proseOriginalHash(BODY),
        plainenglish: "Someone compared {PERSON}'s pedigree with the parish roll and asked about the seal. "
          + '{NOTARY} could no longer be found to vouch for it. Nothing was proved, but people repeated it anyway.',
      },
    ]);
    setProseMode(ctx, mode);
    const girl = place(ctx, { sex: 'female', age: 20, name: 'Girl' });
    const doc = filePedigree(ctx, girl, 'bramme');
    let caught = 0;
    for (let i = 0; i < 2000 && caught === 0; i += 1) caught = tickPapers(ctx, testRng('expose', i));
    expect(caught).toBe(1);
    return { ctx, doc, page: ctx.world.chronicle.at(-1)! };
  }

  it('keeps the Original byte for byte', () => {
    const { page, doc } = expose('original');
    expect(page.title).toBe('The seal');
    expect(page.text).toBe(
      "Somebody set Girl's pedigree beside the parish roll and asked whose seal that was, "
        + `${doc.notarisedBy} being no longer anywhere anyone could point to. `
        + 'Nothing was proved. It does not need to be proved to be repeated.',
    );
  });

  it('renders the reviewed Plain English, linked to the same Discrepancy, and keeps it', () => {
    const { ctx, page, doc } = expose('plainenglish');
    expect(page.title).toBe('A forged seal');
    expect(page.text).toBe(
      "Someone compared Girl's pedigree with the parish roll and asked about the seal. "
        + `${doc.notarisedBy} could no longer be found to vouch for it. Nothing was proved, but people repeated it anyway.`,
    );
    const d = ctx.world.discrepancies.get(page.discrepancyId!);
    expect(d?.state).toBe('open');
    expect(d?.provableBy).toContain('the parish roll');
    expect(doc.exposed).toBe(ctx.world.year);

    setProseMode(ctx, 'original');
    expect(page.title).toBe('A forged seal');
    const back = loadGame(saveGame(ctx), bundle);
    expect(back.world.chronicle.at(-1)!.text).toBe(page.text);
  });
});
