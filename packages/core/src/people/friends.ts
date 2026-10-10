import type { AttributeDef, Person, Sex, Year } from '@ed/schema';
import { makeRng, type Rng } from '../rng.js';
import { CAMPAIGN_YEARS } from '../campaign.js';
import { msg } from '../messages.js';
import type { SimCtx } from '../world.js';

/**
 * THE FIVE NAMES THE PLAYER GAVE AT THE SIGNING.
 *
 * At the prologue the player is asked for five people they could not have done
 * without, and what sex each of them is. Those names then come back — a
 * midwife in 1094, a rival's second son in 1248 — once each, and never again.
 *
 * It is the one place in the game where something outside the fiction is
 * carried into it, and the fiction is built to hold exactly that: the thing at
 * the table asked for names it could wear, and the family has spent centuries
 * not agreeing about why the same handful keeps turning up. The names
 * arrive with no fanfare and nothing points at them. A player who does not
 * notice has lost nothing; a player who does gets the only jolt this game can
 * deliver that no amount of authored prose can.
 *
 * ─── The rules, and why each one is where it is ─────────────────────────────
 *
 * ONCE EACH. `spentIn` is the year the name was handed out, and a name with a
 * year on it is never offered again. That is what makes the fifth arrival mean
 * something: the player learns, somewhere around the third, that the supply is
 * finite.
 *
 * SAME SEX. A friend's name goes on a person of the friend's sex, because the
 * point is recognition and this world's given names are strongly sexed.
 *
 * ONE THROUGH THE FIRST HALF. The bare coin paces them badly: a run produces
 * about two new people a year, so ten percent empties a five-name bag almost
 * at once and the rest of the campaign never sees one. `dealWindows` deals
 * each name a band of `FRIEND_SPAN_YEARS / n` and a random year inside it, and
 * a name is not in the bag until its year arrives. The coin is unchanged and
 * still decides WHO — it simply cannot reach a name that is not yet due.
 *
 * NO DICE WHEN THERE IS NOTHING TO WIN. `claimFriendName` returns before it
 * touches the stream when no name of that sex is free — the user's "at least
 * while there are unused names of that gender available", and also the reason
 * a world nobody founded is bit-for-bit the world it was before this file
 * existed. The harness, the digest, every gate and every test bootstrap with
 * an empty roster and draw exactly the numbers they drew yesterday. Rolling
 * the coin first and discarding it would have been one line shorter and would
 * have moved every number in the game.
 *
 * SPENT IS SPENT, EVEN ON A CARD NOBODY TOOK. A suitor dealt to the Match and
 * declined has already had her name reserved (`rollRecipe`, and the comment
 * there says why). A friend's name spent that way is spent: the house heard it
 * once. The one exception is a newborn the player renames — see
 * `releaseFriendName`, and `renameChild`, which is the player saying no to the
 * suggestion rather than the world using the name up.
 */
export interface FriendName {
  /** As the player typed it, trimmed. Not run through `uniqueName` — it is theirs. */
  name: string;
  sex: Sex;
  /**
   * The first year this name may be handed out. See `dealWindows`: the five
   * are dealt one to a band across the campaign's first half, so they arrive
   * spread out instead of all inside the founder's grandchildren's lifetimes.
   */
  dueFrom: Year;
  /** The year it was handed to somebody. Absent while it is still in the bag. */
  spentIn?: Year;
}

/** How many the signing asks for. */
export const MAX_FRIENDS = 5;

/** A given name is a word, not a sentence. */
export const FRIEND_NAME_MAX = 32;

/**
 * How often a new person of the right sex arrives wearing one, while any are
 * left. The user's number, and it is the right shape: over a run that mints
 * hundreds of people, ten percent empties a five-name bag long before the
 * collection unless the names themselves are held back.
 */
export const FRIEND_NAME_CHANCE = 0.1;

/**
 * How long the five are spread over. It is HALF THE CAMPAIGN, not a magic
 * number: #133 halved A Long Line, so keeping the old 500-year window would
 * erase the deliberately empty second half and put the last name at collection.
 *
 * The second half is deliberately empty. A name that could still arrive on
 * the last night is a coin that never stops being flipped, and the fifth
 * arrival stops meaning anything — the bag has to be seen to run out while
 * the player is still counting.
 */
export const FRIEND_SPAN_YEARS = CAMPAIGN_YEARS / 2;

/** How many core attributes a friend's name lifts. */
export const FRIEND_BLESSING_ATTRS = { min: 1, max: 2 };

