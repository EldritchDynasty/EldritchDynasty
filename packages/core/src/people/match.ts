import type { CharacterTemplate, Person, Sex, Year } from '@ed/schema';
import { ageAt, MAIN_BRANCH } from '@ed/schema';
import type { SimCtx } from '../world.js';
import { hashSeed, makeRng, type Rng } from '../rng.js';
import { DEBT_FLOOR } from '../economy.js';
import { assizeFavour } from '../assize.js';
import { onTheMarket } from '../table.js';
import { matchF } from '../record.js';
import { CHILDBEARING, eligibleToMarry, wed } from './demography.js';
import { inBreedingPool } from './careers.js';
import { eligibleTemplates, mintRecipe, rollRecipe, type MintRecipe } from './minting.js';
import { phenotypeOf } from './factory.js';
import { marketAppetite } from '../bearing.js';
import { papersDemanded, papersHeld } from './papers.js';
import { emptyPanel, readPanel, type MatchPanel } from './panel.js';
import { externalThreadFor } from '../relationship-threads.js';

/**
 * THE MATCH — draft one partner from three cards.
 *
 * Step 2 of the core loop, and one of the three things the player actually
 * does. `autoMarry` said so in its own header for a year: "PLACEHOLDER
 * PAIRING. The shipped game replaces this entirely with the suitor draft —
 * draw one of three cards, each with blood, politics, a dowry and one secret
 * revealed later." This is that draft. `autoMarry` survives underneath it and
 * still pairs everyone the player is not asked about — the cadet halls, the
 * retainers, the married-in — because a game that asked the Head to arrange
 * every wedding in four hundred people's lives would be a spreadsheet.
 *
 * WHO IS DRAFTED FOR: blood of the main hall. Those are the marriages that
 * decide what the house is — a daughter of the seat married outward costs the
 * family her font and her children both, which is exactly the decision the
 * genetics was built to make expensive. A cousin in a cadet hall marrying
 * another cousin is a fact about the world; the seat's marriages are the game.
 *
 * WHAT IS ON A CARD: what the world can see. Her house, her age, what the
 * market says about her, the kinship the DOCUMENTS claim (`matchF`, which a
 * forged pedigree moves exactly as far as the forgery says it should), and
 * what she costs. Never the genome. The card cannot tell you what she carries
 * because nobody in 1042 can tell you what she carries, and the whole
 * marriage market exists because of that. It does carry a word about her
 * LINE — see `LineRead` — which is the one thing a market can honestly say
 * about fertility without counting anybody's eggs.
 *
 * WHY A CARD IS NOT A PERSON. Two of the three are declined, and a declined
 * suitor must not become a woman living somewhere else with a lazy genome and
 * a claim on the frequency ration. So a card holds a `MintRecipe` — everyone
 * she would be — and `mintRecipe` spawns her only if she is taken. A rival-house
 * recipe may point at a shadow-lineage person who already existed; issue #214
 * lets that genealogy remember the public name the house heard, so an occasional
 * later card can be recognisably the same person without ever minting the decline.
 */

export interface MatchCard {
  id: string;
  /** Someone already alive, or a recipe for someone who would arrive. */
  kind: 'household' | 'outsider';
  name: string;
  sex: Sex;
  age: number;
  house: string;
  houseName: string;
  /** The market's line on her. A template blurb, or what the house is to itself. */
  blurb: string;
  /** Crowns, paid on acceptance. Nothing leaves the house for a cousin. */
  dowry: number;
  /**
   * F of the child this match would have, from the CLAIMED pedigree — the
   * number the family's own documents would compute, and therefore the number
   * a forgery can move. 0.0625 is first cousins.
   */
  kinship: number;
  /**
   * The market's word on her line's fertility, read off her mother and her
   * sisters. See `LineRead`. Never her genome.
   */
  line: LineRead;
  /**
   * What a broker would actually SAY, assembled from `kinship`, the house's
   * reputation for carrying, and the line read. §7's vocabulary — "deep
   * blood", "a thin line" — is never explained in text and is learned from
   * use, which requires it to be somewhere a player can read it.
   */
  words: string;
  /**
   * How many completed lives that word rests on. Zero is `unknown`; one is her
   * mother and nothing else, which the player should be told before he bets a
   * daughter on it.
   */
  lineSeen: number;
  /**
   * THE PAPERS (concept §7, world §13). What this house is asked to produce in
   * generations of notarised maternal record, and what the subject can
   * actually show. `papers.ts` computes both; a card that asks for more than
   * the house can show is blocked exactly as an unaffordable one is.
   *
   * This is the half of a dowry negotiation §7 calls the whole of it, and it
   * bites hardest in the century the coin does not: a house founded in 1042
   * has no maternal record because it has no dead women yet.
   */
  papersAsked: number;
  papersShown: number;
  /**
   * THE MATCHMAKER'S PANEL (issue #68) — the evidence under the words.
   *
   * `words` is a broker's sentence and `line` is one adjective; both are
   * summaries, and a summary is something to accept rather than something to
   * reason from. The panel is what the summary was made OUT of: the women the
   * line was read off by name, the wakings the world attended, what is said of
   * her house and by whom, and what this family's own book has written about
   * that house — embellishments included.
   *
   * Every row is an observed fact or an attributed claim. See `panel.ts` for
   * why none of it may come off a genome.
   */
  panel: MatchPanel;
  /** A concrete earlier encounter with this house, derived from existing history (#217). */
  callback?: string;
  /** Set for `household`. */
  person?: string;
  /** Set for `outsider`. Exactly who arrives if this card is taken. */
  recipe?: MintRecipe;
  available: boolean;
  blockedBy?: string;
}

/** A hand of cards, and who they are for. */
export interface MatchOffer {
  subject: { id: string; name: string; sex: Sex; age: number };
  cards: MatchCard[];
}

/**
 * THE FUTURE ON THE FACE OF THE CARD (issue #214).
 *
 * A Match card already contains two layers: the broker's short words, and the
 * evidence under them in `panel`. The player should not have to mentally turn
 * those rows into a strategy label every generation, but the label is not a
 * new fact. It is a reading of exactly the facts already printed on the card.
 *
 * The signature is the guard rail: no `SimCtx`, no person store, no genetics
 * table. A future reader can see only a `MatchCard` — including the same
 * uncertainty, forged record and biased tales the player sees. It therefore
 * cannot promise a child, reveal Fecundity, inspect a locus, or discover that
 * a tale is wrong. Those are futures. This is what the family can reasonably
 * infer before choosing one.
 */
