import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContent } from '@ed/content';
import { proseOriginalHash, type ProseVariant } from '@ed/schema';
import {
  auditRepository,
  plainEnglishCoverage,
  plainEnglishWorklist,
  report,
  type PlainEnglishWorkItem,
} from './string-audit.js';

export type PendingPlainEnglishStatus = 'missing' | 'stale';

export interface PendingPlainEnglishWorkItem extends PlainEnglishWorkItem {
  variantStatus: PendingPlainEnglishStatus;
  expectedOf: string;
  authoredOf?: string;
}

/**
 * What still needs author attention in #415.
 *
 * A current content counterpart disappears from the worklist. A missing one is
 * work, and a stale one becomes work again when Original changes. Core prose
 * has stable work-item addresses but no runtime variant store yet, so it stays
 * explicitly missing until that separate seam exists.
 */
export function pendingPlainEnglishWorklist(
  items: readonly PlainEnglishWorkItem[],
  variants: readonly ProseVariant[],
): PendingPlainEnglishWorkItem[] {
  const byAddress = new Map(variants.map((variant) => [variant.address, variant]));
  const pending: PendingPlainEnglishWorkItem[] = [];

  for (const item of items) {
    const expectedOf = proseOriginalHash(item.text);
    if (item.source === 'core') {
      pending.push({ ...item, variantStatus: 'missing', expectedOf });
      continue;
    }

    const variant = byAddress.get(item.address);
    if (!variant) {
      pending.push({ ...item, variantStatus: 'missing', expectedOf });
      continue;
    }
    if (variant.of !== expectedOf) {
      pending.push({
        ...item,
        variantStatus: 'stale',
        expectedOf,
        ...(variant.of !== undefined ? { authoredOf: variant.of } : {}),
      });
    }
  }

  return pending;
}

/**
 * One CLI entry point owns all npm run audit:strings modes. Keep --coverage
 * ahead of the legacy worklist so the documented report cannot silently
 * fall through to the human-readable inventory.
 */
export function auditStringsOutput(args: readonly string[], repo: string): string {
  if (args.includes('--plainenglish-coverage')) {
    return JSON.stringify(plainEnglishCoverage(repo), null, 2);
  }
  if (args.includes('--plainenglish-worklist')) {
    const bundle = loadContent();
    const pending = pendingPlainEnglishWorklist(plainEnglishWorklist(repo), bundle.proseVariants);
    return JSON.stringify(pending, null, 2);
  }
  return report(auditRepository(repo), { files: args.includes('--files') }).join('\n');
}

const isMain = process.argv[1]?.replace(/\\/g, '/').endsWith('string-audit-cli.ts');
if (isMain) {
  const repo = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
  console.log(auditStringsOutput(process.argv.slice(2), repo));
}
