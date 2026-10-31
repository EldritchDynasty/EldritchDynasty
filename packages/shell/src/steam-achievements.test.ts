import { describe, expect, it, vi } from 'vitest';
import {
  configuredSteamAppId,
  createSteamAchievementBackend,
  type SteamworksModule,
} from './steam-achievements.mjs';

function fakeSteam(options: { active?: string[]; activate?: boolean; initThrows?: boolean } = {}) {
  const active = new Set(options.active ?? []);
  const activate = vi.fn((id: string) => {
    if (options.activate === false) return false;
    active.add(id);
    return true;
  });
  const isActivated = vi.fn((id: string) => active.has(id));
  const init = vi.fn((_appId?: number) => {
    if (options.initThrows) throw new Error('Steam is not running');
    return { achievement: { activate, isActivated } };
  });
  const electronEnableSteamOverlay = vi.fn();

  const steamworks: SteamworksModule = { init, electronEnableSteamOverlay };
  return { steamworks, init, activate, isActivated, electronEnableSteamOverlay };
}

describe('Steam achievement backend (#323)', () => {
  it('keeps the shipped App ID external and accepts a positive development override', () => {
    expect(configuredSteamAppId({})).toBeUndefined();
    expect(configuredSteamAppId({ ED_STEAM_APP_ID: '480' })).toBe(480);
    expect(configuredSteamAppId({ ED_STEAM_APP_ID: ' 480 ' })).toBe(480);
    expect(configuredSteamAppId({ ED_STEAM_APP_ID: '000480' })).toBe(480);
    expect(configuredSteamAppId({ ED_STEAM_APP_ID: ' ' })).toBeUndefined();
    for (const invalid of [
      '0', '4.2', 'not-a-number', '0x1e0', '0b111100000',
      '4.8e2', '480.0', '+480', '-480', 'Infinity', '9007199254740992',
    ]) {
      expect(() => configuredSteamAppId({ ED_STEAM_APP_ID: invalid }), invalid)
        .toThrow(/positive decimal integer/);
    }
  });

  it('initialises Steam in the host and enables the overlay only after init succeeds', () => {
    const fake = fakeSteam();
    createSteamAchievementBackend({ steamworks: fake.steamworks, appId: 480 });

    expect(fake.init).toHaveBeenCalledWith(480);
    expect(fake.electronEnableSteamOverlay).toHaveBeenCalledOnce();

    const broken = fakeSteam({ initThrows: true });
    expect(() => createSteamAchievementBackend({ steamworks: broken.steamworks, appId: 480 }))
      .toThrow('Steam is not running');
    expect(broken.electronEnableSteamOverlay).not.toHaveBeenCalled();
  });

  it('unlocks once and treats a repeated evaluation as an idempotent no-op', () => {
    const fake = fakeSteam();
    const backend = createSteamAchievementBackend({
      steamworks: fake.steamworks,
      appId: 480,
      enableOverlay: false,
    });

    expect(backend.unlock('ending_settled')).toBe(true);
    expect(backend.unlock('ending_settled')).toBe(false);
    expect(fake.activate).toHaveBeenCalledTimes(1);
  });

  it('rejects arbitrary renderer input and surfaces a Steam refusal for retry', () => {
    const fake = fakeSteam({ activate: false });
    const backend = createSteamAchievementBackend({
      steamworks: fake.steamworks,
      appId: 480,
      enableOverlay: false,
    });

    expect(() => backend.unlock('../anything')).toThrow(/achievement id/);
    expect(() => backend.unlock('Ending_Settled')).toThrow(/achievement id/);
    expect(fake.activate).not.toHaveBeenCalled();

    expect(() => backend.unlock('ending_settled')).toThrow('Steam refused achievement ending_settled');
  });
});
