// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isControl, isField, isGlossaryFocus, shortcutFor } from './keys.js';

/**
 * THE FOUR TIMES A SHORTCUT MUST NOT FIRE (issue #58).
 *
 * The wiring is the easy half. Every one of these is a bug you find by having
 * somebody name their house and watching the clock jump twenty-five years, and
 * none of them is visible in the code that adds the listener.
 */
describe('what a keypress means', () => {
  it('treats focus in a glossary explanation as reading, not a game shortcut (#1991)', () => {
    const host = document.createElement('span');
    host.className = 'glossary-text';
    const term = document.createElement('button');
    const note = document.createElement('span');
    note.tabIndex = -1;
    host.append(term, note);
    expect(isGlossaryFocus(host)).toBe(true);
    expect(isGlossaryFocus(term)).toBe(true);
    expect(isGlossaryFocus(note)).toBe(true);
    expect(isGlossaryFocus(document.createElement('button'))).toBe(false);
    expect(isGlossaryFocus(null)).toBe(false);

    // App's global listener runs for every panel. Verify it uses the same
    // tested guard as Docket before dispatching year-advance shortcuts.
    const app = readFileSync(join(import.meta.dirname, '../App.vue'), 'utf8');
    expect(app).toContain('if (isGlossaryFocus(el)) return;');
    expect(app).toMatch(/if \(isGlossaryFocus\(el\)\) return;\s*const press = shortcutFor/);
  });
  it('keeps global shortcuts out of a glossary wrapping nested open shadow widgets (#2737)', () => {
    const glossary = document.createElement('span');
    glossary.className = 'glossary-text';
    const outerHost = document.createElement('span');
    const outerRoot = outerHost.attachShadow({ mode: 'open' });
    const innerHost = document.createElement('span');
    const innerRoot = innerHost.attachShadow({ mode: 'open' });
    const definitionControl = document.createElement('span');
    definitionControl.tabIndex = 0;
    innerRoot.append(definitionControl);
    outerRoot.append(innerHost);
    glossary.append(outerHost);
    document.body.append(glossary);
    try {
      definitionControl.focus();
      expect(document.activeElement).toBe(outerHost);
      expect(outerRoot.activeElement).toBe(innerHost);
      expect(innerRoot.activeElement).toBe(definitionControl);

      // closest() alone stops at innerRoot. The glossary outside both roots
      // must still own numbered choices, Enter, Space, and help keys.
      expect(isGlossaryFocus(document.activeElement)).toBe(true);
      for (const key of ['1', 'Enter', ' ', '?']) {
        expect(isGlossaryFocus(document.activeElement), key).toBe(true);
      }

      glossary.classList.remove('glossary-text');
      expect(isGlossaryFocus(document.activeElement)).toBe(false);
      outerHost.classList.add('glossary-text');
      expect(isGlossaryFocus(document.activeElement)).toBe(true);
    } finally {
      glossary.remove();
    }
  });

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

describe('nested ARIA typing widgets (#2476)', () => {
  it('reserves typing keys for focused descendants of every field role', () => {
    for (const role of ['textbox', 'searchbox', 'combobox', 'spinbutton']) {
      const field = document.createElement('div');
      field.setAttribute('role', `future-field ${role}`);
      const child = document.createElement('span');
      child.tabIndex = 0;
      field.append(child);
      document.body.append(field);
      try {
        child.focus();
        expect(document.activeElement).toBe(child);
        expect(isField(document.activeElement), role).toBe(true);
        for (const key of ['1', '9', '?', 'Enter', ' ']) {
          expect(shortcutFor({ key, inField: isField(document.activeElement) }), `${role}: ${key}`)
            .toBeNull();
        }
        expect(shortcutFor({ key: 'Escape', inField: isField(document.activeElement) }))
          .toEqual({ kind: 'dismiss' });
      } finally {
        field.remove();
      }
    }
  });

  it('finds field roles inside and outside an open shadow host', () => {
    const outer = document.createElement('div');
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    const inner = document.createElement('div');
    const focusTarget = document.createElement('span');
    focusTarget.tabIndex = 0;
    inner.append(focusTarget);
    shadow.append(inner);
    outer.append(host);
    document.body.append(outer);
    try {
      focusTarget.focus();
      expect(document.activeElement).toBe(host);
      // The role may belong to an ancestor outside the shadow, the host
      // itself, or an ancestor of the focused node within the shadow.
      for (const [owner, role] of [
        [outer, 'searchbox'], [host, 'combobox'], [inner, 'spinbutton'],
      ] as const) {
        owner.setAttribute('role', role);
        expect(isField(document.activeElement), role).toBe(true);
        expect(shortcutFor({ key: '4', inField: isField(document.activeElement) }))
          .toBeNull();
        owner.removeAttribute('role');
      }
      expect(isField(document.activeElement)).toBe(false);
    } finally {
      outer.remove();
    }
  });

  it('does not confuse a nested non-field widget with a typing field', () => {
    const widget = document.createElement('div');
    widget.setAttribute('role', 'group');
    const child = document.createElement('span');
    child.tabIndex = 0;
    widget.append(child);
    document.body.append(widget);
    try {
      child.focus();
      expect(isField(document.activeElement)).toBe(false);
      expect(shortcutFor({ key: '3', inField: isField(document.activeElement) }))
        .toEqual({ kind: 'take', index: 2 });
      widget.setAttribute('role', 'button');
      expect(isField(document.activeElement)).toBe(false);
    } finally {
      widget.remove();
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


describe('nested keyboard-activated controls (#2544)', () => {
  it('reserves Enter/Space for descendants of native and ARIA controls, not the clock', () => {
    for (const role of ['button', 'link', 'checkbox', 'menuitem', 'tab', 'slider']) {
      const parent = document.createElement('div');
      parent.setAttribute('role', `future-control ${role}`);
      const child = document.createElement('span');
      child.tabIndex = 0;
      parent.append(child);
      document.body.append(parent);
      try {
        child.focus();
        expect(document.activeElement).toBe(child);
        expect(isField(child), role).toBe(false);
        expect(isControl(child), role).toBe(true);
        for (const key of ['Enter', ' ']) {
          expect(shortcutFor({ key, onControl: isControl(child) }), `${role}: ${key}`).toBeNull();
        }
        expect(shortcutFor({ key: '3', onControl: isControl(child) }))
          .toEqual({ kind: 'take', index: 2 });
      } finally {
        parent.remove();
      }
    }

    const nativeButton = document.createElement('button');
    const label = document.createElement('span');
    nativeButton.append(label);
    expect(isControl(label)).toBe(true);
  });

  it('follows open shadow roots to the containing ARIA control', () => {
    const outer = document.createElement('div');
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    const child = document.createElement('span');
    child.tabIndex = 0;
    shadow.append(child);
    outer.append(host);
    document.body.append(outer);
    try {
      child.focus();
      expect(document.activeElement).toBe(host);
      for (const owner of [host, outer]) {
        owner.setAttribute('role', 'checkbox');
        expect(isControl(document.activeElement)).toBe(true);
        expect(shortcutFor({ key: 'Enter', onControl: isControl(document.activeElement) }))
          .toBeNull();
        owner.removeAttribute('role');
      }
      expect(isControl(document.activeElement)).toBe(false);
    } finally {
      outer.remove();
    }
  });

  it('keeps ordinary descendants of non-controls on the game clock', () => {
    const group = document.createElement('div');
    group.setAttribute('role', 'group');
    const child = document.createElement('span');
    child.tabIndex = 0;
    group.append(child);
    expect(isControl(child)).toBe(false);
    expect(shortcutFor({ key: 'Enter', onControl: isControl(child) }))
      .toEqual({ kind: 'advance', years: 1 });
    expect(shortcutFor({ key: ' ', onControl: isControl(child) }))
      .toEqual({ kind: 'advance', years: 1 });
  });
});

describe('embedded-document open shadow roots (#2561)', () => {
  it('reserves typing and activation keys for roles outside the inner shadow root', () => {
    const frame = document.createElement('iframe');
    document.body.append(frame);
    try {
      const embedded = frame.contentDocument!;
      const outer = embedded.createElement('div');
      const host = embedded.createElement('div');
      const shadow = host.attachShadow({ mode: 'open' });
      const focusTarget = embedded.createElement('span');
      focusTarget.tabIndex = 0;
      shadow.append(focusTarget);
      outer.append(host);
      embedded.body.append(outer);
      focusTarget.focus();

      // The shadow root is real and open, but not from the outer JS realm.
      expect(shadow instanceof ShadowRoot).toBe(false);
      expect(embedded.activeElement).toBe(host);
      expect(shadow.activeElement).toBe(focusTarget);

      // A role on an ancestor beyond the shadow host still owns typing keys.
      outer.setAttribute('role', 'searchbox');
      expect(isField(embedded.activeElement)).toBe(true);
      expect(shortcutFor({ key: '1', inField: isField(embedded.activeElement) })).toBeNull();
      outer.removeAttribute('role');

      // Space/Enter also belong to controls whose role is on the host.
      host.setAttribute('role', 'button');
      expect(isControl(embedded.activeElement)).toBe(true);
      expect(shortcutFor({ key: 'Enter', onControl: isControl(embedded.activeElement) })).toBeNull();
      expect(shortcutFor({ key: ' ', onControl: isControl(embedded.activeElement) })).toBeNull();
      host.removeAttribute('role');

      expect(isField(embedded.activeElement)).toBe(false);
      expect(isControl(embedded.activeElement)).toBe(false);

      // A normal DocumentFragment is not a shadow root with a host to climb.
      const fragment = embedded.createDocumentFragment();
      const isolated = embedded.createElement('span');
      fragment.append(isolated);
      expect(isField(isolated)).toBe(false);
      expect(isControl(isolated)).toBe(false);
    } finally {
      frame.remove();
    }
  });
});
