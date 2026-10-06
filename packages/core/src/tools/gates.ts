/**
 * CI GATES — checks that are only worth writing once the thing they guard
 * exists, so each subcommand lands in the commit that makes it non-vacuous
 * (issue #6) rather than being authored speculatively against a shape that
 * might still change.
 *
 *   npx tsx packages/core/src/tools/gates.ts <subcommand>
 *
 * Every subcommand prints what it measured and exits non-zero on failure, so
 * CI can call it directly.
 *
 * EVERY GATE IS A FUNCTION OVER A BUNDLE, and returns its verdict rather than
 * printing it. That is not tidiness: a gate nobody has ever seen fail is
 * indistinguishable from a gate that cannot fail, and the only way to tell the
 * two apart is to hand one a bundle it must reject and watch it do so. The
 * slow gates take their sample size as an argument for the same reason —
 * `gates.test.ts` runs them at two seeds and five years, which is far too
 * small to mean anything about the game and exactly the right size to prove
 * the gate still has teeth.
 */
import { loadContent } from '@ed/content';
import { writeFileSync } from 'node:fs';
import {
  indexContent, validateBundle, vocabulary,
  type Condition, type Content, type ContentBundle, type EventTemplate,
} from '@ed/schema';
import { bootstrap, runYears } from '../sim.js';
import { TEST_FAMILIES } from './testFamilies.js';
import { resolveSlots } from '../events/slots.js';
import { makeRng } from '../rng.js';
import { declaredOutcomes, outcomeKey } from '../events/reach.js';
import { gateLadder } from './ladder-gate.js';
import { playGateBatch } from './gate-batch.js';
import { runFireRateGate, type FireRateGateOptions } from './fire-rate-gate.js';
import { gateWar } from './war-gate.js';
import { gateEndings } from './ending-gate.js';
import { gateShortLine } from './short-line-gate.js';
import { gateFoundingRecovery } from './bottleneck-gate.js';
import { gateLand } from './land-gate.js';
import { gateBlood } from './blood-gate.js';
import { gateLibraryNeutrality } from './library-gate.js';
import { gateSigning } from './signing-gate.js';
import { gateUnwitnessedOutcomeReach } from './outcome-reach-blocking.js';
import {
  MADNESS_FLOOR, MIND_FLOOR, POWER_FLOOR, eldritchPower, madnessOf, mindOf, standingOf,
} from '../ascension.js';
import type { Rung } from '@ed/schema';
import { phenotypeOf } from '../people/factory.js';
import { ELDRITCH_GIFT, ELDRITCH_REACH } from '../genetics/expression.js';
import { CAMPAIGN_YEARS, START_YEAR } from '../campaign.js';
import { vocabularyAuthorship } from './vocabulary-authorship.js';
import type { BlockingGateId } from './gate-registry.js';

// Not `1000 + i * 7`: under the corrected blood count (issue #42), most of
// that formula's terms end their line before 2042, so the clause gate was
// reading how many Ages a DEAD house lived through rather than a living
// one's. These twelve are individually confirmed to reach the full 1000
// years post-#42 (see BALANCE-LOG's "the line runs out mid-run" entry).
const SEEDS = [1001, 1003, 1004, 1008, 1013, 1016, 1019, 1020, 1024, 1025, 1026, 1031];

/** What a gate hands back: the verdict, and the lines it would have printed. */
export interface GateResult {
  ok: boolean;
  lines: string[];
}

type Source = ContentBundle | Content;

/**
 * GATE 2 — slot-fillability (issue #22). Non-vacuous only once the test
 * families exist: a template's slots either can or cannot be cast, and that
 * question was previously only ever answered by accident, whenever a real
 * simulated run happened to reach a household shaped right for it. This asks
 * it directly, against six households at the edges of the space — a template
 * that cannot cast against ANY of them is starved quietly, for as long as
 * nobody's run happens to look like one of these, which the fire-rate gate
 * (4) will eventually notice and this gate exists to catch earlier.
 *
 * Age scoping and `conditions` are deliberately NOT checked here — that is
 * frequency/condition gating, already this file's and `rules.ts`'s business.
 * This asks the narrower question underneath it: if the moment ever comes,
 * is there anyone to cast?
 */
export function gateSlotFillability(source: Source = loadContent()): GateResult {
  const bundle = indexContent(source);
  const dead: string[] = [];

  /**
   * THE SIX HOUSEHOLDS ARE BUILT ONCE, not once per event.
   *
   * `fam.build()` bootstraps a whole world — six of them, and the loop below
   * runs over four hundred events, so this was up to 2,400 bootstraps to
   * answer a question that consults each household read-only. It cost 9.1s
   * of a fast lane that is supposed to be the fix-and-rerun loop, and
   * `gates.test.ts` calls this gate four times.
   *
   * Hoisting is safe because `resolveSlots` WRITES NOTHING to the ctx: `fill`,
   * `playerCast` and the party working set are all local to the call, and the
   * only state it touches on the way past is the lazy genome cache, which is
   * derived and deterministic (invariant 6 — a cache, recomputed, not
   * storage). Each event still gets its own `makeRng(1)`, so the draw a
   * template sees is the same draw it saw before. Verified by diffing the
   * gate's own output across the change.
   */
  const households = TEST_FAMILIES.map((fam) => fam.build(bundle));

  for (const e of bundle.events) {
    if (e.arc) continue; // arc nodes cast from their own binding, not the ambient pool
    if (!Object.keys(e.slots).length) continue; // nothing to fill

    const fillable = households.some((ctx) => resolveSlots(e, ctx, makeRng(1)).ok);
    if (!fillable) dead.push(String(e.id));
  }

  const lines = [`gate 2 (slot-fillability): ${bundle.events.length} events x ${TEST_FAMILIES.length} fixtures`];
  if (dead.length) {
    lines.push(`  FAIL: ${dead.length} event(s) cannot cast against any test family:`);
    for (const id of dead) lines.push(`    ${id}`);
  }
  return { ok: dead.length === 0, lines };
}

/**
 * POST-FILLABILITY (issue #125). Gate 2 asks whether a slot can be CAST at
 * all; this asks the narrower question the epic's opening measurement found
 * nobody had asked: of the eight careers, is there at least one template
 * that can only fire BECAUSE the post itself is held? A career bought and
 * held for forty years still lets `the_commission_bought` cast any
 * `family_member` over 17 — gate 2 is happy, because someone can always be
 * cast — while causing not one scene from having been held. That was the
 * measured state of six of the eight posts before `career_lives.yaml`.
 *
 * "Gated on the post" means either: a slot filter naming the career (the
 * same `{ career: [...] }` Filter `rare_church.yaml`'s PRIEST slot always
 * used), or a `posts`/`postHeldFor` Condition naming it. Both are read
 * statically off the content, the same way gate 6 and gate 10 are — holding
 * a post is authored, not rolled, so a run is not needed to answer this.
 */
export function gatePostFillability(source: Source = loadContent()): GateResult {
  const bundle = indexContent(source);
  const missing: string[] = [];

  for (const career of bundle.careers) {
    const gated = bundle.events.some((e) => eventGatesOnCareer(e, career.id));
    if (!gated) missing.push(career.id);
  }

  const lines = [`gate (post-fillability): ${bundle.careers.length} careers`];
  if (missing.length) {
    lines.push(`  FAIL: ${missing.length} career(s) with no template gated on the post itself:`);
    for (const id of missing) lines.push(`    ${id}`);
  }
  return { ok: missing.length === 0, lines };
}

function eventGatesOnCareer(e: EventTemplate, careerId: string): boolean {
  for (const slot of Object.values(e.slots)) {
    for (const f of slot.filters) {
      if ('career' in f && f.career.includes(careerId)) return true;
    }
  }
  return e.conditions ? conditionNamesCareer(e.conditions, careerId) : false;
}

function conditionNamesCareer(c: Condition, careerId: string): boolean {
  if ('all' in c) return c.all.some((x) => conditionNamesCareer(x, careerId));
  if ('any' in c) return c.any.some((x) => conditionNamesCareer(x, careerId));
  if ('not' in c) return conditionNamesCareer(c.not, careerId);
  if ('posts' in c) return !!c.posts.career?.includes(careerId);
  if ('postHeldFor' in c) return c.postHeldFor.career === careerId;
  return false;
}

