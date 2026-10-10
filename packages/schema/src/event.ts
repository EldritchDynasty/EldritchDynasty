import { z } from 'zod';
import { ConditionS, CompareOpS, DiscrepancyStateS, FilterS } from './conditions.js';
import { FrequencyS } from './frequency.js';
import { ClaimS } from './claim.js';
import { TargetS } from './target.js';
import { ScheduleS } from './arc.js';
import { DeciderS } from './decider.js';
import { RiteS } from './rung.js';
import { GrudgeInheritanceS } from './house.js';

/**
 * The purposes vocabulary is a CLOSED set and every template declares exactly
 * three. A longer list would let an author justify anything, which defeats the
 * point of having the rule.
 */
export const PurposeS = z.enum([
  'advance_clause',
  'change_relationship',
  'worldbuild_through_action',
  'establish_magic_rule',
  'test_magic_rule',
  'change_standing',
  'plant_rumour',
  'force_record_choice',
  'buy_patience',
]);
export type Purpose = z.infer<typeof PurposeS>;

export const EventTierS = z.enum(['individual', 'head', 'family', 'record', 'frame']);
export type EventTier = z.infer<typeof EventTierS>;

export const SlotRoleS = z.enum([
  'head', 'family_member', 'spouse', 'child', 'sibling', 'cadet', 'unwoken',
  'retainer', 'rival_house', 'outsider', 'heirloom', 'spellbook',
  'tutor', 'rival', 'fragile', 'the_match',
  'listener_record', 'listener_blood',
  /** The Narrator, after he crosses over. Castable in any year, forever. */
  'guardian',
  /**
   * The one man of the house standing highest on the ladder (§22, issue #41).
   *
   * Every other role names a POSITION — the seat, a hall, a marriage — and the
   * ladder is not a position. It is climbed by whoever the blood happened to
   * land in, and measured over sixteen played runs that man was living and
   * dying in a cadet hall while every authored cost in the game was addressed
   * to HEAD, BEARER, CHILD or SECOND. So the man who was climbing was never
   * asked for anything, arrived at the Hierophant gate with Madness 0, and
   * stopped there: *nothing has been asked of him that cost anything*.
   *
   * The pool is at most one person, and everyone in it can express — so an
   * outcome may deal Madness to it without a filter saying so (invariant 1,
   * and `madness/gate` knows this role by name).
   */
  'foremost',
  /**
   * THE SECOND MAN ON THE LADDER (§22's terminal irony, issue #61, Stage E5).
   *
   * The same reading as `foremost`, one place down: the house's
   * second-highest-ranked expresser, excluding the foremost himself. Empty
   * whenever the house has fewer than two living expressers, which is most
   * years of most runs — an ordinary empty pool, like any other optional
   * slot's.
   *
   * **Why the role exists at all.** God (§22, rung six) asks for a living
   * Demigod standing beside the man who ascends, which is two men at rung
   * five at once. The only thing in the engine that raises a living man's
   * power is a rite (`events/rites.ts`), and every rite template in the game
   * cast its ascendant as `foremost` — a pool of exactly one. So the second
   * man could never be offered a rite under any content, any table order or
   * any policy: measured across 873 samples he never came within seven
   * points of Demigod power, and the reason was not bias or rationing but
   * that no slot in the vocabulary could name him. Stage E4 built the Heir
   * — books, tutor time, marriage, career exemption — and moved the number
   * by nothing, because none of those touch power either.
   *
   * **Derived, recomputed, stored nowhere** (invariant 6), and deliberately
   * NOT `world.scionHeir`. The ladder is a measurement (invariant 14); a
   * role that read the table order would be dead content in every house
   * that never issued one, and would stop being canExpress-gated by its
   * pool. Naming a heir still feeds this role — it concentrates the books
   * and the marriages that raise his standing — it just does not define it.
   *
   * Like `foremost`, everyone in the pool can express, so an outcome may
   * deal Madness or a rite to it without a filter saying so (invariant 1;
   * `madness/gate`, `rites/shape` and `careers/gate` all know this role by
   * name for that reason).
   */
  'second_foremost',
  // ── The steward's own year (issue #127) ────────────────────────────────
  /**
   * WHOEVER THE STEWARD ACTUALLY PLACED THIS YEAR — `world.stewardYear`,
   * written once by the `table` phase and read here in the same year.
   * `runStandingOrders` always knew who it placed; nothing before this could
   * ask, so `the_commission_bought` cast any adult family member and named a
   * placement scene about a man who, four times in five, held no post.
   */
  'newly_placed',
  /** Whoever finished a tutor's term this year — see `newly_placed`. */
  'newly_taught',
  /** Whoever the steward set to a book this year — see `newly_placed`. */
  'set_to_a_book',
  // ── The founding bottleneck's Stage 2 (issue #132) ─────────────────────
  /**
   * Blood, alive, unmarried, of age to marry — exactly `eligibleToMarry`'s
   * own reading, cast so the crisis scene can name the one person a fresh
   * match would actually help. The pool exists whenever such a person does;
   * the event's own `conditions` (`bloodCount`) is what makes it a crisis
   * rather than an ordinary unmarried heir.
   */
  'sole_heir_unwed',
  /**
   * Blood, alive, married to a LIVING spouse the couple's own childbearing
   * mother (herself, or her husband's wife) is already past or has not yet
   * reached — the union `descentKind` guarantees produced no living blood
   * child yet, wherever `bloodCount` is measured. This is the "no path to
   * another" case #132 names: nothing short of ending the marriage opens
   * one, because the game has no gestational tracking to wait out and no
   * divorce short of the Church's own jurisdiction over "marriage and
   * legitimacy" (`Background/eldritch-dynasty-world.md` §9).
   */
  'sole_heir_spent',
]);
export type SlotRole = z.infer<typeof SlotRoleS>;

