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
