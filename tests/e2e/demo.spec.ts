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

test('a denied demo autosave write leaves the full continuation intact #2313', async ({ page }) => {
  const { full } = await openWithSaves(page, 'original');
  await page.evaluate(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (this: Storage, key: string, value: string): void {
      if (key === 'ed:save:demo-autosave') {
        throw new DOMException('Storage quota reached for the demonstration', 'QuotaExceededError');
      }
      setItem.call(this, key, value);
    };
  });

  await page.getByRole('radio', { name: /A Demonstration/ }).check();
  await page.getByRole('button', { name: 'Begin a new signing', exact: true }).click();
  await expect(page.locator('main.prologue')).toBeVisible();

  // The failed write is only to the demo namespace. In particular, its
  // completion/error handler must never invalidate the normal continuation.
  await expect.poll(() => page.evaluate(() => localStorage.getItem('ed:save:demo-autosave'))).toBeNull();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('ed:save:autosave')!))).toEqual(full);

  // Reload also removes the page-local Storage fault injection. The ordinary
  // continuation must remain discoverable and loadable, not merely stored.
  await page.reload();
  await expect(page.locator('main.start')).toBeVisible();
  await page.getByRole('button', { name: 'Continue the last sitting', exact: true }).click();
  await expect(page.locator('.board')).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('ed:save:autosave')!).campaign)).toBe('short');
});

test('demo autosave, chapter and export stay separate from a Short Line continuation #2159', async ({ page }) => {
  const { full } = await openWithSaves(page, 'original', { demo: true, namedDemo: true });
  const demos = page.getByRole('region', { name: 'Demonstrations kept' });
  await expect(demos).toBeVisible();
  await expect(demos.getByRole('button', { name: /Return to the Demonstration/ })).toBeVisible();
  // Match the chapter action, not its sibling Copy out button, whose accessible
  // name also contains the chapter slot identifier.
  await expect(demos.getByRole('button', { name: /^chapter-fixture\b/ })).toBeVisible();

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
  await expect(demos.getByRole('button', { name: /^chapter-fixture\b/ })).toBeVisible();
  await demos.getByRole('button', { name: /^chapter-fixture\b/ }).click();
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

test('wrong-campaign save slots cannot turn a Demonstration into a full continuation #1979', async ({ page }) => {
  const { full, demo } = await openWithSaves(page, 'original');

  // A restored slot can contain valid bytes for a different campaign. Merely
  // having the demo- prefix must not make a Short Line a Demonstration.
  await page.evaluate((save) => {
    localStorage.setItem('ed:save:demo-autosave', JSON.stringify(save));
  }, full);
  await page.reload();
  const demonstrations = page.getByRole('region', { name: 'Demonstrations kept' });
  await expect(demonstrations.getByRole('button', { name: /Return to the Demonstration/ })).toBeVisible();
  await demonstrations.getByRole('button', { name: /Return to the Demonstration/ }).click();

  await expect(page.locator('main.start')).toBeVisible();
  await expect(demonstrations.getByRole('status')).toContainText('That saved run could not be read.');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('ed:save:autosave')!))).toEqual(full);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('ed:save:demo-autosave')!))).toEqual(full);

  // The inverse is dangerous too: ordinary Continue must not start an actual
  // demo found in the full-campaign slot or silently re-save it as a demo.
  await page.evaluate((save) => {
    localStorage.setItem('ed:save:autosave', JSON.stringify(save));
    localStorage.removeItem('ed:save:demo-autosave');
  }, demo);
  await page.reload();
  await page.getByRole('button', { name: 'Continue the last sitting', exact: true }).click();

  await expect(page.locator('main.start')).toBeVisible();
  await expect(page.locator('.resume-refusal')).toContainText('The last sitting could not be resumed.');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('ed:save:autosave')!))).toEqual(demo);
  expect(await page.evaluate(() => localStorage.getItem('ed:save:demo-autosave'))).toBeNull();
});
