import { expect, test } from '@playwright/test';
import { loadBundle } from '@ed/content';
import { newGame } from '@ed/core';
import type { CampaignId } from '@ed/schema';
import { ACCESSIBILITY_STORAGE_KEY } from '../../packages/client/src/lib/accessibility';

/**
 * The Demonstration owns a separate save slot (#2210, part of #1979).
 * A browser storage refusal must be visible, must not damage the separately
 * kept full campaign, and must not prevent a later successful continuation.
 * Use real core saves and the shipped Start -> GameActions -> Platform path.
 */
function foundedSave(campaign: CampaignId) {
  const game = newGame(loadBundle(), { seed: campaign === 'demo' ? 2210 : 1042, campaign });
  const signing = game.prologue()!;
  expect(game.found({
    houseName: campaign === 'demo' ? 'House Unwritten' : 'House Preserved',
    heirloom: signing.heirlooms[0]!.heirloom,
    grudge: signing.grudges[0]!.house,
    answers: Object.fromEntries(signing.examination.map((question) =>
      [question.id, question.answers[0]!.id])),
  }).ok).toBe(true);
  return game.save();
}

for (const mode of ['original', 'plainenglish'] as const) {
  test(`a refused Demo autosave preserves the full game and recovers on reload (${mode}) #2210`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const full = foundedSave('short');
    const demo = foundedSave('demo');
    const fullJSON = JSON.stringify(full);
    const demoJSON = JSON.stringify(demo);

    await page.goto('/');
    await page.evaluate(({ fullJSON, demoJSON, mode, key }) => {
      localStorage.setItem('ed:save:autosave', fullJSON);
      localStorage.setItem('ed:save:demo-autosave', demoJSON);
      localStorage.setItem(key, JSON.stringify({
        proseMode: mode,
        showEverythingFromStart: true,
        sound: false,
      }));
    }, { fullJSON, demoJSON, mode, key: ACCESSIBILITY_STORAGE_KEY });
    await page.reload();
    await expect(page.locator('main.start')).toBeVisible();

    // Reject only the next write to the Demo slot. Restoration happens before
    // the throw, so the test can also prove that the next save can succeed.
    // Browser Storage is the real Platform's backing device, not a mocked store.
    await page.evaluate(() => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key: string, value: string) {
        if (key === 'ed:save:demo-autosave') {
          Storage.prototype.setItem = original;
          throw new DOMException('Demo autosave storage unavailable', 'QuotaExceededError');
        }
        return original.call(this, key, value);
      };
    });

    const demoRegion = page.getByRole('region', {
      name: mode === 'original' ? 'Demonstrations kept' : 'Saved demonstrations',
    });
    await demoRegion.getByRole('button', {
      name: /Return to the Demonstration|Continue the demonstration/,
    }).click();

    // The live game still opens; the failed persistence must not be presented
    // as a successful save, or silently erase either stored campaign.
    await expect(page.locator('.board')).toBeVisible();
    await expect(page.getByText(
      mode === 'original'
        ? 'not saved — could not save this run'
        : 'Game not saved. The latest changes could not be saved.',
      { exact: true },
    )).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('ed:save:demo-autosave'))).toBe(demoJSON);
    expect(await page.evaluate(() => localStorage.getItem('ed:save:autosave'))).toBe(fullJSON);
    expect(errors).toEqual([]);

    // A new browser session keeps the prior valid Demo and can persist again
    // without tampering with the full-campaign continuation.
    await page.reload();
    await expect(page.locator('main.start')).toBeVisible();
    await page.getByRole('region', {
      name: mode === 'original' ? 'Demonstrations kept' : 'Saved demonstrations',
    }).getByRole('button', {
      name: /Return to the Demonstration|Continue the demonstration/,
    }).click();
    await expect(page.locator('.board')).toBeVisible();
    await expect(page.getByText(
      mode === 'original' ? 'saved' : 'Game saved.',
      { exact: true },
    )).toBeVisible();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('ed:save:demo-autosave')!).campaign)).toBe('demo');
    expect(await page.evaluate(() => localStorage.getItem('ed:save:autosave'))).toBe(fullJSON);
    expect(errors).toEqual([]);
  });
}
