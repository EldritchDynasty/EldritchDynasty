import { z } from 'zod';
import { ALL_AFFINITIES, type AffinityName } from './attributes.js';
import { RiteS, RungS, type Rite, type Rung } from './rung.js';

export const CompareOpS = z.enum(['lt', 'lte', 'eq', 'gte', 'gt', 'ne']);
export type CompareOp = z.infer<typeof CompareOpS>;

export function compare(a: number, op: CompareOp, b: number): boolean {
  switch (op) {
    case 'lt': return a < b;
    case 'lte': return a <= b;
    case 'eq': return a === b;
    case 'gte': return a >= b;
    case 'gt': return a > b;
    case 'ne': return a !== b;
  }
}

export const RespectTierS = z.enum(['unknown', 'known', 'regarded', 'eminent', 'exalted']);
export type RespectTier = z.infer<typeof RespectTierS>;
export const RESPECT_ORDER: RespectTier[] = ['unknown', 'known', 'regarded', 'eminent', 'exalted'];

export const RegisterS = z.enum(['warm', 'cold', 'institutional']);
export type Register = z.infer<typeof RegisterS>;

export const DiscrepancyStateS = z.enum(['open', 'proven', 'buried']);
export type DiscrepancyState = z.infer<typeof DiscrepancyStateS>;

/**
 * Conditions gate on world state. Slot fillability is checked separately and
 * later, because it is far more expensive (see core/events/selection.ts).
 */
