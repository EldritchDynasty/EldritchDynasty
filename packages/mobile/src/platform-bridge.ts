import { App } from '@capacitor/app';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Preferences } from '@capacitor/preferences';
import { Share } from '@capacitor/share';
import type { Platform } from '../../client/src/platform.js';

const PREFIX = 'ed:save:';
const LIBRARY_KEY = 'ed:library';

type Summary = { slot: string; year?: number; savedAt?: string; format?: number };

function meta(slot: string, save: unknown): Summary {
  const data = save !== null && typeof save === 'object' ? save as Record<string, unknown> : {};
  return {
    slot,
    year: typeof data.year === 'number' ? data.year : undefined,
    savedAt: typeof data.savedAt === 'string' ? data.savedAt : undefined,
    format: typeof data.format === 'number' ? data.format : undefined,
  };
}

function chooseFile(): Promise<unknown | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json,.edsave';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) { resolve(null); return; }
      const reader = new FileReader();
      reader.onerror = () => resolve(null);
      reader.onload = () => {
        try { resolve(JSON.parse(String(reader.result))); } catch { resolve(null); }
      };
      reader.readAsText(file);
    };
    input.click();
  });
}

// This is the shared mobile implementation of the client-owned Platform interface.
// It is bundled beside the web assets for both Android and iOS, so the client
// imports no native module and contains no host detection. Preferences retains
// slots across app termination; the App plugin supplies lifecycle events, while
// Android additionally supplies the hardware back-button event.
const platform = {
  async listSaves(): Promise<Summary[]> {
    const { keys } = await Preferences.keys();
    const saves = await Promise.all(keys.filter((key) => key.startsWith(PREFIX)).map(async (key) => {
      const value = await Preferences.get({ key });
      return value.value ? meta(key.slice(PREFIX.length), JSON.parse(value.value)) : null;
    }));
    return saves.filter((save): save is Summary => save !== null)
      .sort((a, b) => String(b.savedAt ?? '').localeCompare(String(a.savedAt ?? '')) || a.slot.localeCompare(b.slot));
  },

  async readSave(slot: string): Promise<unknown | null> {
    const { value } = await Preferences.get({ key: PREFIX + slot });
    return value ? JSON.parse(value) : null;
  },

  async writeSave(slot: string, save: unknown): Promise<void> {
    await Preferences.set({ key: PREFIX + slot, value: JSON.stringify(save) });
  },

  async deleteSave(slot: string): Promise<void> {
    await Preferences.remove({ key: PREFIX + slot });
  },

  async readLibrary(): Promise<unknown | null> {
    const { value } = await Preferences.get({ key: LIBRARY_KEY });
    if (!value) return null;
    try { return JSON.parse(value); } catch { return null; }
  },

  async writeLibrary(library: unknown): Promise<void> {
    await Preferences.set({ key: LIBRARY_KEY, value: JSON.stringify(library) });
  },

  // Deliberately local/no-op: adding Play Games would require sign-in/network
  // and would invalidate the store's current no-data-transmitted declaration.
  async unlockAchievement(): Promise<void> {},

  async readUserContent(): Promise<Record<string, string>> {
    return {};
  },

  async exportSave(save: unknown): Promise<void> {
    const name = `eldritch-${meta('run', save).year ?? 'run'}.json`;
    await Filesystem.writeFile({ path: name, data: JSON.stringify(save, null, 2), directory: Directory.Documents, encoding: Encoding.UTF8 });
    const uri = await Filesystem.getUri({ path: name, directory: Directory.Documents });
    await Share.share({ title: 'Eldritch Dynasty', url: uri.uri, dialogTitle: 'Write the run down' });
  },

  importSave: chooseFile,

  onPause(listener: () => void): () => void {
    const registration = App.addListener('pause', listener);
    return () => { void registration.then((handle) => handle.remove()); };
  },

  onBack(listener: () => boolean): () => void {
    const registration = App.addListener('backButton', ({ canGoBack }) => {
      if (listener()) return;
      if (canGoBack) window.history.back();
      else void App.exitApp();
    });
    return () => { void registration.then((handle) => handle.remove()); };
  },
} satisfies Platform;

Object.assign(window, { edPlatform: platform });
