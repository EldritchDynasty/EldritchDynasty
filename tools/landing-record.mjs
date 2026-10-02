/**
 * THE RANGE A QUEUED LANDING ACTUALLY CHECKED (#320/#352).
 *
 * A landing record is deliberately not a verdict for every commit it covers.
 * It names one exact checked/pushed head and the main head that existed before
 * that landing. Consumers may call commits in between "covered"; they must not
 * manufacture independent green verdicts for them.
 */
export const LANDING_NS = 'refs/landing';

const SHA = /^[0-9a-f]{40}$/i;

/** Parse the durable message stored at refs/landing/<checked sha>. */
export function parseLandingRecord(message) {
  if (!message) return null;
  const field = (name) =>
    new RegExp('^' + name + ': (.*)$', 'm').exec(message)?.[1]?.trim() ?? '';
  const before = field('before');
  const checked = field('checked');
  const pushed = field('pushed');
  const verdict = field('verdict');
  if (![before, checked, pushed].every((x) => SHA.test(x)) || !verdict) return null;
  return {
    before,
    checked,
    pushed,
    branch: field('branch'),
    verdict,
    verdictRef: field('verdict_ref'),
    run: field('run'),
    recorded: field('recorded'),
  };
}

/**
 * Pending/cancelled/skipped did not judge a complete head. Other terminal
 * conclusions are evidence, including a real failed checked head.
 */
export function landingRecordAnswered(record) {
  return !!record && !['pending', 'cancelled', 'skipped'].includes(record.verdict);
}
