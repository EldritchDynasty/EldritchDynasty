import {
  assertNever,
  type BynameGrant, type BynamePen, type BynameStanding, type EventTemplate, type Person, type ResolvedClaim,
  type Year,
} from '@ed/schema';
import type { ChronicleEntry, SimCtx } from './world.js';
import { castIn, type SlotFill } from './events/fill.js';
import { renderProse } from './prose.js';

/**
 * EARNED BYNAMES (issue #1990). Contract: `docs/BYNAME-CONTRACT.md`.
 *
 * One boundary grants a byname: `applyRecord`, after the page is committed.
 * Both the player's docket (`resolveRecord`) and the chronicler's automatic
 * pen (`afterRecord`) reach it, so there is no second path to keep in step.
 * No client, no save loader, no succession poll and no text search ever
 * awards one.
 *
 * The rules, in the order `grantByname` applies them:
 *
 *   1. The pen decides. Omit writes a dated blank and grants nothing — and
 *      takes nothing away from a byname somebody already holds.
 *   2. The selected Record option must author a `byname`.
 *   3. Its slot must have cast exactly one person (a counted slot or an
 *      empty optional slot grants nothing), who was family of the player's
 *      house in the page's year. A rival is not named by our book.
 *   4. The committed page must carry a claim about that person. The byname
 *      is the claim shortened into a name; with no claim there is nothing for
 *      it to rest on.
 *   5. The first byname stands. An authored, legacy or earlier earned
 *      epithet is never replaced, so a later page cannot rename history.
 *
 * The words are rendered once, in the reader's prose mode, and frozen into
 * `Person.epithet` like any other saved page (`docs/LOCALISATION.md`).
 */

export interface RecordBynameCommit {
  /** The template that fired, with the selected Record block on `.record`. */
  event: EventTemplate;
  /** The page `applyRecord` just wrote: this firing's own chronicle entry. */
  page: string;
  pen: 'record' | 'omit' | 'embellish';
  fill: SlotFill;
  /** The claims as committed to the page, resolved against this cast. */
  claims: readonly ResolvedClaim[];
  /** The authored lie an Embellish opened. */
  discrepancy?: string;
  /** Exact authored Record selection, when a choice/outcome-specific block was used. */
  choice?: string;
  outcome?: string;
  /** The Record block's content address, for the Plain English counterpart. */
  address?: string;
}

/** Who was granted what, for the receipt. Absent when nothing was earned. */
export interface BynameAward {
  person: string;
  /** The person's name as it stands, so a receipt need not look them up. */
  name: string;
  text: string;
}

/** Family of the player's house in `year`, including someone whose life closed that year. */
function familyInYear(ctx: SimCtx, person: Person, year: number): boolean {
  return person.membership.some((m) => m.house === ctx.world.playerHouse
    && (m.kind === 'blood' || m.kind === 'cadet' || m.kind === 'married_in')
    && m.from <= year && (m.to === undefined || m.to >= year));
}

export function grantByname(ctx: SimCtx, commit: RecordBynameCommit): BynameAward | undefined {
  const pen = commit.pen;
  switch (pen) {
    case 'omit': return undefined;
    case 'record':
    case 'embellish': return grantFromPen(ctx, commit, pen);
    default: return assertNever(pen);
  }
}

function grantFromPen(ctx: SimCtx, commit: RecordBynameCommit, pen: BynamePen): BynameAward | undefined {
  const w = ctx.world;
  const earned = eligibleByname(ctx, commit.event, pen, commit.fill, commit.claims, commit.address);
  // Cheap checks first: most Record commits author no byname at all.
  if (!earned || !w.chronicle.some((entry) => entry.id === commit.page)) return undefined;
  const { person, text } = earned;
  person.epithet = text;
  person.byname = {
    source: {
      kind: 'record',
      event: commit.event.id,
      pen,
      page: commit.page,
      ...(commit.choice !== undefined ? { choice: commit.choice } : {}),
      ...(commit.outcome !== undefined ? { outcome: commit.outcome } : {}),
      ...(pen === 'embellish' && commit.discrepancy !== undefined ? { discrepancy: commit.discrepancy } : {}),
    },
    year: w.year,
  };
  return { person: person.id, name: person.name, text };
}

/**
 * Rules 2–5 above, shared by the grant and by the docket's preview so the
 * button can never promise a name the commit would refuse. `claims` are the
 * pen's claims resolved against this cast; `address` is the selected Record
 * block's content address, for the Plain English counterpart.
 */
