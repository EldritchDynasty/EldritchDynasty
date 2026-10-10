import type { Person } from '@ed/schema';
import { MAIN_BRANCH, RUNG_ORDER } from '@ed/schema';
import type { SimCtx } from './world.js';
import { attr, phenotypeOf } from './people/factory.js';
import { branchOf, wouldSpeakFor } from './people/branches.js';
import { grudgesAgainst } from './people/relationships.js';
import { heirApparent } from './people/succession.js';
import { measureAscension } from './ascension.js';
import { msg } from './messages.js';
import { proseForContentField } from './prose.js';

/**
 * WHO THIS GENERATION IS ABOUT (issue #44, and issue #86).
 *
 * By 2042 a run holds about seventy living people across six halls, and there
 * are no faces by design. **A player asked to care about seventy people cares
 * about none of them** — and every beat the design is built on assumes
 * attachment that nothing was manufacturing: the Fragile One, the Vessel,
 * losing the Darkness-affine daughter in 1900.
 *
 * Attachment is a selection problem before it is an art problem, and it has
 * three conditions. NAMED shipped with the bynames and the dynastic ordinals.
 * EXPOSED TO LOSS the simulation has always done correctly. The missing one is
 * ONE DETAIL THAT IS ONLY TRUE OF THEM — something that distinguishes a person
 * from their sibling other than a number — which is what `because` is, and why
 * every line of it is a fact off this year's world rather than colour.
 *
 * Five to seven, not seventy.
 *
 * ─── A ROTA IS NOT A CAST (issue #86) ───────────────────────────────────────
 *
 * The first cut had exactly seven roles for up to seven slots, so every one of
 * them that could be filled was filled, and the panel answered *who is this
 * generation about* with the constitutional offices of a household — the same
 * answer in every house in every century. Measured over four runs: `head` and
 * `heir` in 100% of sampled generations, `married_in` 95%, `aggrieved` 89%,
 * and the multiset of roles at 1200 identical to the one at 1900 in every
 * seed. Four hundred years apart it read as a template with the nouns swapped.
 *
 * So there are more roles than slots now, and **which roles appear is itself
 * the information**. Every candidate carries a SALIENCE — how unusual this
 * fact is, not how senior the person is — and the panel takes the head and
 * then the loudest few. A structural role has to earn its slot: an heir who
 * is simply the next man scores 14 and is crowded out by the hall that is
 * owed forty years of grievance, by the only expresser left alive, by the
 * bondsman whose loyalty is running out. `head` is the one anchor, because
 * somebody answers for the house and the player is deciding for him.
 *
 * The panel is allowed to be SHORT. Some decades are genuinely about three
 * people, and a list that always fills seven slots is a list padding itself.
 *
 * ─── This is also where #24 item 3 gets watched ─────────────────────────────
 *
 * Women hold the font, are usually the only safe people in the house, own the
 * endgame concealment instrument, and are barred from the one thing that wins
 * the game. The structure is coherent and the injustice is the point; the
 * failure mode is a player who reads the male line as the game and the
 * daughters as inventory. The tracker calls that the largest remaining design
 * risk in the genetics, and it is a UI problem rather than a data one. So
 * `carrier` is not a courtesy row on this list: it is the daughter who is
 * carrying the whole thing, named, with what she is carrying said out loud.
 *
 * ─── Derived, recomputed, never stored ──────────────────────────────────────
 *
 * Invariant 6. This is a READING of the household, the way `measureAscension`
 * and `RecordView` are — nothing here is written back. A cast written into the
 * world would be correct for one spring and then quietly wrong for four
 * hundred years, which is exactly what this codebase's worst bugs look like
 * from outside.
 */

export type CastRole =
  /** Who sits, and is answerable for all of it. */
  | 'head'
  /** Who takes the seat the day it falls vacant. The same rule `ensureHead` uses. */
  | 'heir'
  /** The one the blood is going to hurt — or the boy it has not started on yet. */
  | 'at_risk'
  /** The hall with the wound, and the man who speaks for it. */
  | 'aggrieved'
  /** The daughter carrying the line. See #24 item 3, above. */
  | 'carrier'
  /** Who came in from outside and is now holding the family's future. */
  | 'married_in'
  /** The family's answer to "am I winning?" — highest on the ladder. */
  | 'foremost'
  /** The last man who can express a word of it. Lose him and the game is a farm. */
  | 'sole_expresser'
  /** A woman of the blood the house has not got round to spending. */
  | 'unwed'
  /** The man who has been at court since he was nineteen. */
  | 'long_post'
  /** Older than anybody else by a decade, and remembers a house nobody else does. */
  | 'eldest'
  /** Somebody's servant, held by a debt or owed better than the house has paid. */
  | 'bonded'
  /** Whoever has actually read the shelf. */
  | 'scholar'
  /** Widowed, with children still young enough to be somebody's problem. */
  | 'widow'
  /** Somebody set their papers beside the parish roll, and they did not match. */
  | 'papers';

