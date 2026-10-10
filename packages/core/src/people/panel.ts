import type { Person, Sex, Year } from '@ed/schema';
import { ageAt } from '@ed/schema';
import type { ChronicleEntry, SimCtx } from '../world.js';
import type { LineCensus, MatchCard } from './match.js';
import { bloodWomenOf, lineWomen } from './match.js';
import { proseForTale } from '../prose.js';

/**
 * THE MATCHMAKER'S PANEL (issue #68) — WHAT IS OBSERVED, NEVER WHAT IS TRUE.
 *
 * The genetics is the best thing in this project and the player could not see
 * a single part of it working. The Match fires about once a generation, it is
 * the decision the game is named for, and it was made on three cards and a
 * hunch: a house, an age, a word about the line, a price.
 *
 * The fix is NOT to print the genome. `record.claimed` hides attributes the
 * chronicle has not spoken about for a good reason — a card that announces a
 * woman's Fecundity ends §7's marriage market in one line — and a world where
 * a bride's blood can be read is not this world. But the state this replaces
 * was the other failure: with nothing to reason FROM, the central decision was
 * made blind rather than made under uncertainty. Those two feel identical in
 * the moment and completely different over forty generations, which is the
 * whole argument for this file.
 *
 * So every row here is either a public fact or somebody's claim:
 *
 *   `issue`    Her mother and her sisters, named, with the children the RECORD
 *              credits to them and how many of those grew up. The marriage
 *              market already reads a LINE off exactly this rather than off a
 *              genome (`LineRead`), so the data is what the simulation itself
 *              uses; the panel simply stops summarising it into one word.
 *   `woken`    Her near kin the world has watched wake (§11). This is the one
 *              honest signal in a market otherwise built on forged documents,
 *              and it is honest because it is a life event a hall full of
 *              people saw, not a number off a locus table.
 *   `said`     What is said of her house, by a named teller with a named
 *              motive. Some of it is wrong. The panel never says which.
 *   `ourBook`  What THIS family's own chronicle has previously written about
 *              her house — including the pages it embellished. A house that
 *              lied about the Marrows two centuries ago has to act on its own
 *              lie, which is the record layer finally charging somebody.
 *
 * WHY IT IS ON THE CARD AND NOT COMPUTED AT VIEW TIME. A card is a promise
 * already made — the file comment on the saved hand says so, and it is why a
 * recipe is stored whole rather than re-rolled on load. The panel is what the
 * market could see ON THE DAY THE HAND WAS DEALT. Recomputing it when the
 * client happens to look would quietly answer a different question, and the
 * clock is parked while the docket is open anyway, so the two agree until the
 * moment they would not.
 *
 * WHAT IS DELIBERATELY ABSENT. No `accuracy`, for the reason `circulatingTales`
 * gives at length: the game does not adjudicate between two contradicting
 * accounts in its own voice, and a client handed `accuracy` could sort the
 * accounts by truth. No attribute, no font, no fertility number, no locus. If
 * a value here cannot be traced to a birth somebody counted, a waking somebody
 * attended, or a sentence somebody wrote down with their name on it, it does
 * not belong on the panel.
 */

/** One completed life the market has watched, and what it bore. */
export interface PanelIssue {
  name: string;
  /** How the card's line reaches her: `her mother`, `her sister`, `of her house`. */
  relation: string;
  /** Children the RECORD credits to her — a forged pedigree moves this exactly as far as the forgery says. */
  borne: number;
  /** How many of those reached `GROWN`. The half of a line's read that a bare birth count hides. */
  grown: number;
}

/** A waking the world attended (§11). Public, dated, and the market remembers it. */
export interface PanelWaking {
  name: string;
  relation: string;
  year: Year;
  sex: Sex;
  /**
   * Whether the house has since seen him hold it. Only men express (invariant
   * 4), so on a woman this is always false and the waking is the whole signal.
   */
  expressed: boolean;
}

/** An account in circulation. Teller and bias, never accuracy. */
export interface PanelSaying {
  tale: string;
  teller: string;
  bias: string;
  text: string;
}

/** A page of the family's own book that spoke about this house. */
export interface PanelPage {
  year: Year;
  text: string;
  /** How the family answered the Record block on this page, where it was asked. */
  record?: 'record' | 'omit' | 'embellish';
  /**
   * The page rests on a Discrepancy this family created. The lie, still on
   * the shelf. Truthful Record pages reach this same channel with `false`
   * (issue #138).
   */
  embellished: boolean;
}

