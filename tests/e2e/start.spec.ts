import { expect, test } from '@playwright/test';

test('the game front door is playable in a real browser', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { level: 1, name: 'Eldritch Dynasty' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'The length of the line' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Begin the signing' })).toBeVisible();
});
