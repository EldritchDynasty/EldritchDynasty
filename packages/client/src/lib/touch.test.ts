import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(import.meta.dirname, '..');

/**
 * HOVER IS NOT A CHANNEL (issue #107).
 *
 * The touch corollary to #58's seen-or-heard. Ten `title` attributes carried
 * meaning that existed nowhere else on the screen, and there is no hover on a
 * phone: five of them were the entire visual language of the family tree, so a
 * player on Android met ✦ ◈ ◇ ☾ ✎ ⊘ scattered through eighty-eight cards with
 * no way, anywhere in the game, to learn what one of them meant.
 *
 * Nothing about that looked broken. The tree drew, the cards drew, the marks
 * drew — this repository's failure mode, in the one place where the failure is
 * a player quietly not understanding the game.
 *
 * `styles.css` had already written the reasoning down for the neighbouring
 * case: "an omitted chronicle line is a ruled blank on the page and has to be
 * a sentence to a screen reader, because `&nbsp;` with a title on it is
 * nothing at all to one." The same sentence is true of a thumb. The principle
 * was written and then applied to exactly one of the two channels that needed
 * it.
 *
 * SO THE RULE IS: a `title` may never be the only place a piece of text
 * appears. It is a fine third channel — this is not a removal — but the
 * meaning has to reach a player with no pointer some other way, as visible
 * text, as an `aria-label`, or as the same expression drawn elsewhere in the
 * same template. Neither end of that is a list anybody maintains: the titles
 * come off the files, and so does everything that answers them. A hand-kept
 * list of ten tooltips is a list that will say ten forever.
 *
 * IT IS A NET, NOT A PROOF, and it is worth knowing where the holes are. Run
 * against the templates as they stood before this issue it caught eight of the
 * ten. It missed the gauge, which already had an `aria-label` and was never
 * lost to a screen reader — and it missed `title="the seal"`, because the
 * words "the seal" also appear in the button that opens the line of succession
 * three lines further down. A text match cannot tell an explanation from a
 * coincidence. That is what the legend test below is for: the marks are the
 * case where being reachable is not enough, so they are checked a second time,
 * structurally, off the table they are drawn from.
 */

/**
 * `title="…"` and `:title="…"`, with the value as written. A FUNCTION, not a
 * constant: a shared `/g` regex carries `lastIndex` between calls, and
 * `matchAll` reads it — one `.test()` elsewhere in this file and the walk
 * below starts silently mid-file. It passed, and it had stopped looking.
 */
function titles(): RegExp {
  return /\s:?title="([^"]*)"/g;
}

/** Only the template. The script defines every identifier a binding uses, so
 *  searching the whole file would let `:title="blocking"` answer itself. */
function template(vue: string): string {
  const open = vue.indexOf('<template>');
  const shut = vue.lastIndexOf('</template>');
  return open === -1 || shut === -1 ? '' : vue.slice(open + '<template>'.length, shut);
}

/** Whitespace collapsed and case dropped: a template wraps where it likes. */
function flatten(text: string): string {
  return text.replace(/\s+/g, ' ').toLowerCase();
}

/**
 * A quoted literal is compared by what it SAYS; anything else — a binding, a
 * ternary, a concatenation — by the expression itself, which is the thing that
 * has to appear again somewhere a player can reach.
 */
function needle(value: string): string {
  const v = value.trim();
  const literal = /^'([^']*)'$/.exec(v) ?? /^`([^`]*)`$/.exec(v);
  return flatten(literal ? literal[1]! : v);
}

/**
 * Every title in `vue` that no other channel repeats. A GATE OVER TEXT, so a
 * test can hand it a snippet it must reject — a rule nobody has watched fail
 * is indistinguishable from a rule that cannot.
 */
export function titlesWithNoOtherChannel(vue: string): string[] {
  const tpl = template(vue);
  const found: string[] = [];
  for (const m of tpl.matchAll(titles())) {
    // The template with THIS title taken out, so a title can never answer
    // itself, and comments stripped: an explanation of a tooltip is not a
    // channel a player has.
    const rest = flatten(tpl.replace(m[0], ' ').replace(/<!--[\s\S]*?-->/g, ' '));
    if (!rest.includes(needle(m[1]!))) found.push(m[1]!.replace(/\s+/g, ' ').trim());
  }
  return found;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (entry.endsWith('.vue')) out.push(path);
  }
  return out;
}

