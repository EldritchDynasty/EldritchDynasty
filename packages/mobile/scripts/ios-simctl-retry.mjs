/**
 * CoreSimulator sometimes times out while terminating a *running* debug app
 * on hosted macOS runners, even after the app built and launched correctly.
 * Retrying the idempotent terminate once lets the native smoke continue, but
 * never masks a permanent timeout or retries non-idempotent launch commands.
 *
 * Keep this pure so the retry contract is covered without an Xcode runner.
 */
export function runSimctlWithTerminationRetry(args, execute, onRetry = () => {}) {
  const first = execute();
  if (args[0] !== 'terminate' || first?.error?.code !== 'ETIMEDOUT') {
    return first;
  }
  onRetry();
  return execute();
}