export interface CastMember {
  person: string;
  name: string;
  role: CastRole;
  /**
   * What to print beside the name. The engine's wording rather than the
   * client's: a client with its own per-role dictionary is a hand-written copy
   * of a closed union, and it renders the raw id the day a role is added.
   */
  label: string;
  sex: string;
  age: number;
  hall: string;
  /** The one thing that is true of this person and of nobody else in the house. */
  because: string;
}

/**
 * Every role there is, in tie-break order only — salience decides who is on
 * the list at all. Exported because the tests used to keep their own copy of
 * this union, which is a hand-written copy of a closed list and went stale the
 * moment one was added.
 */
export const CAST_ROLES: CastRole[] = [
  'head', 'heir', 'at_risk', 'carrier', 'aggrieved', 'married_in', 'foremost',
  'sole_expresser', 'unwed', 'long_post', 'eldest', 'bonded', 'scholar', 'widow', 'papers',
];

export const CAST_LABELS: Record<CastRole, string> = {
  head: 'the seal',
  heir: 'the heir',
  at_risk: 'at risk',
  carrier: 'the blood',
  aggrieved: 'the wound',
  married_in: 'married in',
  foremost: 'highest',
  sole_expresser: 'the only one',
  unwed: 'unspent',
  long_post: 'in post',
  eldest: 'the oldest',
  bonded: 'bonded',
  scholar: 'the shelf',
  widow: 'widowed',
  papers: 'the papers',
};

/** Seven is the ceiling this whole reading exists to enforce. */
export const CAST_MAX = 7;

/**
 * How loud a fact has to be to take a slot on its own merits.
 *
 * Below this a candidate is only drawn when the panel would otherwise be
 * thinner than `CAST_MIN` — which is what stops a quiet century printing one
 * name, and stops a loud one printing the org chart underneath the news.
 */
const SALIENCE_FLOOR = 30;

/** Fewer than this and the panel has stopped answering the question. */
const CAST_MIN = 3;

/**
 * A person this year, the reason they are on the list, and how loud it is.
 *
 * `because` is rendered only for the people the panel actually shows (#915):
 * every finder runs every year, and a reason worded for a candidate who was
 * crowded out would ask for a Plain English line nobody reads.
 */
interface Candidate {
  person: Person;
  because: () => string;
  salience: number;
}

/**
 * The first fact that is true, and the sentence for THAT fact.
 *
 * Sentence variety is not decoration here. Three of the old frames differed
 * from each other only by substitution, so the panel read as one sentence with
 * a slot in it; `because` is authored prose in the engine's voice and can
 * afford to know what year it is and who else is in the room.
 */
function first(
  person: Person,
  cases: ([boolean, number, () => string] | undefined)[],
): Candidate | undefined {
  for (const c of cases) {
    if (!c || !c[0]) continue;
    return { person, because: c[2], salience: c[1] };
  }
  return undefined;
}

/** Everything more than one finder needs, computed once. */
interface Read {
  living: Person[];
  head?: Person;
  age: (p: Person) => number;
  font: (p: Person) => number;
  canExpress: (p: Person) => boolean;
  isBlood: (p: Person) => boolean;
  halls: number;
}

function ageOf(ctx: SimCtx, p: Person): number {
  return ctx.world.year - p.born;
}

function isBlood(p: Person, house: string): boolean {
  return p.membership.some((m) => m.house === house && (m.kind === 'blood' || m.kind === 'cadet'));
}

/** How much of it he is carrying that his channel will not pass. */
function strain(ctx: SimCtx, p: Person): number {
  const mind = attr(p, 'mind', ctx.genetics, ctx.world.year);
  return mind > 0 ? p.madness / mind : p.madness;
}

/** Whoever is still married to them, as far as the record goes. */
function isMarried(p: Person): boolean {
  return p.marriages.some((m) => m.to === undefined);
}

/**
 * WHO SITS. The one row that is not competing for its slot, because the player
 * is deciding for him and a panel that could omit him would be a panel that
 * sometimes forgot to say who was answerable.
 */
