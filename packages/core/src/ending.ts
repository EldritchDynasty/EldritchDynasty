import type { EndingDef, EndingId, Rung } from '@ed/schema';
import { assertNever } from '@ed/schema';
import type { ChronicleEntry, SimCtx, WorldState } from './world.js';
import { RUNGS, rungIndex, rungTitle, measureAscension } from './ascension.js';
import { prologueTriad, prologueView } from './prologue.js';
import { END_YEAR, campaignDef } from './campaign.js';
import { renderContentProse } from './prose.js';
import { msg } from './messages.js';

// Compatibility export: existing gates and clients import the term from ending.ts.
// The value itself lives in campaign.ts so pacing code does not depend on endings.
export { END_YEAR } from './campaign.js';

/**
 * THE LAST NIGHT (concept §23, issue #39).
 *
 * The run had no terminus. `stepYear` was a clock and nothing stopped it, and
 * grepping `core` for 2042 returned comments about balance. The five endings
 * — where the whole Long Line lands — were prose in a brief and zero
 * lines of code.
 *
 * ─── The creditor reads the chronicle, not the world ────────────────────────
 *
 * §6 is explicit and it is the entire thesis of the game: *"a house that
 * recorded everything faithfully arrives poor in Respect and rich in
 * knowledge; a house that embellished everything arrives exalted, revered, and
 * unable to prove a single thing it needs to prove."*
 *
 * So selection runs off `world.chronicle`. `readTheChronicle` is the only
 * thing that decides, and the one fact it takes from outside the book is
 * whether anybody is sitting at the table to be read to — which is not a fact
 * about the house's achievements, it is a fact about the room.
 *
 * That distinction is testable, and `ending.test.ts` tests it: strip the page
 * that attests a rung and the ending changes, with `world.ascension` untouched.
 * A selector reading `world.ascension.best` would have built the systems game
 * and deleted the story one, and nothing would have said so.
 *
 * ─── Three of the five cannot fire yet ──────────────────────────────────────
 *
 * The rites are not built (#43) and no measured run reaches God (#41). They
 * are written anyway: an ending that cannot fire yet is a target for those
 * issues, and an ending nobody wrote is not. #42 grades the distribution once
 * they exist.
 */

/** The term is owned by campaign.ts; A Long Line is 1042–1542 (#133). */

/**
 * Living, and OF THE BLOOD — the one fact `readTheChronicle` takes from
 * outside the book, and now the one `stepYear` checks every year as well
 * (issue #42). A guardian is not at the table: his `status` is `guardian`,
 * never `alive` again (invariant 3), so he is excluded by the status filter
 * alone and needs no separate carve-out.
 *
 * The single definition, because `stepYear` and `readTheChronicle` asking
 * this in two different ways is how one of them quietly drifts — the same
 * reason `commitOutcome` is the one place an outcome applies.
 */
export function livingBlood(w: WorldState): number {
  return w.people.blood(w.playerHouse).filter((p) => p.status === 'alive').length;
}

/**
 * The flag the God rite sets when it fails at the last step, and the seam
 * #43's rites write to. It is a world flag rather than a field because the
 * rites are authored content: the effect vocabulary can already set one, and
 * an ending that content can reach is an ending content can be written toward.
 */
export const GOD_RITE_FAILED = 'god_rite_failed';

/**
 * WHAT A STANDING LIE WEIGHS, by the severity the author gave it.
 *
 * The same 1 : 2 : 4 the auction already prices these at (`SEVERITY_PRICE`,
 * 220 / 500 / 900) rather than a second scale invented here — a discrepancy
 * that costs more to buy is worth more to have bought.
 *
 * An unrecognised severity weighs the least. The map on `WorldState` types the
 * field as a bare string and the effect verb defaults it to `minor`, so the
 * conservative reading of an unknown one is the cheap one: a typo in a content
 * file should not quietly bill a house four times over.
 */
