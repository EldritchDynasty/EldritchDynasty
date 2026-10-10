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
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const style = window.getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') {
      return true;
    }
    if (node === card) break;
  }
  return false;
}

export function modalFocusable(card: HTMLElement | null): HTMLElement[] {
  if (!card) return [];
  return [...card.querySelectorAll<HTMLElement>(
    'button, [href], input, select, textarea, [tabindex]',
  )].filter((element) =>
    element.tabIndex >= 0
    && !element.matches(':disabled')
    && !element.closest('[hidden], [inert]')
    && !(element instanceof HTMLInputElement && element.type === 'hidden')
    && !cssConcealed(element, card));
}

export function useModal(card: Ref<HTMLElement | null>, close: () => void): void {
  let cameFrom: HTMLElement | null = null;

  const focusable = (): HTMLElement[] => modalFocusable(card.value);

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
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
    if (e.shiftKey && (here === first || !card.value?.contains(here))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (here === last || !card.value?.contains(here))) {
      e.preventDefault();
      first.focus();
    }
  }

  onMounted(() => {
    const active = document.activeElement;
    cameFrom = active instanceof HTMLElement && active !== document.body ? active : null;
    focusable()[0]?.focus();
    window.addEventListener('keydown', onKey);
  });

  onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKey);
    const back = cameFrom;
    requestAnimationFrame(() => {
      if (back?.isConnected && !back.hasAttribute('disabled')) {
        back.focus();
        if (document.activeElement === back) return;
      }
      document.querySelector<HTMLElement>(
        '.clock button:not([disabled]), .board button:not([disabled])',
      )?.focus();
    });
  });
}