function head(ctx: SimCtx, r: Read): Candidate | undefined {
  const w = ctx.world;
  if (!r.head) return undefined;
  const since = w.headSince !== undefined && w.headSince <= w.year ? w.headSince : undefined;
  const reign = since === undefined ? undefined : w.year - since;
  const n = r.living.length;
  const N = String(n);
  const SINCE = String(since);
  return first(r.head, [
    [reign === undefined, 100, () => msg(ctx, 'cast.head.holds',
      'holds the seal, and answers for the {N} living of the house.', { N })],
    [reign !== undefined && reign >= 40, 100, () => msg(ctx, 'cast.head.long_reign',
      'has held the seal for {REIGN} years, and has outlived nearly everyone who saw him take it.',
      { REIGN: String(reign) })],
    [reign !== undefined && reign <= 2, 100, () => msg(ctx, 'cast.head.new_reign',
      'took the seal in {SINCE}, and has not yet been obeyed in anything difficult.', { SINCE })],
    [r.halls > 1, 100, () => msg(ctx, 'cast.head.halls',
      'has held the seal since {SINCE}, and answers for {N} living across {HALLS} halls.',
      { SINCE, N, HALLS: String(r.halls) })],
    [true, 100, () => msg(ctx, 'cast.head.since',
      'has held the seal since {SINCE}, and answers for the {N} living of the house.', { SINCE, N })],
  ]);
}

/**
 * WHO IS NEXT — and only when that is news.
 *
 * *Somebody is next* has been true of every household that ever existed, which
 * is exactly why it scored a slot every year and said nothing. The heir earns
 * his row when the succession itself is irregular: a Regency, a cousin in
 * another hall, a man older than the man he is waiting on, a man who cannot
 * express a word of the thing the house is for.
 *
 * Every case here is one `heirApparent` can actually return. The first draft
 * led with *the seal falls to a child*, which reads well and cannot happen:
 * that function takes nobody under sixteen, so the loudest branch on the list
 * was unreachable and the role went quiet for a reason nothing would have
 * reported (invariant 11).
 */
function heir(ctx: SimCtx, r: Read): Candidate | undefined {
  const w = ctx.world;

  // WARDSHIP (issue #91). The seat is not merely about to fall — it already
  // has, and nobody holds it. `heirApparent`'s default floor cannot see the
  // ward (this file's own note above on why "the seal falls to a child" was
  // cut no longer holds once a Wardship stands), so read `world.wardship`
  // directly rather than let this row describe a vacancy that has already
  // happened as one still to come.
  if (w.wardship) {
    const ward = w.people.get(w.wardship.ward);
    if (ward) {
      const AGE = String(r.age(ward));
      const she = ward.sex === 'female';
      const boughtBack = w.wardship.boughtBack;
      return {
        person: ward,
        salience: 90,
        because: () => boughtBack
          ? she
            ? msg(ctx, 'cast.heir.ward_bought.she',
              'is {AGE}, and the Warden holds the estate until she turns sixteen — bought back, though the seat itself still waits.',
              { AGE })
            : msg(ctx, 'cast.heir.ward_bought.he',
              'is {AGE}, and the Warden holds the estate until he turns sixteen — bought back, though the seat itself still waits.',
              { AGE })
          : she
            ? msg(ctx, 'cast.heir.ward.she', 'is {AGE}, and the Warden holds the estate until she turns sixteen.', { AGE })
            : msg(ctx, 'cast.heir.ward.he', 'is {AGE}, and the Warden holds the estate until he turns sixteen.', { AGE }),
      };
    }
  }

  const next = heirApparent(ctx, r.head?.id);
  if (!next) return undefined;
  const age = r.age(next);
  const hall = branchOf(w, next, w.year);
  const hallName = hall === MAIN_BRANCH ? 'the seat' : w.branches.get(hall)?.name ?? hall;
  const ofTheHead = r.head !== undefined
    && (next.trueParents.father === r.head.id || next.trueParents.mother === r.head.id);
  const headAge = r.head ? r.age(r.head) : 0;

  return first(next, [
    // No expressing son anywhere in the house. §22's Ledger keeps counting
    // through a Regency, and nothing else on this panel says one is coming —
    // which is why it outranks a carrier who is already married and does not
    // outrank the last unspent font in the house.
    //
    // It takes a slot only while the seat is ACTUALLY about to fall. A house
    // with no expressing son is in that position in two sampled generations in
    // three, so the bare fact was on the panel 68% of the time and was not
    // telling the player anything about this generation; gated on a head of
    // 58 it was still 56%, which is still most of them. Sixty-six is old for a
    // man of this world, and it is the age at which the prospect is news.
    [next.sex === 'female' && (r.head === undefined || headAge >= 66), 52, () => msg(ctx, 'cast.heir.regency_soon',
      'is what the house has left to inherit, and the man holding it is {HEAD_AGE}: the day it falls to her, it falls into a Regency.',
      { HEAD_AGE: String(headAge) })],
    [hall !== MAIN_BRANCH, 32, () => msg(ctx, 'cast.heir.other_hall',
      'waits for the seat in {HALL}, which is not where the seal is kept.', { HALL: hallName })],
    // A DECADE of it, not a year. An heir a year or two older than the man he
    // is waiting on is an accident of birth order; ten years older is a man
    // who will almost certainly never sit, and that is the news.
    [r.head !== undefined && age >= headAge + 10, 30, () => msg(ctx, 'cast.heir.older',
      'is {AGE}, and is waiting on a man ten years younger than himself.', { AGE: String(age) })],
    [!r.canExpress(next) && r.head !== undefined && r.canExpress(r.head), 26, () => msg(ctx, 'cast.heir.mundane',
      'takes the seat the day it falls vacant, and cannot express a word of it.')],
    [r.head !== undefined && !ofTheHead, 20, () => msg(ctx, 'cast.heir.not_his',
      'takes the seat the day it falls vacant, and is no child of the man who holds it.')],
    [next.sex === 'female', 22, () => msg(ctx, 'cast.heir.regency',
      'is what the house has left to inherit, which makes the next succession a Regency.')],
    [true, 14, () => msg(ctx, 'cast.heir.next', 'takes the seat the day it falls vacant.')],
  ]);
}