/**
 * What a standing lie costs at the reading. Exported because
 * `burying.slow.test.ts` measures the bill the act puts down and has to weigh
 * it the same way the creditor does; a second copy of these three numbers in a
 * test would go stale silently, which is the failure this repo is made of.
 */
export const SEVERITY_WEIGHT: Record<string, number> = { minor: 1, major: 2, total: 4 };

/**
 * HOW MUCH HOUSE-AUTHORED UNPROVEN BOOK COSTS A RUNG
 * (§6, §29.3's third bite).
 *
 * Eighteen was the measured all-discrepancy calibration in the thousand-year
 * game. Once proof debt is restricted to claims the house actually authored,
 * that is a different population, so the old scalar cannot simply be reused.
 * Issue #36 exposed two separate assumptions hidden inside that old number:
 *
 *  1. campaign length changed, so the same evidence density must be read over
 *     300 or 500 years rather than a millennium; and
 *  2. not every open Discrepancy is a lie the house authored. The Chronicle
 *     already carries exact provenance for Embellish pages, so ambient
 *     contradictions must not be charged as the house's proof debt.
 *
 * The authored-only ending sweep found 20 as the first reference value that
 * preserves the existing intentional-ending contract: scaled to the shipped
 * terms, that is 6 weighted authored lies for A Short Line and 10 for A Long
 * Line. This keeps provenance and density as separate decisions rather than
 * making ambient contradictions part of the family's proof debt.
 *
 * §29.4 also makes the debt reversible by act. The intentional ascendant
 * diagnostic therefore takes authored burying opportunities when offered;
 * content still rations those scenes, so this remains a consequence rather
 * than an automatic amnesty.
 */
export const UNSUPPORTABLE_PER_RUNG = 20;
const UNSUPPORTABLE_REFERENCE_YEARS = 1000;

function unsupportablePerRung(ctx: SimCtx): number {
  const years = campaignDef(ctx.world.campaign).years;
  return Math.max(1, Math.round(UNSUPPORTABLE_PER_RUNG * years / UNSUPPORTABLE_REFERENCE_YEARS));
}

/**
 * WHAT THE CREDITOR HAS IN FRONT OF IT.
 *
 * Everything here except `livingBlood` comes off the chronicle. `attested` in
 * particular is the highest rung the BOOK names — not the highest the house
 * reached — and the two are the same only for a house that wrote everything
 * down and kept it.
 *
 * AND THE GAP RUNS ONE WAY ONLY, TODAY (issue #77). Over the 120 thousand-year
 * runs that issue measured, across three pens — records everything, the
 * chronicler, embellishes always — the number of runs in which the house
 * reached higher than its book attests is 0. `attested` equalled
 * `world.ascension.best` in every one, whichever way the Record block was
 * answered.
 *
 * That is structural rather than a bug, and the structure is checkable without
 * running anything: `entry.rung` is written in exactly one place in `core`,
 * by `tickAscension`, the year the house first stands somewhere new, and it is
 * written truthfully. Nothing else ever writes one. So the book can LOSE a
 * claim — a page greyed, a page omitted, a rung now unsupportable — and it
 * cannot MAKE one. The house cannot write itself onto a rung it never stood
 * on, which is the thing the word "embellish" most plainly describes and the
 * one place the record layer stops short of its own vocabulary: `Claim`
 * already covers `attr`, `trait`, `death` and `deed`.
 *
 * RESOLVED, AND THE GAP NOW RUNS BOTH WAYS (issue #77). An embellishment may
 * write the house onto ONE rung above what it reached, and only while it holds
 * `eminent` — the lie the world is prepared to believe. See `forgeableRung` in
 * `events/decisions.ts` for the two gates and why they are those two.
 *
 * So `attested` may now exceed `world.ascension.best`, and `substantiated`
 * never can: it is capped at the truth below, which is what keeps a forged
 * rung a claim rather than an achievement, and keeps Apotheosis — which fires
 * on a SUBSTANTIATED god — out of reach of the pen.
 */