export type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | { flag: string; is?: boolean }
  | { knowledge: string; has: boolean }
  | { respect: { op: CompareOp; tier: RespectTier } }
  | { year: { op: CompareOp; value: number } }
  /** Relative position in the active campaign: 0 at founding, 1 at collection. */
  | { campaignProgress: { op: CompareOp; value: number } }
  | { generation: { op: CompareOp; value: number } }
  | { treasury: { op: CompareOp; value: number } }
  | { clausesRecovered: { op: CompareOp; value: number } }
  | { familyAny: { attr: string; atLeast: number } }
  | { familySize: { op: CompareOp; value: number } }
  /** The blood, alive, house-wide — see the Zod entry below for why this differs from `familySize`. */
  | { bloodCount: { op: CompareOp; value: number } }
  | { inRegency: boolean }
  | { hasExpressingHead: boolean }
  // ── Cadet branches (concept §16, §22) ────────────────────────────────
  /** Living cadet branches. A house with none is a house with one household. */
  | { cadetBranches: { op: CompareOp; value: number } }
  /** The angriest branch's grievance, 0–100. */
  | { branchGrievance: { op: CompareOp; value: number } }
  | { discontent: { op: CompareOp; value: number } }
  /** The worst live grudge anyone holds against the player's house, 0–100. */
  | { grudgeAgainstUs: { op: CompareOp; value: number } }
  // ── Age gating (concept §20) ─────────────────────────────────────────
  | { ageActive: string }
  | { ageRegister: Register }
  | { ageElapsed: { op: CompareOp; years: number } }
  | { ageStacked: { op: CompareOp; count: number } }
  | { ageNamed: boolean }
  /**
   * HOW MANY AGES THE HOUSE HAS LIVED THROUGH — the run's own clock, in the
   * unit §20 measures a run in (issue #46).
   *
   * `year` and `generation` both answer "how far in are we" and both answer it
   * in the wrong unit for a motif: an Age is a hazard process, so two runs at
   * year 1400 may have seen three Ages or nine, and a reading assigned to the
   * house's third Age has to arrive in its third Age rather than in its third
   * century. Counted off `world.age.ended`, so the Age currently running is
   * not counted until the house is out of it.
   */
  | { agesElapsed: { op: CompareOp; value: number } }
  // ── Discrepancies (concept §6, §19; issue #9) ────────────────────────
  /** One named Discrepancy's state. Omit `state` to ask only whether it exists at all. */
  | { discrepancy: string; state?: DiscrepancyState }
  /** How many are currently open — the PRESSURE pass's own signal. */
  | { openDiscrepancies: { op: CompareOp; value: number } }
  /**
   * THE ASSIZE (`core/src/assize.ts`) — how the world currently reads the
   * house, in [-1, 1]. Positive is ahead of where a house should be by now,
   * negative is behind, and the bar it is measured against rises across the
   * run. Gate content on it to write the scenes only a house in trouble gets,
   * and the ones only a house everybody resents gets.
   */
  | { assize: { op: CompareOp; value: number } }
  /**
   * BEARING (`core/src/bearing.ts`, concept §29) — how the house has carried
   * itself, in [0, 1], as distinct from how it is doing. Read off acts the
   * player took at least two generations ago, plus the halls it has left
   * angry and the seat it has sat on.
   *
   * Content gated on this must obey §29's first rule: NEVER NAME IT. There is
   * no player-facing word for this number, `prose/bearing` fails the build on
   * the four that would be, and a scene that gates on it says what the world
   * DID and never why. Nobody in the house knows this is being read.
   */
  | { bearing: { op: CompareOp; value: number } }
  /**
   * HOW MANY TIMES SOMEBODY HAD SOMETHING TO SAY AND DID NOT SAY IT (§29
   * stage 3, issue #45).
   *
   * The trace, and the only thing that makes the suppression fair: a player
   * who is never told, and can never afterwards find out that they were not
   * told, is a player being handed bad dice. Content gates on this to put the
   * fact in front of them years later — in somebody else's account, which is
   * §29 rule 4's own channel.
   */
  | { unheard: { op: CompareOp; value: number } }
  /**
   * THE ASCENSION LADDER (`core/src/ascension.ts`, concept §22). Gate content
   * on how far up the house has actually got. `best: true` asks the high-water
   * mark — what the family ever reached — rather than where it stands now,
   * which is what a scene about a dead Hierophant needs.
   */
  | { ascension: { atLeast: Rung; best?: boolean } }
  // ── Arc memory ────────────────────────────────────────────────────────
  /**
   * A flag this run of the substory set on itself, via the `arc_flag` effect.
   * Only meaningful where an arc is in scope — a successor's `when`, or the
   * conditions of an event firing as one of its nodes. Asked anywhere else it
   * is FALSE, never true: the permissive default is the expensive one, and a
   * story-local memory that answers yes to the ambient pool would fire content
   * for a story that is not running.
   */
  | { arcFlag: string; is?: boolean | number | string }
  /** Has this run of the substory already resolved that node? */
  | { arcVisited: string }
  // ── Unlocks (issue #11) ───────────────────────────────────────────────
  /**
   * Does anyone in the household hold a trait whose `unlock` modifier grants
   * this string? Presence only — reads the household live, same as every
   * other presence effect, so there is no world state to save or drift.
   */
  | { unlocked: string }
  // ── Posts and schooling (issue #126) ──────────────────────────────────
  /**
   * HOW MANY OF THE HOUSEHOLD HOLD A POST, right now — optionally narrowed to
   * named careers. `career` on a Filter runs against one candidate at a time
   * when a slot is cast; this is the question a Filter cannot answer, because
   * gating whether a scene happens at all needs the house's whole position,
   * not one man in it. Covers *nobody in post*, *three at once*, *no clergy
   * ever*.
   */
  | { posts: { op: CompareOp; value: number; career?: string[] } }
  /**
   * DOES ANYBODY HOLD THIS POST, AND FOR HOW LONG — the longest tenure among
   * current holders. FALSE when nobody holds it: a comparison with nobody is
   * not a question this can answer, and "held for fewer than N years" should
   * not read TRUE of an empty house.
   */
  | { postHeldFor: { career: string; op: CompareOp; years: number } }
  // ── Land (issue #91, Phase D — #98) ────────────────────────────────────
  /**
   * DOES THE HOUSE CURRENTLY HOLD THIS PARCEL — one named `ParcelDef` id, not
   * a kind: a scene about the dike at Longmere needs Longmere specifically,
   * not "some tenant farm". Negate with `not` for "does not hold it" or "has
   * not yet acquired it"; there is no second boolean here for the same
   * reason `discrepancy` has none.
   */
  | { holdsParcel: string }
  /**
   * TOTAL ACRES CURRENTLY HELD, summed across every live `ParcelState` —
   * #85's own claim for this epic (issue #101, Phase F) and the gate on
   * scenes that only make sense once the house has enough ground to have lost
   * track of some of it ("the deed nobody can find") or little enough left
   * that losing more would be desperate.
   */
  | { acreage: { op: CompareOp; value: number } }
  // ── The derived start window (issue #91, Stage H, ruled 2026-09-07) ────
  /**
   * DOES THIS ARC STILL HAVE TIME TO FINISH, IF STARTED NOW.
   *
   * "An arc is not offered if the time remaining to the campaign's end
   * cannot fit its shortest path." Derived, never authored: the threshold
   * is `minimumArcYears(arc)` (`core/src/events/arc-reach.ts`) — the SAME
   * walk `startArc` (#133) already refuses on at the engine level, read
   * here as a content-facing gate so the scene that would start the arc is
   * never OFFERED once it is already too late, rather than offered and
   * then silently doing nothing the moment it is taken. Nobody maintains a
   * magic number, and a shorter campaign (issue #66) inherits the correct
   * answer for free rather than needing this gate retuned. A
   * multi-generation substory's own starting scene gates on this — never
   * `campaignProgress` or a bare `year` check, both of which are numbers an
   * author would have to keep in step with the arc by hand every time a
   * node's schedule changed. FALSE for an unknown arc id, the same refusal
   * an unresolved reference gets everywhere else in this union (see
   * `discrepancy`).
   */
  | { arcCanFinish: string };

