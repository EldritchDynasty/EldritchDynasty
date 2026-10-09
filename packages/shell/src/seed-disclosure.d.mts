/** Inspect the installed game's Start disclosure through real DOM events. */
export function inspectSeedDisclosure(
  documentRef: Document,
  afterToggle?: () => Promise<void>,
): Promise<string>;
