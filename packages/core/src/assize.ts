import type { Person, Year } from '@ed/schema';
import { MAIN_BRANCH, assertNever, RESPECT_ORDER } from '@ed/schema';
import { DEBT_FLOOR } from './economy.js';
import { chronicleEntryId, type SimCtx } from './world.js';
import type { Rng } from './rng.js';
import { hall, activeBranches } from './people/branches.js';
import { phenotypeOf } from './people/factory.js';
import { acquireLibraryCopy } from './people/library.js';
import { addGrudge } from './people/relationships.js';
import { namesakeBurden } from './people/naming.js';
import { campaignDef, campaignProgress, FULL_CAMPAIGN_IDS } from './campaign.js';
import { msg } from './messages.js';


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
  /**
   * What it does, in the chronicle's own voice, in the reader's setting. One
   * literal key per response, so the wording has a stable identity of its own.
   */
  line(ctx: SimCtx): string;
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
    line: (ctx) => msg(ctx, 'assize.the_assessors_call',
      'Assessors came, counted the roof and the glass and the horses, and assessed the house at a figure nobody argued with out loud.'),
    apply(ctx) { take(ctx, 0.14); },
  },
  {
    id: 'the_price_of_your_name',
    arm: 'resents',
    cooldown: 40,
    line: (ctx) => msg(ctx, 'assize.the_price_of_your_name',
      'Grain cost the house a half-mark more than it cost the village, and the factor was very sorry, and did not change the price.'),
    apply(ctx) { take(ctx, 0.07); ctx.world.discontent = clamp(0, 100, ctx.world.discontent + 5); },
  },
  {
    id: 'the_rivals_combine',
    arm: 'resents',
    cooldown: 70,
    line: (ctx) => msg(ctx, 'assize.the_rivals_combine',
      'Word went round the auction rooms that no house would bid against another while the Eldritch name was on the lot. It was not written down.'),
    apply(ctx) { exact(ctx, 60); },
  },
  {
    id: 'a_retainer_courted_away',
    arm: 'resents',
    cooldown: 35,
    when: (ctx) => Boolean(bestRetainer(ctx)),
    line: (ctx) => msg(ctx, 'assize.a_retainer_courted_away',
      'Somebody made the steward an offer in a room the house does not own, and he thought about it for a week before saying no.'),
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
    line: (ctx) => msg(ctx, 'assize.the_church_asks_after_the_book',
      "A clerk of the Nine Quiet Names asked, very politely, to compare the house's account of one year with three others he had already read."),
    apply(ctx) { ctx.world.discontent = clamp(0, 100, ctx.world.discontent + 9); },
  },
  {
    id: 'a_ward_is_requested',
    arm: 'resents',
    cooldown: 60,
    when: (ctx) => activeBranches(ctx.world).length > 0,
    line: (ctx) => msg(ctx, 'assize.a_ward_is_requested',
      'A ward was requested of the house, in the way that a request is made when refusing it is the thing being measured.'),
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
    line: (ctx) => msg(ctx, 'assize.an_older_claim',
      'A neighbouring house produced a document about a boundary, dated earlier than the house had understood any document could be dated.'),
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
    line: (ctx) => msg(ctx, 'assize.the_levy_falls_here',
      'The levy was raised across the whole valley, and fell on the house at a rate the whole valley found reasonable.'),
    apply(ctx) { take(ctx, 0.11); },
  },

  // ── The world steadies you ──────────────────────────────────────────────
  {
    id: 'the_church_opens_its_hand',
    arm: 'steadies',
    cooldown: 30,
    line: (ctx) => msg(ctx, 'assize.the_church_opens_its_hand',
      'The chapter house sent grain and a cart, and did not call it charity, and did not need to.'),
    apply(ctx) { give(ctx, 180); },
  },
  {
    id: 'the_tithe_forgiven',
    arm: 'steadies',
    cooldown: 40,
    when: (ctx) => activeBranches(ctx.world).length > 0,
    line: (ctx) => msg(ctx, 'assize.the_tithe_forgiven',
      'The branches were told to keep their tithe this year. Nobody pretended it was generosity; there was nothing at the seat to send it to.'),
    apply(ctx) {
      for (const b of activeBranches(ctx.world)) b.grievance = clamp(0, 100, b.grievance - 14);
    },
  },
  {
    id: 'an_old_friend_remembers',
    arm: 'steadies',
    cooldown: 45,
    line: (ctx) => msg(ctx, 'assize.an_old_friend_remembers',
      'A debt the house had stopped writing down was repaid, in full, by a man whose father had borrowed it.'),
    apply(ctx) { give(ctx, 260); },
  },
  {
    id: 'the_physician_stays',
    arm: 'steadies',
    cooldown: 60,
    line: (ctx) => msg(ctx, 'assize.the_physician_stays',
      'The physician took a room at the house for the season and then did not leave, which is a thing physicians do where they are needed and paid late.'),
    apply(ctx) { ctx.world.assize.mercy = ctx.world.year + 18; },
  },
  {
    id: 'a_cheap_hand',
    arm: 'steadies',
    cooldown: 35,
    line: (ctx) => msg(ctx, 'assize.a_cheap_hand',
      'The marriage market discovered that it had always been fond of the house, and that its terms had always been flexible.'),
    apply(ctx) { ctx.world.assize.favour = ctx.world.year + 25; },
  },
  {
    id: 'a_book_at_the_gate',
    arm: 'steadies',
    cooldown: 90,
    when: (ctx) => unheldBook(ctx) !== undefined,
    line: (ctx) => msg(ctx, 'assize.a_book_at_the_gate',
      'A book was left at the gate, wrapped in oilcloth, with no name on it and no note inside it.'),
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
    line: (ctx) => msg(ctx, 'assize.kin_come_home',
      'Cousins who had not written in forty years wrote, and then came, and were fed without anybody asking what they wanted.'),
    apply(ctx) {
      for (const b of activeBranches(ctx.world)) b.grievance = clamp(0, 100, b.grievance - 8);
      give(ctx, 90);
    },
  },
];