/**
 * GATE 7 — the clause gate (issue #4). Per-Age assignment means which
 * clauses a run recovers now depends on which Ages it drew; the floor this
 * protects is the design's own — a run that reaches 2042 having recovered
 * three clauses should be rarer than the median, and the God rung (seven of
 * nine) needs the median run within striking distance of it.
 */
export function gateClauses(
  source: Source = loadContent(),
  opts: { seeds?: number[]; years?: number; floor?: number } = {},
): GateResult {
  const bundle = indexContent(source);
  const seeds = opts.seeds ?? SEEDS;
  const years = opts.years ?? CAMPAIGN_YEARS;
  const floor = opts.floor ?? 6;

  const counts = seeds.map((seed) => {
    const ctx = bootstrap(bundle, seed, START_YEAR);
    runYears(ctx, years);
    return ctx.world.clausesRecovered.size;
  });
  const sorted = [...counts].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  const ok = median >= floor;

  const lines = [`gate 7 (clauses): median ${median} of 9 recovered across ${seeds.length} runs — [${sorted.join(', ')}]`];
  if (!ok) lines.push(`  FAIL: median must be at least ${floor} of 9`);
  return { ok, lines };
}

/**
 * GATE 4 — fire rate, the important one. `arcs.slow.test.ts` only asserts
 * each event fires at LEAST ONCE across a whole batch; that catches an event
 * with zero live paths but says nothing about an event four hundred people
 * will never see. This is the difference between shipping 400 events and
 * shipping 400 events the player actually encounters.
 *
 * A full 1000-year span, not a truncated one: generation- and Age-gated
 * content (mythic events at `minGeneration: 8`, an Age with `earliestYear:
 * 1250`) only gets a fair chance to fire across the whole run, and cutting
 * years short would undercount them for a reason that has nothing to do with
 * whether they are too rare. "Fast" here means a lean per-run measurement —
 * template fires only, none of the harness's other bookkeeping — run at 100
 * seeds rather than 12, wide enough that "under 0.5%" means something.
 *
 * Baseline measured 2026-08-11: the rarest authored event fires in 16.7% of
 * runs (12 seeds) and nothing fires in none; the 0.5% floor is not currently
 * binding on anything, which is the correct state for a guard — it exists for
 * the four hundredth event, not the twenty-seventh.
 */
/**
 * ONE BATCH, READ BY BOTH GATES (issue #64).
 *
 * Gate 4 and gate 8 were bootstrapping the SAME seeds — `5000 + i * 7` — for
 * the same campaign span, each throwing away everything the other wanted.
 *
 * Sharing the pass is structural, not a timing constant. It lets gate 4 read the
 * batch gate 8 already pays for, and a fire-rate zero only means anything at a
 * batch size that can tell "never" apart from "rarely" — see `gateFireRate`.
 */
export function gateFireRate(
  source: Source = loadContent(),
  opts: FireRateGateOptions = {},
): GateResult {
  return runFireRateGate(source, opts);
}

/**
 * GATE 6 — purposes. Both halves are content-validation rules, already
 * enforced as errors by `npm run validate`; this subcommand exists so CI (or
 * an author) can call the purpose gate on its own, without the rest of the
 * content rules, the same way the other numbered gates are addressable.
 *
 *   `event/purposes`        — every template names exactly three purposes.
 *   `event/purpose-overlap` — no three templates share all three.
 */
export function gatePurposes(source: Source = loadContent()): GateResult {
  const issues = validateBundle(indexContent(source), ['event/purposes', 'event/purpose-overlap']);
  const lines = [`gate 6 (purposes): ${issues.length} issue(s)`];
  for (const i of issues) lines.push(`    [${i.rule}] ${i.where}: ${i.message}`);
  return { ok: issues.length === 0, lines };
}

/**
 * GATE 8 — outcome reach. Gate 4 asks whether an EVENT is ever seen; this
 * asks whether every BRANCH of it is, which is a different question and the
 * one authoring actually gets wrong. An event can fire in 85% of runs and
 * still have a choice nobody has ever been offered and an outcome nobody has
 * ever read — and the failure is silent in the exact way this codebase
 * specialises in, because the event's fire rate looks healthy from outside.
 *
 * `outcomes/weights` in `rules.ts` already refuses outcomes that are
 * STATICALLY impossible. Nothing this gate catches is static: a choice's
 * `requires` reads attributes off the people cast in the moment, and a check's
 * bands are cleared or not by a population the simulation produces. The only
 * instrument for those is a run.
 *
 * No new bookkeeping: `world.decisionLog` already records `{event, choiceId,
 * outcomeId}` at every commit, because replay (issue #8) needed it to.
 *
 * SAMPLE SIZE IS THE WHOLE DESIGN. At 30 runs this gate flags outcomes that
 * are merely rare — `hold_the_gate -> driven_off` resolves in 11% of runs and
 * looked dead at 30. 100 runs is gate 4's own sample and the smallest one
 * where "never" means never.
 */
/**
 * HOW MANY TIMES AN OUTCOME MUST HAVE BEEN EXPECTED BEFORE A ZERO CONVICTS.
 *
 * A zero is evidence in proportion to how many chances were taken. If an
 * outcome should have resolved `e` times, the chance it resolved none is
 * about `exp(-e)`: at 3 that is 5%, at 5 it is under 1%. Five is the number
 * because this gate makes 872 of these judgements at once — at 5% each, a
 * few dozen marginal outcomes would produce a spurious red most runs, which
 * is the whole failure this constant exists to end.
 */
const PROOF_EXPECTED = 5;

/** What a zero can support, and the sentence explaining why. */
export type ZeroVerdict =
  | { kind: 'dead'; why: string }
  | { kind: 'unproven'; why: string };

/**
 * SORT ONE ZERO BY WHAT IT CAN ACTUALLY SUPPORT (issue #80).
 *
 * Pulled out of the gate and exported because the branch that matters most —
 * an outcome with plenty of chances that took none of them — cannot be
 * provoked from content at all. Weights are authored, so a choice that fires
 * often WILL land on every outcome under it unless the roller itself is
 * broken; that branch is a guard against an engine bug, and the only way to
 * see it fail is to hand it the numbers directly.
 *
 * `fired` is the parent choice's firings across the whole batch, `share` the
 * outcome's normalised weight within that choice.
 */
export function judgeZeroReach(fired: number, share: number, runs: number): ZeroVerdict {
  if (fired === 0) {
    return { kind: 'dead', why: `its choice never fired in ${runs} runs` };
  }
  const expected = fired * share;
  if (expected >= PROOF_EXPECTED) {
    return { kind: 'dead', why: `expected ~${expected.toFixed(1)} of ${fired} firings, resolved none` };
  }
  // Linear in runs: firings scale with the batch, so this is the size at which
  // a zero here would actually mean something.
  const needed = Math.ceil((runs * PROOF_EXPECTED) / Math.max(expected, 1e-9));
  return {
    kind: 'unproven',
    why: `only ~${expected.toFixed(1)} expected of ${fired} firings; would need ~${needed} runs to prove`,
  };
}

