import type { CharacterRole, CharacterTemplate, GenomeRef, Person, Sex } from '@ed/schema';
import { asId, canTemplateFire, frequencyWeight, recordFire } from '@ed/schema';
import type { SimCtx } from '../world.js';
import { hashSeed, makeRng, type Rng } from '../rng.js';
import { makePerson } from './factory.js';
import { uniqueName } from './names.js';
import { applyFriendBlessing, claimFriendName, friendBlessing } from './friends.js';
import { evalCondition } from '../events/conditions.js';
import { findRivalPerson, pickRivalCandidate } from './rivals.js';

/**
 * Minting people from templates.
 *
 * Everyone the world produces after 1042 comes through here — suitors, grooms,
 * rivals, tutors, midwives, wanderers. Before this existed the spawn rules
 * were hardcoded in three different functions, which meant a designer could
 * not add a kind of person without an engineer.
 */

export function eligibleTemplates(ctx: SimCtx, role: CharacterRole): CharacterTemplate[] {
  const w = ctx.world;
  return ctx.content.characterTemplates.filter((t) => {
    if (t.role !== role) return false;
    if (frequencyWeight(t.frequency, w.characterFrequency, w.year, w.generation) <= 0) return false;
    if (!canTemplateFire(t.id, t.frequency, w.characterFrequency)) return false;
    if (t.unique && hasLiving(ctx, t)) return false;
    return evalCondition(t.conditions, ctx);
  });
}

function hasLiving(ctx: SimCtx, t: CharacterTemplate): boolean {
  return ctx.world.people.living().some((p) => p.mintedFrom === t.id);
}

export function pickTemplate(ctx: SimCtx, role: CharacterRole, rng: Rng): CharacterTemplate | undefined {
  const pool = eligibleTemplates(ctx, role);
  const w = ctx.world;
  return rng.weighted(pool, (t) =>
    frequencyWeight(t.frequency, w.characterFrequency, w.year, w.generation) * (t.weight / 100));
}

/**
 * A rolled recipe: everyone this person WOULD be, without anybody existing yet.
 *
 * The Match deals three cards and the player takes one, so two of the three
 * must never enter the world — a suitor the house declined is not a woman who
 * lived somewhere else, she is a letter that was answered no. Splitting the
 * roll from the mint is what makes that honest: `rollRecipe` decides who a
 * card is, `mintRecipe` is the only thing that spawns her, and the person the
 * player gets is the person the card promised rather than a fresh draw that
 * happens to share a title.
 */
export interface MintRecipe {
  template: string;
  house: string;
  sex: Sex;
  age: number;
  name: string;
  seed: number;
  /**
   * This card is wearing one of the player's five names, and is owed what that
   * carries (`friendBlessing`). Carried on the RECIPE rather than re-derived
   * by matching the name at mint time: a friend called Rowan is also a name in
   * `names.ts`'s own pool, and a string match would bless the wrong stranger
   * three centuries later.
   */
  friend?: true;
  /**
   * RIVAL DESCENT (issue #24 item 6). Set when `sex` and `age` were not
   * rolled but read off a living member of this house's own shadow lineage —
   * her `RivalPerson.id`, in `world.rivalLineages`. `mintRecipe` resolves it
   * into a real, already-materialized genome that traces to named rival
   * ancestors through actual meiosis, instead of a fresh draw from the pool.
   */
  rivalId?: string;
}

/**
 * Everything about a minted person that the dice decide, decided — and nothing
 * spawned. The name is reserved here rather than at mint time: two cards dealt
 * in the same year must not be able to be the same woman, and a name promised
 * on a card the house declined is a name that house heard once and will not
 * reuse.
 */