export const ConditionS: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.object({ all: z.array(ConditionS) }),
    z.object({ any: z.array(ConditionS) }),
    z.object({ not: ConditionS }),
    z.object({ flag: z.string(), is: z.boolean().optional() }),
    z.object({ knowledge: z.string(), has: z.boolean() }),
    z.object({ respect: z.object({ op: CompareOpS, tier: RespectTierS }) }),
    z.object({ year: z.object({ op: CompareOpS, value: z.number() }) }),
    z.object({ campaignProgress: z.object({ op: CompareOpS, value: z.number().min(0).max(1) }) }),
    z.object({ generation: z.object({ op: CompareOpS, value: z.number() }) }),
    z.object({ treasury: z.object({ op: CompareOpS, value: z.number() }) }),
    z.object({ clausesRecovered: z.object({ op: CompareOpS, value: z.number() }) }),
    z.object({ familyAny: z.object({ attr: z.string(), atLeast: z.number() }) }),
    z.object({ familySize: z.object({ op: CompareOpS, value: z.number() }) }),
    /**
     * THE BLOOD, alive, house-wide — never `familySize`'s `household.length`,
     * which is floored near ten forever by a recurring retainer cast and
     * cannot see a line thinning at all (issue #132). The same count
     * `livingBlood` (`ending.ts`) and `thinBloodMortality` already read.
     */
    z.object({ bloodCount: z.object({ op: CompareOpS, value: z.number() }) }),
    z.object({ inRegency: z.boolean() }),
    z.object({ hasExpressingHead: z.boolean() }),
    z.object({ cadetBranches: z.object({ op: CompareOpS, value: z.number() }) }),
    z.object({ branchGrievance: z.object({ op: CompareOpS, value: z.number() }) }),
    z.object({ discontent: z.object({ op: CompareOpS, value: z.number() }) }),
    z.object({ grudgeAgainstUs: z.object({ op: CompareOpS, value: z.number() }) }),
    z.object({ ageActive: z.string() }),
    z.object({ ageRegister: RegisterS }),
    z.object({ ageElapsed: z.object({ op: CompareOpS, years: z.number() }) }),
    z.object({ ageStacked: z.object({ op: CompareOpS, count: z.number() }) }),
    z.object({ agesElapsed: z.object({ op: CompareOpS, value: z.number() }) }),
    z.object({ ageNamed: z.boolean() }),
    z.object({ discrepancy: z.string(), state: DiscrepancyStateS.optional() }),
    z.object({ openDiscrepancies: z.object({ op: CompareOpS, value: z.number() }) }),
    z.object({ assize: z.object({ op: CompareOpS, value: z.number() }) }),
    z.object({ bearing: z.object({ op: CompareOpS, value: z.number() }) }),
    z.object({ unheard: z.object({ op: CompareOpS, value: z.number() }) }),
    z.object({ ascension: z.object({ atLeast: RungS, best: z.boolean().optional() }) }),
    z.object({ arcFlag: z.string(), is: z.union([z.boolean(), z.number(), z.string()]).optional() }),
    z.object({ arcVisited: z.string() }),
    z.object({ unlocked: z.string() }),
    z.object({ posts: z.object({ op: CompareOpS, value: z.number(), career: z.array(z.string()).optional() }) }),
    z.object({ postHeldFor: z.object({ career: z.string(), op: CompareOpS, years: z.number() }) }),
    z.object({ holdsParcel: z.string() }),
    z.object({ acreage: z.object({ op: CompareOpS, value: z.number() }) }),
    z.object({ arcCanFinish: z.string() }),
  ]),
);

