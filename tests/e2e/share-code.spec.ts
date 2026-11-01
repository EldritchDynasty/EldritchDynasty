import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { loadBundle } from '@ed/content';
import { newGame } from '@ed/core';
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
    expect(JSON.stringify(saved)).toContain(choice.founder.name);
    expect(JSON.stringify(saved)).toContain(choice.friends[0]!.name);
    expect(errors).toEqual([]);
  });
}
