import { chooseGenerationQuestion } from './generation.js';
/**
 * BOOTSTRAP AND THE PLAYER'S VERBS.
 *
 * What a year DOES lives in `year/phases.ts`; how a population moves lives in
 * `people/demography.ts`. This file builds the world, puts the founding cast in
 * it, and holds the handful of things the player does directly to a person.
 */
import type { CampaignId, Content, ContentBundle, GenePool, LibraryRun, Person, SeedPerson } from '@ed/schema';
import { asId, indexContent } from '@ed/schema';
import { buildLocusTable } from './genetics/loci.js';
import { applyBias, conceive, meiosis, randomGenome } from './genetics/meiosis.js';
import { genomeOf, makePerson, phenotypeOf, type GeneticsCtx } from './people/factory.js';
import { maxPowerOf } from './ascension.js';
import { expectedAttribute, mintShareByHouse } from './genetics/expression.js';
import { createWorld, type SimCtx, type WorldState } from './world.js';
import { conceptionSeed, hashSeed, makeRng, type Rng } from './rng.js';
import { autoMarry } from './people/demography.js';
import { branchOf } from './people/branches.js';
import { applyFriendBlessing, friendBlessing, releaseFriendName } from './people/friends.js';
import { grantOpeningClause } from './ages/scheduler.js';
import { grantHeirloom } from './people/heirlooms.js';
import { acquireLibraryCopy } from './people/library.js';
import { pedigreeF, realizedHomozygosityOf, visibleRecordView } from './record.js';
import { seedLibraryMemories } from './run-library.js';

export function makeGeneticsCtx(content: Content, seed: number): GeneticsCtx {
  const pools = new Map<string, GenePool>();
  for (const h of content.houses) pools.set(h.id, h.genePool);
  const table = buildLocusTable(content.loci);
  // Issue #113: the centre must be computed at the frequencies the world is
  // actually drawn at, house by house, not at the single authored `allele.p`
  // every locus used to be read at regardless of who was being born.
  const poolMix = mintShareByHouse(content);
  return {
    table,
    attributes: content.attributes,
    traits: content.traits,
    pools,
    runSeed: seed,
    // The range is passed because the centre must describe the population the
    // CLAMP produces, not the one the loci would produce if bodies had no
    // bounds (issue #26). Without it every family reads as above average the
    // moment a one-sided locus group pushes the distribution onto a bound.
    expected: new Map(content.attributes.map(
      (a) => [String(a.id), expectedAttribute(table, String(a.id), a.range, poolMix)],
    )),
    maxPower: maxPowerOf(table),
  };
}

/**
 * Build a world and put the founding cast in it.
 *
 * Takes either the raw bundle or an already-indexed `Content` — tests hand over
 * whatever they loaded, the harness indexes once and reuses it across a
 * thousand runs.
 */