/**
 * The one the blood is going to hurt.
 *
 * First the man closest to losing to it, because that is a person with a
 * countdown on him. If nobody in the house is anywhere near it, then the boy
 * of hot blood who has not woken — `attributes.yaml` says it out loud, and it
 * is the design's own Fragile One: *the unwoken son of hot blood is the most
 * fragile person in the house*.
 */
function atRisk(ctx: SimCtx, r: Read): Candidate | undefined {
  const w = ctx.world;
  const expressers = r.living.filter(r.canExpress);

  const worst = [...expressers].sort((a, b) => strain(ctx, b) - strain(ctx, a))[0];
  if (worst && worst.madness >= 3) {
    const mind = Math.round(attr(worst, 'mind', ctx.genetics, w.year));
    const s = strain(ctx, worst);
    const values = { MADNESS: String(Math.round(worst.madness)), MIND: String(mind) };
    const because = () => s >= 0.6
      ? msg(ctx, 'cast.at_risk.straining',
        'carries {MADNESS} of it against a mind of {MIND}, and is running out of room.', values)
      : msg(ctx, 'cast.at_risk.carrying', 'carries {MADNESS} of it against a mind of {MIND}.', values);
    return { person: worst, because, salience: Math.min(66, 26 + s * 70) };
  }

  const fragile = expressers
    .filter((p) => !p.awakening.awakened && r.age(p) < 16)
    .sort((a, b) => a.born - b.born)[0];
  if (fragile) {
    return {
      person: fragile,
      because: () => msg(ctx, 'cast.at_risk.unwoken',
        'has the blood and has not woken to it, and he is {AGE}.', { AGE: String(r.age(fragile)) }),
      salience: 34,
    };
  }
  return undefined;
}

/** The daughter carrying the most of it, and what her being spent would cost. */
function carrier(ctx: SimCtx, r: Read): Candidate | undefined {
  const w = ctx.world;
  const women = r.living
    .filter((p) => p.sex === 'female' && r.isBlood(p) && r.font(p) > 0)
    .sort((a, b) => r.font(b) - r.font(a));
  const her = women[0];
  if (!her) return undefined;

  const only = women.length === 1;
  const next = women[1] ? r.font(women[1]) : 0;
  const clear = next > 0 && r.font(her) >= next * 1.35;
  const age = r.age(her);
  const married = isMarried(her);

  return first(her, [
    [only && !married, 58, () => msg(ctx, 'cast.carrier.only_unspent',
      'carries the only font left in the house, and has not been spent.')],
    [only && married, 48, () => msg(ctx, 'cast.carrier.only_married',
      'carries the only font left in the house, and is already married.')],
    [!married && age >= 24, 40, () => msg(ctx, 'cast.carrier.most_unspent_at',
      'carries more of the blood than any woman living of the house, and is {AGE} and unspent.', { AGE: String(age) })],
    [clear, 34, () => msg(ctx, 'cast.carrier.half_again',
      'carries half again what the next woman of this house carries.')],
    [!married, 20, () => msg(ctx, 'cast.carrier.most_unspent',
      'carries more of the blood than any woman living of the house, and has not been spent yet.')],
    [true, 14, () => msg(ctx, 'cast.carrier.most_married',
      'carries more of the blood than any woman living of the house, and is already married.')],
  ]);
}

/**
 * The hall with the wound, and whoever speaks for it.
 *
 * The floor is the change: any grievance at all used to buy a slot, and a
 * cadet hall acquires one the year it is founded, so the wound was on the
 * panel in nine sampled generations in ten and meant nothing in eight of them.
 */