export type MatchFutureKind = 'blood' | 'standing' | 'continuity' | 'mystery';
export type MatchFutureConfidence = 'clear' | 'mixed' | 'uncertain';

export interface MatchFutureReading {
  kind: MatchFutureKind;
  label: 'Blood' | 'Standing' | 'Continuity' | 'Mystery';
  confidence: MatchFutureConfidence;
  /** One or two pieces of visible evidence behind the reading. */
  reasons: string[];
  /** The second reading where two visible cases are nearly tied. */
  competing?: MatchFutureKind;
}

interface FutureCase {
  kind: MatchFutureKind;
  score: number;
  reasons: string[];
}

const FUTURE_LABEL: Record<MatchFutureKind, MatchFutureReading['label']> = {
  blood: 'Blood',
  standing: 'Standing',
  continuity: 'Continuity',
  mystery: 'Mystery',
};

/**
 * Turn the evidence already on one card into the short answer to
 * "why would I choose this person?"
 *
 * Scores are deliberately coarse. They establish hierarchy, not certainty:
 * two cases within one point are reported as mixed, and two cards are entirely
 * allowed to receive the same reading. The deck is not rewritten to manufacture
 * three different archetypes where the world did not deal three.
 */
export function matchFuture(card: MatchCard): MatchFutureReading {
  const blood: FutureCase = { kind: 'blood', score: 0, reasons: [] };
  if (card.kinship >= 0.0625) {
    blood.score += 4;
    blood.reasons.push('the family papers put this match among close kin');
  } else if (card.kinship > 0) {
    blood.score += 2;
    blood.reasons.push('the family papers still join these two lines');
  }
  if (card.words.includes('deep blood')) {
    blood.score += 3;
    blood.reasons.push(`${card.houseName} is spoken of as deep blood`);
  } else if (card.words.includes('a drop of it')) {
    blood.score += 1;
    blood.reasons.push(`${card.houseName} is said to carry a drop of the old blood`);
  }
  if (card.panel.woken.length) {
    const n = card.panel.woken.length;
    blood.score += Math.min(3, n + (card.panel.woken.some((r) => r.expressed) ? 1 : 0));
    blood.reasons.push(`${n} ${n === 1 ? 'waking is' : 'wakings are'} known in the visible line`);
  }

  const standing: FutureCase = { kind: 'standing', score: 0, reasons: [] };
  if (card.kind === 'outsider' && card.panel.said.length) {
    standing.score += 2;
    const n = card.panel.said.length;
    standing.reasons.push(`${card.houseName} already appears in ${n} circulating ${n === 1 ? 'account' : 'accounts'}`);
  }
  if (card.kind === 'outsider' && card.panel.ourBook.length) {
    standing.score += 2;
    standing.reasons.push(`our own book already has pages on ${card.houseName}`);
  }
  if (standing.score >= 4) standing.score += 1;

  const continuity: FutureCase = { kind: 'continuity', score: 0, reasons: [] };
  if (card.line === 'fertile') {
    continuity.score += 4;
    continuity.reasons.push(`the line is called full on ${card.lineSeen} completed ${card.lineSeen === 1 ? 'life' : 'lives'}`);
  } else if (card.line === 'ordinary') {
    continuity.score += 2;
    continuity.reasons.push(`the watched line is ordinary across ${card.lineSeen} completed ${card.lineSeen === 1 ? 'life' : 'lives'}`);
  }

  const borne = card.panel.issue.reduce((n, row) => n + row.borne, 0);
  const grown = card.panel.issue.reduce((n, row) => n + row.grown, 0);
  if (borne >= 3 && grown / borne >= 0.6) {
    continuity.score += 2;
    continuity.reasons.push(`${grown} of ${borne} children in the named line grew up`);
  }
  if (card.kind === 'outsider' && card.kinship === 0) {
    continuity.score += 1;
    continuity.reasons.push('the family papers show no kinship joining the two lines');
  }

  const mystery: FutureCase = { kind: 'mystery', score: 0, reasons: [] };
  if (card.line === 'unknown') {
    mystery.score += 3;
    mystery.reasons.push('no completed line anybody here has watched');
  }
  const panelRows = card.panel.issue.length + card.panel.woken.length
    + card.panel.said.length + card.panel.ourBook.length;
  if (panelRows === 0) {
    mystery.score += 2;
    mystery.reasons.push('the panel has no issue, waking, tale or old page to lean on');
  }
  if (Math.max(blood.score, standing.score, continuity.score) < 2) {
    mystery.score = Math.max(mystery.score, 2);
    if (!mystery.reasons.length) mystery.reasons.push('nothing visible gives the match a clean case');
  }

  // Stable order is deliberate only as a tiebreak for the PRIMARY label.
  // The tie itself is not hidden: a one-point gap is reported as mixed below.
  const cases = [blood, standing, continuity, mystery]
    .sort((a, b) => b.score - a.score);
  const winner = cases[0]!;
  const runner = cases[1]!;
  const mixed = runner.score > 0 && winner.score - runner.score <= 1;
  const confidence: MatchFutureConfidence = winner.kind === 'mystery' || winner.score < 2
    ? 'uncertain'
    : mixed ? 'mixed' : 'clear';

  return {
    kind: winner.kind,
    label: FUTURE_LABEL[winner.kind],
    confidence,
    reasons: winner.reasons.slice(0, 2),
    ...(mixed ? { competing: runner.kind } : {}),
  };
}

export const CARDS_DEALT = 3;

/**
 * How many of the three may be the house's own. Never all three: a hand with
 * no way out of the family is not a decision, it is a diagnosis.
 */
export const KIN_CARDS_DEALT = 2;

/**
 * What a house pays for blood it did not have. Rationed the same way the
 * person is: a Rare suitor is not merely a better roll, she is a better roll
 * the house has to find two hundred crowns for, and the treasury is the reason
 * the answer is not always "take the best card".
 */
const DOWRY: Record<string, number> = {
  common: 20,
  uncommon: 50,
  rare: 120,
  mythic: 200,
};

