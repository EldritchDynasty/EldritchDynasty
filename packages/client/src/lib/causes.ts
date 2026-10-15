import type { ChronicleCause, ChronicleEntry } from '@ed/core';
import type { ProseMode } from '@ed/schema';

/**
 * THE WAY BACK TO WHAT CAUSED IT (issue #269).
 *
 * The sentence the design wants the player to say is *"that happened because
 * of me."* A delayed consequence echoes a generation after the act, and until
 * now the echo named the act in prose and nothing got the reader from the one
 * page to the other.
 *
 * Three things this module is careful about, and each is a rule, not a style:
 *
 * - **Years are the only numbers.** §29 rule 1: Bearing is never named. No
 *   weight, score, probability or time-to-bill reaches a link; a reader who
 *   could count the gap in anything but years could reverse-engineer it.
 * - **An act the book never wrote down stays unwritten.** A Match or a
 *   withheld daughter has a year and no page. That is said plainly rather
 *   than patched with a page the house did not write.
 * - **A link lands on what the book SAYS.** An omitted page is reached as its
 *   dated blank and an embellished page as the house told it. Nothing here
 *   reads the truth behind either.
 */

/** What an entry links to, and what links to it. */
export interface EntryLinks {
  cause?: ChronicleCause;
  /** Years of later pages that answer this one, oldest first. */
  answered: number[];
}

export type CauseLink =
  | { kind: 'see'; page: string; label: string }
  | { kind: 'unwritten'; label: string };

/** How an entry's cause reads under it. */
export function causeLink(cause: ChronicleCause, mode: ProseMode = 'original'): CauseLink {
  if (mode === 'plainenglish') {
    return cause.page
      ? { kind: 'see', page: cause.page, label: `See the Chronicle entry from ${cause.year}` }
      : { kind: 'unwritten', label: `No Chronicle entry was written for ${cause.year}.` };
  }
  return cause.page
    ? { kind: 'see', page: cause.page, label: `see ${cause.year}` }
    : { kind: 'unwritten', label: `${cause.year}; the book has no page for it` };
}

/** "answered in 1067", "answered in 1067 and 1092", "answered in 1067, 1080 and 1092". */
export function answeredLabel(years: number[], mode: ProseMode = 'original'): string | null {
  if (!years.length) return null;
  const listedYears = years.length === 1
    ? String(years[0])
    : `${years.slice(0, -1).join(', ')} and ${years[years.length - 1]}`;
  return mode === 'plainenglish'
    ? `Later responses were recorded in ${listedYears}.`
    : `answered in ${listedYears}`;
}

/**
 * Links for the entries being drawn, and only those. The panel draws sixty and
 * the volume draws a growing window, so neither asks the engine about pages
 * nobody is looking at.
 */
export function linksFor(
  entries: readonly ChronicleEntry[],
  reads: { causeOf(id: string): ChronicleCause | undefined; answeredBy(id: string): number[] },
): Map<string, EntryLinks> {
  const out = new Map<string, EntryLinks>();
  for (const entry of entries) {
    if (!entry.id) continue;
    const cause = reads.causeOf(entry.id);
    const answered = reads.answeredBy(entry.id);
    if (cause || answered.length) out.set(entry.id, { ...(cause ? { cause } : {}), answered });
  }
  return out;
}

/**
 * The drawn page carrying this id, found by its `data-entry` hook. Compared
 * rather than spliced into a selector, so an id never has to be escaped.
 */
export function findEntry(root: ParentNode | null | undefined, id: string): HTMLElement | undefined {
  if (!root) return undefined;
  for (const el of root.querySelectorAll<HTMLElement>('[data-entry]')) {
    if (el.dataset.entry === id) return el;
  }
  return undefined;
}
