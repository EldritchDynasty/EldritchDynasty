import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
// One implementation of the write guard, shared with the dev-server bridge.
import { resolveExistingContentPath } from '../../content/tools/content-path.mjs';
import { deleteSave, listSaves, readSave, saveRoot, writeSave } from './saves.mjs';
import { rendererEntry } from './renderer-entry.mjs';
import { readRunLibrary, writeRunLibrary } from './run-library.mjs';
import { desktopUserData } from './profile-root.mjs';
import { readUserContent, userContentRoot } from './user-content.mjs';
import { createSteamAchievementBackend, loadSteamworks } from './steam-achievements.mjs';
import { handleExternalPopup } from './external-links.mjs';
import { inspectSeedDisclosure } from './seed-disclosure.mjs';

/**
 * THE SHELL.
 *
 * Electron is a wrapper and nothing else. It owns the window, the menu bar and
 * the disk; it owns no rules. Every line of simulation in this application
 * lives in `@ed/core` and runs identically in the browser demo, in the headless
 * harness and in here — which is the only reason the editor's preview can be
 * trusted, and it stays true by keeping this file boring.
 *
 * The one thing the shell provides that the browser cannot is real file
 * access, and it does it for two directories that have nothing to do with
 * each other:
 *
 *   CONTENT  the authored game, in the repository. In `npm run dev` the editor
 *            writes it back through a Vite middleware; here it goes through
 *            IPC. The client API is identical on purpose
 *            (`window.ed.writeContent`), so nothing above the transport
 *            changes.
 *
 *   SAVES    a run, under `userData` and never in the repository. `saveGame`
 *            and `loadGame` have round-tripped a run exactly for as long as
 *            the format has existed and nothing has ever written one down —
 *            choosing a slot and a directory is this file's job (AGENTS.md,
 *            "Known gaps"), and `src/saves.mjs` is the half of it worth
 *            testing.
 *
 * Neither of them makes the shell own a rule. A save is opaque JSON here;
 * `loadGame`, in core, is still the only thing that decides whether a given
 * blob is a run.
 */

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO = resolve(HERE, '../../..');
const CONTENT = join(REPO, 'packages/content');

/** Set by `npm run shell` to the running Vite server. Absent in a built app. */
const DEV_SERVER = process.env.ED_DEV_SERVER;
const MOD_EDITOR = process.env.ED_MOD_EDITOR === '1' || process.argv.includes('--mod-editor');

let steamAchievements;
let steamModuleError;

// Steam is a host capability, never a renderer capability. Loading the native
// module and initialising the Steam client both happen before the first window
// is created so steamworks.js can install the Electron overlay switches in
// time. A normal non-Steam launch remains playable; only achievement delivery
// is unavailable in that case.
if (!MOD_EDITOR) {
  try {
    const steamworks = loadSteamworks();
    try {
      steamAchievements = createSteamAchievementBackend({ steamworks });
    } catch (error) {
      console.warn('[steam] achievement init skipped:', error?.message ?? error);
    }
  } catch (error) {
    steamModuleError = error;
    console.warn('[steam] native module unavailable:', error?.message ?? error);
  }
}

if (app.isPackaged) {
  // The installer names are different, but the profile is deliberately one:
  // the Mod Editor writes <userData>/mods/content and the game reads that exact
  // directory. Letting Electron derive userData from each product name would
  // split the two applications at the filesystem seam they exist to share.
  const profile = desktopUserData(app.getPath('appData'));
  mkdirSync(profile, { recursive: true });
  app.setPath('userData', profile);
}

const contentRoot = () => MOD_EDITOR ? userContentRoot(app.getPath('userData')) : CONTENT;

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 700,
    // The chronicle is meant to be read on parchment, not on a white page.
    backgroundColor: '#141210',
    title: MOD_EDITOR ? 'Eldritch Dynasty — Mod Editor' : 'Eldritch Dynasty',
    webPreferences: {
      preload: join(HERE, 'preload.cjs'),
      // Non-negotiable. The renderer is a web page that loads YAML written by
      // whoever is authoring content; it does not get node.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (DEV_SERVER) win.loadURL(DEV_SERVER);
  else win.loadFile(rendererEntry({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    repo: REPO,
    target: MOD_EDITOR ? 'editor' : 'client',
  }));

  // NO MENU BAR IN THE GAME (#356). Electron's default File / Edit / View /
  // Window / Help bar is an application's chrome on top of a book, and every
  // item in it either does nothing here or opens developer tools. The game
  // window drops it; the Mod Editor keeps it, being a tool. `removeMenu` is a
  // per-window call, so on macOS — where the menu belongs to the application —
  // it changes nothing and the Edit menu's copy and paste keep working.
  if (!MOD_EDITOR) win.removeMenu();

  // A link to a rival house's chronicle opens in the browser, not in a window
  // with no address bar and our preload attached to it.
  win.webContents.setWindowOpenHandler(({ url }) =>
    handleExternalPopup(
      url,
      (target) => shell.openExternal(target),
      (error) => console.warn('[shell] external browser launch failed:', error?.message ?? error),
    ));

  return win;
}

