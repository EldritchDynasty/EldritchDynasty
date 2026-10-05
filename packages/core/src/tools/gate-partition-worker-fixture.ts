/**
 * #440 worker-failure fixture.
 *
 * Imported inside an isolated gate worker by gates.test.ts. Exiting here
 * deliberately skips the worker harness's postMessage/notify path so the
 * parent must fail closed via its bounded wait instead of hanging forever.
 */
export function exitWithoutEvidence(): never {
  process.exit(17);
}