export interface AssizeReport {
  pressure: number;
  acted?: AssizeResponse;
  /** The collateral was kept this year (#1993). Separate from the sitting. */
  kept?: true;
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
  hearCovertTestimony(ctx);
  // Before the reading, so the world sees the house with the bill paid.
  const done: { kept?: true } = keepTheCollateral(ctx) ? { kept: true } : {};
  const pressure = assizePressure(ctx);
  w.assize.pressure = pressure;

  if (w.year - w.assize.lastSitting < ASSIZE_INTERVAL) return { pressure, ...done };

  const arm: AssizeArm | undefined = pressure >= RESENTS_AT ? 'resents'
    : pressure <= STEADIES_AT ? 'steadies'
      : undefined;
  if (!arm) return { pressure, ...done };
  const open = ASSIZE_RESPONSES.filter((r) => {
    if (r.arm !== arm) return false;
    const last = w.assize.fired[r.id];
    if (last !== undefined && w.year - last < r.cooldown) return false;
    return r.when ? r.when(ctx) : true;
  });
  if (!open.length) return { pressure, ...done };

  const chosen = rng.pick(open);
  if (!chosen) return { pressure, ...done };

  const entryId = chronicleEntryId(ctx);
  chosen.apply(ctx, rng, entryId);
  w.assize.lastSitting = w.year;
  w.assize.fired[chosen.id] = w.year;
  w.chronicle.push({
    id: entryId,
    year: w.year,
    weight: 'line',
    text: chosen.line(ctx),
    named: false,
  });
  return { pressure, ...done, acted: chosen };
}

/** Criminal consequences belong to the assize and a named copied statement,
 * never to the operation resolver's knowledge of the true private sponsor. */
