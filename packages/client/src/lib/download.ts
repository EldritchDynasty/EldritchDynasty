/**
 * Blob downloads begin asynchronously in the browser. Keep the object URL
 * alive beyond the click, and attach the link so Firefox and mobile browsers
 * can follow it. The URL is eventually released even if the click throws.
 */
export const DOWNLOAD_URL_GRACE_MS = 60_000;

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.hidden = true;

    try {
      document.body.appendChild(link);
      link.click();
    } finally {
      link.remove();
    }
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), DOWNLOAD_URL_GRACE_MS);
  }
}
