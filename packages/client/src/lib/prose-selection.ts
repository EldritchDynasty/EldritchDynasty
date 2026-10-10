import type { ProseMode, ProseVariant } from '@ed/schema';

/**
 * Keep lazy Plain English requests in selection order, not completion order.
 * The optional chunk can outlive an Original -> Plain English toggle, and an
 * older failed import must never undo the reader's newer successful choice.
 */
export function createProseModeSelector(
  selectMode: (mode: ProseMode) => void,
  loadVariants: () => Promise<readonly ProseVariant[]>,
  acceptVariants: (variants: readonly ProseVariant[]) => void,
): (mode: ProseMode) => Promise<void> {
  let selection = 0;

  return async (mode) => {
    const current = ++selection;
    selectMode(mode);
    if (mode !== 'plainenglish') return;

    try {
      const variants = await loadVariants();
      if (current === selection) acceptVariants(variants);
    } catch {
      // Only the current request may restore Original after an offline miss.
      if (current === selection) selectMode('original');
    }
  };
}
