import { BROWSER_IMPORT_CANCELLED } from '../../client/src/platform.js';

// The mobile bridge and Vue client are separately bundled. A module-local Symbol
// would have different identities in those bundles; the registry makes it shared.
const PICKER_CANCELLED = Symbol.for(BROWSER_IMPORT_CANCELLED.description!);

/**
 * Open the native-backed file chooser for importing an opaque saved-game JSON.
 * The chooser belongs to the mobile host, not to the game or its save schema.
 *
 * A prepared input parameter keeps native picker cancellation testable in
 * Node without importing Capacitor or booting a WebView.
 */
export function chooseSaveFile(input: HTMLInputElement): Promise<unknown | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: unknown | null) => {
      if (settled) return;
      settled = true;
      // A successful file choice never fires the native cancel event. Leaving
      // its once-listener behind would retain a settled Promise for every
      // subsequent import on a reused input (#2301).
      input.removeEventListener('cancel', onCancel);
      input.removeEventListener('change', onChange);
      resolve(value);
    };
    const onCancel = () => finish(PICKER_CANCELLED);
    const onChange = () => {
      if (settled) return;
      const file = input.files?.[0];
      if (!file) { finish(PICKER_CANCELLED); return; }

      try {
        // A WebView may deny even constructing FileReader. This callback runs
        // after the Promise executor, so an uncaught throw would strand import.
        const reader = new FileReader();
        reader.onerror = () => finish(null);
        reader.onabort = () => finish(null);
        reader.onload = () => {
          if (settled) return;
          try { finish(JSON.parse(String(reader.result))); } catch { finish(null); }
        };
        reader.readAsText(file);
      } catch {
        finish(null);
      }
    };

    try {
      // Temporary listeners are removed on *every* outcome, rather than only
      // when a cancel happens. Do not overwrite an owner's input.onchange.
      input.addEventListener('cancel', onCancel, { once: true });
      input.addEventListener('change', onChange);
      input.click();
    } catch {
      finish(null);
    }
  });
}
