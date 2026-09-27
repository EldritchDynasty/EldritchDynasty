import type { Year } from '@ed/schema';
import { MAIN_BRANCH, assertNever } from '@ed/schema';
import type { SimCtx } from './world.js';
import type { Rng } from './rng.js';
import { hall, activeBranches } from './people/branches.js';
import { phenotypeOf } from './people/factory.js';
import { acquireLibraryCopy } from './people/library.js';
import { addGrudge } from './people/relationships.js';
import { namesakeBurden } from './people/naming.js';
import { campaignDef, campaignProgress } from './campaign.js';
import { chronicleEntryId } from './events/effects.js';


/**
 * THE ASSIZE — the world's opinion of how the house is doing, and what it does
 * about it.
 *
 * Measured across fourteen thousand-year runs, the shipped game could not be
 * lost and could not be won differently: zero houses died out, the household
 * never fell below ten people, every player-driven run finished with nine of
 * nine Ledger clauses, and standing landed on exalted or eminent nearly every
 * time. Five endings are authored (§23) and the simulation could not tell them
 * apart, because every run arrived at the same place.
 *
 * The cause is not any one number. It is that NOTHING IN THE WORLD REACTS TO
 * THE HOUSE. A family at eight hundred crowns and a family at twenty-two
 * thousand were living in the same indifferent country, so the run had no
 * feedback of either sign — no compounding failure to fear, and no resistance
 * to push against once things were going well.
 *
 * So the world watches, and it answers. Two arms, and both are visible:
 *
 *   THE WORLD RESENTS YOU.   A house that is plainly doing well is assessed,
 *                            courted away from, informed on, asked for a ward,
 *                            and charged more for everything. None of it is
 *                            fatal and all of it is annoying, which is exactly
 *                            what success is supposed to feel like from
 *                            underneath.
 *
 *   THE WORLD STEADIES YOU.  A house that is visibly failing is a problem for
 *                            everyone around it. The Church would rather feed
 *                            you than have a hall full of desperate people
 *                            eighteen miles from its chapter house. Charity is
 *                            not kindness here; it is somebody else's stability
 *                            being bought.
 *
 * WHY IT IS EXPLICIT. A hidden rubber band that quietly nudges the dice is a
 * lie the player can feel and cannot name, and it makes every good outcome
 * suspect. Every response here writes a line into the chronicle saying who did
 * what and why. The player is meant to read "House Marrow will not bid against
 * Calder while your name is on the lot" and understand that this is what being
 * ahead costs.
 *
 * WHAT IT IS NOT. It never touches the genetics, never touches Madness, never
 * makes Eldritch Power more reliable, and never reaches into an authored
 * outcome. It moves money, standing, loyalty, grievance and mortality — the
 * things a country can actually do to a family.
 */

/** How the world reads the house, on each axis it can actually see. */
export interface Fortune {
  /** Coin in hand, against what a house of this standing needs. */
  purse: number;
  /** Standing, as the world grades it. */
  standing: number;
  /** Living blood. A house is people before it is anything else. */
  blood: number;
  /** How far up the Ledger the house has got. */
  ledger: number;
  /** Whether anyone alive can express. The thing the whole run is for. */
  power: number;
  /** The combined read, 0 (ruined) to 1 (untouchable). */
  score: number;
}

const RESPECT_SCORE: Record<string, number> = {
  unknown: 0, known: 0.25, regarded: 0.5, eminent: 0.75, exalted: 1,
};

/** A comfortable seat, in crowns. Above this the purse stops being a worry. */
const COMFORTABLE = 1200;
/** A household this size is a house. Below it, it is a family in trouble. */
const HEALTHY_HALL = 14;