function aggrieved(ctx: SimCtx, r: Read): Candidate | undefined {
  const w = ctx.world;
  const halls = [...w.branches.values()]
    .filter((b) => b.extinct === undefined && b.grievance >= 24)
    .sort((a, b) => b.grievance - a.grievance);
  for (const b of halls) {
    const speaker = wouldSpeakFor(ctx, b.id);
    if (!speaker) continue;
    const owed = Math.round(b.grievance);
    const salience = Math.min(58, 11 + b.grievance / 2.6);
    const HALL = b.name;
    const OWED = String(owed);
    const heldSeal = b.heldSeal;
    const grievance = b.grievance;
    const because = () => heldSeal !== undefined
      ? msg(ctx, 'cast.aggrieved.held',
        'speaks for {HALL}, which has not held the seal since {SINCE} and is owed {OWED} for it.',
        { HALL, SINCE: String(heldSeal), OWED })
      : grievance >= 60
        ? msg(ctx, 'cast.aggrieved.impatient',
          'speaks for {HALL}, which has never held the seal, and has stopped asking for it politely.', { HALL })
        : msg(ctx, 'cast.aggrieved.owed',
          'speaks for {HALL}, which has never held the seal and is owed {OWED} for it.', { HALL, OWED });
    void r;
    return { person: speaker, because, salience };
  }
  return undefined;
}

/**
 * WHO CAME IN. A wife of another house is not of the blood and is not in any
 * hall of ours by descent — and in a game about a bloodline she is the easiest
 * person in the house to stop seeing, which is the whole argument for putting
 * her on this list.
 *
 * She earns the slot on what came in WITH her: a grudge somebody out there is
 * still keeping, a font this house did not breed, a third of the living, or a
 * marriage that has produced nobody and is being counted.
 */
function marriedIn(ctx: SimCtx, r: Read): Candidate | undefined {
  const w = ctx.world;
  const outsiders = r.living.filter((p) => p.houseOfOrigin !== w.playerHouse && isMarried(p));
  if (!outsiders.length) return undefined;

  const childrenOf = (p: Person) => r.living.filter(
    (q) => q.trueParents.mother === p.id || q.trueParents.father === p.id,
  );

  // THE LOUDEST OF THEM, not the most fertile of them. Picking the woman with
  // the most children and THEN asking what was interesting about her is how
  // the panel ended up naming a wife with four sons and nothing to say, while
  // the one whose old house is still keeping a grudge sat in the same room.
  //
  // Reading the whole room is also why these thresholds are where they are. A
  // house of seventy holds a dozen women who married in, so a fact that is
  // merely uncommon in ONE of them is a certainty in at least one of twelve —
  // measured, "childless after twelve years" put this role on the panel in
  // 93% of sampled generations. What earns the slot has to be unusual for the
  // whole room, not for a person.
  let best: Candidate | undefined;
  for (const p of outsiders) {
    const kids = childrenOf(p).length;
    const def = ctx.content.house(p.houseOfOrigin);
    const HOUSE = () => def
      ? proseForContentField(ctx, 'houses', String(p.houseOfOrigin), 'name', def.name)
      : String(p.houseOfOrigin);
    const wed = p.marriages.find((m) => m.to === undefined);
    const years = wed ? w.year - wed.from : 0;
    const grudged = grudgesAgainst(w, String(p.id)).some((g) => g.severity >= 25);

    const it = first(p, [
      [grudged, 46, () => msg(ctx, 'cast.married_in.grudge',
        'married in from {HOUSE}, and somebody out there is still keeping a grudge about it.', { HOUSE: HOUSE() })],
      // While it is still a LIVE question. A dozen women have married in by
      // 1500 and some of them died childless, so "has given the house nobody"
      // is true of somebody in four sampled generations in five and says
      // nothing; of a woman who is thirty-four and has been married twelve
      // years it is the thing the house is actually worried about.
      [kids === 0 && years >= 12 && r.age(p) <= 40, 34, () => msg(ctx, 'cast.married_in.barren',
        'married in from {HOUSE} {YEARS} years ago, is {AGE}, and has given the house nobody.',
        { HOUSE: HOUSE(), YEARS: String(years), AGE: String(r.age(p)) })],
      [kids * 4 >= r.living.length, 32, () => msg(ctx, 'cast.married_in.share',
        'married in from {HOUSE}, and {KIDS} of the {LIVING} living of this house are hers.',
        { HOUSE: HOUSE(), KIDS: String(kids), LIVING: String(r.living.length) })],
      [r.font(p) > 0, 20, () => msg(ctx, 'cast.married_in.font',
        'married in from {HOUSE}, carrying a font this house did not breed.', { HOUSE: HOUSE() })],
      [kids > 0, 14, () => msg(ctx, 'cast.married_in.kids',
        "married in from {HOUSE}, and {KIDS} of the house's living are hers.", { HOUSE: HOUSE(), KIDS: String(kids) })],
      [true, 12, () => msg(ctx, 'cast.married_in.none_yet',
        'married in from {HOUSE}, and has given the house nobody yet.', { HOUSE: HOUSE() })],
    ]);
    if (it && (!best || it.salience > best.salience)) best = it;
  }
  return best;
}

