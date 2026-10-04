import type {
  AttributeDef, GenePool, Genome, GenomeRef, MembershipKind, Person, PersonId, Sex, TraitDef, Year,
} from '@ed/schema';
import { asId } from '@ed/schema';
import { makeRng, hashSeed, conceptionSeed, type Rng } from '../rng.js';
import type { LocusTable } from '../genetics/loci.js';
import { applyBias, conceive, meiosis, randomGenome } from '../genetics/meiosis.js';
import { ELDRITCH_GIFT, ELDRITCH_REACH, deleteriousLoad, eldritch, expressAttributes, withGift } from '../genetics/expression.js';
import { deriveMaxAge, deriveVitality, type Range } from './vitality.js';
import { uniqueName } from './names.js';
import { applyFriendBlessing, claimFriendName, friendBlessing, type FriendName } from './friends.js';

/** Annual condition owns these acquired contributions without erasing authored effects. */
export const ACQUIRED_NUTRITION = 'condition:nutrition';
export const ACQUIRED_SPACING = 'condition:spacing';

export interface GeneticsCtx {
  table: LocusTable;
  attributes: AttributeDef[];
  traits: TraitDef[];
  pools: Map<string, GenePool>;
  runSeed: number;
  /**
   * Population means, computed from the locus table at bootstrap. Anything
   * mapping an attribute onto a real quantity centres on these rather than on
   * a constant that stops being true when the loci are retuned.
   */
  expected: Map<string, number>;
  /**
   * The ceiling `ascension.ts` normalises the ladder against, computed from
   * the table at bootstrap for the same reason `expected` is. See
   * `maxPowerOf`.
   */
  maxPower: number;
}

/**
 * Id allocation is per-WORLD, not per-module. A module-level counter is shared
 * by every simulation in the process, so the same seed produces different
 * people depending on what else has run — and since conception seeds are
 * derived from parent ids, that divergence reaches all the way into genomes.
 */
export interface IdSeq { counters: { person: number } }

export function nextPersonId(seq: IdSeq, prefix = 'p'): PersonId {
  seq.counters.person += 1;
  return asId<PersonId>(`${prefix}_${seq.counters.person.toString(36)}`);
}

/**
 * Lazy genome materialization. A shade servant costs 12 bytes until the day she
 * bears a child, at which point her genome exists, is consistent with her
 * house's pool, and would have been the same genome had she been materialized
 * on day one.
 */
export function materialize(ref: GenomeRef, sex: Sex, ctx: GeneticsCtx): Genome {
  if (ref.kind === 'materialized') return ref.genome;
  const rng = makeRng(ref.seed);
  const genome = randomGenome(ctx.table, ctx.pools.get(ref.pool), sex, rng);
  // The template's authored intent, applied to the body it was authored for.
  // Drawn from the same seeded stream, immediately after the genome it
  // modifies, so a person materialized on the day they arrive and the same
  // person materialized four centuries later are still one person.
  if (ref.bias) applyBias(genome, ref.bias, ctx.table, rng);
  return genome;
}

export function genomeOf(p: Person, ctx: GeneticsCtx): Genome {
  if (p.genome.kind === 'lazy') {
    p.genome = { kind: 'materialized', genome: materialize(p.genome, p.sex, ctx) };
  }
  return p.genome.genome;
}