function hearCovertTestimony(ctx: SimCtx): void {
  const w = ctx.world;
  for (const o of w.covert.operations) {
    const proof = o.exposure;
    if (!proof || proof.heardAt !== undefined || proof.year >= w.year) continue;
    const witness = w.people.get(proof.actor);
    const operative = w.people.get(o.plan.operative);
    if (!witness || !operative) continue;
    const assessed = o.result === 'success' ? 60 : 30;
    const paid = Math.min(assessed, Math.max(0, w.treasury - DEBT_FLOOR));
    w.treasury -= paid;
    const tier = RESPECT_ORDER.indexOf(w.respect);
    w.respect = RESPECT_ORDER[Math.max(0, tier - 1)]!;
    proof.heardAt = w.year;
    proof.receipt = msg(ctx, 'assize.covert_testimony',
      'The Warden’s assessor read {WITNESS}’s copied testimony naming {PERSON}. The assize took {PRICE} crowns from the house that sheltered that participant. The heralds entered the case against the house’s name. The statement did not establish an unseen patron’s orders.',
      { WITNESS: witness.name, PERSON: operative.name, PRICE: String(paid) });
    w.chronicle.push({ id: chronicleEntryId(ctx), year: w.year, weight: 'paragraph', named: true,
      people: [witness.id, operative.id], text: proof.receipt });
  }
}

/** Is a temporary favour of the Assize in force this year? */
export function assizeFavour(ctx: SimCtx, kind: 'favour' | 'mercy' | 'exaction'): boolean {
  const until = ctx.world.assize[kind];
  return until !== undefined && ctx.world.year <= until;
}

// ── The collateral kept ───────────────────────────────────────────────────

/**
 * THE COLLATERAL KEPT (#1993, the owner's option (a)).
 *
 * The measurement first. On an independent predeclared sample of four
 * hundred Short Lines under the chronicler, 6.0% [4.1, 8.8] of all runs broke
 * before the first interlude, even after `the_last_of_the_line` was gated to
 * fire only at one living blood (#2042). Those players never meet the frame,
 * the Ledger or the reading. Almost all of those breaks were Plague collapses.
 * The Age's mortality multiplier compounded with `thinBloodMortality` and took
 * a line from five to nothing in a year or two, often before any docket could
 * open. `docs/BALANCE-LOG.md` has the tables.
 *
 * So once in a run, before any interlude, the world acts for the party that
 * needs the blood alive at the term. The creditor itself never appears (§18:
 * on screen twice in five centuries). Its agents are ordinary people doing
 * ordinary paid work. A physician from Bramme arrives whom nobody sent for.
 * The weighers' counting house at Cawdry pays him from an account opened in
 * the year of the signing, and then bills the house. The page names both
 * actors, and names the creditor the only way this world does: by the
 * account's date and a name the clerk will not say aloud. A rescue the
 * player cannot see is a lie the player can feel (invariant 13).
 *
 * What it moves is MORTALITY, and only the blood's. Until the house has heard
 * its first interlude, and never for less than `KEEP_YEARS`, the house's own
 * blood is off the thin-line amplifier and outside the Ages' mortality
 * multipliers. The physician's `mercy` holds for `KEEP_YEARS`. This is the shape
 * the Demigod path in `rollDeath` already uses. Violence, Madness overflow and
 * the max-age wall still apply. Genetics and authored outcomes are untouched.
 * Every death still goes through `kill()`.
 *
 * WHAT IT COSTS is a debt in the terms the house already has: `COLLATERAL_BILL`
 * crowns off the treasury. A house that cannot meet it goes under
 * `DEBT_FLOOR`, and `tickEconomy`'s ordinary broke-house slip turns the
 * shortfall into standing that same year.
 *
 * WHY NO NEW STATE. "Once in a run" is the firing year in the existing
 * `world.assize.fired` map, and the window is derived from that year. So a
 * save taken mid-window resumes mid-window, and nothing joins the save format.
 * The check draws no dice, so a run where it never fires plays exactly as it
 * did before.
 *
 * WHY UNTIL THE FIRST INTERLUDE. A fixed thirty-year window missed the owner's
 * target on two fresh samples (3.3% and 2.8% of Short Lines still broke
 * before the frame). Twelve of the thirteen remaining early breaks were kept
 * lines that outlived the window while their first interlude was still late.
 * Holding until the frame speaks measured 1.5% on a fresh sample and left
 * `gate:endings` in band. The owner adopted it (#1993). The frame's own
 * `FRAME_MAX_GAP_YEARS` ceiling bounds how long that can be.
 *
 * `broken_line` stays reachable. The keeping happens once. It ends once the
 * first interlude has been delivered and `KEEP_YEARS` have passed. It cannot
 * reach a house that has already met the frame, or a house with nobody of the
 * blood left. Total breaks barely move; most kept lines that were going to
 * break still break, after the player has met the frame.
 */
