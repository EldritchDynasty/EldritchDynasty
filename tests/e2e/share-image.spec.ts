import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { loadBundle } from '@ed/content';
import { closeTheLedger, newGame, readShareCode } from '@ed/core';

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

for (const mode of ['original', 'plainenglish'] as const) {
  test(`the Chronicle plate carries the founding, in a face that fits the column (${mode})`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(({ save, mode }) => {
      localStorage.setItem('eldritch-dynasty:reading', JSON.stringify({ proseMode: mode }));
      localStorage.setItem('ed:save:autosave', JSON.stringify(save));
      const painted: { text: string; font: string; x: number; width: number }[] = [];
      (window as unknown as { __painted: typeof painted }).__painted = painted;
      const fill = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function (text: string, x: number, y: number, max?: number) {
        painted.push({ text, font: this.font, x, width: this.measureText(text).width });
        return max === undefined ? fill.call(this, text, x, y) : fill.call(this, text, x, y, max);
      };
    }, { save: foundedSave(), mode });
    await page.goto('/');

    await page.getByRole('button', { name: mode === 'plainenglish' ? 'Continue your last game' : 'Continue the last sitting', exact: true }).click();
    await page.getByRole('button', { name: mode === 'plainenglish' ? 'Read full Chronicle' : 'Read it whole', exact: true }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: mode === 'plainenglish' ? 'Save an image' : 'Save this as a page', exact: true }).click();
    expect((await download).suggestedFilename()).toMatch(/\.png$/);

    const painted = await page.evaluate(() => (window as unknown as { __painted: Painted[] }).__painted);
    const label = painted.findIndex(p => p.text === (mode === 'plainenglish'
      ? 'Eldritch Dynasty · Share code for this starting point (names not included)'
      : 'Eldritch Dynasty · The same beginning, names withheld'));
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
}

/**
 * A PNG-only browser test does not prove the fallback a player actually gets
 * when canvas encoding is unavailable. Exercise Book.vue's real download
 * path, rather than calling the pure SVG helper directly.
 */
for (const mode of ['original', 'plainenglish'] as const) {
  test(`a refused PNG encoding downloads an accessible SVG with the complete nameless founding #1995 (${mode})`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(({ save, mode }) => {
      localStorage.setItem('eldritch-dynasty:reading', JSON.stringify({ proseMode: mode }));
      localStorage.setItem('ed:save:autosave', JSON.stringify(save));
      // Simulate a bitmap encoder that reports failure, while keeping the
      // working canvas context needed for real browser text measurements.
      HTMLCanvasElement.prototype.toBlob = function (callback: BlobCallback) {
        callback(null);
      };
    }, { save: foundedSave(), mode });
    await page.goto('/');

    await page.getByRole('button', { name: mode === 'plainenglish' ? 'Continue your last game' : 'Continue the last sitting', exact: true }).click();
    await page.getByRole('button', { name: mode === 'plainenglish' ? 'Read full Chronicle' : 'Read it whole', exact: true }).click();
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: mode === 'plainenglish' ? 'Save an image' : 'Save this as a page', exact: true }).click();
    const download = await pending;
    expect(download.suggestedFilename()).toMatch(/\.svg$/);
    const svg = await readFile(await download.path(), 'utf8');

    // Inspect the exported file as SVG in the same Chromium that measures
    // the fonts. The visible wrapped text and the unwrapped assistive <desc>
    // must agree, and neither may be an incomplete or clipped share code.
    const parsed = await page.evaluate(({ source, mode }) => {
      const xml = new DOMParser().parseFromString(source, 'image/svg+xml');
      const texts = Array.from(xml.querySelectorAll('text'));
      const labelIndex = texts.findIndex(node =>
        node.textContent === (mode === 'plainenglish'
      ? 'Eldritch Dynasty · Share code for this starting point (names not included)'
      : 'Eldritch Dynasty · The same beginning, names withheld'));
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
    }, { source: svg, mode });

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
}

/**
 * The Canvas-free path (#2398) uses actual SVG geometry, not the Canvas
 * measurement available in the PNG and toBlob(null) scenarios above.
 * Exercise the actual font in Chromium, not jsdom's stubbed SVG widths.
 */
