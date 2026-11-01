import { expect, test } from '@playwright/test';
import { loadBundle } from '@ed/content';
import { newGame } from '@ed/core';
import { ACCESSIBILITY_STORAGE_KEY } from '../../packages/client/src/lib/accessibility';

/**
 * Shipped-client verdict guidance, separate from #2163's in-flight
 * demo-arc.spec.ts. Reach the real ending with GameSession verbs, then press
 * the browser's final-year control; do not fabricate an epilogue.
 */
const bundle = loadBundle();

function beforeVerdictSave() {
  for (let i = 0; i < 32; i++) {
    const game = newGame(bundle, { seed: 5000 + 7 * i, campaign: 'demo' });
    const signing = game.prologue()!;
    expect(game.found({
      houseName: 'House First Account',
      heirloom: signing.heirlooms[0]!.heirloom,
      grudge: signing.grudges[0]!.house,
      answers: Object.fromEntries(signing.examination.map(q => [q.id, q.answers[0]!.id])),
    }).ok).toBe(true);

    for (let step = 0; step < 180 && game.year < 1074 && !game.epilogue(); step++) {
      if (game.pending.length) game.letHimDecide();
      else if (game.view().namesWanted.length) game.keepSuggestedNames();
      else game.advance(1);
    }
    if (game.year !== 1074 || game.epilogue()) continue;
    if (game.pending.length) game.letHimDecide();
    if (game.view().namesWanted.length) game.keepSuggestedNames();
    if (!game.pending.length && !game.view().namesWanted.length) return game.save();
  }
  throw new Error('No Demonstration seed reached the year before its verdict');
}

for (const mode of ['original', 'plainenglish'] as const) {
  test(`the Demonstration ending explains full campaigns (${mode}) #2207`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const save = beforeVerdictSave();
    await page.addInitScript(({ save, mode, key }) => {
      localStorage.setItem('ed:save:demo-autosave', JSON.stringify(save));
      localStorage.setItem(key, JSON.stringify({ proseMode: mode, showEverythingFromStart: true }));
    }, { save, mode, key: ACCESSIBILITY_STORAGE_KEY });

    await page.goto('/');
    await page.getByRole('region', {
      name: mode === 'original' ? 'Demonstrations kept' : 'Saved demonstrations',
    }).getByRole('button', {
      name: mode === 'original' ? /Return to the Demonstration/ : /Continue the demonstration/,
    }).click();

    // The browser owns the last advance and any intervening presentation.
    for (let attempt = 0; attempt < 15 && await page.locator('main.ending').count() === 0; attempt++) {
      const chapter = page.locator('.chapter[role="dialog"]');
      const frame = page.locator('.interlude[role="dialog"]');
      if (await chapter.count()) await chapter.getByRole('button').click();
      else if (await frame.count()) await frame.getByRole('button').click();
      else if (await page.locator('.outcome').count()) await page.locator('.outcome').getByRole('button').click();
      else if (await page.locator('.docket').count()) {
        await page.locator('.docket').getByRole('button', { name: /Let .* decide/ }).click();
      } else {
        await page.getByRole('button', {
          name: mode === 'original' ? 'On, to 1075' : 'Advance to 1075',
          exact: true,
        }).click();
      }
    }

    const ending = page.locator('main.ending');
    await expect(ending).toBeVisible();
    await expect(ending.locator(':scope > p.year')).toHaveText('1075');
    const note = ending.getByRole('region', {
      name: mode === 'original' ? 'Beyond this account' : 'Continue with a full campaign',
    });
    await expect(note).toContainText('Library of Houses');
    await expect(note).toContainText('Short');
    await expect(note).toContainText('Long');
    await expect(note).toContainText('generations');
    await expect(note).toContainText('Record');
    await expect(note).toContainText('creditor');
    await expect(note).toContainText('cannot');
    expect(errors).toEqual([]);
  });
}