/**
 * THE LINE'S READ (issue #28) — what a marriage market can honestly say
 * about fertility.
 *
 * Fecundity is a heritable Core attribute weighted seventy-thirty toward the
 * mother, which makes every match a bet on how many children a couple will
 * have as well as on what those children will be. A player who cannot observe
 * that is not making the bet; he is being charged for it. But the card must
 * not print the number the genetics knows, because nobody in 1042 can count a
 * woman's eggs and the marriage market exists precisely because they cannot.
 *
 * What a market CAN do — what every real one did — is watch her mother and her
 * sisters and say a word about the line. So the read is built only out of
 * births the world has already seen, and only out of women who lived through
 * the whole childbearing window: a completed life is the only kind anybody can
 * count. It is measured against the population's own mean rather than a
 * constant, for the reason `expectedAttribute` is: the locus table is content,
 * and a hardcoded centre stops being true the first time anyone edits it.
 *
 * It reads the RECORD, not the blood — a woman is her documents' daughter
 * here, exactly as she is for `kinship`. A forged pedigree that moves a girl
 * into a fuller line moves what the market says about her too, and the house
 * that paid for the forgery is the last house entitled to complain.
 *
 * `unknown` is the honest answer and a common one. A woman off a farm has no
 * line anyone at this table has watched, and the card says so rather than
 * guessing — which is itself the information that a stranger is a stranger.
 */
export type LineRead = 'fertile' | 'ordinary' | 'thin' | 'unknown';

/**
 * How far off the measured mean a line sits before the market has a word for
 * it. Wide on purpose: two or three completed lives is a small sample, and a
 * card that called every second line thin would be noise wearing a label.
 */
const FULL_LINE = 1.25;
const THIN_LINE = 0.75;

/**
 * Everyone the world has ever held, counted once for the whole hand.
 *
 * Exported because the matchmaker's panel reads its rows off exactly these
 * maps (issue #68). One census, one set of women, one arithmetic: if the card
 * says `thin` on two completed lives, the panel names those two lives and no
 * others, and the word and the evidence cannot drift apart.
 */
export interface LineCensus {
  /** Claimed mother -> the children the record credits to her. */
  borne: Map<string, Person[]>;
  /** Wives whose childbearing is over. The only lives the market may count. */
  counted: Set<string>;
  /** Those same wives, by the house they were born into. */
  byHouse: Map<string, Person[]>;
  /** Children per counted wife, across the whole world. The centre. */
  mean: number;
}

/**
 * A wife who lived through the whole window, and is therefore evidence.
 *
 * Three exclusions, each of which would otherwise poison a two-person sample.
 * A girl dead at three did not fail to bear children. A woman of thirty has
 * not finished. A woman who never married was never asked.
 */
function counts(year: Year, p: Person): boolean {
  return p.sex === 'female'
    && p.marriages.length > 0
    && ageAt(p, year) >= CHILDBEARING.to;
}

/**
 * One pass over the archive, for the whole hand.
 *
 * The dead are the point rather than an inconvenience — they are where almost
 * all of the evidence is — so this walks `all()` and not `living()`.
 *
 * Exported so a decision the Match never dealt a card for — the Vessel
 * (issue #28 item 2) — can ask the identical question of the same archive,
 * rather than taking the hand's census on faith or re-deriving a second one.
 */
export function lineCensus(ctx: SimCtx): LineCensus {
  const w = ctx.world;
  const borne = new Map<string, Person[]>();
  const counted = new Set<string>();
  const byHouse = new Map<string, Person[]>();
  const all = w.people.all();

  for (const p of all) {
    const mother = p.claimedParents.mother;
    if (!mother) continue;
    const kids = borne.get(mother);
    if (kids) kids.push(p);
    else borne.set(mother, [p]);
  }

  let total = 0;
  for (const p of all) {
    if (!counts(w.year, p)) continue;
    counted.add(p.id);
    total += borne.get(p.id)?.length ?? 0;
    const house = byHouse.get(p.houseOfOrigin);
    if (house) house.push(p);
    else byHouse.set(p.houseOfOrigin, [p]);
  }

  return { borne, counted, byHouse, mean: counted.size ? total / counted.size : 0 };
}

/**
 * The women a card's line is read off.
 *
 * For someone already alive it is her mother and her mother's other daughters,
 * which is the whole of what #28 said was honestly readable. The candidate
 * herself is never in it — she has borne nothing yet, and counting her would
 * read every young bride in the world as barren.
 *
 * For a recipe there is no mother to read, because two of these three people
 * do not exist. What there is instead is her house: the women of it the world
 * HAS watched, most of them daughters it married out to this one. A rival
 * house's daughter is a different proposition from a woman off a farm, and
 * this is the line on the card where that stops being flavour.
 */
/**
 * Mother and sisters of a specific person, off the claimed pedigree.
 *
 * `lineWomen`'s household branch, pulled out and exported so a decision
 * outside the Match — the Vessel (issue #28 item 2) — can ask the same
 * question of a person it already has, without a `MatchCard` to wrap them in.
 */
export function bloodWomenOf(ctx: SimCtx, personId: string, cen: LineCensus): Person[] {
  const w = ctx.world;
  const who = w.people.get(personId);
  const mother = who && w.people.get(who.claimedParents.mother ?? '');
  if (!who || !mother) return [];

  const sisters = (cen.borne.get(mother.id) ?? [])
    .filter((p) => p.id !== who.id && p.sex === 'female');
  return [mother, ...sisters];
}

export function lineWomen(ctx: SimCtx, card: MatchCard, cen: LineCensus): Person[] {
  if (card.kind !== 'household') return cen.byHouse.get(card.house) ?? [];
  return bloodWomenOf(ctx, card.person ?? '', cen);
}

/** Read the line onto the card. Mutates, the way `priceIn` does. */
function readLine(ctx: SimCtx, card: MatchCard, cen: LineCensus): void {
  const women = lineWomen(ctx, card, cen).filter((p) => cen.counted.has(p.id));
  card.lineSeen = women.length;
  card.line = 'unknown';
  if (!women.length || cen.mean <= 0) return;

  const borne = women.reduce((n, p) => n + (cen.borne.get(p.id)?.length ?? 0), 0);
  const avg = borne / women.length;
  if (avg >= cen.mean * FULL_LINE) card.line = 'fertile';
  else if (avg <= cen.mean * THIN_LINE) card.line = 'thin';
  else card.line = 'ordinary';
}

/**
 * The marriages the player is asked about: blood of the main hall, of age,
 * unspoken for. Everyone else is `autoMarry`'s business.
 */
