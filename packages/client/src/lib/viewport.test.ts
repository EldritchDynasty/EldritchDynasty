import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { appShellCopy } from './app-shell-copy';

const SRC = join(import.meta.dirname, '..');
const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8');
/** Collapsed, so a guard survives reformatting but not deletion — the pattern
 * `templates.test.ts` already uses for the 1100px tier. */
const flat = (s: string): string => s.replace(/\s+/g, ' ');

/**
 * ONE CLIENT, 390PX TO ULTRAWIDE (issue #106).
 *
 * Nothing here removes anything from the desk board — the three-column layout
 * above 1100px, the keyboard, hover, all of it stays. This checks the phone
 * tier this issue actually adds: a nested 640px breakpoint, a bottom tab bar
 * that reuses the pane switcher rather than duplicating it, 44px targets
 * under `pointer: coarse` and nowhere else, three overlays that clear a notch
 * and a gesture bar, and the Match not collapsing into an unreadable column.
 *
 * Asserted on source, the same way the 1100px tier is in `templates.test.ts`:
 * a media query is a layout state no unit test renders and no typecheck can
 * see, and a tidy-up that deletes one leaves the game working right up until
 * somebody opens it on a phone.
 */

describe('the phone tier is nested under the tablet stack, not instead of it', () => {
  const app = read('App.vue');
  const f = flat(app);

  it('adds a 640px breakpoint', () => {
    expect(f).toMatch(/@media \(max-width: 640px\)/);
  });

  it('places it after the 1100px stack rather than replacing it', () => {
    // Not a stronger claim than that: the 1100px rules staying byte-identical
    // is already `templates.test.ts`'s job. This only guards the nesting —
    // a 640px tier written to override 1100px's single-column rule back to
    // something else would un-stack the columns on a phone.
    expect(f.indexOf('@media (max-width: 640px)'))
      .toBeGreaterThan(f.indexOf('@media (max-width: 1100px)'));
  });

  it('never touches a rule above 1100px', () => {
    const aboveEverything = f.slice(0, f.indexOf('@media (max-width: 1100px)'));
    expect(aboveEverything).not.toMatch(/640px/);
  });

  /**
   * THE GRID-BLOWOUT THIS ISSUE ACTUALLY FOUND. A bare `1fr` track's
   * automatic minimum is content-based, not zero — measured directly: adding
   * the Match's snap-scrolling deck pushed `.board` to 511px in a 390px
   * viewport, `document.documentElement.scrollWidth` and all, because nothing
   * in the single-column tier told the track it was allowed to be narrower
   * than its content. The three-column rule above already guards against
   * exactly this with `minmax(0, ...)` on every track; this one did not.
   */
  it('uses minmax(0, 1fr) for the stacked column, not a bare 1fr', () => {
    expect(f).toMatch(/\.board \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  });
});

describe('the pane switcher becomes a bottom tab bar under the phone tier, and nothing else does', () => {
  const app = read('App.vue');
  const f = flat(app);
  const phoneTier = f.slice(f.indexOf('@media (max-width: 640px)'));

  it('fixes the switcher to the foot of the screen only inside that tier', () => {
    expect(phoneTier).toMatch(/\.panes \{[^}]*position: fixed;[^}]*bottom: 0;/);
    const aboveTheTier = f.slice(0, f.indexOf('@media (max-width: 640px)'));
    expect(aboveTheTier).not.toMatch(/\.panes \{[^}]*position: fixed/);
  });

  /** Reused, not duplicated — a second copy of the four buttons is a second
   * thing that can say something different from the first. */
  it('does not add a second pane switcher', () => {
    expect(f.match(/class="wrap panes"/g)?.length).toBe(1);
  });

  it('honours the safe area at the foot of the bar', () => {
    expect(phoneTier).toMatch(/env\(safe-area-inset-bottom\)/);
  });

  it('leaves room in the board for the bar it just fixed in place', () => {
    expect(phoneTier).toMatch(/\.board \{[^}]*padding-bottom: calc\([^)]*env\(safe-area-inset-bottom\)/);
  });
});

