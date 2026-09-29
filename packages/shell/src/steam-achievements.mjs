import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ACHIEVEMENT_ID = /^[a-z0-9_]+$/;

/**
 * Optional local override for development. A shipped Steam launch deliberately
 * has no App ID baked into the executable: SteamAPI_Init reads the launch
 * context supplied by Steam, while a developer may set ED_STEAM_APP_ID (or use
 * Steam's usual steam_appid.txt beside the executable).
 */
export function configuredSteamAppId(env = process.env) {
  const raw = String(env.ED_STEAM_APP_ID ?? '').trim();
  if (raw === '') return undefined;

  const appId = Number(raw);
  if (!Number.isSafeInteger(appId) || appId <= 0) {
    throw new Error('ED_STEAM_APP_ID must be a positive integer');
  }
  return appId;
}

/**
 * Kept separate from initialisation for two reasons:
 *
 * 1. tests can exercise every achievement path without Steam installed; and
 * 2. the packaged smoke test can distinguish "the native module was not
 *    packaged" from the ordinary developer case where Steam itself is not
 *    running.
 */
export function loadSteamworks() {
  return require('steamworks.js');
}

/**
 * The only Steam-specific object the shell keeps.
 *
 * Steamworks stays in Electron's main process. The renderer sees one narrow
 * IPC verb through the generic Platform seam; it never receives Node, native
 * module access, an App ID, or a Steam client object.
 */
export function createSteamAchievementBackend({
  steamworks = loadSteamworks(),
  appId = configuredSteamAppId(),
  enableOverlay = true,
} = {}) {
  const client = steamworks.init(appId);
  const achievements = client?.achievement;
  if (!achievements || typeof achievements.activate !== 'function') {
    throw new Error('Steam achievement API is unavailable');
  }

  // steamworks.js needs these Electron switches before the first BrowserWindow
  // is created. Only enable them after Steam initialised successfully so a
  // non-Steam desktop launch keeps Electron's ordinary renderer configuration.
  if (enableOverlay && typeof steamworks.electronEnableSteamOverlay === 'function') {
    steamworks.electronEnableSteamOverlay();
  }

  return {
    /**
     * Steam's SetAchievement operation is already idempotent; checking first
     * avoids a needless store call and makes that property explicit in tests.
     * A false return is a real backend failure, not a successful no-op: the
     * client deliberately retries failed delivery later.
     */
    unlock(id) {
      if (typeof id !== 'string' || !ACHIEVEMENT_ID.test(id)) {
        throw new TypeError('achievement id must contain only lowercase letters, digits, and underscores');
      }

      if (typeof achievements.isActivated === 'function' && achievements.isActivated(id)) {
        return false;
      }
      if (!achievements.activate(id)) {
        throw new Error(`Steam refused achievement ${id}`);
      }
      return true;
    },
  };
}
