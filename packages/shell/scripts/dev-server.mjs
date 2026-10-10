/**
 * Resolve the URL Vite ACTUALLY started, rather than assuming its preferred
 * port was free. Vite auto-increments ports unless strictPort is enabled.
 *
 * A child-process stdout chunk is not a line: the 'Local:' prefix, a URL, and
 * its newline may arrive in three unrelated chunks. Consume only complete
 * lines so Electron can never launch against a truncated URL.
 */
const ANSI_SGR = /\x1b\[[0-9;]*m/g;

export function viteLocalUrl(line) {
  if (typeof line !== 'string') return null;
  const plain = line.replace(ANSI_SGR, '');
  const match = plain.match(/(?:^|\s)Local:\s*(https?:\/\/[^\s]+)/);
  if (!match) return null;
  try {
    const url = new URL(match[1]);
    if (!['http:', 'https:'].includes(url.protocol)
      || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return null;
    return url.href;
  } catch {
    return null;
  }
}

/** One callback, only when a complete valid Vite Local line has arrived. */
export function observeViteLocal(onLocal) {
  let pending = '';
  let found = false;
  return (chunk) => {
    if (found) return;
    pending += String(chunk);
    let newline;
    while ((newline = pending.indexOf('\n')) !== -1) {
      const line = pending.slice(0, newline);
      pending = pending.slice(newline + 1);
      const url = viteLocalUrl(line);
      if (url !== null) {
        found = true;
        onLocal(url);
        return;
      }
    }
    // An enormous banner that never terminates must not grow without bound.
    if (pending.length > 32768) pending = pending.slice(-8192);
  };
}
