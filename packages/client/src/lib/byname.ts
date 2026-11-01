import type { BynameStanding } from '@ed/schema';
import type { BynameView } from '@ed/core';

/**
 * Words for an earned byname's provenance (#1990), in both reading modes.
 *
 * The engine decides the standing from the saved grant; this file only says
 * it. It never says whether the byname is TRUE: a Record page is the house's
 * honest account, an improved page is the house's improved account, and a
 * proven discrepancy is somebody else's proof. The vocabulary for the last
 * two is the one `RecordedLife.vue` already uses for disputed pages.
 */

/** Only `game.ts` imports the simulation for a value; a client switch ends here instead. */
function unhandled(value: never): never {
  throw new Error(`Unhandled byname standing: ${String(value)}`);
}

/** A short qualifier for places that only have room for a tag; none when the byname stands unqualified. */
export function bynameTag(standing: BynameStanding, plain: boolean): string | undefined {
  switch (standing) {
    case 'attested':
    case 'unknown': return undefined;
    case 'claimed': return plain ? 'from a more favourable account' : 'as the house improved it';
    case 'contested': return 'discrepancy proven';
    case 'buried': return 'dispute buried';
    default: return unhandled(standing);
  }
}

/** One sentence: where the byname came from and how it now stands. */
export function bynameNote(byname: BynameView, plain: boolean): string {
  const year = byname.year;
  const settled = byname.settledYear;
  switch (byname.standing) {
    case 'attested': return plain
      ? `Byname from the factual record of ${year}.`
      : `Written into the book as it happened, in ${year}.`;
    case 'claimed': return plain
      ? `Byname from a more favourable account written in ${year}.`
      : `Written into the book in ${year}, on a page the house improved.`;
    case 'contested': return plain
      ? `Byname from a more favourable account written in ${year}. The discrepancy was proven${settled !== undefined ? ` in ${settled}` : ''}.`
      : `Written into the book in ${year}, on a page the house improved; the discrepancy was proven${settled !== undefined ? ` in ${settled}` : ''}, and the name is still said.`;
    case 'buried': return plain
      ? `Byname from a more favourable account written in ${year}. The dispute was buried${settled !== undefined ? ` in ${settled}` : ''}.`
      : `Written into the book in ${year}, on a page the house improved; the doubt was buried${settled !== undefined ? ` in ${settled}` : ''}, not answered.`;
    case 'unknown': return plain
      ? 'Byname of unrecorded origin.'
      : 'An old byname; the book does not say where it came from.';
    default: return unhandled(byname.standing);
  }
}