/**
 * How far it lifts them, as a fraction of that attribute's population mean.
 *
 * A FRACTION OF `expected`, NEVER A CONSTANT — invariant 10. A flat "+6" is a
 * number that silently stops meaning anything the next time `gen-loci.mjs`
 * changes how many loci an attribute has. Measured against a played household,
 * this is worth about +3 to +12 points: real on Mind, whose living spread runs
 * about 8 to 25, and a nudge on Strength, whose spread runs 16 to 68.
 */
export const FRIEND_BLESSING_LIFT = { min: 0.10, max: 0.40 };

/**
 * Take a friend's name for somebody arriving now, or don't.
 *
 * Returns `undefined` — having drawn NOTHING from `rng` — when the bag holds
 * no free name of this sex whose year has come. See the header: that is what keeps every unfounded
 * run identical to the run it was before this existed.
 *
 * `taken` is consulted rather than trusted to be empty: a friend called Edric
 * cannot be handed out while a living Edric holds the name, and a name we
 * cannot use is a name that has not been spent.
 */
export function claimFriendName(
  friends: FriendName[],
  sex: Sex,
  taken: Set<string>,
  year: Year,
  rng: Rng,
): string | undefined {
  const free = friends.filter((f) => f.sex === sex
    && f.spentIn === undefined
    && f.dueFrom <= year
    && !taken.has(f.name));
  if (!free.length) return undefined;
  if (!rng.bool(FRIEND_NAME_CHANCE)) return undefined;

  const chosen = free[rng.int(free.length)]!;
  chosen.spentIn = year;
  taken.add(chosen.name);
  return chosen.name;
}

/**
 * Put a name back in the bag, if this is the year it came out of it.
 *
 * Only `renameChild` calls this, and only for a newborn whose suggested name
 * the player has just overwritten. The player did not use the name — the
 * chronicler offered it and was told no — and spending one of five on an offer
 * that was refused is the kind of quiet loss this repo's whole test suite
 * exists to catch.
 *
 * THE YEAR IS THE GUARD, and it is not belt and braces. A player's friend may
 * perfectly well be called Rowan or Alys, which are also names in `names.ts`'s
 * own pool. Spend such a name in 1050, bury its holder, let `retireNames`
 * release it thirty years later, and `uniqueName` can hand the same word to a
 * newborn in 1200 knowing nothing about any of this. Renaming THAT child
 * un-spends a friend who arrived a hundred and fifty years ago, and the name
 * goes out a second time — one arrival becoming two, which is the one promise
 * this feature makes. Matching on the year says what the sentence above says:
 * this name was taken out of the bag for the child in front of you.
 */
export function releaseFriendName(friends: FriendName[], name: string, year: Year): boolean {
  const held = friends.find((f) => f.name === name && f.spentIn === year);
  if (!held) return false;
  delete held.spentIn;
  return true;
}

/**
 * What the player typed, made into a roster.
 *
 * Trimmed, emptied of blanks, capped at five, and deduplicated case-blind:
 * two friends called Sam is a roster whose second Sam can never be handed out
 * — `taken` holds the name after the first — which is a five-name bag that
 * silently holds four. Rejecting it at the door is the difference between a
 * rule and a shrug.
 */
export function normaliseFriends(
  ctx: SimCtx,
  input: readonly { name: string; sex: Sex }[],
  /**
   * The founding year, which every name starts due in. `dealWindows` then
   * spreads them; a roster that is never dealt is one where all five are due
   * at once, which is the behaviour this function had before the span existed
   * and is what a hand-built test wants.
   */
  foundedIn: Year,
): { ok: true; friends: FriendName[] } | { ok: false; reason: string } {
  const out: FriendName[] = [];
  const seen = new Set<string>();
  for (const row of input) {
    const name = row.name.trim().replace(/\s+/g, ' ');
    if (!name) continue;
    if (name.length > FRIEND_NAME_MAX) {
      return { ok: false, reason: msg(ctx, 'friends.refuse.too_long', "'{NAME}' is longer than a name", { NAME: name }) };
    }
    if (row.sex !== 'male' && row.sex !== 'female') {
      return { ok: false, reason: msg(ctx, 'friends.refuse.sex', '{NAME} needs to be one or the other', { NAME: name }) };
    }
    const key = name.toLowerCase();
    if (seen.has(key)) {
      return { ok: false, reason: msg(ctx, 'friends.refuse.duplicate', 'two of them are called {NAME}', { NAME: name }) };
    }
    seen.add(key);
    out.push({ name, sex: row.sex, dueFrom: foundedIn });
  }
  if (out.length > MAX_FRIENDS) {
    return { ok: false, reason: msg(ctx, 'friends.refuse.too_many', 'five names, not {COUNT}', { COUNT: String(out.length) }) };
  }
  return { ok: true, friends: out };
}