for (const mode of ['original', 'plainenglish'] as const) {
  test(`a Canvas-free browser exports the complete Chronicle share code as SVG (${mode})`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(({ save, mode }) => {
      localStorage.setItem('eldritch-dynasty:reading', JSON.stringify({ proseMode: mode }));
      localStorage.setItem('ed:save:autosave', JSON.stringify(save));
      // Disable the initial text-measurement Canvas as well as PNG painting.
      Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
        configurable: true, value: () => null,
      });
    }, { save: foundedSave(), mode });
    await page.goto('/');

    await page.getByRole('button', { name: mode === 'plainenglish'
      ? 'Continue your last game' : 'Continue the last sitting', exact: true }).click();
    await page.getByRole('button', { name: mode === 'plainenglish'
      ? 'Read full Chronicle' : 'Read it whole', exact: true }).click();
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: mode === 'plainenglish'
      ? 'Save an image' : 'Save this as a page', exact: true }).click();
    const download = await pending;
    expect(download.suggestedFilename().endsWith('.svg')).toBe(true);

    const svg = await readFile(await download.path(), 'utf8');
    const exported = await page.evaluate(({ source, mode }) => {
      const xml = new DOMParser().parseFromString(source, 'image/svg+xml');
      const texts = Array.from(xml.querySelectorAll('text'));
      const label = mode === 'plainenglish'
        ? 'Eldritch Dynasty · Share code for this starting point (names not included)'
        : 'Eldritch Dynasty · The same beginning, names withheld';
      const labelIndex = texts.findIndex(node => node.textContent === label);
      // Check that the game's hidden measurement probe was retired before
      // creating a separate, real SVG gauge for the exported code.
      const strayProbes = document.querySelectorAll('svg[aria-hidden="true"][style*="-10000px"]').length;
      const gauge = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const probe = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      gauge.style.cssText = 'position:absolute;left:-10000px;top:-10000px;visibility:hidden';
      gauge.append(probe);
      document.body.append(gauge);
      try {
        const lines = labelIndex < 0 ? [] : texts.slice(labelIndex + 1).map(node => {
          const text = node.textContent ?? '';
          const font = node.getAttribute('font-family') ?? '';
          const size = Number(node.getAttribute('font-size'));
          probe.style.font = `${size}px ${font}`;
          probe.textContent = text;
          return { text, font, x: Number(node.getAttribute('x')), width: probe.getComputedTextLength() };
        });
        return {
          parseErrors: xml.querySelectorAll('parsererror').length,
          labelIndex,
          description: xml.querySelector('desc')?.textContent ?? '',
          lines, strayProbes,
        };
      } finally {
        gauge.remove();
      }
    }, { source: svg, mode });

    expect(exported.parseErrors).toBe(0);
    expect(exported.labelIndex, 'the exported SVG labels the anonymous founding').toBeGreaterThan(-1);
    expect(exported.strayProbes, 'temporary SVG measurement must be cleaned up').toBe(0);
    expect(exported.lines.length).toBeGreaterThan(0);
    const code = exported.lines.map(line => line.text).join('');
    expect(code).toMatch(/^ED1/);
    expect(exported.description).toContain(`Share code: ${code}`);
    expect(exported.description).not.toContain('House Plate');
    for (const line of exported.lines) {
      expect(line.font).toContain('monospace');
      expect(line.width).toBeGreaterThan(0);
      expect(line.x + line.width, `"${line.text}" runs past the SVG column`).toBeLessThanOrEqual(1200 - 64);
    }
    const read = readShareCode(code, loadBundle());
    if (!read.ok) expect(read.problem).toEqual({ kind: 'other_edition', differs: ['build'] });
    expect(errors).toEqual([]);
  });
}


/**
 * SVG fallback round-trips are covered in share-code.spec.ts; exercise the
 * ordinary PNG Afterimage path with real Chromium font metrics too (#1995).
 * Opting into a *named text code* must never change the anonymous image code.
 */
function completedAfterimageSave() {
  const game = newGame(loadBundle(), { seed: 1998, campaign: 'short' });
  const signing = game.prologue()!;
  expect(game.found({
    houseName: 'House Plate',
    heirloom: signing.heirlooms[0]!.heirloom,
    grudge: signing.grudges[0]!.house,
    answers: Object.fromEntries(signing.examination.map(
      question => [question.id, question.answers[0]!.id])),
    founder: { name: 'Élodie 雪', gender: 'woman', configuration: 'blood_mother' },
    friends: [{ name: '蘭花 Vale', sex: 'female' }],
  }).ok).toBe(true);
  game.ctx.world.year = game.view().campaign.endYear;
  closeTheLedger(game.ctx);
  return game.save();
}

for (const mode of ['original', 'plainenglish'] as const) {
  test('Afterimage PNG paints a complete anonymous code within the column (' + mode + ') #1995', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(({ save, mode }) => {
      localStorage.setItem('ed:save:autosave', JSON.stringify(save));
      localStorage.setItem('eldritch-dynasty:reading', JSON.stringify({ proseMode: mode }));
      const painted: Painted[] = [];
      (window as unknown as { __afterimagePainted: Painted[] }).__afterimagePainted = painted;
      const fill = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function (text: string, x: number, y: number, max?: number) {
        painted.push({ text, font: this.font, x, width: this.measureText(text).width });
        return max === undefined ? fill.call(this, text, x, y) : fill.call(this, text, x, y, max);
      };
    }, { save: completedAfterimageSave(), mode });
    await page.goto('/');
    await page.locator('main.start button.primary').click();
    await expect(page.locator('main.ending')).toBeVisible();

    const anonymous = await page.locator('#share-code').inputValue();
    expect(anonymous).toMatch(/^ED1\./);
    await page.locator('.share-names input').check();
    expect(await page.locator('#share-code').inputValue()).not.toBe(anonymous);

    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: mode === 'plainenglish'
      ? 'Save ending image' : 'Save the house afterimage', exact: true }).click();
    expect((await pending).suggestedFilename()).toMatch(/\.png$/);

    const painted = await page.evaluate(() =>
      (window as unknown as { __afterimagePainted: Painted[] }).__afterimagePainted);
    const heading = mode === 'plainenglish'
      ? 'SHARE CODE FOR THIS STARTING POINT (NAMES NOT INCLUDED)'
      : 'THE SAME BEGINNING · NAMES WITHHELD';
    const label = painted.findIndex(row => row.text === heading);
    expect(label, 'the Afterimage labels its code').toBeGreaterThan(-1);
    const remainder = painted.slice(label + 1);
    const footer = remainder.findIndex(row => row.text.startsWith('Eldritch Dynasty ·'));
    expect(footer, 'the image footer follows the code').toBeGreaterThan(-1);
    const lines = remainder.slice(0, footer);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.map(row => row.text).join('')).toBe(anonymous);

    for (const line of lines) {
      expect(line.font).toContain('monospace');
      expect(line.x + line.width, 'code exceeds image width').toBeLessThanOrEqual(1200 - 64);
    }
    const read = readShareCode(anonymous, loadBundle());
    if (read.ok) expect(read.founding.missing).toEqual(['founder', 'house', 'friends']);
    else expect(read.problem).toEqual({ kind: 'other_edition', differs: ['build'] });
    expect(errors).toEqual([]);
  });
}
