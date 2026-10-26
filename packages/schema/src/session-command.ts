import { z } from 'zod';
import { SceneSiteS } from './primordial.js';
import { RentPolicyS } from './parcel.js';
import { SlotFillS } from './slot-fill.js';
import { HouseAmbitionIdS } from './ambition.js';
import { ProseModeS } from './prose.js';
import { CovertResponseS, CovertPurposeS, CovertPreparationS } from './covert.js';

/** Initial archived wording, not the reader's current preference. Needed before the first input exists. */
export const ReplayOriginS = z.object({
  proseMode: ProseModeS,
  catalogueEmpty: z.literal(true).optional(),
}).strict();
export type ReplayOrigin = z.infer<typeof ReplayOriginS>;

export const PedigreeGradeS = z.enum(['bramme', 'caster']);
export type PedigreeGrade = z.infer<typeof PedigreeGradeS>;
export const RecordOptionS = z.enum(['record', 'omit', 'embellish']);

/** The Table's external order vocabulary, shared by the engine and saved inputs. */
export const TableOrderS = z.union([
  z.object({ kind: z.literal('mysticSearch') }).strict(),
  z.object({ kind: z.literal('mysticHire'), person: z.string(), working: z.string(), target: SceneSiteS, bindings: z.record(z.string(), z.string()).optional() }).strict(),
  z.object({ kind: z.literal('mysticCommission'), person: z.string(), working: z.string(), patron: z.string() }).strict(),
  z.object({ kind: z.literal('mysticReturn'), person: z.string(), promise: z.string() }).strict(),
  z.object({ kind: z.literal('covertPrepare'), opportunity: z.string(), operative: z.string(), purpose: CovertPurposeS, preparation: CovertPreparationS }).strict(),
  z.object({ kind: z.literal('covertWithdraw'), operation: z.string() }).strict(),
  z.object({ kind: z.literal('covertDefend'), threat: z.string(), guards: z.array(z.string()).max(3), response: CovertResponseS }).strict(),
  z.object({ kind: z.literal('releaseIntruder'), threat: z.string() }).strict(),
  /** Pay the incident's fixed ransom once and bring a captive family member home. */
  z.object({ kind: z.literal('ransom'), person: z.string() }).strict(),
  /** Put somebody on a book. Costs them years, and the house nothing. */
  z.object({ kind: z.literal('study'), person: z.string(), book: z.string() }).strict(),
  /** Pay once for a physical shelf copy to spend a fixed term with the binder. */
  z.object({ kind: z.literal('restore'), book: z.string() }).strict(),
  /**
   * Special education, §13's price table: 40 crowns for a full term, and the
   * child comes out of it measurably better at one thing.
   */
  z.object({ kind: z.literal('tutor'), person: z.string(), attr: z.string() }).strict(),
  /** Put somebody in a post. */
  z.object({ kind: z.literal('career'), person: z.string(), career: z.string() }).strict(),
  /** How high the house will go at the next auction, in crowns. */
  z.object({ kind: z.literal('bid'), ceiling: z.number().finite() }).strict(),
  /**
   * THE HOUSE'S OWN BID ON ONE LOT — coin, an heirloom, or a collected marriage
   * promise (#1184), and `null` to withdraw. It outranks the ceiling and the
   * steward for that lot. Favours remain retired until they have a source.
   */
  z.object({ kind: z.literal('lotBid'), lot: z.string(), bid: z.union([z.object({ currency: z.literal('coin'), amount: z.number().finite() }).strict(), z.object({ currency: z.literal('heirloom'), heirloom: z.string() }).strict(), z.object({ currency: z.literal('marriage_promise') }).strict(), z.null()]) }).strict(),
  /** Pay a broker to bring a missing common affinity book to a sale in twelve years. */
  z.object({ kind: z.literal('seekBook'), book: z.string() }).strict(),
  /**
   * Pay the record-keepers to search for one unrecovered Ledger clause.
   * Available only once a successful Unmaking recipient has actually attained
   * Demigod and is waiting on the Ledger.
   */
  z.object({ kind: z.literal('seekClause') }).strict(),
  /** Put the family's prepared Great Work on the docket. Its outcome still uses the event's one commit path. */
  z.object({ kind: z.literal('unmaking') }).strict(),
  z.object({ kind: z.literal('vesselRite') }).strict(),
  z.object({ kind: z.literal('greatRite') }).strict(),
  /**
   * TRY A FORCING RITE ON A BOY (§11, #1817). `rite` is a template that
   * declares `forcing`, `person` the boy. Dockets the authored rite with him
   * cast; its own outcomes and dangers decide what comes of it.
   */
  z.object({ kind: z.literal('forcingRite'), rite: z.string(), person: z.string() }).strict(),
  /** Keep somebody off the marriage market, or put them back on it. */
  z.object({ kind: z.literal('withhold'), person: z.string(), hold: z.boolean() }).strict(),
  /**
   * NAME A LEARNED READER TO A STANDING MYSTIC DUTY (#1873): one working, one
   * real place. Pays the preparation now, sets their book down, and serves
   * every year it is paid for and they are there — no renewal, no question.
   */
  z.object({ kind: z.literal('mysticAssign'), person: z.string(), working: z.string(), target: SceneSiteS, bindings: z.record(z.string(), z.string()).optional() }).strict(),
  /** End a standing duty. Their book resumes if the copy is still on the shelf. */
  z.object({ kind: z.literal('mysticRelease'), assignment: z.string() }).strict(),
  /**
   * WHO THE HOUSE MARRIES WHEN THE PLAYER IS NOT ASKED (issue #41).
   *
   * The Match is one chapter beat a generation — measured, about 46 hands
   * against 547 marriages in a thousand years. Choosing perfectly on eight
   * percent of the weddings cannot move a number the other ninety-two percent
   * are quietly deciding, and until this order the house made those with no
   * regard to the one thing §7 says marriage is for.
   *
   * `in` keeps the blood in the family and pays for it in every currency a
   * marriage buys; `out` sells the blood for money, standing and allies.
   * Neither is the safe answer, which is the point.
   */
  z.object({ kind: z.literal('marriages'), policy: z.union([z.literal('in'), z.literal('out'), z.literal('as_it_falls')]) }).strict(),
  /**
   * THE SCION (issue #61). The one order about a PERSON rather than a
   * policy: name who the house is building the ladder on. His marriage
   * concentrates the blood regardless of `marriagePolicy`, and he wins the
   * season's hand over another expresser the weight table would otherwise
   * call a tie. He also goes to the head of the steward's reading queue
   * without a coin toss, takes the longest useful book on the shelf rather
   * than the shortest, is bought a term in `mind` before the die is asked,
   * and holds no post the steward would otherwise have placed him in — see
   * `runStandingOrders` and `placePosts`. `null` withdraws the programme.
   *
   * Concentrating everything the house has onto one man is a cost as well
   * as a bet: every cadet hall that is not his reads a small, standing
   * grievance for as long as he stands (`people/branches.ts`,
   * `GRIEVANCE_SCION_FED`). And naming the next one is not automatic when
   * he dies — see `world.scionVacant` — because a family that quietly
   * reassigned the role to whoever was left would not be a family the
   * player built anything with. That is a decision for the table, same as
   * this one.
   */
  z.object({ kind: z.literal('scion'), person: z.union([z.string(), z.null()]) }).strict(),
  /**
   * THE HEIR (issue #61, Stage E4). A second name beside the Scion's, so
   * the house is building a PAIR rather than betting everything on one man
   * §22's own terminal irony can starve by the same act that made him:
   * measured, a Scion strong enough to reach the Vessel or beyond leaves no
   * one else within reach of Demigod, because the books, the tutor's terms
   * and the season's hands he wins are the same finite things a second man
   * would have needed. The heir gets every rule the Scion gets — he reads
   * first after the Scion, takes the longest book left once the Scion has
   * had his, is bought a term in `mind` if the Scion's is already spoken
   * for, wins the season's hand over anyone but the Scion, marries in
   * regardless of `marriagePolicy`, and holds no post — one priority tier
   * behind, on every one of them, never sharing a year's book or a
   * season's hand WITH him. Cannot be set to the Scion's own person: a
   * house does not build a pair out of one man. `null` withdraws the
   * second half of the programme without touching the first.
   *
   * Naming the next heir when this one dies or becomes the guardian is not
   * automatic, for the same reason the Scion's own successor is not — see
   * `world.scionHeirVacant`.
   */
  z.object({ kind: z.literal('scionHeir'), person: z.union([z.string(), z.null()]) }).strict(),
  /**
   * BUY A GRANDMOTHER (concept §7, world §11 and §13).
   *
   * §7: *"A dowry is not money. Great houses negotiate in lineage
   * documentation... Forging them is an industry."* World §11 publishes the
   * industry's rates, which is a strong hint that the player is meant to be
   * able to walk in and pay them: 25 crowns for a pedigree good enough for
   * Bramme, 120 for one good enough for Caster.
   *
   * The cheap one is not merely worse, it covers one generation fewer AND is
   * caught roughly four times as often (`papers.ts`). Which is the decision:
   * a poor house with a thin record can have papers now and a Discrepancy
   * later, or it can decline the match.
   */
  z.object({ kind: z.literal('pedigree'), person: z.string(), grade: PedigreeGradeS }).strict(),
  /**
   * THE BOND (world §12). Advance a sum against service, or tear it up.
   *
   * *"Nobody in this world is a slave... People are held by debt, custom,
   * contract and having nowhere else to go, which is sufficient."* `bind` is
   * the debt; `free` is the only way out of one that does not cost the
   * servant thirty years. Both are decisions about what kind of house this is,
   * which is the register the Table is written in.
   */
  z.object({ kind: z.literal('bond'), person: z.string(), op: z.literal('bind'), marks: z.number().finite() }).strict(),
  z.object({ kind: z.literal('bond'), person: z.string(), op: z.literal('free') }).strict(),
  /**
   * THE LAND MARKET (issue #91, Phase B — #94). `buy` takes a lot currently
   * open (`LandView.market`); `sell` gives up a held parcel for a price at a
   * discount to buying, and refuses the home demesne, which is not for sale.
   */
  z.object({ kind: z.literal('buy'), parcel: z.string() }).strict(),
  z.object({ kind: z.literal('sell'), parcel: z.string() }).strict(),
  /**
   * RENTS (issue #94). The steward's floor is `customary` — a house whose
   * player never opens the table still behaves like a house, and does not
   * squeeze its tenants to do it. `hard` and `rack` buy more income for
   * discontent and an inherited grudge.
   */
  z.object({ kind: z.literal('rents'), policy: RentPolicyS }).strict(),
  /** Drainage, mostly (world §5) — a term against a held parcel's yield, the same shape a tutor's term against a person's. */
  z.object({ kind: z.literal('improve'), parcel: z.string() }).strict(),
  /**
   * ENDOW A CADET BRANCH WITH LAND, OR RECALL IT (issue #91, Stage H, ruled
   * 2026-09-07: a branch may hold land, seat protected). `branch: null`
   * recalls the parcel to the seat, the same `person: string | null` shape
   * `scion`/`scionHeir` use for "set or withdraw" — endowing a branch is a
   * decision the player re-makes, silently, every time they look at the
   * plat, and it needs no separate verb for taking it back.
   */
  z.object({ kind: z.literal('endow'), parcel: z.string(), branch: z.union([z.string(), z.null()]) }).strict(),
  /**
   * BUY THE WARDSHIP BACK (issue #91, world "Taxes": "Buying the wardship
   * back is customary"). Only valid while `TableView.wardship` is present
   * and `boughtBack` is false; ends the land-income diversion, not the
   * minority — see `people/succession.ts`'s `buyBackWardship`.
   */
  z.object({ kind: z.literal('buyBackWardship') }).strict(),
  /**
   * THE LONG WAIT (§11, issue #1794). Stop waiting for a grown man of the line
   * who has never woken. He will not wake now, and the succession passes over
   * him as it would a mundane man (`people/succession.ts`). Permanent.
   */
  z.object({ kind: z.literal('declareMundane'), person: z.string() }).strict(),
]);
export type TableOrder = z.infer<typeof TableOrderS>;

