import type { EventTemplate, Filter, Person, SlotSpec } from '@ed/schema';
import { assertNever, MAIN_BRANCH } from '@ed/schema';
import type { SimCtx } from '../world.js';
import { evalFilter } from './conditions.js';
import { castIn, castPeople, type SlotFill } from './fill.js';

// Where a fill is READ from lives in `fill.ts`, so that `conditions.ts` can
// read one without importing this file back — the relation filter compares a
// candidate against whoever is already cast, parties included.
export { castIn, castPeople, soleCast, type SlotFill } from './fill.js';
import { foremostOf, secondForemostOf } from '../ascension.js';
import type { Rng } from '../rng.js';
import { CHILDBEARING, eligibleToMarry } from '../people/demography.js';
import {
  RELATIONSHIP_THREAD_RECALL_MULTIPLIER, activeRelationshipThreadHouses,
} from '../relationship-threads.js';

/** Weight an explicitly rival cast toward one of the few external names the run is already carrying. */
export function outsiderThreadWeight(
  spec: SlotSpec,
  ctx: SimCtx,
  person: Person,
  active = activeRelationshipThreadHouses(ctx),
): number {
  if (spec.role !== 'rival_house' && spec.role !== 'rival') return 1;
  return active.has(String(person.houseOfOrigin)) ? RELATIONSHIP_THREAD_RECALL_MULTIPLIER : 1;
}

function pickCandidate(spec: SlotSpec, ctx: SimCtx, rng: Rng, people: Person[]): Person | undefined {
  if (spec.role !== 'rival_house' && spec.role !== 'rival') return rng.pick(people);
  const active = activeRelationshipThreadHouses(ctx);
  return rng.weighted(people, (person) => outsiderThreadWeight(spec, ctx, person, active));
}

export interface SlotResolution {
  ok: boolean;
  fill: SlotFill;
  /** Slots the player must cast himself. This is the mission mechanic. */
  playerCast: string[];
  missing?: string;
}

/**
 * If a required slot cannot be filled, the event does not fire. This is the
 * primary reason 400 templates produce different content for different
 * families: a house full of scholars sees a different game to a house full of
 * soldiers.
 */
export function resolveSlots(
  e: EventTemplate,
  ctx: SimCtx,
  rng: Rng,
  preset: SlotFill = {},
): SlotResolution {
  const fill: SlotFill = { ...preset };
  const playerCast: string[] = [];

  const entries = fillOrder(e.slots);

  for (const [sid, spec] of entries) {
    // An empty array is truthy. A preset that names nobody is not a fill.
    if (castIn(fill, sid).length) continue;

    if (spec.castBy === 'player') {
      /**
       * A PARTY THE PLAYER CANNOT FIELD IS A DOCKET THAT NEVER CLEARS.
       *
       * The cast is deferred, so nothing else here would notice that the house
       * has two men for a slot asking three — the event fires, `resolveChoice`
       * refuses every answer the player can give, and the decision sits on
       * `pendingDecisions` blocking the clock (invariant 9) for the rest of the
       * run. So the pool is measured now, for a counted slot, and the event
       * simply does not fire. This is also what makes `gate:slot-fillability`
       * ask the right question about a party the player names: it asks through
       * `resolveSlots(...).ok`, and the answer is now honest for both castBy.
       */
      if (spec.count && candidatesFor(spec, ctx, fill).length < spec.count.min) {
        if (spec.optional) continue;
        return { ok: false, fill, playerCast, missing: sid };
      }
      playerCast.push(sid);
      continue;
    }

    if (spec.count) {
      const party = castParty(sid, spec, ctx, fill, rng);
      if (party.length < spec.count.min) {
        if (spec.optional) continue;
        return { ok: false, fill, playerCast, missing: sid };
      }
      fill[sid] = party;
      continue;
    }

    const candidates = candidatesFor(spec, ctx, fill);
    if (!candidates.length) {
      if (spec.optional) continue;
      return { ok: false, fill, playerCast, missing: sid };
    }
    const chosen = pickCandidate(spec, ctx, rng, candidates);
    if (chosen) fill[sid] = chosen.id;
  }

  return { ok: true, fill, playerCast };
}

/**
 * CASTING A PARTY. Between `min` and `max` distinct people, and the size is
 * rolled BEFORE the pool is consulted so that a house with nine eligible sons
 * and a house with exactly two send parties of the same shape — the levy asks
 * for a number of men and then finds them, rather than taking everyone it can
 * reach. Short of `min`, `resolveSlots` refuses the event outright, which is
 * what makes `gate:slot-fillability` ask whether `min` can be cast rather than
 * whether one person can, without the gate changing a line.
 *
 * Each member is drawn against the pool as it stands with the party so far
 * already in `bound`, so a `relation` filter on the slot narrows within the
 * party as well as against other slots — "not a brother of anyone already
 * going" is a thing an author can now write and have honoured.
 */
