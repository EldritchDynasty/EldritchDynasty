import type { EndingId } from '@ed/schema';
import { expectMean } from '../testing.js';

export interface SigningSample {
  seed: number;
  question: string;
  answer: string;
  /** 1 when the house reaches the Short-Line term with an ending, else 0. */
  reachedTerm: number;
  /** Numeric high-water rung so paired differences are meaningful. */
  bestRung: number;
  clauses: number;
  ending?: EndingId;
}

/**
 * Practical equivalence bands, not significance targets.
 *
 * These are deliberately broad first guardrails for scheduled telemetry. The
 * paired batch must show that no answer moves survival-to-term by 15 points,
 * the ladder by half a rung, or recovery by three quarters of a Short-Line
 * clause. BALANCE-LOG evidence may tighten these; one noisy batch must never
 * silently loosen them.
 */
export interface SigningBalanceLimits {
  reachedTerm: number;
  bestRung: number;
  clauses: number;
}

export const SIGNING_BALANCE_LIMITS: Readonly<SigningBalanceLimits> = {
  reachedTerm: 0.15,
  bestRung: 0.5,
  clauses: 0.75,
};

export interface SigningGateResult {
  ok: boolean;
  lines: string[];
}

type Metric = 'reachedTerm' | 'bestRung' | 'clauses';

function pairedDeltas(
  left: readonly SigningSample[],
  right: readonly SigningSample[],
  metric: Metric,
): number[] {
  const other = new Map(right.map((sample) => [sample.seed, sample]));
  return left
    .map((sample) => {
      const matched = other.get(sample.seed);
      return matched ? sample[metric] - matched[metric] : undefined;
    })
    .filter((value): value is number => value !== undefined);
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function equivalent(
  values: number[],
  margin: number,
  what: string,
  lines: string[],
): boolean {
  if (values.length < 2) {
    lines.push(`  FAIL: ${what}: needs at least two paired seeds, got ${values.length}`);
    return false;
  }

  let ok = true;
  for (const claim of [
    { ceiling: margin, what: `${what} upper equivalence bound` },
    { floor: -margin, what: `${what} lower equivalence bound` },
  ] as const) {
    try {
      expectMean({ values, ...claim });
    } catch (error) {
      ok = false;
      lines.push(`  FAIL: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  lines.push(
    `  ${what}: paired mean ${mean(values).toFixed(3)} across ${values.length} seeds `
      + `(allowed ±${margin})`,
  );
  return ok;
}

/**
 * The deterministic judgement, separated from the expensive playing.
 *
 * Fast tests hand this a deliberately lopsided fixture and require red. The
 * scheduled command hands it real paired samples. A balance check nobody has
 * ever seen reject an imbalance is only a report with an optimistic name.
 */
export function verdictOver(
  samples: readonly SigningSample[],
  limits: SigningBalanceLimits = SIGNING_BALANCE_LIMITS,
): SigningGateResult {
  const lines: string[] = [];
  let ok = true;

  const questions = [...new Set(samples.map((sample) => sample.question))].sort();
  if (!questions.length) {
    return { ok: false, lines: ['gate signing: FAIL: no Examination samples'] };
  }

  for (const question of questions) {
    const inQuestion = samples.filter((sample) => sample.question === question);
    const answers = [...new Set(inQuestion.map((sample) => sample.answer))].sort();
    lines.push(`question ${question}: ${answers.length} answers`);

    if (answers.length < 2) {
      ok = false;
      lines.push(`  FAIL: question ${question} needs at least two answers to compare`);
      continue;
    }

    for (let i = 0; i < answers.length; i += 1) {
      for (let j = i + 1; j < answers.length; j += 1) {
        const leftId = answers[i]!;
        const rightId = answers[j]!;
        const left = inQuestion.filter((sample) => sample.answer === leftId);
        const right = inQuestion.filter((sample) => sample.answer === rightId);
        const pair = `${question} ${leftId} - ${rightId}`;

        ok = equivalent(
          pairedDeltas(left, right, 'reachedTerm'),
          limits.reachedTerm,
          `${pair} term reach`,
          lines,
        ) && ok;
        ok = equivalent(
          pairedDeltas(left, right, 'bestRung'),
          limits.bestRung,
          `${pair} best rung`,
          lines,
        ) && ok;
        ok = equivalent(
          pairedDeltas(left, right, 'clauses'),
          limits.clauses,
          `${pair} clauses`,
          lines,
        ) && ok;
      }
    }

    // Ending identity is measured and printed, but #343's red balance claim is
    // explicitly the three quantitative axes above.
    for (const answer of answers) {
      const counts = new Map<string, number>();
      for (const sample of inQuestion.filter((candidate) => candidate.answer === answer)) {
        const ending = sample.ending ?? 'no_term';
        counts.set(ending, (counts.get(ending) ?? 0) + 1);
      }
      const distribution = [...counts.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([ending, count]) => `${ending}=${count}`)
        .join(', ');
      lines.push(`  endings ${answer}: ${distribution || 'none'}`);
    }
  }

  return { ok, lines: [`gate signing: ${samples.length} paired answer-runs`, ...lines] };
}