export function bootstrap(
  source: ContentBundle | Content,
  seed = 1042,
  startYear = 1042,
  campaign: CampaignId = 'long',
  libraryRuns: readonly LibraryRun[] = [],
): SimCtx {
  const content = indexContent(source);
  const world = createWorld(content, seed, startYear, campaign);
  const genetics = makeGeneticsCtx(content, seed);
  const ctx: SimCtx = { world, content, genetics, takenNames: new Set() };

  const byKey = new Map<string, Person>();
  const ordered = orderSeeds(content.characters);
  const conceptionOrdinals = seedConceptionOrdinals(content.characters);

  for (const s of ordered) {
    const mother = s.motherKey ? byKey.get(s.motherKey) : undefined;
    const father = s.fatherKey ? byKey.get(s.fatherKey) : undefined;

    // A seed that names both parents must be conceived from those exact
    // parents. `orderSeeds` intentionally falls back instead of hanging when
    // the parent graph is malformed or cyclic; without this guard that fallback
    // would silently recreate #344 by rolling an unrelated genome.
    if (s.motherKey && s.fatherKey && (!mother || !father)) {
      const missing = [
        !mother ? `mother ${s.motherKey}` : undefined,
        !father ? `father ${s.fatherKey}` : undefined,
      ].filter(Boolean).join(' and ');
      throw new Error(`seed child ${s.key} could not resolve ${missing}`);
    }

    let rng: Rng;
    let genome: ReturnType<typeof randomGenome>;
    if (mother && father) {
      // A seed child is a child, not a second unrelated draw from the same
      // house pool. Use the same conception stream and meiosis path as every
      // later birth (invariant 8), with the authored sex selecting the
      // father's X or Y rather than rejection-rolling until it happens.
      const ordinal = conceptionOrdinals.get(s.key) ?? 1;
      rng = makeRng(conceptionSeed(seed, String(mother.id), String(father.id), ordinal));
      const motherGenome = genomeOf(mother, genetics);
      const fatherGenome = genomeOf(father, genetics);
      // A two-parent seed bias is an authored tendency INSIDE inheritance, not
      // permission to rewrite a recombinant gamete. It only leans the normal
      // per-chromosome choice of parental haplotype; crossovers and mutations
      // remain the same meiosis mechanics used by every later child.
      const motherGamete = meiosis(
        motherGenome, genetics.table, 'female', rng, s.born, undefined, s.bias,
      );
      const fatherGamete = meiosis(
        fatherGenome, genetics.table, 'male', rng, s.born, s.sex, s.bias,
      );

      const conceived = conceive(motherGamete, fatherGamete, genetics.table);
      if (conceived.sex !== s.sex) {
        throw new Error(`seed child ${s.key} was conceived ${conceived.sex}, authored ${s.sex}`);
      }
      genome = conceived.genome;
    } else {
      rng = makeRng(hashSeed(seed, 'seed-person', s.key));
      const pool = genetics.pools.get(s.house);
      genome = randomGenome(genetics.table, pool, s.sex, rng);
      biasSeedPerson(genome, s, genetics, rng);
    }

    // Born of one house, living in another. A wife of House Ilm who has
    // married into The Eldritch House is a daughter of Ilm AND a member of the
    // Gearithy household, and the two facts are stored separately because they
    // are two different facts: one decides her genome, one decides who feeds her.
    const attached = s.household
      ?? (s.membership === 'blood' || s.membership === 'cadet' || s.membership === 'none'
        ? s.house
        : world.playerHouse);

    const p = makePerson({
      sex: s.sex,
      born: s.born,
      house: s.house,
      name: s.name,
      epithet: s.epithet,
      genome: { kind: 'materialized', genome },
      membership: s.membership,
      seed: hashSeed(seed, s.key),
      seq: world,
    });
    p.membership = [{ house: asId(attached), kind: s.membership, from: s.born }];
    p.castSlots = [...s.castSlots];
    if (s.isHead) {
      p.castSlots.push('head');
      // AND THE CLOCK ON HIS REIGN STARTS. `headSince` was set by `ensureHead`
      // and by nothing else, so the FOUNDER's reign never had a start: he held
      // the seal for forty years and `world.headSince` stayed undefined, which
      // made `tickBranches`'s long-reign pressure unreachable for the first
      // generation of every run and left the cast reading (issue #44) with
      // nothing to say about the only man on it who was there in 1042.
      world.headSince = world.year;
      // AND HE GOES INTO THE LINE (issue #56). Same gap, one field over:
      // `succession` is written by `ensureHead`, which never runs for the
      // founder, so the record of who has held the seal began with his
      // successor and the man who signed the thing in 1042 was not in it.
      world.succession.push({ person: p.id, name: p.name, from: world.year });
    }
    if (s.becomesGuardian) p.becomesGuardian = true;
    // COPIED, not referenced. The content bundle is shared by every world in
    // the process — the harness runs thousands — and a contract is now mutable
    // state: `driftLoyalty` moves `loyalty` every year (`people/secrets.ts`).
    // Handing the seed character the authored object made one run's arrears
    // the next run's starting loyalty, which `year.test.ts` catches as two
    // identical seeds diverging (INVARIANT 8: determinism is per-world).
    if (s.contract) p.contract = { ...s.contract, knowsSecrets: [...s.contract.knowsSecrets] };
    for (const t of s.traits) p.traits.add(asId(t));
    if ((s.house !== world.playerHouse)) p.tier = 'hot';

    world.people.add(p);
    ctx.takenNames.add(p.name);
    byKey.set(s.key, p);
  }

  // Second pass: parentage and marriages, now that everyone exists.
  for (const s of ordered) {
    const p = byKey.get(s.key)!;
    world.people.setParents(p.id, {
      mother: s.motherKey ? byKey.get(s.motherKey)?.id : undefined,
      father: s.fatherKey ? byKey.get(s.fatherKey)?.id : undefined,
    });
    p.claimedParents = { ...p.trueParents };
  }
  autoMarry(ctx, makeRng(hashSeed(seed, 'bootstrap-marriages')));

  const founder = [...byKey.values()].find((p) => p.becomesGuardian);
  world.narrator = founder ? founder.id : undefined;

  // "The player begins knowing one" (concept §18).
  grantOpeningClause(ctx);

  // What the house already holds. The third thing given in 1042 was the
  // keeping — that the house stands "so long as the family held what it had
  // been given that night, and held it in a hand that could be shown" — and
  // until now nothing put any of it in the family's hands. `world.heirlooms`
  // started empty in every run, which is why `seal_the_regalia_incomplete`
  // could count two of three against a house that owned none of them.
  const home = content.houses.find((h) => h.id === world.playerHouse);
  for (const id of home?.heirlooms ?? []) grantHeirloom(ctx, id);
  // And what it has been reading. See `HouseDefS.library` — the shelf used to
  // be empty for two centuries, which put the ladder's book gate and its blood
  // gate in different centuries of the same run.
  for (const id of home?.library ?? []) acquireLibraryCopy(ctx, id);

  world.chronicle.push({
    year: startYear,
    weight: 'illuminated',
    title: 'A Debt of Three Parts',
    text: `In the year 1042 ${founder?.name ?? 'the head of the house'} signed something, `
      + 'and the house has been paying for it ever since.',
    named: true,
  });

  // Issue #70. Read once, after the ordinary founding state exists, and never
  // again. An empty library returns before constructing an RNG, so today's
  // bootstrap sequence is untouched.
  seedLibraryMemories(ctx, libraryRuns);

  // The founder never passes through ensureHead, so open his generation here
  // after the whole founding household and shelf exist.
  const firstReign = world.succession[0];
  if (firstReign) firstReign.question = chooseGenerationQuestion(ctx);

  return ctx;
}