export function measureFortune(ctx: SimCtx): Fortune {
  const w = ctx.world;
  const seat = hall(w, MAIN_BRANCH, w.year);
  const household = w.people.household(w.playerHouse, w.year);

  const purse = clamp01(w.treasury / COMFORTABLE);
  const standing = RESPECT_SCORE[w.respect] ?? 0.25;
  // THE BLOOD TERM COUNTS THE BLOOD, which it did not: it counted the
  // HOUSEHOLD, and a household holds retainers, wives married in, wards and
  // servants whose posts are re-minted for a thousand years. Measured over
  // sixty runs the household's low-water mark was 9 and its median 10 — a
  // floor rather than a distribution — so this term could not fall far enough
  // to say "this family is ending" no matter what happened to the family.
  // A house down to two of its own with eight servants read as half healthy.
  const blood = clamp01(
    w.people.blood(w.playerHouse).filter((p) => p.status === 'alive').length / (HEALTHY_HALL * 2),
  );
  const ledger = ctx.content.clauses.length
    ? clamp01(w.clausesRecovered.size / ctx.content.clauses.length)
    : 0;
  const power = seat.some((p) => phenotypeOf(p, ctx.genetics, w.year).eldritch.canExpress) ? 1 : 0;

  // Weighted toward the things the world can SEE. Nobody outside the hall
  // knows how many clauses you have recovered; everybody knows whether you
  // paid the mason.
  const score = clamp01(
    purse * 0.3 + standing * 0.3 + blood * 0.2 + power * 0.12 + ledger * 0.08,
  );
  return { purse, standing, blood, ledger, power, score };
}

/**
 * How far ahead or behind the house is, in [-1, 1].
 *
 * Measured against a rising expectation rather than a constant, because a
 * house that is merely surviving at the opening is doing well and one merely
 * surviving at its campaign's term has wasted the whole bargain. The bar
 * climbs from a third to two thirds over THE ACTIVE CAMPAIGN, so Short and
 * Long read the same point in their own arcs the same way.
 *
 * #133's 500-year migration missed this once: dividing elapsed years by 1000
 * left a Long Line only halfway up the old expectation curve at collection.
 * That is relative pacing, not historical time, so it belongs to the campaign
 * clock just like the Age late-phase and friend windows.
 */
export function assizePressure(ctx: SimCtx): number {
  const w = ctx.world;
  const elapsed = campaignProgress(w.year, campaignDef(w.campaign));
  // AND HIGHER AGAIN FOR A MAN CARRYING A GREAT NAME (issue #62). A Head the
  // player deliberately named after a Head before him is measured against
  // that man. Zero unless a player actually chose the name — see
  // `headNamesake` — so nothing the chronicler drives is graded on it.
  const expected = 0.34 + 0.32 * elapsed + namesakeBurden(ctx);
  // Divided by a WIDE band. At a third of the scale the reading pinned at 1.00
  // for the top decile of every run measured, which throws away the difference
  // between "comfortable" and "untouchable" — and that difference is the whole
  // gradient an authored `assize` condition is meant to read.
  return clamp(-1, 1, (measureFortune(ctx).score - expected) / 0.45);
}

/**
 * WHEN THE WORLD ACTS, and why the two thresholds are not the same number.
 *
 * They started symmetrical at 0.55, and `assize.test.ts` caught what that
 * meant: a house at the debt floor, unknown, with ten people and one living
 * expresser reads -0.31 in 1042, because the expectation curve starts at 0.34
 * and a living house cannot score much lower than 0.19. The steadying arm
 * could therefore not fire at all in the first two centuries — the half of
 * this system that exists to catch a player who is drowning was unreachable
 * exactly when a player is most likely to drown.
 *
 * Asymmetric now, and truer for it: neighbours notice a starving house much
 * faster than they notice a quietly prosperous one.
 */
const RESENTS_AT = 0.45;
const STEADIES_AT = -0.26;
/** Years between anything the Assize does at all. It is a sitting, not weather. */
const ASSIZE_INTERVAL = 12;

export type AssizeArm = 'resents' | 'steadies';

export interface AssizeResponse {
  id: string;
  arm: AssizeArm;
  /** Years before this particular response may happen again. */
  cooldown: number;
  /** What it does, in the chronicle's own voice. `{house}` is the player's. */
  line: string;
  /** Whether the world is in a position to do this at all. */
  when?(ctx: SimCtx): boolean;
  apply(ctx: SimCtx, rng: Rng, page?: string): void;
}

