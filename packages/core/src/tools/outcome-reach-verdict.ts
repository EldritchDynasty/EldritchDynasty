import type { ChoiceExposure, DeclaredOutcome, Reach } from '../events/reach.js';

export function choiceExposure(reach: Reach, choice: string): ChoiceExposure | undefined {
  const observed = reach.choiceOffers;
  return observed ? { offered: observed.counts.get(choice) ?? 0,
    expectedSelections: observed.expectedSelections.get(choice) ?? 0 } : undefined;
}

/**
 * How many expected resolutions make a sampled zero strong enough to convict.
 *
 * This is the same power boundary the historical full outcome-reach gate used:
 * exp(-5) is below one percent, which keeps hundreds of simultaneous zero
 * checks from turning ordinary sampling misses into routine red builds.
 */
export const OUTCOME_REACH_PROOF_EXPECTED = 5;

export type ZeroReachVerdict =
  | { kind: 'dead'; why: string }
  | { kind: 'unproven'; why: string };

export function judgeZeroReach(
  fired: number,
  share: number,
  runs: number,
  exposure?: ChoiceExposure,
): ZeroReachVerdict {
  if (fired === 0) {
    if (exposure && exposure.offered > 0) {
      const expected = exposure.expectedSelections;
      const why = `its answer was offered ${exposure.offered} times, expected ~${expected.toFixed(1)} selections, selected none`;
      if (expected >= OUTCOME_REACH_PROOF_EXPECTED) return { kind: 'dead', why };
      const needed = Math.ceil((runs * OUTCOME_REACH_PROOF_EXPECTED) / Math.max(expected, 1e-9));
      return { kind: 'unproven', why: `${why}; would need ~${needed} runs to prove` };
    }
    return { kind: 'dead', why: `its choice never fired in ${runs} runs` };
  }

  const expected = fired * share;
  if (expected >= OUTCOME_REACH_PROOF_EXPECTED) {
    return {
      kind: 'dead',
      why: `expected ~${expected.toFixed(1)} of ${fired} firings, resolved none`,
    };
  }

  const needed = Math.ceil(
    (runs * OUTCOME_REACH_PROOF_EXPECTED) / Math.max(expected, 1e-9),
  );
  return {
    kind: 'unproven',
    why: `only ~${expected.toFixed(1)} expected of ${fired} firings; would need ~${needed} runs to prove`,
  };
}

/** A guarded result gets only the opportunities its actual cast admitted.
 * Parent firings and a best-case conditional share would overstate its chance.
 * Missing observations fail explicitly instead of silently inventing a chance.
 *
 * A checked result gets what the actual casts could roll (#1917), and a
 * guarded one is credited with everyone its slot could have cast, when the
 * batch recorded that. Both are expected counts under the same five-expected
 * proof boundary. An expectation of exactly zero is still no exposure, and
 * still dead: the batch gave the outcome no chance at all. */
export function judgeOutcomeReachZero(
  key: string,
  outcome: DeclaredOutcome,
  reach: Reach,
  runs: number,
): ZeroReachVerdict {
  const fired = reach.firings.get(outcome.choice) ?? 0;
  if (fired === 0 || (!outcome.guarded && !outcome.checked)) {
    return judgeZeroReach(fired, outcome.share, runs, choiceExposure(reach, outcome.choice));
  }
  if (outcome.checked) {
    const expected = reach.checked?.expected.get(key);
    if (expected === undefined) return { kind: 'dead', why: 'checked outcome has no pre-effect check observation' };
    if (expected === 0) return { kind: 'dead', why: `no actual check reading reached its band in ${fired} firings` };
    const verdict = judgeExpected(expected, fired, runs);
    return { ...verdict, why: `check readings: ${verdict.why}` };
  }
  const guarded = reach.guarded;
  if (!guarded?.expected.has(key) || !guarded.opportunities.has(key)) {
    return { kind: 'dead', why: 'guarded outcome has no pre-effect opportunity observation' };
  }
  const pooled = guarded.poolExpected?.get(key);
  if (pooled !== undefined) {
    if (pooled === 0) return { kind: 'dead', why: `no eligible cast in any pool across ${fired} firings of its choice` };
    const verdict = judgeExpected(pooled, fired, runs);
    return { ...verdict, why: `eligible pools: ${verdict.why}` };
  }
  const opportunities = guarded.opportunities.get(key)!;
  if (!opportunities) {
    return { kind: 'dead', why: `no eligible cast in ${fired} firings of its choice` };
  }
  const expected = guarded.expected.get(key)!;
  const verdict = judgeZeroReach(opportunities, expected / opportunities, runs);
  return { ...verdict, why: `eligible casts: ${verdict.why}` };
}