export function matchSubjects(ctx: SimCtx): Person[] {
  const w = ctx.world;

  // HOW OFTEN THE HOUSE GOES TO MARKET AT ALL, as distinct from how often it
  // takes the same person there (`MARKET_COOLDOWN`, below).
  //
  // The per-person cooldown caps one player's patience with one daughter; it
  // does nothing about a house with a dozen people who all qualify. Issue
  // #41's meiotic drive made exactly that house: carriers now persist instead
  // of thinning out by 1300, `matchWeight` gives every carrier 80 and every
  // expressing man 100, and the hand count went from about 46 a run to 82 —
  // past the attention budget §5 sets at one chapter beat a generation, and
  // caught by `attention.slow.test.ts` rather than by anybody noticing.
  //
  // Derived from `courted` rather than stored: its highest value IS the year
  // the house last went to market, and a second field saying the same thing is
  // a field that can disagree with the first.
  // THE LAST OF A LINE GETS NO PRIORITY IN THE MATCH — until it does (issue
  // #132, Stage 2). `world.priorityMatch` names whoever the house has just
  // been told to go to market for; a house otherwise in cooldown still goes,
  // because "wait nine years" is not an answer to "there is almost nobody
  // left". `matchWeight`, below, is what makes them actually win the season's
  // one hand rather than merely being asked about.
  const priority = w.priorityMatch.length > 0;
  const lastHand = Math.max(0, ...Object.values(w.courted));
  if (!priority && lastHand && w.year - lastHand < HOUSE_MARKET_COOLDOWN) return [];

  const eligible = w.people
    .household(w.playerHouse, w.year)
    .filter((p) => eligibleToMarry(ctx, p) || (w.priorityMatch.includes(p.id) && priorityEligibleToMarry(ctx, p)))
    .filter((p) => p.membership.some((m) =>
      m.house === w.playerHouse && m.kind === 'blood'
      && (m.branch ?? MAIN_BRANCH) === MAIN_BRANCH
      && m.from <= w.year && (m.to === undefined || m.to > w.year)));

  // THE MATCH IS THE CHAPTER BEAT, and there are about forty chapters.
  //
  // Every eligible person of the seat used to be dealt a hand, which came to
  // 171 hands a run against a design that calls for one a generation (§5).
  // Measured alongside 686 naming prompts, that put fifty-nine percent of the
  // player's whole attention budget on the two least consequential questions
  // in the game and thirty-seven Record choices — the mechanical form of the
  // entire thesis — on the most consequential one.
  //
  // So the player is dealt the marriages that decide something, and the house
  // arranges the rest (`autoMarry`). Consequence means one of three things:
  // the blood, the seal, or a cousin already at the table.
  const ranked = eligible
    .filter((p) => onTheMarket(ctx, p))
    .filter((p) => {
      if (w.priorityMatch.includes(p.id)) return true;
      const last = w.courted[p.id];
      return last === undefined || w.year - last >= MARKET_COOLDOWN;
    })
    .map((p) => ({ p, weight: w.priorityMatch.includes(p.id) ? PRIORITY_WEIGHT : matchWeight(ctx, p) }))
    .filter((r) => r.weight > 0)
    .sort((a, b) => {
      if (a.weight !== b.weight) return b.weight - a.weight;
      // THE SCION WINS EVERY TIE HE IS IN, THE HEIR EVERY TIE BUT AGAINST
      // HIM (issue #61, Stages A and E4) — never a reason to skip somebody
      // more consequential, only to stop losing to the arbitrary id-order
      // tiebreak below when either is genuinely as consequential as
      // whoever he is tied with. `matchWeight` gives every expresser the
      // same 100, and the old tiebreak handed the one hand a season deals
      // to whichever of them happened to sort first alphabetically —
      // arbitrary with respect to the one thing a house building a PAIR
      // actually wants dealt to it. `MATCHES_PER_SEASON` is a real cap, so
      // this is genuine competition between the two, not a cosmetic order:
      // a season with room for one hand goes to the Scion over the heir
      // every time they are both tied for it.
      const rank = (id: string) => (id === w.scion ? 2 : id === w.scionHeir ? 1 : 0);
      const ar = rank(a.p.id);
      const br = rank(b.p.id);
      if (ar !== br) return br - ar;
      return a.p.id < b.p.id ? -1 : 1;
    });

  return ranked.slice(0, MATCHES_PER_SEASON).map((r) => r.p);
}

/**
 * At most this many hands dealt in one marriage phase — one every three years.
 * The cap is what stops a generation that happens to have six marriageable
 * cousins from spending a whole afternoon on them.
 */
const MATCHES_PER_SEASON = 1;

/**
 * Years before the house takes the same person back to market. A hand that is
 * declined, or that the house cannot pay for, is not re-dealt next season —
 * see `WorldState.courted`.
 */
const MARKET_COOLDOWN = 9;

/**
 * Years before the house deals ANY hand again.
 *
 * Six, and it is a measurement rather than a preference. `attention.slow.test.ts`
 * holds both ends of §5's budget — a run deals between fifteen and eighty
 * hands, and no single kind of prompt owns more than 55% of everything asked —
 * and the two ends pull opposite ways. Measured over its three seeds:
 *
 *   cooldown 15   hands 26-30   choice 55.4%   too few hands, budget unbalanced
 *   cooldown 12   hands 26-30   choice 55.2%   the same, and still over
 *   cooldown  8   hands 32-47   choice 55.2%   over on one seed
 *   cooldown  6   hands 32-58   choice 49.7-53.3%   both ends clear
 *
 * Taking prompts OUT of a budget is also a way of unbalancing it: every hand
 * removed raises the share of everything else, and the Match is the only
 * prompt in the game that is about the blood.
 */
const HOUSE_MARKET_COOLDOWN = 6;

/**
 * ABOVE ANYTHING `matchWeight` HANDS OUT (issue #132, Stage 2) — a flagged
 * person wins the season's one hand outright rather than merely competing
 * for it, because the alternative to winning it is not "next season", it is
 * the line.
 */
const PRIORITY_WEIGHT = 1000;

/**
 * `eligibleToMarry`, MINUS the upper age bound (issue #132, Stage 2) — the
 * whole crisis this is for is a man past it whose living wife cannot bear,
 * and `rollBirths` caps only the MOTHER's age; a father's has never gated
 * anything it reads. `eligibleToMarry` is not touched — it is what every
 * ORDINARY marriage in the game still asks, and this exists to be reached
 * from exactly one place. The floor of 17 stays: priority is a reason to
 * stop waiting, not a reason to draft a child.
 */
function priorityEligibleToMarry(ctx: SimCtx, p: Person): boolean {
  const w = ctx.world;
  return p.status === 'alive'
    && !p.marriages.some((m) => !m.to)
    && !p.castSlots.includes('the_match')
    && inBreedingPool(ctx, p)
    && w.year - p.born >= 17;
}