export const COLLATERAL_KEPT = 'the_collateral_kept';
/** The most living blood at which the keeping can be triggered. */
export const KEEP_AT = 3;
/**
 * WHEN A SMALL LINE IS FAILING, AND NOT JUST YOUNG. A founding house of three
 * is small by construction. Without this test the keeping fired in the first
 * five years of many runs, and it was spent before the Plague reached a grown
 * house. So a line counts as failing in two cases. It once stood at
 * `KEEP_FROM` or more and has fallen to the last few. Or it has outlived its
 * founding generation, `FOUNDING_YEARS`, and is still down to the last few.
 */
export const KEEP_FROM = 6;
export const FOUNDING_YEARS = 25;
/** The fewest mortality passes after the firing year that the blood is kept. */
export const KEEP_YEARS = 30;
/** The weighers' bill, in crowns. Two years' income at Regarded. */
export const COLLATERAL_BILL = 120;

/** The player house's blood, alive. The same count `livingBlood` reads. */
function aliveBlood(ctx: SimCtx) {
  const w = ctx.world;
  return w.people.blood(w.playerHouse).filter((p) => p.status === 'alive');
}

/**
 * Is the keeping in force this year? It runs from the year after it fired,
 * until the first interlude has been delivered and at least `KEEP_YEARS`
 * mortality passes have been kept.
 */
export function collateralKept(ctx: SimCtx): boolean {
  const w = ctx.world;
  const at = w.assize.fired[COLLATERAL_KEPT];
  if (at === undefined || w.year <= at) return false;
  return w.year <= at + KEEP_YEARS || w.frame.entries.length === 0;
}

/** Is this person one of the blood the keeping covers, this year? */
export function collateralKeeps(ctx: SimCtx, p: Person): boolean {
  const w = ctx.world;
  return p.membership.some((m) => m.house === w.playerHouse && m.kind === 'blood') && collateralKept(ctx);
}

/**
 * Whether the keeping may fire this year. Exported so a test can name each
 * condition that refuses it.
 */
export function collateralDue(ctx: SimCtx): boolean {
  const w = ctx.world;
  if (w.ending) return false;
  if (!FULL_CAMPAIGN_IDS.some((id) => id === w.campaign)) return false;
  if (w.frame.entries.length > 0) return false;
  if (w.assize.fired[COLLATERAL_KEPT] !== undefined) return false;
  const founding = w.year - campaignDef(w.campaign).startYear < FOUNDING_YEARS;
  if (founding && w.bloodHighWater < KEEP_FROM) return false;
  const blood = aliveBlood(ctx).length;
  return blood > 0 && blood <= KEEP_AT;
}

/**
 * Fire the keeping if it is due. It draws no dice, so the Assize's own stream
 * is the same whether this happens or not. Returns whether it fired.
 */
export function keepTheCollateral(ctx: SimCtx): boolean {
  if (!collateralDue(ctx)) return false;
  const w = ctx.world;
  const blood = aliveBlood(ctx);
  // The youngest of the blood is the one the house's future is riding on.
  // Ties go to the earlier id, so the page is the same on every replay.
  const kept = [...blood].sort((a, b) => b.born - a.born || a.id.localeCompare(b.id))[0]!;
  w.assize.fired[COLLATERAL_KEPT] = w.year;
  w.assize.mercy = Math.max(w.assize.mercy ?? w.year, w.year + KEEP_YEARS);
  w.treasury -= COLLATERAL_BILL;
  w.chronicle.push({
    id: chronicleEntryId(ctx),
    year: w.year,
    weight: 'paragraph',
    named: true,
    people: blood.map((p) => p.id),
    text: msg(ctx, 'assize.the_collateral_kept',
      'A physician nobody in the house had sent for rode up from Bramme. His fee was already paid, by letter of exchange on the weighers’ counting house at Cawdry, from an account opened in the year of the signing. He took the room next to {PERSON}’s, kept the doors shut and the well covered, and the sickness in the valley stopped at the gate. In spring the weighers wrote for {PRICE} crowns, with the interest reckoned to the day. Their clerk would not say the name on the account aloud.',
      { PERSON: kept.name, PRICE: String(COLLATERAL_BILL) }),
  });
  return true;
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
