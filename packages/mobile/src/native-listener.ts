/**
 * Lifecycle listener acquisition is asynchronous in Capacitor. Registering a
 * callback may reject (or throw in an unavailable host), and teardown can
 * happen before registration finishes. Neither case may leak a native
 * listener or create an unhandled Promise rejection (#2261).
 *
 * This generic seam stays separate from the Capacitor bridge so it can be
 * tested without booting a WebView or importing a native plugin.
 */
export interface NativeListenerHandle {
  remove(): Promise<void>;
}

export function attachNativeListener(
  register: () => Promise<NativeListenerHandle>,
  onError: (error: unknown) => void,
  onRegistered?: () => void | Promise<unknown>,
): () => void {
  let disposed = false;
  let handle: NativeListenerHandle | undefined;

  try {
    // Observe rejection immediately, even if the client never unsubscribes.
    // If disposal wins the race, remove the handle as soon as it arrives.
    void register().then(async (registered) => {
      if (disposed) {
        await registered.remove();
        return;
      }
      handle = registered;
      await onRegistered?.();
    }).catch(onError);
  } catch (error) {
    // A failed native bridge may also throw before returning its Promise.
    onError(error);
  }

  return () => {
    if (disposed) return;
    disposed = true;
    if (!handle) return;
    const current = handle;
    handle = undefined;
    // Promise.resolve also converts a synchronous throwing remove() into a
    // caught rejection rather than escaping a Vue unmount hook.
    void Promise.resolve().then(() => current.remove()).catch(onError);
  };
}