export function rollRecipe(template: CharacterTemplate, ctx: SimCtx, rng: Rng): MintRecipe {
  const w = ctx.world;
  const houseRow = rng.weighted(template.houses, (h) => h.weight) ?? template.houses[0]!;
  const house = w.houses.get(houseRow.house);

  const wantSex: Sex = template.sex === 'any' ? (rng.bool(0.5) ? 'male' : 'female') : template.sex;
  // Drawn UNCONDITIONALLY, whether or not a rival candidate turns out to
  // exist — see the note below on why.
  const rolledAge = Math.round(rng.range(template.ageAtArrival.min, template.ageAtArrival.max));
  const seed = hashSeed(w.seed, 'mint', template.id, w.year, (w.counters.mint += 1));

  /**
   * RIVAL DESCENT (issue #24 item 6). If this house grows its own shadow
   * lineage and somebody in it fits this template's sex and arrival age, she
   * is not rolled — she already exists, with a genome that traces to named
   * ancestors through real meiosis. `template.bias` is deliberately not
   * applied to her: it is the authored intent behind a FRESH draw, and her
   * blood is already a fact rather than an intent.
   *
   * ITS OWN STREAM, keyed off this call's own unique mint seed — never off
   * `rng` above. A die that is sometimes rolled and sometimes not moves every
   * draw after it (the same reason `rolledAge` is always drawn): a house that
   * happens to have a candidate this month must deal a hand identical, draw
   * for draw, to a house that does not — right down to which STRANGERS get
   * minted for every OTHER card dealt this same year.
   */
  const rival = pickRivalCandidate(
    ctx, houseRow.house, wantSex, template.ageAtArrival, makeRng(hashSeed('rivals-pick', seed)),
    String(template.id),
  );

  const sex = rival?.sex ?? wantSex;
  const age = rival ? w.year - rival.born : rolledAge;

  // A rival-house person the family has already met comes back as THEMSELVES,
  // not as a fresh name pasted onto the same hidden genealogy. The current
  // mint counter was still consumed above: deciding whether somebody returns
  // must not make subsequent recipe ids share a seed.
  if (rival?.courtship?.template === String(template.id)) {
    rival.courtship.offered = w.year;
    return {
      template: rival.courtship.template,
      house: houseRow.house,
      sex,
      age,
      name: rival.courtship.name,
      seed: rival.courtship.seed,
      ...(rival.courtship.friend ? { friend: true as const } : {}),
      rivalId: rival.id,
    };
  }

  // The house is where a byname comes from, so it goes IN to `uniqueName`
  // rather than being pasted on afterwards. Appending it afterwards is what
  // produced `Garrick 788 of Calder`: the given name had already fallen
  // through to the numeric branch before anyone said where he was from.
  const place = house ? house.name.replace(/^(House |The )/, '') : undefined;

  // A FRIEND'S NAME, ONCE (see `people/friends.ts`). Taken bare, with no house
  // byname on the end of it: `of Calder` is the world telling two strangers
  // apart, and the entire point of this one name is that the player does not
  // read it as a stranger. Nothing marks it, nothing announces it, and the
  // name is spent whether or not the house ever meets her — a card dealt to
  // the Match and declined has still had its name reserved, and the comment
  // above says why.
  const friend = claimFriendName(w.friends, sex, ctx.takenNames, w.year, rng);
  let name = friend ?? uniqueName(sex, ctx.takenNames, rng, place !== undefined ? { place } : {});
  if (friend === undefined) {
    const wantsHouse = template.naming === 'of_house' && place !== undefined;
    if (wantsHouse && !name.includes(' of ')) name = `${name} of ${place}`;
    if (ctx.takenNames.has(name)) name = uniqueName(sex, ctx.takenNames, rng, { place });
  }
  ctx.takenNames.add(name);

  // A rival person existed before this card did. Remember only what this house
  // learned from meeting them: the public name and the exact recipe promise.
  // They still do not enter PersonStore until a later card is actually taken.
  if (rival) {
    rival.courtship = {
      template: String(template.id),
      name,
      seed,
      offered: w.year,
      ...(friend !== undefined ? { friend: true as const } : {}),
    };
  }

  return {
    template: String(template.id), house: houseRow.house, sex, age, name, seed,
    ...(friend !== undefined ? { friend: true as const } : {}),
    ...(rival ? { rivalId: rival.id } : {}),
  };
}

/**
 * Roll an actual person from a recipe. The genome comes from the drawn house's
 * pool and is LAZY: a suitor costs twelve bytes until somebody marries her, at
 * which point her genome exists and would have been the same genome had it
 * been materialized on the day she was minted.
 */
export function mint(
  template: CharacterTemplate,
  ctx: SimCtx,
  rng: Rng,
  opts: { household?: string; membership?: Person['membership'][number]['kind'] } = {},
): Person {
  return mintRecipe(rollRecipe(template, ctx, rng), template, ctx, opts);
}

/**
 * RIVAL DESCENT, RESOLVED (issue #24 item 6). If the recipe named a living
 * member of this house's shadow lineage, her real, already-materialized
 * genome is used — and she LEAVES the lineage the day she is spent this way,
 * exactly the way a declined Match card must not spawn a person nobody
 * offered: from this moment she is living the player's game, not the
 * lineage's, and does not marry or bear inside it again.
 *
 * `undefined` for an ordinary recipe, or if the lineage moved out from under
 * a stale `rivalId` since it was rolled — which should not happen, but a
 * defensive fallback to the lazy pool draw is cheaper than a crash on a mint.
 */
function rivalGenome(ctx: SimCtx, recipe: MintRecipe): GenomeRef | undefined {
  if (!recipe.rivalId) return undefined;
  const rp = findRivalPerson(ctx, recipe.house, recipe.rivalId);
  if (!rp) return undefined;
  rp.left = ctx.world.year;
  return { kind: 'materialized', genome: rp.genome };
}

