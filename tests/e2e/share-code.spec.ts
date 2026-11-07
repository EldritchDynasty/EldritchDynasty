import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { loadBundle } from '@ed/content';
import { canonical, closeTheLedger, newGame, newGameFromShareCode, readShareCode } from '@ed/core';
import { ACCESSIBILITY_STORAGE_KEY } from '../../packages/client/src/lib/accessibility';

/**
 * Import the actual core's founding code through the shipped Start screen (#1995).
 * A unit round-trip cannot prove that a pasted code, missing-name fields and
 * durable browser autosave all follow the same newGame -> found path.
 */
const content = loadBundle();
const build = process.env.ED_BUILD_SHA
  || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

function makeFounded(
  seed: number,
  houseName: string,
  names: { founder?: string; friend?: string } = {},
) {
  const game = newGame(content, { seed, campaign: 'short' });
  const prologue = game.prologue()!;
  const choice = {
    houseName,
    heirloom: prologue.heirlooms[0]!.heirloom,
    grudge: prologue.grudges[0]!.house,
    answers: Object.fromEntries(prologue.examination.map(q => [q.id, q.answers[0]!.id])),
    founder: { name: names.founder ?? 'Alys of the Record', gender: 'woman' as const, configuration: 'blood_mother' as const },
    friends: [{ name: names.friend ?? 'Iona of the Ford', sex: 'female' as const }],
  };
  const founded = game.found(choice);
  expect(founded, founded.reason).toMatchObject({ ok: true });
  return { game, choice };
}

for (const mode of ['original', 'plainenglish'] as const) {
  test(`share-code import keeps invalid codes from replacing a saved run and starts a real founding (${mode}) #1995`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const { game: sender, choice } = makeFounded(1995, 'House Sender');
    const code = sender.shareCode({ build });
    expect(code.ok).toBe(true);
    if (!code.ok) return;
    const oldSave = makeFounded(777, 'House Previously Saved').game.save();

    await page.addInitScript(({ saved, key, mode }) => {
      localStorage.setItem('ed:save:autosave', JSON.stringify(saved));
      localStorage.setItem(key, JSON.stringify({ proseMode: mode, showEverythingFromStart: true }));
    }, { saved: oldSave, key: ACCESSIBILITY_STORAGE_KEY, mode });
    await page.goto('/');
    await expect(page.locator('main.start')).toBeVisible();
    await page.getByRole('button', { name: mode === 'original' ? 'Advanced' : 'Advanced options', exact: true }).click();

    const input = page.locator('#share-code-in');
    // A damaged pasted code is rejected in the real interface, before any
    // newGame call or mutation to the existing full-campaign autosave.
    await input.fill(code.code.slice(0, -8));
    await expect(page.locator('#share-code-error')).toBeVisible();
    await expect(page.getByRole('button', { name: mode === 'original' ? 'Sign from this code' : 'Start from this code' })).toHaveCount(0);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('ed:save:autosave')!))).toEqual(oldSave);
    await expect(page.locator('main.prologue')).toHaveCount(0);

    // A genuine nameless code advertises the mechanically identical founding,
    // while asking the recipient for names that must not be silently shared.
    await input.fill(code.code);
    await expect(page.locator('#share-code-error')).toHaveCount(0);
    await expect(page.locator('#share-house')).toBeVisible();
    await expect(page.locator('#share-founder')).toBeVisible();
    await expect(page.locator('#share-friend-0')).toBeVisible();
    await expect(page.locator('.share-start')).toContainText('1995');
    await page.locator('#share-house').fill('House Recipient');
    await page.locator('#share-founder').fill('New Founder');
    await page.locator('#share-friend-0').fill('New Friend');
    await page.getByRole('button', { name: mode === 'original' ? 'Sign from this code' : 'Start from this code' }).click();

    await expect(page.locator('main.prologue')).toBeVisible();
    await expect.poll(() => page.evaluate(() => {
      const saved = localStorage.getItem('ed:save:autosave');
      if (!saved) return null;
      const run = JSON.parse(saved);
      return run.founding?.houseName ?? null;
    })).toBe('House Recipient');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('ed:save:autosave')!));
    expect(saved.campaign).toBe('short');
    expect(saved.seed).toBe(1995);
    expect(saved.founding).toMatchObject({
      houseName: 'House Recipient', heirloom: choice.heirloom, grudge: choice.grudge,
    });
    expect(saved.decisionLog.some((row: { kind: string }) => row.kind === 'founding')).toBe(true);
    expect(errors).toEqual([]);
  });

  test(`share-code import preserves opt-in Unicode names without prompting again (${mode}) #1995`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const { game: sender, choice } = makeFounded(1996, '星の家', {
      founder: 'Élodie 雪',
      friend: '蘭花 Vale',
    });
    // The sender deliberately included personal text. The recipient must not
    // be asked to replace it, and the Start UI must pass it to found() intact.
    const code = sender.shareCode({ build, names: true });
    expect(code.ok).toBe(true);
    if (!code.ok) return;

    await page.addInitScript(({ key, mode }) => {
      localStorage.setItem(key, JSON.stringify({ proseMode: mode, showEverythingFromStart: true }));
    }, { key: ACCESSIBILITY_STORAGE_KEY, mode });
    await page.goto('/');
    await expect(page.locator('main.start')).toBeVisible();
    await page.getByRole('button', { name: mode === 'original' ? 'Advanced' : 'Advanced options', exact: true }).click();
    await page.locator('#share-code-in').fill(code.code);

    await expect(page.locator('#share-code-error')).toHaveCount(0);
    await expect(page.locator('.share-start')).toContainText('1996');
    await expect(page.locator('#share-house')).toHaveCount(0);
    await expect(page.locator('#share-founder')).toHaveCount(0);
    await expect(page.locator('#share-friend-0')).toHaveCount(0);

    await page.getByRole('button', { name: mode === 'original' ? 'Sign from this code' : 'Start from this code' }).click();
    await expect(page.locator('main.prologue')).toBeVisible();
    await expect.poll(() => page.evaluate(() => {
      const saved = localStorage.getItem('ed:save:autosave');
      return saved ? JSON.parse(saved).founding?.houseName ?? null : null;
    })).toBe(choice.houseName);

    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('ed:save:autosave')!));
    expect(saved.campaign).toBe('short');
    expect(saved.seed).toBe(1996);
    expect(saved.founding.houseName).toBe(choice.houseName);
    // A successful UI import must reproduce the whole durable founding,
    // not merely include the names somewhere in an otherwise wrong save.
    // Match the same fixed, empty recipient Library and chosen prose mode.
    const expected = newGameFromShareCode(code.code, content, {
      build, proseMode: mode,
    });
    expect(expected.ok).toBe(true);
    if (!expected.ok) return;
    expect(canonical(saved)).toBe(canonical(expected.session.save()));

    // A cold page reload must offer that run to resume and preserve all its
    // founding data, not rebuild a subtly different one from the share code.
    await page.reload();
    await expect(page.locator('main.start')).toBeVisible();
    await page.getByRole('button', {
      name: mode === 'original' ? 'Continue the last sitting' : 'Continue your last game',
      exact: true,
    }).click();
    await expect(page.locator('main.start')).toHaveCount(0);
    const resumed = await page.evaluate(() => JSON.parse(localStorage.getItem('ed:save:autosave')!));
    expect(canonical(resumed)).toBe(canonical(expected.session.save()));
    expect(errors).toEqual([]);
  });
}

