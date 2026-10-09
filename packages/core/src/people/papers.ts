import type { LineageDocument, Person } from '@ed/schema';
import type { SimCtx } from '../world.js';
import type { Rng } from '../rng.js';
import { msg } from '../messages.js';

/**
 * THE PAPERS — what a dowry actually is (concept §7, world §13).
 *
 * §7 states it flatly and the engine did not model it at all: *"A dowry is not
 * money. Great houses negotiate in lineage documentation: three generations of
 * maternal records, notarised. Forging them is an industry."* World §13 says
 * the same from the other side — *"Coin and land come with it, but the papers
 * are the negotiation."*
 *
 * The Match priced the coin beautifully and asked for no papers, so the half
 * of a marriage negotiation that §7 calls the whole of it was missing. The
 * consequence was not a missing feature so much as a missing SQUEEZE: a house
 * in 1042 has no maternal record because it has no dead women yet, and there
 * was nothing anywhere in the game that a young house could not buy its way
 * past with coin it did not have to spend on anything else.
 *
 * Three things live here.
 *
 *   WHAT THE HOUSE CAN SHOW.  `maternalDepth` walks `claimedParents.mother`,
 *                             the RECORD and not the blood, exactly as
 *                             `matchF` and `pedigreeF` do. A house's papers
 *                             are its own written memory of its women.
 *
 *   WHAT A MATCH DEMANDS.     `papersDemanded`. A great house wants the full
 *                             three generations; a farm asks for nothing.
 *
 *   WHAT A FORGERY IS.        `forge_lineage` already points a claimed mother
 *                             at somebody else's grandmother, which raises
 *                             `maternalDepth` on its own — the mechanism was
 *                             always there and nothing read it. What is added
 *                             here is the part that makes it a bet: a filed
 *                             forgery can be CAUGHT, on world §16's own terms.
 *
 * `Person.lineageDocuments` was written by `forge_lineage` and read by nothing
 * (invariant 11). This is its reader.
 */

/**
 * Three generations of maternal record, notarised. The number is world §13's
 * and is not a knob — it is what the phrase in the design says.
 */
export const FULL_PEDIGREE = 3;

/**
 * THE TWO GRADES, at world §11's published prices.
 *
 *   bramme  25 crowns.  Good enough for a provincial fair and a broker who is
 *                       not really looking. Covers two generations.
 *   caster  120 crowns. Good enough for the heralds at Caster, which is the
 *                       only opinion that settles an argument. Covers three.
 *
 * The spread is deliberate and it is the decision: five Bramme pedigrees cost
 * about what one Caster pedigree costs, and the cheap one is caught.
 */
export const PEDIGREE_PRICE: Record<PedigreeGrade, number> = { bramme: 25, caster: 120 };
export const PEDIGREE_COVERS: Record<PedigreeGrade, number> = { bramme: 2, caster: 3 };

export type PedigreeGrade = 'bramme' | 'caster';

/**
 * THE STANDARD TELL (world §16): *"the seal of a house that stopped
 * existing."* A forged pedigree is notarised by somebody, and the cheap ones
 * are notarised by a house or a notary nobody can produce. Per-year odds that
 * somebody with a motive puts two records side by side and notices.
 *
 * A Caster forgery is not safe, it is slow: at these rates a Bramme pedigree
 * is found inside a lifetime about half the time and a Caster one about once
 * in six. Both numbers are meant to be survivable and neither is meant to be
 * forgotten about.
 */
export const EXPOSURE_PER_YEAR: Record<PedigreeGrade, number> = { bramme: 0.012, caster: 0.0028 };

/**
 * How far back the record can name her mothers.
 *
 * Walks the CLAIMED line, which is the whole point: a bought grandmother is a
 * real grandmother as far as any broker in the Settled Lands can tell, and
 * `forge_lineage` moves this number exactly as far as the forgery claims.
 *
 * Capped at `FULL_PEDIGREE` because nobody is asked for a fourth generation —
 * counting further would let a nine-hundred-year-old house bank depth it can
 * never spend, and make the papers free forever after about 1300.
 *
 * The guard against a cycle is not defensive programming. `forge_lineage` can
 * point a woman's claimed mother at somebody who is already downstream of her,
 * and a record that says a woman is her own great-grandmother is a document
 * this world would absolutely produce.
 */
export function maternalDepth(ctx: SimCtx, personId: string | undefined): number {
  const seen = new Set<string>();
  let depth = 0;
  let at = personId;
  while (at && depth < FULL_PEDIGREE) {
    if (seen.has(at)) break;
    seen.add(at);
    const p = ctx.world.people.get(at);
    const mother = p?.claimedParents.mother;
    if (!mother || !ctx.world.people.get(mother)) break;
    depth += 1;
    at = mother;
  }
  return depth;
}

