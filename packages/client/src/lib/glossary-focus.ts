/**
 * DOM constructors belong to their document's realm. An embedded same-origin
 * document can dispatch a click from a real button that fails the outer
 * window's HTMLButtonElement instanceof check. Preserve that opener so Escape
 * can return focus after closing the glossary note.
 */
export function glossaryOpener(target: EventTarget | null): HTMLButtonElement | null {
  if (!target || !('ownerDocument' in target)) return null;
  const ownerDocument = (target as Element).ownerDocument;
  const Button = ownerDocument?.defaultView?.HTMLButtonElement;
  return Button && target instanceof Button ? target as HTMLButtonElement : null;
}