export interface Reckoning {
  /** Pages with something written on them. */
  pages: number;
  /** Dated blank lines. The blank is the artefact, and it is read too. */
  blanks: number;
  recorded: number;
  embellished: number;
  /** Embellishments somebody proved. A proven lie costs a tier and a reputation. */
  provenLies: number;
  /** Embellishments still standing on the last night. */
  standingLies: number;
  clauses: number;
  clausesTotal: number;
  /** The highest rung any surviving page attests. */
  attested: Rung;
  /** The same, in the words §22 uses for it — a client keeps no rung table of its own. */
  attestedTitle: string;
  /** The year the book first attested it, where it does. */
  attestedYear?: number;
  /**
   * WHAT THE BOOK CANNOT CARRY — OPEN discrepancies created by an
   * Embellish page, weighted by severity.
   *
   * Provenance matters: an ambient open Discrepancy is still visible in
   * standingLies, but it is not proof debt the house authored with its pen.
   * Standing ONLY, and the two states left out are left out for a reason.
   *
   * A PROVEN lie has already been paid for: §6 bills it a full Respect tier
   * and a scandal chain in the year it is caught, and charging it again at the
   * term is double billing. It is also nearly useless as a signal — measured,
   * it lands near seven whatever the player does with a pen, because it is
   * content firing rather than the house choosing.
   *
   * A BURIED lie is one the house successfully disposed of. §6's own framing
   * of this whole layer is *"you are not hiding Madness, you are maintaining a
   * story"*, and burying is what maintaining it looks like. It is the one act
   * that answers this bill, which is §29.4's fifth rule — reversible by act,
   * never by apology.
   */
  unsupportable: number;
  /**
   * Rungs the reading would not take. `attested` minus this is `substantiated`.
   */
  rungsWithheld: number;
  /**
   * WHAT THE CREDITOR WILL ACTUALLY TAKE, and the thing the ending is chosen
   * from.
   *
   * §6 ends on the sentence this field exists to make true: *a house that
   * embellished everything arrives exalted, revered, and unable to prove a
   * single thing it needs to prove.* Both halves are live at once and they do
   * not contradict — the house keeps its legend, because §6 also says a
   * discrepancy surviving to the term becomes part of the family's legend
   * permanently, and the Respect it bought is still on the books. What it does
   * not keep is PROOF. The creditor is not the world and is not impressed by
   * it; it is a counterparty holding a signed instrument, and it wants
   * evidence.
   *
   * So reverence and provability come apart here, which is the only place in
   * the game they ever do.
   */
  substantiated: Rung;
  /** The same in §22's words, for a client that keeps no rung table of its own. */
  substantiatedTitle: string;
  /**
   * HOW MANY OF THE BLOOD ARE STILL LIVING. Not a claim — a fact about the
   * family, and the one thing the book cannot say, because the house is not
   * there to have written it.
   *
   * Called `atTheTable` until it stopped meaning that. The name was apt while
   * it counted the household — people in a room — and became a lie the moment
   * it counted the line, which is the change that made `broken_line` reachable
   * at all. A field whose name describes its old semantics is worse than one
   * that never had a good name: it reads correct.
   *
   * This counted the HOUSEHOLD, and the household is not the line: it holds
   * retainers, wives married in, wards and servants, and the recurring cast is
   * re-minted for a thousand years whatever happens to the family. Measured
   * over sixty runs, the household's low-water mark was 9 in the worst run and
   * 10 at the median — a floor, not a distribution — so `broken_line` was
   * gated on an empty BUILDING and the ending named for a line ending could
   * not fire while anybody's cook was alive.
   *
   * The guardian is deliberately not counted. Daveed does not die (invariant
   * 3) and is of the blood, so counting him makes the family immortal by
   * construction; and §23's own sentence for this ending is *"the creditor
   * read the chronicle alone"*, which is a room with a ghost in it.
   */
  livingBlood: number;
  /** Who sits at the head of it, if anybody does. */
  head?: { name: string; rung: Rung };
}