/**
 * THE ROLES THAT NAME A MAN ON THE LADDER, and the one list of them.
 *
 * Both draw their pool from the house's ranked EXPRESSERS and nobody else
 * (`ascension.ts`'s `rankedExpressers`), which is what gives every reader
 * below the same two guarantees: the pool is the `canExpress` gate
 * (invariant 1), so an outcome may deal Madness, a rite or a career there
 * without a filter restating the role; and a scene cast on one of them is a
 * bargain ABOUT the ladder rather than an ordinary event that happens to
 * hurt somebody.
 *
 * Exported because four separate readers need it — `rules.ts`'s
 * `madness/gate`, its rite shape rule and `careers/gate`, and
 * `core/tools/ladder-policy.ts`'s `costsTheClimber`, which decides which
 * branches the gate's climbing columns take. Three of those four kept their
 * own hand-written `role === 'foremost'`, which is a copy of a closed list
 * and went stale the moment `second_foremost` was added (issue #61, Stage
 * E5): the gate quietly stopped recognising the second man's rite as a
 * ladder bargain at all, so no column ever deliberately took it.
 */
export const LADDER_ROLES: readonly SlotRole[] = ['foremost', 'second_foremost'];

/** Does this slot draw from the ladder's expresser pool? See `LADDER_ROLES`. */
export function isLadderRole(role: string | undefined): boolean {
  return LADDER_ROLES.includes(role as SlotRole);
}

/**
 * Bindings outlive people. In a game whose time unit is a generation, an arc
 * finding its cast dead is the NORMAL case. `inherit` is the policy that earns
 * its keep: a rival dies mid-feud and his son takes it up, and the grudge, the
 * arc and the binding all move down a generation together.
 */
export const MissingPolicyS = z.union([
  z.literal('cancel_arc'),
  z.literal('recast'),
  z.literal('continue_absent'),
  z.object({ inherit: z.enum(['heir', 'eldest_child', 'closest_blood', 'house_successor']) }),
]);
export type MissingPolicy = z.infer<typeof MissingPolicyS>;

export const SlotSpecS = z.object({
  role: SlotRoleS,
  /** The single most important field in the event model. */
  castBy: z.enum(['engine', 'player']).default('engine'),
  /**
   * HOW MANY PEOPLE STAND HERE. Absent means one, which is nearly every slot.
   *
   * A counted slot casts between `min` and `max` distinct people and holds
   * them as a list — the size is rolled before the pool is consulted, so a
   * house with nine eligible sons and a house with two send parties of the
   * same shape. Short of `min` the event does not fire at all, which is what
   * makes it a levy rather than "whoever happens to be about".
   *
   * A party is only ever referenced AS a party: `{ all: SLOT }` in a target,
   * `party_sum` in a check pool, one `{TOKEN}` that renders "Aldous, Bren and
   * Corr". `slots/counted` rejects every singular reference, because taking
   * the first of five reads exactly like a working effect and is four men
   * short. `min` of 0 is not the way to say "or nobody" — `optional` is.
   */
  count: z.object({ min: z.number().int(), max: z.number().int() }).optional(),
  optional: z.boolean().default(false),
  filters: z.array(FilterS).default([]),
  /** 'arc' = the same person for the whole substory. */
  bind: z.enum(['event', 'arc']).default('event'),
  onMissing: MissingPolicyS.optional(),
  /**
   * Show what is observed of each candidate's line — her mother and sisters,
   * named, with what the record credits to them (issue #28 item 2, the same
   * epistemics the matchmaker's panel uses, issue #68). Never a fecundity
   * number, a locus or a probability — only completed, married childbearing
   * lives the world has actually watched. Only meaningful on a `castBy:
   * player` slot; an engine-cast slot computes it and nobody reads it.
   * Optional like `count`/`onMissing`, not defaulted like `optional`/`bind` —
   * this is rare authored metadata, not a shape every slot has an opinion on.
   */
  showLine: z.boolean().optional(),
});
export type SlotSpec = z.infer<typeof SlotSpecS>;