/**
 * Content writes, with the same guard the dev-server bridge uses: resolve the
 * path, refuse anything that escapes the content root, and read before writing
 * so the tool never creates a file it has not seen.
 */
ipcMain.handle('ed:write-content', (_event, payload) => {
  try {
    const { path, text } = payload ?? {};
    if (typeof text !== 'string') throw new Error('text required');

    const target = resolveExistingContentPath(contentRoot(), path);

    readFileSync(target, 'utf8');
    writeFileSync(target, text, 'utf8');
    return { ok: true, path };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});

ipcMain.handle('ed:read-content', (_event, path) => {
  try {
    const target = resolveExistingContentPath(contentRoot(), path);
    return { ok: true, text: readFileSync(target, 'utf8') };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});

ipcMain.handle('ed:read-user-content', () => {
  try {
    const root = userContentRoot(app.getPath('userData'));
    return { ok: true, files: readUserContent(root) };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});

// ── Saves ─────────────────────────────────────────────────────────────────

/**
 * Resolved lazily rather than at import: `app.getPath('userData')` is not
 * answerable before the app is ready, and reading it at module scope gives a
 * plausible-looking wrong directory instead of an error.
 */
const saves = () => saveRoot(app.getPath('userData'));

/** Every handler answers `{ ok }` rather than throwing across the bridge. */
const answered = (fn) => (_event, ...args) => {
  try {
    return { ok: true, ...fn(...args) };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
};

ipcMain.handle('ed:unlock-achievement', answered((id) => {
  if (!steamAchievements) throw new Error('Steam achievements are unavailable');
  return { unlocked: steamAchievements.unlock(id) };
}));

ipcMain.handle('ed:list-saves', answered(() => ({ saves: listSaves(saves()) })));
ipcMain.handle('ed:read-save', answered((slot) => ({ save: readSave(saves(), slot) })));
ipcMain.handle('ed:write-save', answered((slot, save) => ({ path: writeSave(saves(), slot, save) })));
ipcMain.handle('ed:delete-save', answered((slot) => ({ path: deleteSave(saves(), slot) })));

// The permanent Library of Houses lives beside /saves under userData. It is
// opaque transport data here; @ed/schema validates it in the client.
ipcMain.handle('ed:read-library', answered(() => ({ library: readRunLibrary(app.getPath('userData')) })));
ipcMain.handle('ed:write-library', answered((library) => ({ path: writeRunLibrary(app.getPath('userData'), library) })));

/**
 * The other half of "choosing a slot and a directory": a run the player can
 * put somewhere they choose, and one they can bring back. The native dialog is
 * the only part of this that has to be in the main process, and it is the
 * reason the renderer never sees a path — it names no directory, it is handed
 * the file it asked for.
 */
ipcMain.handle('ed:export-save', async (event, save) => {
  try {
    if (save === null || typeof save !== 'object' || typeof save.format !== 'number') {
      throw new TypeError('a save is an object with a numeric format');
    }
    const win = BrowserWindow.fromWebContents(event.sender);
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Write the run down',
      defaultPath: join(app.getPath('documents'), `eldritch-${save.year ?? 'run'}.json`),
      filters: [{ name: 'Eldritch Dynasty save', extensions: ['json'] }],
    });
    if (canceled || !filePath) return { ok: false, cancelled: true };
    writeFileSync(filePath, JSON.stringify(save), 'utf8');
    return { ok: true, path: filePath };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});

ipcMain.handle('ed:import-save', async (event) => {
  try {
    const win = BrowserWindow.fromWebContents(event.sender);
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Open a run',
      defaultPath: app.getPath('documents'),
      properties: ['openFile'],
      filters: [{ name: 'Eldritch Dynasty save', extensions: ['json'] }],
    });
    const chosen = filePaths?.[0];
    if (canceled || !chosen) return { ok: false, cancelled: true };
    return { ok: true, save: JSON.parse(readFileSync(chosen, 'utf8')), path: chosen };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});

/**
 * `--smoke`: open the window, wait for the renderer to say it loaded, print
 * the verdict and quit.
 *
 * A shell that boots to a white page is the exact failure this codebase keeps
 * having — nothing throws, the process stays up, and the window looks like an
 * application that simply has nothing to show. This makes it say so, and it is
 * one line to run in CI.
 */
function smokeTest(win) {
  const done = (ok, why) => {
    console.log(ok ? `shell ok — ${why}` : `shell FAILED — ${why}`);
    app.exit(ok ? 0 : 1);
  };

  win.webContents.on('did-fail-load', (_e, code, desc, url) => done(false, `${desc} (${code}) loading ${url}`));
  win.webContents.on('did-finish-load', async () => {
    const mounted = await win.webContents.executeJavaScript(
      'document.querySelector("#app")?.children.length ?? 0',
    );
    if (mounted === 0) {
      done(false, `the page loaded and #app is empty — the ${MOD_EDITOR ? 'Mod Editor' : 'game'} did not mount`);
      return;
    }

    // A differently named installer that still opens the game is not a second
    // target. Check the preload's mode from inside the packaged renderer so
    // B2 proves the entrypoint selection end to end.
    const mode = await win.webContents.executeJavaScript('window.ed?.mode ?? null');
    const expectedMode = MOD_EDITOR ? 'mod-editor' : 'game';
    if (mode !== expectedMode) {
      done(false, `preload mode is ${mode ?? 'missing'}, wanted ${expectedMode}`);
      return;
    }

    if (!MOD_EDITOR) {
      const hasAchievementBridge = await win.webContents.executeJavaScript(
        'typeof window.edPlatform?.unlockAchievement === "function"',
      );
      if (!hasAchievementBridge) {
        done(false, 'the game preload did not expose the achievement bridge');
        return;
      }

      // The clean installed game must not display the word "seed" or its
      // input on the Start screen until the player asks for Advanced (#321).
      // Serialize the same pure DOM inspector unit-tested in the shell suite;
      // no Node bridge or debug globals enter the renderer.
      const seedDisclosure = await win.webContents.executeJavaScript(
        `(${inspectSeedDisclosure.toString()})(document)`,
      );
      if (seedDisclosure !== 'ok') {
        done(false, `game seed disclosure — ${seedDisclosure}`);
        return;
      }
      // Steam itself does not have to be running on a packaging worker. The
      // native module DOES have to be loadable, otherwise an installed build
      // would discover a missing .node/DLL only after somebody finished a run.
      if (app.isPackaged && steamModuleError) {
        done(false, `the packaged Steam module did not load — ${steamModuleError?.message ?? steamModuleError}`);
        return;
      }
    }

    // The game shows no menu bar (#356). Only meaningful where a window owns
    // its menu bar; on macOS the application menu is not the window's.
    if (!MOD_EDITOR && process.platform !== 'darwin' && win.isMenuBarVisible()) {
      done(false, 'the game window still shows the File / Edit / View menu bar');
      return;
    }

    // The save bridge, end to end, through the real preload and the real IPC.
    // `saves.test.ts` covers the disk half without Electron; this covers the
    // half that only exists once there is a window — a `contextBridge` entry
    // the preload forgot to expose is invisible to every other instrument,
    // and shows up as a menu item that does nothing.
    const round = await win.webContents.executeJavaScript(`(async () => {
      const slot = 'smoke test';
      const written = await window.ed.writeSave(slot, { format: -1, year: 1042, savedAt: '${new Date().toISOString()}' });
      if (!written.ok) return 'write: ' + written.error;
      const read = await window.ed.readSave(slot);
      if (!read.ok || read.save.year !== 1042) return 'read: ' + (read.error ?? 'wrong run came back');
      const listed = await window.ed.listSaves();
      if (!listed.ok || !listed.saves.some((s) => s.slot === slot)) return 'list: ' + (listed.error ?? 'slot not listed');
      const escape = await window.ed.writeSave('../escaped', { format: -1 });
      if (escape.ok) return 'the slot guard let a path through';
      const gone = await window.ed.deleteSave(slot);
      if (!gone.ok) return 'delete: ' + gone.error;
      return 'ok';
    })()`);
    if (round !== 'ok') { done(false, `the save bridge — ${round}`); return; }

    const source = DEV_SERVER ?? `packaged ${MOD_EDITOR ? 'editor' : 'client'} renderer`;
    done(true, `${expectedMode} mounted from ${source}, and a run round-tripped to disk`);
  });

  setTimeout(() => done(false, 'no load event in 30s'), 30_000);
}

app.whenReady().then(() => {
  const win = createWindow();
  if (process.argv.includes('--smoke')) smokeTest(win);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// The client writes after every state transition; this is the final, explicit
// host notification before the process starts to disappear.
app.on('before-quit', () => {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('ed:pause');
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