export function gateOutcomeReach(
  source: Source = loadContent(),
  opts: { runs?: number; years?: number } = {},
): GateResult {
  const bundle = indexContent(source);
  // 250, not 100, and this is a power calculation rather than a preference.
  //
  // The gate asserts that EVERY authored outcome resolves at least once, over
  // 872 of them. The distribution has a long tail: an ending under one branch
  // of a template that reaches three per cent of runs is about one expected
  // resolution in a hundred, so on any given measurement several outcomes sit
  // at one or two expected hits and roughly a third of those show zero. Which
  // ones is decided by the draw, so every content change anywhere in the game
  // reshuffles the casualties — across one afternoon this gate named nine
  // different "never resolves" outcomes in nine consecutive runs, on content
  // that was getting steadily healthier, and four of the nine were the heavier
  // half of their own branch.
  //
  // 400 runs makes that rarer. It does not make it go away, and for a while
  // this gate treated `pct === 0` as proof anyway — see below.
  //
  // Was 250, widened under issue #42 — see `gateFireRate`'s comment on the
  // same number for why (the corrected blood count shrinks the batch's
  // total simulated person-years, and this gate had outcomes sitting right
  // at the edge of that).
  const runs = opts.runs ?? 800;
  const years = opts.years ?? CAMPAIGN_YEARS;

  const declared = declaredOutcomes(bundle);
  const reach = playGateBatch(source, runs, years).reach;

  const rates = [...declared]
    .map(([key, o]) => ({ o, pct: (100 * (reach.runs.get(key) ?? 0)) / runs }))
    .sort((a, b) => a.pct - b.pct);

  /**
   * ── WHAT A ZERO IS ALLOWED TO MEAN (issue #80) ────────────────────────────
   *
   * `pct === 0` used to be the entire verdict, and it convicted an outcome
   * this gate had barely asked about. `the_match_that_never_comes/counter ->
   * opened` failed a build at weight 20 of 100 under a choice reached seven
   * times in 250 runs: seven chances, a 21% chance of showing zero, and it
   * showed zero. The same outcome reaches 1.2% on the commit before, and the
   * only thing that changed between them was 177 lines of unrelated content
   * re-rolling every draw in the game — BALANCE-LOG's headline, arriving as a
   * red build with a content id on it.
   *
   * That is worse than noise. A gate whose red is routinely explained away is
   * a gate that will have a genuinely dead outcome explained away too.
   *
   * So a zero is now sorted by what it can support, which needs the one number
   * the old shape threw away: how many chances the outcome actually had.
   *
   *   the choice never fired at all  → DEAD. Nobody was ever offered it, and
   *                                    that is the more serious finding, which
   *                                    the old shape could not tell apart.
   *   expected >= PROOF_EXPECTED     → DEAD. It should have landed five times.
   *   expected <  PROOF_EXPECTED     → UNPROVEN. Says so, names the batch size
   *                                    that would settle it, and does not fail.
   *
   * This is `expectRate`'s contract — assert the claim AND that the batch can
   * carry it, and fail with the batch size that would — applied to a gate that
   * had the reasoning in its comment and `=== 0` in its code.
   */
  const dead: string[] = [];
  const unproven: string[] = [];

  for (const { o, pct } of rates) {
    if (pct > 0) continue;
    const verdict = judgeZeroReach(reach.firings.get(o.choice) ?? 0, o.share, runs);
    (verdict.kind === 'dead' ? dead : unproven).push(`${o.label}  — ${verdict.why}`);
  }

  const lines = [`gate 8 (outcome reach): ${runs} runs x ${years}y — rarest of ${rates.length} authored outcomes:`];
  for (const r of rates.slice(0, 5)) lines.push(`    ${r.o.label.padEnd(52)} ${r.pct}%`);
  if (unproven.length) {
    // Reported every time, never fatal. An outcome that lives here for several
    // commits running is a real finding — it means the content can barely be
    // reached — and it is invisible unless the gate says so out loud.
    lines.push(`  ${unproven.length} outcome(s) too rare for ${runs} runs to judge:`);
    for (const u of unproven) lines.push(`    ${u}`);
  }
  // The Unmaking's three outcomes now resolve in the coverage batch. The
  // empty list remains as the explicit debt ledger for any future exception.
  const OWED_REACH: string[] = [];
  const isOwed = (d: string) => OWED_REACH.some((k) => d.startsWith(k));
  const newlyDead = dead.filter((d) => !isOwed(d));
  const owedStill = dead.filter(isOwed);

  if (newlyDead.length) {
    lines.push(`  FAIL: ${newlyDead.length} outcome(s) never resolve:`);
    for (const d of newlyDead) lines.push(`    ${d}`);
  }
  if (owedStill.length) {
    lines.push(`  owed (issue #61, the channel is too narrow for the cast): ${owedStill.length}`);
    for (const d of owedStill) lines.push(`    ${d}`);
  }
  const paidOff = OWED_REACH.filter((k) => !dead.some((d) => d.startsWith(k)));
  if (paidOff.length) {
    lines.push(`  FAIL: ${paidOff.length} owed outcome(s) now resolve — the debt is paid, remove them from OWED_REACH:`);
    for (const k of paidOff) lines.push(`    ${k}`);
  }
  return { ok: newlyDead.length === 0 && paidOff.length === 0, lines };
}

/**
 * GATE 9 — A LADDER GATE WITH NO KEY (issue #61).
 *
 * §22's mind and Madness floors were written in prose on a 0-100 scale and
 * compared against raw attribute values topping out near 81 and 35. Measured:
 * **0.00% of 1,273 sampled expressers cleared the Vessel's `mind >= 70`**, and
 * the Demigod's `madness >= 60` and God's 90 were above the maximum the
 * simulation had ever produced. Rungs four, five and six had never been held
 * by anybody, so Apotheosis — the ending on the box — had never fired.
 *
 * It typechecked forever, which is the point. A gate nobody clears is a gate
 * nobody notices: the ladder simply stops, quietly, at rung three, and the
 * game plays.
 *
 * This asks the question that would have caught it, and asks it of the
 * population rather than of the prose: **is each floor cleared by somebody?**
 * Not "does the number look right" — a number cannot look wrong when the scale
 * it belongs to is somewhere else.
 *
 * It reads `MIND_FLOOR` and `MADNESS_FLOOR` off `ascension.ts` rather than
 * restating them, because a gate holding its own copy of "the Vessel wants 70"
 * is the same class of bug one layer out.
 */
interface MadnessHolder {
  seed: number;
  year: number;
  id: string;
  name: string;
  /** §22-normalised values, directly comparable to the ladder floors. */
  madness: number;
  mind: number;
  power: number;
  /** Stored/raw values that identify which progression route produced the peak. */
  rawMadness: number;
  forced: boolean;
  rites: string[];
  gift: number;
  reach: number;
  carriedFont: number;
  ceiling: number;
}

type MadnessRoute = 'none' | 'vessel' | 'great_rite' | 'unmaking';

/**
 * #378's PURCHASED-MADNESS FUNNEL.
 *
 * Route samples tell us where living people ended up; they cannot tell us why
 * almost nobody got there. These are the authored decisions that can buy
 * Madness or move a candidate through the upper ladder. Counting their
 * committed choice/outcome pairs separates "the scene never resolved" from
 * "the scene resolved and the house declined / missed the taking branch"
 * without changing a single gameplay constant.
 */
const MADNESS_PROGRESSION_EVENTS = [
  'the_drowning',
  'the_vessel_rite',
  'the_great_rite',
  'the_second_name',
  'the_second_widening',
  'the_unmaking',
] as const;
type MadnessProgressionEvent = typeof MADNESS_PROGRESSION_EVENTS[number];

interface MadnessRouteSample {
  madness: number;
  mind: number;
}

function madnessRoute(rites: readonly string[]): MadnessRoute {
  if (rites.includes('unmaking')) return 'unmaking';
  if (rites.includes('great_rite')) return 'great_rite';
  if (rites.includes('vessel')) return 'vessel';
  return 'none';
}

interface LadderSamples {
  minds: number[];
  madnesses: number[];
  powers: number[];
  /**
   * #378 DIAGNOSTIC. Person-year Madness split by the progression state the
   * person had at that sample. A person may contribute to more than one route
   * across his life as he climbs; that is intentional — this asks whether the
   * tail appears before a rite, after the Vessel, after the Great Rite, or
   * after an Unmaking without changing the gate's judgement.
   */
  madnessByRoute: Record<MadnessRoute, MadnessRouteSample[]>;
  /**
   * #378 DIAGNOSTIC. Counts of committed progression decisions, keyed as
   * event<TAB>choice<TAB>outcome. This is deliberately collected from the
   * decision log after each whole run, not from sampled person-years: a rite
   * offered and refused is still evidence about the funnel even though it
   * leaves no route state behind.
   */
  progressionDecisions: Map<string, number>;
  /**
   * THE SECOND MAN (issue #61, Stage E2). One entry per sampled point in
   * time, not per person — the SECOND-highest power among that year's living
   * expressers, or 0 where fewer than two exist. God's own requirement 8 is
   * about a PAIR ("a separate descendant exceeding [the elder]"), which
   * `minds`/`madnesses`/`powers` cannot answer no matter how they are
   * thresholded: they are flat, pooled-across-people distributions, and the
   * question a pair floor asks is about two people in the SAME sample at
   * once. Zero counts, deliberately — a sample with no second expresser is a
   * sample where the pair the God rung asks for could not have existed, and
   * folding that in is what makes `share(secondPowers, floor)` answer "how
   * often does a strong second man exist" rather than "how strong is the
   * second man, conditional on one having showed up at all."
   */
  secondPowers: number[];
  /** How many person-samples ever stood on each rung. */
  held: Map<Rung, number>;
  /**
   * #378 DIAGNOSTIC. The top three DISTINCT people by sampled Madness in each
   * run, rather than the top three person-years (which can all be one long-
   * lived man sampled every 25 years). This is reporting only: judgement still
   * reads the pooled arrays above.
   */
  madnessHolders: MadnessHolder[];
}