function castParty(sid: string, spec: SlotSpec, ctx: SimCtx, bound: SlotFill, rng: Rng): string[] {
  const { min, max } = spec.count!;
  const want = min + rng.int(Math.max(1, max - min + 1));
  const party: string[] = [];
  const working: SlotFill = { ...bound };

  for (let i = 0; i < want; i++) {
    const pool = candidatesFor(spec, ctx, working).filter((p) => !party.includes(p.id));
    if (!pool.length) break;
    const chosen = pickCandidate(spec, ctx, rng, pool);
    if (!chosen) break;
    party.push(chosen.id);
    working[sid] = [...party];
  }
  return party;
}

/**
 * WHAT ORDER SLOTS FILL IN, and why it is not alphabetical.
 *
 * A `relation` filter — "not the same man as HEAD", "a child of MOTHER" —
 * compares its candidate against whoever is already cast in another slot, and
 * `evalFilter` PASSES when that slot is still empty, because a comparison
 * with nobody is not a comparison it can judge. So a filter evaluated before
 * its counterpart is cast does not narrow anything at all.
 *
 * This used to sort alphabetically, with a comment claiming relation filters
 * would therefore see the slots they refer to. They saw them only when the
 * author happened to name them in alphabetical order, and four authored
 * events in the shipped content did not: `CHALLENGER` asking not to be
 * `HEAD`, `PUPIL` asking not to be `TUTOR`, `HEAD` asking not to be `SON`.
 * All four read as constraints and all four were inert — invariant 11's exact
 * shape, invisible without knowing the fill order.
 *
 * Dependency order fixes the constraint rather than the naming. Slots that
 * others point at are filled first; alphabetical order breaks every tie, so
 * resolution stays reproducible. A cycle (`A` not `B`, `B` not `A`) cannot be
 * ordered and falls back to alphabetical for the slots caught in it — one of
 * the two filters is then inert, which is what a cycle means, and
 * `slots/references` fails the build on one.
 */
export function fillOrder(slots: Record<string, SlotSpec>): [string, SlotSpec][] {
  const names = Object.keys(slots).sort((a, b) => a.localeCompare(b));
  const deps = new Map(names.map((n) => [n, relationTargets(slots[n]!).filter((t) => t in slots && t !== n)]));

  const out: [string, SlotSpec][] = [];
  const placed = new Set<string>();

  // Kahn's algorithm, taking ready slots in alphabetical order so the result
  // is a single fixed sequence rather than any valid topological one.
  for (let pass = 0; pass < names.length && placed.size < names.length; pass++) {
    const ready = names.filter((n) => !placed.has(n) && deps.get(n)!.every((d) => placed.has(d)));
    if (!ready.length) break;
    for (const n of ready) { out.push([n, slots[n]!]); placed.add(n); }
  }

  // Whatever a cycle left behind, in alphabetical order.
  for (const n of names) if (!placed.has(n)) out.push([n, slots[n]!]);
  return out;
}

/** Every slot a spec's filters compare against, through `all`/`any`/`not`. */
function relationTargets(spec: SlotSpec): string[] {
  const out: string[] = [];
  const walk = (fs: Filter[]) => {
    for (const f of fs) {
      if ('relation' in f) out.push(f.of);
      else if ('exceeds' in f) out.push(f.exceeds.of);
      else if ('all' in f) walk(f.all);
      else if ('any' in f) walk(f.any);
      else if ('not' in f) walk([f.not]);
    }
  };
  walk(spec.filters);
  return out;
}

/**
 * Blood, in the seat's own hall, THIS year — `matchSubjects`'s own reading
 * (`people/match.ts`), read here rather than through `w.people.blood`, which
 * answers a lineage question ("was this person ever blood of this house")
 * and does not care where they live now. A cadet passes that reading and
 * fails this one, which is the whole point (issue #132).
 */
function currentlyMainHallBlood(w: SimCtx['world'], p: Person, year: number): boolean {
  return p.membership.some((m) =>
    m.house === w.playerHouse && m.kind === 'blood'
    && (m.branch ?? MAIN_BRANCH) === MAIN_BRANCH
    && m.from <= year && (m.to === undefined || m.to > year));
}