test('share-code name refusals follow the current prose mode without a second import #1995', async ({ page }) => {
  const { game: sender } = makeFounded(2002, 'House Sender');
  const code = sender.shareCode({ build });
  expect(code.ok).toBe(true);
  if (!code.ok) return;

  await page.goto('/');
  await expect(page.locator('main.start')).toBeVisible();
  await page.getByRole('button', { name: 'Advanced', exact: true }).click();
  await page.locator('#share-code-in').fill(code.code);

  // A valid anonymous founding requires recipient names. The failed Begin is
  // a structured reason, not English fixed to the mode at click time.
  await page.getByRole('button', { name: 'Sign from this code' }).click();
  await expect(page.locator('#share-code-error')).toContainText('The code left');
  await expect(page.locator('main.start')).toBeVisible();

  await page.getByRole('combobox', { name: 'Prose style' }).selectOption('plainenglish');
  await expect(page.locator('#share-code-error')).toContainText('Enter the missing names');
  await page.getByRole('combobox', { name: 'Writing style' }).selectOption('original');
  await expect(page.locator('#share-code-error')).toContainText('The code left');

  expect(await page.evaluate(() => localStorage.getItem('ed:save:autosave'))).toBeNull();
});

for (const scenario of [
  { mode: 'original', width: 1400 },
  { mode: 'plainenglish', width: 390 },
] as const) {
  test(`ending image code imports the complete founding after a clipboard refusal (${scenario.mode}) #1995`, async ({ page, browser }) => {
    const { game: sender, choice } = makeFounded(1997, 'House Image', { founder: 'Élodie 雪', friend: '蘭花 Vale' });
    const anonymous = sender.shareCode({ build });
    expect(anonymous.ok).toBe(true);
    if (!anonymous.ok) throw new Error('No image code');
    // Build a completed fixture through the production finalization function.
    sender.ctx.world.year = sender.view().campaign.endYear;
    closeTheLedger(sender.ctx);
    await page.setViewportSize({ width: scenario.width, height: 900 });
    await page.addInitScript(({ save, key, mode }) => {
      localStorage.setItem('ed:save:autosave', JSON.stringify(save));
      localStorage.setItem(key, JSON.stringify({ proseMode: mode, showEverythingFromStart: true }));
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
        writeText: async () => { throw new DOMException('Clipboard denied', 'NotAllowedError'); },
      } });
      document.execCommand = () => false;
      HTMLCanvasElement.prototype.toBlob = callback => callback(null);
    }, { save: sender.save(), key: ACCESSIBILITY_STORAGE_KEY, mode: scenario.mode });
    await page.goto('/');
    await page.locator('main.start button.primary').click();
    const textCode = page.locator('#share-code');
    await expect(textCode).toHaveValue(anonymous.code);
    await page.locator('.share-names input').check();
    const named = await textCode.inputValue();
    expect(named).not.toBe(anonymous.code);
    const readNamed = readShareCode(named, content, { build });
    expect(readNamed.ok && readNamed.founding.houseName).toBe(choice.houseName);
    await page.getByRole('button', { name: scenario.mode === 'original' ? 'Copy the code' : 'Copy code', exact: true }).click();
    await expect(page.locator('.share-copy [role="status"]')).toContainText(scenario.mode === 'original' ? 'copy did not take' : 'Could not copy');
    await textCode.focus();
    expect(await textCode.evaluate(node => node.selectionEnd! - node.selectionStart!)).toBe(named.length);

    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: scenario.mode === 'original' ? 'Save the house afterimage' : 'Save ending image', exact: true }).click();
    const download = await pending;
    expect(download.suggestedFilename()).toMatch(/\.svg$/);
    const svg = await readFile(await download.path(), 'utf8');
    const exported = await page.evaluate(source => {
      const xml = new DOMParser().parseFromString(source, 'image/svg+xml');
      const rows = Array.from(xml.querySelectorAll('text'));
      const first = rows.findIndex(row => row.textContent?.startsWith('ED1.'));
      return rows.slice(first).map(row => row.textContent ?? '')
        .filter(text => /^[A-Za-z0-9._-]+$/.test(text)).join('');
    }, svg);
    expect(exported, 'image export leaked the named code or truncated its payload').toBe(anonymous.code);
    const readImage = readShareCode(exported, content, { build });
    expect(readImage.ok && readImage.founding.missing).toEqual(['founder', 'house', 'friends']);

    // The recipient has an independent Library and no sender autosave. Import
    // the actual exported bytes through Start, then compare the entire save
    // with the same production founding path under fixed recipient settings.
    const recipient = await browser.newContext({ viewport: { width: scenario.width, height: 900 } });
    try {
      const next = await recipient.newPage();
      await next.addInitScript(({ key, mode }) => {
        localStorage.setItem(key, JSON.stringify({ proseMode: mode, showEverythingFromStart: true }));
      }, { key: ACCESSIBILITY_STORAGE_KEY, mode: scenario.mode });
      await next.goto(page.url());
      await next.getByRole('button', { name: scenario.mode === 'original' ? 'Advanced' : 'Advanced options', exact: true }).click();
      await next.locator('#share-code-in').fill(exported);
      await next.locator('#share-house').fill(choice.houseName);
      await next.locator('#share-founder').fill(choice.founder.name);
      await next.locator('#share-friend-0').fill(choice.friends[0]!.name);
      await next.getByRole('button', { name: scenario.mode === 'original' ? 'Sign from this code' : 'Start from this code', exact: true }).click();
      await expect(next.locator('main.prologue')).toBeVisible();
      const expected = newGameFromShareCode(exported, content, {
        build, proseMode: scenario.mode,
        names: { house: choice.houseName, founder: choice.founder.name, friends: [choice.friends[0]!.name] },
      });
      if (!expected.ok) throw new Error('Exported founding was refused');
      const actual = await next.evaluate(() => JSON.parse(localStorage.getItem('ed:save:autosave')!));
      expect(canonical(actual)).toBe(canonical(expected.session.save()));
    } finally { await recipient.close(); }
  });
}
