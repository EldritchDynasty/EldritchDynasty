import { expect, test, type Page } from '@playwright/test';

/**
 * THE EDITOR, IN A REAL BROWSER (#1891).
 *
 * Every failure here shipped with the editor's unit tests green:
 *
 *   - it booted to a blank page, and Instruments, Family tree and Simulate
 *     threw, because `core` was handed Vue proxies and Chromium's
 *     `structuredClone` refuses one where Node's accepts it;
 *   - clicking through events marked their files unsaved;
 *   - a keystroke in a title took over a second.
 *
 * So every test fails on any uncaught page error, and none of them writes to
 * disk: Review & save is opened and cancelled, never confirmed.
 */

const VIEWS = [
  ['Events', 'Events'],
  ['Substories', 'Substories'],
  ['Characters', 'Character templates'],
  ['Core prose', 'Core prose · Plain English'],
  ['Family tree', 'The family tree'],
  ['Simulate', 'Simulate'],
  ['Instruments', 'Instruments'],
] as const;

let pageErrors: string[] = [];

test.beforeEach(async ({ page }) => {
  pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.stack ?? e.message));
  await page.goto('/');
  await expect(page.locator('.list .row').first()).toBeVisible({ timeout: 60_000 });
});

test.afterEach(() => {
  expect(pageErrors, 'uncaught page errors').toEqual([]);
});

const view = (page: Page, label: string) =>
  page.getByRole('navigation', { name: 'Views' }).getByRole('button', { name: label, exact: true });
const state = (page: Page) => page.getByRole('status');
const title = (page: Page) => page.locator('main .panel input[type=text]').first();

test('boots on the Events view and renders every view', async ({ page }) => {
  expect(await page.locator('.list .row').count()).toBeGreaterThan(0);
  for (const [label, heading] of VIEWS) {
    await view(page, label).click();
    await expect(page.getByRole('heading', { level: 2, name: heading, exact: true })).toBeVisible();
  }
});

test('builds worlds: the family tree grows and the simulation begins', async ({ page }) => {
  await view(page, 'Family tree').click();
  await page.getByRole('button', { name: 'Grow the tree' }).click();
  await expect(page.getByRole('group', { name: /^Pedigree: \d+ people/ })).toBeVisible({ timeout: 60_000 });

  await view(page, 'Simulate').click();
  await page.getByRole('button', { name: 'Begin, 1042' }).click();
  await expect(page.getByText('Nothing is running. Press begin.')).toBeHidden({ timeout: 60_000 });
});

test('browsing is not editing; an edit marks exactly its own file', async ({ page }) => {
  await expect(state(page)).toContainText('nothing unsaved');
  const rows = page.locator('.list .row');
  const n = await rows.count();
  for (const i of [1, Math.floor(n / 4), Math.floor(n / 2), Math.floor((3 * n) / 4), n - 1]) {
    await rows.nth(i).click();
  }
  await expect(state(page)).toContainText('nothing unsaved');

  await title(page).click();
  await title(page).press('End');
  await title(page).pressSequentially(' (edited)');
  await expect(state(page)).toContainText('1 file unsaved');
  await expect(page.locator('.list .row.on')).toContainText('(edited)');

  await page.getByRole('button', { name: 'Review & save' }).click();
  // The diff also carries the save's re-serialisation of the rest of the
  // event (`store.ts` says why), so look for the edit, not the first line.
  await expect(page.locator('.diff .add', { hasText: '(edited)' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(state(page)).toContainText('1 file unsaved');
});

test('typing stays responsive while validation settles behind it', async ({ page }) => {
  await expect(state(page)).not.toContainText('validating');
  // Timed inside the page: ten input events, each followed by the frame it
  // renders in. Playwright's own round trips are not the editor's cost.
  const elapsed = await title(page).evaluate(async (input: HTMLInputElement) => {
    const frame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    const started = performance.now();
    for (const key of 'abcdefghij') {
      input.value += key;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await frame();
    }
    return performance.now() - started;
  });
  // About 50ms a key on a four-core container, from over 1.3s before #1891.
  // A generous bound: this catches the per-keystroke re-index coming back,
  // not a slow runner.
  expect(elapsed, `ten keystrokes took ${Math.round(elapsed)}ms`).toBeLessThan(1_500);
  await expect(page.locator('.list .row.on')).toContainText('abcdefghij');

  await expect(state(page)).not.toContainText('validating', { timeout: 10_000 });
  await expect(state(page)).toContainText(/\d+ errors? · \d+ warnings?/);
});
