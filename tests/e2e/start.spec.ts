import { expect, test } from '@playwright/test';
import { loadBundle } from '@ed/content';
import { canonical, newGame, place } from '@ed/core';
import type { FoundingConfiguration, HouseAmbitionId } from '@ed/schema';
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

function recordedLifeSave(configuration: FoundingConfiguration) {
  const game = newGame(loadBundle(), { seed: 1944, campaign: 'short', startYear: 1200 });
  const signing = game.prologue()!;
  expect(game.found({ houseName: 'House Record', founder: { name: 'Arlen', gender: 'nonbinary', configuration },
    heirloom: signing.heirlooms[0]!.heirloom, grudge: signing.grudges[0]!.house,
    answers: Object.fromEntries(signing.examination.map(question => [question.id, question.answers[0]!.id])),
  }).ok).toBe(true);
  const w = game.ctx.world;
  const founder = w.people.mustGet(w.narrator!);
  const child = place(game.ctx, { sex: 'female', age: 0, name: 'Suggested name' });
  w.pendingNames.push({ person: child.id, born: w.year, suggested: child.name, sex: child.sex, because: 'the Head has a daughter' });
  expect(game.name(child.id, 'Renamed relative')).toBe(true);
  const ancestor = place(game.ctx, { sex: 'female', age: 60, name: 'Alys of Bramme' });
  w.chronicle.push({ id: 'life-deed', year: 1201, text: 'The family kept the account of the fees.', title: 'The fees at Cawdry', weight: 'paragraph', named: true,
    people: [child.id, ancestor.id, founder.id], claims: [{ kind: 'deed', person: child.id, text: 'was tutored by Osric' }, { kind: 'deed', person: ancestor.id, text: 'paid the Corran fees' }] });
  w.chronicle.push({ id: 'life-blank', year: 1202, text: null, title: 'PRIVATE omitted title', eventId: 'private_omitted_event', record: 'omit', weight: 'paragraph', named: false,
    people: [child.id, ancestor.id], claims: [{ kind: 'deed', person: child.id, text: 'PRIVATE omitted deed' }] });
  w.people.kill(ancestor.id, 1203, 'a recorded illness');
  w.year = 1208;
  for (let i = 0; i < 65; i++) w.chronicle.push({ id: `quiet-${i}`, year: 1208, text: 'A quiet year in the family account.', weight: 'line', named: false });
  w.chronicle.push({ id: 'life-mention', year: 1208, title: 'An old letter', text: 'The house read an old letter.', weight: 'paragraph', named: true, people: [ancestor.id] });
  return { save: game.save(), child: child.id, ancestor: ancestor.id, founder: founder.id };
}

for (const scenario of [
  { mode: 'original', width: 1400, configuration: 'blood_father' },
  { mode: 'original', width: 390, configuration: 'blood_mother' },
  { mode: 'plainenglish', width: 1400, configuration: 'blood_mother' },
  { mode: 'plainenglish', width: 390, configuration: 'blood_father' },
] as const) {
  test(`Recorded life sources and focus, ${scenario.configuration}, ${scenario.mode}, ${scenario.width}px (#1944)`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width: scenario.width, height: 900 });
    const fixture = recordedLifeSave(scenario.configuration);
    await page.addInitScript(({ save, key, mode }) => {
      localStorage.setItem('ed:save:autosave', JSON.stringify(save));
      localStorage.setItem(key, JSON.stringify({ proseMode: mode, textScale: 'largest', showEverythingFromStart: true }));
    }, { save: fixture.save, key: ACCESSIBILITY_STORAGE_KEY, mode: scenario.mode });
    await page.goto('/');
    await page.getByRole('button', { name: scenario.mode === 'original' ? 'Continue the last sitting' : 'Continue your last game', exact: true }).click();
    const before = await page.evaluate(() => JSON.parse(localStorage.getItem('ed:save:autosave')!));
    const member = page.locator(`#member-${fixture.child}`);
    await member.locator('.face').click();
    const source = member.locator('[data-milestone="life-deed"]');
    await expect(source).toContainText('was tutored by Osric');
    await source.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.volume [data-entry="life-deed"]')).toBeFocused();
    expect(await page.locator('.volume [data-person]').evaluateAll(nodes => nodes.every(node => node.getBoundingClientRect().height >= 44 && node.getBoundingClientRect().width >= 44))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(source).toBeFocused();
    if (scenario.width === 390) expect(await source.evaluate(node => node.getBoundingClientRect().bottom <= document.querySelector('.panes')!.getBoundingClientRect().top)).toBe(true);
    const all = member.locator('.all-pages');
    await all.locator('summary').focus();
    await page.keyboard.press('Enter');
    const blank = all.locator('[data-history-page="life-blank"]');
    await expect(blank).toContainText(scenario.mode === 'original' ? 'left blank, on purpose' : 'deliberately left blank');
    await blank.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.volume [data-entry="life-blank"]')).toBeFocused();
    await expect(page.locator('.volume')).not.toContainText('PRIVATE');
    await page.keyboard.press('Escape');
    await expect(blank).toBeFocused();

    // An archived relative remains reachable by the Chronicle, even when their deed is outside its window.
    if (scenario.width === 390) await page.locator('.panes .book').click();
    const ancestor = page.locator(`.chronicle [data-person="${fixture.ancestor}"]`);
    await ancestor.focus();
    await page.keyboard.press('Enter');
    const history = page.locator('.volume .person-history');
    await expect(history).toBeFocused();
    await expect(history).toContainText('Alys of Bramme');
    const oldSource = history.locator('[data-milestone="life-deed"]');
    await oldSource.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.volume [data-entry="life-deed"]')).toBeFocused();
    await page.locator('.volume .return-life').focus();
    await page.keyboard.press('Enter');
    await expect(oldSource).toBeFocused();
    expect(await history.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await page.keyboard.press('Escape');
    await expect(ancestor).toBeFocused();

    // The Book is the top modal when a source opens from the succession history.
    if (scenario.width === 390) await page.locator('.panes button').first().click();
    const head = page.locator(`#member-${fixture.founder}`);
    await head.locator('.face').click();
    await head.getByRole('button', { name: scenario.mode === 'original' ? 'Who has held the seal' : 'History of family leaders', exact: true }).click();
    const life = page.locator('.spine .life').first();
    await life.locator(':scope > summary').focus();
    await page.keyboard.press('Enter');
    const spineSource = life.locator('[data-milestone="life-deed"]');
    await spineSource.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.volume [data-entry="life-deed"]')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(spineSource).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('.spine')).toHaveCount(0);
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('ed:save:autosave')!).savedAt)).not.toBe(before.savedAt);
    const after = await page.evaluate(() => JSON.parse(localStorage.getItem('ed:save:autosave')!));
    expect(canonical({ ...after, savedAt: '' })).toBe(canonical({ ...before, savedAt: '' }));
    expect(after.decisionLog).toEqual(before.decisionLog);
    expect(errors).toEqual([]);
  });
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
