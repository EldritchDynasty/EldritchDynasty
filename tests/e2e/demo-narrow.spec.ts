import { expect, test, type Page } from '@playwright/test';
import { loadBundle } from '@ed/content';
import { newGame } from '@ed/core';
import type { CampaignId, ProseMode } from '@ed/schema';
import { ACCESSIBILITY_STORAGE_KEY } from '../../packages/client/src/lib/accessibility';

/**
 * The 390px browser proof (#2159) does not establish the narrowest phone
 * layout with enlarged reader text. Exercise the real Start and save paths,
 * not a mounted component or a fabricated client store (#2168, part of #1979).
 */
function foundedSave(campaign: CampaignId) {
  const game = newGame(loadBundle(), { seed: campaign === 'demo' ? 2168 : 1042, campaign });
  const signing = game.prologue()!;
  expect(game.found({
    houseName: campaign === 'demo' ? 'House Narrow' : 'House Kept',
    heirloom: signing.heirlooms[0]!.heirloom,
    grudge: signing.grudges[0]!.house,
    answers: Object.fromEntries(signing.examination.map((question) =>
      [question.id, question.answers[0]!.id])),
  }).ok).toBe(true);
  return game.save();
}

const scenarios = [
  {
    mode: 'original',
    begin: 'Begin a new signing',
    region: 'Demonstrations kept',
    resume: 'Return to the Demonstration',
  },
  {
    mode: 'plainenglish',
    begin: 'Start a new game',
    region: 'Saved demonstrations',
    resume: 'Continue the demonstration',
  },
] as const;

async function openNarrow(page: Page, mode: ProseMode, withDemo: boolean) {
  const full = foundedSave('short');
  const demo = foundedSave('demo');
  await page.setViewportSize({ width: 320, height: 700 });
  // Tests make no later navigation: real host autosaves are not overwritten
  // by this test's initial storage fixture.
  await page.addInitScript(({ full, demo, mode, withDemo, key }) => {
    localStorage.setItem('ed:save:autosave', JSON.stringify(full));
    if (withDemo) localStorage.setItem('ed:save:demo-autosave', JSON.stringify(demo));
    localStorage.setItem(key, JSON.stringify({
      proseMode: mode,
      textScale: 'largest',
      showEverythingFromStart: true,
      sound: false,
    }));
  }, { full, demo, mode, withDemo, key: ACCESSIBILITY_STORAGE_KEY });
  await page.goto('/');
  await expect(page.locator('main.start')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-text-scale', 'largest');
  return full;
}

/** The reader must not need to pan sideways to reach the front-door controls. */
async function expectNoDocumentOverflow(page: Page) {
  const layout = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(layout.document, 'document is wider than the phone viewport').toBeLessThanOrEqual(layout.viewport);
  expect(layout.body, 'body is wider than the phone viewport').toBeLessThanOrEqual(layout.viewport);
}

/** Focused controls on the resumed phone board must be reachable without panning. */
async function expectFocusedControlInViewport(page: Page) {
  const bounds = await page.evaluate(() => {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return null;
    const { left, right, top, bottom } = active.getBoundingClientRect();
    return { left, right, top, bottom, width: window.innerWidth, height: window.innerHeight };
  });
  if (!bounds) throw new Error('No HTML control is focused');
  expect(bounds.left, 'focused control starts outside the phone viewport').toBeGreaterThanOrEqual(0);
  expect(bounds.right, 'focused control ends outside the phone viewport').toBeLessThanOrEqual(bounds.width);
  expect(bounds.top, 'focused control is above the phone viewport').toBeGreaterThanOrEqual(0);
  expect(bounds.bottom, 'focused control is below the phone viewport').toBeLessThanOrEqual(bounds.height);
}

for (const scenario of scenarios) {
  test(`narrow Demonstration launch uses the real signing and preserves the full save (${scenario.mode}) #2168`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const full = await openNarrow(page, scenario.mode, false);

    const demo = page.getByRole('radio', { name: /A Demonstration/ });
    await expect(demo).toBeVisible();
    await expectNoDocumentOverflow(page);
    await demo.focus();
    await page.keyboard.press('Space');
    await expect(demo).toBeChecked();

    const begin = page.getByRole('button', { name: scenario.begin, exact: true });
    await begin.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('main.prologue')).toBeVisible();
    await expectNoDocumentOverflow(page);

    await expect.poll(() => page.evaluate(() => {
      const json = localStorage.getItem('ed:save:demo-autosave');
      return json ? JSON.parse(json).campaign : null;
    })).toBe('demo');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('ed:save:autosave')!))).toEqual(full);
    expect(errors).toEqual([]);
  });

  test(`narrow Demonstration continuation stays operable without overwriting Short (${scenario.mode}) #2168`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const full = await openNarrow(page, scenario.mode, true);

    const demos = page.getByRole('region', { name: scenario.region });
    const resume = demos.getByRole('button', { name: /^(Return to the Demonstration|Continue the demonstration)\b/ });
    await expect(resume).toBeVisible();
    await expectNoDocumentOverflow(page);
    await resume.focus();
    await expect(resume).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(page.locator('.board')).toBeVisible();
    await expectNoDocumentOverflow(page);
    // The resume action was keyboard-operable on Start; the *resumed* board
    // must also expose reachable controls at 320px with the largest reader text.
    const board = page.locator('.board');
    const chronicle = page.locator('.panes button.book');
    await chronicle.focus();
    await expect(chronicle).toBeFocused();
    await expectFocusedControlInViewport(page);
    await page.keyboard.press('Enter');
    await expect(board).toHaveAttribute('data-pane', 'chronicle');
    await expect(chronicle).toHaveAttribute('aria-pressed', 'true');
    await expectNoDocumentOverflow(page);

    const house = page.locator('.panes button').first();
    await house.focus();
    await expect(house).toBeFocused();
    await expectFocusedControlInViewport(page);
    await page.keyboard.press('Enter');
    await expect(board).toHaveAttribute('data-pane', 'house');
    await expect(house).toHaveAttribute('aria-pressed', 'true');
    await expectNoDocumentOverflow(page);

    const campaign = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('ed:save:demo-autosave')!).campaign);
    expect(campaign).toBe('demo');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('ed:save:autosave')!))).toEqual(full);
    expect(errors).toEqual([]);
  });
}