/**
 * WHAT THE WORLD DOES. Eight ways of resenting you and seven of steadying you,
 * because a rubber band with two settings is a rubber band the player has read
 * by the fourth century.
 *
 * Every one of these is a thing a country does to a family. None of them is a
 * die roll wearing a costume.
 */
export const ASSIZE_RESPONSES: readonly AssizeResponse[] = [
  // ── The world resents you ───────────────────────────────────────────────
  {
    id: 'the_assessors_call',
    arm: 'resents',
    cooldown: 45,
    line: 'Assessors came, counted the roof and the glass and the horses, and '
      + 'assessed the house at a figure nobody argued with out loud.',
    apply(ctx) { take(ctx, 0.14); },
  },
  {
    id: 'the_price_of_your_name',
    arm: 'resents',
    cooldown: 40,
    line: 'Grain cost the house a half-mark more than it cost the village, and '
      + 'the factor was very sorry, and did not change the price.',
    apply(ctx) { take(ctx, 0.07); ctx.world.discontent = clamp(0, 100, ctx.world.discontent + 5); },
  },
  {
    id: 'the_rivals_combine',
    arm: 'resents',
    cooldown: 70,
    line: 'Word went round the auction rooms that no house would bid against '
      + 'another while the Eldritch name was on the lot. It was not written down.',
    apply(ctx) { exact(ctx, 60); },
  },
  {
    id: 'a_retainer_courted_away',
    arm: 'resents',
    cooldown: 35,
    when: (ctx) => Boolean(bestRetainer(ctx)),
    line: 'Somebody made the steward an offer in a room the house does not own, '
      + 'and he thought about it for a week before saying no.',
    apply(ctx, rng, page) {
      const p = bestRetainer(ctx);
      // Loyalty is what `tickSecrets` reads. A bought man is how a secret
      // leaves the house — the mechanism is already built, and nothing was
      // pressing on it.
      if (p?.contract) p.contract.loyalty = Math.max(0, p.contract.loyalty - 28);
      quarrel(ctx, rng, 22, 'heir_only', 'a_retainer_courted_away', page);
    },
  },
  {
    id: 'the_church_asks_after_the_book',
    arm: 'resents',
    cooldown: 55,
    line: 'A clerk of the Nine Quiet Names asked, very politely, to compare the '
      + "house's account of one year with three others he had already read.",
    apply(ctx) { ctx.world.discontent = clamp(0, 100, ctx.world.discontent + 9); },
  },
  {
    id: 'a_ward_is_requested',
    arm: 'resents',
    cooldown: 60,
    when: (ctx) => activeBranches(ctx.world).length > 0,
    line: 'A ward was requested of the house, in the way that a request is made '
      + 'when refusing it is the thing being measured.',
    apply(ctx, rng, page) {
      const b = rng.pick(activeBranches(ctx.world));
      if (b) b.grievance = clamp(0, 100, b.grievance + 9);
      quarrel(ctx, rng, 30, 'all_blood', 'a_ward_is_requested', page);
    },
  },
  {
    id: 'an_older_claim',
    arm: 'resents',
    cooldown: 80,
    when: (ctx) => rivalOf(ctx) !== undefined,
    line: 'A neighbouring house produced a document about a boundary, dated '
      + 'earlier than the house had understood any document could be dated.',
    apply(ctx, rng, page) {
      take(ctx, 0.09);
      ctx.world.discontent = clamp(0, 100, ctx.world.discontent + 7);
      // A BOUNDARY IS A FEUD. `relationships.ts` has carried a full grudge
      // system with an inheritance policy since it was written, and exactly
      // ONE authored outcome in a hundred and twenty-four templates ever
      // created a grudge — so the measured answer to "live grudges at 2042"
      // was zero, in every run, forever. The world now makes its own enemies.
      quarrel(ctx, rng, 45, 'house_wide', 'an_older_claim', page);
    },
  },
  {
    id: 'the_levy_falls_here',
    arm: 'resents',
    cooldown: 50,
    line: 'The levy was raised across the whole valley, and fell on the house at '
      + 'a rate the whole valley found reasonable.',
    apply(ctx) { take(ctx, 0.11); },
  },

  // ── The world steadies you ──────────────────────────────────────────────
  {
    id: 'the_church_opens_its_hand',
    arm: 'steadies',
    cooldown: 30,
    line: 'The chapter house sent grain and a cart, and did not call it charity, '
      + 'and did not need to.',
    apply(ctx) { give(ctx, 180); },
  },
  {
    id: 'the_tithe_forgiven',
    arm: 'steadies',
    cooldown: 40,
    when: (ctx) => activeBranches(ctx.world).length > 0,
    line: 'The branches were told to keep their tithe this year. Nobody pretended '
      + 'it was generosity; there was nothing at the seat to send it to.',
    apply(ctx) {
      for (const b of activeBranches(ctx.world)) b.grievance = clamp(0, 100, b.grievance - 14);
    },
  },
  {
    id: 'an_old_friend_remembers',
    arm: 'steadies',
    cooldown: 45,
    line: 'A debt the house had stopped writing down was repaid, in full, by a '
      + 'man whose father had borrowed it.',
    apply(ctx) { give(ctx, 260); },
  },
  {
    id: 'the_physician_stays',
    arm: 'steadies',
    cooldown: 60,
    line: 'The physician took a room at the house for the season and then did not '
      + 'leave, which is a thing physicians do where they are needed and paid late.',
    apply(ctx) { ctx.world.assize.mercy = ctx.world.year + 18; },
  },
  {
    id: 'a_cheap_hand',
    arm: 'steadies',
    cooldown: 35,
    line: 'The marriage market discovered that it had always been fond of the '
      + 'house, and that its terms had always been flexible.',
    apply(ctx) { ctx.world.assize.favour = ctx.world.year + 25; },
  },
  {
    id: 'a_book_at_the_gate',
    arm: 'steadies',
    cooldown: 90,
    when: (ctx) => unheldBook(ctx) !== undefined,
    line: 'A book was left at the gate, wrapped in oilcloth, with no name on it '
      + 'and no note inside it.',
    apply(ctx) {
      const id = unheldBook(ctx);
      if (id) acquireLibraryCopy(ctx, id);
    },
  },
  {
    id: 'kin_come_home',
    arm: 'steadies',
    cooldown: 50,
    when: (ctx) => activeBranches(ctx.world).length > 0,
    line: 'Cousins who had not written in forty years wrote, and then came, and '
      + 'were fed without anybody asking what they wanted.',
    apply(ctx) {
      for (const b of activeBranches(ctx.world)) b.grievance = clamp(0, 100, b.grievance - 8);
      give(ctx, 90);
    },
  },
];

