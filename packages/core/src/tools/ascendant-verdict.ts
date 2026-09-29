/**
 * DOES PLAYING FOR THE LADDER BUY ANYTHING? (issue #325, following #185)
 *
 * The endings gate used to answer that with Apotheosis itself: fail if the
 * chronicler reached God as often as the ascendant house. The chronicler's
 * count is zero, so the check passed only while the ascendant column held at
 * least ONE Apotheosis in 100 runs — and it held exactly one. At a true rate
 * near 1% a re-rolled batch shows none about 37% of the time, and adding any
 * template re-rolls every draw, so roughly one content landing in three could
 * turn the gate red with nothing in its diff to explain it.
 *
 * The owner chose (c) on #325: judge a step EARLIER in the God funnel, one
 * whose counts can carry a claim at the batch CI already runs. That step is
 * the Unmaking — whether a house has anyone take the rite at all — and it goes
 * through `expectRate`, so a margin under two standard errors is a failure
 * with the batch size that would carry it, not a coin. Apotheosis against the
 * chronicler is still printed, as a diagnostic. The owner's absolute 29%
 * Apotheosis ceiling stays in `ending-gate.ts` as the guard against God
 * becoming common.
 *
 * Pure over the runs handed to it, and kept apart from `ending-gate.ts` for
 * the reason `blood-market.ts` is kept apart from `blood-gate.ts`: that module
 * plays whole campaigns, and this one's test plants a batch by hand.
 */
import type { EndingId } from '@ed/schema';
import { expectRate } from '../testing.js';

export interface FunnelRun {
  ending: EndingId;
  /** People in the run who took the Unmaking. Counted for BOTH columns. */
  unmakingTakers?: number;
}

export interface FunnelVerdict {
  lines: string[];
  failures: string[];
}

const took = (r: FunnelRun) => (r.unmakingTakers ?? 0) > 0;

export function ascendantFunnelVerdict(chronicler: FunnelRun[], ascendant: FunnelRun[]): FunnelVerdict {
  const lines: string[] = [];
  const failures: string[] = [];
  const cN = chronicler.length;
  const aN = ascendant.length;
  if (!cN || !aN) return { lines, failures };

  const cTook = chronicler.filter(took).length;
  const aTook = ascendant.filter(took).length;
  const cApo = chronicler.filter((r) => r.ending === 'apotheosis').length;
  const aApo = ascendant.filter((r) => r.ending === 'apotheosis').length;
  const pct = (k: number, n: number) => `${k}/${n} (${((100 * k) / n).toFixed(1)}%)`;

  lines.push(`  ladder funnel: a house took the Unmaking in ${pct(aTook, aN)} ascendant runs · ${pct(cTook, cN)} chronicler`);
  lines.push(`  ladder diagnostic (not judged, #325): apotheosis ${pct(aApo, aN)} ascendant · ${pct(cApo, cN)} chronicler`);

  try {
    expectRate({
      hits: aTook,
      n: aN,
      floor: cTook / cN,
      what: 'ascendant runs in which somebody takes the Unmaking, against the chronicler\'s rate',
    });
  } catch (error) {
    failures.push(`  FAIL: trying for the ladder does not measurably reach the Unmaking — ${error instanceof Error ? error.message : String(error)}`);
  }
  return { lines, failures };
}