export interface MatchPanel {
  issue: PanelIssue[];
  woken: PanelWaking[];
  said: PanelSaying[];
  ourBook: PanelPage[];
}

export function emptyPanel(): MatchPanel {
  return { issue: [], woken: [], said: [], ourBook: [] };
}

/**
 * A child who grew up. Fifteen is `CHILDBEARING.from` and the age at which the
 * world starts asking anything of anybody; it is not imported from there
 * because these are two different claims that happen to share a number, and
 * the day one moves the other should not follow it silently.
 */
const GROWN = 15;

/**
 * How much of each list a panel carries. A matchmaker recites the recent and
 * the notable; a panel that listed forty pages would be a search index, and
 * the player would stop reading it — which is the same failure as showing
 * nothing, arriving from the other direction.
 */
const ROWS = 4;

/**
 * HER LINE, IN NAMES — the row-builder both `readIssue` and `issueOf` share,
 * so a mother-and-sisters read means the same thing whether it reaches the
 * player off a Match card or off the Vessel's candidate list.
 */
function issueRows(ctx: SimCtx, women: Person[], cen: LineCensus, motherId?: string, subjectSex: Sex = 'female'): PanelIssue[] {
  const w = ctx.world;
  const possessive = subjectSex === 'male' ? 'his' : 'her';
  return women
    .filter((p) => cen.counted.has(p.id))
    .slice(0, ROWS)
    .map((p) => {
      const kids = cen.borne.get(p.id) ?? [];
      return {
        name: p.name,
        relation: p.id === motherId ? `${possessive} mother`
          : motherId ? `${possessive} sister` : `of ${possessive} house`,
        borne: kids.length,
        grown: kids.filter((k) => ageAt(k, k.died ?? w.year) >= GROWN).length,
      };
    });
}

/**
 * HER LINE, IN NAMES.
 *
 * The same women `readLine` reads its one word off, so the panel and the word
 * on the card can never disagree: if the card says `thin` on two women, these
 * are the two women.
 */
function readIssue(ctx: SimCtx, card: MatchCard, cen: LineCensus): PanelIssue[] {
  const who = card.kind === 'household' ? ctx.world.people.get(card.person ?? '') : undefined;
  return issueRows(ctx, lineWomen(ctx, card, cen), cen, who?.claimedParents.mother, card.sex);
}

/**
 * THE SAME READ, FOR A PERSON THE MATCH NEVER DEALT A CARD FOR.
 *
 * The Vessel rite (issue #28 item 2) asks the house to name a relative and
 * says nothing about what spending them costs the family's next generation.
 * `events/decisions.ts` attaches this to a candidate's row on any slot
 * authored `showLine: true`, so the answer is exactly the epistemics of
 * issue #68's panel — her mother and sisters, named, with what the record
 * credits to them — and never a fecundity number pulled off her genome.
 */
export function issueOf(ctx: SimCtx, personId: string, cen: LineCensus): PanelIssue[] {
  const who = ctx.world.people.get(personId);
  return issueRows(ctx, bloodWomenOf(ctx, personId, cen), cen, who?.claimedParents.mother, who?.sex);
}

/**
 * WHO OF HERS HAS WOKEN.
 *
 * The Power is X-linked and given (invariant 4): a daughter takes her father's
 * only X entire, and everything else she has of it came through her mother. So
 * where the Power has SHOWN in a woman's near kin is not gossip about her
 * family, it is the closest thing to a reading of her own blood that anybody
 * in 1042 can take — and §11 says as much, calling the early-waking daughter
 * "the one honest signal in a marriage market otherwise built entirely on
 * forged documents". A waking is a thing a hall full of people attended. It is
 * on the panel because it is public, not because it is true.
 *
 * HER KIN, TO FIRST COUSINS. Two steps up the CLAIMED pedigree and back down
 * again: father, mother, siblings, grandparents, uncles and aunts, cousins.
 * That is the family a matchmaker actually knows, and the first cut of this
 * read only her father, her siblings and her mother's brothers — which came up
 * empty on 84 of 118 household cards measured, because her father married in
 * from a house with no font in it and her brothers are three coin flips. The
 * branch is the unit the market reads, and it always was: "it has shown twice
 * in that line" is a sentence somebody says.
 *
 * Claimed, never real, for the same reason `kinship` and `LineRead` are: the
 * market reads documents. A forged pedigree that moves a girl into a branch
 * the Power has shown in moves what the market believes about her, and the
 * house that bought the forgery is the last house entitled to complain.
 *
 * For a recipe there are no relatives, because two of the three people on the
 * table do not exist yet. What there is instead is her house: the people of it
 * the world HAS watched wake. A house that has produced three wakings in two
 * centuries is a different proposition from one that has produced none, and
 * nobody had to open a genome to notice.
 */
