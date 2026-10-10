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
}

export function shortcutFor(p: KeyPress): Shortcut | null {
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

  if (p.key >= '1' && p.key <= '9') return { kind: 'take', index: Number(p.key) - 1 };

  return null;
}

/** Whether a press should be read as typing rather than steering. */
export function isField(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
    || (el as HTMLElement).isContentEditable === true;
}

/** Whether the focused thing answers Space and Enter on its own. */
export function isControl(el: Element | null): boolean {
  return el?.tagName === 'BUTTON' || el?.tagName === 'A' || el?.tagName === 'SUMMARY';
}

/** What `?` puts on screen. The order they are worth learning in. */
export const SHORTCUTS: { keys: string; does: string }[] = [
  { keys: 'Space', does: 'turn a year' },
  { keys: 'Enter', does: 'turn a year' },
  { keys: 'Shift + Enter', does: 'turn five' },
  { keys: '1 – 9', does: 'take that choice, or that card' },
  { keys: 'Esc', does: 'leave the interlude, shut the card, close this' },
  { keys: '?', does: 'this list' },
];
