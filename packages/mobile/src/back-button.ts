/**
 * Android back-button fallthrough belongs to the native host, never the game.
 * A consumed event must not also navigate or exit; otherwise WebView history
 * wins over the client's active overlay (or leaves the app unexpectedly).
 *
 * Capacitor exitApp() is asynchronous. If Android tears down the activity as
 * the back event is delivered, it may reject, and native implementations can
 * also throw before returning a Promise. Observe both failures so the host
 * never emits an unhandled rejection from this best-effort exit path.
 */
export function handleNativeBackButton(
  handleInClient: () => boolean,
  canGoBack: boolean,
  goBack: () => void,
  exitApp: () => Promise<unknown>,
  onExitError: (error: unknown) => void,
): void {
  if (handleInClient()) return;
  if (canGoBack) {
    goBack();
    return;
  }
  // A deferred invocation converts synchronous throws into a rejected Promise,
  // while the catch also observes an asynchronous native rejection.
  void Promise.resolve().then(exitApp).catch(onExitError);
}