/**
 * How much this person's marriage decides. Zero means the house arranges it
 * and the player never sees a card.
 *
 * Deliberately NOT a measure of how interesting the cards would be. It is a
 * measure of what the marriage does to the line, because that is what the
 * player is being asked to weigh.
 */
function matchWeight(ctx: SimCtx, p: Person): number {
  const w = ctx.world;
  const ph = phenotypeOf(p, ctx.genetics, w.year);

  // He can express. Every child he fathers is a roll on the only ladder the
  // game has, and who he fathers them on is the whole question.
  if (ph.eldritch.canExpress) return 100;

  // The seal, or the person who will hold it.
  if (p.castSlots.includes('head')) return 90;

  // She carries. §7: the only route by which carried power reaches an
  // expressing male heir runs through her, and through a cousin.
  if (ph.eldritch.carriedFont > 0) return 80;

  const head = w.people.household(w.playerHouse, w.year).find((q) => q.castSlots.includes('head'));
  if (head && (p.trueParents.father === head.id || p.trueParents.mother === head.id)) return 50;

  return 0;
}

/**
 * Cousins first, then anyone else already alive and near enough to be sent
 * for. The house's own people are preferred deliberately: a card that says
 * "already at this table" is the concentrating play, and it should be on the
 * table whenever there is anyone to put there. A stranger who happens to be
 * the right age is what you get when there is not.
 */
function householdCandidates(ctx: SimCtx, subject: Person): Person[] {
  const w = ctx.world;
  const eligible = w.people.living().filter((q) => {
    if (q.id === subject.id || q.sex === subject.sex) return false;
    if (!eligibleToMarry(ctx, q)) return false;
    // Somebody the house has been told to keep back is not on a card either.
    // `matchSubjects` has always declined to deal a hand FOR her; she was
    // still dealt as one, which spends her exactly as thoroughly.
    if (!onTheMarket(ctx, q)) return false;
    if (Math.abs(q.born - subject.born) >= 16) return false;
    // Siblings and the direct line. `autoMarry` only ever excluded a shared
    // mother, which leaves a fifteen-year-old mother marriageable to her own
    // son inside the age window. Cousins are the mechanism; this is not.
    if (sharesAParent(q, subject)) return false;
    if (isParentOf(ctx, q, subject) || isParentOf(ctx, subject, q)) return false;
    return true;
  });

  const ours = eligible.filter((q) => w.people.householdOf(q.id, w.year) === w.playerHouse);
  const pool = ours.length ? ours : eligible;

  // COUSINS FIRST, AND MEANT LITERALLY. §7 calls cousin marriage "not a
  // temptation, it is the mechanism" — the only route by which carried power
  // reaches an expressing male heir. It was on 56 of 480 cards, because the
  // household card was drawn at random from everyone in the hall and most of
  // the hall is married-in wives, retainers and their children.
  //
  // AND THE DEEPEST BLOOD FIRST AMONG THOSE. Ranking on kinship alone was not
  // enough, and the measurement is unambiguous: an oracle player who always
  // took the card whose person actually carried the most font still watched
  // the family's font fall from ~25 in the founding generation to 6-11 and
  // stay there for eight hundred years. The mechanism §7 is built on could not
  // be operated by anyone, because the cousin who carries was usually not one
  // of the two the hand happened to offer.
  //
  // This is knowledge the house genuinely has about its own. Nobody can read a
  // genome, but everybody in the hall knows which of the girls had a father
  // who expressed — that is what "deep blood" MEANS in §7's vocabulary, and it
  // is gossip, not science. Outside the house it stays unknowable; `MatchCard`
  // still never prints a number nobody could know.
  return [...pool].sort((a, b) => {
    const kin = matchF(ctx, subject.id, b.id) - matchF(ctx, subject.id, a.id);
    if (Math.abs(kin) > 0.001) return kin;
    return knownBlood(ctx, b) - knownBlood(ctx, a);
  });
}

/**
 * What the house knows about one of its own: whether the blood ran in the
 * people who raised them. Zero for anybody the house did not raise.
 *
 * Deliberately NOT the genome. It is the father's expression and the mother's
 * house, which is exactly what a hall would actually know and repeat.
 */
function knownBlood(ctx: SimCtx, p: Person): number {
  const w = ctx.world;
  if (p.houseOfOrigin !== w.playerHouse) return 0;
  const father = p.claimedParents.father ? w.people.get(p.claimedParents.father) : undefined;
  const mother = p.claimedParents.mother ? w.people.get(p.claimedParents.mother) : undefined;

  let known = 0;
  if (father && phenotypeOf(father, ctx.genetics, w.year).eldritch.canExpress) known += 2;
  if (mother?.houseOfOrigin === w.playerHouse) known += 1;
  // A brother who woke is the loudest evidence a family ever has about a
  // daughter, and it is the reason the vocabulary exists.
  if (w.people.siblings(p.id).some((q) => q.awakening.awakened)) known += 2;
  return known;
}

function sharesAParent(a: Person, b: Person): boolean {
  const m = a.trueParents.mother && a.trueParents.mother === b.trueParents.mother;
  const f = a.trueParents.father && a.trueParents.father === b.trueParents.father;
  return Boolean(m || f);
}

function isParentOf(ctx: SimCtx, parent: Person, child: Person): boolean {
  return child.trueParents.mother === parent.id || child.trueParents.father === parent.id;
}

/**
 * Deal a hand for one subject.
 *
 * One card from the house's own halls where there is anyone to offer, the rest
 * minted from the market. That ratio IS the design: concentrating the blood is
 * a card the player can take rather than something the pairing code did on his
 * behalf, and marrying outward is the default the way it is in the world.
 */
