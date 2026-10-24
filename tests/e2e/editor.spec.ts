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
  const wouldWarn = () => page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(await wouldWarn(), 'clean navigation should never warn').toBe(false);
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
  expect(await wouldWarn(), 'dirty content should require confirmation before unload').toBe(true);

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

test('authors rare Record and rumour through the UI without writing YAML (#1888)', async ({ page }) => {
  // Start on a Common scene: its Record block is forbidden, so this exercises
  // the exact incomplete metadata path that blocked rare/mythic authoring.
  const common = page.locator('.list .row').filter({ has: page.locator('.badge.common') }).first();
  await expect(common).toBeVisible();
  await common.click();
  await expect(page.locator('.list .row.on .badge')).toHaveText('common');

  await page.locator('.freqpick button.rare').click();
  await page.locator('details.panel > summary').filter({ hasText: 'Edit tier, purposes, Record' }).click();
  const metadata = page.locator('.event-metadata');
  await expect(metadata.getByText('This frequency requires a rumour.')).toBeVisible();
  await metadata.getByRole('button', { name: '+ add Record block' }).click();
  await metadata.getByRole('button', { name: '+ add rumour' }).click();
  await expect(metadata.getByRole('button', { name: 'remove Record block' })).toBeVisible();
  await expect(metadata.getByRole('button', { name: 'remove rumour' })).toBeVisible();

  await expect(state(page)).toContainText('1 file unsaved');
  await page.getByRole('button', { name: 'Review & save' }).click();
  // Observe the actual YAML writeback, not component-local form values.
  await expect(page.locator('.diff')).toContainText('frequency: rare');
  await expect(page.locator('.diff')).toContainText('rumour:');
  await expect(page.locator('.diff')).toContainText('record:');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
});

test('duplicate event refuses an existing ID without staging a write (#1888)', async ({ page }) => {
  const initialCount = await page.locator('.list .row').count();
  const selected = page.locator('.list .row.on .sub').first();
  const description = (await selected.textContent()) ?? '';
  const id = description.split(' · ').at(-1)?.trim();
  expect(id).toBeTruthy();
  await expect(state(page)).toContainText('nothing unsaved');

  await page.getByRole('button', { name: 'Duplicate this event…' }).click();
  await page.getByRole('textbox', { name: 'Duplicate event ID' }).fill(id!);
  await page.getByRole('button', { name: 'Create duplicate' }).click();

  await expect(page.getByRole('alert')).toContainText('already exists');
  expect(await page.locator('.list .row').count()).toBe(initialCount);
  await expect(state(page)).toContainText('nothing unsaved');
});

test('filters events by tier and errors, then jumps from the rail to a matching event (#1888)', async ({ page }) => {
  const list = page.locator('.list .row');
  const tier = page.getByRole('combobox', { name: 'Filter by tier' });
  const validation = page.getByRole('combobox', { name: 'Filter by validation' });
  await tier.selectOption('frame');
  await expect(list.first()).toBeVisible();
  for (const row of await list.all()) {
    await expect(row.locator('.sub').first()).toContainText(/^frame · /);
  }
  await tier.selectOption('all');

  // Turning a Common scene Rare creates two errors until its Record and
  // rumour are authored. Never save; this test must not mutate source files.
  const common = list.filter({ has: page.locator('.badge.common') }).first();
  await common.click();
  const label = (await page.locator('.list .row.on .sub').first().textContent()) ?? '';
  const id = label.split(' · ').at(-1)?.trim() ?? '';
  expect(id).toBeTruthy();
  await page.locator('.freqpick button.rare').click();
  await expect(page.locator('.state .issue-jump')).toBeVisible({ timeout: 15_000 });

  await validation.selectOption('errors');
  await expect(page.locator('.list .row.on')).toContainText(id);
  await view(page, 'Substories').click();
  await page.locator('.state .issue-jump').click();
  await expect(view(page, 'Events')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.list .row.on')).toContainText(id);
  await expect(page.locator('.event-metadata')).not.toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Filter by validation' })).toHaveValue('all');
  await expect(page.getByRole('combobox', { name: 'Filter by tier' })).toHaveValue('all');
});

test('creates a new Rare event and fills required Record and rumour without touching disk (#1888)', async ({ page }) => {
  // Intercept only the write transport, not the read/validation path. The
  // browser maintains its newly-created authored event in memory, while every
  // real content file on the runner remains unchanged.
  let writes = 0;
  await page.route('**/api/content', async (route) => {
    if (route.request().method() !== 'PUT') return route.continue();
    writes++;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });

  await page.getByRole('button', { name: '+ new' }).click();
  await page.getByPlaceholder('snake_case id, never renamed after commit').fill('e2e_rare_authoring_probe');
  await page.getByRole('button', { name: 'create', exact: true }).click();
  await expect(page.locator('.list .row.on')).toContainText('e2e_rare_authoring_probe');
  expect(writes).toBe(1);

  await page.locator('.freqpick button.rare').click();
  await page.locator('details.panel > summary')
    .filter({ hasText: 'Edit tier, purposes, Record' }).click();
  const metadata = page.locator('.event-metadata');
  await metadata.getByRole('button', { name: '+ add Record block' }).click();
  await metadata.getByRole('button', { name: '+ add rumour' }).click();

  await expect(metadata.getByRole('button', { name: 'remove Record block' })).toBeVisible();
  await expect(metadata.getByRole('button', { name: 'remove rumour' })).toBeVisible();
  await expect(state(page)).not.toContainText('validating', { timeout: 15_000 });
  await expect(state(page)).toContainText('0 errors');
  // Apart from the one intercepted creation, all updates are staged only.
  expect(writes).toBe(1);
});
