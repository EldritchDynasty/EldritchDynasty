/** Electron cannot be imported into Node-hosted tests; this is the contract of external-links.mjs. */

/** Canonical absolute HTTP(S) URL, or null when opening it would cross an unsafe protocol boundary. */
export declare function externalWebUrl(value: unknown): string | null;

/**
 * Always deny Electron's popup. When the URL is safe, open it in the host
 * browser; report both rejected promises and synchronous host failures.
 */
export declare function handleExternalPopup(
  url: unknown,
  openExternal: (url: string) => Promise<unknown> | unknown,
  onError?: (error: unknown) => void,
): { action: 'deny' };

/**
 * A main-frame navigation may stay in the same bootstrapped application
 * document (including query/hash changes). All other navigations are stopped;
 * allowed web URLs open in the OS browser, never with the trusted preload.
 */
export declare function handleExternalNavigation(
  event: { preventDefault(): void },
  requested: string,
  trustedDocument: string,
  openExternal: (url: string) => Promise<unknown> | unknown,
  onError?: (error: unknown) => void,
): void;