export function dealMatch(ctx: SimCtx, subject: Person, rng: Rng): MatchOffer {
  const w = ctx.world;
  const cards: MatchCard[] = [];

  // Up to two of the three, when the house has two to offer. The concentrating
  // play should be a CHOICE between degrees of it — the second cousin and the
  // first cousin are different bets, and a hand that offers one of each is the
  // hand this design is about.
  const kin = householdCandidates(ctx, subject);
  for (const who of kin.slice(0, KIN_CARDS_DEALT)) {
    cards.push(householdCard(ctx, subject, who, cards.length));
  }

  // A daughter of the house is offered grooms — men who take the name. A son is
  // offered suitors. `autoMarry` has always drawn this way, and the asymmetry is
  // the matrilineal marriage the design says a house of women would invent.
  const role = subject.sex === 'male' ? 'suitor' : 'groom';
  const pool = eligibleTemplates(ctx, role).filter((t) => !t.castSlots.includes('the_match'));

  /**
   * BEARING'S FIRST AND ONLY BITE (concept §29, issue #45).
   *
   * The world stops offering. A house that has refused enough hands, held
   * enough daughters back and taken enough cousins is dealt fewer outside
   * cards — until the cousin is the only card on the table.
   *
   * This is the moral in one loop and it needs no text at all: §7 already
   * says cousin marriage is *not a temptation, it is the mechanism*, and this
   * makes it also a CONSEQUENCE. The pride that refuses to dilute the blood is
   * what forces the marriage that ruins it, and the player is never told —
   * they simply run out of cards, two generations after the acts that spent
   * them.
   *
   * THE FLOOR IS ONE. A hand with nothing on it is not a decision, and §29's
   * second rule is that pride must usually be CORRECT rather than taxed: the
   * house that has carried itself this way still gets to marry, it just stops
   * getting to choose. Where the halls have somebody to offer, that one card
   * is the cousin.
   */
  const room = CARDS_DEALT - cards.length;
  const offered = Math.max(cards.length ? 0 : 1, Math.round(room * marketAppetite(ctx)));
  const ceiling = Math.min(CARDS_DEALT, cards.length + offered);
  while (cards.length < ceiling && pool.length) {
    const template = rng.weighted(pool, (t) => t.weight / 100);
    if (!template) break;
    // Drawn WITHOUT replacement. A hand of three identical recipes is three
    // copies of one card wearing different names, and the player would be
    // choosing between them on nothing at all. The market offers what it has;
    // when it has only one kind, the hand is short rather than padded.
    pool.splice(pool.indexOf(template), 1);
    cards.push(outsiderCard(ctx, template, rng, cards.length));
  }

  // One census for the hand, not one per card. Both passes mutate the cards
  // in place: what a card says and what a card costs are read off the world
  // after the deck is dealt, never rolled into it.
  const cen = lineCensus(ctx);
  for (const c of cards) {
    readLine(ctx, c, cen);
    readPanel(ctx, c, cen);
    const thread = externalThreadFor(ctx, c.house);
    if (thread) c.callback = thread.origin.detail;
    priceIn(ctx, c, subject);
  }

  return {
    subject: {
      id: subject.id,
      name: subject.name,
      sex: subject.sex,
      age: w.year - subject.born,
    },
    cards,
  };
}

function householdCard(ctx: SimCtx, subject: Person, who: Person, index: number): MatchCard {
  const w = ctx.world;
  const house = w.houses.get(who.houseOfOrigin);
  const hall = w.people.householdOf(who.id, w.year);
  return {
    id: `card_${index + 1}`,
    kind: 'household',
    name: who.name,
    sex: who.sex,
    age: w.year - who.born,
    house: who.houseOfOrigin,
    houseName: house?.name ?? who.houseOfOrigin,
    blurb: hall === w.playerHouse
      ? 'Already at this table, already fed by this house. Nothing leaves with her, '
        + 'and nothing new comes in.'
      : 'Known to the house, and near enough to be sent for.',
    dowry: 0,
    kinship: matchF(ctx, subject.id, who.id),
    line: 'unknown',
    lineSeen: 0,
    words: '',
    papersAsked: 0,
    papersShown: 0,
    panel: emptyPanel(),
    person: who.id,
    available: true,
  };
}

function outsiderCard(ctx: SimCtx, template: CharacterTemplate, rng: Rng, index: number): MatchCard {
  const w = ctx.world;
  const recipe = rollRecipe(template, ctx, rng);
  const house = w.houses.get(recipe.house);
  return {
    id: `card_${index + 1}`,
    kind: 'outsider',
    name: recipe.name,
    sex: recipe.sex,
    age: recipe.age,
    house: recipe.house,
    houseName: house?.name ?? recipe.house,
    blurb: template.blurb ?? template.title,
    dowry: DOWRY[template.frequency] ?? DOWRY.common!,
    // An outsider's claimed pedigree may still meet the family's somewhere —
    // which is what makes a rival house's daughter a different proposition
    // from a woman off a farm, on paper at least.
    kinship: 0,
    line: 'unknown',
    lineSeen: 0,
    words: '',
    papersAsked: 0,
    papersShown: 0,
    panel: emptyPanel(),
    recipe,
    available: true,
  };
}

/**
 * WHO CANNOT MARRY, AND WHY THE CARD SAYS SO (issue #83).
 *
 * INVARIANT: a card drawn `available` is a card `takeCard` will accept.
 *
 * `takeCard` has always tested both ends of the pairing and refused correctly.
 * Nothing tested them when the hand was DEALT, so a card whose bride had since
 * married somebody else was drawn as takeable, clicked, and refused — and the
 * client threw the reason away. Measured on seed 7 to 1400: fifteen hands
 * taken and sixteen refusals of cards drawn `available: true`. In five of
 * those hands EVERY card refused, because the subject herself had stopped
 * being eligible, and the only control on the panel that did anything was
 * *Take none of them*.
 *
 * §16's rule that an unavailable choice is itself information already covered
 * this. It had simply never been applied here.
 *
 * The window is real and cannot be closed by dealing more carefully: a hand is
 * parked on the docket and the rest of the year still runs (`step.ts` turns
 * every phase and only then reports the block), so `arcs`, `ambient` and the
 * frame can kill a promised bride between the deal and the answer. Answering
 * one hand can also spend the subject of another. So this is asked in three
 * places — at the deal, at the end of the year, and after every hand answered
 * — through one predicate rather than three spellings of it.
 */
function cardBlock(ctx: SimCtx, subject: Person, card: MatchCard): string | undefined {
  if (!eligibleToMarry(ctx, subject)) return `${subject.name} cannot marry`;
  if (card.kind !== 'household') return undefined;
  const who = ctx.world.people.get(card.person ?? '');
  if (!who) return `${card.name} is gone`;
  if (!eligibleToMarry(ctx, who)) return `${card.name} has been spoken for`;
  return undefined;
}

/**
 * Re-read a dealt hand against the world as it now is. Closes only — a card
 * shut on the purse in a poor year does not re-open because the house has
 * since been paid, since the terms were the terms when they were offered.
 *
 * Returns true where at least one card is still takeable. A hand where none
 * is is not a hand: it is the clock stopped to ask a question with one legal
 * answer, and the caller withdraws it.
 */