/**
 * Deal each name a band and a year inside it.
 *
 * With five names and the current 250-year half-campaign span, each gets a
 * fifty-year band. With fewer names the bands widen, but the total window is
 * still the campaign's first half: the promise is a finite handful that runs
 * out while there is still a great deal of game left, not a fixed cadence.
 *
 * THE ORDER IS SHUFFLED FIRST. Dealing bands in the order the boxes were typed
 * makes the first name on the screen the first name to arrive in every run of
 * every game, which is a pattern a player finds in one afternoon and cannot
 * unsee. It is also the only draw this function makes.
 *
 * Mutates in place and returns the same array, because the roster it is dealing
 * to is the one the world is about to keep.
 */
export function dealWindows(friends: FriendName[], foundedIn: Year, rng: Rng): FriendName[] {
  if (!friends.length) return friends;

  const order = friends.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [order[i], order[j]] = [order[j]!, order[i]!];
  }

  const band = FRIEND_SPAN_YEARS / friends.length;
  for (const [slot, which] of order.entries()) {
    friends[which]!.dueFrom = foundedIn + Math.floor(band * (slot + rng.range(0, 1)));
  }
  return friends;
}

/**
 * WHAT A FRIEND'S NAME IS WORTH, and why it is worth anything at all.
 *
 * The thing at the table asked for five names and has been sending them back
 * ever since, and what comes back is a little more than it should be — one or
 * two core attributes lifted, on a person who is otherwise an ordinary draw
 * from an ordinary house. Nothing announces it. The player meets a midwife
 * called by their friend's name who happens to be the sharpest woman in the
 * county, and is left to decide whether that means anything.
 *
 * ONLY `core`. The pool is read off the content's own `kind`, so a seventh core
 * attribute is in it the day somebody adds the row — invariant 10's rule, which
 * is the whole reason this does not carry a list of six strings. Affinities are
 * left alone: those are what a person has read, and no name gets anybody into
 * the Library.
 *
 * DERIVED FROM A SEED, NOT STORED. The grants are a pure function of the
 * person's own seed, so `renameChild` can hand back exactly what it granted
 * without a second field on `Person` recording it — see the call in `sim.ts`.
 * The alternative is storage that has to reach the save format and cannot
 * disagree with the acquired layer, to remember a number this recomputes in
 * four lines.
 */
export function friendBlessing(
  seed: number,
  attributes: readonly AttributeDef[],
  expected: ReadonlyMap<string, number>,
): { attr: string; delta: number }[] {
  const pool = attributes.filter((a) => a.kind === 'core').map((a) => a.id);
  if (!pool.length) return [];

  const rng = makeRng(seed);
  const wanted = Math.min(
    pool.length,
    FRIEND_BLESSING_ATTRS.min
      + rng.int(FRIEND_BLESSING_ATTRS.max - FRIEND_BLESSING_ATTRS.min + 1),
  );

  const remaining = [...pool];
  const grants: { attr: string; delta: number }[] = [];
  for (let i = 0; i < wanted; i++) {
    const attr = remaining.splice(rng.int(remaining.length), 1)[0]!;
    const lift = rng.range(FRIEND_BLESSING_LIFT.min, FRIEND_BLESSING_LIFT.max);
    const delta = (expected.get(attr) ?? 0) * lift;
    if (delta > 0) grants.push({ attr, delta });
  }
  return grants;
}

/**
 * Put the blessing on somebody, or take it back off (`sign: -1`).
 *
 * INTO THE ACQUIRED LAYER, never the phenotype cache — invariant 6. A write
 * into the cache looks like it worked and is gone the next time the year moves,
 * which is this codebase's own failure mode wearing its plainest costume.
 */
export function applyFriendBlessing(
  p: Person,
  grants: readonly { attr: string; delta: number }[],
  sign: 1 | -1 = 1,
): void {
  for (const g of grants) {
    p.acquired[g.attr] = (p.acquired[g.attr] ?? 0) + sign * g.delta;
  }
  if (grants.length && p.phenotype) p.phenotype.dirty = true;
}
