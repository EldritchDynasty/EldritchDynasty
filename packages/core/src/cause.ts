import type { SimCtx } from './world.js';

export interface ChronicleCause {
  year: number;
  /** Absent when the act was real but the house never wrote a page for it. */
  page?: string;
  /** True only when the target page exists as a dated omission. */
  blank: boolean;
}

function describedCause(
  ctx: SimCtx,
  cause: { year: number; page?: string },
): ChronicleCause {
  if (!cause.page) return { year: cause.year, blank: false };
  const target = ctx.world.chronicle.find((entry) => entry.id === cause.page);
  return {
    year: cause.year,
    page: cause.page,
    blank: target?.text === null,
  };
}

function grudgeCause(ctx: SimCtx, reference: string): ChronicleCause | undefined {
  for (const relationship of ctx.world.relationships.values()) {
    const grudge = relationship.grudges.find((candidate) => candidate.id === reference);
    if (!grudge) continue;
    return describedCause(ctx, {
      year: grudge.originYear,
      ...(grudge.originPage ? { page: grudge.originPage } : {}),
    });
  }
  return undefined;
}

/**
 * Resolve the earlier page behind a later Chronicle consequence.
 *
 * The ordinary caller passes a Chronicle entry id. Grudge ids are accepted as
 * stable references too because relationship threads already expose them and a
 * grudge is not itself a Chronicle page. That keeps one read model for both
 * kinds of delayed consequence without inventing a synthetic page.
 */
export function causeOf(ctx: SimCtx, reference: string): ChronicleCause | undefined {
  const entry = ctx.world.chronicle.find((candidate) => candidate.id === reference);
  if (entry?.cause) return describedCause(ctx, entry.cause);

  // A discrepancy's durable identity already sits on the embellished page.
  // Once it is proven or buried, that page is the recoverable origin. Accept
  // either the discrepancy id itself or any Chronicle entry carrying it.
  const discrepancyId = entry?.discrepancyId
    ?? (ctx.world.discrepancies.has(reference) ? reference : undefined);
  if (discrepancyId) {
    const discrepancy = ctx.world.discrepancies.get(discrepancyId);
    if (discrepancy && discrepancy.state !== 'open') {
      const origin = ctx.world.chronicle.find((candidate) =>
        candidate.discrepancyId === discrepancyId && candidate.record === 'embellish');
      if (origin?.id) {
        return describedCause(ctx, { year: origin.year, page: origin.id });
      }
    }
  }

  return grudgeCause(ctx, reference);
}

/** Years in which later pages explicitly answer the supplied page. */
export function answeredBy(ctx: SimCtx, entryId: string): number[] {
  const source = ctx.world.chronicle.find((entry) => entry.id === entryId);
  if (!source) return [];

  const years = new Set<number>();
  for (const entry of ctx.world.chronicle) {
    if (!entry.id || entry.id === entryId || entry.year < source.year) continue;
    const cause = causeOf(ctx, entry.id);
    if (cause?.page === entryId) years.add(entry.year);
  }
  return [...years].sort((a, b) => a - b);
}