// ── Effects: enumerated, never free-form script ───────────────────────────
export const EffectS = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('attribute'), target: TargetS, attr: z.string(), delta: z.number() }),
  z.object({ kind: z.literal('trait'), target: TargetS, trait: z.string(), op: z.enum(['add', 'remove']) }),
  z.object({ kind: z.literal('status'), target: TargetS, status: z.string(), cause: z.string().optional() }),
  /** Guarded: applying this where canExpress is false is a validation error. */
  z.object({ kind: z.literal('madness'), target: TargetS, delta: z.number() }),
  /**
   * A ritual that provokes Awakening early (concept §11). This is a state
   * transition, not prose: runtime refuses a target carrying no Eldritch font,
   * and the transition records forced=true without altering expression.
   */
  z.object({ kind: z.literal('awakening'), target: TargetS }),
  z.object({
    kind: z.literal('heirloom'),
    op: z.enum(['grant', 'use', 'transfer']).default('grant'),
    heirloom: z.string(),
    /** `use`: the slot holding the bearer. `transfer`: who receives it. */
    to: z.string().optional(),
  }),
  /**
   * `gain` is instantaneous — the knowledge is simply theirs. `study` is the
   * same arrival with the years in front of it: the reader takes the book up
   * now and knows it in `studyYears` (scaled by their career's `studySpeed`,
   * which is the Scholar's whole perk), and `world.studies` carries the wait.
   *
   * Both exist because both are wanted. A rite that hands somebody a working
   * in a night is a `gain`; a man sitting down with a book is a `study`, and
   * the difference between them is most of what a Library is for.
   */
  z.object({ kind: z.literal('spellbook'), op: z.enum(['gain', 'study', 'lose', 'degrade']), target: TargetS, book: z.string() }),
  /**
   * Writes `Person.career`. `leave` clears the post without naming one (the
   * `career` field is ignored); `assign` requires it. Income, Respect accrual
   * and the breeding-pool/mortality costs all read `Person.career` from
   * outside this effect — see `core/src/people/careers.ts`.
   */
  z.object({ kind: z.literal('career'), target: TargetS, op: z.enum(['assign', 'leave']).default('assign'), career: z.string().optional() }),
  /**
   * THE BOND (world §12, `core/src/people/bond.ts`).
   *
   * *"Nobody in this world is a slave and there is no serfdom in Aubren.
   * People are held by debt, custom, contract and having nowhere else to go."*
   * `bind` advances `marks` against a servant's years; `free` tears the debt
   * up. Only meaningful on somebody already in the house's service — a bond is
   * a term of a contract, not a thing that can be done to a stranger.
   *
   * `marks` is ignored by `free` and defaulted so an author writing the mercy
   * does not have to name a sum to forgive.
   */
  z.object({
    kind: z.literal('bond'),
    target: TargetS,
    op: z.enum(['bind', 'free']),
    marks: z.number().int().positive().default(100),
  }),
  /**
   * ENDS AN OPEN MARRIAGE, ON BOTH SIDES (issue #132, Stage 2).
   *
   * The only content-authored way a marriage closes short of a death —
   * everywhere else, `PersonStore.closeMarriage` fires from `kill()`. A
   * no-op if the target has no open marriage, which lets an author cast
   * broadly without a filter narrowing to "currently married" first.
   *
   * There is no `begin`. Marriage is MADE by `wed()` (`people/demography.ts`)
   * through the draft (`people/match.ts`) or `autoMarry` — the papers, the
   * dowry, the oath before a keeper (world §13) are not a thing an outcome's
   * three lines can stand in for. `end` alone is enough: it is what turns a
   * spent union into an empty slot the SAME machinery can fill.
   */
  z.object({ kind: z.literal('marriage'), op: z.literal('end'), target: TargetS }),
  /**
   * THE HOUSE GOES TO MARKET FOR THIS PERSON NEXT (issue #132, Stage 2).
   *
   * Adds the target to `world.priorityMatch` — read by `matchSubjects`
   * (`people/match.ts`), which lets a flagged person skip both cooldowns and
   * out-weighs everyone else for the season's one hand, so "the last of a
   * line gets no priority in the Match" stops being true the moment the
   * player asks for it. Cleared the day a hand is actually dealt, whether
   * taken or not — the same shape `WorldState.courted` already has, so a
   * decline does not loop the priority forever.
   */
  z.object({ kind: z.literal('priorityMatch'), target: TargetS }),
  z.object({ kind: z.literal('treasury'), delta: z.number() }),
  z.object({ kind: z.literal('respect'), delta: z.number() }),
  z.object({ kind: z.literal('flag'), flag: z.string(), set: z.union([z.boolean(), z.number(), z.string()]) }),
  z.object({ kind: z.literal('relationship'), from: TargetS, to: TargetS, sentiment: z.number().optional(), grudge: z.object({ severity: z.number(), inheritance: GrudgeInheritanceS }).optional() }),
  z.object({ kind: z.literal('chronicle'), text: z.string() }),
  z.object({ kind: z.literal('knowledge'), op: z.enum(['grant', 'revoke']), flag: z.string() }),
  /**
   * A LIE, MADE OR ANSWERED (§6, issue #71).
   *
   * `id` is OPTIONAL for `prove` and `bury`, and required for `create` —
   * enforced by `discrepancy/wiring`, because a discriminated union cannot say
   * "this field depends on that one" without splitting the variant in three.
   *
   * Without an id, a bury reaches an open lie the house ACTUALLY HAS. That is
   * not a convenience: 23 sites create a named Discrepancy, and every Record
   * block the player embellishes creates one of its own — which is where the
   * standing lies in a real run come from, and no scene naming a literal id
   * can ever touch them. A bury lane that could only clear content's own
   * twenty-three would leave §29.3's bill unanswerable in practice, and rule 5
   * says reversible by act.
   *
   * `provableBy` narrows which lie, so the Church scene buries a thing the
   * Church could have proved and the archivist buries a thing in the archive.
   */
  z.object({ kind: z.literal('discrepancy'), op: z.enum(['create', 'prove', 'bury']), id: z.string().optional(), severity: z.enum(['minor', 'major', 'total']).optional(), provableBy: z.array(z.string()).optional() }),
  z.object({ kind: z.literal('rumour'), op: z.enum(['seed', 'feed', 'correct']), id: z.string(), accuracy: z.number().optional() }),
  z.object({ kind: z.literal('clause'), reveal: z.string() }),
  /**
   * The cadet halls (concept §16). Without this the branches accrue grievance
   * on their own and no authored scene can ever answer it — a system the
   * player can watch and cannot touch. `slot` names the branch by one of its
   * people; with none, it means whichever hall is angriest.
   */
  z.object({ kind: z.literal('branch'), op: z.enum(['appease', 'slight']), slot: z.string().optional(), amount: z.number().default(10) }),
  z.object({ kind: z.literal('recast'), slot: z.string() }),
  /**
   * A RITE OF THE LADDER (concept §22, issue #43).
   *
   * The one effect that names two people and does something between them,
   * because that is what a rite is. `the_vessel_rite` was authored as a
   * `status` effect and a flat `madness` delta, which said the right things in
   * prose and moved none of the quantities §22 puts on this rung: nobody's
   * attributes moved, the Vessel's own Madness went nowhere, and the man was
   * left exactly as far from the rung as he had been before he consumed a
   * relative for it.
   *
   * What each rite does is in `core/src/events/rites.ts` and is not authorable
   * — an author chooses WHETHER the house is asked, on what terms, and what
   * the record says about it. `RiteS` is closed (invariant 5), so the Great
   * Rite and the unmaking land here with their own cases or not at all.
   */
  z.object({
    kind: z.literal('rite'),
    rite: RiteS,
    /** The slot holding the man it is done FOR. Must cast expressers only. */
    ascendant: z.string(),
    /** The slot holding the person it is done TO, where the rite takes one. */
    subject: z.string().optional(),
    /** What the house says became of them, for the record layer to agree or lie about. */
    cause: z.string().optional(),
  }),
  z.object({ kind: z.literal('schedule'), event: z.string(), inYears: z.number() }),
  z.object({ kind: z.literal('arc'), op: z.enum(['start', 'advance', 'cancel']), arc: z.string() }),
  /**
   * What this run of the substory remembers about itself. Writes
   * `ArcInstance.localFlags`, which the `arcFlag` condition reads back — the
   * pair is what lets a successor branch on a decision three nodes upstream
   * without promoting it to a world flag every other event in the game can see.
   *
   * Only meaningful on an event firing as a node of an arc; `arcs/flags` fails
   * the build on one written anywhere else, because a write nothing can ever
   * read is not a write.
   */
  z.object({ kind: z.literal('arc_flag'), flag: z.string(), set: z.union([z.boolean(), z.number(), z.string()]) }),
  /**
   * The forging path (issue #19, concept §7 — "a bought grandmother"). Points
   * `target`'s CLAIMED parent at whoever `claimedAs` names, leaving
   * `trueParents` untouched, and files a `LineageDocument` marked `forged`.
   * This is the one place `Person.claimedParents` can diverge from
   * `trueParents` after bootstrap — without it `pedigreeF` (claimed ancestry)
   * and realized homozygosity (the genome) can never disagree.
   */
  z.object({
    kind: z.literal('forge_lineage'),
    target: TargetS,
    parent: z.enum(['mother', 'father']),
    /** The slot naming the false parent to claim instead. */
    claimedAs: z.string(),
    notarisedBy: z.string(),
    generations: z.number().int().positive().default(3),
  }),
  /**
   * A TUTOR'S TERM, STARTED OR CUT SHORT BY THE CONTENT ITSELF (issue #128).
   *
   * §13's term was reachable only from `table.ts`'s player order — no
   * authored event could ever put a child in one, or take one away, so the
   * five tutor templates narrated a system that could not be reached from
   * inside the fiction. `begin` charges `TUTOR_FEE` and runs
   * `core/src/table.ts`'s `beginTutoring` — the SAME gate the player's own
   * order calls, so this cannot drift into a second copy of `canBeTaught`
   * that disagrees about what a tutor may teach (a body attribute, Madness
   * and Eldritch Power are all refused). `cancel` drops whatever term the
   * target is in, if any, with no refund — the money was always gone the day
   * it was spent.
   */
  z.object({ kind: z.literal('tutor'), target: TargetS, attr: z.string(), op: z.enum(['begin', 'cancel']) }),
  /**
   * THE MUSTER (issue #89, Stage 2 — #95). At most one commitment is ever
   * `in_the_field` at a time (`arc_the_muster`'s own `maxConcurrentInstances:
   * 1`), so `settle`/`withdraw`/`reinforce`/`add_officer`/`set_position` name
   * no commitment — they act on whichever one is standing, and refuse
   * quietly (the outcome still fires; nothing here throws) if none is.
   *
   *   begin        opens a commitment: `men` drawn against `maxMen`, `age`
   *                the Wars instance it belongs to (`ActiveAge.age`).
   *   reinforce    more men into the standing commitment.
   *   add_officer  `officer` (a slot) joins `Commitment.officers`. Real
   *                family — never touches `people/minting.ts`.
   *   set_position bought, or withdrawn from — `positions.yaml` is Stage 3's.
   *   settle       `status: 'settled'` — spends the credit, or not; the
   *                Record block at the calling event decides what that means.
   *   withdraw     `status: 'withdrawn'` — keeps the men, forfeits the credit.
   *
   * `men` are the abstract integer #89 specifies, never a `Person` — a
   * commitment's officers are the only people in it.
   */
  z.object({
    kind: z.literal('muster'),
    op: z.enum(['begin', 'reinforce', 'add_officer', 'set_position', 'settle', 'withdraw']),
    men: z.number().optional(),
    age: z.string().optional(),
    /** `begin`/`reinforce`: which hall supplied these men — `Commitment.from`. */
    from: z.string().optional(),
    officer: TargetS.optional(),
    position: z.string().optional(),
  }),
  /**
   * LAND (issue #91, Phase D — #98). The nine acquisition and eight loss
   * routes #91 catalogues become events through these four, over one named
   * `ParcelDef` a scene picks deliberately rather than a random holding —
   * the same reason `spellbook`'s `book` and `heirloom`'s `heirloom` are a
   * specific id and not a kind: Longmere's own provenance ("drained a
   * century back") is what makes a flood scene land there rather than
   * anywhere flat.
   *
   *   grant    mints a `ParcelState` for a parcel the house does not yet
   *            hold, exactly as `buyParcel` does, at no cost — the price (if
   *            any) is the outcome's own `treasury` effect alongside this
   *            one. A no-op if the house already holds it.
   *   seize    the reverse: drops a held parcel, the same cleanup
   *            `sellParcel` does (open improvements included), no payment.
   *            A no-op if the house does not hold it.
   *   damage   knocks `ParcelState.yieldBonus` down by `magnitude` (default
   *            `LAND_DAMAGE_DEFAULT`) — the yield hit `land.ts`'s own header
   *            calls out ("Flood, fire, blight | yield, then acres"), floored
   *            so a parcel's contribution to `landIncome` cannot go negative.
   *   restore  the repair: raises `yieldBonus` back up by `magnitude`. Not
   *            capped at the undamaged baseline — a parcel already improved
   *            past zero stays improved once its damage is paid off.
   *   encroach the ninth acquisition route (issue #91, Stage G): `grant`,
   *            plus a written act — `noteBearing(ctx, 'bit_the_common')`
   *            (`core/src/bearing.ts`). The only route that costs nothing on
   *            the day, which is the entire point of it: §29's whole design
   *            is that pride is usually correct and billed two generations
   *            after the fact, and taking a free bite of the common the
   *            village tolerates the house for is that shape exactly.
   *
   * A no-op on a parcel the house does not hold is correct, not a stub: the
   * event that fires this already gated on `holdsParcel`, and a scene that
   * somehow reaches the effect anyway (a slot recast, an arc replayed after
   * a sale) should not seize or damage ground that changed hands out from
   * under it.
   */
  z.object({
    kind: z.literal('land'),
    op: z.enum(['grant', 'seize', 'damage', 'restore', 'encroach']),
    parcel: z.string(),
    magnitude: z.number().positive().optional(),
  }),
]);
export type Effect = z.infer<typeof EffectS>;

