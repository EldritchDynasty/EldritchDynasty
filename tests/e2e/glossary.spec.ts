import { expect, test } from '@playwright/test';
import { loadBundle } from '@ed/content';
import { canonical, newGame } from '@ed/core';
import { ACCESSIBILITY_STORAGE_KEY } from '../../packages/client/src/lib/accessibility';

test.use({ hasTouch: true });

function glossarySave() {
  const game = newGame(loadBundle(), { seed: 1991, campaign: 'short' });
  const signing = game.prologue()!;
  expect(game.found({
    houseName: 'House Definition', heirloom: signing.heirlooms[0]!.heirloom, grudge: signing.grudges[0]!.house,
    answers: Object.fromEntries(signing.examination.map(question => [question.id, question.answers[0]!.id])),
  }).ok).toBe(true);
  game.ctx.world.chronicle.push({
    id: 'glossary-evidence', year: game.year, weight: 'paragraph', named: false,
    text: 'Regency kept the house together. Regency was written in the book.',
  });
  return game.save();
}

for (const scenario of [
  { mode: 'original', width: 1400, pseudo: false },
  { mode: 'plainenglish', width: 390, pseudo: false },
  { mode: 'plainenglish', width: 390, pseudo: true },
] as const) {
  test(`nested glossary preserves the run (${scenario.mode}, ${scenario.width}px, pseudo=${scenario.pseudo}) #1991`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width: scenario.width, height: 900 });
    await page.addInitScript(({ save, key, mode }) => {
      localStorage.setItem('ed:save:autosave', JSON.stringify(save));
      localStorage.setItem(key, JSON.stringify({ proseMode: mode, showEverythingFromStart: true, textScale: 'largest' }));
    }, { save: glossarySave(), key: ACCESSIBILITY_STORAGE_KEY, mode: scenario.mode });
    await page.goto(scenario.pseudo ? '/?pseudo-loc=1' : '/');
    // CSS locators survive pseudo-localisation's deliberate text expansion.
    await page.locator('main.start button.primary').click();
    await expect(page.locator('.board')).toBeVisible();
    const before = await page.evaluate(() => JSON.parse(localStorage.getItem('ed:save:autosave')!));
    if (scenario.width < 600) await page.locator('.panes button.book').click();
    const entry = page.locator('[data-entry="glossary-evidence"]').first();
    const primary = entry.locator('button.glossary-term').first();
    await expect(primary).toHaveAttribute('aria-expanded', 'false');
    // Touch opens a real disclosure; keyboard walks and closes its nested chain.
    await primary.tap();
    await expect(primary).toHaveAttribute('aria-expanded', 'true');
    const firstNote = entry.getByRole('note').first();
    const expresser = firstNote.locator('button').nth(1);
    await expresser.focus();
    await page.keyboard.press('Enter');
    const vessel = entry.getByRole('note').nth(1).locator('button');
    await vessel.focus();
    await page.keyboard.press('Enter');
    await expect(entry.getByRole('note')).toHaveCount(3);
    // The depth cap and cycle guard expose no fourth-level control.
    await expect(entry.getByRole('note').nth(2).locator('button')).toHaveCount(0);
    await expect(entry.locator('button button')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(vessel).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(expresser).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(primary).toBeFocused();
    await expect(entry.getByRole('note')).toHaveCount(0);
    // Only the first occurrence was marked; the original saved sentence remains intact.
    await expect(entry.locator('button.glossary-term')).toHaveCount(1);
    expect(await entry.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);

    // Table explanations use separate controls, including when a rite is unavailable.
    await page.locator('.panes button').nth(1).click();
    const tableHelp = page.locator('#table-greatWork .glossary-term').first();
    await tableHelp.click();
    await expect(page.locator('#table-greatWork [role="note"]')).toHaveCount(1);
    await tableHelp.press('Escape');
    await expect(tableHelp).toBeFocused();
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    const after = await page.evaluate(() => JSON.parse(localStorage.getItem('ed:save:autosave')!));
    expect(canonical(after)).toBe(canonical(before));
    expect(errors).toEqual([]);
  });
}
