// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isControl, isField, shortcutFor } from './keys.js';

/**
 * THE FOUR TIMES A SHORTCUT MUST NOT FIRE (issue #58).
 *
 * The wiring is the easy half. Every one of these is a bug you find by having
 * somebody name their house and watching the clock jump twenty-five years, and
 * none of them is visible in the code that adds the listener.
 */
describe('what a keypress means', () => {
  it('turns a year on Space and on Enter, and five on Shift+Enter', () => {
    expect(shortcutFor({ key: ' ' })).toEqual({ kind: 'advance', years: 1 });
    expect(shortcutFor({ key: 'Enter' })).toEqual({ kind: 'advance', years: 1 });
    expect(shortcutFor({ key: 'Enter', shift: true })).toEqual({ kind: 'advance', years: 5 });
    // Shift+Space is not five. Only one key carries the second meaning, and
    // guessing the other would turn a stray press into a jump.
    expect(shortcutFor({ key: ' ', shift: true })).toEqual({ kind: 'advance', years: 1 });
  });

  it('does not dispatch held-key auto-repeat as multiple turns or decisions (#912)', () => {
    for (const key of [' ', 'Enter', '1', '9', '?', 'Escape']) {
      expect(shortcutFor({ key, repeat: true }), `held "${key}" must not fire`).toBeNull();
    }
    expect(shortcutFor({ key: 'Enter', shift: true, repeat: true })).toBeNull();

    // The first keydown still performs exactly its normal action.
    expect(shortcutFor({ key: ' ', repeat: false })).toEqual({ kind: 'advance', years: 1 });
    expect(shortcutFor({ key: 'Enter', shift: true, repeat: false }))
      .toEqual({ kind: 'advance', years: 5 });
    expect(shortcutFor({ key: 'Escape', repeat: false })).toEqual({ kind: 'dismiss' });
  });

  it('passes KeyboardEvent.repeat into both client and docket handlers (#912)', () => {
    for (const path of ['App.vue', 'components/Docket.vue']) {
      const source = readFileSync(join(import.meta.dirname, '..', path), 'utf8');
      expect(source, path).toMatch(/shortcutFor\(\{\s*key:\s*e\.key,\s*repeat:\s*e\.repeat,/);
    }
  });

  it('guards shared Escape listeners without disabling Tab focus traps (#912, #1321, #1325)', () => {
    const chapter = readFileSync(join(import.meta.dirname, '../components/Chapter.vue'), 'utf8');
    // Chapter and Interlude must share the same policy rather than maintaining
    // independent listeners that drift on IME, repeat and tabbable filtering.
    const interlude = readFileSync(join(import.meta.dirname, '../components/Interlude.vue'), 'utf8');
    const shared = readFileSync(join(import.meta.dirname, './modal.ts'), 'utf8');
    // The shared hook is the contract, not the spelling of its callback:
    // Chapter may use a named single-flight guard while Interlude stays inline.
    const sharedHook = /useModal\(\s*card\s*,\s*(?:\(\s*\)\s*=>|[A-Za-z_$][\w$]*\s*\))/;
    expect('useModal(card, () => props.actions.dismissInterlude());').toMatch(sharedHook);
    expect('useModal(card, dismissOnce);').toMatch(sharedHook);
    expect('dismissOnce();').not.toMatch(sharedHook);
    expect('useModal(otherCard, dismissOnce);').not.toMatch(sharedHook);
    expect(chapter).toMatch(sharedHook);
    expect(interlude).toMatch(sharedHook);
    expect(shared).toMatch(
      /if \(e\.key === 'Escape'\) \{[\s\S]*?e\.preventDefault\(\);[\s\S]*?if \(e\.repeat\) return;/,
    );
    expect(shared).toMatch(/e\.isComposing \|\| e\.keyCode === 229/);
    expect(shared).toContain("if (e.key !== 'Tab') return;");
  });

  it('does not act on any global shortcut behind an active modal (#1414)', () => {
    for (const key of ['Escape', '?', ' ', 'Enter', '1', '9']) {
      expect(shortcutFor({ key, modalOpen: true }), key).toBeNull();
    }
    expect(shortcutFor({ key: 'Enter', shift: true, modalOpen: true })).toBeNull();

    // App registers its global window listener before child modal traps;
    // passing the live modal state is necessary, not just a pure helper check.
    const app = readFileSync(join(import.meta.dirname, '../App.vue'), 'utf8');
    expect(app).toContain("modalOpen: Boolean(document.querySelector('[aria-modal=\"true\"]'))");
  });

  it('takes the numbered choice, counting from what the eye sees', () => {
    expect(shortcutFor({ key: '1' })).toEqual({ kind: 'take', index: 0 });
    expect(shortcutFor({ key: '9' })).toEqual({ kind: 'take', index: 8 });
    // Zero is not a choice anybody can see, so it is not one.
    expect(shortcutFor({ key: '0' })).toBeNull();
  });

  it('ignores composite key names instead of choosing an invalid decision (#1162)', () => {
    // String ranges are lexicographic: `10` used to map to index 9 and
    // `1x` to NaN. Only a single 1–9 key denotes a numbered choice.
    for (const key of ['10', '1x', '99', '01', '9suffix', '1\n']) {
      expect(shortcutFor({ key }), JSON.stringify(key)).toBeNull();
    }
    expect(shortcutFor({ key: '1' })).toEqual({ kind: 'take', index: 0 });
    expect(shortcutFor({ key: '9' })).toEqual({ kind: 'take', index: 8 });
  });

  /** A player typing their house name is not steering the clock. */
  it('says nothing at all while somebody is typing', () => {
    for (const key of [' ', 'Enter', '1', '?', 'a']) {
      expect(shortcutFor({ key, inField: true }), `"${key}" fired in a text field`).toBeNull();
    }
  });

  /** Except Escape, which is how you get out of a field and out of a dialog. */
  it('still leaves, from inside a field', () => {
    expect(shortcutFor({ key: 'Escape', inField: true })).toEqual({ kind: 'dismiss' });
  });

  /**
   * The one that would be found last. Tab to "Take this one", press Enter, and
   * a stolen Enter turns a year instead of taking the card — the browser's
   * default on a focused button is the correct behaviour.
   */
  it('leaves Space and Enter to a control that already answers them', () => {
    expect(shortcutFor({ key: 'Enter', onControl: true })).toBeNull();
    expect(shortcutFor({ key: ' ', onControl: true })).toBeNull();
    // Numbers are still ours — no button answers "3".
    expect(shortcutFor({ key: '3', onControl: true })).toEqual({ kind: 'take', index: 2 });
  });

  it('leaves Enter and Space to focused native details summaries (#931)', () => {
    // A native <summary> toggles its details with Enter/Space. Advancing a
    // year as well would turn opening the help text into a gameplay action.
    const summary = { tagName: 'SUMMARY' } as Element;
    expect(isControl(summary)).toBe(true);
    for (const key of ['Enter', ' ']) {
      expect(shortcutFor({ key, onControl: isControl(summary) })).toBeNull();
    }
    // Numbered choices remain intentional shortcuts while controls are focused.
    expect(shortcutFor({ key: '3', onControl: isControl(summary) }))
      .toEqual({ kind: 'take', index: 2 });
    expect(isControl({ tagName: 'BUTTON' } as Element)).toBe(true);
    expect(isControl({ tagName: 'A' } as Element)).toBe(true);
    expect(isControl({ tagName: 'DIV' } as Element)).toBe(false);
  });

  it('leaves Enter and Space to keyboard-activated ARIA buttons and links (#2308)', () => {
    for (const role of ['button', 'link']) {
      const control = document.createElement('div');
      control.tabIndex = 0;
      control.setAttribute('role', role);
      expect(isField(control)).toBe(false);
      expect(isControl(control)).toBe(true);
      for (const key of ['Enter', ' ']) {
        expect(shortcutFor({ key, onControl: isControl(control) }), role).toBeNull();
      }
      // Numbered choices remain the player's shortcuts.
      expect(shortcutFor({ key: '3', onControl: isControl(control) }))
        .toEqual({ kind: 'take', index: 2 });
    }

    const ordinary = document.createElement('div');
    expect(isControl(ordinary)).toBe(false);
    ordinary.setAttribute('role', 'status');
    expect(isControl(ordinary)).toBe(false);
    expect(shortcutFor({ key: 'Enter', onControl: isControl(ordinary) }))
      .toEqual({ kind: 'advance', years: 1 });
  });

  /** Ctrl-R reloads and Cmd-L is the address bar. A game that eats those closes. */
  it('never touches a modified press', () => {
    for (const key of [' ', 'Enter', '1', '?', 'Escape']) {
      expect(shortcutFor({ key, modified: true }), `"${key}" was taken with a modifier held`).toBeNull();
    }
  });

  it('offers the list on ?', () => {
    expect(shortcutFor({ key: '?' })).toEqual({ kind: 'help' });
  });

  it('ignores everything it was not asked about', () => {
    for (const key of ['a', 'F5', 'Tab', 'ArrowLeft', 'Backspace']) {
      expect(shortcutFor({ key }), `"${key}" was claimed`).toBeNull();
    }
  });
});

describe('ARIA fields and keyboard-activated selection controls (#2351)', () => {
  it('does not turn text-entry or numeric-widget keystrokes into game choices', () => {
    for (const role of ['textbox', 'searchbox', 'combobox', 'spinbutton']) {
      const widget = document.createElement('div');
      widget.setAttribute('role', role);
      widget.tabIndex = 0;
      expect(isField(widget), role).toBe(true);
      for (const key of [' ', 'Enter', '?', '1', '9']) {
        expect(shortcutFor({ key, inField: isField(widget) }), `${role}: ${key}`).toBeNull();
      }
      // Escape remains the global way out of a focused field.
      expect(shortcutFor({ key: 'Escape', inField: isField(widget) }))
        .toEqual({ kind: 'dismiss' });
    }
  });

  it('leaves Space and Enter to custom selection widgets', () => {
    for (const role of [
      'checkbox', 'switch', 'radio', 'menuitem', 'menuitemcheckbox',
      'menuitemradio', 'option', 'tab', 'treeitem', 'slider',
      'scrollbar', 'listbox', 'menu', 'tree', 'radiogroup',
    ]) {
      const widget = document.createElement('div');
      widget.setAttribute('role', role);
      widget.tabIndex = 0;
      expect(isControl(widget), role).toBe(true);
      for (const key of [' ', 'Enter']) {
        expect(shortcutFor({ key, onControl: isControl(widget) }), `${role}: ${key}`).toBeNull();
      }
      // The existing numbered-choice contract still applies to controls.
      expect(shortcutFor({ key: '3', onControl: isControl(widget) }))
        .toEqual({ kind: 'take', index: 2 });
    }
    const status = document.createElement('div');
    status.setAttribute('role', 'status');
    expect(isField(status)).toBe(false);
    expect(isControl(status)).toBe(false);
  });

  it('respects ARIA roles behind shadow hosts and whitespace-separated role tokens', () => {
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    const widget = document.createElement('span');
    widget.setAttribute('role', '  textbox  ');
    widget.tabIndex = 0;
    shadow.append(widget);
    document.body.append(host);
    try {
      widget.focus();
      expect(document.activeElement).toBe(host);
      expect(isField(document.activeElement)).toBe(true);
      expect(shortcutFor({ key: '4', inField: isField(document.activeElement) })).toBeNull();
      widget.setAttribute('role', 'checkbox');
      expect(isControl(document.activeElement)).toBe(true);
      expect(shortcutFor({ key: ' ', onControl: isControl(document.activeElement) })).toBeNull();
    } finally {
      host.remove();
    }
  });
});

describe('ARIA role fallback tokens do not steal widget keys (#2375)', () => {
  it('suppresses typing shortcuts for a supported field role after an unknown token', () => {
    const field = document.createElement('div');
    field.tabIndex = 0;
    field.setAttribute('role', '  future-text-entry   textbox  ');
    expect(isField(field)).toBe(true);
    expect(isControl(field)).toBe(false);

    for (const key of ['1', '9', '?', 'Enter', ' ']) {
      expect(shortcutFor({ key, inField: isField(field), onControl: isControl(field) }), key)
        .toBeNull();
    }
    expect(shortcutFor({ key: 'Escape', inField: isField(field) }))
      .toEqual({ kind: 'dismiss' });
  });

  it('leaves activation keys to a supported control fallback, not the game clock', () => {
    const button = document.createElement('div');
    button.tabIndex = 0;
    button.setAttribute('role', 'future-button  button');
    expect(isField(button)).toBe(false);
    expect(isControl(button)).toBe(true);
    for (const key of [' ', 'Enter']) {
      expect(shortcutFor({ key, onControl: isControl(button) }), key).toBeNull();
    }
    expect(shortcutFor({ key: '3', onControl: isControl(button) }))
      .toEqual({ kind: 'take', index: 2 });

    const status = document.createElement('div');
    status.setAttribute('role', 'status');
    expect(isField(status)).toBe(false);
    expect(isControl(status)).toBe(false);
  });

  it('detects the fallback role inside an open shadow root', () => {
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    const widget = document.createElement('div');
    widget.tabIndex = 0;
    widget.setAttribute('role', 'future-searchbox searchbox');
    shadow.append(widget);
    document.body.append(host);
    try {
      widget.focus();
      expect(document.activeElement).toBe(host);
      expect(isField(document.activeElement)).toBe(true);
      expect(shortcutFor({ key: '2', inField: isField(document.activeElement) }))
        .toBeNull();

      widget.setAttribute('role', 'future-checkbox checkbox');
      expect(isControl(document.activeElement)).toBe(true);
      expect(shortcutFor({ key: 'Enter', onControl: isControl(document.activeElement) }))
        .toBeNull();
    } finally {
      host.remove();
    }
  });
});

describe('focus inside open shadow roots (#2147)', () => {
  it('keeps numbered choices away from an input inside a shadow host', () => {
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    const input = document.createElement('input');
    shadow.append(input);
    document.body.append(host);

    try {
      input.focus();
      expect(document.activeElement).toBe(host);
      expect(shadow.activeElement).toBe(input);
      expect(isField(document.activeElement)).toBe(true);
      expect(shortcutFor({ key: '3', inField: isField(document.activeElement) })).toBeNull();
    } finally {
      host.remove();
    }
  });

  it('leaves Enter and Space to a button through nested open shadow roots', () => {
    const outer = document.createElement('div');
    const first = outer.attachShadow({ mode: 'open' });
    const nestedHost = document.createElement('div');
    const second = nestedHost.attachShadow({ mode: 'open' });
    const button = document.createElement('button');
    first.append(nestedHost);
    second.append(button);
    document.body.append(outer);

    try {
      button.focus();
      expect(document.activeElement).toBe(outer);
      expect(first.activeElement).toBe(nestedHost);
      expect(second.activeElement).toBe(button);
      expect(isControl(document.activeElement)).toBe(true);
      for (const key of ['Enter', ' ']) {
        expect(shortcutFor({ key, onControl: isControl(document.activeElement) })).toBeNull();
      }
    } finally {
      outer.remove();
    }
  });

  it('does not advance behind an ARIA button inside an open shadow root (#2308)', () => {
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    const button = document.createElement('span');
    button.setAttribute('role', 'button');
    button.tabIndex = 0;
    shadow.append(button);
    document.body.append(host);

    try {
      button.focus();
      expect(document.activeElement).toBe(host);
      expect(shadow.activeElement).toBe(button);
      expect(isControl(document.activeElement)).toBe(true);
      for (const key of ['Enter', ' ']) {
        expect(shortcutFor({ key, onControl: isControl(document.activeElement) })).toBeNull();
      }
    } finally {
      host.remove();
    }
  });

  it('keeps ordinary DOM controls and unfocused shadow hosts unchanged', () => {
    const host = document.createElement('div');
    host.attachShadow({ mode: 'open' });
    expect(isField(host)).toBe(false);
    expect(isControl(host)).toBe(false);
    expect(isField(document.createElement('textarea'))).toBe(true);
    expect(isControl(document.createElement('button'))).toBe(true);
    expect(shortcutFor({ key: 'Enter', onControl: isControl(host) }))
      .toEqual({ kind: 'advance', years: 1 });
  });
});