export interface AssizeReport {
  pressure: number;
  acted?: AssizeResponse;
}

/**
 * One sitting. Called from the `assize` phase, which draws its own stream.
 *
 * Only one thing happens at a time and only every twelfth year, so the world's
 * attention is a scarce thing the player can feel arriving rather than a
 * constant hum. Whether the response helps or hurts is decided by the reading;
 * WHICH response is a draw from the ones the world is currently in a position
 * to make.
 */
export function tickAssize(ctx: SimCtx, rng: Rng): AssizeReport {
  const w = ctx.world;
  const pressure = assizePressure(ctx);
  w.assize.pressure = pressure;

  if (w.year - w.assize.lastSitting < ASSIZE_INTERVAL) return { pressure };

  const arm: AssizeArm | undefined = pressure >= RESENTS_AT ? 'resents'
    : pressure <= STEADIES_AT ? 'steadies'
      : undefined;
  if (!arm) return { pressure };
  const open = ASSIZE_RESPONSES.filter((r) => {
    if (r.arm !== arm) return false;
    const last = w.assize.fired[r.id];
    if (last !== undefined && w.year - last < r.cooldown) return false;
    return r.when ? r.when(ctx) : true;
  });
  if (!open.length) return { pressure };

  const chosen = rng.pick(open);
  if (!chosen) return { pressure };

  const entryId = chronicleEntryId(ctx);
  chosen.apply(ctx, rng, entryId);
  w.assize.lastSitting = w.year;
  w.assize.fired[chosen.id] = w.year;
  w.chronicle.push({
    id: entryId,
    year: w.year,
    weight: 'line',
    text: chosen.line,
    named: false,
  });
  return { pressure, acted: chosen };
}