// The only place people are spawned. INVARIANT 7: it spends `characterFrequency`.
export function mintRecipe(
  recipe: MintRecipe,
  template: CharacterTemplate,
  ctx: SimCtx,
  opts: { household?: string; membership?: Person['membership'][number]['kind'] } = {},
): Person {
  const w = ctx.world;
  const { sex, age, seed, name } = recipe;
  const houseRow = { house: recipe.house };

  const membership = opts.membership
    ?? (template.role === 'retainer' ? 'retainer'
      : template.role === 'ward' ? 'ward'
        : template.role === 'hostage' ? 'hostage'
          : 'blood');

  const p = makePerson({
    sex,
    born: w.year - age,
    house: houseRow.house,
    name,
    genome: rivalGenome(ctx, recipe) ?? {
      kind: 'lazy',
      pool: houseRow.house,
      seed,
      ...(Object.keys(template.bias).length ? { bias: template.bias } : {}),
    },
    membership,
    seed,
    seq: w,
  });

  // WHAT COMES BACK IS A LITTLE MORE THAN IT SHOULD BE (`friendBlessing`).
  // Off the person's own seed, which is the recipe's seed, so the woman on the
  // card and the woman the house marries are the same woman down to the lift.
  if (recipe.friend) applyFriendBlessing(p, friendBlessing(seed, ctx.genetics.attributes, ctx.genetics.expected));

  p.mintedFrom = template.id;
  p.castSlots = [...template.castSlots];
  for (const t of template.traits) p.traits.add(asId(t));
  for (const book of template.spellsKnown ?? []) p.spellsKnown.push(asId(book));
  // Bound to the HEAD who hired them, not to the house. Binding to the house
  // made `onEmployerDeath` unreachable — the employer could never die — and so
  // no contract in the game had any way to end.
  if (template.contract) {
    const employer = w.people.living().find((q) => q.castSlots.includes('head'));
    // `knowsSecrets` copied too: a shallow spread shares the template's array
    // with every person minted from it, in every world in the process.
    p.contract = {
      ...template.contract,
      knowsSecrets: [...template.contract.knowsSecrets],
      boundTo: (employer?.id) ?? w.playerHouse,
    };
  }

  const household = opts.household
    ?? (template.role === 'retainer' || template.role === 'ward' || template.role === 'hostage'
      ? w.playerHouse
      : houseRow.house);
  p.membership = [{ house: asId(household), kind: membership, from: w.year }];

  w.people.add(p);
  recordFire(template.id, template.frequency, w.characterFrequency, w.year);
  return p;
}

/** Convenience: draw a template for a role and mint it, or return undefined. */
export function mintForRole(
  ctx: SimCtx,
  role: CharacterRole,
  rng: Rng,
  opts: { household?: string; membership?: Person['membership'][number]['kind'] } = {},
): Person | undefined {
  const template = pickTemplate(ctx, role, rng);
  if (!template) return undefined;
  return mint(template, ctx, rng, opts);
}

/**
 * Editor preview: what does this recipe actually produce? Rolls N people and
 * reports the distribution, which is the only honest way to review a template
 * whose most important field is invisible to the player.
 */
export function previewTemplate(
  template: CharacterTemplate,
  ctx: SimCtx,
  n: number,
  rollGenome: (person: Person) => { carriedFont: number; canExpress: boolean },
  rng: Rng,
): {
  sample: { name: string; sex: Sex; age: number; house: string; font: number; canExpress: boolean }[];
  carrierRate: number;
  meanFont: number;
} {
  const sample: { name: string; sex: Sex; age: number; house: string; font: number; canExpress: boolean }[] = [];
  const w = ctx.world;

  /**
   * The counters have to be restored too, and they were not.
   *
   * A preview removed its people and refunded the ration, so it looked clean —
   * but every rolled person had already advanced `counters.person`, and
   * conception seeds derive from parent ids. Previewing twenty-four suitors
   * therefore renamed every child born afterwards and gave them different
   * genomes: the editor's own inspection tool quietly changed the run it was
   * inspecting, and only on the worlds somebody had previewed into.
   */
  const counters = { ...w.counters };

  // AND A RIVAL LINEAGE'S BOOKKEEPING (issue #24 item 6), same reasoning.
  // `mint` can resolve a rival card and mark her `left` — a per-person field
  // set on the object already living in `world.rivalLineages`, not a fresh
  // one, so a shallow copy of each record is enough to undo it: nothing here
  // grows a lineage or touches a genome in place.
  const rivalSnapshot = new Map(
    [...w.rivalLineages.entries()].map(([houseId, l]) => [houseId, { house: l.house, people: l.people.map((p) => ({ ...p })) }]),
  );

  for (let i = 0; i < n; i++) {
    const p = mint(template, ctx, rng);
    const e = rollGenome(p);
    sample.push({
      name: p.name,
      sex: p.sex,
      age: w.year - p.born,
      house: p.houseOfOrigin,
      font: Math.round(e.carriedFont * 10) / 10,
      canExpress: e.canExpress,
    });
    // Preview must not pollute the world OR spend the ration.
    w.people.remove(p.id);
    ctx.takenNames.delete(p.name);
    w.characterFrequency.firedThisRun[template.frequency] -= 1;
    w.characterFrequency.templateFires[template.id] = (w.characterFrequency.templateFires[template.id] ?? 1) - 1;
  }

  Object.assign(w.counters, counters);
  w.rivalLineages = rivalSnapshot;

  const carriers = sample.filter((s) => s.font > 0).length;
  return {
    sample,
    carrierRate: sample.length ? carriers / sample.length : 0,
    meanFont: sample.length ? sample.reduce((a, s) => a + s.font, 0) / sample.length : 0,
  };
}