/** The player's orders for a commitment already raised by the story. */
export const MusterOrderS = z.discriminatedUnion('op', [
  z.object({ op: z.literal('reinforce'), men: z.number().finite() }).strict(),
  z.object({ op: z.literal('buy'), position: z.string() }).strict(),
  z.object({ op: z.literal('withdraw') }).strict(),
]);
export type MusterOrder = z.infer<typeof MusterOrderS>;

/** External inputs only. Outcomes remain independently generated by the existing verbs. */
export const SessionCommandS = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('advance'), years: z.number().finite(), decider: z.enum(['ask', 'chronicler']) }).strict(),
  z.object({ kind: z.literal('order'), order: TableOrderS }).strict(),
  z.object({ kind: z.literal('muster'), order: MusterOrderS }).strict(),
  z.object({ kind: z.literal('choose'), decision: z.string(), choice: z.string(), cast: SlotFillS }).strict(),
  z.object({ kind: z.literal('send'), decision: z.string(), cast: SlotFillS }).strict(),
  z.object({ kind: z.literal('record'), decision: z.string(), option: RecordOptionS }).strict(),
  z.object({ kind: z.literal('match'), decision: z.string(), card: z.string() }).strict(),
  z.object({ kind: z.literal('declineHand'), decision: z.string() }).strict(),
  z.object({ kind: z.literal('letHimDecide') }).strict(),
  z.object({ kind: z.literal('name'), person: z.string(), name: z.string() }).strict(),
  z.object({ kind: z.literal('nameParcel'), parcel: z.string(), name: z.string() }).strict(),
  z.object({ kind: z.literal('keepSuggestedName'), person: z.string() }).strict(),
  z.object({ kind: z.literal('keepSuggestedNames') }).strict(),
  z.object({ kind: z.literal('delegateChoice'), event: z.string(), choice: z.string().nullable() }).strict(),
  z.object({ kind: z.literal('delegateRecord'), event: z.string(), option: RecordOptionS.nullable() }).strict(),
  z.object({ kind: z.literal('setAmbition'), ambition: HouseAmbitionIdS.nullable() }).strict(),
]);
export type SessionCommand = z.infer<typeof SessionCommandS>;
