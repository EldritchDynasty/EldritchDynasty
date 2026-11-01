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
function launchWebUrl(url, openExternal, onError) {
  try {
    Promise.resolve(openExternal(url)).catch(onError);
  } catch (error) {
    onError(error);
  }
}

/** A reload or query/hash change stays inside the original, trusted document. */
function sameTrustedDocument(requested, trustedDocument) {
  try {
    const next = new URL(requested);
    const trusted = new URL(trustedDocument);
    // file: has a null origin; compare host and path, not origin alone.
    // Never derive "trusted" from webContents.getURL(), which could already
    // point at an untrusted page.
    return next.protocol === trusted.protocol
      && next.host === trusted.host
      && next.pathname === trusted.pathname
      && next.username === trusted.username
      && next.password === trusted.password
      && next.origin === trusted.origin;
  } catch {
    return false;
  }
}

/**
 * Popup guards do not cover ordinary same-window links or location.assign().
 * Keep the privileged window on its known startup document, and send approved
 * off-site web links to the OS browser instead of loading them with our preload.
 * Called for main-frame will-navigate, not programmatic app.loadURL/loadFile.
 */
export function handleExternalNavigation(event, requested, trustedDocument, openExternal, onError = console.warn) {
  if (sameTrustedDocument(requested, trustedDocument)) return;
  event.preventDefault();
  const target = externalWebUrl(requested);
  if (target !== null) launchWebUrl(target, openExternal, onError);
}

export function handleExternalPopup(url, openExternal, onError = console.warn) {
  const target = externalWebUrl(url);
  if (target !== null) launchWebUrl(target, openExternal, onError);
  return { action: 'deny' };
}