/**
 * A page counts as evidence if it is still legible on the last night: written,
 * and not greyed out as a thing known to have existed and gone.
 */
function attests(entry: ChronicleEntry): boolean {
  return entry.text !== null && !entry.greyed;
}

export function readTheChronicle(ctx: SimCtx): Reckoning {
  const w = ctx.world;

  let pages = 0;
  let blanks = 0;
  let recorded = 0;
  let embellished = 0;
  let attested: Rung = 'none';
  let attestedYear: number | undefined;

  for (const entry of w.chronicle) {
    if (entry.text === null) blanks += 1;
    else pages += 1;
    if (entry.record === 'record') recorded += 1;
    if (entry.record === 'embellish') embellished += 1;

    if (entry.rung && attests(entry) && rungIndex(entry.rung) > rungIndex(attested)) {
      attested = entry.rung;
      attestedYear = entry.year;
    }
  }

  let provenLies = 0;
  let standingLies = 0;
  let unsupportable = 0;
  const embellishedDiscrepancies = new Set(w.chronicle.flatMap((entry) =>
    entry.record === 'embellish' && entry.discrepancyId ? [entry.discrepancyId] : []));
  for (const [id, d] of w.discrepancies.entries()) {
    if (d.state === 'proven') provenLies += 1;
    else if (d.state === 'open') {
      standingLies += 1;
      if (embellishedDiscrepancies.has(id)) {
        unsupportable += SEVERITY_WEIGHT[d.severity] ?? SEVERITY_WEIGHT['minor']!;
      }
    }
  }

  // THE BLUFF IS CALLED HERE, and this is the whole of §29.3's third bite.
  //
  // The book claims a rung. The creditor tests the claim against what else is
  // in the book, and a page it will not take is a page that cannot hold one
  // up. Nothing is hidden and nothing is stored: the lies were written down
  // when they were told, and this is the year somebody reads them together.
  const rungsWithheld = Math.floor(unsupportable / unsupportablePerRung(ctx));
  const read = RUNGS[Math.max(0, rungIndex(attested) - rungsWithheld)] ?? 'none';

  // AND THE TRUTH IS THE CEILING ON WHAT CAN BE SUBSTANTIATED (issue #77).
  //
  // The book can now claim one rung more than the house reached — see
  // `forgeableRung` — so `attested` is no longer bounded by
  // `world.ascension.best` and this line stops being a formality.
  //
  // Withholding alone would not hold it. `rungsWithheld` counts what is
  // STANDING, so a house that forged a rung and then cleared its book (lies
  // proven, lies bought and buried) would arrive with nothing outstanding and
  // have the forgery read back to it as fact. That is not a bluff being
  // called, it is the bluff working — and at the top of the ladder it would
  // hand Apotheosis, the ending the whole game is named for, to a house that
  // simply wrote *god* down while eminent.
  //
  // So: a rung nobody in the house ever stood on cannot be substantiated by
  // any amount of tidy bookkeeping. This is a no-op on every run recorded
  // before #77 — `attested` equalled `best` in all 120 of them — and it is
  // what makes the gap two-directional in the way `Reckoning` documents:
  // the book may say MORE than the house did, and the reading never will.
  const truth = rungIndex(w.ascension.best);
  const substantiated = RUNGS[Math.min(rungIndex(read), truth)] ?? 'none';

  const household = w.people.household(w.playerHouse, w.year);
  const foremost = measureAscension(ctx).foremost;
  const head = household.find((p) => p.castSlots.includes('head'));

  const reckoning: Reckoning = {
    pages,
    blanks,
    recorded,
    embellished,
    provenLies,
    standingLies,
    clauses: Math.min(w.clausesRecovered.size, campaignDef(w.campaign).clauses),
    clausesTotal: campaignDef(w.campaign).clauses,
    attested,
    attestedTitle: rungTitle(attested),
    unsupportable,
    rungsWithheld,
    substantiated,
    substantiatedTitle: rungTitle(substantiated),
    livingBlood: livingBlood(w),
  };
  if (attestedYear !== undefined) reckoning.attestedYear = attestedYear;
  // Whoever is in the chair, described by the rung the BOOK grants the house
  // — the creditor is not appraising him, it is reading about him.
  if (head) reckoning.head = { name: head.name, rung: attested };
  else if (foremost) reckoning.head = { name: foremost.name, rung: attested };
  return reckoning;
}

