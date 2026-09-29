import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

/**
 * ── A CAPPED OVERLAY HAS TO BE ABLE TO SCROLL (#356) ──────────────────────
 *
 * "When I press 'Read it whole' the resulting page doesn't scroll down." The
 * book, the seal's line and the plat all sit in a `position: fixed` scrim laid
 * out as `display: grid; place-items: center`, and cap themselves at
 * `max-height: 100%`. A grid's implicit row is sized to its item, so that
 * percentage resolved against a row as tall as the whole content, capped
 * nothing, and the scrim clipped the rest with no scrollbar. Measured in
 * Chromium: a 300-entry book came out 10,308px tall in an 800px window.
 * `grid-template-rows: minmax(0, 100%)` makes the row the scrim's own height,
 * and the cap binds.
 *
 * jsdom has no layout, so this cannot be measured here. It checks the rule
 * instead, over every component: a fixed grid scrim whose component caps
 * something at `max-height: 100%` must size its row to the window. The next
 * overlay copied from these inherits the rule, not the bug.
 */
const COMPONENTS = fileURLToPath(new URL('../components/', import.meta.url));

function styleOf(source: string): string {
  return [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
}

/** The declarations of the first `.scrim { … }` rule, or undefined. */
function scrimRule(css: string): string | undefined {
  return /(^|\n)\.scrim\s*\{([^}]*)\}/.exec(css)?.[2];
}

const overlays = readdirSync(COMPONENTS)
  .filter((f) => f.endsWith('.vue'))
  .map((f) => ({ file: f, css: styleOf(readFileSync(join(COMPONENTS, f), 'utf8')) }))
  .map((c) => ({ ...c, scrim: scrimRule(c.css) }))
  .filter((c): c is typeof c & { scrim: string } =>
    c.scrim !== undefined && /position:\s*fixed/.test(c.scrim) && /display:\s*grid/.test(c.scrim));

describe('a capped overlay can scroll', () => {
  it('finds the overlays at all', () => {
    // A scan that matches nothing passes every assertion below it.
    expect(overlays.map((c) => c.file)).toEqual(expect.arrayContaining(['Book.vue', 'Line.vue', 'Plat.vue']));
  });

  for (const { file, css, scrim } of overlays) {
    it(`${file} sizes its scrim's row to the window when it caps its content`, () => {
      if (!/max-height:\s*100%/.test(css)) return;
      expect(
        scrim,
        `${file}: a fixed grid scrim around a \`max-height: 100%\` box needs ` +
        '`grid-template-rows: minmax(0, 100%)`, or the row grows to the content and nothing scrolls.',
      ).toMatch(/grid-template-rows:\s*minmax\(0,\s*100%\)/);
    });
  }
});
