/**
 * Select the ending's read-only share code, including when an embedded host
 * supplies an HTML textarea from a different document realm.
 *
 * A constructor check against the outer Window rejects iframe textareas.
 * Test the DOM identity instead; SVG lookalikes and non-elements are not
 * selectable share-code controls.
 */
export function selectShareCodeTextarea(target: EventTarget | null): void {
  if (!target || (target as Node).nodeType !== 1) return;
  const element = target as Element;
  if (element.namespaceURI !== 'http://www.w3.org/1999/xhtml'
    || element.localName !== 'textarea') return;
  const textarea = element as HTMLTextAreaElement;
  if (typeof textarea.select === 'function') textarea.select();
}
