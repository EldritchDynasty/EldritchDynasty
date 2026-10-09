import type { Rng } from '../rng.js';

/**
 * Names are load-bearing in this world (concept §3). They are plain, slightly
 * archaic, and deliberately not fantasy-inflected — age is carried by content,
 * not by apostrophes.
 *
 * THE FAILURE THIS MODULE SHIPPED WITH. There were 24 given names per sex, a
 * run mints about eleven hundred people, and the only disambiguator was an
 * ordinal that stopped at the ninth. Everyone after that got
 * `${base} ${rng.int(999)}`. Measured across three thousand-year runs: the
 * first numeric name was born in 1153 — year 111 of 1,000 — and SIXTY-EIGHT
 * PERCENT of every person in the run was called something like `Garrick 788`.
 * Between 34 and 43 people out of eleven hundred had a plain name. The marriage
 * market, which is the most-read screen in the game, was dealing three cards a
 * hand reading `Wystan 507`, `Quenton 879`, `Nevin 573`.
 *
 * Nothing threw. Every test passed. This is the codebase's own failure mode
 * (`CLAUDE.md`, "fails by doing nothing") wearing its plainest costume.
 *
 * Three things fix it, and they are different fixes for different people:
 *
 *   RETIREMENT.  A name is spoken for while its holder lives and for a
 *                generation after. Then it comes back. `retireNames` in
 *                `sim.ts` does this, and it is what keeps the pool from ever
 *                draining: the working set is the living, not the dead.
 *
 *   BYNAMES.     Outside the house, a repeat is disambiguated the way a real
 *                village does it — by where you are from or what you are
 *                known for. `Garrick of Hesk`. `Garrick the lame`.
 *
 *   ORDINALS.    Inside the house, a repeat is DYNASTIC and the ordinal counts
 *                every holder ever, living or dead. `Edric the fourth` is a
 *                claim about three men before him, which is the whole point of
 *                naming a boy Edric. See `NameOrigin.borne`.
 *
 * The numeric branch is gone. `uniqueName` cannot return a digit.
 */
const MALE = [
  'Aldous', 'Bertram', 'Cadmon', 'Doran', 'Edric', 'Fenwick', 'Garrick', 'Halden',
  'Ivor', 'Jarret', 'Kelwin', 'Lorcan', 'Merrick', 'Nevin', 'Osric', 'Perrin',
  'Quenton', 'Roderic', 'Sildon', 'Thorne', 'Ulric', 'Varen', 'Wystan', 'Yardley',
  'Alberic', 'Brannock', 'Cuthard', 'Delwyn', 'Ewart', 'Faramond', 'Gethin', 'Hollis',
  'Ivo', 'Jocelyn', 'Kenric', 'Leofric', 'Mabon', 'Norwell', 'Ordric', 'Pellam',
  'Rowan', 'Sabin', 'Tarrant', 'Uthred', 'Verrick', 'Wulfric', 'Yarrow', 'Aldwin',
];

const FEMALE = [
  'Alys', 'Bethen', 'Corwen', 'Dalia', 'Eilwen', 'Fenna', 'Gwenneth', 'Hesper',
  'Ilsa', 'Jorunn', 'Katrin', 'Lisbeth', 'Maura', 'Nessa', 'Orlaith', 'Perrine',
  'Quilla', 'Rhoswen', 'Sable', 'Tamsin', 'Ursel', 'Verity', 'Wilda', 'Ysolde',
  'Aveline', 'Bryde', 'Cecily', 'Damaris', 'Edlyn', 'Fritha', 'Gisela', 'Honor',
  'Idony', 'Jehane', 'Kerensa', 'Linnet', 'Morwen', 'Nerys', 'Odila', 'Petronel',
  'Rhian', 'Selwyn', 'Thomasin', 'Ulla', 'Vessa', 'Winefred', 'Yfenna', 'Amice',
];

/**
 * Where a person is from, in the mouth of somebody who needs to tell two
 * Garricks apart. Places the content already uses come first — a world that
 * names the same twenty villages is a world, and one that invents a new one
 * every time is a name generator.
 */
const PLACES = [
  'Hesk', 'Calder', 'Ilm', 'Wend', 'Corran', 'Marrow', 'Ashfold', 'Draymoor',
  'the Weir', 'Stonebeck', 'Harrowgate', 'Elmet', 'Barrow End', 'Coldwater',
  'the Fenn', 'Kettlewick', 'Ryeholm', 'Nettlebed', 'Ganderpool', 'Thistledown',
  'Low Aubren', 'the Quarry', 'Sallowmere', 'Pyke', 'Cardenwell',
];

/** What a person is known for, when nobody can remember where they came from. */
const EPITHETS = [
  'the tall', 'the pale', 'the quiet', 'the elder', 'the younger', 'the lame',
  'the red', 'the black', 'the fair', 'the grim', 'the mild', 'the stout',
  'the lean', 'the sour', 'the slow', 'the plain', 'the crooked', 'the left-handed',
  'the deaf', 'the sharp', 'the late', 'the lucky', 'the sullen', 'the ready',
];

/** What a person does, when that is the first thing anyone says about them. */
const TRADES = [
  'the wright', 'the miller', 'the mason', 'the drover', 'the fletcher',
  'the reeve', 'the tanner', 'the smith', 'the carter', 'the shepherd',
  'the cooper', 'the thatcher', 'the ferryman', 'the collier',
];

export function givenName(sex: 'male' | 'female', rng: Rng): string {
  return rng.pick(sex === 'male' ? MALE : FEMALE);
}

