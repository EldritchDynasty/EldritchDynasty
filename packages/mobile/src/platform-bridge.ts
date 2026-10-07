import { App } from '@capacitor/app';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import type { Platform } from '../../client/src/platform.js';
import { mobileStorage, saveSummary } from './storage.js';
import { parseSmokeCommand, smokeEvidence } from './smoke.js';

const storage = mobileStorage();
const SMOKE_RESULT = 'smoke-result.json';
const SMOKE_READY = 'smoke-ready.json';
const SMOKE_EXPORT = 'eldritch-smoke-export.json';

async function writeInterchange(save: unknown, path = SMOKE_EXPORT): Promise<string> {
  await Filesystem.writeFile({
    path,
    data: JSON.stringify(save, null, 2),
    directory: Directory.Documents,
    encoding: Encoding.UTF8,
  });
  return path;
}

async function readInterchange(path: string): Promise<unknown | null> {
  try {
    const result = await Filesystem.readFile({
      path,
      directory: Directory.Documents,
      encoding: Encoding.UTF8,
    });
    return typeof result.data === 'string' ? JSON.parse(result.data) : null;
  } catch {
    return null;
  }
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
    await writeInterchange(save, name);
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

    // The simulator driver must not infer listener readiness from wall-clock
    // time. App.addListener resolves only after Capacitor has installed the
    // native-backed listener, so this durable marker is an explicit handshake.
    void registration
      .then(() => Filesystem.writeFile({
        path: SMOKE_READY,
        data: JSON.stringify({ ready: true }),
        directory: Directory.Data,
        encoding: Encoding.UTF8,
      }))
      .catch((error: unknown) => {
        console.error('iOS runtime smoke listener registration failed', error);
      });

    return () => { void registration.then((handle) => handle.remove()); };
  },

  writeSmokeInterchange: writeInterchange,
  readSmokeInterchange: readInterchange,

  onSmokeCommand(listener) {
    const registration = App.addListener('appUrlOpen', ({ url }) => {
      const command = parseSmokeCommand(url);
      if (!command) return;
      void (async () => {
        // A hosted simulator may need materially longer to run the 40-year
        // client command than it needs to deliver the URL. Publish that the
        // native-to-WebView handoff happened before doing the expensive work
        // so CI can distinguish a routing failure from slow simulation.
        await Filesystem.writeFile({
          path: SMOKE_RESULT,
          data: JSON.stringify({ command: command.kind, stage: 'received' }),
          directory: Directory.Data,
          encoding: Encoding.UTF8,
        });

        const evidence = await listener(command)
          .then((result) => smokeEvidence(command, result))
          .catch((error: unknown) => ({
            command: command.kind,
            ok: false as const,
            error: error instanceof Error ? error.message : String(error),
          }));

        await Filesystem.writeFile({
          path: SMOKE_RESULT,
          data: JSON.stringify(evidence),
          directory: Directory.Data,
          encoding: Encoding.UTF8,
        });
      })().catch((error: unknown) => {
        console.error('iOS runtime smoke evidence write failed', error);
      });
    });
    return () => { void registration.then((handle) => handle.remove()); };
  },
} satisfies Platform;

Object.assign(window, { edPlatform: platform });