// INVARIANT 6: derived state is not storage. Recomputed whenever the year moves.
export function phenotypeOf(p: Person, ctx: GeneticsCtx, year: Year) {
  if (p.phenotype && !p.phenotype.dirty && p.phenotype.computedAtYear === year) return p.phenotype;
  const g = genomeOf(p, ctx);
  const attrs = expressAttributes(g, p.sex, ctx.table, ctx.attributes, { awakened: p.awakening.awakened });

  // Genome first, then everything life did to them. The acquired layer has to
  // be re-applied on every recompute — it is not part of the derivation.
  for (const [key, delta] of Object.entries(p.acquired ?? {})) {
    attrs.set(key, (attrs.get(key) ?? 0) + delta);
  }

  // Then what is true of the body as it stands this year: health, and the
  // fertility that falls out of it. Last, because they read the two layers
  // above — and recomputed like everything else here, because a body's
  // condition at fifty is not a fact about the body it was at twenty.
  applyVitality(p, attrs, g, ctx, year);

  p.phenotype = {
    attrs,
    // The acquired layer reaches the blood too, and by exactly two doors: the
    // Vessel rite hands a man blood (§22), and the Great Rite widens what he
    // can hold of it. `withGift` cannot create an expresser through either —
    // invariant 1's gate is computed from the genome inside `eldritch` and is
    // not touched by anything in the acquired layer.
    eldritch: withGift(
      eldritch(g, p.sex, ctx.table),
      p.acquired?.[ELDRITCH_GIFT] ?? 0,
      p.acquired?.[ELDRITCH_REACH] ?? 0,
    ),
    computedAtYear: year,
    dirty: false,
  };
  return p.phenotype;
}

export function attr(p: Person, key: string, ctx: GeneticsCtx, year: Year): number {
  return phenotypeOf(p, ctx, year).attrs.get(key) ?? 0;
}

/**
 * The derived attributes. Two of them, and the engine knows both by name —
 * unlike the polygenic list, which is open and which the engine never counts.
 * A derived attribute is a rule about bodies rather than a bag of loci, and a
 * rule needs a formula somewhere.
 */
function applyVitality(
  p: Person,
  attrs: Map<string, number>,
  g: Genome,
  ctx: GeneticsCtx,
  year: Year,
): void {
  // The ceiling first: both age curves divide by it, so it has to exist
  // before either of them is computed. The acquired layer feeds it, which is
  // how a portion of agelessness lengthens one life without touching what
  // that person's children inherit.
  const maxAge = deriveMaxAge(
    attrs.get('longevity') ?? 0,
    ctx.expected.get('longevity') ?? 0,
    p.acquired?.max_age ?? 0,
  );
  attrs.set('max_age', maxAge);

  const v = deriveVitality(
    {
      sex: p.sex,
      age: year - p.born,
      maxAge,
      strength: attrs.get('strength') ?? 0,
      strengthMean: sexMean(ctx, 'strength', p.sex),
      fecundity: attrs.get('fecundity') ?? 0,
      fecundityMean: ctx.expected.get('fecundity') ?? 0,
      madness: p.madness,
      mind: attrs.get('mind') ?? 0,
      curses: deleteriousLoad(g, ctx.table).count,
      acquiredHealth: (p.acquired?.health ?? 0) + (p.acquired?.[ACQUIRED_NUTRITION] ?? 0),
      acquiredFertility: (p.acquired?.fertility ?? 0) + (p.acquired?.[ACQUIRED_SPACING] ?? 0),
    },
    { health: rangeOf(ctx, 'health'), fertility: rangeOf(ctx, 'fertility') },
  );
  attrs.set('health', v.health);
  attrs.set('fertility', v.fertility);
}

function defOf(ctx: GeneticsCtx, key: string): AttributeDef | undefined {
  return ctx.attributes.find((a) => a.id === key);
}

/** The range the CONTENT declares, the same one `expressAttributes` clamps to. */
function rangeOf(ctx: GeneticsCtx, key: string): Range {
  return defOf(ctx, key)?.range ?? { min: 0, max: 100 };
}

/**
 * The population mean of an attribute FOR ONE SEX: the locus-table mean, plus
 * the half of the dimorphism that sex is given. Anything comparing a person to
 * "average" has to pick which average, and for a dimorphic attribute picking
 * the wrong one applies the dimorphism a second time, in a system that never
 * mentions it.
 */
function sexMean(ctx: GeneticsCtx, key: string, sex: Sex): number {
  const base = ctx.expected.get(key) ?? 0;
  const dimorphism = defOf(ctx, key)?.dimorphism ?? 0;
  return base + (sex === 'male' ? 1 : -1) * dimorphism / 2;
}