/**
 * WHICH ENDING.
 *
 * A closed union and no permissive default anywhere near it. A fall-through in
 * the condition evaluator once made an event fire unconditionally for a
 * thousand years; a fall-through here would pick the same ending forever, and
 * it would look exactly like a game with one ending — which is why the render
 * side (`epilogueOf`) ends in `assertNever` and this side is total by
 * construction: every rung on the ladder lands somewhere.
 */
export function selectEnding(ctx: SimCtx): EndingId {
  const r = readTheChronicle(ctx);

  // Nobody is left to be read to. This is the one thing the book cannot say,
  // because the house is not there to have written it.
  if (r.livingBlood === 0) return 'broken_line';

  const campaign = campaignDef(ctx.world.campaign);

  // The rite went as far as the last step and stopped. This is a Long-Line
  // ending: Short explicitly does not promise the God/Unmaking endgame.
  if (ctx.world.flags.get(GOD_RITE_FAILED) && campaign.endings.includes('unmade')) return 'unmade';

  // FROM HERE ON IT IS `substantiated` AND NOT `attested`, which is §6's whole
  // sentence in one substitution. The book's claim chose the ending until the
  // third bite of §29.3 was built; what the book can HOLD UP chooses it now,
  // and for a house that kept an honest record the two are the same number.
  if (r.substantiated === 'god' && campaign.endings.includes('apotheosis')) return 'apotheosis';

  // Strong enough to be interesting to it, and not strong enough to refuse.
  // This stays ahead of Short's contract settlement: a family that made itself
  // worth collecting does not escape merely because its smaller Ledger is tidy.
  if (rungIndex(r.substantiated) >= rungIndex('hierophant')) return 'devoured';

  // #66: Short's missing axis. Recovery alone is not settlement: §6 says the
  // creditor reads the book back, and this issue's ending profile explicitly
  // includes what the chronicle can PROVE. A complete Short contract therefore
  // settles only when the book's highest claim survives that reading intact.
  // If the book says more than the creditor can substantiate, the house lands
  // in Forgotten instead — the existing ending for an account that could not
  // hold itself up on the last night.
  if (
    campaign.endings.includes('settled')
    && r.clauses >= r.clausesTotal
    && r.attested === r.substantiated
  ) return 'settled';

  // Survival as anticlimax. The creditor arrives, reads, and does not collect.
  return 'forgotten';
}

/**
 * End the run. Once — the collection year happens to a house a single time, and a save taken
 * afterwards loads into a house it has already happened to.
 */
