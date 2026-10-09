import type { Grudge, Person, PersonId, Relationship } from '@ed/schema';
import { asId } from '@ed/schema';
import { chronicleEntryId, type SimCtx, type WorldState } from '../world.js';
import { ECHO_AFTER, ECHO_SPACING } from '../bearing.js';
import { msg } from '../messages.js';

/**
 * RELATIONSHIPS AND GRUDGES.
 *
 * "Enemies are not a type. Hostility is an edge" — `schema/src/house.ts` said
 * so, defined `Relationship` and `Grudge` with an `inheritance` enum, and
 * nothing anywhere read either of them. Four authored outcomes emitted
 * `kind: relationship` effects, including the seal feud's own grudge —
 * severity 60, `inheritance: all_blood` — and every one of them evaporated at
 * the point of application. The effect switch listed the case with a comment
 * saying it was handled by its own subsystem. There was no subsystem.
 *
 * The point of the enum is that a grudge OUTLIVES the man who took it. A feud
 * whose parties are both dead by the second generation is not a feud, it is an
 * argument — so the same fall-through the arc bindings use applies here: his
 * heir, then his closest blood, then his house. Only a vanished house ends it.
 */

const key = (from: string, to: string) => `${from}->${to}`;

export function edge(w: WorldState, from: string, to: string): Relationship | undefined {
  return w.relationships.get(key(from, to));
}

export function sentimentBetween(w: WorldState, from: string, to: string): number {
  return edge(w, from, to)?.sentiment ?? 0;
}

function upsert(w: WorldState, from: string, to: string): Relationship {
  const existing = w.relationships.get(key(from, to));
  if (existing) return existing;
  const fresh: Relationship = { from, to, sentiment: 0, kinds: [], grudges: [] };
  w.relationships.set(key(from, to), fresh);
  return fresh;
}

export function relate(
  w: WorldState,
  from: string,
  to: string,
  sentiment: number,
  kinds: Relationship['kinds'] = [],
): Relationship {
  const rel = upsert(w, from, to);
  rel.sentiment = Math.max(-100, Math.min(100, rel.sentiment + sentiment));
  for (const k of kinds) if (!rel.kinds.includes(k)) rel.kinds.push(k);
  return rel;
}

/**
 * How fast a grudge of middling severity fades, and what middling means.
 *
 * At severity 30 a grudge loses 0.35 a year and is gone in about eighty-five
 * years — three generations, which is what a slight is worth. At severity 60
 * it takes three hundred and forty; at 90, seven hundred and seventy. A
 * killing is still being held against the house in 2042, which is the entire
 * reason `inheritance` exists.
 */
const GRUDGE_DECAY = 0.35;
const GRUDGE_HALF_SEVERITY = 30;

export function addGrudge(
  ctx: SimCtx,
  from: string,
  to: string,
  spec: { severity: number; inheritance: Grudge['inheritance'] },
  originEvent = 'unrecorded',
  originPage?: string,
): Grudge {
  const w = ctx.world;
  const rel = upsert(w, from, to);
  if (!rel.kinds.includes('rival')) rel.kinds.push('rival');

  const severity = Math.max(1, Math.min(100, spec.severity));
  const grudge: Grudge = {
    id: `gr_${(w.counters.grudge += 1).toString(36)}`,
    originEvent,
    originYear: w.year,
    ...(originPage ? { originPage } : {}),
    severity,
    inheritance: spec.inheritance,
    // Severe grudges last longer, which is the only sense in which severity is
    // a duration. A slight fades in a generation; a killing does not.
    //
    // THIS COMMENT WAS TRUE OF NOTHING. `decayPerYear` was a flat 0.35 whatever
    // the severity, so the seal feud's own grudge — severity 60,
    // `all_blood`, the most serious thing the content can author — burned out
    // in a hundred and seventy years, about six generations. Measured across
    // six thousand-year runs: LIVE GRUDGES AT 2042, ZERO. OLDEST GRUDGE EVER,
    // ZERO YEARS. In a game whose unit of time is a generation, a feud system
    // holding no feuds is indistinguishable from a working one.
    decayPerYear: GRUDGE_DECAY * (GRUDGE_HALF_SEVERITY / severity),
  };
  rel.grudges.push(grudge);
  return grudge;
}