describe('every overlay clears a notch and a gesture bar', () => {
  it.each([
    ['Book.vue', 'the volume'],
    ['Line.vue', 'the seal'],
    ['Interlude.vue', 'an interlude'],
  ])('%s (%s) honours env(safe-area-inset-*) on its scrim', (file) => {
    const source = read(`components/${file}`);
    const scrim = source.slice(source.indexOf('.scrim {'), source.indexOf('.scrim {') + 700);
    for (const side of ['top', 'bottom', 'left', 'right']) {
      expect(scrim, `${file} does not honour the ${side} safe area`).toMatch(
        new RegExp(`env\\(safe-area-inset-${side}\\)`),
      );
    }
  });

  it('still positions every overlay to cover the whole viewport', () => {
    // The safe-area padding sits inside the scrim, on the padding that was
    // already there — it must not have replaced `inset: 0` itself, or the
    // dialog would stop clearing the board underneath it.
    for (const file of ['Book.vue', 'Line.vue', 'Interlude.vue']) {
      expect(flat(read(`components/${file}`))).toMatch(/\.scrim \{ position: fixed; inset: 0;/);
    }
  });
});

describe('a pointer problem, not a phone problem', () => {
  const css = read('styles.css');
  const f = flat(css);
  const coarse = f.slice(f.indexOf('@media (pointer: coarse)'));

  it('raises the minimum target under pointer: coarse', () => {
    expect(f).toMatch(/@media \(pointer: coarse\)/);
    expect(coarse).toMatch(/\bbutton\b[^{]*\{[^}]*min-height: 44px; min-width: 44px;/);
  });

  it('covers selects and text inputs too, not only buttons', () => {
    // The first `{` opens the media query itself; the second opens the rule's
    // selector list, which is what should name `select`.
    const selectorList = coarse.slice(coarse.indexOf('{') + 1, coarse.indexOf('{', coarse.indexOf('{') + 1));
    expect(selectorList).toMatch(/\bselect\b/);
  });

  it('does not touch pointer: fine at all', () => {
    const outsideTheQuery = f.slice(0, f.indexOf('@media (pointer: coarse)'))
      + f.slice(f.indexOf('@media (pointer: coarse)') + coarse.length);
    expect(outsideTheQuery).not.toMatch(/min-height: 44px/);
  });

  /** The native `<select>` in `Docket.vue` is deliberately kept — Android
   * renders it as a picker, desktop as a dropdown, and rebuilding it would
   * lose the platform's own affordance for one of the two. This only checks
   * it is still a real `<select>`, not a `<div>` wearing its role. */
  it('leaves the native select in the docket alone', () => {
    expect(read('components/Docket.vue')).toMatch(/<select v-else @change="fill/);
  });
});

describe('the Match does not collapse into an unreadable column', () => {
  const docket = read('components/Docket.vue');
  const f = flat(docket);
  const narrow = f.slice(f.lastIndexOf('@media (max-width: 640px)'));

  it('keeps the wide grid exactly as it was', () => {
    expect(f).toMatch(/\.cards \{ display: grid; grid-template-columns: repeat\(auto-fit, minmax\(210px, 1fr\)\)/);
  });

  it('turns the deck into a horizontal, snapping scroller below the tier', () => {
    expect(narrow).toMatch(/\.cards \{[^}]*overflow-x: auto;[^}]*scroll-snap-type: x mandatory;/);
    // After the grid rule, not before it — same specificity, later wins, and
    // `App.vue`'s own clock-button fix exists because this got that backwards
    // once already.
    expect(f.lastIndexOf('.cards {')).toBeGreaterThan(f.indexOf('.cards {'));
  });

  it('gives every card a comparison strip carrying all three numbers', () => {
    expect(docket).toMatch(/kinship.*<\/th><th>the line<\/th><th>dowry/);
    expect(narrow).toMatch(/\.strip \{ display: table;/);
  });

  /** `table-layout: auto` treats `width: 100%` as advice, not a ceiling — a
   * long name is enough to push the table past its container rather than
   * wrap, which is the same overflow the grid fix above exists for. */
  it('fixes the strip\'s table layout so a long name cannot widen it past its container', () => {
    expect(narrow).toMatch(/\.strip \{[^}]*table-layout: fixed;/);
  });

  it('pins declining a hand so it cannot scroll off with the deck', () => {
    expect(docket).toMatch(/<div class="decline">/);
    expect(narrow).toMatch(/\.decline \{[^}]*position: sticky; bottom: 0;/);
  });
});

describe('the tree offers a way in rather than a smaller indent', () => {
  const tree = read('components/Tree.vue');
  const kin = read('components/Kin.vue');

  it('can narrow to one hall at a time', () => {
    expect(tree).toMatch(/hallFilter/);
    expect(tree).toMatch(/All halls/);
  });

  it('can find a person by name', () => {
    expect(tree).toMatch(/type="search"/);
    expect(tree).toMatch(/find somebody by name/);
  });

  it('can drill a branch down to its own root, with a way back out', () => {
    expect(kin).toMatch(/\$emit\('root', member\.id\)/);
    expect(tree).toMatch(/Show the whole hall/);
  });

  /** The nested `<Kin>` call has to forward the event, or a branch four
   * generations deep can never reach the listener at the top. */
  it('forwards the drill-down event through every nested generation', () => {
    expect(kin).toMatch(/@root="\$emit\('root', \$event\)"/);
  });
});

describe('both input models, from one build', () => {
  const app = read('App.vue');

  /** `keys.ts` is untouched by this issue — every shortcut it already offers
   * has to keep working, which `keys.test.ts` already asserts unchanged.
   * This only checks nothing new was wired in here that a thumb cannot also
   * reach, which is the other half of the same acceptance clause. */
  it('does not add a shortcut kind that only a keyboard could fire', () => {
    const keys = read('lib/keys.ts');
    const kinds = new Set([...keys.matchAll(/kind: '([a-z]+)'/g)].map((m) => m[1]!));
    expect([...kinds].sort()).toEqual(['advance', 'dismiss', 'help', 'take']);
  });

  it('keeps every pane reachable through a mode-aware visible control', () => {
    const original = appShellCopy('original');
    const plain = appShellCopy('plainenglish');
    for (const [pane, key, label] of [
      ['house', 'navHouse', 'The house'],
      ['table', 'navTable', 'The table'],
      ['abroad', 'navAbroad', 'Abroad'],
      ['chronicle', 'navChronicle', 'The chronicle'],
    ] as const) {
      expect(original[key]).toBe(label);
      expect(plain[key]).not.toBe('');
      expect(app).toContain(`{{ shellCopy.${key} }}`);
      expect(app).toContain(`@click="pane = '${pane}'"`);
    }
  });
});
