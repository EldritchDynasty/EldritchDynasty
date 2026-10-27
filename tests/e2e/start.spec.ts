import { expect, test } from '@playwright/test';
import { loadBundle } from '@ed/content';
import { canonical, newGame } from '@ed/core';
import type { HouseAmbitionId } from '@ed/schema';
import { ACCESSIBILITY_STORAGE_KEY } from '../../packages/client/src/lib/accessibility';
import { TABLE_TARGETS } from '../../packages/client/src/lib/table-nav';

test('the game front door is playable in a real browser', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { level: 1, name: 'Eldritch Dynasty' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'The length of the line' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Begin the signing' })).toBeVisible();
});

function navigationSave(ambition: HouseAmbitionId) {
  const game = newGame(loadBundle(), { seed: 1941, campaign: 'short', startYear: 1200 });
  const signing = game.prologue()!;
  const founded = game.found({
    houseName: 'House Navigation', heirloom: signing.heirlooms[0]!.heirloom, grudge: signing.grudges[0]!.house,
    answers: Object.fromEntries(signing.examination.map(question => [question.id, question.answers[0]!.id])),
  });
  expect(founded.ok).toBe(true);
  expect(game.setAmbition(ambition)).toBe(true);
  return game.save();
}

for (const scenario of [
  { mode: 'original', width: 1400, ambition: 'restore_ledger', target: 'greatWork' },
  { mode: 'original', width: 390, ambition: 'raise_ascendant', target: 'programme' },
  { mode: 'plainenglish', width: 1400, ambition: 'deepen_blood', target: 'market' },
  { mode: 'plainenglish', width: 390, ambition: 'secure_branches', target: 'marriages' },
] as const) {
  test(`Table routes ${scenario.ambition}, ${scenario.mode}, ${scenario.width}px, enlarged text (#1941)`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width: scenario.width, height: 900 });
    const save = navigationSave(scenario.ambition);
    await page.addInitScript(({ save, key, mode }) => {
      localStorage.setItem('ed:save:autosave', JSON.stringify(save));
      localStorage.setItem(key, JSON.stringify({ proseMode: mode, textScale: 'largest', showEverythingFromStart: true }));
    }, { save, key: ACCESSIBILITY_STORAGE_KEY, mode: scenario.mode });
    await page.goto('/');
    await page.getByRole('button', { name: scenario.mode === 'original' ? 'Continue the last sitting' : 'Continue your last game', exact: true }).click();
    const routes = page.locator('.ambition-routes');
    await routes.locator('summary').focus();
    await page.keyboard.press('Enter');
    const link = routes.locator(`[data-table-go="${scenario.target}"]`);
    for (let attempt = 0; attempt < 2; attempt++) {
      await link.focus();
      await page.keyboard.press('Enter');
      const destination = page.locator(`[data-table-target="${scenario.target}"]`);
      await expect(destination).toBeVisible();
      await expect.poll(() => destination.evaluate(panel => panel.contains(document.activeElement))).toBe(true);
      const anchors = await page.locator('[data-table-target]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-table-target')).sort());
      expect(anchors).toEqual([...TABLE_TARGETS].sort());
      await page.locator('.return-goal').focus();
      await page.keyboard.press('Enter');
      await expect(link).toBeFocused();
    }
    // Each common task reaches a current section, using native disclosures and keyboard activation.
    await page.getByRole('button', { name: scenario.mode === 'original' ? 'The table' : 'Family orders', exact: true }).click();
    const summaries = page.locator('.table-tasks > details > summary');
    await expect(summaries).toHaveCount(5);
    for (let index = 1; index < 5; index++) {
      await summaries.nth(index).focus();
      await page.keyboard.press('Enter');
      const taskLink = page.locator('.table-tasks > details').nth(index).locator('[data-table-go]').first();
      const target = await taskLink.getAttribute('data-table-go');
      await taskLink.focus();
      await page.keyboard.press('Enter');
      await expect.poll(() => page.locator(`[data-table-target="${target}"]`).evaluate(panel => panel.contains(document.activeElement))).toBe(true);
    }
    const index = page.locator('.table-tasks');
    await index.scrollIntoViewIfNeeded();
    expect(await index.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    const before = await page.evaluate(() => JSON.parse(localStorage.getItem('ed:save:autosave')!));
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('ed:save:autosave')!).savedAt)).not.toBe(before.savedAt);
    const after = await page.evaluate(() => JSON.parse(localStorage.getItem('ed:save:autosave')!));
    expect(canonical({ ...after, savedAt: '' })).toBe(canonical({ ...before, savedAt: '' }));
    expect(after.decisionLog).toEqual(before.decisionLog);
    expect(errors).toEqual([]);
  });
}
