/**
 * Open the native-backed file chooser for importing an opaque saved-game JSON.
 * The chooser belongs to the mobile host, not to the game or its save schema.
 *
 * Input injection keeps native picker cancellation testable in Node without
 * importing Capacitor or booting a WebView.
 */
export function chooseSaveFile(input: HTMLInputElement = document.createElement('input')): Promise<unknown | null> {
  return new Promise((resolve) => {
    input.type = 'file';
    input.accept = 'application/json,.json,.edsave';

    // Dismissing a native picker emits `cancel`, not `change`. Without
    // this listener, callers of importSave wait on a never-settled Promise.
    input.addEventListener('cancel', () => resolve(null), { once: true });
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) { resolve(null); return; }

      const reader = new FileReader();
      reader.onerror = () => resolve(null);
      reader.onabort = () => resolve(null);
      reader.onload = () => {
        try { resolve(JSON.parse(String(reader.result))); } catch { resolve(null); }
      };
      try { reader.readAsText(file); } catch { resolve(null); }
    };

    try { input.click(); } catch { resolve(null); }
  });
}