/** Filters run against a person, not against the world. */
export type Filter =
  | { knows: { affinity: AffinityName } }
  | { attr: string; op: CompareOp; value: number }
  | { trait: string; has: boolean }
  | { tag: string; has: boolean }
  | { sex: 'male' | 'female' }
  | { age: { op: CompareOp; value: number } }
  | { status: string[] }
  | { membership: string[] }
  | { career: string[] }
  | { awakened: boolean }
  | { canExpress: boolean }
  /**
   * THE HOUSE HAS STOPPED WAITING FOR HIM (§11, issues #1794 and #1797).
   *
   * Set only by the Table's `declareMundane` order. A scene whose outcome
   * wakes somebody past the forcing rites' age windows must ask this, or the
   * book would say a man woke after the house swore he never would.
   */
  | { declaredMundane: boolean }
  /**
   * HE HAS BEEN PUT THROUGH A FORCING RITE ALREADY (§11, #1817).
   *
   * Set when any template declaring `forcing` resolves on him, called from
   * the Table or drawn ambient alike. A boy goes through one forcing rite,
   * whichever it is; every forcing slot asks `{ forcingTried: false }`
   * (`rites/forcing`), so the house cannot keep putting the same son in the
   * water until he wakes.
   */
  | { forcingTried: boolean }
  /**
   * Held by debt, or not (world §12, `core/src/people/bond.ts`). A slot that
   * casts a bondsman has to be able to ask for one: `bond` with `op: 'free'`
   * against somebody who owes nothing is an effect that returns without
   * acting, which is the failure this codebase is named for.
   */
  | { bonded: boolean }
  | { rung: { atLeast: Rung } }
  | { rite: { taken: Rite } }
  | { relation: 'not' | 'child_of' | 'descendant_of' | 'sibling_of' | 'spouse_of' | 'blood_of'; of: string }
  /**
   * EXCEEDS A NAMED COUNTERPART on a measured ladder quantity (issue #61).
   *
   * `standingOf` (`core/src/ascension.ts`) exposes power and Mind on §22's
   * 0–100 scale and affinities as a count. The household God rite no longer
   * uses pre-sacrifice dominance, but authored comparisons still read live
   * people rather than a stale snapshot.
   */
  | { exceeds: { of: string; on: 'power' | 'affinities' | 'mind' } }
  /**
   * HAS A TERM EVER COMPLETED ON THIS PERSON, and in what (issue #126).
   *
   * `Person.acquired` cannot answer this — an event effect writes there too,
   * so a child who got +2 mind from a scene would read as taught. `taught` is
   * a durable mark set only where a tutor's term actually completes
   * (`runStandingOrders`, whichever door opened it), so this asks "was this
   * child schooled" rather than "is this child clever". Omit `attr` to ask
   * whether ANY term has completed.
   */
  | { taught: { attr?: string } }
  /**
   * IS THIS PERSON MID-TERM RIGHT NOW (issue #128), as against `taught`,
   * which asks whether one has EVER completed. Reads `world.tutoring`
   * directly — no state of its own to drift from it.
   */
  | { inTerm: boolean }
  | { all: Filter[] }
  | { any: Filter[] }
  | { not: Filter };