/**
 * ONE PLAYED BATCH, READ BY EVERY SET OF FLOORS — the same trick `playBatch`
 * does for gates 4 and 8, and for the same reason.
 *
 * What this gate PLAYS does not depend on the floors it judges: the runs
 * produce a population, and the floors are read against that population
 * afterwards. `gates.test.ts` exercises the judgement five times over — the
 * shipped floors, a mind floor nobody can reach, a power floor nobody can
 * reach, a madness floor above a rung nobody stood on, and the report — and
 * each of those was re-playing an identical batch to ask a different question
 * of it. Five identical batches, about 1.6s each in the fast lane.
 *
 * Keyed on the SOURCE object rather than the index, for the reason `lastBatch`
 * gives above: `indexContent` returns a fresh index every call, so a key on
 * the result would never hit. This is a memo of MEASUREMENTS, not of
 * simulation state — invariant 8 is about id sequences and RNG, and nothing
 * here can be drawn from twice.
 */
let lastLadder: { source: Source; runs: number; years: number; every: number; samples: LadderSamples } | null = null;

function ladderSamples(source: Source, runs: number, years: number, every: number): LadderSamples {
  if (lastLadder
    && lastLadder.source === source
    && lastLadder.runs === runs
    && lastLadder.years === years
    && lastLadder.every === every) {
    return lastLadder.samples;
  }

  const content = indexContent(source);
  const samples: LadderSamples = {
    minds: [],
    madnesses: [],
    powers: [],
    madnessByRoute: { none: [], vessel: [], great_rite: [], unmaking: [] },
    progressionDecisions: new Map(),
    secondPowers: [],
    held: new Map(),
    madnessHolders: [],
  };
  for (let i = 0; i < runs; i++) {
    const seed = 5000 + i * 7;
    const ctx = bootstrap(content, seed, START_YEAR);
    const holderPeaks = new Map<string, MadnessHolder>();
    for (let y = 0; y < years; y += every) {
      runYears(ctx, Math.min(every, years - y));
      // Collected per sample rather than pushed straight into the pooled
      // arrays below: the SECOND man (issue #61) is a fact about THIS YEAR's
      // expressers relative to each other, and is meaningless once their
      // powers have been poured into one flat array with everybody else's.
      const yearPowers: number[] = [];
      for (const p of ctx.world.people.living()) {
        const eldritch = phenotypeOf(p, ctx.genetics, ctx.world.year).eldritch;
        if (!eldritch.canExpress) continue;
        const mind = mindOf(ctx, p);
        const madness = madnessOf(ctx, p);
        const power = eldritchPower(ctx, p);
        samples.minds.push(mind);
        samples.madnesses.push(madness);
        samples.powers.push(power);
        samples.madnessByRoute[madnessRoute(p.rites)].push({ madness, mind });
        yearPowers.push(power);
        const prior = holderPeaks.get(p.id);
        if (!prior || madness > prior.madness) {
          holderPeaks.set(p.id, {
            seed,
            year: ctx.world.year,
            id: p.id,
            name: p.name,
            madness,
            mind,
            power,
            rawMadness: p.madness,
            forced: p.awakening.forced,
            rites: [...p.rites],
            gift: p.acquired[ELDRITCH_GIFT] ?? 0,
            reach: p.acquired[ELDRITCH_REACH] ?? 0,
            carriedFont: eldritch.carriedFont,
            ceiling: eldritch.ceiling,
          });
        }
        const r = standingOf(ctx, p).rung;
        samples.held.set(r, (samples.held.get(r) ?? 0) + 1);
      }
      yearPowers.sort((a, b) => b - a);
      samples.secondPowers.push(yearPowers[1] ?? 0);
    }
    // The route table above sees only states that survived until a sampling
    // boundary. Read the immutable decision log as the other half: which
    // purchased-Madness / ascension scenes actually resolved, and which branch
    // was taken when they did. One pass at the end avoids double-counting the
    // same decision at every 25-year sample.
    for (const d of ctx.world.decisionLog) {
      if (d.kind !== 'outcome') continue;
      if (!MADNESS_PROGRESSION_EVENTS.includes(d.event as MadnessProgressionEvent)) continue;
      const key = `${d.event}\t${d.choiceId ?? '-'}\t${d.outcomeId}`;
      samples.progressionDecisions.set(key, (samples.progressionDecisions.get(key) ?? 0) + 1);
    }

    samples.madnessHolders.push(
      ...[...holderPeaks.values()].sort((a, b) => b.madness - a.madness).slice(0, 3),
    );
  }

  lastLadder = { source, runs, years, every, samples };
  return samples;
}