/** `judgeZeroReach`'s boundary, for an expected count already summed over firings. */
function judgeExpected(expected: number, fired: number, runs: number): ZeroReachVerdict {
  if (expected >= OUTCOME_REACH_PROOF_EXPECTED) {
    return { kind: 'dead', why: `expected ~${expected.toFixed(1)} of ${fired} firings, resolved none` };
  }
  const needed = Math.ceil((runs * OUTCOME_REACH_PROOF_EXPECTED) / expected);
  return {
    kind: 'unproven',
    why: `only ~${expected.toFixed(1)} expected of ${fired} firings; would need ~${needed} runs to prove`,
  };
}

export interface ScopedOutcomeReachVerdict {
  ok: boolean;
  declared: number;
  witnessed: number;
  blocking: number;
  /** Deterministically witnessed outcomes that this finite batch happened to miss. */
  witnessedMisses: string[];
  /** Unwitnessed zeroes strong enough to block the merge. */
  dead: string[];
  /** Unwitnessed zeroes whose sample is too small to judge. */
  unproven: string[];
  lines: string[];
}

/**
 * Apply the sampled outcome-reach verdict only where deterministic evidence is
 * still absent (#502).
 *
 * A manifest entry is proof that the production outcome path can resolve, so a
 * finite batch miss is diagnostic only. Every other declared outcome remains in
 * the blocking set. New authored outcomes therefore fail safe: until a
 * deterministic witness is generated, they are judged by the sampled gate.
 */
export function scopedOutcomeReachVerdict(
  declared: ReadonlyMap<string, DeclaredOutcome>,
  reach: Reach,
  witnessedKeys: ReadonlySet<string>,
  runs: number,
): ScopedOutcomeReachVerdict {
  const witnessedMisses: string[] = [];
  const dead: string[] = [];
  const unproven: string[] = [];
  let witnessed = 0;

  for (const [key, outcome] of declared) {
    const resolved = reach.runs.get(key) ?? 0;

    if (witnessedKeys.has(key)) {
      witnessed += 1;
      if (resolved === 0) {
        witnessedMisses.push(
          `${outcome.label}  — deterministic witness exists; sampled miss is telemetry only`,
        );
      }
      continue;
    }

    if (resolved > 0) continue;

    const zero = judgeOutcomeReachZero(key, outcome, reach, runs);
    (zero.kind === 'dead' ? dead : unproven)
      .push(`${outcome.label}  — ${zero.why}`);
  }

  const blocking = declared.size - witnessed;
  const lines = [
    `outcome reach blocking scope: ${witnessed}/${declared.size} deterministic witnesses; ${blocking} outcome(s) still sampled`,
  ];

  if (witnessedMisses.length) {
    lines.push(
      `  ${witnessedMisses.length} witnessed outcome(s) missed this batch; reported, not judged:`,
    );
    for (const miss of witnessedMisses) lines.push(`    ${miss}`);
  }

  if (unproven.length) {
    lines.push(
      `  ${unproven.length} unwitnessed outcome(s) too rare for ${runs} runs to judge:`,
    );
    for (const outcome of unproven) lines.push(`    ${outcome}`);
  }

  if (dead.length) {
    lines.push(`  FAIL: ${dead.length} unwitnessed outcome(s) never resolve:`);
    for (const outcome of dead) lines.push(`    ${outcome}`);
  }

  return {
    ok: dead.length === 0,
    declared: declared.size,
    witnessed,
    blocking,
    witnessedMisses,
    dead,
    unproven,
    lines,
  };
}