/** Fisher-Yates on the stream we were handed. Only ever runs on a collision. */
function shuffled(xs: readonly string[], rng: Rng): string[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Ordinals for the chronicle: "Edric, third of that name". */
export function ordinalSuffix(n: number): string {
  const words = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth'];
  if (words[n - 1]) return words[n - 1]!;
  const lastTwo = n % 100;
  const last = n % 10;
  // Eleven through thirteen always use -th, even in 111, 112 and 113.
  const suffix = lastTwo >= 11 && lastTwo <= 13 ? 'th'
    : last === 1 ? 'st' : last === 2 ? 'nd' : last === 3 ? 'rd' : 'th';
  return `${n}${suffix}`;
}

/**
 * The highest ordinal a name is given. Past this a repeat is settled with a
 * byname instead, because `ordinalSuffix` starts printing digits at ten and a
 * digit in a person's name is the bug this module was rewritten to kill.
 */
export const ORDINAL_CEILING = 9;

/**
 * The given name inside a full one — `Edric the fourth` and `Edric of Hesk`
 * both come back as `Edric`. What `NameOrigin.borne` counts, and what the
 * chronicle means when it says a boy was named for his grandfather.
 */
export function baseName(name: string): string {
  const cut = name.indexOf(' ');
  return cut === -1 ? name : name.slice(0, cut);
}

export interface NameOrigin {
  /**
   * DYNASTIC NAMING. Given a base name, how many people of this house have
   * ever borne it — living or dead. When this is present a repeat becomes an
   * ordinal instead of a byname, because inside the house a name is a claim on
   * the people who held it before. `Edric the fourth` is a sentence about
   * three dead men.
   */
  borne?: (base: string) => number;
  /**
   * Where this person is from. Tried as the first byname, so a house's people
   * sound like they come from somewhere rather than from a list.
   */
  place?: string;
}

/**
 * A name nobody living is using. Never a digit, never a collision, and never
 * unbounded: with retirement the working set is the living household, so the
 * plain given name is free most of the time.
 */
export function uniqueName(
  sex: 'male' | 'female',
  taken: Set<string>,
  rng: Rng,
  origin: NameOrigin = {},
): string {
  const base = givenName(sex, rng);

  if (origin.borne) {
    // Inside the house the count is of everyone who ever held it, so the
    // ordinal survives the holder's death and means what the chronicle says.
    //
    // It stops at the ninth, and so does the family. Over a thousand years a
    // popular name reaches fifteen or twenty holders, and `Hesper the 19th` is
    // not something anybody has ever called a person — past the ninth the
    // house does what everyone else does and reaches for a byname.
    for (let n = origin.borne(base) + 1; n <= ORDINAL_CEILING; n++) {
      const candidate = n === 1 ? base : `${base} the ${ordinalSuffix(n)}`;
      if (!taken.has(candidate)) return candidate;
    }
  } else if (!taken.has(base)) {
    return base;
  }

  // Outside it, a repeat is settled the way a village settles it.
  const byOrigin = origin.place ? [`of ${origin.place}`] : [];
  // Shuffled WITHIN each group and concatenated, not shuffled across them.
  // Where you are from is the first thing anyone reaches for, what you are
  // like is the second, and what you do for a living is what is left when a
  // house has run through two dozen of each — which is a commoner's problem,
  // not a daughter of the house's.
  const pool = [
    ...shuffled(PLACES.map((p) => `of ${p}`), rng),
    ...shuffled(EPITHETS, rng),
    ...shuffled(TRADES, rng),
  ];
  for (const by of [...byOrigin, ...pool]) {
    const candidate = `${base} ${by}`;
    if (!taken.has(candidate)) return candidate;
  }

  // Every byname of this given name is spoken for. Number the fullest form
  // rather than the bare one — `Garrick of Hesk the second` is a person, and
  // `Garrick 788` is a database key.
  const stem = `${base} ${byOrigin[0] ?? EPITHETS[0]}`;
  for (let n = 2; ; n++) {
    const candidate = `${stem} the ${ordinalSuffix(n)}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * How long a name stays spoken for after its holder dies. A generation: long
 * enough that nobody alive is confused, short enough that the pool never
 * drains and a great-grandson can be named for the man in the portrait.
 *
 * This constant is the whole reason `uniqueName` never has to reach for the
 * ordinal fallback. The working set is the living household and one generation
 * of the remembered dead — about seventy names against a pool of forty-eight
 * given names crossed with sixty-three bynames.
 */
export const NAME_MOURNING_YEARS = 30;

/**
 * Release the names of the long dead back into the world.
 *
 * Called once a year from `lifecycle`. Takes plain rows rather than `Person`
 * so this module stays free of the simulation — it is a list of words and the
 * rules for choosing between them, and it should be testable with two strings
 * and a set.
 *
 * The living check is not defensive. Once a name can be reused, a dead
 * Garrick's name may already be on a living Garrick by the time the mourning
 * window closes on a SECOND dead Garrick, and deleting it then would hand the
 * living one's name out a third time. Two people in one hall with one name is
 * the failure `takenNames` exists to prevent.
 */
export function retireNames(
  taken: Set<string>,
  people: Iterable<{ name: string; died?: number; alive: boolean }>,
  year: number,
): string[] {
  const living = new Set<string>();
  const releasing: string[] = [];
  for (const p of people) {
    if (p.alive) living.add(p.name);
    else if (p.died !== undefined && year - p.died === NAME_MOURNING_YEARS) releasing.push(p.name);
  }
  const freed: string[] = [];
  for (const name of releasing) {
    if (living.has(name)) continue;
    if (taken.delete(name)) freed.push(name);
  }
  return freed;
}