/** The family's answer to "am I winning?" — and how far up it is worth saying. */
function foremost(ctx: SimCtx, r: Read): Candidate | undefined {
  const w = ctx.world;
  const best = measureAscension(ctx).foremost;
  if (!best) return undefined;
  const p = w.people.get(best.person);
  if (!p) return undefined;
  void r;
  const rung = Math.max(0, RUNG_ORDER.indexOf(best.standing.rung));
  const salience = Math.min(60, 16 + rung * 11 + (best.standing.blocked ? 6 : 0));
  return {
    person: p,
    because: () => best.standing.blocked
      ? msg(ctx, 'cast.foremost.blocked', 'stands highest of anyone, and {BLOCKED}', { BLOCKED: best.standing.blocked })
      : msg(ctx, 'cast.foremost.clear', 'stands highest of anyone the house has, with nothing left in the way.'),
    salience,
  };
}

/**
 * THE LAST ONE. Eldritch Power is X-linked and family-exclusive (invariant 4),
 * so a house down to one living expresser is a house one plague from being a
 * farm with a good name — and nothing else on this panel says so.
 */
function soleExpresser(ctx: SimCtx, r: Read): Candidate | undefined {
  const men = r.living.filter((p) => r.canExpress(p) && r.isBlood(p));
  if (men.length !== 1) return undefined;
  const him = men[0]!;
  const age = r.age(him);
  return {
    person: him,
    because: () => age >= 55
      ? msg(ctx, 'cast.sole_expresser.old',
        'is the only man living of this house who can express a word of it, and he is {AGE}.', { AGE: String(age) })
      : msg(ctx, 'cast.sole_expresser.only', 'is the only man living of this house who can express a word of it.'),
    salience: age >= 55 ? 62 : 50,
  };
}

/** A woman of the blood the house has had years to do something about. */
function unwed(ctx: SimCtx, r: Read): Candidate | undefined {
  const her = r.living
    .filter((p) => p.sex === 'female' && r.isBlood(p) && r.age(p) >= 26 && !p.marriages.length)
    .sort((a, b) => a.born - b.born)[0];
  if (!her) return undefined;
  const age = r.age(her);
  const AGE = String(age);
  const font = r.font(her);
  return first(her, [
    [font > 0 && age >= 34, 44, () => msg(ctx, 'cast.unwed.never_asked',
      'is {AGE}, carries a font, and has never been asked for by anybody.', { AGE })],
    [age >= 34, 34, () => msg(ctx, 'cast.unwed.never_married',
      'is {AGE} and has never been married, and nobody has written down why.', { AGE })],
    [font > 0, 32, () => msg(ctx, 'cast.unwed.unspent',
      'is {AGE}, carries a font, and the house has not spent her.', { AGE })],
    [true, 22, () => msg(ctx, 'cast.unwed.years',
      'is {AGE} and unmarried, which the house has had {YEARS} years to see to.', { AGE, YEARS: String(age - 18) })],
  ]);
}

/**
 * THE MAN WHO HAS BEEN AT COURT SINCE HE WAS NINETEEN.
 *
 * §18's posts are institutions, not menu items (invariant 16), and a place
 * held for a quarter of a century is one of the very few things in this game
 * that accumulates in a person rather than in the treasury.
 */
function longPost(ctx: SimCtx, r: Read): Candidate | undefined {
  const w = ctx.world;
  const held = r.living
    .filter((p) => p.career !== undefined && w.year - p.career.from >= 22)
    .sort((a, b) => (a.career?.from ?? 0) - (b.career?.from ?? 0))[0];
  if (!held?.career) return undefined;
  const years = w.year - held.career.from;
  const id = String(held.career.career);
  const def = ctx.content.career(id);
  const at = held.career.from - held.born;
  return {
    person: held,
    because: () => msg(ctx, 'cast.long_post',
      'has held his place in {POST} since he was {AT}, which is {YEARS} years of it.', {
        POST: def ? proseForContentField(ctx, 'careers', id, 'name', def.name) : id,
        AT: String(at),
        YEARS: String(years),
      }),
    salience: Math.min(44, 17 + (years - 22) / 2),
  };
}

/** Older than anybody else by a decade, and remembers a house nobody else does. */
function eldest(ctx: SimCtx, r: Read): Candidate | undefined {
  const order = [...r.living].sort((a, b) => a.born - b.born);
  const old = order[0];
  if (!old) return undefined;
  const age = r.age(old);
  if (age < 76) return undefined;
  const gap = order[1] ? order[1].born - old.born : age;
  if (gap < 6) return undefined;
  return {
    person: old,
    because: () => msg(ctx, 'cast.eldest',
      'is {AGE}, and older than anyone else in the house by {GAP} years.', { AGE: String(age), GAP: String(gap) }),
    salience: Math.min(48, 22 + (age - 76) + gap / 2),
  };
}

