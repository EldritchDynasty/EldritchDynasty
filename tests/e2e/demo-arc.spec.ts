import { expect, test, type Page } from '@playwright/test';
import { loadBundle } from '@ed/content';
import { newGame } from '@ed/core';
import type { CampaignId, ProseMode } from '@ed/schema';
import { ACCESSIBILITY_STORAGE_KEY } from '../../packages/client/src/lib/accessibility';

/**
 * The browser half of the 33-year Demonstration (#2163, part of #1979).
 * The core's 64-seed witness proves the authored events occur. These tests
 * cross the real host's save/load boundary and press the shipped client controls:
 * a Record must be answerable, the next interlude must be dismissible, and
 * the short campaign must reach a visible verdict.
 *
 * Keep this independent of #2159's front-door/save-isolation spec.
 */
const bundle = loadBundle();

function founded(campaign: CampaignId, seed: number) {
  const game = newGame(bundle, { seed, campaign });
  const signing = game.prologue()!;
  expect(game.found({
    houseName: campaign === 'demo' ? 'House First Account' : 'House Full Line',
    heirloom: signing.heirlooms[0]!.heirloom,
    grudge: signing.grudges[0]!.house,
    answers: Object.fromEntries(signing.examination.map(q => [q.id, q.answers[0]!.id])),
  }).ok).toBe(true);
  return game;
}

/** Public GameSession verbs, never a hand-edited world or invented pending decision. */
function pendingRecordSave() {
  for (let i = 0; i < 16; i++) {
    const game = founded('demo', 5000 + 7 * i);
    for (let step = 0; step < 35 && !game.epilogue(); step++) {
      const next = game.pending[0];
      if (next?.kind === 'record' && next.event.id === 'demo_the_last_page') {
        expect(game.year).toBeGreaterThanOrEqual(1044);
        return game.save();
      }
      if (next) game.letHimDecide();
      else game.advance(1);
    }
  }
  throw new Error('No Demonstration seed offered its authored Record through GameSession');
}

/** The final year is advanced by the browser, not by the fixture. */
function beforeVerdictSave() {
  for (let i = 0; i < 32; i++) {
    const game = founded('demo', 5000 + 7 * i);
    for (let step = 0; step < 180 && game.year < 1074 && !game.epilogue(); step++) {
      if (game.pending.length) game.letHimDecide();
      else if (game.view().namesWanted.length) game.keepSuggestedNames();
      else game.advance(1);
    }
    if (game.year !== 1074 || game.epilogue()) continue;
    // A pending page at 1074 is still a genuine page; answer it before saving
    // so the browser's next action is unambiguously the final year.
    if (game.pending.length) game.letHimDecide();
    if (game.view().namesWanted.length) game.keepSuggestedNames();
    if (!game.pending.length && !game.view().namesWanted.length) return game.save();
  }
  throw new Error('No Demonstration seed reached the year before its verdict');
}

async function openSavedDemo(page: Page, mode: ProseMode, save: ReturnType<ReturnType<typeof newGame>['save']>, full: ReturnType<ReturnType<typeof newGame>['save']>) {
  await page.addInitScript(({ save, full, mode, key }) => {
    // Seed only the first page. Subsequent reloads must see writes made by the
    // actual browser Platform rather than restoring this initial snapshot.
    if (!sessionStorage.getItem('demo-arc-seeded')) {
      localStorage.setItem('ed:save:demo-autosave', JSON.stringify(save));
      localStorage.setItem('ed:save:autosave', JSON.stringify(full));
      localStorage.setItem(key, JSON.stringify({ proseMode: mode, showEverythingFromStart: true }));
      sessionStorage.setItem('demo-arc-seeded', 'yes');
    }
  }, { save, full, mode, key: ACCESSIBILITY_STORAGE_KEY });
  await page.goto('/');
  await resumeDemo(page, mode);
}

/**
 * A page load always opens on Start; the client never auto-resumes. Return to
 * the Demonstration through its own saved-demo control, as a player would.
 */
async function resumeDemo(page: Page, mode: ProseMode) {
  await page.getByRole('region', {
    name: mode === 'original' ? 'Demonstrations kept' : 'Saved demonstrations',
  }).getByRole('button', {
    name: mode === 'original' ? /Return to the Demonstration/ : /Continue the demonstration/,
  }).click();
  await expect(page.locator('.board')).toBeVisible();
}

