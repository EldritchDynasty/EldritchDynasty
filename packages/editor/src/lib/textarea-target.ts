/** Accept genuine HTML textarea event targets even when a host supplies
 * an element from another same-origin document realm. DOM instance checks
 * against this module's HTMLTextAreaElement constructor reject those nodes.
 */
export function textareaTarget(target: EventTarget | null): HTMLTextAreaElement | null {
  const element = target as Element | null;
  if (element?.nodeType !== Node.ELEMENT_NODE
    || element.namespaceURI !== 'http://www.w3.org/1999/xhtml'
    || element.localName !== 'textarea') return null;
  return element as HTMLTextAreaElement;
}