/**
 * Runtime conceptions number a mother's children by birth order
 * (`world.people.children(mother.id).length + 1`). Seed children need the
 * same stable ordinal without changing `orderSeeds`, whose order also fixes
 * ids and therefore many other deterministic streams. A change of father does
 * not restart the runtime count, so it must not restart this one either.
 */
function seedConceptionOrdinals(seeds: SeedPerson[]): Map<string, number> {
  const byMother = new Map<string, SeedPerson[]>();
  for (const s of seeds) {
    if (!s.motherKey) continue;
    byMother.set(s.motherKey, [...(byMother.get(s.motherKey) ?? []), s]);
  }

  const ordinals = new Map<string, number>();
  for (const children of byMother.values()) {
    // Runtime births use `world.people.children(mother.id).length + 1`, so
    // remarriage does NOT restart the conception ordinal. One-parent seeded
    // children count too: once bootstrap has set parentage they are children
    // of this mother just as surely as the two-parent seeds conceived here.
    children
      .sort((a, b) => a.born - b.born || a.key.localeCompare(b.key))
      .forEach((s, index) => ordinals.set(s.key, index + 1));
  }
  return ordinals;
}

function orderSeeds(seeds: SeedPerson[]): SeedPerson[] {
  const out: SeedPerson[] = [];
  const placed = new Set<string>();
  let remaining = [...seeds];
  let guard = 0;
  while (remaining.length && guard++ < 50) {
    const ready = remaining.filter(
      (s) => (!s.motherKey || placed.has(s.motherKey)) && (!s.fatherKey || placed.has(s.fatherKey)),
    );
    if (!ready.length) { out.push(...remaining); break; }
    for (const s of ready) { out.push(s); placed.add(s.key); }
    remaining = remaining.filter((s) => !placed.has(s.key));
  }
  return out;
}

/**
 * Bias for a seed person whose genome is rolled from a house pool rather than
 * conceived from two named parents. Two-parent seed children pass their bias
 * into normal meiosis, where it can lean the chromosome-start haplotype but
 * cannot invent an allele or splice around a crossover.
 *
 * The generic rule itself lives in `genetics/meiosis.ts` because minted
 * character templates carry the same field.
 */
function biasSeedPerson(genome: ReturnType<typeof randomGenome>, s: SeedPerson, ctx: GeneticsCtx, rng: Rng): void {
  applyBias(genome, s.bias, ctx.table, rng);
}

/**
 * NAMING THE CHILDREN.
 *
 * Every newborn of the player's household is given a generated name so nothing
 * downstream can hold a nameless person, and is queued for the player to
 * rename. Naming is one of the few things the player does directly to an
 * individual rather than to the bloodline, and it should feel like it.
 *
 * The queue drains on rename or on `clearNamingQueue`. Ignoring it is a valid
 * way to play: the chronicler picked a name, and the chronicler is not you.
 */
