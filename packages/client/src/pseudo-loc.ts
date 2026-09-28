const OPEN = '⟦';
const CLOSE = '⟧';
const LETTER = /\p{L}/u;
const SKIP_ELEMENTS = new Set(['SCRIPT', 'STYLE']);
const TRANSLATABLE_ATTRIBUTES = [
  'aria-label',
  'aria-description',
  'placeholder',
  'alt',
  'title',
] as const;

/**
 * Pseudo-localisation is a layout probe, not a translation system.
 *
 * Keep the source legible while making it meaningfully wider: duplicate
 * letters evenly through the string until the alphabetic content is about 35%
 * longer, then bracket it so an untranslated fragment is obvious at a glance.
 * Pure numbers, punctuation and whitespace are left alone.
 */
export function pseudoLocalise(text: string): string {
  if (!text || text.trim().length === 0) return text;

  const start = text.search(/\S/u);
  if (start < 0) return text;

  let end = text.length;
  while (end > start && /\s/u.test(text[end - 1]!)) end -= 1;

  const leading = text.slice(0, start);
  const core = text.slice(start, end);
  const trailing = text.slice(end);

  if (core.startsWith(OPEN) && core.endsWith(CLOSE)) return text;

  const chars = [...core];
  const letters = chars.filter((char) => LETTER.test(char)).length;
  if (letters === 0) return text;

  const extra = Math.ceil(letters * 0.35);
  let seen = 0;
  let expanded = '';

  for (const char of chars) {
    expanded += char;
    if (!LETTER.test(char)) continue;

    seen += 1;
    const duplicatesBefore = Math.floor(((seen - 1) * extra) / letters);
    const duplicatesAfter = Math.floor((seen * extra) / letters);
    if (duplicatesAfter > duplicatesBefore) expanded += char;
  }

  return `${leading}${OPEN}${expanded}${CLOSE}${trailing}`;
}

export function pseudoLocRequested(search: string): boolean {
  const params = new URLSearchParams(search);
  if (!params.has('pseudo-loc')) return false;
  const value = params.get('pseudo-loc');
  return value === '' || value === '1' || value === 'true';
}

function transformAttribute(element: Element, name: string): void {
  const value = element.getAttribute(name);
  if (value === null) return;
  const transformed = pseudoLocalise(value);
  if (transformed !== value) element.setAttribute(name, transformed);
}

function transformNode(node: Node): void {
  if (node.nodeType === Node.TEXT_NODE) {
    const parent = node.parentElement;
    if (parent && SKIP_ELEMENTS.has(parent.tagName)) return;
    const text = node.nodeValue ?? '';
    const transformed = pseudoLocalise(text);
    if (transformed !== text) node.nodeValue = transformed;
    return;
  }

  if (node.nodeType === Node.ELEMENT_NODE) {
    const element = node as Element;
    if (SKIP_ELEMENTS.has(element.tagName)) return;
    for (const attribute of TRANSLATABLE_ATTRIBUTES) {
      transformAttribute(element, attribute);
    }
  }

  for (const child of Array.from(node.childNodes)) transformNode(child);
}

/**
 * Install the development-only stress pass over one rendered client root.
 *
 * Vue replaces text nodes as reactive state changes, so a one-shot walk would
 * exercise only the title screen. Watching additions and character changes
 * keeps the probe on the docket, Match, Record, Chronicle and Table as the
 * player moves through the game.
 */
export function installPseudoLocalisation(root: Element): () => void {
  transformNode(root);
  root.ownerDocument.documentElement.dataset.pseudoLoc = 'true';

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'attributes') {
        if (record.target instanceof Element && record.attributeName) {
          transformAttribute(record.target, record.attributeName);
        }
        continue;
      }

      if (record.type === 'characterData') {
        transformNode(record.target);
        continue;
      }

      for (const added of Array.from(record.addedNodes)) transformNode(added);
    }
  });

  observer.observe(root, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: [...TRANSLATABLE_ATTRIBUTES],
  });

  return () => {
    observer.disconnect();
    delete root.ownerDocument.documentElement.dataset.pseudoLoc;
  };
}