export const FilterS: z.ZodType<Filter> = z.lazy(() =>
  z.union([
    z.object({ knows: z.object({ affinity: z.enum(ALL_AFFINITIES) }) }),
    z.object({ attr: z.string(), op: CompareOpS, value: z.number() }),
    z.object({ trait: z.string(), has: z.boolean() }),
    z.object({ tag: z.string(), has: z.boolean() }),
    z.object({ sex: z.enum(['male', 'female']) }),
    z.object({ age: z.object({ op: CompareOpS, value: z.number() }) }),
    z.object({ status: z.array(z.string()) }),
    z.object({ membership: z.array(z.string()) }),
    /**
     * Holds one of these posts, by career id. Set membership on `Person.career`,
     * exactly as `status` is on `Person.status` — negate with `not`.
     *
     * There was no way to ask this, which is why `op: leave` on the `career`
     * effect could only be aimed through a proxy: the one trait a soldier earns
     * after ten years. That made leaving a post reachable in 4% of runs and
     * gated the whole verb behind a decade of survival.
     */
    z.object({ career: z.array(z.string()).min(1) }),
    z.object({ awakened: z.boolean() }),
    z.object({ canExpress: z.boolean() }),
    z.object({ declaredMundane: z.boolean() }),
    z.object({ forcingTried: z.boolean() }),
    z.object({ bonded: z.boolean() }),
    /**
     * WHERE THIS ONE MAN STANDS ON THE LADDER (§22).
     *
     * The `ascension` CONDITION asks where the house stands, and the two are
     * not the same question by up to a year: `ascension` is the
     * second-to-last phase of the year and events are selected in `ambient`,
     * so a template gated on the house reads LAST year's rung. Measured, the
     * gap is reachable — the foremost man dies or is charged past his own
     * `mind` between the reading and the casting, and `role: foremost` then
     * hands the scene to the next man down, who may never have climbed at all.
     *
     * A rite is offered to a MAN, so the ration belongs on the man. With this
     * the cast simply has no candidate in that year and the scene does not
     * fire, rather than firing at somebody it was never written for.
     */
    z.object({ rung: z.object({ atLeast: RungS }) }),
    /**
     * HAS THIS MAN TAKEN THIS RITE (§22, issue #43).
     *
     * `rung` asks where he stands and this asks what he DID, and for the top
     * of the ladder they are different questions: the Great Rite widens a
     * Hierophant without moving him a rung, so a man who has been made into
     * something is not identifiable by his standing.
     *
     * The unmaking needs exactly this and nothing else. It takes what the
     * elder was MADE into — the acquired layer — so an elder who never took a
     * rite is somebody the act has nothing to take from, and `performUnmaking`
     * refuses him. Without this filter the scene casts him anyway and the
     * effect quietly does nothing, which is the failure this codebase is
     * built to refuse rather than a rare outcome.
     */
    z.object({ rite: z.object({ taken: RiteS }) }),
    z.object({ relation: z.enum(['not', 'child_of', 'descendant_of', 'sibling_of', 'spouse_of', 'blood_of']), of: z.string() }),
    /**
     * EXCEEDS A NAMED COUNTERPART (§22's God gate, issue #61). See the type
     * above for why these three and not the raw attribute.
     */
    z.object({ exceeds: z.object({ of: z.string(), on: z.enum(['power', 'affinities', 'mind']) }) }),
    z.object({ taught: z.object({ attr: z.string().optional() }) }),
    z.object({ inTerm: z.boolean() }),
    z.object({ all: z.array(FilterS) }),
    z.object({ any: z.array(FilterS) }),
    z.object({ not: FilterS }),
  ]),
);
