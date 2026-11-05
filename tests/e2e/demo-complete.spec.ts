import { expect, test, type Page } from '@playwright/test';
import { loadBundle } from '@ed/content';
import { newGame } from '@ed/core';
import { ACCESSIBILITY_STORAGE_KEY } from '../../packages/client/src/lib/accessibility';

/** The pre-existing full house is made through the same public founding API. */
function fullCampaignSave() {
  const game = newGame(loadBundle(), { seed: 197900, campaign: 'long' });
  const signing = game.prologue()!;
  expect(game.found({
    houseName: 'House Kept',
    heirloom: signing.heirlooms[0]!.heirloom,
    grudge: signing.grudges[0]!.house,
  }).ok).toBe(true);
  return game.save();
}

async function signDemo(page: Page, plain: boolean): Promise<void> {
  const prologue = page.locator('.prologue');
  for (let part = 0; part < 3; part++) await prologue.locator('button.on').click();
  await prologue.getByRole('textbox', { name: plain ? 'Enter the founder name' : 'Name the founder', exact: true }).fill('Wren');
  await prologue.getByRole('button', { name: plain ? 'Man' : 'A man', exact: true }).click();
  await prologue.locator('.signing-navigation .primary').click();
  for (const question of await prologue.locator('.examination .question').all()) {
    await question.getByRole('button').first().click();
  }
  await prologue.locator('.signing-navigation .primary').click();
  for (const title of [
    plain ? 'Choose an heirloom' : 'You asked for one thing by name',
    plain ? 'Choose the house that paid the price' : 'And somebody paid for the rest of it',
  ]) {
    await prologue.locator('.choice').filter({ has: page.getByRole('heading', { name: title, exact: true }) }).getByRole('button').first().click();
  }
  await prologue.getByRole('textbox', { name: plain ? 'Enter the family name' : 'Name the house', exact: true }).fill('House Demonstration');
  await prologue.getByRole('button', { name: plain ? 'Sign the agreement' : 'Sign it', exact: true }).click();
  await prologue.getByRole('button', { name: plain ? 'Begin in 1042' : '1042', exact: true }).click();
}

