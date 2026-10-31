import { expect, test, type Page } from '@playwright/test';
import { loadBundle } from '@ed/content';
import { newGame } from '@ed/core';
import type { CampaignId, ProseMode } from '@ed/schema';
import { ACCESSIBILITY_STORAGE_KEY } from '../../packages/client/src/lib/accessibility';

/** Save a real founded run, not a mocked client state. */
function foundedSave(campaign: CampaignId) {
  const game = newGame(loadBundle(), { seed: campaign === 'demo' ? 1979 : 1042, campaign });
  const prologue = game.prologue()!;
  expect(game.found({
    houseName: campaign === 'demo' ? 'House Demonstration' : 'House Continuation',
    heirloom: prologue.heirlooms[0]!.heirloom,
    grudge: prologue.grudges[0]!.house,
    answers: Object.fromEntries(prologue.examination.map((q) => [q.id, q.answers[0]!.id])),
  }).ok).toBe(true);
  return game.save();
}

async function openWithBoth(page: Page, mode: ProseMode) {
  const full = foundedSave('short');
  const demo = foundedSave('demo');
  await page.goto('/');
  await page.evaluate(({ full, demo, mode, key }) => {
    localStorage.setItem('ed:save:autosave', JSON.stringify(full));
    localStorage.setItem('ed:save:demo-autosave', JSON.stringify(demo));
    localStorage.setItem(key, JSON.stringify({ proseMode: mode, showEverythingFromStart: true }));
  }, { full, demo, mode, key: ACCESSIBILITY_STORAGE_KEY });
  await page.reload();
  await expect(page.locator('main.start')).toBeVisible();
  return full;
}

for (const mode of ['original', 'plainenglish'] as const) {
  test(`removing a Demo requires confirmation and never touches the full autosave (${mode}) #1979`, async ({ page }) => {
    const full = await openWithBoth(page, mode);
    const demos = page.getByRole('region', {
      name: mode === 'original' ? 'Demonstrations kept' : 'Saved demonstrations',
    });
    await expect(demos).toBeVisible();
    await expect(page.getByRole('button', {
      name: mode === 'original' ? 'Continue the last sitting' : 'Continue your last game',
      exact: true,
    })).toBeVisible();
    const remove = demos.getByRole('button', {
      name: mode === 'original' ? 'Remove demonstration demo-autosave' : 'Remove saved demonstration demo-autosave',
    });
    await remove.click();
    // Neither selecting Remove nor cancelling it is allowed to change a save.
    expect(await page.evaluate(() => localStorage.getItem('ed:save:demo-autosave'))).not.toBeNull();
    await demos.getByRole('button', { name: 'Cancel' }).click();
    expect(await page.evaluate(() => localStorage.getItem('ed:save:demo-autosave'))).not.toBeNull();

    await remove.click();
    await demos.getByRole('button', { name: /Yes, remove this/ }).click();
    await expect.poll(() => page.evaluate(() => localStorage.getItem('ed:save:demo-autosave'))).toBeNull();
    await expect(demos).toHaveCount(0);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('ed:save:autosave')!))).toEqual(full);

    await page.reload();
    await expect(page.locator('main.start')).toBeVisible();
    await expect(page.locator('.demo-saved')).toHaveCount(0);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('ed:save:autosave')!))).toEqual(full);
  });
}

test('a failed Demo deletion is visible and retryable; the full slot is never removed #1979', async ({ page }) => {
  const full = await openWithBoth(page, 'plainenglish');
  const demos = page.getByRole('region', { name: 'Saved demonstrations' });
  await expect(demos).toBeVisible();

  // The host rejects this deletion once, then accepts it. A failed operation
  // must retain the entry, its export action, and its explicit confirmation.
  await page.evaluate(() => {
    const original = Storage.prototype.removeItem;
    let rejectOnce = true;
    Storage.prototype.removeItem = function (key: string) {
      if (rejectOnce && key === 'ed:save:demo-autosave') {
        rejectOnce = false;
        throw new Error('the demo storage device is unavailable');
      }
      return original.call(this, key);
    };
  });

  await demos.getByRole('button', { name: 'Remove saved demonstration demo-autosave' }).click();
  const confirm = demos.getByRole('button', { name: 'Yes, remove this demonstration' });
  await confirm.click();
  await expect(demos.getByRole('status')).toContainText('Could not remove this saved demonstration. Try again.');
  expect(await page.evaluate(() => localStorage.getItem('ed:save:demo-autosave'))).not.toBeNull();
  await expect(demos.getByRole('button', { name: 'Export saved demonstration demo-autosave' })).toBeVisible();

  await confirm.click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('ed:save:demo-autosave'))).toBeNull();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('ed:save:autosave')!))).toEqual(full);
});