/**
 * SOMEBODY'S SERVANT. A contract binds to a PERSON (invariant 11), and what it
 * says about ending — the bond, the arrears, what they know — is the whole of
 * `people/secrets.ts`'s input. A retainer about to walk out with a Discrepancy
 * in their head is the most consequential person in the house that year and
 * has never once been on this list.
 */
function bonded(ctx: SimCtx, r: Read): Candidate | undefined {
  const w = ctx.world;
  const scored = r.living
    .filter((p) => p.contract !== undefined)
    .map((p) => {
      const c = p.contract!;
      const score = 14
        + (c.debt > 0 ? Math.min(18, c.debt / 12) : 0)
        + Math.max(0, 45 - c.loyalty) / 2.2
        + (c.knowsSecrets.length ? 12 : 0);
      return { p, c, score };
    })
    .sort((a, b) => b.score - a.score || a.p.born - b.p.born);
  const worst = scored[0];
  if (!worst) return undefined;
  const { p, c, score } = worst;
  const salience = Math.min(58, score);
  const ROLE = String(c.role);
  const TERM = String(c.term);
  const SECRETS = String(c.knowsSecrets.length);
  const because = () => c.loyalty < 30 && c.knowsSecrets.length > 0
    ? msg(ctx, 'cast.bonded.owed',
      "has kept this house's {ROLE}'s work and {SECRETS} of its secrets, and is owed better than it has paid.",
      { ROLE, SECRETS })
    : c.loyalty < 30
      ? msg(ctx, 'cast.bonded.unpaid',
        'serves as {ROLE} on {TERM} terms, and has stopped believing the house will pay.', { ROLE, TERM })
      : c.debt > 0
        ? msg(ctx, 'cast.bonded.debt',
          'is bonded to this house for {DEBT} marks and cannot leave over it.', { DEBT: String(Math.round(c.debt)) })
        : c.knowsSecrets.length > 0
          ? msg(ctx, 'cast.bonded.knows',
            'serves as {ROLE}, and knows {SECRETS} things the book does not say.', { ROLE, SECRETS })
          : msg(ctx, 'cast.bonded.wage',
            'serves as {ROLE} on {TERM} terms, for {WAGE} marks a year.',
            { ROLE, TERM, WAGE: String(Math.round(c.wage)) });
  return { person: p, because, salience };
}

/** Whoever has actually read the shelf. */
function scholar(ctx: SimCtx, r: Read): Candidate | undefined {
  const best = [...r.living].sort((a, b) => b.spellsKnown.length - a.spellsKnown.length)[0];
  if (!best || best.spellsKnown.length < 3) return undefined;
  const n = best.spellsKnown.length;
  return {
    person: best,
    because: () => best.sex === 'female'
      ? msg(ctx, 'cast.scholar.threshold',
        'has read {N} of the books in this house, and may only ever read four of the eight ways.', { N: String(n) })
      : msg(ctx, 'cast.scholar.most',
        'has read {N} of the books in this house, which is more than anyone else here has.', { N: String(n) }),
    salience: Math.min(46, 18 + n * 5),
  };
}

/** Widowed, with children still young enough to be somebody's problem. */
function widow(ctx: SimCtx, r: Read): Candidate | undefined {
  const w = ctx.world;
  const candidates = r.living
    .filter((p) => !isMarried(p) && p.marriages.length > 0)
    .map((p) => {
      const last = [...p.marriages].sort((a, b) => (b.to ?? 0) - (a.to ?? 0))[0]!;
      const spouse = w.people.get(last.spouse);
      const kids = r.living.filter(
        (q) => (q.trueParents.mother === p.id || q.trueParents.father === p.id) && r.age(q) < 16,
      );
      return { p, ended: last.to, dead: spouse?.died !== undefined, kids: kids.length };
    })
    .filter((x) => x.dead && x.kids > 0 && x.ended !== undefined)
    .sort((a, b) => b.kids - a.kids);
  const it = candidates[0];
  if (!it) return undefined;
  const values = { YEAR: String(it.ended), KIDS: String(it.kids) };
  return {
    person: it.p,
    because: () => it.kids === 1
      ? msg(ctx, 'cast.widow.child', 'was widowed in {YEAR}, with {KIDS} child under sixteen still to raise.', values)
      : msg(ctx, 'cast.widow.children', 'was widowed in {YEAR}, with {KIDS} children under sixteen still to raise.', values),
    salience: Math.min(46, 28 + it.kids * 5),
  };
}

/**
 * SOMEBODY SET THEIR PAPERS BESIDE THE PARISH ROLL.
 *
 * An exposed document is repudiated rather than deleted (`people/papers.ts`),
 * because the house's problem afterwards is not that it has no pedigree but
 * that everybody has seen the one it used to have. That is a fact about ONE
 * PERSON, and until now it existed only in a table on the desk.
 */