// ── Checks: one structure for all four challenge tiers (concept §21) ──────

/**
 * What a `kind: 'record'` pool scores against — the family's own papers,
 * rather than a person. v1 is entry-state only: which event, what it tagged
 * itself, what the family did with its Record choice, and whether the
 * Discrepancy that choice may have created has since been proven or buried.
 * Claim predicates (what an account actually SAYS) arrive with the record
 * layer proper and extend this rather than replacing it.
 */
export const ChronicleQueryS = z.object({
  /** Only entries for this exact event. */
  eventId: z.string().optional(),
  /** Only entries whose event carries this tag. */
  eventTag: z.string().optional(),
  /** Only entries answered this way at Record / Omit / Embellish. */
  record: z.enum(['record', 'omit', 'embellish']).optional(),
  /** Only entries marked grey — gone, but known to have existed (concept §6). */
  greyed: z.boolean().optional(),
  /** Only entries whose Embellish created a Discrepancy currently in this state. */
  discrepancyState: z.enum(['open', 'proven', 'buried']).optional(),
  /** Only entries from the last N years. Omit to search the whole chronicle. */
  withinYears: z.number().optional(),
  /**
   * Claim predicates (issue #19), extending v1: only entries carrying a claim
   * of this shape. `attr`/`trait` narrow further; omitted, they match any
   * claim of that `kind`.
   */
  hasClaim: z.object({
    kind: z.enum(['attr', 'trait', 'death', 'deed']),
    attr: z.string().optional(),
    trait: z.string().optional(),
  }).optional(),
  /** A raw count of matches, or matches over everything the window considered. */
  measure: z.enum(['count', 'ratio']).default('count'),
});
export type ChronicleQuery = z.infer<typeof ChronicleQueryS>;

