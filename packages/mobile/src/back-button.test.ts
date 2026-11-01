import { describe, expect, it, vi } from 'vitest';
import { handleNativeBackButton } from './back-button.js';

describe('native Android back-button fallthrough (#2364)', () => {
  it('lets the client consume an event without navigating or exiting', async () => {
    const handleInClient = vi.fn(() => true);
    const goBack = vi.fn();
    const exitApp = vi.fn(async () => undefined);
    const onExitError = vi.fn();

    handleNativeBackButton(handleInClient, true, goBack, exitApp, onExitError);
    await Promise.resolve();

    expect(handleInClient).toHaveBeenCalledOnce();
    expect(goBack).not.toHaveBeenCalled();
    expect(exitApp).not.toHaveBeenCalled();
    expect(onExitError).not.toHaveBeenCalled();
  });

  it('uses WebView history when the client declines and history is available', async () => {
    const handleInClient = vi.fn(() => false);
    const goBack = vi.fn();
    const exitApp = vi.fn(async () => undefined);
    const onExitError = vi.fn();

    handleNativeBackButton(handleInClient, true, goBack, exitApp, onExitError);
    await Promise.resolve();

    expect(handleInClient).toHaveBeenCalledOnce();
    expect(goBack).toHaveBeenCalledOnce();
    expect(exitApp).not.toHaveBeenCalled();
    expect(onExitError).not.toHaveBeenCalled();
  });

  it('exits only when the event is unhandled and there is no history', async () => {
    const goBack = vi.fn();
    const exitApp = vi.fn(async () => undefined);
    const onExitError = vi.fn();

    handleNativeBackButton(() => false, false, goBack, exitApp, onExitError);
    // Exit is invoked during the back event, not delayed until a microtask.
    expect(exitApp).toHaveBeenCalledOnce();
    await Promise.resolve();

    expect(goBack).not.toHaveBeenCalled();
    expect(onExitError).not.toHaveBeenCalled();
  });

  it.each(['throws synchronously', 'rejects asynchronously'] as const)(
    'observes an exit that %s without an unhandled rejection',
    async (failure) => {
      const error = new Error('native activity unavailable');
      const exitApp = failure === 'throws synchronously'
        ? vi.fn((): Promise<void> => { throw error; })
        : vi.fn(async () => { throw error; });
      const onExitError = vi.fn();

      handleNativeBackButton(() => false, false, vi.fn(), exitApp, onExitError);
      await vi.waitFor(() => expect(onExitError).toHaveBeenCalledExactlyOnceWith(error));
      expect(exitApp).toHaveBeenCalledOnce();
    },
  );
});