export function candidatesFor(spec: SlotSpec, ctx: SimCtx, bound: SlotFill): Person[] {
  const w = ctx.world;
  let pool: Person[];

  switch (spec.role) {
    case 'head':
      pool = w.people.living().filter((p) => p.castSlots.includes('head'));
      break;
    case 'guardian': {
      // Not `living()`. He is not alive, and he is available regardless.
      const g = w.people.guardian();
      pool = g ? [g] : [];
      break;
    }
    case 'retainer':
      pool = w.people.living().filter((p) => p.contract !== undefined);
      break;
    case 'outsider':
    case 'rival_house':
      pool = w.people.living().filter((p) => p.houseOfOrigin !== w.playerHouse);
      break;
    case 'unwoken':
      pool = w.people.household(w.playerHouse, w.year).filter((p) => !p.awakening.awakened);
      break;
    case 'cadet':
      // CURRENT membership only. `some(kind === 'cadet')` also matched a man
      // who founded a branch in 1240 and was called back to hold the house in
      // 1268 — so the head of the family kept turning up in the cadet slot.
      pool = w.people
        .household(w.playerHouse, w.year)
        .filter((p) => p.membership.find((m) => m.to === undefined)?.kind === 'cadet');
      break;
    case 'tutor':
    case 'rival':
    case 'fragile':
    case 'the_match':
      pool = w.people.living().filter((p) => p.castSlots.includes(spec.role));
      break;
    /**
     * THE MAN WHO IS CLIMBING. One person or nobody, and `foremostOf` is the
     * only definition of which — the same reading the cast panel draws and
     * `world.ascension` is measured from, so an event that charges him and a
     * client that names him cannot disagree about who he is.
     */
    case 'foremost': {
      const top = foremostOf(ctx);
      pool = top ? [top.person] : [];
      break;
    }
    /**
     * THE SECOND MAN ON THE LADDER (issue #61, Stage E5). One person or
     * nobody, read off the same ranking `foremost` is, so the two can never
     * name the same man and never disagree about which is which. Empty in
     * every house with fewer than two living expressers, which is most
     * years — an ordinary empty pool.
     */
    case 'second_foremost': {
      const second = secondForemostOf(ctx);
      pool = second ? [second.person] : [];
      break;
    }

    // ── The steward's own year (issue #127) ───────────────────────────────
    // `world.stewardYear` is written once, at the top of the `table` phase,
    // and read here later the same year — empty on every year the steward
    // did not act, which is most of them, and that is an ordinary empty pool
    // like any other optional slot's.
    case 'newly_placed':
      pool = w.people.household(w.playerHouse, w.year).filter((p) => w.stewardYear.placed.includes(p.id));
      break;
    case 'newly_taught':
      pool = w.people.household(w.playerHouse, w.year).filter((p) => w.stewardYear.taught.includes(p.id));
      break;
    case 'set_to_a_book':
      pool = w.people.household(w.playerHouse, w.year).filter((p) => w.stewardYear.opened.includes(p.id));
      break;
    case 'child':
      pool = w.people.household(w.playerHouse, w.year).filter((p) => w.year - p.born < 20);
      break;
    case 'spouse':
      pool = w.people.household(w.playerHouse, w.year).filter((p) => p.marriages.some((m) => !m.to));
      break;

    /**
     * The frame's two figures at the long table (concept §2, issue #13): one
     * is the last of the blood, one is not a person. `listener_blood` is the
     * sitting Head, same pool as `head`. `listener_record` is the guardian —
     * Daveed, after he crosses over — same pool as `guardian`, which is also
     * why a frame event cannot fire before he does: there is nobody yet who
     * is "not a person" for it to seat at the table.
     */
    case 'listener_blood':
      pool = w.people.living().filter((p) => p.castSlots.includes('head'));
      break;
    case 'listener_record': {
      const g = w.people.guardian();
      pool = g ? [g] : [];
      break;
    }

    /**
     * THE FOUNDING BOTTLENECK'S STAGE 2 (issue #132). Two readings of "who,
     * of the blood, could still be married toward an heir" — kept as two
     * roles rather than one filtered by marital status, because the two
     * cases want different scenes and different choices, not one body
     * trying to read either way.
     *
     * Both narrowed to CURRENT main-hall blood, not `w.people.blood`'s
     * lineage-wide reading — a cadet is still of the blood in that sense,
     * but `matchSubjects` deals hands only to the seat's own (the file's own
     * comment: cadet marriages are `autoMarry`'s business), so the priority
     * these two events unlock could not reach a cadet. Measured: it cast one
     * and the house went to market for him for eleven straight years, on a
     * priority nothing downstream could act on, because he had left the main
     * hall six years before the scene ever cast him.
     */
    case 'sole_heir_unwed':
      pool = w.people.household(w.playerHouse, w.year)
        .filter((p) => currentlyMainHallBlood(w, p, w.year) && eligibleToMarry(ctx, p));
      break;
    /**
     * A MAN whose living wife is past `CHILDBEARING`. Deliberately not the
     * symmetric case: a woman past it cannot be helped by ending HER
     * marriage and finding her another, because she is the one the age
     * limit is about, whoever she marries — `rollBirths` gates conception on
     * the MOTHER's age and nothing else, so remarrying a woman past it
     * offers exactly the marriage that cannot answer either, and casting her
     * here would promise a fix that does not exist. A woman still within the
     * window is not this crisis at all, whatever else is wrong with her
     * marriage — `bloodCount` is what gates the event this casts for.
     */
    case 'sole_heir_spent':
      pool = w.people.household(w.playerHouse, w.year)
        .filter((p) => currentlyMainHallBlood(w, p, w.year) && p.sex === 'male')
        .filter((p) => {
          const marriage = p.marriages.find((m) => m.to === undefined);
          if (!marriage) return false;
          const wife = w.people.get(marriage.spouse);
          if (!wife || wife.status !== 'alive') return false;
          const wifeAge = w.year - wife.born;
          return wifeAge < CHILDBEARING.from || wifeAge > CHILDBEARING.to;
        });
      break;

    /**
     * The unnarrowed roles, listed rather than swept into a `default`.
     *
     * All four draw the whole household and let the spec's own filters do the
     * work, which is right for `family_member`, and is a STATED GAP for the
     * other three: `sibling` ignores siblinghood, and `heirloom` and
     * `spellbook` name a thing rather than a person, so casting one gets you
     * an arbitrary relative. No authored content uses any of the three —
     * checked, not assumed — and when one does, the fix is a case here rather
     * than a discovery in a chronicle.
     */
    case 'family_member':
    case 'sibling':
    case 'heirloom':
    case 'spellbook':
      pool = w.people.household(w.playerHouse, w.year);
      break;

    default:
      // A role added to the schema and not given a pool here used to fall
      // through to "everybody", which reads as a working cast and is not one.
      return assertNever(spec.role, 'slot role');
  }

  return pool.filter((p) => spec.filters.every((f) => evalFilter(f, p, ctx, bound, spec.role)));
}