export const PoolSpecS = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('slot'), slot: z.string(), attrs: z.array(z.object({ attr: z.string(), weight: z.number() })) }),
  z.object({ kind: z.literal('party_sum'), slots: z.array(z.string()), attr: z.string() }),
  z.object({ kind: z.literal('family_sum'), attr: z.string() }),
  z.object({ kind: z.literal('family_max'), attr: z.string() }),
  z.object({ kind: z.literal('family_any'), attr: z.string(), atLeast: z.number() }),
  z.object({ kind: z.literal('record'), against: ChronicleQueryS }),
]);
export type PoolSpec = z.infer<typeof PoolSpecS>;

/**
 * Difficulty as a flat number, or as one that moves with the world — a
 * Church inquest is a harder pool during the Crusade, and a house with more
 * to lose is asked more of. Every term is optional and additive to `base`.
 */
export const DifficultyExprS = z.object({
  base: z.number(),
  /** Added for each of these Ages that is currently active, by id. */
  perActiveAge: z.record(z.string(), z.number()).optional(),
  /** Added per RespectTier above `unknown` (0..4). */
  perRespectTier: z.number().optional(),
  /** Added per hundred years since the contract's signing (1042). */
  perCentury: z.number().optional(),
});
export type DifficultyExpr = z.infer<typeof DifficultyExprS>;