export function gateLadderScales(
  source: Source = loadContent(),
  opts: {
    runs?: number;
    years?: number;
    every?: number;
    /**
     * The floors to judge, defaulting to §22's. Overridable so `gates.test.ts`
     * can hand this a rung gate nobody can clear and watch it refuse —
     * normalising made the real floors scale-INVARIANT, which is the point of
     * them and also means no edit to `attributes.yaml` can produce the failure
     * this gate exists to catch. The judgement is the thing under test.
     */
    mindFloor?: Partial<Record<Rung, number>>;
    madnessFloor?: Partial<Record<Rung, number>>;
    powerFloor?: Partial<Record<Rung, number>>;
  } = {},
): GateResult {
  const mindFloors = opts.mindFloor ?? MIND_FLOOR;
  const madnessFloors = opts.madnessFloor ?? MADNESS_FLOOR;
  // POWER IS JUDGED HERE TOO (issue #61).
  //
  // The revised acceptance asks that every gate be cleared by a non-zero and
  // non-trivial share of the population that reached the rung below — and
  // power is the quantity that had a gate above the population when this was
  // written. God asked 98 of a population whose best man, over sixteen played
  // runs, reached 90 under the strongest policy anyone can drive. Mind and
  // madness were watched here and power was not, which is exactly how it sat
  // unnoticed while three normalisations went in around it.
  //
  // `touched` and `adept` are excluded rather than judged: they are cleared by
  // most of the population most of the time, so a zero there means the
  // simulation has stopped rather than that a gate is wrong, and gate 9 is not
  // the instrument for that.
  const powerFloors = opts.powerFloor ?? {
    hierophant: POWER_FLOOR.hierophant,
    vessel: POWER_FLOOR.vessel,
    demigod: POWER_FLOOR.demigod,
    god: POWER_FLOOR.god,
  };
  // 32, not 8 (#341). The stale check reads a MAXIMUM, and the power floors
  // for Demigod and God are cleared by about one expresser-sample in a
  // thousand — one man in one run. Eight runs (about 530 samples) passed with
  // main's content because that one man happened to be there; #341's content
  // re-roll left eight runs, and sixteen, without him (ceilings 81.3 and 84.2)
  // and 32 and 48 with him again. A ceiling the batch cannot reliably see is
  // not one it can convict a floor on.
  const runs = opts.runs ?? 32;
  const years = opts.years ?? CAMPAIGN_YEARS;
  // Sampled through the run rather than at the end: a man who stood at
  // Hierophant in 1400 and died in 1440 is not in the household at 2042, and
  // the whole question is what the population PRODUCED.
  const every = opts.every ?? 25;

  const {
    minds, madnesses, powers, madnessByRoute, progressionDecisions,
    secondPowers, held, madnessHolders,
  } = ladderSamples(source, runs, years, every);

  const share = (values: number[], floor: number) =>
    (values.length ? 100 * values.filter((v) => v >= floor).length / values.length : 0);

  const lines = [
    `gate 9 (ladder scales): ${runs} runs x ${years}y — ${minds.length} expresser-samples`,
    '  #378 diagnostic — sampled Madness by progression route:',
  ];
  const routeOrder: MadnessRoute[] = ['none', 'vessel', 'great_rite', 'unmaking'];
  for (const route of routeOrder) {
    const values = madnessByRoute[route];
    const max = values.length ? Math.max(...values.map((v) => v.madness)) : 0;
    const atDemigod = values.length
      ? 100 * values.filter((v) => v.madness >= MADNESS_FLOOR.demigod!).length / values.length
      : 0;
    const godTail = values.filter((v) => v.madness >= MADNESS_FLOOR.god!);
    const atGod = values.length
      ? 100 * godTail.length / values.length
      : 0;
    const viableGod = godTail.length
      ? `${(100 * godTail.filter((v) => v.mind >= v.madness).length / godTail.length).toFixed(1)}%`
      : 'n/a';
    lines.push(
      `    ${route.padEnd(10)} samples ${String(values.length).padStart(4)}`
      + ` · max ${max.toFixed(1)} · >=60 ${atDemigod.toFixed(1)}%`
      + ` · >=90 ${atGod.toFixed(1)}% · >=90 viable ${viableGod} of >=90`,
    );
  }

  lines.push('  #378 diagnostic — resolved Madness-progression decisions across batch:');
  for (const event of MADNESS_PROGRESSION_EVENTS) {
    const prefix = `${event}\t`;
    const branches = [...progressionDecisions.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .sort(([a], [b]) => a.localeCompare(b));
    const resolved = branches.reduce((sum, [, count]) => sum + count, 0);
    const detail = branches.map(([key, count]) => {
      const [, choice, outcome] = key.split('\t');
      return `${choice}/${outcome} ${count}`;
    });
    lines.push(
      `    ${event.padEnd(20)} resolved ${String(resolved).padStart(3)}`
      + ` · ${detail.length ? detail.join(' · ') : '-'}`,
    );
  }

  lines.push('  #378 diagnostic — top distinct sampled Madness holders per run:');
  let holderSeed = Number.NaN;
  let holderRank = 0;
  for (const h of madnessHolders) {
    if (h.seed !== holderSeed) {
      holderSeed = h.seed;
      holderRank = 0;
    }
    holderRank += 1;
    lines.push(
      `    seed ${h.seed} #${holderRank} y${h.year} id ${h.id} "${h.name}"`
      + ` — madness ${h.madness.toFixed(1)} (raw ${h.rawMadness.toFixed(1)})`
      + ` · mind ${h.mind.toFixed(1)} · power ${h.power.toFixed(1)}`
      + ` · forced ${h.forced ? 'yes' : 'no'} · rites ${h.rites.join(',') || '-'}`
      + ` · gift ${h.gift.toFixed(2)} · reach ${h.reach.toFixed(2)}`
      + ` · font ${h.carriedFont.toFixed(2)} · ceiling ${h.ceiling.toFixed(2)}`,
    );
  }
  const dead: string[] = [];
  const unproven: string[] = [];
  /**
   * STALE (issue #61, Stage E3). `POWER_FLOOR.god` was 88 for eight days —
   * set 2026-09-06 to the top of the then-measured tail (90), correct the
   * day it landed — and expired silently on 2026-09-14 when `descentKind`
   * moved the population's ceiling to 87.3. Nothing here would have said so:
   * the default batch never reaches rung demigod at all, so a floor that
   * became unreachable read exactly like a floor nobody has gotten around to
   * testing yet, and the only way anyone found out was hand-deriving the
   * ceiling from a diagnostic script that has to be re-run and remembered.
   *
   * A floor whose value sits above the MAXIMUM this quantity has ever been
   * measured at, anywhere in the sampled population — not merely among
   * those who reached the rung below — cannot be an "untested" floor no
   * matter how the rest of the ladder plays out: no amount of climbing
   * fixes a number nobody has ever come near, in this population, at all.
   * That is a different and stronger claim than `dead` (which only says
   * nobody who reached the rung below cleared it) and it does not wait for
   * `below` to populate to say so.
   */
  const stale: { key: string; message: string }[] = [];
  /**
   * Which keys this run was even ABLE to judge for staleness — distinct from
   * `stale` itself, and needed for it: a small batch (`ceiling === undefined`
   * below) cannot tell "no longer stale" from "too small to check", and the
   * `STALE_OWED` self-cleaning rule below must not read the second as the
   * first, or every tiny test fixture reports every pinned debt as paid.
   */
  const judged = new Set<string>();

  /**
   * ── WHAT A ZERO IS ALLOWED TO MEAN HERE (the same rule as gate 8) ─────────
   *
   * A floor nobody clears is the bug this gate exists for — but only when
   * somebody actually stood on the rung BELOW it. The ladder is a chain, and
   * madness above Hierophant is PURCHASED (§10) through the rites the upper
   * rungs themselves unlock: if nobody reaches Demigod, God's Madness floor
   * has not been tested, it has been starved. Failing on it would blame the
   * scale for something downstream of it, and send the next person to loosen a
   * number that is right.
   *
   * So a zero convicts only where the rung beneath it is populated — UNLESS
   * it is stale, which convicts regardless, per the comment above.
   */
  const below: Partial<Record<Rung, Rung>> = {
    hierophant: 'adept', vessel: 'hierophant', demigod: 'vessel', god: 'demigod',
  };
  // `judge` used to look `rung` up in `below` itself, which required `rung`
  // to be a real `Rung` — the pair floor below is not one (there is no rung
  // called "god (pair)"), so the lookup moved to each call site and `judge`
  // just takes what it needs.
  const judge = (
    rung: string, what: string, floor: number, pct: number,
    belowLabel: string, belowStanding: number, ceiling: number | undefined,
  ) => {
    lines.push(`    ${rung.padEnd(11)} wants ${what} ${String(floor).padStart(2)} — ${pct.toFixed(1)}% of expressers reach it`);
    if (ceiling !== undefined) judged.add(`${rung}: ${what}`);
    if (pct > 0) return;
    if (ceiling !== undefined && floor > ceiling) {
      stale.push({
        key: `${rung}: ${what}`,
        message: `${rung}: ${what} >= ${floor} is above the population's own measured ceiling `
          + `(${ceiling.toFixed(1)}) — the floor has gone stale, not merely unmet`,
      });
    } else if (belowStanding > 0) {
      dead.push(`${rung}: ${what} >= ${floor} is cleared by nobody, and ${belowStanding} stood at ${belowLabel}`);
    } else {
      unproven.push(`${rung}: ${what} >= ${floor} untested — nobody ever stood at ${belowLabel}`);
    }
  };
  const standingAt = (rung: Rung | undefined) => (rung ? held.get(rung) ?? 0 : 1);
  /**
   * A MAXIMUM IS THE NOISIEST STATISTIC THERE IS, and a small batch's ceiling
   * says nothing about the population's real one — it can only ever be a
   * lower bound, and an unreliable one from too few draws. `MIN_FOR_CEILING`
   * is the same acquittal shape as gate 4's rule of three and gate 9's own
   * "below-rung populated" rule: below it, this gate does not know enough to
   * call a floor stale and says so by declining to judge, rather than by
   * reading a two-run test fixture's thin tail as the whole population's
   * ceiling. 150 sits comfortably above `gates.test.ts`'s `cheap` fixture
   * (58 samples at 2 runs x 300 years, the config every existing gate-9 test
   * that is not specifically about staleness uses) and comfortably below the
   * real batch this runs against in CI (1213 expresser-samples, 320 for the
   * pair floor's own `secondPowers`) — chosen to separate "too small to
   * trust" from "the real thing", not fitted to make either side come out
   * where a story needs it to.
   */
  const MIN_FOR_CEILING = 150;
  const ceilingOf = (values: number[]) => (values.length >= MIN_FOR_CEILING ? Math.max(...values) : undefined);

  const powerCeiling = ceilingOf(powers);
  const mindCeiling = ceilingOf(minds);
  const madnessCeiling = ceilingOf(madnesses);

  for (const [rung, floor] of Object.entries(powerFloors)) {
    const under = below[rung as Rung];
    judge(rung, 'power', floor!, share(powers, floor!), under ?? '', standingAt(under), powerCeiling);
  }
  for (const [rung, floor] of Object.entries(mindFloors)) {
    const under = below[rung as Rung];
    judge(rung, 'mind', floor!, share(minds, floor!), under ?? '', standingAt(under), mindCeiling);
  }
  for (const [rung, floor] of Object.entries(madnessFloors)) {
    const under = below[rung as Rung];
    judge(rung, 'madness', floor!, share(madnesses, floor!), under ?? '', standingAt(under), madnessCeiling);
  }

  /**
   * THE SECOND MAN, JUDGED (issue #61, Stage E2).
   *
   * God's requirement 8 is a PAIR, not a scalar, and until now gate 9 had no
   * way to see it: a floor above what one man produces read as `untested` —
   * indistinguishable from a floor nobody has had reason to try — when the
   * real answer, measured this issue's own way, was that the population
   * cannot yet field TWO such men regardless of how strong the best one gets.
   *
   * Floor is `POWER_FLOOR.hierophant`, a necessary power proxy for the
   * approved pair rule: a two-rite Hierophant elder and a separate man who
   * exceeds him. Rite history, affinities and mind still narrow the actual
   * cast; the Unmaking fire and outcome gates measure those jointly.
   */
  const pairFloor = powerFloors.hierophant ?? POWER_FLOOR.hierophant;
  judge(
    'god (pair)', "second man's power", pairFloor, share(secondPowers, pairFloor),
    'hierophant', standingAt('hierophant'), ceilingOf(secondPowers),
  );

  lines.push(`    rungs actually held: ${[...held].map(([r, n]) => `${r} ${n}`).join(' · ')}`);
  if (unproven.length) {
    lines.push(`  ${unproven.length} floor(s) the ladder never got far enough to test:`);
    for (const u of unproven) lines.push(`    ${u}`);
  }

  /**
   * OWED (issue #61, Stage E3) — the same debt-ledger shape as gate 4's
   * `OWED_FIRE_RATE`, applied to a floor rather than an event.
   *
   * The old Demigod pair-power debt is gone with #133's approved elder rule;
   * the pair diagnostic now checks the necessary Hierophant power proxy.
   * The remaining pin is God's Madness floor. It was measured stale at 8,
   * 16, 24 and 32 played runs (see below); removing it requires a new
   * measurement that actually clears the floor.
   */
  /**
   * `god: power` WAS on this list and is not any more (issue #61, Stage E5),
   * because the gate's own self-cleaning rule caught it paying itself off.
   *
   * Measured either side of Stage E5's content, same 8-run batch:
   *
   *   before   god wants power 88 — 0.0% of expressers, ceiling 86.2 (STALE)
   *   after    god wants power 88 — 0.3% of expressers, ceiling above 88
   *
   * `second_foremost` is what moved it. A rite can now reach the house's
   * SECOND expresser, and `GREAT_RITE_REACH` widens his channel by four raw
   * font units on top of whatever a Vessel put in it — which is enough, in
   * the tail, to put a man over a floor that had drifted above the
   * population's ceiling. That is the one thing this stage moved.
   *
   * READ IT FOR WHAT IT IS. This is about three samples in eleven hundred,
   * right at the rule-of-three bound, and it says a floor is no longer
   * MEASURABLY STALE — not that God is reachable. The former Demigod pair
   * floor stayed at 0.0% with the ceiling going 76.5 -> 74.3; the approved
   * revision now measures the Hierophant proxy instead. If an unrelated
   * draw change re-stales this one, `newlyStale` fails the build and it gets
   * re-pinned with a fresh measurement; that is the ratchet working, not a
   * flake.
   */
  // #344's honest founding inheritance removes the rare God-Madness tail:
  // 32 Long Lines / 1,904 expresser-samples top out at 61.8 against the
  // unchanged God floor of 90. #378 owns restoring that progression-side tail.
  //
  // Pin the measured debt rather than weakening the floor. This ledger is
  // self-cleaning: the moment #378 makes God Madness measurable again,
  // `stalePaidOff` below fails until this entry is removed.
  const STALE_OWED: string[] = ['god: madness'];
  const newlyStale = stale.filter((s) => !STALE_OWED.includes(s.key));
  const staleOwedStill = stale.filter((s) => STALE_OWED.includes(s.key));
  const stalePaidOff = STALE_OWED.filter((k) => judged.has(k) && !stale.some((s) => s.key === k));

  if (staleOwedStill.length) {
    lines.push(`  owed, and pinned (issue #61, Stage E4): ${staleOwedStill.length} floor(s) measurably stale, not merely unmet:`);
    for (const s of staleOwedStill) lines.push(`    ${s.message}`);
  }
  if (newlyStale.length) {
    lines.push(`  FAIL: ${newlyStale.length} floor(s) sit above the population's own measured ceiling (issue #61, Stage E3):`);
    for (const s of newlyStale) lines.push(`    ${s.message}`);
  }
  if (dead.length) {
    lines.push(`  FAIL: ${dead.length} rung gate(s) nobody can clear:`);
    for (const d of dead) lines.push(`    ${d}`);
  }
  if (stalePaidOff.length) {
    lines.push(`  FAIL: ${stalePaidOff.join(', ')} no longer stale. Remove it from STALE_OWED — `
      + 'a pin nobody prunes is a comment that lies about the game.');
  }
  return { ok: dead.length === 0 && newlyStale.length === 0 && stalePaidOff.length === 0, lines };
}

/**
 * ── GATE 10 — VOCABULARY REACH (invariant 11) ─────────────────────────────
 *
 * "A declared field that nothing reads is a bug, not a stub." That is
 * invariant 11, CLAUDE.md has carried it since the list existed, and it was
 * the ONE invariant on that list with no enforcement point anywhere —
 * `grep -rn "INVARIANT 11" packages` returned nothing.
 *
 * The compiler enforces half of it and cannot see the other half. Add an
 * `Effect` kind and `applyEffect`'s `assertNever` makes the missing branch a
 * build error, so every kind is HANDLED. Nothing anywhere asks whether any
 * content ever asks for it, or whether a played run ever arrives at an
 * outcome that carries one — and a verb no content authors is a verb whose
 * production path (targeting, scope threading, the ordering against the rest
 * of an outcome's effects) has never once run.
 *
 * That is not hypothetical either. `recast` shipped with a bug that freed the
 * wrong role, filtering the literal string 'head' out of `castSlots` whatever
 * slot it was pointed at — found by a coverage survey, not by the game,
 * because no content has ever used it.
 *
 * THREE QUESTIONS, AND THE THIRD IS THE ONE NOTHING ELSE ASKS:
 *
 *   declared   the closed union, read off the Zod schema via `vocabulary()`
 *              rather than a list in this file — invariant 5's rule about
 *              hand-kept copies applies to gates too
 *   authored   some outcome, somewhere in the content, carries the kind
 *   reached    a played run RESOLVED an outcome that carries it
 *
 * IT PLAYS NOTHING. Every resolution it needs is already in the batch gates 4
 * and 8 share, so this gate is post-processing over runs somebody else has
 * paid for — which is why it can afford to be in CI at 250 runs.
 *
 * A kind that is declared and not authored FAILS. That is the invariant,
 * stated plainly: if the verb exists, some content uses it, or it should not
 * exist. Authored-but-unreached is reported and does not fail on its own —
 * gate 8 already owns "an authored branch nobody reaches" and owns it with a
 * proper power calculation, so convicting on it here would be a second, worse
 * instrument for a question that already has a good one.
 */
export function gateVocabularyReachTelemetry(
  source: Source = loadContent(),
  opts: { runs?: number; years?: number } = {},
): GateResult {
  const bundle = indexContent(source);
  // Matches gates 4 and 8's 800-run batch (#133) so this still shares
  // their playBatch call rather than paying for a second one.
  const runs = opts.runs ?? 800;
  const years = opts.years ?? CAMPAIGN_YEARS;

  const declared = vocabulary().effects.map((e) => e.name);

  /** Which effect kinds each authored outcome carries, by outcome key. */
  const carriedBy = new Map<string, Set<string>>();
  const authored = new Set<string>();
  const note = (event: string, choiceId: string | undefined, o: { id: string; effects?: unknown }) => {
    const kinds = new Set<string>();
    for (const eff of (o.effects ?? []) as { kind?: string }[]) {
      if (typeof eff?.kind === 'string') { kinds.add(eff.kind); authored.add(eff.kind); }
    }
    carriedBy.set(outcomeKey(event, choiceId, o.id), kinds);
  };
  for (const e of bundle.events) {
    if (e.interaction.kind === 'narration') {
      for (const o of e.interaction.outcomes) note(String(e.id), undefined, o);
    } else {
      for (const c of e.interaction.choices) for (const o of c.outcomes) note(String(e.id), c.id, o);
    }
  }

  const batch = playGateBatch(source, runs, years);
  const reached = new Set<string>();
  for (const key of batch.reach.runs.keys()) {
    for (const kind of carriedBy.get(key) ?? []) reached.add(kind);
  }

  const unauthored = declared.filter((k) => !authored.has(k));
  const unreached = declared.filter((k) => authored.has(k) && !reached.has(k));

  /**
   * THE KIND THE GAME STILL OWES, PINNED RATHER THAN FORGIVEN.
   *
   * `recast` and `schedule` are declared, handled and unit-tested but authored
   * by no shipped content, so no run has ever executed either. The discarded
   * #185 midwife experiment briefly authored `schedule`; the clean current-main
   * rebuild deliberately does not carry that experiment. Paying either debt
   * off is content work, not test work.
   *
   * `muster` was pinned here through #95 (issue #89's Stage 2, the engine
   * substrate with no content calling it yet) and is PAID OFF by #97 (Stage
   * 3): `events/muster.yaml` now carries the `muster` effect on five
   * outcomes. Removed from OWED the moment that landed — see this comment's
   * own rule two paragraphs down.
   *
   * So the gate ratchets instead of forgiving. The debt is named in the output
   * every run, and BOTH directions fail: a new unauthored kind is the bug this
   * gate exists for, and paying one of these off without editing this list
   * leaves a comment claiming a debt the game no longer owes. An allowance
   * that only ever gets looser is how a known gap becomes the specification.
   */
  const OWED = ['recast', 'schedule'];
  const newlyUnauthored = unauthored.filter((k) => !OWED.includes(k));
  const paidOff = OWED.filter((k) => !unauthored.includes(k));

  const lines = [
    `gate 10 (vocabulary reach): ${declared.length} Effect kinds — `
    + `${declared.length - unauthored.length} authored, `
    + `${declared.length - unauthored.length - unreached.length} reached in ${runs} runs x ${years}y`,
  ];
  if (unreached.length) {
    lines.push(`  authored but never reached: ${unreached.join(', ')}`);
  }
  const owedStill = OWED.filter((k) => unauthored.includes(k));
  if (owedStill.length) {
    lines.push(`  owed, and pinned: ${owedStill.join(', ')} — declared and handled, `
      + 'authored by no content, so no run has ever executed them (invariant 11)');
  }
  if (newlyUnauthored.length) {
    lines.push(`  FAIL: ${newlyUnauthored.length} declared Effect kind(s) no content authors —`);
    for (const k of newlyUnauthored) {
      lines.push(`    ${k}: the case in applyEffect exists and no outcome has ever asked for it`);
    }
    lines.push('  Either author content that uses it, or delete the kind (invariant 11).');
  }
  if (paidOff.length) {
    lines.push(`  FAIL: ${paidOff.join(', ')} is authored now. Remove it from OWED in this `
      + 'gate — a pin nobody prunes is a comment that lies about the game.');
  }
  return { ok: newlyUnauthored.length === 0 && paidOff.length === 0, lines };
}

/**
 * The merge-blocking vocabulary verdict is entirely structural. The sampled
 * reached/unreached diagnostic remains useful, but belongs beside nightly
 * fire-rate rather than on the merge path.
 */
export function gateVocabularyReach(
  source: Source = loadContent(),
  _opts: { runs?: number; years?: number } = {},
): GateResult {
  const { ok, lines } = vocabularyAuthorship(source);
  return { ok, lines };
}

/**
 * Scheduled fire-rate evidence carries sampled vocabulary reach in the same
 * process. Both read the same memoized batch, so cadence separation does not
 * double the 800-run simulation cost.
 */
export function gateFireRateNightly(
  source: Source = loadContent(),
  opts: FireRateGateOptions = {},
): GateResult {
  const fire = gateFireRate(source, opts);
  const reach = gateVocabularyReachTelemetry(source, { runs: opts.runs, years: opts.years });
  return { ok: fire.ok && reach.ok, lines: [...fire.lines, ...reach.lines] };
}

/**
 * ── TWO GATES THAT EXISTED AND CI RAN NEITHER ─────────────────────────────
 *
 * `gateEndings` (issue #42, "the run must be losable") and `gateBearing`
 * (issue #45) both return `{ ok, lines }` — structurally identical to
 * `GateResult` — and neither was in this table, so `npm run gate` never called
 * them and CI never asked either question of shipped content. Each had a unit
 * test against hand-built runs, which proves the verdict logic and says
 * nothing about the game.
 *
 * That is gate 2's own history repeating: written for CI, wired into nothing,
 * for its whole life. The comment at the bottom of this file already says it —
 * "a gate outside this table is a gate CI does not run" — and the table it
 * refers to did not contain these two.
 *
 * ONLY ONE OF THEM IS REGISTERED, and the difference matters.
 *
 * `gateEndings` belongs in the table, but #185 found that its old 24-run default
 * could not judge any of the distribution rules below `ENDING_JUDGEABLE_BATCH`
 * (100). The default is now 160 paired runs: 100 is the minimum for the one-
 * per-cent floors, while #344's measured Unmaking comparison needs about 156
 * to clear the repository's two-SE guard. A green ending gate therefore means
 * the distribution was actually tested, not merely printed.
 *
 * `gateBearing` FAILS it, measured 2026-09-06 at its default of 12 runs:
 *
 *   FAIL: the house that carried itself does not reach higher rungs than the
 *   one that kept its head down — §29 rule 2 says pride must usually be
 *   CORRECT
 *
 * That is issue #45 still being open, not a wiring mistake, and registering a
 * red gate would say "the build is broken" every push about a design question
 * nobody is currently answering. It is also UNDER-POWERED at its default: the
 * gate's own output says the spread claim needs 240 runs and is printed
 * rather than judged at 36. A gate CI runs at a batch that cannot carry its
 * claim is the exact failure `expectRate` exists to prevent, one level up.
 *
 * So it stays out, on purpose and in writing, until #45 closes — run it with
 * `npm run gate:bearing -- 80 1000`. `gates.test.ts` pins the registry, so
 * adding it is a deliberate edit in two places rather than a thing that
 * happens by accident.
 */
export const GATES: Record<BlockingGateId, (source?: Source) => GateResult> = {
  clauses: gateClauses,
  'library-neutrality': gateLibraryNeutrality,
  'outcome-reach-blocking': gateUnwitnessedOutcomeReach,
  'short-line': gateShortLine,
  ladder: gateLadder,
  'ladder-scales': gateLadderScales,
  purposes: gatePurposes,
  'vocabulary-reach': gateVocabularyReach,
  bottleneck: gateFoundingRecovery,
  land: gateLand,
  'slot-fillability': gateSlotFillability,
  'post-fillability': gatePostFillability,
};

/**
 * NON-BLOCKING MEASUREMENT COMMANDS.
 *
 * These remain explicit CLI commands and scheduled telemetry, but are not part
 * of GATES: the full all-outcome sample stays scheduled telemetry, while
 * `outcome-reach-blocking` judges only outcomes with no deterministic witness
 * (#442/#502). A witnessed finite-sample miss can never make merge CI red.
 * Keeping this table separate makes the cadence boundary executable rather
 * than a comment somebody can accidentally undo.
 */
export const TELEMETRY_GATES: Record<string, (source?: Source) => GateResult> = {
  // Scheduled/release commands: failures still fail those workflows, but the
  // merge path carries deterministic mechanism witnesses instead.
  blood: gateBlood,
  endings: gateEndings,
  'fire-rate': gateFireRateNightly,
  'outcome-reach': gateOutcomeReach,
  signing: gateSigning,
  war: gateWar,
};

/**
 * ── CI LANES: WHICH GATES SHARE A RUNNER ──────────────────────────────────
 *
 * Current lane budgets live in tools/gate-durations.json. This file owns only
 * the structural partition: which gates must share a process, and which
 * expensive independent gates can run in parallel.
 *
 * Merge CI now has one blocking lane: batch. Expensive sampled gates are
 * direct scheduled commands in TELEMETRY_GATES; nightly runs fire-rate, war
 * and endings, while weekly evidence runs blood and signing plus full outcome-reach
 * telemetry. The derived batch also carries `outcome-reach-blocking`, scoped by
 * the generated deterministic witness manifest. The fire-rate scheduled wrapper keeps sampled
 * vocabulary reach beside the memoized corpus it reads.
 *
 * A future merge-blocking gate is still derived into batch automatically.
 * Timing is deliberately absent from this comment. The JSON budget is checked
 * by CI; a number written here would be an unchecked second source of truth.
 */
const OWN_LANE: Record<string, readonly string[]> = {};

/** The lane every gate falls into unless it is named above. */
export const DEFAULT_LANE = 'batch';

/** Every lane name, in the order CI's matrix should carry them. */
export const LANES = [DEFAULT_LANE, ...Object.keys(OWN_LANE)];

/**
 * The gates in one lane. Unknown lane names throw rather than running
 * nothing: a typo in the workflow that quietly ran zero gates would be a
 * green build that checked nothing, which is the failure this whole file
 * exists to make impossible.
 */
export function gatesInLane(lane: string): string[] {
  const spokenFor = new Set(Object.values(OWN_LANE).flat());
  if (lane === DEFAULT_LANE) return Object.keys(GATES).filter((n) => !spokenFor.has(n));
  const own = OWN_LANE[lane];
  if (!own) throw new Error(`unknown gate lane: ${lane} (have ${LANES.join(', ')})`);
  return [...own];
}

/**
 * The lane names `check.yml`'s gates matrix actually carries.
 *
 * A function over the workflow TEXT rather than a script that reads one file,
 * so `gates.test.ts` can hand it a workflow it must reject — the same shape,
 * and for the same reason, as `ciScripts` in `tools/land.mjs`: a rule nobody
 * has watched fail is indistinguishable from a rule that cannot.
 *
 * THE FAILURE IT EXISTS FOR is not a gate going missing — `batch` is derived,
 * so a new gate lands in it by construction. It is a lane going missing: name
 * a gate into `OWN_LANE` here, forget to add that lane to the matrix, and
 * those gates run on NO runner while the build stays green. That is gate 2's
 * whole history with a matrix instead of a list, and it is the one direction
 * deriving `batch` cannot protect.
 */
export function laneMatrix(workflow: string): string[] {
  const m = /^\s*lane:\s*\[([^\]]*)\]/m.exec(workflow);
  if (!m) return [];
  return m[1]!.split(',').map((x) => x.trim()).filter(Boolean);
}

