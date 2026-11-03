import type { ProseMode } from '@ed/schema';

/**
 * THE KEYBOARD (issue #58).
 *
 * A game made entirely of text and buttons, played on a keyboard-shaped
 * device, that required a mouse for every single input. `grep -rn "@keydown"`
 * over the whole package returned nothing.
 *
 * The mapping is here, as a pure function over a description of the press,
 * because the interesting part is not the wiring but the four cases where a
 * shortcut must NOT fire — and every one of them is a bug you only find by
 * having somebody type their house name and watch the clock jump.
 */
export type Shortcut =
  | { kind: 'advance'; years: number }
  | { kind: 'take'; index: number }
  | { kind: 'dismiss' }
  | { kind: 'help' };

export interface KeyPress {
  key: string;
  shift?: boolean;
  /** A held key must not issue repeated irreversible game actions. */
  repeat?: boolean;
  /** Any of ctrl/meta/alt. The browser and the OS own those. */
  modified?: boolean;
  /** Focus is in a text field, so the key is the player writing, not steering. */
  inField?: boolean;
  /** Focus is on a control that already answers Space and Enter itself. */
  onControl?: boolean;
  /** An active dialog owns keys; global shortcuts must not dismiss what is behind it. */
  modalOpen?: boolean;
}

export function shortcutFor(p: KeyPress): Shortcut | null {
  // A modal has its own topmost-only Escape/focus trap. The App handler is
  // registered before child dialogs, so it must not act on the same keydown.
  if (p.modalOpen) return null;

  // Auto-repeat is another keydown, not another request to advance the year,
  // take a choice, close another overlay or toggle the shortcut help.
  if (p.repeat) return null;

  // Ctrl-R is a reload, Cmd-L is the address bar. A game that eats those is a
  // game people close.
  if (p.modified) return null;

  // Escape works everywhere, including out of a field — it is how you leave.
  if (p.key === 'Escape') return { kind: 'dismiss' };

  // Typing. The house name has digits in it as often as anybody wants, and a
  // player who pressed "5" into a text box has not asked for five years.
  if (p.inField) return null;

  if (p.key === '?') return { kind: 'help' };

  // A focused button already answers Space and Enter, and stealing them would
  // mean tabbing to "Take this one", pressing Enter, and turning a year
  // instead. The browser's default is the correct behaviour; leave it alone.
  if ((p.key === ' ' || p.key === 'Enter') && p.onControl) return null;

  if (p.key === 'Enter') return { kind: 'advance', years: p.shift ? 5 : 1 };
  if (p.key === ' ') return { kind: 'advance', years: 1 };

  // A key name must be one ASCII digit. Lexicographic string comparisons
  // also accept `10` and `1x`, which would dispatch a nonexistent choice.
  if (p.key.length === 1 && p.key >= '1' && p.key <= '9') {
    return { kind: 'take', index: Number(p.key) - 1 };
  }

  return null;
}

/**
 * The document reports the shadow host as activeElement, while keyboard
 * events from its inner controls still reach the window listener. Follow
 * open shadow roots so their inputs and buttons keep their own keystrokes.
 */
function innermostActiveElement(el: Element): Element {
  let active = el;
  let inner = active.shadowRoot?.activeElement;
  while (inner) {
    active = inner;
    inner = active.shadowRoot?.activeElement;
  }
  return active;
}

/**
 * An ARIA role attribute can list fallbacks: a browser skips unknown roles
 * before using a later supported token. Be conservative when suppressing
 * global game shortcuts, so a text entry or activated widget cannot turn
 * game years if an earlier, future role is not known to this browser.
 */
function hasRole(el: Element, roles: ReadonlySet<string>): boolean {
  const raw = el.getAttribute?.('role') ?? null;
  return raw !== null && raw.trim().split(/\s+/).some((role) => roles.has(role));
}

