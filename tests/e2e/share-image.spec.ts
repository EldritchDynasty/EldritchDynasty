import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { loadBundle } from '@ed/content';
import { newGame, readShareCode } from '@ed/core';

/**
 * THE CODE ON A REAL PLATE (#1995).
 *
 * `book.test.ts` wraps the share code with a pretend six-pixel font, and the
 * component suites paint into a stub context. Neither knows how wide
 * Chromium's own monospace face is, which is the question for "survives the
 * image's layout limits". This exports a real Chronicle plate from the
 * shipped client and records every line the canvas was asked to draw,
 * measured by the same canvas.
 */
function foundedSave() {
  // The campaign's own start year: a run founded any other way has no code.
  const game = newGame(loadBundle(), { seed: 1995, campaign: 'short' });
  const signing = game.prologue()!;
  expect(game.found({
    houseName: 'House Plate', heirloom: signing.heirlooms[0]!.heirloom, grudge: signing.grudges[0]!.house,
    answers: Object.fromEntries(signing.examination.map(question => [question.id, question.answers[0]!.id])),
  }).ok).toBe(true);
  return game.save();
}

interface Painted { text: string; font: string; x: number; width: number }

test('the Chronicle plate carries the founding, in a face that fits the column', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({ save }) => {
    localStorage.setItem('ed:save:autosave', JSON.stringify(save));
    const painted: { text: string; font: string; x: number; width: number }[] = [];
    (window as unknown as { __painted: typeof painted }).__painted = painted;
    const fill = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text: string, x: number, y: number, max?: number) {
      painted.push({ text, font: this.font, x, width: this.measureText(text).width });
      return max === undefined ? fill.call(this, text, x, y) : fill.call(this, text, x, y, max);
    };
  }, { save: foundedSave() });
  await page.goto('/');

  await page.getByRole('button', { name: 'Continue the last sitting', exact: true }).click();
  await page.getByRole('button', { name: 'Read it whole', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save this as a page', exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/\.png$/);

  const painted = await page.evaluate(() => (window as unknown as { __painted: Painted[] }).__painted);
  const label = painted.findIndex(p => p.text === 'Eldritch Dynasty · The same beginning, names withheld');
  expect(label, 'the foot names what follows').toBeGreaterThan(-1);
  const code = painted.slice(label + 1);
  expect(code.length).toBeGreaterThan(0);
  for (const line of code) {
    expect(line.font, 'the code is drawn in the monospace face').toContain('monospace');
    // PLATE.width 1200 less PLATE.pad 64 on the right.
    expect(line.x + line.width, `"${line.text}" runs past the column`).toBeLessThanOrEqual(1200 - 64);
  }

  // Rejoined, it is a whole code: its check passes. Only the build may differ
  // between this test's process and the dev server's stamp.
  const read = readShareCode(code.map(line => line.text).join('\n'), loadBundle());
  if (!read.ok) expect(read.problem).toEqual({ kind: 'other_edition', differs: ['build'] });
  expect(errors).toEqual([]);
});

/**
 * A PNG-only browser test does not prove the fallback a player actually gets
 * when canvas encoding is unavailable. Exercise Book.vue's real download
 * path, rather than calling the pure SVG helper directly.
 */
test('a refused PNG encoding downloads an accessible SVG with the complete nameless founding #1995', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({ save }) => {
    localStorage.setItem('ed:save:autosave', JSON.stringify(save));
    // Simulate a bitmap encoder that reports failure, while keeping the
    // working canvas context needed for real browser text measurements.
    HTMLCanvasElement.prototype.toBlob = function (callback: BlobCallback) {
      callback(null);
    };
  }, { save: foundedSave() });
  await page.goto('/');

  await page.getByRole('button', { name: 'Continue the last sitting', exact: true }).click();
  await page.getByRole('button', { name: 'Read it whole', exact: true }).click();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save this as a page', exact: true }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toMatch(/\.svg$/);
  const svg = await readFile(await download.path(), 'utf8');

  // Inspect the exported file as SVG in the same Chromium that measures
  // the fonts. The visible wrapped text and the unwrapped assistive <desc>
  // must agree, and neither may be an incomplete or clipped share code.
  const parsed = await page.evaluate(source => {
    const xml = new DOMParser().parseFromString(source, 'image/svg+xml');
    const texts = Array.from(xml.querySelectorAll('text'));
    const labelIndex = texts.findIndex(node =>
      node.textContent === 'Eldritch Dynasty · The same beginning, names withheld');
    const gauge = document.createElement('canvas').getContext('2d')!;
    return {
      parseErrors: xml.querySelectorAll('parsererror').length,
      labelIndex,
      description: xml.querySelector('desc')?.textContent ?? '',
      lines: texts.slice(labelIndex + 1).map(node => {
        const text = node.textContent ?? '';
        const font = node.getAttribute('font-family') ?? '';
        const size = Number(node.getAttribute('font-size'));
        gauge.font = `${size}px ${font}`;
        return { text, font, x: Number(node.getAttribute('x')), width: gauge.measureText(text).width };
      }),
    };
  }, svg);

  expect(parsed.parseErrors).toBe(0);
  expect(parsed.labelIndex, 'the SVG labels its nameless founding').toBeGreaterThan(-1);
  expect(parsed.lines.length).toBeGreaterThan(0);
  const code = parsed.lines.map(line => line.text).join('');
  expect(parsed.description).toContain(`Share code: ${code}`);
  expect(parsed.description).not.toContain('House Plate');
  for (const line of parsed.lines) {
    expect(line.font).toContain('monospace');
    expect(line.x + line.width, `"${line.text}" runs past the SVG column`).toBeLessThanOrEqual(1200 - 64);
  }

  const read = readShareCode(code, loadBundle());
  if (!read.ok) expect(read.problem).toEqual({ kind: 'other_edition', differs: ['build'] });
  expect(errors).toEqual([]);
});
