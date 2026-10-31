import { expect, test, type Page } from '@playwright/test';
import { loadBundle } from '@ed/content';
import { newGame } from '@ed/core';
import type { CampaignId, ProseMode } from '@ed/schema';
import { ACCESSIBILITY_STORAGE_KEY } from '../../packages/client/src/lib/accessibility';

/**
 * Browser contract for the locally exposed 33-year Demonstration (#1979).
 * These are genuine core saves, read through the real browser Platform and
 * Start -> GameActions path. No replacement session/store is mounted here.
 */
function foundedSave(campaign: CampaignId) {
  const game = newGame(loadBundle(), { seed: campaign === 'demo' ? 1979 : 1042, campaign });
  const prologue = game.prologue()!;
  const founded = game.found({
    houseName: campaign === 'demo' ? 'House Demonstration' : 'House Continuation',
    heirloom: prologue.heirlooms[0]!.heirloom,
    grudge: prologue.grudges[0]!.house,
    answers: Object.fromEntries(prologue.examination.map((q) => [q.id, q.answers[0]!.id])),
  });
  expect(founded.ok).toBe(true);
  return game.save();
}

/** Install durable data once, then reload without an init script that would overwrite later writes. */
async function openWithSaves(page: Page, mode: ProseMode, options: {
  demo?: boolean;
  namedDemo?: boolean;
  corruptDemo?: boolean;
} = {}) {
  const full = foundedSave('short');
  const demo = foundedSave('demo');
  await page.goto('/');
  await page.evaluate(({ full, demo, mode, options, accessibilityKey }) => {
    localStorage.setItem('ed:save:autosave', JSON.stringify(full));
    if (options.demo) localStorage.setItem('ed:save:demo-autosave', JSON.stringify(demo));
    if (options.namedDemo) localStorage.setItem('ed:save:demo-chapter-fixture', JSON.stringify(demo));
    if (options.corruptDemo) localStorage.setItem('ed:save:demo-autosave', '{"truncated":');
    localStorage.setItem(accessibilityKey, JSON.stringify({
      proseMode: mode,
      showEverythingFromStart: true,
    }));
  }, { full, demo, mode, options, accessibilityKey: ACCESSIBILITY_STORAGE_KEY });
  await page.reload();
  await expect(page.locator('main.start')).toBeVisible();
  return { full, demo };
}

for (const scenario of [
  { mode: 'original', width: 1400, group: 'The length of the line', begin: 'Begin a new signing', continue: 'Continue the last sitting' },
  { mode: 'plainenglish', width: 390, group: 'Choose the length of your game', begin: 'Start a new game', continue: 'Continue your last game' },
] as const) {
  test('Demonstration is keyboard-launchable and does not take the full autosave (' + scenario.mode + ', ' + scenario.width + 'px) #2159', async ({ page }) => {
    await page.setViewportSize({ width: scenario.width, height: 900 });
    const { full } = await openWithSaves(page, scenario.mode);

    await expect(page.getByRole('group', { name: scenario.group })).toBeVisible();
    const short = page.locator('input[name="campaign"][value="short"]');
    const demo = page.getByRole('radio', { name: /A Demonstration/ });
    await expect(short).toBeChecked();
    await expect(demo).not.toBeChecked();
    await expect(page.getByRole('button', { name: scenario.continue, exact: true })).toBeVisible();

    // Native keyboard activation, not a synthetic store call or a click on the label.
    await demo.focus();
    await page.keyboard.press('Space');
    await expect(demo).toBeChecked();
    await expect(page.locator('.frame').first()).toContainText('1042');
    await expect(page.locator('.frame').first()).toContainText('1075');
    await page.getByRole('button', { name: scenario.begin, exact: true }).click();

    await expect(page.locator('main.prologue')).toBeVisible();
    await expect(page.locator('main.start')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => {
      const saved = localStorage.getItem('ed:save:demo-autosave');
      return saved ? JSON.parse(saved).campaign : null;
    })).toBe('demo');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('ed:save:autosave')!))).toEqual(full);

    // Reload now reads the newly written demo, rather than re-seeding test data.
    await page.reload();
    await expect(page.locator('.demo-saved')).toBeVisible();
    await expect(page.getByRole('button', { name: scenario.continue, exact: true })).toBeVisible();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('ed:save:autosave')!))).toEqual(full);
  });
}

test('demo autosave, chapter and export stay separate from a Short Line continuation #2159', async ({ page }) => {
  const { full } = await openWithSaves(page, 'original', { demo: true, namedDemo: true });
  const demos = page.getByRole('region', { name: 'Demonstrations kept' });
  await expect(demos).toBeVisible();
  await expect(demos.getByRole('button', { name: /Return to the Demonstration/ })).toBeVisible();
  await expect(demos.getByRole('button', { name: /chapter-fixture/ })).toBeVisible();

  const downloadEvent = page.waitForEvent('download');
  await demos.getByRole('button', { name: 'Copy out demonstration demo-autosave' }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toMatch(/^eldritch-\d+\.json$/);

  await demos.getByRole('button', { name: /Return to the Demonstration/ }).click();
  await expect(page.locator('.board')).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('ed:save:autosave')!))).toEqual(full);

  await page.reload();
  await expect(page.locator('main.start')).toBeVisible();
  await page.getByRole('button', { name: 'Continue the last sitting', exact: true }).click();
  await expect(page.locator('.board')).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('ed:save:demo-autosave')!).campaign)).toBe('demo');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('ed:save:autosave')!).campaign)).toBe('short');
});

test('a named Demonstration chapter can be loaded without replacing the full autosave #2159', async ({ page }) => {
  const { full } = await openWithSaves(page, 'plainenglish', { namedDemo: true });
  const demos = page.getByRole('region', { name: 'Saved demonstrations' });
  await expect(demos.getByRole('button', { name: /chapter-fixture/ })).toBeVisible();
  await demos.getByRole('button', { name: /chapter-fixture/ }).click();
  await expect(page.locator('.board')).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('ed:save:autosave')!))).toEqual(full);
  await expect.poll(() => page.evaluate(() => {
    const saved = localStorage.getItem('ed:save:demo-autosave');
    return saved ? JSON.parse(saved).campaign : null;
  })).toBe('demo');
});

for (const mode of ['original', 'plainenglish'] as const) {
  test('a damaged demo slot is refused without losing the full campaign (' + mode + ') #2159', async ({ page }) => {
    const { full } = await openWithSaves(page, mode, { corruptDemo: true });
    const demoRegion = page.getByRole('region', { name: mode === 'original' ? 'Demonstrations kept' : 'Saved demonstrations' });
    const resumeDemo = demoRegion.getByRole('button', {
      name: /Return to the Demonstration|Continue the demonstration/,
    });
    await expect(resumeDemo).toBeVisible();
    await resumeDemo.click();

    await expect(page.locator('main.start')).toBeVisible();
    await expect(demoRegion.getByRole('status')).toContainText(
      mode === 'original' ? 'That saved run could not be read.' : 'Could not load this saved game.',
    );
    expect(await page.evaluate(() => localStorage.getItem('ed:save:demo-autosave'))).toBe('{"truncated":');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('ed:save:autosave')!))).toEqual(full);

    await page.getByRole('button', {
      name: mode === 'original' ? 'Continue the last sitting' : 'Continue your last game',
      exact: true,
    }).click();
    await expect(page.locator('.board')).toBeVisible();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('ed:save:autosave')!).campaign)).toBe('short');
  });
}