export function eligibleByname(
  ctx: SimCtx,
  event: EventTemplate,
  pen: BynamePen,
  fill: SlotFill,
  claims: readonly ResolvedClaim[],
  address?: string,
): { person: Person; text: string } | undefined {
  const w = ctx.world;
  const authored = event.record?.options[pen].byname;
  if (!authored) return undefined;
  const cast = castIn(fill, authored.slot);
  if (cast.length !== 1) return undefined;
  const person = w.people.get(cast[0]!);
  if (!person || !familyInYear(ctx, person, w.year)) return undefined;
  if (!claims.some((claim) => claim.person === person.id)) return undefined;
  if (person.epithet !== undefined || person.byname !== undefined) return undefined;
  const text = renderProse(
    ctx,
    address === undefined ? undefined : `${address}.options.${pen}.byname.text`,
    authored.text,
  ).trim();
  return text ? { person, text } : undefined;
}

/**
 * A lie was proven or buried. Stamp it on the ONE byname whose telling that
 * settlement addressed: the latest embellished page carrying this authored
 * discrepancy id, because each Embellish of the same id reopens the shared
 * state for the newest telling (contract, "Repeated-discrepancy audit"). An
 * earlier telling keeps whatever it had — a settlement already stamped, or
 * `claimed` if it was superseded while still open. Nothing is inferred later
 * from the discrepancy map.
 */
export function settleBynames(ctx: SimCtx, discrepancy: string, state: 'proven' | 'buried'): void {
  const w = ctx.world;
  let latest: ChronicleEntry | undefined;
  for (let i = w.chronicle.length - 1; i >= 0; i--) {
    const entry = w.chronicle[i]!;
    if (entry.record === 'embellish' && entry.discrepancyId === discrepancy && entry.id !== undefined) {
      latest = entry;
      break;
    }
  }
  if (latest?.id === undefined) return;
  // A grant needs a claim about its person on its page, so the page's own
  // claims name everybody who could rest on it — no scan of the whole store.
  for (const id of new Set((latest.claims ?? []).map((claim) => claim.person))) {
    const grant = w.people.get(id)?.byname;
    if (!grant || !restsOn(grant, discrepancy, latest.id)) continue;
    grant.settled = { state, year: w.year };
  }
}

function restsOn(grant: BynameGrant, discrepancy: string, page: string): boolean {
  const source = grant.source;
  switch (source.kind) {
    case 'record': return source.pen === 'embellish' && source.discrepancy === discrepancy && source.page === page;
    default: return assertNever(source.kind);
  }
}

/**
 * How the reader is told a byname stands — read off the saved grant alone,
 * never off live hidden state. `undefined` means the person has no byname.
 */
export function bynameStanding(person: Pick<Person, 'epithet' | 'byname'>): BynameStanding | undefined {
  if (person.epithet === undefined) return undefined;
  const grant = person.byname;
  if (!grant) return 'unknown';
  const source = grant.source;
  switch (source.kind) {
    case 'record': {
      const pen = source.pen;
      switch (pen) {
        case 'record': return 'attested';
        case 'embellish': {
          const settled = grant.settled?.state;
          if (settled === undefined) return 'claimed';
          switch (settled) {
            case 'proven': return 'contested';
            case 'buried': return 'buried';
            default: return assertNever(settled);
          }
        }
        default: return assertNever(pen);
      }
    }
    default: return assertNever(source.kind);
  }
}

/**
 * The byname as the read model shows it: values only, never a reference into
 * the person. `page` is the exact Chronicle entry id the byname rests on, so
 * a client links to the source without matching English or `(event, year)`.
 * An `unknown` standing carries no page and no year, because none was saved.
 */
export interface BynameView {
  text: string;
  standing: BynameStanding;
  pen?: BynamePen;
  year?: Year;
  page?: string;
  /** When the lie under a `contested` or `buried` byname was settled. */
  settledYear?: Year;
}

export function bynameView(person: Pick<Person, 'epithet' | 'byname'>): BynameView | undefined {
  const standing = bynameStanding(person);
  if (standing === undefined || person.epithet === undefined) return undefined;
  const grant = person.byname;
  if (!grant) return { text: person.epithet, standing };
  const source = grant.source;
  switch (source.kind) {
    case 'record': return {
      text: person.epithet,
      standing,
      pen: source.pen,
      year: grant.year,
      page: source.page,
      ...(grant.settled ? { settledYear: grant.settled.year } : {}),
    };
    default: return assertNever(source.kind);
  }
}
