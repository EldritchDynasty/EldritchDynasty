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
/** Native DOM nodes from a same-origin embedded document have different constructors. */
function isHtmlElement(node: Node): node is HTMLElement {
  return node.nodeType === 1
    && (node as Element).namespaceURI === 'http://www.w3.org/1999/xhtml';
}

function computedStyle(node: HTMLElement): CSSStyleDeclaration {
  return (node.ownerDocument.defaultView ?? window).getComputedStyle(node);
}

/** Walk out of open shadow roots as well as ordinary DOM parents. */
function composedParent(element: HTMLElement): HTMLElement | null {
  // A slotted node renders beneath its slot, not beneath its light-DOM
  // parent. Visibility, inertness and disclosure checks must follow that
  // composed path before walking through the shadow host.
  if (element.assignedSlot) return element.assignedSlot;
  if (element.parentElement) return element.parentElement;
  const root = element.getRootNode();
  const host = (root as ShadowRoot).host;
  return host && isHtmlElement(host) ? host : null;
}

function composedContains(root: HTMLElement, element: HTMLElement | null): boolean {
  for (let node = element; node; node = composedParent(node)) {
    if (node === root) return true;
  }
  return false;
}

/** document.activeElement names a shadow host, not its focused inner button. */
function deepestActiveElement(doc: Document = document): Element | null {
  let active = doc.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
}

function concealedByAttribute(element: HTMLElement, card: HTMLElement): boolean {
  for (let node: HTMLElement | null = element; node; node = composedParent(node)) {
    if (node.matches('[hidden], [inert]')) return true;
    if (node === card) break;
  }
  return false;
}

