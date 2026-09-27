import type { ChronicleEntry, SimCtx } from './world.js';

export interface ChronicleCause {
  year: number;
  /** Absent when the act was real but the house never wrote a page for it. */
  page?: string;
  /** True only when the target page exists as a dated omission. */
  blank: boolean;
}

/**
 * The Chronicle, indexed once per read. `answeredBy` asks for the cause of
 * every page in the book, and a finished run holds hundreds of them, so a
 * lookup that scanned the book per page made one call quadratic and a client
 * drawing the whole volume cubic.
 */
interface BookIndex {
  byId: Map<string, ChronicleEntry>;
  /** A Discrepancy's embellished page: where the book first told it. */
  embellished: Map<string, ChronicleEntry>;
}

function indexBook(ctx: SimCtx): BookIndex {
  const byId = new Map<string, ChronicleEntry>();
  const embellished = new Map<string, ChronicleEntry>();
  for (const entry of ctx.world.chronicle) {
    if (entry.id) byId.set(entry.id, entry);
    if (entry.discrepancyId && entry.record === 'embellish' && !embellished.has(entry.discrepancyId)) {
      embellished.set(entry.discrepancyId, entry);
    }
  }
  return { byId, embellished };
}

function describedCause(book: BookIndex, cause: { year: number; page?: string }): ChronicleCause {
  if (!cause.page) return { year: cause.year, blank: false };
  return {
    year: cause.year,
    page: cause.page,
    blank: book.byId.get(cause.page)?.text === null,
  };
}

function grudgeCause(ctx: SimCtx, book: BookIndex, reference: string): ChronicleCause | undefined {
  for (const relationship of ctx.world.relationships.values()) {
    const grudge = relationship.grudges.find((candidate) => candidate.id === reference);
    if (!grudge) continue;
    return describedCause(book, {
      year: grudge.originYear,
      ...(grudge.originPage ? { page: grudge.originPage } : {}),
    });
  }
  return undefined;
}

function resolve(ctx: SimCtx, book: BookIndex, reference: string): ChronicleCause | undefined {
  const entry = book.byId.get(reference);
  if (entry?.cause) return describedCause(book, entry.cause);

  // A discrepancy's durable identity already sits on the embellished page.
  // Once it is proven or buried, that page is the recoverable origin. Accept
  // either the discrepancy id itself or any Chronicle entry carrying it.
  const discrepancyId = entry?.discrepancyId
    ?? (ctx.world.discrepancies.has(reference) ? reference : undefined);
  if (discrepancyId) {
    const discrepancy = ctx.world.discrepancies.get(discrepancyId);
    const origin = book.embellished.get(discrepancyId);
    if (discrepancy && discrepancy.state !== 'open' && origin?.id && origin.id !== reference) {
      return describedCause(book, { year: origin.year, page: origin.id });
    }
  }

  // A page is never a grudge: only a reference the book does not hold can be.
  return entry ? undefined : grudgeCause(ctx, book, reference);
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
  return resolve(ctx, indexBook(ctx), reference);
}

/** Years in which later pages explicitly answer the supplied page. */
export function answeredBy(ctx: SimCtx, entryId: string): number[] {
  const book = indexBook(ctx);
  const source = book.byId.get(entryId);
  if (!source) return [];

  const years = new Set<number>();
  for (const entry of ctx.world.chronicle) {
    if (!entry.id || entry.id === entryId || entry.year < source.year) continue;
    if (resolve(ctx, book, entry.id)?.page === entryId) years.add(entry.year);
  }
  return [...years].sort((a, b) => a - b);
}