export const CheckS = z.object({
  id: z.string(),
  pool: PoolSpecS,
  difficulty: z.union([z.number(), DifficultyExprS]),
  variance: z.enum(['none', 'narrow', 'wide']).default('narrow'),
  /** Degrees of success, highest threshold first. */
  bands: z.array(z.object({ atLeast: z.number(), outcome: z.string() })).min(1, 'at least one band'),
});
export type Check = z.infer<typeof CheckS>;

export const OutcomeS = z.object({
  id: z.string(),
  weight: z.number().default(100),
  text: z.string(),
  tags: z.array(z.string()).default([]),
  effects: z.array(EffectS).default([]),
  /** Spawn or advance a substory. */
  triggers: z.object({ arc: z.string(), op: z.enum(['start', 'advance']) }).optional(),
  /**
   * THE SECOND BEAT, inline.
   *
   * A two- or three-scene story does not need an arc file, a node table and a
   * two-way `arc: {of, node}` binding maintained by hand in two places — it
   * needs one line saying what happens next and who is still in the room.
   * `desugar.ts` compiles this into a real `ArcDef` before the engine ever sees
   * it, so there is still exactly one thing that runs a tree.
   *
   *   event   the follow-up. It leaves the ambient pool and fires only here.
   *   after   when it comes due, in the same vocabulary an `ArcNode` uses.
   *   keep    slots carried forward, cast with the SAME people. Everything the
   *           follow-up does not list is recast from scratch.
   */
  next: z.object({
    event: z.string(),
    after: ScheduleS.default('next_generation'),
    keep: z.array(z.string()).default([]),
  }).optional(),
});
export type Outcome = z.infer<typeof OutcomeS>;