/** Is a temporary favour of the Assize in force this year? */
export function assizeFavour(ctx: SimCtx, kind: 'favour' | 'mercy' | 'exaction'): boolean {
  const until = ctx.world.assize[kind];
  return until !== undefined && ctx.world.year <= until;
}

// ── The levers, and only these ────────────────────────────────────────────

/** A share of what is in hand. Never pushes a house below the debt floor. */
function take(ctx: SimCtx, share: number): void {
  const w = ctx.world;
  w.treasury -= Math.max(0, w.treasury) * share;
}

function give(ctx: SimCtx, crowns: number): void {
  ctx.world.treasury += crowns;
}

/** Everything costs more for a while. Read by `tickEconomy`. */
function exact(ctx: SimCtx, years: number): void {
  ctx.world.assize.exaction = ctx.world.year + years;
}

/**
 * A house that is not yours and is still standing. Whoever the world has just
 * acted through — the neighbour with the document, the man who made the
 * steward an offer.
 */
function rivalOf(ctx: SimCtx, rng?: Rng): string | undefined {
  const w = ctx.world;
  // WITH SOMEBODY IN IT. The first cut picked from `world.houses`, which is
  // the content's list of houses and not a list of people — most rival houses
  // have nobody minted and alive at any given moment, so `quarrel` returned
  // silently and the measured grudge count stayed at zero exactly as it had
  // been before. A house nobody belongs to cannot hold a grudge.
  const peopled = new Set(
    w.people.living().map((p) => p.houseOfOrigin).filter((h) => h !== w.playerHouse),
  );
  const rivals = [...peopled];
  if (!rivals.length) return undefined;
  return rng ? rng.pick(rivals) : rivals[0];
}

/**
 * Somebody of a rival house now has something against the head of this one,
 * and it is the kind of something that outlives him.
 *
 * Both ends are PEOPLE, because that is what `relationships.ts` holds and what
 * `successorTo` re-points when they die. A grudge against a house with nobody
 * in it is the one way a feud is allowed to end.
 */
function quarrel(
  ctx: SimCtx,
  rng: Rng,
  severity: number,
  inheritance: 'heir_only' | 'all_blood' | 'house_wide',
  origin: string,
  page?: string,
): void {
  const w = ctx.world;
  const house = rivalOf(ctx, rng);
  if (!house) return;

  const theirs = w.people.living().filter((p) => p.houseOfOrigin === house);
  const ours = hall(w, MAIN_BRANCH, w.year).find((p) => p.castSlots.includes('head'))
    ?? hall(w, MAIN_BRANCH, w.year)[0];
  if (!theirs.length || !ours) return;

  addGrudge(ctx, rng.pick(theirs)!.id, ours.id, { severity, inheritance }, origin, page);
}

function bestRetainer(ctx: SimCtx) {
  const w = ctx.world;
  return w.people
    .household(w.playerHouse, w.year)
    .filter((p) => p.contract && p.contract.loyalty > 30)
    .sort((a, b) => (b.contract?.loyalty ?? 0) - (a.contract?.loyalty ?? 0))[0];
}

/** A book the house does not have a copy of. Undefined when it has them all. */
function unheldBook(ctx: SimCtx): string | undefined {
  const held = ctx.world.library;
  const found = ctx.content.spellbooks.find((s) => !held.has(String(s.id)));
  return found ? String(found.id) : undefined;
}

function clamp(lo: number, hi: number, n: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function clamp01(n: number): number {
  return clamp(0, 1, n);
}

/**
 * Which arm a response belongs to, exhaustively. Exists so that adding a third
 * arm is a compile error at every site that reads one, rather than a band the
 * dispatcher silently never enters (invariant 5).
 */
export function armOf(r: AssizeResponse): 'resents' | 'steadies' {
  switch (r.arm) {
    case 'resents': return 'resents';
    case 'steadies': return 'steadies';
    default: return assertNever(r.arm);
  }
}
