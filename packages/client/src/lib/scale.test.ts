import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(import.meta.dirname, '..');

/**
 * TYPE IS THE READER'S DECISION, NOT THE STYLESHEET'S (issue #108).
 *
 * `px` is an absolute unit. An Android user who has set 200% text — or a
 * desktop reader who has raised their browser's default — got no change at
 * all from 45 hard-`px` sizes, and nothing anywhere reported it. The game
 * rendered perfectly, at the wrong size, forever. That is this repository's
 * documented failure mode with a font on it, and it is the cheapest large
 * accessibility win the project has: a game that is one hundred percent text,
 * whose median buyer is fifty-two.
 *
 * The scale is now eight `rem` tokens in `styles.css`'s `:root`, named for
 * role. This test is the part that keeps it there. Somebody adds a component
 * with `font-size: 13px` and nothing else in the build complains — the click
 * lands, the panel draws, and one more piece of the client has stopped
 * listening to its reader.
 *
 * LAYOUT `px` IS NOT IN SCOPE and never was. A 1px rule, an 18px indent, a
 * 3px radius: those are not type and do not scale with a reading preference.
 * This looks only at `font-size` and at the `font:` shorthand.
 */

/** `font-size: …` and any `font:` shorthand carrying a raw CSS size. */
const SIZE = /font-size\s*:\s*([^;}]+)/g;
const SHORTHAND = /font\s*:\s*([^;}]+)/g;

/** The token block itself — the one place a real length may be written. */
const TOKEN = /^\s*--t-[\w-]+\s*:/;

/** A size the reader's own setting moves. */
function scales(value: string): boolean {
  const v = value.trim();
  if (v === 'inherit' || v === 'initial' || v === 'unset') return true;
  // `var(--t-…)` and nothing else. A raw `rem` would scale too, but it would
  // also be a size picked in a component again, which is the other half of
  // what went wrong: eighteen steps, chosen one file at a time.
  return /^var\(--t-[\w-]+\)$/.test(v);
}

/**
 * Every declaration in `css` that pins type to an absolute size. A GATE OVER
 * TEXT, not a script — `it` hands it a snippet it must reject below, because a
 * rule nobody has watched fail is indistinguishable from one that cannot.
 */
export function hardSizes(css: string): string[] {
  const found: string[] = [];
  for (const line of css.split('\n')) {
    if (TOKEN.test(line)) continue;
    for (const m of line.matchAll(SIZE)) {
      if (!scales(m[1]!)) found.push(m[0].trim());
    }
    for (const m of line.matchAll(SHORTHAND)) {
      // A shorthand resets font-size as well as font family. Relative lengths
      // and percentages are raw sizes too: they scale with the root but evade
      // the role-token ladder just as px does. Unitless line-height is fine.
      // `font: inherit` and `font: 500 var(--t-body)/1.3 serif` stay valid.
      if (/(?:\d+(?:\.\d+)?|\.\d+)\s*(?:(?:px|pt|cm|mm|in|pc|rem|em|ch|ex|vw|vh|vmin|vmax)\b|%)/i.test(m[1]!)) {
        found.push(m[0].trim());
      }
    }
  }
  return found;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (entry.endsWith('.vue') || entry.endsWith('.css')) out.push(path);
  }
  return out;
}

const files = walk(SRC).map((path) => ({ path, text: readFileSync(path, 'utf8') }));

describe('the type scale', () => {
  it('is watching the files it thinks it is', () => {
    // A walk that silently finds nothing passes every assertion under it.
    expect(files.length).toBeGreaterThan(18);
    expect(files.some((f) => f.path.endsWith('styles.css'))).toBe(true);
    expect(files.some((f) => f.path.endsWith('Docket.vue'))).toBe(true);
  });

  it.each(files.map((f) => f.path))('%s sets no absolute type size', (path) => {
    const found = hardSizes(files.find((f) => f.path === path)!.text);
    expect(
      found,
      `${path} pins type to an absolute size, so a reader who has asked for ` +
      'larger text does not get it here:\n' +
      found.map((f) => `  ${f}`).join('\n') +
      '\nUse a role token from styles.css — --t-label, --t-fine, --t-card, ' +
      '--t-body, --t-lead, --t-head, --t-year, --t-display.',
    ).toEqual([]);
  });

  it('fails on a px size added to a component', () => {
    // The demonstration. Without it this file asserts that a rule which
    // matches nothing matches nothing.
    expect(hardSizes('.name { font-size: 13px; }')).toEqual(['font-size: 13px']);
    expect(hardSizes('.year { font: 500 26px/1.1 serif; }')).toEqual(['font: 500 26px/1.1 serif']);
    expect(hardSizes('.year { font: 500 1.125rem/1.3 serif; }')).toEqual(['font: 500 1.125rem/1.3 serif']);
    expect(hardSizes('.year { font: italic .9em Georgia; }')).toEqual(['font: italic .9em Georgia']);
    expect(hardSizes('.year { font: bold 2vw sans-serif; }')).toEqual(['font: bold 2vw sans-serif']);
    expect(hardSizes('.year { font: 90%/1.5 serif; }')).toEqual(['font: 90%/1.5 serif']);
    expect(hardSizes('h1 { font-size: 2rem; }')).toEqual(['font-size: 2rem']);
  });

  it('passes what the client actually writes', () => {
    expect(hardSizes('.name { font-size: var(--t-card); }')).toEqual([]);
    expect(hardSizes('button { font: inherit; }')).toEqual([]);
    expect(hardSizes('p { font: 500 var(--t-body)/1.3 serif; }')).toEqual([]);
    expect(hardSizes('  --t-display: clamp(2.25rem, 7vw, 3rem);')).toEqual([]);
  });

  /**
   * The tokens exist, are `rem`, and are ordered. A scale whose steps crossed
   * over would still pass every test above it and would read as a rendering
   * bug in the chronicle, where four of these steps ARE the frequency tiers.
   */
  it('is one ordered ladder in rem', () => {
    const css = readFileSync(join(SRC, 'styles.css'), 'utf8');
    const steps = [...css.matchAll(/^\s*(--t-[\w-]+)\s*:\s*([^;]+);/gm)]
      .map((m) => ({ name: m[1]!, value: m[2]!.trim() }));

    expect(steps.map((s) => s.name)).toEqual([
      '--t-label', '--t-fine', '--t-card', '--t-body',
      '--t-lead', '--t-head', '--t-year', '--t-display',
    ]);

    const rem = steps.filter((s) => s.value.endsWith('rem')).map((s) => Number.parseFloat(s.value));
    expect(rem.length).toBe(steps.length - 1); // --t-display alone is a clamp
    expect([...rem].sort((a, b) => a - b)).toEqual(rem);
    // Nothing under 12px at a 16px root. Below that a letterspaced uppercase
    // label is unreadable on a phone, which is where the old 11px label sat.
    expect(rem[0]! * 16).toBeGreaterThanOrEqual(12);
  });
});
