const { contextBridge, ipcRenderer } = require('electron');

/**
 * The whole bridge. Content on one side, saved runs on the other, everything
 * validated in the main process — the renderer gets no path handling of its
 * own and no node.
 *
 * `@ed/editor`'s content module checks for `window.ed` and falls back to the
 * Vite dev-server endpoint when it is absent, so the same editor build runs in
 * a browser tab and inside the shell without knowing which it is in. The save
 * calls have no browser fallback and are not meant to have one: a run in a tab
 * is a run in `localStorage`, and that is a decision for the client that
 * eventually asks, not for the transport.
 *
 * Every call answers `{ ok: true, ... }` or `{ ok: false, error }`. Nothing
 * throws across the bridge, because an exception here arrives in the renderer
 * with the main process's stack in it.
 */
const result = async (call) => {
  const answer = await call;
  if (!answer?.ok) throw new Error(answer?.error ?? 'the host refused the request');
  return answer;
};

const MOD_EDITOR = process.env.ED_MOD_EDITOR === '1' || process.argv.includes('--mod-editor');

const pauseListeners = new Set();
ipcRenderer.on('ed:pause', () => {
  for (const listener of pauseListeners) listener();
});

contextBridge.exposeInMainWorld('ed', {
  isShell: true,
  mode: MOD_EDITOR ? 'mod-editor' : 'game',

  writeContent: (path, text) => ipcRenderer.invoke('ed:write-content', { path, text }),
  readContent: (path) => ipcRenderer.invoke('ed:read-content', path),
  readUserContent: () => ipcRenderer.invoke('ed:read-user-content'),

  /** Slots in the save directory, newest first: `{ slot, year, savedAt, bytes }`. */
  listSaves: () => ipcRenderer.invoke('ed:list-saves'),
  /** One slot, as the plain object `loadGame` takes. */
  readSave: (slot) => ipcRenderer.invoke('ed:read-save', slot),
  /** Write one slot. The save is whatever `saveGame` returned. */
  writeSave: (slot, save) => ipcRenderer.invoke('ed:write-save', slot, save),
  deleteSave: (slot) => ipcRenderer.invoke('ed:delete-save', slot),
  readLibrary: () => ipcRenderer.invoke('ed:read-library'),
  writeLibrary: (library) => ipcRenderer.invoke('ed:write-library', library),

  /** A run to somewhere the player chooses, and back. `{ ok: false, cancelled: true }` if they close the dialog. */
  exportSave: (save) => ipcRenderer.invoke('ed:export-save', save),
  importSave: () => ipcRenderer.invoke('ed:import-save'),
});

// The game client receives this generic bridge at composition. It has no
// knowledge of Electron, IPC, paths, or the implementation behind a save.
contextBridge.exposeInMainWorld('edPlatform', {
  listSaves: async () => (await result(ipcRenderer.invoke('ed:list-saves'))).saves,
  readSave: async (slot) => (await result(ipcRenderer.invoke('ed:read-save', slot))).save ?? null,
  writeSave: async (slot, save) => { await result(ipcRenderer.invoke('ed:write-save', slot, save)); },
  deleteSave: async (slot) => { await result(ipcRenderer.invoke('ed:delete-save', slot)); },
  readLibrary: async () => (await result(ipcRenderer.invoke('ed:read-library'))).library ?? null,
  writeLibrary: async (library) => { await result(ipcRenderer.invoke('ed:write-library', library)); },
  unlockAchievement: async (id) => { await result(ipcRenderer.invoke('ed:unlock-achievement', id)); },
  readUserContent: async () => (await result(ipcRenderer.invoke('ed:read-user-content'))).files ?? {},
  exportSave: async (save) => { await result(ipcRenderer.invoke('ed:export-save', save)); },
  importSave: async () => (await result(ipcRenderer.invoke('ed:import-save'))).save ?? null,
  onPause: (listener) => {
    pauseListeners.add(listener);
    return () => pauseListeners.delete(listener);
  },
  onBack: () => () => undefined,
});
