import { expect, test, type Page } from '@playwright/test';
import { loadBundle } from '@ed/content';
import { newGame } from '@ed/core';
import type { CampaignId, ProseMode } from '@ed/schema';
import { ACCESSIBILITY_STORAGE_KEY } from '../../packages/client/src/lib/accessibility';

/**
 * #1979: importing a portable save is not a campaign conversion. Exercise the
 * shipped Start -> file picker -> GameActions.importSave -> browser Platform path
 * rather than calling the store directly or fabricating a partially saved world.
 */
const bundle = loadBundle();

function foundedSave(campaign: CampaignId) {
  const game = newGame(bundle, { seed: campaign === 'demo' ? 1979 : 1042, campaign });
  const signing = game.prologue()!;
  expect(game.found({
    houseName: campaign === 'demo' ? 'House Imported Demonstration' : 'House Existing Line',
    heirloom: signing.heirlooms[0]!.heirloom,
    grudge: signing.grudges[0]!.house,
    answers: Object.fromEntries(signing.examination.map((question) =>
      [question.id, question.answers[0]!.id])),
  }).ok).toBe(true);
  return game.save();
}

async function importFile(page: Page, contents: string, mode: ProseMode) {
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', {
    name: mode === 'original' ? 'Bring a run in' : 'Import a saved game',
  }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: 'founding.edsave',
    mimeType: 'application/json',
    buffer: Buffer.from(contents, 'utf8'),
  });
}

for (const mode of ['original', 'plainenglish'] as const) {
  test(`importing a founded Demonstration preserves the full continuation (${mode}) #1979`, async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    const full = foundedSave('short');
    const demo = foundedSave('demo');

    await page.goto('/');
    await page.evaluate(({ full, mode, accessibilityKey }) => {
      localStorage.setItem('ed:save:autosave', JSON.stringify(full));
      localStorage.setItem(accessibilityKey, JSON.stringify({
        proseMode: mode,
        showEverythingFromStart: true,
      }));
    }, { full, mode, accessibilityKey: ACCESSIBILITY_STORAGE_KEY });
    await page.reload();
    await expect(page.locator('main.start')).toBeVisible();

    // The file has no slot namespace, but its authenticated campaign identity
    // must decide which rolling slot receives its next save.
    await importFile(page, JSON.stringify(demo), mode);
    await expect(page.locator('.board')).toBeVisible();
    await expect.poll(() => page.evaluate(() => {
      const saved = localStorage.getItem('ed:save:demo-autosave');
      return saved ? JSON.parse(saved).campaign : null;
    })).toBe('demo');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('ed:save:autosave')!))).toEqual(full);

    await page.reload();
    await expect(page.locator('main.start')).toBeVisible();
    await page.getByRole('button', {
      name: mode === 'original' ? 'Continue the last sitting' : 'Continue your last game',
      exact: true,
    }).click();
    await expect(page.locator('.board')).toBeVisible();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('ed:save:autosave')!).campaign)).toBe('short');

    // The separately imported 33-year run is still a Demonstration when read
    // again: neither a full-campaign continuation nor a save-transfer upgrade.
    await page.reload();
    await page.getByRole('region', {
      name: mode === 'original' ? 'Demonstrations kept' : 'Saved demonstrations',
    }).getByRole('button', {
      name: /Return to the Demonstration|Continue the demonstration/,
    }).click();
    await expect(page.locator('.board')).toBeVisible();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('ed:save:demo-autosave')!).campaign)).toBe('demo');
    expect(pageErrors).toEqual([]);
  });

  test(`invalid imported saves leave both campaign slots untouched (${mode}) #1979`, async ({ page }) => {
    const full = foundedSave('short');
    const demo = foundedSave('demo');
    await page.goto('/');
    await page.evaluate(({ full, demo, mode, accessibilityKey }) => {
      localStorage.setItem('ed:save:autosave', JSON.stringify(full));
      localStorage.setItem('ed:save:demo-autosave', JSON.stringify(demo));
      localStorage.setItem(accessibilityKey, JSON.stringify({
        proseMode: mode,
        showEverythingFromStart: true,
      }));
    }, { full, demo, mode, accessibilityKey: ACCESSIBILITY_STORAGE_KEY });
    await page.reload();
    await expect(page.locator('main.start')).toBeVisible();

    // Valid JSON but not a valid SavedGame. The import must be refused before
    // replacing either campaign's run (including the Demo's own autosave).
    await importFile(page, JSON.stringify({ campaign: 'demo', format: -1 }), mode);
    await expect(page.locator('main.start')).toBeVisible();
    await expect(page.getByText(
      mode === 'original'
        ? 'That file was not a run this version can read.'
        : 'This file is not a saved game this version can open.',
      { exact: true },
    )).toBeVisible();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('ed:save:autosave')!))).toEqual(full);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('ed:save:demo-autosave')!))).toEqual(demo);

    // Both original buttons are still usable after the refusal.
    await page.getByRole('region', {
      name: mode === 'original' ? 'Demonstrations kept' : 'Saved demonstrations',
    }).getByRole('button', { name: /Return to the Demonstration|Continue the demonstration/ }).click();
    await expect(page.locator('.board')).toBeVisible();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('ed:save:autosave')!).campaign)).toBe('short');
  });
}
