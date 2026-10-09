/**
 * The renderer is sandboxed, but popup URLs originate in its content. Passing
 * arbitrary protocols to shell.openExternal would hand the OS an untrusted
 * custom-protocol invocation. Only browser URLs may cross this boundary.
 */
export function externalWebUrl(value) {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value)) return null;
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) return null;
    // Open the URL we validated, not the potentially non-canonical input.
    return parsed.href;
  } catch {
    return null;
  }
}

/**
 * Electron popups are always denied. Approved web links open in the user's
 * browser; a failed OS launch is reported instead of rejecting unobserved.
 * Injection keeps this boundary testable without loading Electron in Node.
 */
export function handleExternalPopup(url, openExternal, onError = console.warn) {
  const target = externalWebUrl(url);
  if (target !== null) {
    try {
      Promise.resolve(openExternal(target)).catch(onError);
    } catch (error) {
      onError(error);
    }
  }
  return { action: 'deny' };
}