/** Every grudge anyone currently holds against this person. */
export function grudgesAgainst(w: WorldState, id: string): Grudge[] {
  const out: Grudge[] = [];
  for (const rel of w.relationships.values()) {
    if (rel.to === id) out.push(...rel.grudges);
  }
  return out;
}

/** The worst live grudge held against anyone of the player's house. */
export function grudgeAgainstUs(w: WorldState): number {
  let worst = 0;
  for (const rel of w.relationships.values()) {
    const target = w.people.get(rel.to);
    const theirs = (target?.houseOfOrigin) === w.playerHouse
      || target?.membership.some((m) => m.house === w.playerHouse && m.to === undefined);
    if (!theirs) continue;
    for (const g of rel.grudges) worst = Math.max(worst, g.severity);
  }
  return worst;
}

/**
 * Who takes up his quarrel.
 *
 * Deliberately the same chain `events/arcs.ts` uses for bindings, and for the
 * same reason: in a game whose time unit is a generation, both parties being
 * dead is the NORMAL case, not the edge case. `heir_only` gives up if there is
 * no child, because that is what the policy says; everything else falls
 * through, and only a vanished house ends a feud.
 */
function successorTo(w: WorldState, id: string, mode: Grudge['inheritance']): string | undefined {
  const p = w.people.get(id);
  if (!p) return undefined;

  const byAge = (xs: Person[]) => [...xs].sort((a, b) => a.born - b.born);
  const alive = (xs: Person[]) => xs.filter((x) => x.status === 'alive');

  const heir = () => byAge(alive(w.people.children(p.id)))[0];
  const blood = () => byAge(alive(w.people.siblings(p.id)))[0];
  const house = () => byAge(
    w.people.living().filter((q) => q.houseOfOrigin === p.houseOfOrigin && q.id !== p.id),
  )[0];

  const chain = mode === 'heir_only' ? [heir]
    : mode === 'all_blood' ? [heir, blood]
      : [heir, blood, house];

  for (const step of chain) {
    const found = step();
    if (found) return found.id;
  }
  return undefined;
}

/**
 * Annual upkeep: fade what is fading, and move what is inherited down a
 * generation. Without the re-pointing every relationship in the world is
 * between two corpses within forty years, which reads exactly like a working
 * feud system holding no feuds.
 */
export function tickRelationships(ctx: SimCtx): void {
  const w = ctx.world;
  const dead = (id: string) => {
    const p = w.people.get(id);
    return !p || (p.status !== 'alive' && p.status !== 'guardian');
  };

  for (const [k, rel] of [...w.relationships]) {
    // Sentiment cools toward indifference; grudges are what persist.
    rel.sentiment *= 0.995;
    if (Math.abs(rel.sentiment) < 1) rel.sentiment = 0;

    rel.grudges = rel.grudges.filter((g) => {
      g.severity -= g.decayPerYear;
      return g.severity > 1;
    });

    if (!rel.grudges.length && rel.sentiment === 0) {
      w.relationships.delete(k);
      continue;
    }

    // Re-point either end that has died, per the grudge's own policy. A
    // relationship carrying grudges with different policies keeps the widest.
    const policy = rel.grudges.reduce<Grudge['inheritance']>(
      (widest, g) => (RANK[g.inheritance] > RANK[widest] ? g.inheritance : widest),
      'none',
    );
    if (policy === 'none') {
      if (dead(rel.from) || dead(rel.to)) w.relationships.delete(k);
      continue;
    }

    const from = dead(rel.from) ? successorTo(w, rel.from, policy) : rel.from;
    const to = dead(rel.to) ? successorTo(w, rel.to, policy) : rel.to;

    // A feud with nobody left to hold it is over — for a grudge that is one
    // man's or one bloodline's. A HOUSE-WIDE one is not: it goes dormant and
    // waits, because the party to it is an institution and institutions have
    // thin years. House Marrow with nobody currently minted and alive has not
    // forgiven anybody; it merely has nobody in the room.
    //
    // Deleting it here is why the measured answer to "live grudges at 2042"
    // was zero in every run even after the world started making its own
    // enemies: rival-house people are transient mints, so almost every feud
    // hit a year with no living holder and was quietly ended by this line.
    if (!from || !to || from === to) {
      if (policy === 'house_wide') continue;
      w.relationships.delete(k);
      continue;
    }
    if (from === rel.from && to === rel.to) continue;

    w.relationships.delete(k);
    const moved = upsert(w, from, to);
    moved.sentiment = Math.max(-100, Math.min(100, moved.sentiment + rel.sentiment));
    moved.grudges.push(...rel.grudges);
    for (const kind of rel.kinds) if (!moved.kinds.includes(kind)) moved.kinds.push(kind);
    moved.from = from;
    moved.to = to;
  }

  echoGrudges(ctx);
}