const templates = walk(SRC).map((path) => ({ path, text: readFileSync(path, 'utf8') }));

describe('nothing is reachable by hover alone', () => {
  it('is watching the templates it thinks it is', () => {
    expect(templates.length).toBeGreaterThan(18);
    // Keep at least one live title in the client so the repository-wide walk
    // still exercises a real template as well as the synthetic failure cases.
    expect(templates.filter((f) => titles().test(f.text)).length).toBeGreaterThan(0);
  });

  it.each(templates.map((f) => f.path))('%s says its titles some other way', (path) => {
    const found = titlesWithNoOtherChannel(templates.find((f) => f.path === path)!.text);
    expect(
      found,
      `${path} puts meaning in a tooltip and nowhere else, so a player with a ` +
      'thumb and no pointer never gets it:\n' +
      found.map((f) => `  title="${f}"`).join('\n') +
      '\nKeep the title — add the same words as visible text, or as an ' +
      'aria-label on the same element, or in the legend in App.vue.',
    ).toEqual([]);
  });

  it('fails on a tooltip that is the only copy', () => {
    // The demonstration, in the shape the bug actually had.
    expect(titlesWithNoOtherChannel('<template><span title="the seal">✦</span></template>'))
      .toEqual(['the seal']);
    expect(titlesWithNoOtherChannel(
      `<template><span :title="'madness ' + n">☾</span></template>`,
    )).toEqual(["'madness ' + n"]);
    // A comment explaining the tooltip is not a channel the player has.
    expect(titlesWithNoOtherChannel(
      '<template><!-- the seal --><span title="the seal">✦</span></template>',
    )).toEqual(['the seal']);
  });

  it('passes a tooltip the player can reach some other way', () => {
    expect(titlesWithNoOtherChannel(
      '<template><span title="the seal" aria-label="the seal">✦</span></template>',
    )).toEqual([]);
    expect(titlesWithNoOtherChannel(
      '<template><span :title="says">✦</span><p>{{ says }}</p></template>',
    )).toEqual([]);
    expect(titlesWithNoOtherChannel(
      '<template><button title="not yet">Go</button><p>Not yet</p></template>',
    )).toEqual([]);
  });
});

/**
 * AND THE LEGEND TEACHES ALL OF THEM. The rule above is satisfied by an
 * `aria-label`, which is the right answer for a screen reader and no answer at
 * all for a sighted player holding a phone. The marks are the case where a
 * label is not enough: there has to be one place that says what ✦ means, and
 * the client has to be able to get to it without a keyboard.
 */
describe('the marks have a legend', () => {
  const app = readFileSync(join(SRC, 'App.vue'), 'utf8');
  const marks = readFileSync(join(SRC, 'lib/marks.ts'), 'utf8');
  const kinds = [...marks.matchAll(/^ {2}(\w+): \{ kind:/gm)].map((m) => m[1]!);

  it('finds the marks at all', () => {
    expect(kinds).toEqual(['seal', 'expresses', 'carries', 'madness', 'drift', 'given']);
  });

  it('prints every mark in one place', () => {
    // Derived: a seventh mark joins the legend by existing, because the legend
    // is drawn from `LEGEND` rather than written out.
    const legend = /v-for="m in LEGEND"/.test(app);
    expect(legend, 'App.vue does not draw the legend from lib/marks.ts').toBe(true);
    for (const kind of kinds) {
      expect(marks, `${kind} is not in LEGEND`).toMatch(new RegExp(`MARKS\\.${kind}\\b`));
    }
  });

  it('opens the legend with something a thumb can press', () => {
    // `?` is not a channel either. The panel was reachable by keystroke alone,
    // which on the platform this issue is about is not reachable at all.
    expect(app).toMatch(/<button[^>]*class="quiet small legend"[\s\S]*?helpOpen = !helpOpen/);
  });
});
