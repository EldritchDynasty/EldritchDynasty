import { expect, test, type Page } from '@playwright/test';
import { loadBundle } from '@ed/content';
import { newGame } from '@ed/core';
import { ACCESSIBILITY_STORAGE_KEY } from '../../packages/client/src/lib/accessibility';

/**
 * THE SOUND BED IN A REAL ENGINE (#1986).
 *
 * `sound.test.ts` drives the player over a fake `AudioContext`, which can say
 * when a cue was asked for but not whether Chromium agreed to play it: start
 * and stop order, ramps that cannot reach zero, and the autoplay policy are
 * the engine's opinions. So this counts what the REAL engine is asked to
 * start, through a thin subclass that changes nothing it forwards.
 */
function signedSave() {
  const game = newGame(loadBundle(), { seed: 1986, campaign: 'short', startYear: 1200 });
  const signing = game.prologue()!;
  expect(game.found({
    houseName: 'House Ear', heirloom: signing.heirlooms[0]!.heirloom, grudge: signing.grudges[0]!.house,
    answers: Object.fromEntries(signing.examination.map(question => [question.id, question.answers[0]!.id])),
  }).ok).toBe(true);
  return game.save();
}

interface Heard { made: number; started: number; state: string }

async function open(page: Page, preference: Record<string, unknown>) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({ save, key, preference }) => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('ed:save:autosave', JSON.stringify(save));
      localStorage.setItem(key, JSON.stringify(preference));
      sessionStorage.setItem('seeded', 'yes');
    }
    const heard = { made: 0, started: 0, context: null as AudioContext | null };
    (window as unknown as { __heard: typeof heard }).__heard = heard;
    const Real = window.AudioContext;
    const counted = <T extends AudioScheduledSourceNode>(node: T): T => {
      const start = node.start.bind(node);
      node.start = (...args: Parameters<T['start']>) => { heard.started += 1; return start(...args); };
      return node;
    };
    window.AudioContext = class extends Real {
      constructor(options?: AudioContextOptions) {
        super(options);
        heard.made += 1;
        heard.context = this;
      }
      createOscillator() { return counted(super.createOscillator()); }
      createBufferSource() { return counted(super.createBufferSource()); }
    };
  }, { save: signedSave(), key: ACCESSIBILITY_STORAGE_KEY, preference });
  await page.goto('/');
  return errors;
}

const heard = (page: Page) => page.evaluate(() => {
  const h = (window as unknown as { __heard: { made: number; started: number; context: AudioContext | null } }).__heard;
  return { made: h.made, started: h.started, state: h.context?.state ?? 'none' } satisfies Heard;
});

test('the house is heard after the first touch, and the switch in Reading settings outlives a reload', async ({ page }) => {
  const errors = await open(page, { showEverythingFromStart: true });

  // Restoring an "on" preference plays nothing before the player touches the page.
  await expect(page.getByRole('button', { name: 'Continue the last sitting', exact: true })).toBeVisible();
  expect((await heard(page)).made, 'an audio context opened before any gesture').toBe(0);

  await page.getByRole('button', { name: 'Continue the last sitting', exact: true }).click();
  const year = page.getByRole('button', { name: 'A year', exact: true });
  await expect(year).toBeVisible();
  // The drone: the root pair at least, swelling on a running context.
  await expect.poll(async () => (await heard(page)).started).toBeGreaterThanOrEqual(2);
  await expect.poll(async () => (await heard(page)).state).toBe('running');

  // A page turns. If the docket has stopped the clock, the bell has already
  // said so and the turn is someone else's test.
  if (await year.isEnabled()) {
    const before = (await heard(page)).started;
    await year.click();
    await expect.poll(async () => (await heard(page)).started).toBeGreaterThan(before);
  }

  await page.getByRole('button', { name: 'Reading, marks and keys' }).click();
  const sound = page.getByRole('checkbox', { name: 'Sound', exact: true });
  await expect(sound).toBeChecked();
  await expect(page.getByRole('slider', { name: 'Volume' })).toBeEnabled();
  await sound.uncheck();
  await expect(page.getByRole('slider', { name: 'Volume' })).toBeDisabled();
  const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), ACCESSIBILITY_STORAGE_KEY);
  expect(stored.sound).toBe(false);

  // Off survives a restart, and an off bed never opens the device at all.
  await page.reload();
  await page.getByRole('button', { name: 'Continue the last sitting', exact: true }).click();
  await expect(page.getByRole('button', { name: 'A year', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Reading, marks and keys' }).click();
  await expect(page.getByRole('checkbox', { name: 'Sound', exact: true })).not.toBeChecked();
  expect((await heard(page)).made, 'a muted bed opened an audio context').toBe(0);

  expect(errors).toEqual([]);
});