/**
 * A QUARREL, A GENERATION ON (issue #326). The second echo chain whose bill is
 * not Bearing's. A grudge somebody holds against this house is still held
 * twenty-five years after it began; the book notices, once, and links back to
 * the page where it started. The BILL stays with this file: the grudge keeps
 * decaying at its own rate, passes down by its own inheritance policy, and
 * reaches the player through content gated on `grudgeAgainstUs`.
 *
 * It says only what is true that year — the grudge is live when the line is
 * written, or no line is written — and a house that holds several quarrels
 * against this one is heard from once a generation, not once a quarrel.
 */
const GRUDGE_LINE_COUNT = 3;

/** Each literal key and Original is inventoried by the core-message audit. */
function grudgeEchoText(ctx: SimCtx, index: number, house: string, about: string): string {
  const values = { HOUSE: house, ABOUT: about };
  switch (index) {
    case 0:
      return msg(ctx, 'grudge.echo.0', 'At {HOUSE} they had not let go of {ABOUT}.', values);
    case 1:
      return msg(ctx, 'grudge.echo.1',
        '{HOUSE} still told {ABOUT} their own way, and still told it against this house.', values);
    case 2:
      return msg(ctx, 'grudge.echo.2',
        'A guest from {HOUSE} was civil at the table and never once mentioned {ABOUT}, which was how everybody knew.', values);
    default:
      throw new Error(`Unknown grudge echo frame ${index}`);
  }
}

/**
 * Which line, keyed on the generation and the house rather than on a count of
 * earlier echoes: grudges decay and their relationships are deleted, so a
 * count kept on them resets, and the first cut of this repeated one sentence
 * nine times in a Long Line. Stateless, deterministic, and it moves every
 * generation.
 */
function grudgeLineIndex(year: number, house: string, n: number): number {
  let h = 0;
  for (const ch of house) h = (h * 31 + ch.charCodeAt(0)) % 997;
  return (Math.floor(year / ECHO_SPACING) + h) % n;
}

function ours(w: WorldState, id: string): boolean {
  const p = w.people.get(id);
  return p?.houseOfOrigin === w.playerHouse
    || (p?.membership.some((m) => m.house === w.playerHouse && m.to === undefined) ?? false);
}

export function echoGrudges(ctx: SimCtx): number {
  const w = ctx.world;
  const holderHouse = (rel: Relationship) => w.people.get(rel.from)?.houseOfOrigin;
  let written = 0;
  for (const rel of w.relationships.values()) {
    if (!ours(w, rel.to)) continue;
    const house = holderHouse(rel);
    if (!house || house === w.playerHouse) continue;
    for (const g of rel.grudges) {
      if (g.echoed || w.year - g.originYear < ECHO_AFTER) continue;
      g.echoed = true;
      // Once a generation per house holding it, however many quarrels it holds.
      const heard = [...w.relationships.values()]
        .filter((r) => holderHouse(r) === house)
        .flatMap((r) => r.grudges)
        .filter((x) => x.echoedIn !== undefined);
      if (heard.some((x) => w.year - x.echoedIn! < ECHO_SPACING)) continue;
      g.echoedIn = w.year;
      const title = ctx.content.event(g.originEvent)?.title;
      const about = title
        ? msg(ctx, 'grudge.about.event', 'what happened in "{TITLE}"', { TITLE: title })
        : msg(ctx, 'grudge.about.year', 'what the house did in {YEAR}', { YEAR: String(g.originYear) });
      const name = w.houses.get(house)?.name ?? house;
      const line = grudgeLineIndex(w.year, house, GRUDGE_LINE_COUNT);
      w.chronicle.push({
        id: chronicleEntryId(ctx),
        year: w.year,
        weight: 'line',
        text: grudgeEchoText(ctx, line, name, about),
        echoFrame: `grudge:${line}`,
        named: false,
        cause: { year: g.originYear, ...(g.originPage ? { page: g.originPage } : {}) },
      });
      written++;
    }
  }
  return written;
}