/**
 * Fill the slots the player would have cast, for a run where nobody is asked.
 * Without this a dispatch event resolved in auto mode renders `{SCOUT}` into
 * the chronicle — a raw token, in the artefact the entire game is about.
 */
export function autoCast(
  e: EventTemplate,
  ctx: SimCtx,
  fill: SlotFill,
  playerCast: string[],
  rng: Rng,
): SlotFill {
  if (!playerCast.length) return fill;
  const out: SlotFill = { ...fill };
  for (const sid of playerCast) {
    const spec = e.slots[sid];
    if (!spec) continue;
    if (spec.count) {
      // A party the chronicler assembles is assembled the same way the
      // player's would be, short of `min` included: it casts what it can find
      // rather than refusing, because by here the event has already fired.
      const party = castParty(sid, spec, ctx, out, rng);
      if (party.length) out[sid] = party;
      continue;
    }
    const chosen = pickCandidate(spec, ctx, rng, candidatesFor(spec, ctx, out));
    if (chosen) out[sid] = chosen.id;
  }
  return out;
}

/** Live match count for the editor's slot builder. */
export function matchCount(spec: SlotSpec, ctx: SimCtx): number {
  return candidatesFor(spec, ctx, {}).length;
}

const TOKEN = /\{([A-Z_][A-Z0-9_]*)\}/g;

export function renderBody(body: string, fill: SlotFill, ctx: SimCtx): string {
  return body.replace(TOKEN, (_m, name: string) => {
    const people = castPeople(fill, name, ctx);
    if (!people.length) return `{${name}}`;
    return nameList(people.map((p) => p.epithet ?? p.name));
  });
}

/**
 * "Aldous", "Aldous and Bren", "Aldous, Bren and Corr".
 *
 * A counted slot renders as one token in a sentence, so the join is decided
 * here, once, rather than by every author writing "{A}, {B} and {C}" and
 * finding out what a party of two reads like. No serial comma: the chronicle
 * is one voice and it does not use one anywhere else.
 */
export function nameList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]!}`;
}
