import type { DeclaredOutcome, Reach } from '../events/reach.js';

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
): ZeroReachVerdict {
  if (fired === 0) {
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

    const zero = judgeZeroReach(
      reach.firings.get(outcome.choice) ?? 0,
      outcome.share,
      runs,
    );
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