const RANK: Record<Grudge['inheritance'], number> = {
  none: 0,
  heir_only: 1,
  all_blood: 2,
  house_wide: 3,
};

/** Whoever hates us most, for casting a rival who has a reason. */
export function bitterestAgainst(w: WorldState, houseId: string): PersonId | undefined {
  let worst: { id: string; severity: number } | undefined;
  for (const rel of w.relationships.values()) {
    const target = w.people.get(rel.to);
    if (!target) continue;
    const theirs = target.membership.some(
      (m) => m.house === houseId && m.to === undefined,
    );
    if (!theirs) continue;
    const holder = w.people.get(rel.from);
    if (!holder || holder.status !== 'alive') continue;
    for (const g of rel.grudges) {
      if (!worst || g.severity > worst.severity) worst = { id: rel.from, severity: g.severity };
    }
  }
  return worst ? asId<PersonId>(worst.id) : undefined;
}


/**
 * THE FEUD INSIDE THE HOUSE.
 *
 * Cadet halls carry `grievance`, and grievance did nothing but reduce a tithe
 * and seed an Age. A hall that has spent forty years being the branch that
 * does not get the physician does not have an accounting adjustment; it has
 * somebody in it who will not sit with the head at a funeral, and whose
 * children are told why.
 *
 * This is where the grudge system finally has a domestic supply. Rival houses
 * quarrel with the seat perhaps nine times in a thousand years (`assize.ts`);
 * the family quarrels with itself constantly, and those are the feuds a
 * generational game is actually for — the ones with the same surname on both
 * ends, which `inheritance: all_blood` was written for.
 *
 * Called from `quarrels`, which draws no dice for it.
 */
export function tickFamilyQuarrels(ctx: SimCtx): Grudge[] {
  const w = ctx.world;
  const made: Grudge[] = [];

  const seat = w.people.household(w.playerHouse, w.year);
  const head = seat.find((p) => p.castSlots.includes('head'));
  if (!head) return made;

  for (const b of w.branches.values()) {
    if (b.extinct !== undefined || b.recalled !== undefined) continue;
    if (b.grievance < GRIEVANCE_QUARREL) continue;

    const speaker = b.speaker ? w.people.get(b.speaker) : undefined;
    if (!speaker || speaker.status !== 'alive' || speaker.id === head.id) continue;

    // One standing quarrel per hall, deepened rather than duplicated. A hall
    // that stays aggrieved gets angrier; it does not get a second grudge every
    // year, which would put four hundred of them in a run.
    const rel = edge(w, speaker.id, head.id);
    const standing = rel?.grudges.find((g) => g.originEvent === 'grievance');
    if (standing) {
      standing.severity = Math.min(100, standing.severity + GRIEVANCE_DEEPENS);
      b.grievance = Math.max(0, b.grievance - GRIEVANCE_DEEPENS);
      continue;
    }

    made.push(addGrudge(
      ctx,
      speaker.id,
      head.id,
      { severity: Math.round(b.grievance * 0.6), inheritance: 'all_blood' },
      'grievance',
    ));
    // THE QUARREL IS THE RELEASE. Grievance becomes a feud rather than sitting
    // on the ledger forever: the hall has said its piece, and what it is owed
    // is now a thing somebody holds against a named man instead of a number
    // that only ever goes up.
    //
    // Without this the hall keeps its grievance AND acquires the grudge, and
    // `branches.slow.test.ts` catches it immediately — long-lived halls that
    // are still content fell from a third to a sixth, which is exactly the
    // "grievance is accumulating, not fading" failure that test was written
    // for.
    b.grievance = Math.max(0, b.grievance - GRIEVANCE_SPENT);
    w.chronicle.push({
      year: w.year,
      weight: 'line',
      text: msg(ctx, 'grudge.hall_quarrel',
          '{SPEAKER} stopped writing to the seat, and told the hall why, and the hall remembered it longer than he did.',
          { SPEAKER: speaker.name }),
      named: false,
    });
  }
  return made;
}

/** The grievance at which a hall stops being merely unhappy. */
const GRIEVANCE_QUARREL = 55;
/** How much a standing quarrel deepens for every further year of it. */
const GRIEVANCE_DEEPENS = 0.5;
/** How much of the hall's grievance is spent in taking the quarrel up. */
const GRIEVANCE_SPENT = 28;