async function fullSaveUnchanged(page: Page, full: ReturnType<ReturnType<typeof newGame>['save']>) {
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('ed:save:autosave')!))).toEqual(full);
}

for (const mode of ['original', 'plainenglish'] as const) {
  test(`the Demonstration Record leads to a dismissible interlude (${mode}) #2163`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const full = founded('short', 2163).save();
    await openSavedDemo(page, mode, pendingRecordSave(), full);

    const docket = page.locator('.docket');
    await expect(docket).toBeVisible();
    await expect(docket).toContainText(mode === 'original' ? 'what the book will say' : 'Choose what to record');
    // The pending Record must survive a real reload: the page comes back on
    // Start, and the same unanswered page is waiting in the resumed save.
    await page.reload();
    await expect(page.locator('.board')).toHaveCount(0);
    await resumeDemo(page, mode);
    await expect(docket).toBeVisible();
    await expect(docket).toContainText(mode === 'original' ? 'what the book will say' : 'Choose what to record');

    await docket.getByRole('button', {
      name: mode === 'original' ? /Write it as it happened/ : /Record what happened/,
    }).click();
    const outcome = page.locator('.outcome');
    await expect(outcome).toContainText(mode === 'original' ? 'What came of it' : 'What happened next');
    await expect.poll(() => page.evaluate(() => {
      const saved = localStorage.getItem('ed:save:demo-autosave');
      return saved ? JSON.parse(saved).decisionLog.some(
        (decision: { kind: string; event?: string }) => decision.kind === 'record' && decision.event === 'demo_the_last_page',
      ) : false;
    })).toBe(true);
    await fullSaveUnchanged(page, full);
    await outcome.getByRole('button', { name: mode === 'original' ? 'Go on' : 'Continue' }).click();

    // The authored interlude is scheduled one year after the Record. A stray
    // docket or Age card cannot be bypassed by clicking through the overlay.
    const frame = page.locator('.interlude[role="dialog"]');
    for (let attempt = 0; attempt < 12 && await frame.count() === 0; attempt++) {
      const chapter = page.locator('.chapter[role="dialog"]');
      if (await chapter.count()) {
        await chapter.getByRole('button').click();
      } else if (await page.locator('.outcome').count()) {
        await page.locator('.outcome').getByRole('button').click();
      } else if (await page.locator('.docket').count()) {
        await page.locator('.docket').getByRole('button', { name: /Let .* decide/ }).click();
      } else {
        await page.getByRole('button', { name: mode === 'original' ? 'A year' : 'Advance 1 year', exact: true }).click();
      }
    }
    await expect(frame).toBeVisible();
    await expect(frame).toContainText(mode === 'original' ? 'blossom' : 'flower');
    await frame.getByRole('button', { name: mode === 'original' ? 'Go on' : 'Continue' }).click();
    await expect(frame).toHaveCount(0);
    await fullSaveUnchanged(page, full);
    expect(errors).toEqual([]);
  });

  test(`the Demonstration's final year shows a real verdict (${mode}) #2163`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const full = founded('short', 3163).save();
    await openSavedDemo(page, mode, beforeVerdictSave(), full);

    for (let attempt = 0; attempt < 15 && await page.locator('main.ending').count() === 0; attempt++) {
      const chapter = page.locator('.chapter[role="dialog"]');
      const frame = page.locator('.interlude[role="dialog"]');
      if (await chapter.count()) {
        await chapter.getByRole('button').click();
      } else if (await frame.count()) {
        await frame.getByRole('button').click();
      } else if (await page.locator('.outcome').count()) {
        await page.locator('.outcome').getByRole('button').click();
      } else if (await page.locator('.docket').count()) {
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
    // The verdict's own year heads the page; Chronicle excerpts below it carry
    // their own `.year` badges, so only the direct child names the ending.
    await expect(ending.locator(':scope > p.year')).toHaveText('1075');
    await expect(ending).toContainText(mode === 'original' ? 'The reckoning' : 'Ending summary');
    await fullSaveUnchanged(page, full);
    expect(errors).toEqual([]);
  });
}