/** Custom widgets also own keystrokes, even when they are not native inputs. */
const FIELD_ROLES: ReadonlySet<string> = new Set(['textbox', 'searchbox', 'combobox', 'spinbutton']);
const CONTROL_ROLES: ReadonlySet<string> = new Set([
  'button', 'link', 'checkbox', 'switch', 'radio', 'menuitem',
  'menuitemcheckbox', 'menuitemradio', 'option', 'tab', 'treeitem',
  'slider', 'scrollbar', 'listbox', 'menu', 'tree', 'radiogroup',
]);

/** A glossary term or its focusable definition is a reading surface.
 * App and Docket must leave keyboard input there instead of advancing time
 * or taking a numbered choice. */
export function isGlossaryFocus(el: Element | null): boolean {
  if (!el) return false;
  let active: Element | null = innermostActiveElement(el);
  while (active) {
    if (active.closest('.glossary-text')) return true;
    // closest() cannot cross a ShadowRoot. A glossary may wrap a custom
    // focusable widget: follow its open host before letting the game use keys.
    active = openShadowHost(active.getRootNode?.());
  }
  return false;
}

/** Open shadow hosts belong to their owning document's DOM realm. A global
 * ShadowRoot instanceof check fails for otherwise-valid iframe-owned roots. */
function openShadowHost(root: Node | undefined): Element | null {
  if (root?.nodeType !== 11) return null;
  const shadow = root as ShadowRoot;
  return shadow.mode === 'open' ? shadow.host : null;
}

/**
 * Treat descendants of custom ARIA text-entry widgets as typing too. Focus may
 * sit on a child rather than the role-bearing element, including across an
 * open shadow root whose host or outer ancestor owns the field role.
 */
export function isField(el: Element | null): boolean {
  if (!el) return false;
  let active: Element | null = innermostActiveElement(el);
  while (active) {
    const tag = active.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
      || (active as HTMLElement).isContentEditable === true
      || hasRole(active, FIELD_ROLES)) return true;

    // parentElement stops at a ShadowRoot; continue through its open host.
    const root: Node | undefined = active.getRootNode?.();
    active = active.parentElement
      ?? openShadowHost(root);
  }
  return false;
}

/**
 * The focused thing, or a control containing it, owns Space and Enter.
 * A custom ARIA widget may contain a separately focusable child; keys sent
 * through that child still belong to the containing button/selection widget,
 * not the game clock. Follow open shadow hosts as for text fields.
 */
export function isControl(el: Element | null): boolean {
  if (!el) return false;
  let active: Element | null = innermostActiveElement(el);
  while (active) {
    const tag = active.tagName;
    if (tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY'
      || hasRole(active, CONTROL_ROLES)) return true;

    const root: Node | undefined = active.getRootNode?.();
    active = active.parentElement
      ?? openShadowHost(root);
  }
  return false;
}

/** What `?` puts on screen. The order they are worth learning in. */
export const SHORTCUTS = [
  { keys: 'Space', does: 'turn a year' },
  { keys: 'Enter', does: 'turn a year' },
  { keys: 'Shift + Enter', does: 'turn five' },
  { keys: '1 – 9', does: 'take that choice, or that card' },
  { keys: 'Esc', does: 'leave the interlude, shut the card, close this' },
  { keys: '?', does: 'this list' },
] as const satisfies readonly { keys: string; does: string }[];

/** Help copy only. The real key dispatch lives exclusively in shortcutFor. */
const PLAIN_SHORTCUTS: Readonly<Record<(typeof SHORTCUTS)[number]['keys'], string>> = {
  Space: 'Advance one year',
  Enter: 'Advance one year',
  'Shift + Enter': 'Advance five years',
  '1 – 9': 'Choose a numbered option or match',
  Esc: 'Close the current panel or dialog',
  '?': 'Show or hide this help',
};

export function shortcutHelp(mode: ProseMode = 'original'): readonly { keys: string; does: string }[] {
  return mode === 'plainenglish'
    ? SHORTCUTS.map(({ keys }) => ({ keys, does: PLAIN_SHORTCUTS[keys] }))
    : SHORTCUTS;
}