function readWoken(ctx: SimCtx, card: MatchCard): PanelWaking[] {
  const w = ctx.world;
  const who = card.kind === 'household' ? w.people.get(card.person ?? '') : undefined;
  const rows: { p: Person; relation: string; near: number }[] = [];

  if (who) {
    for (const [id, relation, near] of claimedKin(ctx, who)) {
      const p = w.people.get(id);
      if (p) rows.push({ p, relation, near });
    }
  } else {
    for (const p of w.people.all()) {
      if (p.houseOfOrigin === card.house) {
        rows.push({ p, relation: `of ${card.sex === 'male' ? 'his' : 'her'} house`, near: 0 });
      }
    }
  }

  const seen = new Set<string>();
  const out: PanelWaking[] = [];
  for (const { p, relation, near } of rows.sort((a, b) => b.near - a.near)) {
    if (!p.awakening.awakened || p.awakening.year === undefined) continue;
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    out.push({
      name: p.name,
      relation,
      year: p.awakening.year,
      sex: p.sex,
      // What the world sees of a man who has HELD it, as distinct from one who
      // merely woke: Madness on him. Never `canExpress`, which is a fact about
      // his X and therefore exactly the kind of thing this panel may not read.
      expressed: p.sex === 'male' && p.madness > 0,
    });
  }
  return out.slice(0, ROWS);
}

/**
 * Her claimed kin out to first cousins, each with a word for how she is
 * related and a number for how near — the near ones are kept when the list is
 * cut to `ROWS`, because a father who woke and a cousin who woke are not the
 * same news.
 *
 * Two steps up and all the way back down. `seen` is keyed on the person and
 * not on the path, so the nearest description of anybody wins: a first cousin
 * who is also a half-sibling is a half-sibling.
 */
function claimedKin(ctx: SimCtx, who: Person): [string, string, number][] {
  const w = ctx.world;
  const possessive = who.sex === 'male' ? 'his' : 'her';
  const kids = new Map<string, string[]>();
  for (const p of w.people.all()) {
    for (const parent of [p.claimedParents.mother, p.claimedParents.father]) {
      if (!parent) continue;
      const list = kids.get(parent);
      if (list) list.push(p.id);
      else kids.set(parent, [p.id]);
    }
  }
  const parentsOf = (id: string): string[] => {
    const p = w.people.get(id);
    if (!p) return [];
    const out: string[] = [];
    if (p.claimedParents.mother) out.push(p.claimedParents.mother);
    if (p.claimedParents.father) out.push(p.claimedParents.father);
    return out;
  };

  const out: [string, string, number][] = [];
  const seen = new Set<string>([who.id]);
  const add = (id: string, relation: string, near: number): void => {
    if (seen.has(id)) return;
    seen.add(id);
    out.push([id, relation, near]);
  };
  const wordFor = (id: string, male: string, female: string): string =>
    (w.people.get(id)?.sex === 'male' ? male : female);

  const parents = parentsOf(who.id);
  const grandparents = parents.flatMap(parentsOf);

  // Order matters: everything is added nearest-first, and `add` keeps the
  // first word anybody is given.
  for (const id of parents) add(id, wordFor(id, `${possessive} father`, `${possessive} mother`), 4);
  for (const id of parents) {
    for (const sib of kids.get(id) ?? []) add(sib, wordFor(sib, `${possessive} brother`, `${possessive} sister`), 3);
  }
  for (const id of grandparents) add(id, wordFor(id, `${possessive} grandfather`, `${possessive} grandmother`), 2);
  for (const id of grandparents) {
    for (const unc of kids.get(id) ?? []) add(unc, wordFor(unc, `${possessive} uncle`, `${possessive} aunt`), 2);
  }
  for (const id of grandparents) {
    for (const unc of kids.get(id) ?? []) {
      for (const cousin of kids.get(unc) ?? []) add(cousin, `${possessive} cousin`, 1);
    }
  }
  return out;
}