export const ChoiceS = z.object({
  id: z.string(),
  label: z.string(),
  /** Visibly unavailable choices are themselves information (concept §16). */
  requires: z.array(z.object({ slot: z.string(), attr: z.string(), op: CompareOpS, value: z.number() })).default([]),
  check: z.string().optional(),
  outcomes: z.array(OutcomeS).min(1),
});
export type Choice = z.infer<typeof ChoiceS>;

/**
 * Three interaction shapes, ONE template. A "mission" is not a separate
 * system: it is an event whose slots the player fills himself, which is why
 * dispatch is just `castBy: 'player'` on the slots.
 *
 * `decidedBy` is orthogonal to all three (see `decider.ts`). The shape says how
 * many branches there are and whether the player casts them; the decider says
 * who takes one. Defaulting to `player` is what makes every template authored
 * before this field existed behave exactly as it did.
 *
 * `narration` takes no decider because it has one branch and nothing to decide.
 */
export const InteractionS = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('narration'), outcomes: z.array(OutcomeS).min(1) }),
  z.object({ kind: z.literal('choice'), decidedBy: DeciderS.default('player'), choices: z.array(ChoiceS).min(2) }),
  z.object({ kind: z.literal('dispatch'), decidedBy: DeciderS.default('player'), choices: z.array(ChoiceS).min(1) }),
]);
export type Interaction = z.infer<typeof InteractionS>;

/**
 * Record / Omit / Embellish. The mechanical form of the thesis (concept §6).
 *
 * `claims` (issue #19) is what the option's `chronicle` text actually
 * ASSERTS, in the closed vocabulary — attached to `record` and `embellish`
 * only, since `omit` writes nothing to assert anything with (the blank IS the
 * artefact). An Embellish's claims are, by construction, the lie: `pedigreeF`
 * and `deriveRecordView` in `core/src/record.ts` never need to ask whether an
 * embellished claim is true, only whether a recorded one happens to be.
 */
export const RecordBlockS = z.object({
  subject: z.string(),
  options: z.object({
    record: z.object({
      chronicle: z.string(),
      grantsKnowledge: z.string().optional(),
      effects: z.array(EffectS).default([]),
      claims: z.array(ClaimS).default([]),
    }),
    omit: z.object({
      /** null prints as a dated blank line. The blank is a designed artefact. */
      chronicle: z.null().default(null),
      effects: z.array(EffectS).default([]),
    }),
    embellish: z.object({
      chronicle: z.string(),
      effects: z.array(EffectS).default([]),
      claims: z.array(ClaimS).default([]),
      discrepancy: z.object({
        id: z.string(),
        severity: z.enum(['minor', 'major', 'total']),
        provableBy: z.array(z.string()).min(1),
      }),
    }),
  }),
});
export type RecordBlock = z.infer<typeof RecordBlockS>;

/**
 * Age scoping is a DECLARATIVE FIELD rather than a condition, for three
 * reasons: the selection pipeline buckets by Age and skips whole buckets;
 * the editor can report per-Age coverage; and an Age owning three events is
 * a rules patch wearing a name, which the tool should say out loud.
 */
export const AgeScopeS = z.object({
  only: z.array(z.string()).optional(),
  never: z.array(z.string()).optional(),
  register: z.array(z.enum(['warm', 'cold', 'institutional'])).optional(),
});
export type AgeScope = z.infer<typeof AgeScopeS>;

/**
 * What `tier: 'frame'` gates on, instead of a `Condition` (concept §2, issue
 * #13). One named Discrepancy's state — the same shape the `discrepancy`
 * condition already reads, and the same map it already reads it from
 * (`world.discrepancies`, built for issue #9). No new storage, and no claim
 * vocabulary: v1 of the record layer's claim predicates is a later issue.
 */
/**
 * WHAT THE CREDITOR IS READING (concept §2). A frame scene gates on the record
 * rather than on the world, because the frame is 1542 reacting to what the
 * family wrote down, not to what happened.
 *
 * It could only ever name ONE SPECIFIC Discrepancy, and that is why the frame
 * nearly never happened: sampled every fifty years across a run, the eligible
 * pool held zero scenes at almost every sample, and four player-driven runs of
 * one build produced 2, 13, 15 and 3 interludes with silences of six and eight
 * hundred years. Every authored interlude was waiting for one particular lie
 * to have been told, and most of them never were.
 *
 * The other three shapes ask about the record in general — how much of it
 * there is, how much of it is missing, and whether the family is carrying any
 * unproven lie at all. Those are the readings the guardian can always make,
 * because there is always a chronicle and it always says something.
 */