function papers(ctx: SimCtx, r: Read): Candidate | undefined {
  const caught = r.living
    .map((p) => ({ p, doc: p.lineageDocuments.find((d) => d.exposed !== undefined) }))
    .filter((x) => x.doc !== undefined)
    .sort((a, b) => (b.doc!.exposed ?? 0) - (a.doc!.exposed ?? 0))[0];
  if (caught?.doc) {
    const YEAR = String(caught.doc.exposed);
    return {
      person: caught.p,
      because: () => msg(ctx, 'cast.papers.exposed',
        'carries papers somebody set beside the parish roll in {YEAR}, and they did not match.', { YEAR }),
      salience: 50,
    };
  }

  // Not yet caught, and the house knows what it paid for: the forged pedigree
  // is already on the desk (`table.ts`), so naming it here tells the player
  // nothing the house does not know and everything the world does not.
  const standing = r.living
    .map((p) => ({ p, doc: p.lineageDocuments.find((d) => d.forged && d.exposed === undefined) }))
    .filter((x) => x.doc !== undefined)
    .sort((a, b) => (b.doc!.generations ?? 0) - (a.doc!.generations ?? 0))[0];
  if (!standing?.doc) return undefined;
  const doc = standing.doc;
  return {
    person: standing.p,
    because: () => msg(ctx, 'cast.papers.forged',
      'stands on {GENERATIONS} generations of maternal record that {NOTARY} was paid to write.',
      { GENERATIONS: String(doc.generations), NOTARY: doc.notarisedBy }),
    salience: 40,
  };
}

const FINDERS: { role: CastRole; find: (ctx: SimCtx, r: Read) => Candidate | undefined }[] = [
  { role: 'head', find: head },
  { role: 'heir', find: heir },
  { role: 'at_risk', find: atRisk },
  { role: 'carrier', find: carrier },
  { role: 'aggrieved', find: aggrieved },
  { role: 'married_in', find: marriedIn },
  { role: 'foremost', find: foremost },
  { role: 'sole_expresser', find: soleExpresser },
  { role: 'unwed', find: unwed },
  { role: 'long_post', find: longPost },
  { role: 'eldest', find: eldest },
  { role: 'bonded', find: bonded },
  { role: 'scholar', find: scholar },
  { role: 'widow', find: widow },
  { role: 'papers', find: papers },
];

/**
 * Three to seven people, this year, with a reason each.
 *
 * Recomputed on every call and stored nowhere (invariant 6). The head comes
 * first because he is answerable; everybody after him is in order of how
 * unusual their fact is, which is the order a client should draw them in and
 * the order the year is actually about.
 */
export function castOf(ctx: SimCtx): CastMember[] {
  const w = ctx.world;
  const living = w.people.household(w.playerHouse, w.year);
  if (!living.length) return [];

  const r: Read = {
    living,
    head: living.find((p) => p.castSlots.includes('head')),
    age: (p) => ageOf(ctx, p),
    font: (p) => phenotypeOf(p, ctx.genetics, w.year).eldritch.carriedFont,
    canExpress: (p) => phenotypeOf(p, ctx.genetics, w.year).eldritch.canExpress,
    isBlood: (p) => isBlood(p, w.playerHouse),
    halls: new Set(living.map((p) => branchOf(w, p, w.year))).size,
  };

  const found: { role: CastRole; pick: Candidate }[] = [];
  for (const f of FINDERS) {
    const pick = f.find(ctx, r);
    if (pick) found.push({ role: f.role, pick });
  }

  // LOUDEST FIRST, and deterministically: two facts of equal weight are broken
  // by the declared role order and then by id, never by store order.
  found.sort((a, b) => b.pick.salience - a.pick.salience
    || CAST_ROLES.indexOf(a.role) - CAST_ROLES.indexOf(b.role)
    || String(a.pick.person.id).localeCompare(String(b.pick.person.id)));

  // ONE PERSON, ONE ROW. The head is very often the heir's father, the
  // foremost man and the one at risk all at once; a list that showed him four
  // times would be a list of four people again.
  const seen = new Set<string>();
  const out: CastMember[] = [];
  for (const { role, pick } of found) {
    if (seen.has(String(pick.person.id))) continue;
    // A quiet decade is allowed to be about three people; it is not allowed to
    // be about one, and it is never allowed to pad itself out to seven.
    if (pick.salience < SALIENCE_FLOOR && out.length >= CAST_MIN) continue;
    seen.add(String(pick.person.id));
    const branch = branchOf(w, pick.person, w.year);
    out.push({
      person: pick.person.id,
      name: pick.person.name,
      role,
      label: CAST_LABELS[role],
      sex: pick.person.sex,
      age: ageOf(ctx, pick.person),
      hall: branch === MAIN_BRANCH ? 'the seat' : w.branches.get(branch)?.name ?? branch,
      because: pick.because(),
    });
    if (out.length === CAST_MAX) break;
  }
  return out;
}