/**
 * WHICH PAGES OF OUR OWN BOOK SPOKE ABOUT THAT HOUSE.
 *
 * There is no `house` on a chronicle entry and there should not be — an entry
 * is a page, not a database row. What an entry does carry is its resolved
 * `claims` (issue #19), each naming a person, and a person was born into a
 * house. So the family's book is about a house exactly when it made a claim
 * about somebody of it.
 *
 * Issue #138 closed the content-side asymmetry that used to make this route
 * lie-only: every authored Record claim now has a truthful Record counterpart,
 * and `record/claims` rejects either half appearing alone. That means
 * `ourBook` can carry both the family's true pages and its embellishments
 * without adding a second house index to the chronicle.
 */
function pagesAbout(ctx: SimCtx, house: string): ChronicleEntry[] {
  const w = ctx.world;
  const out: ChronicleEntry[] = [];
  for (const e of w.chronicle) {
    const claims = e.claims ?? [];
    if (!claims.length) continue;
    const hit = claims.some((c) => w.people.get(c.person)?.houseOfOrigin === house);
    if (hit) out.push(e);
  }
  return out;
}

function readOurBook(pages: ChronicleEntry[]): PanelPage[] {
  return [...pages]
    .sort((a, b) => b.year - a.year)
    .slice(0, ROWS)
    .map((e) => ({
      year: e.year,
      // A greyed page is known to have existed and gone, and an omitted one is
      // a dated blank. Both are answers, so both are shown rather than skipped.
      text: e.text ?? (e.greyed ? 'a page the house will not read out' : 'a blank the house left'),
      ...(e.record ? { record: e.record } : {}),
      embellished: e.discrepancyId !== undefined,
    }));
}

/**
 * WHAT IS SAID OF THE HOUSE, AND BY WHOM.
 *
 * A tale reaches a house by two structural routes: its about-event appears on
 * pages concerning that house, or the tale explicitly declares the house in
 * `TaleDef.houses`. The second route is what lets a rival chronicle be useful
 * before our own book has mentioned that family, without making the rules read
 * a house name out of free prose.
 *
 * Only tales that have STARTED CIRCULATING appear, for the reason
 * `circulatingTales` gives: a tale whose event has fired but whose
 * `circulatesFrom` year has not arrived is not yet something anyone has heard,
 * and a matchmaker cannot repeat it.
 */
function readSaid(ctx: SimCtx, house: string, pages: ChronicleEntry[]): PanelSaying[] {
  const w = ctx.world;
  const events = new Set(pages.map((e) => e.eventId).filter((id): id is string => id !== undefined));
  const out: PanelSaying[] = [];
  const seen = new Set<string>();

  const take = (t: { id: string; teller: string; bias: string; text: string }): void => {
    const state = w.tales.get(t.id);
    if (!state?.circulating || seen.has(t.id)) return;
    seen.add(t.id);
    out.push({ tale: t.id, ...proseForTale(ctx, t) });
  };

  for (const eventId of events) for (const t of ctx.content.talesAbout(eventId)) take(t);

  // AND THE SHORTER ROUTE: an authored semantic link. Kept second so pages
  // this family itself wrote still lead. The teller and wording remain free to
  // change, translate, or omit the house's name without changing the panel.
  for (const id of w.tales.keys()) {
    const t = ctx.content.tale(id);
    if (t?.houses.includes(house)) take(t);
  }
  return out.slice(0, ROWS);
}

/**
 * Read the panel onto the card. Mutates, the way `readLine` and `priceIn` do:
 * what a card SAYS and what a card COSTS are both read off the world after the
 * deck is dealt, never rolled into it.
 */
export function readPanel(ctx: SimCtx, card: MatchCard, cen: LineCensus): void {
  const pages = pagesAbout(ctx, card.house);
  card.panel = {
    issue: readIssue(ctx, card, cen),
    woken: readWoken(ctx, card),
    said: readSaid(ctx, card.house, pages),
    ourBook: readOurBook(pages),
  };
}