export function refreshHand(ctx: SimCtx, subjectId: string, cards: MatchCard[]): boolean {
  const subject = ctx.world.people.get(subjectId);
  for (const c of cards) {
    if (!c.available) continue;
    const block = subject ? cardBlock(ctx, subject, c) : 'the subject is gone';
    if (block) {
      c.available = false;
      c.blockedBy = block;
    }
  }
  return cards.some((c) => c.available);
}

/**
 * Everybody a dealt hand has promised, so `autoMarry` does not spend them.
 *
 * This is where the commonest half of #83 came from. The marriage phase put
 * the SUBJECT of each hand into its skip set and stopped there, so the cousin
 * on her card — eligible, in the hall, and not skipped by anything — was
 * married off by `autoMarry` in the same phase, five lines later. The player
 * then clicked a card promising a woman who had been somebody's wife since
 * before the panel was drawn.
 */
export function promisedBy(offer: MatchOffer): string[] {
  return offer.cards.flatMap((c) => (c.kind === 'household' && c.person ? [c.person] : []));
}

/** A card the house cannot pay for is still dealt. Being unable to afford it is information. */
/**
 * WHAT SHE COSTS, and why the answer is not always "take the best card".
 *
 * `match.ts` has always carried a comment saying "the treasury is the reason
 * the answer is not always take the best card". Measured, it was not true:
 * 362 of 480 cards in a run were priced at 20 crowns, 108 at nothing, and ten
 * cards in the whole thousand years reached the 50 and 120 tiers. Against a
 * treasury that runs to several thousand by 1400, every card was free, so
 * every hand was a stat comparison with no cost on either side of it.
 *
 * Three things move the number now, and each is something the market can
 * actually see:
 *
 *   THE BLOOD.   A house known to carry charges for it. This is the price of
 *                the only thing the player is really shopping for, and it is
 *                the one premium the market can charge honestly — nobody can
 *                read her genome, but everybody knows what her house is.
 *
 *   THE LINE.    A full line costs more than a thin one. It is the other half
 *                of what a dowry negotiation was ever about.
 *
 *   YOUR PURSE.  A rich house is charged like a rich house. This is not the
 *                market being fair; it is the market being a market, and it
 *                is the reason a treasury of six thousand crowns does not
 *                make the marriage question go away.
 *
 * A cousin still costs nothing (`householdCard`). That is the trade the whole
 * design turns on: the free card is the one that concentrates the blood, and
 * the concentrating card is the one that kills children in the womb.
 */
function priceIn(ctx: SimCtx, card: MatchCard, subject: Person): void {
  const w = ctx.world;
  if (card.dowry > 0) {
    const house = w.houses.get(card.house);
    const deep = house?.genePool?.fontCarrierRate ?? 0;
    // A house that carries at all is a different price. `house_marrow` sits at
    // 0.05 and is meant to be expensive; a quarry family at 0 is not.
    const blood = 1 + Math.min(3, deep * 40);
    const line = card.line === 'fertile' ? 1.5 : card.line === 'thin' ? 0.6 : 1;
    // The tier the card was dealt at, as a multiple of the commonest one.
    const tier = card.dowry / (DOWRY.common ?? 20);
    const worth = blood * line * tier;

    // A FLOOR IN CROWNS, AND AN ASK IN PROPORTION. The floor is §13's price
    // table and holds in 1042, when the house has two hundred crowns. The ask
    // is what a broker charges a house he can see the accounts of, and it is
    // what still holds in 1642 when the house has twenty thousand. A capped
    // multiplier does neither: it is too much money early and no money at all
    // late, which is how every card in the run came to cost twenty crowns.
    const floor = card.dowry * blood * line;
    const ask = Math.max(0, w.treasury) * Math.min(MAX_ASK_SHARE, ASK_PER_WORTH * worth);
    // THE ASSIZE'S FAVOUR (`assize.ts`). A house everybody can see is failing
    // is a house the market would rather have solvent than have to look at.
    const favour = assizeFavour(ctx, 'favour') ? FAVOURED_TERMS : 1;
    card.dowry = Math.round(Math.max(floor, ask) * favour);
  }

  // THE PAPERS, priced after the coin because the coin is what the other house
  // is asking against. §7: the documentation IS the dowry; the crowns are what
  // comes with it.
  const deep = w.houses.get(card.house)?.genePool?.fontCarrierRate ?? 0;
  card.papersAsked = papersDemanded(card.dowry, card.kinship, deep);
  card.papersShown = papersHeld(ctx, subject);

  card.words = marketWords(ctx, card);

  // ELIGIBILITY BEFORE COIN. Both ends of the pairing must still be able to
  // marry, and that close beats the purse and the papers: a bride who is
  // already married is not a card the house could take if only it were richer.
  const blocked = cardBlock(ctx, subject, card);
  if (blocked) {
    card.available = false;
    card.blockedBy = blocked;
    return;
  }

  const ceiling = w.treasury - DEBT_FLOOR;
  if (card.dowry > ceiling) {
    card.available = false;
    card.blockedBy = `the house cannot raise ${card.dowry} crowns`;
  } else if (card.papersShown < card.papersAsked) {
    // A card closed on the papers rather than the purse, and the difference
    // matters to the player: coin is a thing he can go and get, and a
    // grandmother is a thing he has to buy from a man at Bramme.
    card.available = false;
    card.blockedBy = `they want ${card.papersAsked} generations of maternal record and the house `
      + `can show ${card.papersShown}`;
  }
}

/**
 * What a card asks, as a share of the treasury, per point of what it is worth.
 * A plain woman off a farm asks about one percent. A daughter of a house known
 * to carry, out of a full line, asks a quarter of everything the house has —
 * and that is the sentence this whole system exists to make possible: *I want
 * that and I can't have both.*
 */
const ASK_PER_WORTH = 0.012;
const MAX_ASK_SHARE = 0.25;

/** What the market asks of a house it has decided to be fond of. */
const FAVOURED_TERMS = 0.55;

/**
 * THE MARKET HAS A VOCABULARY (§7), and it was never on the card.
 *
 * "Deep blood." "A thin line." "A bought grandmother." The concept is explicit
 * that these are never explained in text and are learned from use — which
 * requires that the player be able to read them somewhere. The card carried
 * `kinship`, `line` and `lineSeen` as raw numbers and no client could turn
 * them into the sentence a broker would actually say.
 *
 * Order matters: the first true thing is the thing a broker leads with.
 */