/**
 * What this match asks the house to produce, in generations.
 *
 * A negotiation is between two houses and the papers run both ways, but only
 * one side of it is a decision the player makes — so what is modelled is what
 * the OTHER house asks of this one. It scales with what the card is worth for
 * the same reason the coin does: nobody asks a quarry family for a notarised
 * pedigree, and House Marrow will not open the conversation without one.
 *
 * A cousin asks for nothing. That is not a discount, it is the definition:
 * both sides are reading the same book, and there is nothing to prove to
 * somebody whose grandmother is also yours. It is also the third distinct
 * thing the free card is buying, alongside the coin and the concentrated
 * blood, and the first one that bites in the century when the house is young.
 *
 * THE TIERS FOLLOW THE HOUSE BEFORE THEY FOLLOW THE PRICE, and that is world
 * §13's wording rather than a balance choice: *"GREAT HOUSES negotiate in
 * lineage documentation."* A quarry family at Hesk asking a notarised
 * three-generation pedigree for a twenty-crown groom is not this world. The
 * first draft asked one generation at the commonest tier, which put a paper
 * demand on nearly every card in the game and closed the whole outsider market
 * against the founding cast — who have no recorded mothers, because nobody in
 * 1042 has a dead one yet. `deepBlood` is the axis that means "a house whose
 * name is worth something", and the coin thresholds now sit above the tier
 * every ordinary card is dealt at.
 */
export function papersDemanded(dowry: number, kinship: number, deepBlood: number): number {
  if (kinship > 0) return 0;
  let want = 0;
  if (dowry >= 50 || deepBlood > 0) want = 1;
  if (dowry >= 120 || deepBlood >= 0.02) want = 2;
  if (dowry >= 200 || deepBlood >= 0.04) want = FULL_PEDIGREE;
  return want;
}

/**
 * Everything a person can currently put on the table: what the record shows
 * on its own, plus the best single document filed for them.
 *
 * The documents do not stack. Two forged pedigrees are two lies about the same
 * grandmother, not six generations of anybody — and a house that could stack
 * them would buy five Bramme pedigrees for the price of one Caster and be
 * better off, which is the opposite of the trade the prices are for.
 */
export function papersHeld(ctx: SimCtx, p: Person): number {
  const shown = maternalDepth(ctx, p.id);
  const filed = p.lineageDocuments
    .filter((d) => d.exposed === undefined)
    .reduce((best, d) => Math.max(best, d.generations), 0);
  return Math.max(shown, Math.min(FULL_PEDIGREE, filed));
}

/** The forged documents this person is leaning on, if any. */
export function forgedPapers(p: Person): LineageDocument[] {
  return p.lineageDocuments.filter((d) => d.forged);
}

/**
 * File a commissioned pedigree. The house buys a grandmother.
 *
 * It does NOT touch `claimedParents`, and that separation is the design:
 * `forge_lineage` is an AUTHORED effect that names a specific false parent out
 * of a scene's cast, and it moves the pedigree because the scene said whose
 * daughter she is now. This is the industry version — bought off a table at
 * Bramme, naming nobody in particular — and all it buys is a paper that says
 * three generations. Both are forgeries and both are catchable; only one of
 * them changes what the genetics thinks it is looking at.
 */
export function filePedigree(ctx: SimCtx, p: Person, grade: PedigreeGrade): LineageDocument {
  const doc: LineageDocument = {
    generations: PEDIGREE_COVERS[grade],
    notarisedBy: grade === 'caster' ? 'a herald at Caster' : 'a notary at Bramme',
    forged: true,
    claims: `${PEDIGREE_COVERS[grade]} generations of maternal record, notarised and sealed`,
  };
  p.lineageDocuments.push(doc);
  return doc;
}

/** Which grade a filed document was bought at, read back off what it covers. */
export function gradeOf(doc: LineageDocument): PedigreeGrade {
  return doc.generations >= PEDIGREE_COVERS.caster ? 'caster' : 'bramme';
}

/**
 * WHO GETS CAUGHT, and by what.
 *
 * World §16 is prescriptive about this and the rule is worth obeying exactly:
 * *"A Discrepancy is proven when two of these disagree in front of somebody
 * with a motive. That is the only way it happens, and an event that proves one
 * should name the documents."*
 *
 * So an exposure here does not prove itself. It opens a Discrepancy and names
 * the records that would settle it — the parish roll the marriage was entered
 * in, and the Roll of Houses that has the seal on the forgery. Proving it is
 * something a scene, an assessor or the last night in 1542 does, through the
 * one `discrepancy` effect every other part of the game already uses.
 *
 * An exposed document is repudiated rather than deleted. It stops counting as
 * papers from that year, and it stays on the person, because the house's
 * problem after 1408 is not that it has no pedigree — it is that everybody has
 * seen the one it used to have.
 */
export function tickPapers(ctx: SimCtx, rng: Rng): number {
  const w = ctx.world;
  let caught = 0;

  for (const p of w.people.household(w.playerHouse, w.year)) {
    for (const doc of p.lineageDocuments) {
      if (!doc.forged || doc.exposed !== undefined) continue;
      const grade = gradeOf(doc);
      if (!rng.bool(EXPOSURE_PER_YEAR[grade])) continue;

      doc.exposed = w.year;
      caught += 1;

      const id = `papers_${p.id}_${w.year}`;
      w.discrepancies.set(id, {
        severity: grade === 'caster' ? 'major' : 'minor',
        provableBy: ['the parish roll', 'the Roll of Houses at Caster'],
        state: 'open',
      });
      w.chronicle.push({
        year: w.year,
        weight: 'paragraph',
        title: msg(ctx, 'papers.exposed_title', 'The seal'),
        text: msg(ctx, 'papers.exposed',
          "Somebody set {PERSON}'s pedigree beside the parish roll and asked whose seal that was, {NOTARY} being no longer anywhere anyone could point to. Nothing was proved. It does not need to be proved to be repeated.",
          { PERSON: p.name, NOTARY: doc.notarisedBy }),
        named: false,
        discrepancyId: id,
      });
    }
  }

  return caught;
}
