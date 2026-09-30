import { App } from '@capacitor/app';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import type { Platform } from '../../client/src/platform.js';
import { mobileStorage, saveSummary } from './storage.js';

const storage = mobileStorage();

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

// This is the mobile implementation of the client-owned Platform interface.
// It is bundled beside the web assets, so the client imports no native module
// and contains no host detection. Saves and the Library live in app-owned
// Filesystem Data on both Android and iOS; the App plugin supplies lifecycle
// events, while Android alone supplies the back-button event.
const platform = {
  listSaves: storage.listSaves,
  readSave: storage.readSave,
  writeSave: storage.writeSave,
  deleteSave: storage.deleteSave,
  readLibrary: storage.readLibrary,
  writeLibrary: storage.writeLibrary,

  // Deliberately local/no-op: adding Play Games or Game Center would require
  // a separate product/privacy decision. The game has no mobile achievement
  // backend and sends no achievement data off the device.
  async unlockAchievement(): Promise<void> {},

  async readUserContent(): Promise<Record<string, string>> {
    return {};
  },

  async exportSave(save: unknown): Promise<void> {
    const name = `eldritch-${saveSummary('run', save).year ?? 'run'}.json`;
    await Filesystem.writeFile({
      path: name,
      data: JSON.stringify(save, null, 2),
      directory: Directory.Documents,
      encoding: Encoding.UTF8,
    });
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
