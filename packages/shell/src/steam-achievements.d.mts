export interface SteamAchievementBackend {
  /** true when Steam changed state; false when the achievement was already unlocked. */
  unlock(id: string): boolean;
}

export interface SteamworksAchievementApi {
  activate(id: string): boolean;
  isActivated?(id: string): boolean;
}

export interface SteamworksModule {
  init(appId?: number): { achievement?: SteamworksAchievementApi };
  electronEnableSteamOverlay?(): void;
}

export function configuredSteamAppId(env?: Record<string, string | undefined>): number | undefined;
export function loadSteamworks(): SteamworksModule;
export function createSteamAchievementBackend(options?: {
  steamworks?: SteamworksModule;
  appId?: number;
  enableOverlay?: boolean;
}): SteamAchievementBackend;