export function closeTheLedger(ctx: SimCtx): EndingId {
  const w = ctx.world;
  if (w.ending) return w.ending.id;

  const id = selectEnding(ctx);
  w.ending = { id, year: w.year };

  // The last page, written after the reading, by whoever was left to write it.
  // It is deliberately not evidence: selection has already happened, and a
  // chronicle that wrote its own ending into the record the ending was chosen
  // from would be the one circular thing in the game.
  w.chronicle.push({
    year: w.year,
    weight: 'illuminated',
    title: msg(ctx, 'ending.term_title', 'The Term'),
    text: msg(ctx, 'ending.term', 'The book was read, from the first page to the last, and the blanks were read too.'),
    named: true,
  });

  // AND WHAT IT WOULD NOT TAKE.
  //
  // §29.3's guard rail, applied to the third bite as it already is to the
  // second: a cost the player cannot reconstruct is indistinguishable from bad
  // dice. The embellishments are each already a dated page with a name on
  // them; this is the line that says they were counted, and against what.
  //
  // Written AFTER selection and carrying no `rung`, for the same reason the
  // Term entry is: a chronicle that wrote its own ending into the record the
  // ending was read from would be the one circular thing in the game.
  const r = readTheChronicle(ctx);
  if (r.rungsWithheld > 0) {
    w.chronicle.push({
      year: w.year,
      weight: 'illuminated',
      title: msg(ctx, 'ending.withheld_title', 'What Could Not Be Shown'),
      text: msg(ctx, 'ending.withheld',
        'The house was written as {ATTESTED} and was read as {SUBSTANTIATED}. {LIES} pages were asked after, and the family had nothing to set beside them but the pages themselves.',
        { ATTESTED: rungTitle(r.attested), SUBSTANTIATED: rungTitle(r.substantiated), LIES: String(r.standingLies) }),
      named: true,
    });
  }
  return id;
}

/**
 * THE RING (concept §23). The prologue's triad, restated, with exactly one
 * element replaced — same cadence, same three parts, one substitution. The
 * `ending/ring` rule fails the build on two.
 */
export interface RingBeat {
  given: string;
  owed: string;
  /** Which half this ending replaced, where it replaced one. */
  changed?: 'given' | 'owed';
}

export interface EpilogueView {
  id: EndingId;
  title: string;
  opening: string;
  ring: RingBeat[];
  /** The prologue's own last line, so the closing has something to reach back to. */
  thesis: string;
  /** Short, plain, and the last thing on screen. */
  closing: string;
  /** What happened, in one sentence, for the one line on the page that is not myth. */
  summary: string;
  reckoning: Reckoning;
  /**
   * What was read out. Every blank, every embellishment, and every illuminated
   * page — which is to say the holes, the lies, and the things the house
   * thought were worth a whole page. In the order they happened.
   */
  read: ChronicleEntry[];
  /** What the house was called, and what it asked for in 1042. */
  founding?: { houseName: string; heirloom: string; heirloomName: string; grudge: string; grudgeName: string };
  year: number;
}

/** How much of the book the last night quotes back. */
export const EPILOGUE_PAGES = 30;

export function endingDef(ctx: SimCtx, id: EndingId): EndingDef | undefined {
  return ctx.content.ending(id);
}

function endingProse(ctx: SimCtx, def: EndingDef, path: string, original: string): string {
  const file = ctx.content.sourceOf(String(def.id));
  if (file === undefined) return original;
  return renderContentProse(
    ctx,
    file,
    `endings[id=${encodeURIComponent(String(def.id))}].${path}`,
    original,
  );
}

/**
 * The closing text, assembled from the chronicle the player wrote.
 *
 * Undefined until the run has ended — an epilogue for a house still living in
 * 1400 is a spoiler with a bug in it.
 */
