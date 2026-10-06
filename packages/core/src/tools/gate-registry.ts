/**
 * The merge-blocking gate ids, in canonical order.
 *
 * This is the one lightweight source of truth for gate identity. The runner's
 * implementation table and #441's fingerprint entry table are both typed
 * against it, so adding or removing a blocking gate cannot leave proof reuse
 * silently out of step with CI.
 */
export const BLOCKING_GATE_IDS = [
  'clauses',
  'library-neutrality',
  'outcome-reach-blocking',
  'short-line',
  'ladder',
  'ladder-scales',
  'purposes',
  'vocabulary-reach',
  'bottleneck',
  'land',
  'slot-fillability',
  'post-fillability',
] as const;

export type BlockingGateId = (typeof BLOCKING_GATE_IDS)[number];

export function isBlockingGateId(value: string): value is BlockingGateId {
  return (BLOCKING_GATE_IDS as readonly string[]).includes(value);
}
