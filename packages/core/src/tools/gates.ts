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
import {
  MADNESS_FLOOR, MIND_FLOOR, POWER_FLOOR, eldritchPower, madnessOf, mindOf, standingOf,
} from '../ascension.js';
import type { Rung } from '@ed/schema';
import { phenotypeOf } from '../people/factory.js';
import { CAMPAIGN_YEARS, START_YEAR } from '../campaign.js';

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
 * the same thousand years, each throwing away everything the other wanted.
 * Measured: gate 4 alone was 342 seconds at 100 runs, and gate 8 plays 250 of
 * the identical runs beside it.
 *
 * Sharing the pass is worth more than the minutes. It lets gate 4 read the
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
interface LadderSamples {
  minds: number[];
  madnesses: number[];
  powers: number[];
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
    minds: [], madnesses: [], powers: [], secondPowers: [], held: new Map(),
  };
  for (let i = 0; i < runs; i++) {
    const ctx = bootstrap(content, 5000 + i * 7, START_YEAR);
    for (let y = 0; y < years; y += every) {
      runYears(ctx, Math.min(every, years - y));
      // Collected per sample rather than pushed straight into the pooled
      // arrays below: the SECOND man (issue #61) is a fact about THIS YEAR's
      // expressers relative to each other, and is meaningless once their
      // powers have been poured into one flat array with everybody else's.
      const yearPowers: number[] = [];
      for (const p of ctx.world.people.living()) {
        if (!phenotypeOf(p, ctx.genetics, ctx.world.year).eldritch.canExpress) continue;
        samples.minds.push(mindOf(ctx, p));
        samples.madnesses.push(madnessOf(ctx, p));
        const power = eldritchPower(ctx, p);
        samples.powers.push(power);
        yearPowers.push(power);
        const r = standingOf(ctx, p).rung;
        samples.held.set(r, (samples.held.get(r) ?? 0) + 1);
      }
      yearPowers.sort((a, b) => b - a);
      samples.secondPowers.push(yearPowers[1] ?? 0);
    }
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

  const { minds, madnesses, powers, secondPowers, held } = ladderSamples(source, runs, years, every);

  const share = (values: number[], floor: number) =>
    (values.length ? 100 * values.filter((v) => v >= floor).length / values.length : 0);

  const lines = [
    `gate 9 (ladder scales): ${runs} runs x ${years}y — ${minds.length} expresser-samples`,
  ];
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
  // God-level Madness now appears in the measured population. Keep the debt
  // ledger empty so a future stale floor fails until it is explained.
  const STALE_OWED: string[] = [];
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
export function gateVocabularyReach(
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
 * (100). It now runs a judgeable batch in its own lane: a green ending gate
 * therefore means the distribution was actually tested, not merely printed.
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
export const GATES: Record<string, (source?: Source) => GateResult> = {
  clauses: gateClauses,
  // Issue #41. Same paired seeds, one Match comparator apart: the shipped
  // marriage mechanism must still move its own headline number at the full
  // campaign term. `bloodVerdict` owns the distributional judgement.
  blood: gateBlood,
  // #70: inherited narrative may move the book but no material headline.
  'library-neutrality': gateLibraryNeutrality,
  // #66 is independent and comparatively cheap. Run it before the shared
  // fire-rate corpus so a Short-Line regression reports in minutes rather
  // than after the batch lane's most expensive measurement.
  'short-line': gateShortLine,
  'fire-rate': gateFireRate,
  // Issue #41, and issue #61 Stage A. The only gate here that PLAYS — three
  // columns, `climb`/`spare` one verb apart and `scion` a different one verb
  // from `spare` — because the question it asks is about the player and
  // `runYears` is the chronicler. It lives in `ladder-gate.ts` with its own
  // sweep entry point (`npm run gate:ladder`), and is registered here because
  // a gate outside this table is a gate CI does not run.
  ladder: gateLadder,
  'ladder-scales': gateLadderScales,
  // Issue #99 (Muster stage 4). Plays two columns the same shape `gateLadder`
  // does — one policy answers every muster demand, the chronicler answers
  // everything else. Claim 2 ("it costs") is measured and printed rather than
  // asserted; see `war-gate.ts`'s own header for the finding behind that, and
  // why it does not belong on this table as a red gate the way `gateBearing`
  // stays off it entirely (`gateWar` passes the shipped game on the two
  // claims it does assert, so it belongs here — `gateBearing` fails outright).
  war: gateWar,
  'outcome-reach': gateOutcomeReach,
  purposes: gatePurposes,
  'vocabulary-reach': gateVocabularyReach,
  endings: gateEndings,
  bottleneck: gateFoundingRecovery,
  land: gateLand,
  'slot-fillability': gateSlotFillability,
  'post-fillability': gatePostFillability,
};

/**
 * ── CI LANES: WHICH GATES SHARE A RUNNER ──────────────────────────────────
 *
 * Current lane budgets live in tools/gate-durations.json. This file owns only
 * the structural partition: which gates must share a process, and which
 * expensive independent gates can run in parallel.
 *
 * #333 measured a green runner gate-by-gate and found two independent costs
 * dominating the default lane: blood, and the shared fire-rate corpus.
 * fire-rate, outcome-reach and vocabulary-reach MUST remain together: the
 * latter two consume the process-local batch memo built by fire-rate.
 * Splitting them would replay the same corpus on another runner and buy wall
 * clock by wasting compute. Blood has no such sharing and gets its own lane.
 *
 * War and endings remain independent lanes for the same reason: each owns its
 * own played sample. The default batch lane is DERIVED as everything not
 * named here, so a newly registered gate is in CI without a second hand-kept
 * list. gates.test.ts proves the partition and proves the workflow matrix
 * names every lane.
 *
 * Timing is deliberately absent from this comment. The JSON budget is checked
 * by CI; a number written here would be an unchecked second source of truth.
 */
const OWN_LANE: Record<string, readonly string[]> = {
  // #333: measured on green PR #362. These two independent gates accounted
  // for ~32 of the batch lane's ~37 minutes of gate execution. Giving each
  // its own runner preserves every seed and assertion while removing their
  // serial sum from the critical path.
  blood: ['blood'],
  // Keep the two readers of fire-rate's 800-run memo in the same process.
  // Splitting these across lanes would replay the corpus and trade wall clock
  // for ~15 extra runner-minutes.
  'fire-rate': ['fire-rate', 'outcome-reach', 'vocabulary-reach'],
  war: ['war'],
  // `blood` rides with `endings` since #341 widened it to 1,024 paired seeds
  // (`blood-gate.ts`): about 24 minutes more of play, which on `batch` would
  // have made the slowest runner slower, and on `endings`' otherwise six-minute
  // runner costs no wall time. Neither shares its runs with any other gate.
  endings: ['endings', 'blood'],
};

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

const isMain = process.argv[1]?.replace(/\\/g, '/').endsWith('gates.ts');
if (isMain) {
  const argv = process.argv.slice(2);
  const laneAt = argv.indexOf('--lane');
  const lane = laneAt >= 0 ? argv[laneAt + 1] : undefined;
  if (laneAt >= 0 && !lane) {
    console.error(`usage: gates.ts --lane [${LANES.join('|')}]`);
    process.exit(2);
  }
  const name = laneAt >= 0 ? undefined : argv[0];

  // No argument means all of them — `npm run gate`, which is "what will CI
  // say". The gate names are four things to remember and CI's answer needs
  // all four; remembering them one at a time is how a gate goes unrun, which
  // is what happened to slot-fillability for its whole life before someone
  // noticed it was written for CI and wired into nothing.
  // No argument at all still means every gate — `npm run gates`, which is what
  // a landing runs and what "what will CI say" has always meant. `--lane` is
  // the CI split and never a smaller default: the two lanes together ARE
  // `Object.keys(GATES)`, which `gates.test.ts` asserts against this file and
  // against the workflow's matrix.
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
  if (chosen.some((n) => !GATES[n])) {
    console.error(`usage: gates.ts [${Object.keys(GATES).join('|')}]  (no argument runs all)`);
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
  // These headers are the only per-gate timing this repository has: the
  // runner stamps every log line, so `── war ──` to the next header IS that
  // gate's cost, and reading them back off run 123 is how the 36-minute job
  // was split at all. A one-gate lane printing nothing would have made the
  // `war` runner unmeasurable the moment it became the thing to measure.
  const named = chosen.length > 1 || lane !== undefined;

  let failed = 0;
  for (const n of chosen) {
    if (named) console.log(`\n── ${n} ──`);
    const { ok, lines } = GATES[n]!(content);
    for (const line of lines) console.log(line);
    if (!ok) failed += 1;
  }
  if (named) {
    const where = lane ? ` in lane ${lane}` : '';
    console.log(`\n${chosen.length - failed}/${chosen.length} gates pass${where}`);
  }
  process.exit(failed ? 1 : 0);
}