export function epilogueOf(ctx: SimCtx): EpilogueView | undefined {
  const w = ctx.world;
  if (!w.ending) return undefined;

  const def = endingDef(ctx, w.ending.id);
  const prologue = prologueView(ctx);
  const signing = prologueTriad(ctx);
  if (!def || !prologue || !signing) return undefined;

  const ring: RingBeat[] = signing.map((beat, i) => {
    if (i + 1 !== def.ring.beat) return { given: beat.given, owed: beat.owed };
    if (def.ring.given !== undefined) {
      return { given: endingProse(ctx, def, 'ring.given', def.ring.given), owed: beat.owed, changed: 'given' };
    }
    if (def.ring.owed !== undefined) {
      return { given: beat.given, owed: endingProse(ctx, def, 'ring.owed', def.ring.owed), changed: 'owed' };
    }
    return { given: beat.given, owed: beat.owed };
  });

  const read = w.chronicle
    .filter((e) => e.text === null || e.record === 'embellish' || e.weight === 'illuminated')
    .slice(-EPILOGUE_PAGES);

  const reckoning = readTheChronicle(ctx);
  const ledger = reckoning.clauses === reckoning.clausesTotal
    ? msg(ctx, 'ending.ledger.complete',
      'The Ledger was complete: all {TOTAL} clauses were recovered.',
      { TOTAL: String(reckoning.clausesTotal) })
    : msg(ctx, 'ending.ledger.unresolved',
      'The Ledger remained unresolved: {CLAUSES} of {TOTAL} clauses were recovered.',
      { CLAUSES: String(reckoning.clauses), TOTAL: String(reckoning.clausesTotal) });

  const view: EpilogueView = {
    id: w.ending.id,
    title: endingProse(ctx, def, 'title', def.title),
    opening: endingProse(ctx, def, 'opening', def.opening),
    ring,
    thesis: prologue.thesis,
    closing: endingProse(ctx, def, 'closing', def.closing),
    summary: `${endingSummary(ctx, w.ending.id, reckoning)} ${ledger}`,
    reckoning,
    read,
    year: w.ending.year,
  };

  if (w.founding) {
    view.founding = {
      houseName: w.founding.houseName,
      heirloom: w.founding.heirloom,
      // Use exactly the reviewed wording offered at the signing. The founding
      // identity and save remain untouched; a changed/removed content item
      // still falls back to its original name or id.
      heirloomName: prologue.heirlooms.find((h) => h.heirloom === w.founding!.heirloom)?.name
        ?? ctx.content.heirloom(w.founding.heirloom)?.name ?? w.founding.heirloom,
      grudge: w.founding.grudge,
      grudgeName: prologue.grudges.find((g) => g.house === w.founding!.grudge)?.houseName
        ?? ctx.content.house(w.founding.grudge)?.name ?? w.founding.grudge,
    };
  }
  return view;
}

/**
 * One line naming what the ending is, for a client that wants to say it
 * plainly somewhere the elevated register would be wrong.
 *
 * INVARIANT 5: a closed union, ending in `assertNever`. This is the site the
 * compiler will point at the day a sixth ending is declared, which is the
 * whole reason it is written as a switch rather than as a lookup table.
 */
export function endingSummary(ctx: SimCtx, id: EndingId, r: Reckoning): string {
  switch (id) {
    case 'apotheosis':
      return msg(ctx, 'ending.summary.apotheosis',
        'A god was made, and the book can show it: {RUNG}, on the page.',
        { RUNG: rungTitle(r.attested) });
    case 'unmade':
      return msg(ctx, 'ending.summary.unmade',
        'The rite failed at the last step, and what was in the blood went out of it.');
    case 'broken_line':
      return msg(ctx, 'ending.summary.broken_line',
        'Nobody was at the table. The creditor read the chronicle alone.');
    case 'settled':
      return msg(ctx, 'ending.summary.settled',
        'The house recovered all {TOTAL} clauses of its shorter contract. The creditor read the account, found it answered, and closed it.',
        { TOTAL: String(r.clausesTotal) });
    case 'forgotten':
      // A withheld attestation and a house that never climbed have different endings.
      if (r.rungsWithheld > 0 && rungIndex(r.attested) > rungIndex(r.substantiated)) {
        return msg(ctx, 'ending.summary.forgotten_withheld',
          'The book attests {RUNG} and could not hold it up. The creditor arrived, read, believed none of the parts that mattered, and did not collect.',
          { RUNG: rungTitle(r.attested) });
      }
      return msg(ctx, 'ending.summary.forgotten',
        'The house survived to the term and never passed {RUNG}. The creditor arrived, read, and did not collect.',
        { RUNG: rungTitle('adept') });
    case 'devoured':
      return msg(ctx, 'ending.summary.devoured',
        'The book attests {RUNG}, which was enough to be worth the journey and not enough to argue with.',
        { RUNG: rungTitle(r.substantiated) });
    default:
      return assertNever(id);
  }
}