for (const scenario of [
  { mode: 'original', width: 1400 },
  { mode: 'original', width: 390 },
  { mode: 'plainenglish', width: 1400 },
  { mode: 'plainenglish', width: 390 },
] as const) {
  test(`the complete Demonstration survives a pending Record reload, ${scenario.mode}, ${scenario.width}px (#1979)`, async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    const plain = scenario.mode === 'plainenglish';
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width: scenario.width, height: 900 });
    const full = fullCampaignSave();
    await page.addInitScript(({ full, key, mode }) => {
      // Never reset a run on reload: this setup represents an existing install.
      if (!localStorage.getItem('ed:save:autosave')) localStorage.setItem('ed:save:autosave', JSON.stringify(full));
      localStorage.setItem(key, JSON.stringify({ proseMode: mode, reduceMotion: true }));
    }, { full, key: ACCESSIBILITY_STORAGE_KEY, mode: scenario.mode });
    await page.goto('/');
    const fullBytes = await page.evaluate(() => localStorage.getItem('ed:save:autosave'));
    const demo = page.locator('input[type="radio"][value="demo"]');
    await expect(demo).toBeVisible({ timeout: 30_000 });
    await demo.focus();
    await page.keyboard.press('Space');
    await expect(demo).toBeChecked();
    await expect(page.locator('.start')).toContainText('33');
    expect(await page.locator('.start').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await page.getByRole('button', { name: plain ? 'Advanced options' : 'Advanced', exact: true }).click();
    await page.locator('.advanced input[type="number"]').fill('5000');
    await page.getByRole('button', { name: plain ? 'Start a new game' : 'Begin a new signing', exact: true }).click();
    await signDemo(page, plain);

    let resumedRecord = false;
    let choseMatch = false;
    let sawEcho = false;
    let sawAgeClose = false;
    let checkedShortViewport = false;
    // These are ordinary on-screen controls. No grants, debug jumps or world edits.
    for (let step = 0; step < 300 && !await page.locator('.ending').count(); step++) {
      const interlude = page.locator('.interlude[role="dialog"]');
      if (await interlude.count()) {
        if (resumedRecord && (await interlude.textContent())?.includes('Wren')) sawEcho = true;
        await interlude.getByRole('button').click();
        continue;
      }
      const chapter = page.locator('.chapter[role="dialog"]');
      if (await chapter.count()) {
        if (!checkedShortViewport) {
          // Keep both ends of the real Age card reachable on a short screen.
          // An unconstrained centred card outgrows the scrim's reading area.
          await page.setViewportSize({ width: 480, height: 320 });
          await expect.poll(() => chapter.evaluate(node => {
            const rect = node.getBoundingClientRect();
            return rect.top >= 39 && rect.bottom <= innerHeight - 39;
          })).toBe(true);
          expect(await chapter.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
          await chapter.evaluate(node => { node.scrollTop = 0; });
          await expect(chapter.locator('.mood')).toBeInViewport();
          await chapter.getByRole('button').scrollIntoViewIfNeeded();
          await expect(chapter.getByRole('button')).toBeInViewport();
          expect(await chapter.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
          await page.screenshot({ path: testInfo.outputPath('demonstration-short-screen.png') });
          await page.setViewportSize({ width: scenario.width, height: 900 });
          checkedShortViewport = true;
        }
        if (await chapter.locator('.verdict').count()) sawAgeClose = true;
        await chapter.getByRole('button').click();
        continue;
      }
      const outcome = page.locator('.outcome');
      if (await outcome.count()) {
        await outcome.getByRole('button').click();
        continue;
      }
      const docket = page.locator('.docket');
      if (await docket.count()) {
        const founderRecord = /founder[’']s death/.test(await docket.locator('.body').innerText());
        const record = docket.getByRole('button', { name: plain ? /Record a more favourable account/ : /Improve it/ });
        if (await record.count()) {
          if (founderRecord && !resumedRecord) {
            const subject = await docket.locator('.body').innerText();
            await expect.poll(() => page.evaluate(() => {
              const saved = JSON.parse(localStorage.getItem('ed:save:demo-autosave') ?? 'null');
              return saved?.pendingDecisions?.some((decision: { kind: string; event?: { id?: string } }) => decision.kind === 'record' && decision.event?.id === 'demo_the_last_page');
            })).toBe(true);
            await page.reload();
            const demoSaves = page.getByRole('region', { name: plain ? 'Saved demonstrations' : 'Demonstrations kept', exact: true });
            await expect(demoSaves).toBeVisible({ timeout: 30_000 });
            await demoSaves.getByRole('button', { name: plain ? /^Continue the demonstration/ : /^Return to the Demonstration/ }).click();
            await expect(page.locator('.docket .body')).toHaveText(subject);
            resumedRecord = true;
          }
          await page.locator('.docket').getByRole('button', { name: plain ? /Record a more favourable account/ : /Improve it/ }).click();
          continue;
        }
        const availableMatches = docket.getByRole('button', { name: plain ? 'Choose this match' : 'Take this one', exact: true })
          .and(docket.locator('button:not([disabled])'));
        if (await availableMatches.count()) {
          await expect(docket.locator('.body')).toContainText(plain ? 'possible matches' : 'cards the year dealt');
          await availableMatches.first().click();
          choseMatch = true;
          continue;
        }
        const choice = docket.locator('.choices > button:not([disabled])').first();
        if (await choice.count()) await choice.click();
        else await docket.locator('footer button').click();
        continue;
      }
      const naming = page.locator('.naming');
      if (await naming.count()) {
        const keepAll = naming.getByRole('button', { name: plain ? 'Use all suggested names' : 'Keep the names he suggests', exact: true });
        if (await keepAll.count()) await keepAll.click();
        else await naming.getByRole('button', { name: plain ? 'Use suggested name' : 'Let him name this one', exact: true }).first().click();
        continue;
      }
      await page.locator('.clock').getByRole('button', { name: plain ? 'Advance 1 year' : 'A year', exact: true }).click();
    }

    await expect(page.locator('.ending')).toBeVisible();
    await expect(page.locator('.ending > p.year')).toHaveText('1075');
    await expect(page.locator('.ending .share')).toHaveCount(0);
    expect(resumedRecord, 'the forced founder Record must survive a real reload').toBe(true);
    expect(choseMatch, 'a named relative must have an ordinary marriage decision').toBe(true);
    expect(sawEcho, 'the frame must return to the named founder after the Record').toBe(true);
    expect(checkedShortViewport).toBe(true);
    expect(sawAgeClose, 'the opening Age must finish in the played session').toBe(true);
    await expect(page.getByRole('region', { name: plain ? 'Continue with a full campaign' : 'Beyond this account', exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('demonstration-ending.png'), fullPage: true });
    expect(await page.locator('.ending').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('ed:save:demo-autosave') ?? 'null')?.campaign)).toBe('demo');
    const completed = await page.evaluate(() => JSON.parse(localStorage.getItem('ed:save:demo-autosave')!));
    expect(completed.chronicle.some((entry: { eventId?: string; record?: string }) => entry.eventId === 'demo_the_last_page' && entry.record === 'embellish')).toBe(true);
    expect(completed.frame.entries.some((entry: { eventId: string }) => entry.eventId === 'demo_the_margin_keeps_its_colour')).toBe(true);
    expect(await page.evaluate(() => localStorage.getItem('ed:save:autosave'))).toBe(fullBytes);
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('ed:library') ?? 'null')?.runs?.some((run: { campaign: string }) => run.campaign === 'demo'))).toBe(true);
    expect(errors).toEqual([]);
  });
}