function cssConcealed(element: HTMLElement, card: HTMLElement): boolean {
  // Visibility inherits, but a child can explicitly override a hidden ancestor.
  // Test the target's resolved value rather than ruling out such visible children.
  const visibility = computedStyle(element).visibility;
  if (visibility === 'hidden' || visibility === 'collapse') return true;

  // Neither display:none nor content-visibility:hidden renders descendants.
  // Unlike visibility:hidden, a child's visibility:visible cannot override
  // either ancestor restriction. Check each ancestor up to the modal card.
  for (let node: HTMLElement | null = element; node; node = composedParent(node)) {
    const style = computedStyle(node);
    // Check the inline declaration too: CSSOM implementations may not
    // reflect an explicitly hidden <slot> in its computed display value.
    if (node.style.display === 'none' || style.display === 'none'
      || style.getPropertyValue('content-visibility') === 'hidden') return true;
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
  for (let parent = composedParent(element); parent; parent = composedParent(parent)) {
    if (parent.tagName === 'DETAILS' && !parent.hasAttribute('open')) {
      const summary = [...parent.children].find((child) => child.tagName === 'SUMMARY');
      if (!summary || !isHtmlElement(summary) || !composedContains(summary, element)) return true;
    }
    if (parent === card) break;
  }
  return false;
}

/**
 * An explicit editing host is in the browser's sequential Tab order even
 * without tabindex. Nested editables are not additional Tab stops unless the
 * author explicitly gives them tabindex=0; a negative tabindex always wins.
 */
function implicitEditableTabStop(element: HTMLElement): boolean {
  if (element.hasAttribute('tabindex')) return false;
  const value = element.getAttribute('contenteditable')?.toLowerCase();
  if (value !== '' && value !== 'true' && value !== 'plaintext-only') return false;

  // A contenteditable=false ancestor stops inheritance: an editing host
  // inside it starts a new editable island rather than a nested Tab stop.
  for (let parent = composedParent(element); parent; parent = composedParent(parent)) {
    const parentValue = parent.getAttribute('contenteditable')?.toLowerCase();
    if (parentValue === 'false') break;
    if (parentValue === '' || parentValue === 'true' || parentValue === 'plaintext-only'
      || parent.isContentEditable) return false;
  }
  return true;
}

function usableFocusTarget(element: HTMLElement, root: HTMLElement): boolean {
  return (element.tabIndex >= 0 || implicitEditableTabStop(element))
    && !element.matches(':disabled')
    && !concealedByAttribute(element, root)
    && !behindClosedDetails(element, root)
    && !(element.localName === 'input' && (element as HTMLInputElement).type === 'hidden')
    && !cssConcealed(element, root);
}

/** A host can throw from focus(), not merely refuse it; try the next target. */
function tryFocus(target: HTMLElement): boolean {
  try {
    target.focus();
  } catch {
    return false;
  }
  return deepestActiveElement(target.ownerDocument) === target;
}

export function modalFocusable(card: HTMLElement | null): HTMLElement[] {
  if (!card) return [];
  const found: HTMLElement[] = [];
  const selector = 'button, summary, [href], input, select, textarea, [tabindex], [contenteditable]';
  // querySelectorAll does not enter shadow roots. Traverse in DOM order,
  // visiting each open shadow tree where its host occurs in the dialog.
  const walk = (root: Element | ShadowRoot): void => {
    // A shadow host renders its shadow tree; unassigned light-DOM children
    // cannot be visited as separate Tab stops. Only <slot> can project them.
    if (root.nodeType === 1 && (root as Element).shadowRoot) {
      walk((root as Element).shadowRoot!);
      return;
    }
    const children: Element[] = [];
    if (isHtmlElement(root) && root.localName === 'slot') {
      const assigned = (root as HTMLSlotElement).assignedNodes();
      if (assigned.length) {
        // A text-only assignment also hides fallback content.
        for (const node of assigned) if (node.nodeType === 1) children.push(node as Element);
      } else {
        children.push(...root.children);
      }
    } else {
      children.push(...root.children);
    }
    for (const child of children) {
      if (isHtmlElement(child) && child.matches(selector) && usableFocusTarget(child, card)) {
        found.push(child);
      }
      walk(child);
    }
  };
  walk(card);
  return found;
}

export function useModal(card: Ref<HTMLElement | null>, close: () => void): void {
  let cameFrom: HTMLElement | null = null;
  let keyboardWindow: Window | null = null;

  const focusable = (): HTMLElement[] => modalFocusable(card.value);

  function onKey(e: KeyboardEvent): void {
    // Several overlays can coexist briefly (or be opened in succession before
    // the previous one unmounts). Each registered its own window listener; only
    // the topmost dialog may dismiss or redirect keyboard focus. The older
    // modal takes over again automatically once the top one has gone.
    const doc = card.value?.ownerDocument ?? document;
    const dialogs = doc.querySelectorAll<HTMLElement>('[aria-modal="true"]');
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
    const here = deepestActiveElement(doc);
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
    const doc = card.value?.ownerDocument ?? document;
    const active = deepestActiveElement(doc);
    cameFrom = active && isHtmlElement(active) && active !== doc.body ? active : null;
    // Hosts may refuse or throw on focus(), including on a custom first
    // control. Try later usable controls before falling back to the card.
    // None of these failures may skip installation of the keyboard trap.
    const focusedChild = focusable().some(tryFocus);
    if (!focusedChild && card.value) {
      // With no reachable child, the dialog itself owns keyboard focus.
      // Programmatic focus must not introduce a new Tab stop.
      if (!card.value.hasAttribute('tabindex')) card.value.tabIndex = -1;
      tryFocus(card.value);
    }
    keyboardWindow = doc.defaultView ?? window;
    keyboardWindow.addEventListener('keydown', onKey);
  });

  onBeforeUnmount(() => {
    keyboardWindow?.removeEventListener('keydown', onKey);
    keyboardWindow = null;
    const doc = card.value?.ownerDocument ?? document;
    const back = cameFrom;
    requestAnimationFrame(() => {
      // A nested child closing should return to the still-open parent that
      // held focus before it opened. An unrelated successor, however, owns
      // focus and must not be displaced by this deferred restoration.
      // Exclude our own card for synchronous frame mocks during unmount.
      const survivingDialogs = [...doc.querySelectorAll<HTMLElement>('[aria-modal="true"]')]
        .filter((dialog) => dialog !== card.value);
      const top = survivingDialogs[survivingDialogs.length - 1];
      if (top && !composedContains(top, back)) return;

      // Focus restoration is deferred a frame so a closing dialog can leave
      // the DOM first. If a different connected element has gained focus in
      // that frame, the newer interaction wins. Only an unfocused document
      // (body/html) or the detached old dialog needs our fallback.
      const active = doc.activeElement;
      if (!top && active?.nodeType === 1 && active.isConnected
        && active !== doc.body && active !== doc.documentElement) return;

      if (top) {
        // A nested dialog may have disabled or hidden the control that opened
        // it. Restore within the still-open parent, never behind its scrim.
        const inside = modalFocusable(top);
        const target = back && inside.includes(back) ? back : inside[0];
        if (target) {
          if (tryFocus(target)) return;
        }
        // A parent with no usable controls still owns keyboard focus.
        if (!top.hasAttribute('tabindex')) top.tabIndex = -1;
        // Even a custom parent card can reject programmatic focus.
        tryFocus(top);
        return;
      }

      if (back?.isConnected && usableFocusTarget(back, doc.body)) {
        if (tryFocus(back)) return;
      }
      // A pane may have folded or become inert while the dialog was open.
      // Share the trap's visibility rules and keep looking if focus fails.
      for (const target of doc.querySelectorAll<HTMLElement>('.clock button, .board button')) {
        if (!usableFocusTarget(target, doc.body)) continue;
        if (tryFocus(target)) return;
      }
    });
  });
}