export function makePerson(init: {
  sex: Sex;
  born: Year;
  house: string;
  name: string;
  epithet?: string;
  genome: GenomeRef;
  membership?: Person['membership'][number]['kind'];
  mother?: PersonId;
  father?: PersonId;
  tier?: Person['tier'];
  seed: number;
  /** The world whose id sequence this person is drawn from. */
  seq: IdSeq;
}): Person {
  return {
    id: nextPersonId(init.seq),
    name: init.name,
    epithet: init.epithet,
    sex: init.sex,
    sigilSeed: init.seed,
    houseOfOrigin: asId(init.house),
    born: init.born,
    status: 'alive',
    trueParents: { mother: init.mother, father: init.father },
    claimedParents: { mother: init.mother, father: init.father },
    lineageDocuments: [],
    genome: init.genome,
    traits: new Set(),
    awakening: { awakened: false, forced: false, declaredMundane: false },
    spellsKnown: [],
    membership: [{ house: asId(init.house), kind: init.membership ?? 'blood', from: init.born }],
    marriages: [],
    madness: 0,
    rites: [],
    acquired: {},
    taught: [],
    castSlots: [],
    tier: init.tier ?? 'hot',
  };
}

export interface BirthResult {
  child?: Person;
  stillborn: boolean;
  reason?: string;
}

/**
 * DESCENT, APPLIED RATHER THAN DEFAULTED (issue #42). `makePerson` defaults a
 * fresh membership to `blood` when nothing else is passed — right for a
 * founder, wrong for a newborn, which is not a root of the line but a leaf on
 * it. A child is of the house's blood iff AT LEAST ONE true parent already
 * carries a `blood` record there; matrilineal descent counts, the same as
 * `PersonStore.blood` reads it everywhere else. Neither parent carrying one
 * means the household raised this child without the line running through it
 * — a retainer's child, the same bucket `kind: 'retainer'` already names.
 *
 * This is the general form of the check `phases.ts` used to make by hand,
 * for exactly one shape of it: both parents under contract. That was too
 * narrow. A retainer mother and a father who married into the house from
 * elsewhere — himself not of THIS house's blood — passed the old check (it
 * only asked about `.contract`, and he had none) and their child inherited
 * `blood` by the untouched default. Measured: four of twenty-four played
 * runs had their line replaced this way, twice for centuries, and the
 * ending named for a line ending never once fired for it.
 */
function descentKind(mother: Person, father: Person, household: string): MembershipKind {
  const isBloodHere = (p: Person) => p.membership.some((m) => m.house === household && m.kind === 'blood');
  return isBloodHere(mother) || isBloodHere(father) ? 'blood' : 'retainer';
}

/**
 * Conception and birth. Everything the design asks for falls out of one pass
 * of meiosis run twice — including the fact that a hot line loses sons and
 * keeps daughters, which pushes a family toward Regency exactly when it is
 * closest to ascending.
 */
