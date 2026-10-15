import { onBeforeUnmount, onMounted, type Ref } from 'vue';

/**
 * ONE FOCUS TRAP, FOR EVERY DIALOG THAT TAKES THE SCREEN (issue #48, #58).
 *
 * The Interlude got this treatment first and the two mistakes in it were both
 * invisible in review, so the second dialog does not get to make them again:
 *
 *   - The element focus came from is often GONE by the time the dialog closes.
 *     `focus()` on a detached or disabled node quietly does nothing, and focus
 *     lands on `body` — the keyboard player then tabs in from the top of the
 *     page, which is the state a trap exists to prevent.
 *
 *   - `document.activeElement instanceof HTMLElement` is the obvious way to
 *     record where focus was and is wrong: with nothing focused that is
 *     `<body>`, which IS an HTMLElement, so the restore became a no-op that
 *     then reported success and skipped the fallback.
 */
/**
 * Only targets reachable by ordinary Tab belong in the trap. A CSS selector
 * alone includes disabled selects/textareas and links with tabindex="-1"; a
 * boundary on either makes focus() a no-op and strands keyboard navigation.
 */
/**
 * A CSS-hidden Tab stop is just as unreachable as a `hidden` one.
 * Check ancestors too: `getComputedStyle(button).display` is still "block"
 * when the button's parent has `display: none`.
 */
function cssConcealed(element: HTMLElement, card: HTMLElement): boolean {
  // Visibility inherits, but a child can explicitly override a hidden ancestor.
  // Test the target's resolved value rather than ruling out such visible children.
  const visibility = window.getComputedStyle(element).visibility;
  if (visibility === 'hidden' || visibility === 'collapse') return true;

  // display:none cannot be overridden by descendants, so inspect every parent.
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    if (window.getComputedStyle(node).display === 'none') return true;
    if (node === card) break;
  }
  return false;
}

/**
 * A closed <details> hides its contents, but not its first <summary>.
 * Its hidden children remain in querySelectorAll(), and their computed
 * display/tabIndex are not reliable proof that the browser can focus them.
 * Walk all ancestors so a nested, otherwise-open disclosure cannot escape a
 * closed outer disclosure.
 */
function behindClosedDetails(element: HTMLElement, card: HTMLElement): boolean {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (parent.tagName === 'DETAILS' && !parent.hasAttribute('open')) {
      const summary = [...parent.children].find((child) => child.tagName === 'SUMMARY');
      if (!summary?.contains(element)) return true;
    }
    if (parent === card) break;
  }
  return false;
}

function usableFocusTarget(element: HTMLElement, root: HTMLElement): boolean {
  return element.tabIndex >= 0
    && !element.matches(':disabled')
    && !element.closest('[hidden], [inert]')
    && !behindClosedDetails(element, root)
    && !(element instanceof HTMLInputElement && element.type === 'hidden')
    && !cssConcealed(element, root);
}

export function modalFocusable(card: HTMLElement | null): HTMLElement[] {
  if (!card) return [];
  return [...card.querySelectorAll<HTMLElement>(
    'button, summary, [href], input, select, textarea, [tabindex]',
  )].filter((element) => usableFocusTarget(element, card));
}

export function useModal(card: Ref<HTMLElement | null>, close: () => void): void {
  let cameFrom: HTMLElement | null = null;

  const focusable = (): HTMLElement[] => modalFocusable(card.value);

  function onKey(e: KeyboardEvent): void {
    // Several overlays can coexist briefly (or be opened in succession before
    // the previous one unmounts). Each registered its own window listener; only
    // the topmost dialog may dismiss or redirect keyboard focus. The older
    // modal takes over again automatically once the top one has gone.
    const dialogs = document.querySelectorAll<HTMLElement>('[aria-modal="true"]');
    if (dialogs[dialogs.length - 1] !== card.value) return;

    if (e.key === 'Escape') {
      // Escape dismisses IME candidate popups as well as dialogs. While a
      // composition is active, the input method must receive it untouched.
      if (e.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      // A held Escape closes at most one modal, even if another opens next.
      if (e.repeat) return;
      close();
      return;
    }
    if (e.key !== 'Tab') return;

    // Tab out of either end and you come back in the other. Without it focus
    // walks onto the board behind the scrim — visible to the tab order, and to
    // nobody's eye.
    const inside = focusable();
    if (!inside.length) {
      e.preventDefault();
      return;
    }
    const first = inside[0]!;
    const last = inside[inside.length - 1]!;
    const here = document.activeElement;
    // The card itself may be focused while its children are loading, or a
    // once-focused control may have become disabled. Neither is a Tab stop:
    // start a fresh cycle within the dialog instead of escaping its scrim.
    const notTabbable = !inside.some((element) => element === here);
    if (e.shiftKey && (here === first || notTabbable)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (here === last || notTabbable)) {
      e.preventDefault();
      first.focus();
    }
  }

  onMounted(() => {
    const active = document.activeElement;
    cameFrom = active instanceof HTMLElement && active !== document.body ? active : null;
    const first = focusable()[0];
    first?.focus();
    if (card.value && document.activeElement !== first) {
      // With no reachable control (or a control whose focus() failed),
      // the dialog must own focus instead of leaving it behind the scrim.
      // Programmatic focus must not introduce a new Tab stop.
      if (!card.value.hasAttribute('tabindex')) card.value.tabIndex = -1;
      card.value.focus();
    }
    window.addEventListener('keydown', onKey);
  });

  onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKey);
    const back = cameFrom;
    requestAnimationFrame(() => {
      // A nested child closing should return to the still-open parent that
      // held focus before it opened. An unrelated successor, however, owns
      // focus and must not be displaced by this deferred restoration.
      // Exclude our own card for synchronous frame mocks during unmount.
      const survivingDialogs = [...document.querySelectorAll<HTMLElement>('[aria-modal="true"]')]
        .filter((dialog) => dialog !== card.value);
      const top = survivingDialogs[survivingDialogs.length - 1];
      if (top && !top.contains(back)) return;

      if (top) {
        // A nested dialog may have disabled or hidden the control that opened
        // it. Restore within the still-open parent, never behind its scrim.
        const inside = modalFocusable(top);
        const target = back && inside.includes(back) ? back : inside[0];
        if (target) {
          target.focus();
          if (document.activeElement === target) return;
        }
        // A parent with no usable controls still owns keyboard focus.
        if (!top.hasAttribute('tabindex')) top.tabIndex = -1;
        top.focus();
        return;
      }

      if (back?.isConnected && usableFocusTarget(back, document.body)) {
        back.focus();
        if (document.activeElement === back) return;
      }
      // A pane may have folded or become inert while the dialog was open.
      // Share the trap's visibility rules and keep looking if focus fails.
      for (const target of document.querySelectorAll<HTMLElement>('.clock button, .board button')) {
        if (!usableFocusTarget(target, document.body)) continue;
        target.focus();
        if (document.activeElement === target) return;
      }
    });
  });
}