function marketWords(ctx: SimCtx, card: MatchCard): string {
  const w = ctx.world;
  const house = w.houses.get(card.house);
  const deep = house?.genePool?.fontCarrierRate ?? 0;

  const said: string[] = [];

  // FIRST COUSINS is 0.0625. Anything at or above it is what the Church has a
  // word for and the rival houses have a different one.
  if (card.kinship >= 0.125) said.push('the same blood twice over');
  else if (card.kinship >= 0.0625) said.push('close kin');
  else if (card.kinship > 0) said.push('kin, at a distance');

  if (deep >= 0.04) said.push('deep blood');
  else if (deep > 0) said.push('a drop of it, they say');

  if (card.line === 'fertile') said.push('a full line');
  else if (card.line === 'thin') said.push('a thin line');
  else if (card.line === 'ordinary') said.push('an ordinary line');
  else said.push('no line anybody here has watched');

  // What the read RESTS on. One completed life is a rumour with a number on
  // it, and the player should be told that before he bets a daughter on it.
  if (card.line !== 'unknown' && card.lineSeen === 1) said.push('on one woman only');

  // §7's third piece of market vocabulary, and the only one that was never
  // sayable: "a bought grandmother". Said of the card's own house when the
  // market has caught somebody there leaning on a pedigree that did not hold —
  // which is a thing the market only knows once a forgery has been exposed.
  // Never explained in text, learned from use, exactly as §7 asks.
  if (boughtGrandmother(ctx, card.house)) said.push('a bought grandmother');

  return said.join(' · ');
}

/**
 * Whether this house has been caught buying a pedigree.
 *
 * Read off the exposed documents of people BORN INTO that house, because what
 * the market remembers is the house's name and not the woman's. The player's
 * own house is included on purpose: a card can say it about you, and reading
 * your own house described that way in the market's words is the point of
 * having the market speak at all.
 */
function boughtGrandmother(ctx: SimCtx, house: string): boolean {
  for (const p of ctx.world.people.all()) {
    if (p.houseOfOrigin !== house) continue;
    if (p.lineageDocuments.some((d) => d.forged && d.exposed !== undefined)) return true;
  }
  return false;
}

export interface MatchResult {
  ok: boolean;
  reason?: string;
  spouse?: Person;
}

/**
 * Take the terms. The one place a card becomes a marriage.
 *
 * Everything about the pairing itself — who moves household, which hall, and
 * the Head never being the one who moves — belongs to `wed`, which `autoMarry`
 * uses too. There is one set of marriage rules in this codebase, and the draft
 * decides who marries whom rather than what marrying means.
 */
export function takeCard(ctx: SimCtx, subjectId: string, card: MatchCard): MatchResult {
  const w = ctx.world;
  const subject = w.people.get(subjectId);
  if (!subject) return { ok: false, reason: 'the subject is gone' };
  // The draft and the pairing have to agree about this exactly (issue #132,
  // Stage 2, the same failure the paragraph above already names once): a
  // priority hand that `matchSubjects` waived the age ceiling for and this
  // function did not is a card the marriage code refuses every time it is
  // taken, silently, which reads exactly like a working priority.
  const eligible = eligibleToMarry(ctx, subject)
    || (w.priorityMatch.includes(subject.id) && priorityEligibleToMarry(ctx, subject));
  if (!eligible) return { ok: false, reason: `${subject.name} cannot marry` };
  if (!card.available) return { ok: false, reason: card.blockedBy ?? 'that card is closed' };

  let spouse: Person | undefined;

  if (card.kind === 'household') {
    spouse = w.people.get(card.person ?? '');
    // Years can pass between a card being dealt and a card being taken only if
    // the docket is ignored, which it cannot be — but a candidate can still
    // have died in the same year's earlier phases, and a dead bride is not an
    // error, it is a card that closed.
    if (!spouse || !eligibleToMarry(ctx, spouse)) {
      return { ok: false, reason: 'that match is no longer possible' };
    }
  } else {
    if (!card.recipe) return { ok: false, reason: 'the card promises nobody' };
    const template = ctx.content.characterTemplates.find((t) => t.id === card.recipe!.template);
    if (!template) return { ok: false, reason: 'that recipe is no longer in the content' };
    const household = w.people.householdOf(subject.id, w.year) ?? w.playerHouse;
    spouse = mintRecipe(card.recipe, template, ctx, { household, membership: 'married_in' });
  }

  if (card.dowry) w.treasury -= card.dowry;
  wed(ctx, subject, spouse);
  return { ok: true, spouse };
}

/**
 * THE CHRONICLER'S HAND — and he is a steward before he is a matchmaker.
 *
 * Deterministic, derived from the decision's own id, so "let him decide"
 * answers the same way however long the player looked at the cards first.
 *
 * Cost is weighted rather than ignored, and that is not flavour. The first
 * cut picked uniformly among the open cards, which spent something on nearly
 * every marriage of the seat — one every four or five years for a thousand
 * years — and three of the harness's seeds finished pinned to the debt floor
 * with a house they could no longer staff. An auto-player who bankrupts the
 * house is not a neutral baseline; it is a worse player than any human would
 * be, and every balance number measured against it inherits that.
 *
 * So: what the house can comfortably afford is taken freely, what would hurt
 * is taken sometimes, and what it can barely reach is a long shot. A rich
 * house still buys deep blood. A poor one marries the cousin.
 */
export function autoTakeCard(
  cards: MatchCard[],
  seed: string,
  year: Year,
  treasury = 0,
  /**
   * THE SCION (issue #61, Stage A). His hand is not the house's own
   * instinct — it is the one marriage the house is actually building toward,
   * so the chronicler reaches for the blood already at the table far harder
   * than it otherwise would, still inside what the treasury can bear.
   */
  isScion = false,
): MatchCard | undefined {
  const open = cards.filter((c) => c.available);
  const rng = makeRng(hashSeed('the-match', seed, year));
  const affordable = Math.max(0, treasury);
  const weight = (c: MatchCard): number => {
    // The house's own instinct, and a deliberate continuity: the pairing this
    // replaced took someone already in the world whenever there was anyone,
    // so a chronicler who now preferred strangers would move every balance
    // number in the harness while looking like a neutral change. It is also
    // simply what this family is for.
    const kin = c.kind === 'household' ? (isScion ? 8 : 2) : 1;
    if (c.dowry <= 0) return kin;
    if (c.dowry <= affordable * 0.1) return kin;
    if (c.dowry <= affordable * 0.3) return kin * 0.4;
    return kin * 0.08;
  };
  return rng.weighted(open.length ? open : cards, weight);
}