export function conceiveChild(
  mother: Person,
  father: Person,
  ordinal: number,
  year: Year,
  ctx: GeneticsCtx,
  takenNames: Set<string>,
  /**
   * How many people of this house have ever borne a given name — the dynastic
   * ordinal. See `NameOrigin.borne`. Absent in the tests that build a birth by
   * hand, which then get the plain given name.
   */
  borneInHouse: ((base: string) => number) | undefined,
  /**
   * The household the couple lives in. Children belong to it, not to either
   * parent's house of origin — which makes a matrilineal match (a groom who
   * joins his wife's house) work without a special case, and makes a daughter
   * married outward take her children with her without one either.
   */
  household: string,
  seq: IdSeq,
  /**
   * THE FIVE NAMES (`people/friends.ts`). Optional, and trailing, because the
   * two hand-built births in `rites.test.ts` want a child and not a roster —
   * and because an empty bag draws no dice, so passing nothing is passing the
   * behaviour this function had before the signing asked the question.
   */
  opts: { friends?: FriendName[] } = {},
): BirthResult {
  const kind = descentKind(mother, father, household);
  const rng = makeRng(conceptionSeed(ctx.runSeed, String(mother.id), String(father.id), ordinal));

  const mg = genomeOf(mother, ctx);
  const fg = genomeOf(father, ctx);
  const motherGamete = meiosis(mg, ctx.table, 'female', rng, year);
  const fatherGamete = meiosis(fg, ctx.table, 'male', rng, year);
  const { genome, sex } = conceive(motherGamete, fatherGamete, ctx.table);

  // Deleterious homozygosity kills either sex.
  const load = countLethal(genome, ctx.table);
  if (load > 0 && rng.bool(Math.min(0.75, 0.28 * load))) {
    return { stillborn: true, reason: 'the blood ran too close' };
  }

  // Overflow in the womb is a MALE outcome: a daughter's second copy of the
  // blood modulates what a son's single copy cannot. The sex ratio bends
  // against the player under exactly the conditions the player worked hardest
  // to create, and the coin flip was never touched.
  const profile = eldritch(genome, sex, ctx.table);
  if (profile.canExpress && profile.overflowMadness > 0) {
    const risk = Math.min(0.55, profile.overflowMadness / 90);
    if (rng.bool(risk)) return { stillborn: true, reason: 'pressure with no vessel' };
  }

  // DYNASTIC. A child of the house is named for somebody, and the ordinal
  // counts every holder ever — `Edric the fourth` is a sentence about three
  // dead men. Outside the house `uniqueName` reaches for a byname instead.
  //
  // Unless one of the five arrives instead. A newborn's name is only ever a
  // SUGGESTION — `renameChild` is the player overruling the chronicler — so
  // this is the one place a friend's name can be handed back: see
  // `releaseFriendName`.
  const friendName = claimFriendName(opts.friends ?? [], sex, takenNames, year, rng);
  const name = friendName ?? uniqueName(sex, takenNames, rng, { borne: borneInHouse });
  takenNames.add(name);

  const child = makePerson({
    sex,
    house: household,
    born: year,
    name,
    genome: { kind: 'materialized', genome },
    mother: mother.id,
    father: father.id,
    membership: kind,
    seq,
    seed: hashSeed(ctx.runSeed, String(mother.id), String(father.id), ordinal),
  });
  child.madness = 0;

  // WHAT COMES BACK IS A LITTLE MORE THAN IT SHOULD BE. Derived from the
  // child's own sigil seed rather than from `rng`, so `renameChild` can take
  // back exactly what was given when the player refuses the name — and so this
  // draws nothing from the conception stream, which every birth in the game
  // shares.
  if (friendName !== undefined) {
    applyFriendBlessing(child, friendBlessing(child.sigilSeed, ctx.attributes, ctx.expected));
  }
  return { child, stillborn: false };
}

function countLethal(g: Genome, table: LocusTable): number {
  let n = 0;
  for (let i = 0; i < table.autosomal.length; i++) {
    if (table.autosomal[i]!.kind !== 'deleterious') continue;
    if (g.autosomal[0][i] !== g.autosomal[1][i]) continue;
    const allele = table.autosomalAlleles[i]![g.autosomal[0][i]!];
    if (allele?.tags.includes('lethal_homozygous')) n += 1;
  }
  return n;
}

function recordAwakening(p: Person, year: Year, forced: boolean): boolean {
  if (p.awakening.awakened) return false;
  p.awakening = {
    awakened: true,
    year,
    age: year - p.born,
    forced,
    declaredMundane: false,
  };
  if (p.phenotype) p.phenotype.dirty = true;
  return true;
}

/**
 * Force the historical Awakening transition without rolling its natural clock.
 *
 * Eligibility is deliberately NOT decided here. Event effects first establish
 * that the target actually carries a font; this function owns only the public
 * forced path. Natural and forced Awakening share `recordAwakening`, so the
 * state shape and phenotype invalidation cannot drift apart.
 *
 * Reapplying it is a no-op: the first Awakening is history.
 */
export function forceAwakening(p: Person, year: Year): boolean {
  return recordAwakening(p, year, true);
}