export const FrameReadS = z.union([
  z.object({
    discrepancy: z.string(),
    /** Omit to ask only whether it exists at all. */
    state: DiscrepancyStateS.optional(),
  }),
  /** Any Discrepancy at all, optionally in a given state. */
  z.object({
    anyDiscrepancy: z.object({
      state: DiscrepancyStateS.optional(),
      atLeast: z.number().default(1),
    }),
  }),
  /** How much the family has written down. `atLeast: 1` is "there is a record". */
  z.object({ recorded: z.object({ atLeast: z.number() }) }),
  /** How many dated blank lines the chronicle carries. */
  z.object({ omitted: z.object({ atLeast: z.number() }) }),
  /**
   * THE PAGE THIS EVENT LEFT, whatever it ended up saying.
   *
   * The fifth shape, and it exists because the first one is too narrow for
   * an interlude whose premise is that a thing HAPPENED and was written
   * about, rather than that a particular lie was told about it. Measured over
   * thirty-six thousand-year runs: `seal_the_regalia_incomplete` fires in
   * eleven of them, each one gets exactly one Record decision, and the
   * chronicler embellishes two — so `{ discrepancy: regalia_lie }` reaches
   * 5.6% of runs and everything gated on it is content 94% of players never
   * see. The page itself is there in all eleven: recorded, embellished, or a
   * dated blank, and a blank is an artefact the guardian can read as well as
   * a sentence.
   *
   * Still the record and not the world (an omitted page is a page), which is
   * the whole reason this is a `reads` and not a `condition`.
   */
  z.object({ chronicled: z.string() }),
]);
export type FrameRead = z.infer<typeof FrameReadS>;

export const EventTemplateS = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/, 'ids are snake_case and never renamed after commit'),
  title: z.string(),
  tier: EventTierS,
  /** Common | Uncommon | Rare | Mythic — see schema/frequency.ts. */
  frequency: FrequencyS,
  /** Per-template nudge WITHIN its frequency tier. Tier does the heavy lifting. */
  weight: z.number().default(100),
  repeatable: z.boolean().default(true),
  cooldownYears: z.number().default(0),
  tags: z.array(z.string()).default([]),
  purposes: z.array(PurposeS).length(3, 'exactly three declared purposes'),

  ages: AgeScopeS.optional(),
  slots: z.record(z.string(), SlotSpecS).default({}),
  conditions: ConditionS.optional(),
  checks: z.array(CheckS).default([]),
  /**
   * `tier: 'frame'` gates on `reads` instead of `conditions` — see
   * `FrameReadS`. Frame-only; every other tier leaves this empty.
   */
  reads: z.array(FrameReadS).default([]),

  body: z.string(),
  /** Required when arc bindings may be dead by the time this node fires. */
  absentBody: z.string().optional(),

  interaction: InteractionS,
  record: RecordBlockS.optional(),
  /**
   * Specific Record / Omit / Embellish wording for an authored choice.
   * The normal `record` remains the fallback for every event and for
   * legacy saves. An id here names a choice id, never an outcome id: the
   * docket knows exactly which choice the player or chronicler took.
   */
  recordByChoice: z.array(RecordBlockS.extend({ id: z.string().min(1) })).superRefine((rows, ctx) => {
    const seen = new Set<string>();
    for (const [index, row] of rows.entries()) {
      if (seen.has(row.id)) {
        ctx.addIssue({
          code: 'custom', path: [index, 'id'],
          message: `duplicate choice-specific Record id: ${row.id}`,
        });
      }
      seen.add(row.id);
    }
  }).optional(),
  /**
   * When one choice can yield distinct factual outcomes, use an exact
   * choice/outcome pair instead of pretending the choice alone knows the
   * chronicle's truth. IDs are `choice_id/outcome_id` so repeated outcome
   * IDs across different choices cannot select each other's Record.
   */
  recordByOutcome: z.array(RecordBlockS.extend({
    id: z.string().regex(/^[a-z0-9_]+\\/[a-z0-9_]+$/, 'use choice_id/outcome_id'),
  })).superRefine((rows, ctx) => {
    const seen = new Set<string>();
    for (const [index, row] of rows.entries()) {
      if (seen.has(row.id)) {
        ctx.addIssue({
          code: 'custom', path: [index, 'id'],
          message: `duplicate outcome-specific Record id: ${row.id}`,
        });
      }
      seen.add(row.id);
    }
  }).optional(),
  rumour: z.object({ id: z.string(), accuracy: z.number(), spread: z.number() }).optional(),
  accounts: z.array(z.string()).default([]),

  arc: z.object({ of: z.string(), node: z.string() }).optional(),
});
export type EventTemplate = z.infer<typeof EventTemplateS>;

export const EventFileS = z.object({
  events: z.array(EventTemplateS),
});