export function renameChild(ctx: SimCtx, personId: string, name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return false;

  const p = ctx.world.people.get(personId);
  if (!p) return false;

  const pending = ctx.world.pendingNames.find((n) => n.person === personId);
  if (!pending) return false;

  // The chronicler offered one of the five and was told no. Spending a name
  // the player never used is exactly the quiet loss this repo is built to
  // catch, so it goes back in the bag. Scoped to THIS year, which is the year
  // the child was born and the year the name left the bag — see
  // `releaseFriendName`, which explains what a wider match would hand out
  // twice.
  if (releaseFriendName(ctx.world.friends, p.name, ctx.world.year)) {
    // And the lift the name carried goes back with it. Exactly the lift, not an
    // estimate: `friendBlessing` is a pure function of the person's own seed,
    // which is why it is not stored anywhere. Leaving it on would let a player
    // who renames every one of them end the run with more blessed people than
    // they gave names.
    applyFriendBlessing(p, friendBlessing(p.sigilSeed, ctx.genetics.attributes, ctx.genetics.expected), -1);
  }

  ctx.takenNames.delete(p.name);
  p.name = trimmed;
  ctx.takenNames.add(trimmed);
  pending.chosen = trimmed;

  ctx.world.pendingNames = ctx.world.pendingNames.filter((n) => n.person !== personId);
  ctx.world.chronicle.push({
    year: ctx.world.year,
    weight: 'line',
    text: `${trimmed} was born, and named.`,
    named: false,
  });
  // A rename mutates `takenNames`, which feeds every later name roll — the
  // third hook point (issue #8): deterministic state that only moves on
  // external input, so replay has to be told rather than able to re-derive it.
  ctx.world.decisionLog.push({ kind: 'name', year: ctx.world.year, person: personId, name: trimmed });
  return true;
}

/**
 * ONE CHILD LEFT AS THE CHRONICLER NAMED THEM (issue #53).
 *
 * The counterpart to `renameChild`, and deliberately NOT the same thing as
 * calling `renameChild` with the suggested name — which is the obvious way to
 * write this and is wrong twice over. `renameChild` exists to handle the offer
 * being REFUSED: it puts the friend-name back in the bag and takes the lift
 * back off the child. Run it with the name the child already has and the name
 * is released while its holder keeps it, so the bag hands it out a second time,
 * and the blessing comes off somebody who never refused anything.
 *
 * Nothing is logged, for the same reason `clearNamingQueue` logs nothing: the
 * name was spoken for at minting, so `takenNames` does not move and replay has
 * nothing to be told.
 */
export function keepSuggestedName(ctx: SimCtx, personId: string): boolean {
  const pending = ctx.world.pendingNames.find((n) => n.person === personId);
  if (!pending) return false;
  ctx.world.pendingNames = ctx.world.pendingNames.filter((n) => n.person !== personId);
  return true;
}

export function clearNamingQueue(ctx: SimCtx): void {
  ctx.world.pendingNames = [];
}

export function familySnapshot(ctx: SimCtx) {
  const w = ctx.world;
  const roster = w.people.household(w.playerHouse, w.year);
  return w.people.all().map((p) => {
    const ph = phenotypeOf(p, ctx.genetics, w.year);
    // The record layer (issue #19): what the chronicle SAYS, derived fresh —
    // `familySnapshot` is one of the two real read models `RecordView` has to
    // serve (the other is `MemberView`, in `session.ts`). `FamilyTree.vue`
    // still draws `mother`/`father` from `trueParents` — it is a debug
    // inspector and says so — but `record` is here for the client that isn't.
    const view = visibleRecordView(ctx, p.id, roster);
    return {
      id: p.id,
      name: p.name,
      epithet: p.epithet,
      sex: p.sex,
      born: p.born,
      died: p.died,
      status: p.status,
      generation: w.people.generationOf(p.id),
      mother: p.trueParents.mother,
      father: p.trueParents.father,
      house: p.houseOfOrigin,
      awakened: p.awakening.awakened,
      madness: p.madness,
      sigilSeed: p.sigilSeed,
      branch: p.status === 'alive' ? branchOf(w, p, w.year) : undefined,
      castSlots: p.castSlots,
      contract: p.contract,
      eldritch: ph.eldritch,
      attrs: Object.fromEntries(ph.attrs),
      record: {
        attrs: Object.fromEntries(view.attrs),
        claimedTraits: [...view.claimedTraits],
        claimedDeath: view.claimedDeath,
        divergence: [...view.divergence],
      },
      drift: view.divergence.size > 0,
      pedigreeF: pedigreeF(ctx, p.id),
      realizedHomozygosity: realizedHomozygosityOf(ctx, p.id),
    };
  });
}

export type FamilyMember = ReturnType<typeof familySnapshot>[number];
export type { WorldState };

// The year lives next door now. Re-exported so `import { stepYear } from
// '@ed/core'` — which is what every test, the harness and the editor write —
// keeps meaning what it meant.
export { stepYear, runYears } from './year/step.js';
export type { YearReport } from './year/report.js';