export interface GateTimingSample {
  gate: string;
  seconds: number;
  ok: boolean;
}

/** Structured timing output for attribution when a checked lane grows. */
export function gateTimingJson(
  lane: string | undefined,
  gates: readonly GateTimingSample[],
  totalSeconds: number,
): string {
  return `${JSON.stringify({
    version: 1,
    lane: lane ?? null,
    totalSeconds,
    gates,
  }, null, 2)}\n`;
}

export const COMMAND_GATES: Record<string, (source?: Source) => GateResult> = {
  ...GATES,
  ...TELEMETRY_GATES,
};

const isMain = process.argv[1]?.replace(/\\/g, '/').endsWith('gates.ts');
if (isMain) {
  const argv = process.argv.slice(2);
  const laneAt = argv.indexOf('--lane');
  const lane = laneAt >= 0 ? argv[laneAt + 1] : undefined;
  const timingsAt = argv.indexOf('--timings-json');
  const timingsPath = timingsAt >= 0 ? argv[timingsAt + 1] : undefined;
  if (laneAt >= 0 && !lane) {
    console.error(`usage: gates.ts --lane [${LANES.join('|')}]`);
    process.exit(2);
  }
  if (timingsAt >= 0 && !timingsPath) {
    console.error('usage: gates.ts --timings-json <file>');
    process.exit(2);
  }
  const optionIndexes = new Set<number>();
  if (laneAt >= 0) {
    optionIndexes.add(laneAt);
    optionIndexes.add(laneAt + 1);
  }
  if (timingsAt >= 0) {
    optionIndexes.add(timingsAt);
    optionIndexes.add(timingsAt + 1);
  }
  const positional = argv.filter((_arg, i) => !optionIndexes.has(i));
  const name = laneAt >= 0 ? undefined : positional[0];

  // No argument means every MERGE-BLOCKING gate — `npm run gate`, which is
  // "what will CI say". Telemetry commands stay individually addressable but
  // never join this default by accident. `--lane` is the CI split and never a
  // smaller default: the lanes together ARE `Object.keys(GATES)`, which
  // `gates.test.ts` asserts against this file and the workflow matrix.
  // A BAD LANE NAME EXITS 2 WITH THE USAGE LINE, not a stack trace. CI passes
  // this straight from the matrix, so the realistic way it goes wrong is a
  // typo in a workflow — and the reader of that failure is somebody looking
  // at a log wondering which of two runners did nothing.
  let chosen: string[];
  try {
    chosen = lane ? gatesInLane(lane) : name ? [name] : Object.keys(GATES);
  } catch (e) {
    console.error(String(e instanceof Error ? e.message : e));
    console.error(`usage: gates.ts --lane [${LANES.join('|')}]`);
    process.exit(2);
  }
  if (chosen.some((n) => !COMMAND_GATES[n])) {
    console.error(`usage: gates.ts [${Object.keys(COMMAND_GATES).join('|')}]  (no argument runs blocking gates)`);
    console.error(`   or: gates.ts --lane [${LANES.join('|')}]`);
    process.exit(2);
  }

  // LOADED ONCE, AND HANDED TO EVERY GATE (issue #64).
  //
  // Each gate defaults `source` to `loadContent()`, so calling them with no
  // argument gave every one of them a bundle object of its own — and the
  // batch gate 4 and gate 8 now share is keyed on that object, so it never
  // hit and both of them played the same 250 runs anyway. The sharing was
  // real and the cache was addressing nobody.
  const content = loadContent();

  // A LANE ALWAYS NAMES ITS GATES, even when it holds only one.
  //
  // Headers keep the live log readable. `--timings-json` is the durable
  // measurement boundary: CI retains one structured report per lane, so a
  // drift names the gate that grew without somebody transcribing timestamps.
  const named = chosen.length > 1 || lane !== undefined;

  let failed = 0;
  const runStarted = Date.now();
  const timings: GateTimingSample[] = [];
  const trace = (globalThis as typeof globalThis & {
    __edGateTrace?: { start: (gate: string) => void; stop: () => void };
  }).__edGateTrace;
  for (const n of chosen) {
    if (named) console.log(`\n── ${n} ──`);
    const started = Date.now();
    trace?.start(n);
    process.env.ED_GATE_ACTIVE = n;
    let result: GateResult;
    try {
      result = COMMAND_GATES[n]!(content);
    } finally {
      trace?.stop();
      delete process.env.ED_GATE_ACTIVE;
    }
    const { ok, lines } = result;
    timings.push({
      gate: n,
      seconds: Number(((Date.now() - started) / 1000).toFixed(3)),
      ok,
    });
    for (const line of lines) console.log(line);
    if (!ok) failed += 1;
  }
  if (timingsPath) {
    const totalSeconds = Number(((Date.now() - runStarted) / 1000).toFixed(3));
    writeFileSync(timingsPath, gateTimingJson(lane, timings, totalSeconds));
    console.log(`\ngate timings written — ${timingsPath}`);
  }
  if (named) {
    const where = lane ? ` in lane ${lane}` : '';
    console.log(`\n${chosen.length - failed}/${chosen.length} gates pass${where}`);
  }
  process.exit(failed ? 1 : 0);
}