/**
 * Awakening. Timing is driven by carried font in BOTH sexes, even though only
 * one of them will ever use it — which makes an early-waking daughter the one
 * honest signal in a market built on forged documents.
 *
 * ── THE GATE IS `carriedFont`, NOT `canExpress`, AND THAT IS THE DESIGN ────
 *
 * Roughly six awakenings in ten happen to women, and it looks like an
 * invariant-4 violation until you read §11, which asks for it in as many
 * words: *"In daughters, Awakening is timed by what they carry rather than by
 * what they can use. An early-waking girl is therefore the one honest signal
 * in a marriage market otherwise built entirely on forged documents —
 * unfakeable, publicly witnessed, and worth more than any notarised pedigree.
 * The great houses have all noticed that it works. None of them have a word
 * for why."*
 *
 * So `awakened` does not mean *the Power manifested in this person*. It means
 * **the family found out what is in this person's blood** — which is why
 * `declaredMundane` is its counterpart on the same record, and why the market
 * reads it (`match.ts`) rather than reading a number nobody has.
 *
 * Nothing leaks. `eldritch()` is still the one gate: an awakened woman has
 * `canExpress: false`, `expressedPower: 0`, and accrues no Madness on any
 * path — §10's *"the risk was never hers"*, enforced by an unentered branch
 * rather than a clamp. What changes for her is what §11 says changes: she
 * reads, and she carries.
 *
 * What was wrong was never this gate but the client, which drew one mark for
 * both and so said the opposite of §7. `MemberView.expresses` is the fix, and
 * `expression.slow.test.ts` fails the build if somebody narrows this to
 * `canExpress` on the strength of the ratio alone (issue #78).
 */
export function rollAwakening(p: Person, year: Year, ctx: GeneticsCtx, rng: Rng): boolean {
  if (p.awakening.awakened || p.awakening.declaredMundane) return false;
  const age = year - p.born;
  if (age < 2) return false;

  const font = phenotypeOf(p, ctx, year).eldritch.carriedFont;
  if (font <= 0) return false;

  // Higher carried font skews earlier and widens the tail.
  const peak = Math.max(6, 22 - font * 0.55);
  const spread = 7 + font * 0.2;
  const density = Math.exp(-((age - peak) ** 2) / (2 * spread ** 2));
  const chance = density * (0.03 + font * 0.004);
  if (rng.bool(chance)) return recordAwakening(p, year, false);
  return false;
}

/**
 * HOW LONG IT TAKES THE BLOOD TO RUIN A MAN, in years of full overflow.
 *
 * The accrual was written inline as `/ 40` and nothing in §22 asks for that
 * number; §22 fixes the FLOOR — a Hierophant carries 20, a Demigod 60, a God
 * 90 — and says nothing at all about the pace. So the pace is a measurable
 * thing rather than canon, and it was measured when the ladder stalled one
 * gate under Hierophant on exactly that floor.
 *
 * IT IS THE WRONG LEVER, and this is the number that says so. Halving it,
 * over eight played thousand-year runs with nothing else changed:
 *
 *     40 -> mean Madness 1.53 among living expressers, 14 men dead carrying
 *           more than 20 of it, and the ladder tops out at Adept in 8 of 8
 *     20 -> mean 2.94, 28 dead, and the ladder tops out at Adept in 8 of 8,
 *           stopped by the same men on the same person-years
 *
 * Twice the ruin and not one rung, because the men at the gate have no
 * overflow to accelerate: Madness from the blood is `font - ceiling` and
 * power is `min(font, ceiling)`, so the man who has fifty of the one has
 * none of the other by construction. What is missing is not a faster clock;
 * it is that nothing in the game asks anything of him — which is what his own
 * gate text has been saying all along. See `docs/BALANCE-LOG.md`.
 */
export const MADNESS_OVERFLOW_YEARS = 40;

/** Involuntary Madness accrual. Reads canExpress and nothing else. */
// INVARIANT 1: canExpress is the only Madness gate.
export function accrueMadness(p: Person, ctx: GeneticsCtx, year: Year): number {
  const profile = phenotypeOf(p, ctx, year).eldritch;
  if (!profile.canExpress) return 0;
  const delta = profile.overflowMadness / MADNESS_OVERFLOW_YEARS;
  p.madness += delta;
  return delta;
}
