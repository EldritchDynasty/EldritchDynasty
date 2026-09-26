import type {
  Content, ContentBundle, Genome, Person, PersonId, RivalLineageState, SavedGame, StoredGenome, StoredPerson,
  SpellbookId, TraitId,
} from '@ed/schema';
import { asId, indexContent, SAVE_FORMAT, SavedGameS } from '@ed/schema';
import { createWorld, type SimCtx } from './world.js';
import { makeGeneticsCtx } from './sim.js';
import { PersonStore } from './people/store.js';
import type { PendingMatch } from './events/decisions.js';
import { campaignDef } from './campaign.js';

/**
 * SAVING AND LOADING A RUN.
 *
 * The world is a graph of Maps, Sets, a class instance and three typed arrays
 * per person. None of that is JSON, so this file is the boundary where a run
 * becomes a value and back — see `@ed/schema/save.ts` for the format itself.
 *
 * Two rules, and both of them are the same rule as invariant 6:
 *
 *   DERIVED STATE IS NOT SAVED. The phenotype cache, the house table and the
 *   content bundle are rebuilt on load. A save carrying them could disagree
 *   with the content it was loaded against, and it would do so silently.
 *
 *   EVERYTHING ELSE IS. A field that exists on the world and is missing from
 *   the format does not fail to save — it silently resets to its starting value
 *   on load, which looks like a subsystem that quietly stopped working two
 *   hundred years in. The compile-time checks in `save.ts` and the round-trip
 *   test in `save.test.ts` are both aimed at exactly that.
 */

export function saveGame(ctx: SimCtx): SavedGame {
  const w = ctx.world;
  const saved: SavedGame = {
    format: SAVE_FORMAT,
    savedAt: new Date().toISOString(),

    seed: w.seed,
    campaign: w.campaign,
    year: w.year,
    generation: w.generation,
    playerHouse: w.playerHouse,

    people: w.people.all().map(storePerson),
    takenNames: [...ctx.takenNames],
    // Filled after the plain save value exists, so the collector can discover
    // references in every field without keeping a second hand-written list.
    contentSources: [],

    branches: [...w.branches.values()],
    rivalLineages: [...w.rivalLineages.entries()].map(([houseId, l]) => [houseId, storeRivalLineage(l)] as const),
    relationships: [...w.relationships.entries()],

    treasury: w.treasury,
    respect: w.respect,
    ...(w.respectChanged !== undefined ? { respectChanged: w.respectChanged } : {}),
    discontent: w.discontent,
    bloodHighWater: w.bloodHighWater,

    flags: [...w.flags.entries()],
    knowledge: [...w.knowledge],
    clausesRecovered: [...w.clausesRecovered],
    rumours: [...w.rumours.entries()],
    discrepancies: [...w.discrepancies.entries()],
    looseSecrets: w.looseSecrets,
    courted: { ...w.courted },
    priorityMatch: [...w.priorityMatch],
    delegation: { choices: { ...w.delegation.choices }, records: { ...w.delegation.records } },
    tutoring: w.tutoring.map((t) => ({ ...t })),
    bidCeiling: w.bidCeiling,
    withheld: { ...w.withheld },
    landMarket: { lots: w.landMarket.lots.map((l) => ({ ...l })) },
    landImprovements: w.landImprovements.map((i) => ({ ...i })),
    rentsPolicy: w.rentsPolicy,
    lostParcels: w.lostParcels.map((l) => ({ ...l })),
    platIlluminated: w.platIlluminated,
    stewardYear: {
      taught: [...w.stewardYear.taught], opened: [...w.stewardYear.opened], placed: [...w.stewardYear.placed],
    },
    bearing: {
      score: w.bearing.score,
      acts: w.bearing.acts.map((a) => ({ ...a })),
      unheard: w.bearing.unheard.map((u) => ({ ...u })),
    },
    marriagePolicy: w.marriagePolicy,
    houseAmbition: w.houseAmbition,
    scion: w.scion,
    ...(w.scionVacant ? { scionVacant: { ...w.scionVacant } } : {}),
    scionHeir: w.scionHeir,
    ...(w.scionHeirVacant ? { scionHeirVacant: { ...w.scionHeirVacant } } : {}),
    // COPIED PER ROW. `spentIn` is written onto these objects the year a name
    // is handed out, and a save sharing the rows would keep spending names
    // after it was taken.
    friends: w.friends.map((f) => ({ ...f })),
    ascension: { ...w.ascension, reachedAt: { ...w.ascension.reachedAt } },
    ...(w.founding ? { founding: { ...w.founding } } : {}),
    ...(w.ending ? { ending: { ...w.ending } } : {}),
    // Plain data already, but COPIED — `fired` is a live object the Assize
    // writes into every sitting, and a save that shared it would keep changing
    // after it was taken.
    assize: { ...w.assize, fired: { ...w.assize.fired } },

    age: w.age,
    arcs: [...w.arcs.entries()],
    heirlooms: [...w.heirlooms.entries()],
    parcels: [...w.parcels.entries()],
    muster: {
      commitments: w.muster.commitments.map((c) => ({ ...c, from: { ...c.from }, officers: [...c.officers] })),
      tide: w.muster.tide,
      ...(w.muster.lastSettled !== undefined ? { lastSettled: w.muster.lastSettled } : {}),
    },
    library: [...w.library.entries()],
    auction: w.auction,
    marriagePromises: w.marriagePromises,
    tales: [...w.tales.entries()],
    libraryMemories: w.libraryMemories.map((memory) => ({
      ...memory,
      people: { ...memory.people },
      sourceClaims: memory.sourceClaims.map((claim) => ({ ...claim })),
      claims: memory.claims.map((claim) => ({ ...claim })),
    })),
    scheduled: w.scheduled,
    studies: w.studies,

    frequency: w.frequency,
    characterFrequency: w.characterFrequency,

    chronicle: w.chronicle,
    log: w.log,
    decisionLog: w.decisionLog,
    frame: w.frame,

    ...(w.narrator !== undefined ? { narrator: w.narrator } : {}),
    ...(w.guardianSince !== undefined ? { guardianSince: w.guardianSince } : {}),
    ...(w.headSince !== undefined ? { headSince: w.headSince } : {}),
    // Copied out rather than referenced — a save is plain data, and a shared
    // array would let a later year edit a written save.
    succession: w.succession.map((s) => ({ ...s, ...(s.question ? { question: { ...s.question } } : {}) })),

    ...(w.wardship !== undefined ? { wardship: { ...w.wardship } } : {}),

    pendingNames: w.pendingNames,
    pendingDecisions: w.pendingDecisions as SavedGame['pendingDecisions'],

    counters: w.counters,
  };

  saved.contentSources = referencedContentSources(saved, ctx.content);
  return saved;
}

/**
 * THE CONTENT THIS SAVE ACTUALLY DEPENDS ON (issue #75, Stage D).
 *
 * Do not maintain a second list of fields that happen to contain content ids.
 * Walk the serialized value itself and remember any string — including an
 * object key — that the indexed bundle can place in an authored YAML file.
 * A new save field therefore participates automatically. Values that merely
 * happen to equal an authored id are harmlessly conservative: keeping that
 * content is cheaper than loading a run against a bundle that may have lost
 * something it depended on.
 */
function referencedContentSources(save: SavedGame, content: Content): SavedGame['contentSources'] {
  const found = new Map<string, string>();

  const visit = (value: unknown): void => {
    if (typeof value === 'string') {
      const file = content.sourceOf(value);
      if (file !== undefined && !found.has(value)) found.set(value, file);
      return;
    }
    if (value === null || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      visit(key);
      visit(child);
    }
  };

  visit(save);
  return [...found.entries()].sort(([a], [b]) => a.localeCompare(b));
}

/**
 * THE ONE PART OF THE DOCKET THE COMPILER CAN HOLD.
 *
 * `pendingDecisions` crosses the schema boundary with a cast, because a
 * pending choice carries an `EventTemplate` whose runtime and schema types
 * are related but not identical. The Match carries no event — it is plain
 * data all the way down — so there is nothing standing between its runtime
 * shape and the shape that persists it except this line. A field added to a
 * card and not to the schema would otherwise save, load, and simply be
 * absent, which looks exactly like a card the deck never dealt.
 */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
export type SavedMatchAgrees = Same<
  PendingMatch,
  Extract<SavedGame['pendingDecisions'][number], { kind: 'match' }>
>;
export const SAVED_MATCH_AGREES: SavedMatchAgrees = true;

export class SaveFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SaveFormatError';
  }
}

/**
 * Rebuild a run from a save.
 *
 * `content` is passed in rather than stored, because the authored game is not
 * part of a save: an editor session between save and load is the normal case,
 * not the exception. What the save owns is everything the player caused.
 */
export function loadGame(raw: unknown, source: ContentBundle | Content): SimCtx {
  const format = (raw as { format?: unknown } | null)?.format;
  if (format !== SAVE_FORMAT) {
    throw new SaveFormatError(`save format ${String(format)}, expected ${SAVE_FORMAT}`);
  }

  const parsed = SavedGameS.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new SaveFormatError(`save is not readable: ${first?.path.join('.')} — ${first?.message}`);
  }
  const s = parsed.data;

  // #133 shortens A Long Line without changing the serialized shape. A
  // current-format development save may therefore be structurally readable
  // while already standing beyond the new legal term. Refuse it explicitly:
  // silently rewinding it, truncating its chronicle, or choosing a 1542 ending
  // from a later world would all invent history.
  const term = campaignDef(s.campaign).endYear;
  if (s.year > term) {
    throw new SaveFormatError(`save year ${s.year} is beyond the ${s.campaign} campaign term ${term}`);
  }
  if (s.ending && s.ending.year > term) {
    throw new SaveFormatError(`save ending year ${s.ending.year} is beyond the ${s.campaign} campaign term ${term}`);
  }

  const content = indexContent(source);
  for (const [id, formerFile] of s.contentSources) {
    if (!content.has(id)) {
      throw new SaveFormatError(`save references missing content '${id}' (formerly ${formerFile})`);
    }
  }
  // `createWorld` supplies the shape and the derived house table; everything
  // below overwrites the parts a run actually owns.
  const world = createWorld(content, s.seed, s.year, s.campaign);
  const ctx: SimCtx = {
    world,
    content,
    genetics: makeGeneticsCtx(content, s.seed),
    takenNames: new Set(s.takenNames),
  };

  world.generation = s.generation;
  world.playerHouse = s.playerHouse;

  world.people = new PersonStore();
  for (const p of s.people) world.people.add(restorePerson(p));

  world.branches = new Map(s.branches.map((b) => [String(b.id), b]));
  world.rivalLineages = new Map(s.rivalLineages.map(([houseId, l]) => [houseId, restoreRivalLineage(l)]));
  world.relationships = new Map(s.relationships);

  world.treasury = s.treasury;
  world.respect = s.respect;
  if (s.respectChanged !== undefined) world.respectChanged = s.respectChanged;
  world.discontent = s.discontent;
  world.bloodHighWater = s.bloodHighWater;

  world.flags = new Map(s.flags);
  world.knowledge = new Set(s.knowledge);
  world.clausesRecovered = new Set(s.clausesRecovered);
  world.rumours = new Map(s.rumours);
  world.discrepancies = new Map(s.discrepancies);
  world.looseSecrets = s.looseSecrets;
  world.courted = { ...s.courted };
  world.priorityMatch = [...s.priorityMatch];
  world.delegation = { choices: { ...s.delegation.choices }, records: { ...s.delegation.records } };
  world.tutoring = s.tutoring.map((t) => ({ ...t }));
  world.bidCeiling = s.bidCeiling;
  world.withheld = { ...s.withheld };
  world.landMarket = { lots: s.landMarket.lots.map((l) => ({ ...l })) };
  world.landImprovements = s.landImprovements.map((i) => ({ ...i }));
  world.rentsPolicy = s.rentsPolicy;
  world.lostParcels = s.lostParcels.map((l) => ({ ...l }));
  world.platIlluminated = s.platIlluminated;
  world.stewardYear = {
    taught: [...s.stewardYear.taught], opened: [...s.stewardYear.opened], placed: [...s.stewardYear.placed],
  };
  world.bearing = {
    score: s.bearing.score,
    acts: s.bearing.acts.map((a) => ({ ...a })),
    unheard: s.bearing.unheard.map((u) => ({ ...u })),
  };
  world.marriagePolicy = s.marriagePolicy;
  world.houseAmbition = s.houseAmbition;
  world.scion = s.scion;
  if (s.scionVacant) world.scionVacant = { ...s.scionVacant };
  world.scionHeir = s.scionHeir;
  if (s.scionHeirVacant) world.scionHeirVacant = { ...s.scionHeirVacant };
  world.friends = s.friends.map((f) => ({ ...f }));
  world.ascension = { ...s.ascension, reachedAt: { ...s.ascension.reachedAt } };
  if (s.founding) world.founding = { ...s.founding };
  if (s.ending) world.ending = { ...s.ending };
  world.assize = { ...s.assize, fired: { ...s.assize.fired } };

  world.age = s.age;
  world.arcs = new Map(s.arcs);
  world.heirlooms = new Map(s.heirlooms);
  world.parcels = new Map(s.parcels);
  world.muster = {
    commitments: s.muster.commitments.map((c) => ({ ...c, from: { ...c.from }, officers: [...c.officers] })),
    tide: s.muster.tide,
    ...(s.muster.lastSettled !== undefined ? { lastSettled: s.muster.lastSettled } : {}),
  };
  world.library = new Map(s.library);
  world.auction = s.auction;
  world.marriagePromises = s.marriagePromises;
  world.tales = new Map(s.tales);
  world.libraryMemories = s.libraryMemories.map((memory) => ({
    ...memory,
    people: { ...memory.people },
    sourceClaims: memory.sourceClaims.map((claim) => ({ ...claim })),
    claims: memory.claims.map((claim) => ({ ...claim })),
  }));
  world.scheduled = s.scheduled;
  world.studies = s.studies.map((x) => ({ person: asId<PersonId>(x.person), book: x.book, completes: x.completes }));

  world.frequency = s.frequency;
  world.characterFrequency = s.characterFrequency;

  world.chronicle = s.chronicle;
  world.log = s.log;
  world.decisionLog = s.decisionLog;
  world.frame = s.frame;

  if (s.narrator !== undefined) world.narrator = s.narrator;
  if (s.guardianSince !== undefined) world.guardianSince = s.guardianSince;
  if (s.headSince !== undefined) world.headSince = s.headSince;
  world.succession = s.succession.map((r) => ({
    person: asId<PersonId>(r.person),
    name: r.name,
    from: r.from,
    ...(r.to !== undefined ? { to: r.to } : {}),
    ...(r.question !== undefined ? { question: { ...r.question } } : {}),
    ...(r.answer !== undefined ? { answer: r.answer } : {}),
  }));

  if (s.wardship !== undefined) {
    world.wardship = {
      ward: asId<PersonId>(s.wardship.ward),
      since: s.wardship.since,
      ...(s.wardship.boughtBack !== undefined ? { boughtBack: s.wardship.boughtBack } : {}),
    };
  }

  world.pendingNames = s.pendingNames;
  world.pendingDecisions = s.pendingDecisions as typeof world.pendingDecisions;

  world.counters = s.counters;

  return ctx;
}

// ── People ────────────────────────────────────────────────────────────────

function storePerson(p: Person): StoredPerson {
  return {
    id: p.id,
    name: p.name,
    ...(p.epithet !== undefined ? { epithet: p.epithet } : {}),
    sex: p.sex,
    sigilSeed: p.sigilSeed,
    houseOfOrigin: p.houseOfOrigin,
    born: p.born,
    ...(p.died !== undefined ? { died: p.died } : {}),
    status: p.status,
    ...(p.causeOfDeath !== undefined ? { causeOfDeath: p.causeOfDeath } : {}),
    trueParents: { ...p.trueParents },
    claimedParents: { ...p.claimedParents },
    lineageDocuments: p.lineageDocuments,
    genome: p.genome.kind === 'materialized'
      ? { kind: 'materialized', genome: storeGenome(p.genome.genome) }
      : { kind: 'lazy', pool: p.genome.pool, seed: p.genome.seed },
    traits: [...p.traits],
    awakening: p.awakening,
    spellsKnown: [...p.spellsKnown],
    ...(p.career ? { career: { career: String(p.career.career), from: p.career.from } } : {}),
    membership: p.membership,
    ...(p.contract ? { contract: p.contract } : {}),
    marriages: p.marriages,
    madness: p.madness,
    rites: [...p.rites],
    acquired: p.acquired,
    // Omitted rather than an empty array where nobody has ever completed a
    // term — of the whole household, always, before issue #128 wires a door
    // that can put anyone in one. A field present-but-empty on every person
    // ever saved is a field the digest tool sees as a changed run: adding
    // vocabulary nobody has used yet must move nothing (issue #126).
    ...(p.taught.length ? { taught: [...p.taught] } : {}),
    castSlots: p.castSlots,
    tier: p.tier,
    ...(p.becomesGuardian !== undefined ? { becomesGuardian: p.becomesGuardian } : {}),
    ...(p.mintedFrom !== undefined ? { mintedFrom: p.mintedFrom } : {}),
    // The phenotype cache is deliberately absent. It is derived, and a saved
    // one would be a stale one the moment the year moved.
  };
}

function restorePerson(s: StoredPerson): Person {
  const p: Person = {
    id: asId(s.id),
    name: s.name,
    sex: s.sex,
    sigilSeed: s.sigilSeed,
    houseOfOrigin: asId(s.houseOfOrigin),
    born: s.born,
    status: s.status,
    trueParents: {
      ...(s.trueParents.mother ? { mother: asId(s.trueParents.mother) } : {}),
      ...(s.trueParents.father ? { father: asId(s.trueParents.father) } : {}),
    },
    claimedParents: {
      ...(s.claimedParents.mother ? { mother: asId(s.claimedParents.mother) } : {}),
      ...(s.claimedParents.father ? { father: asId(s.claimedParents.father) } : {}),
    },
    lineageDocuments: s.lineageDocuments,
    genome: s.genome.kind === 'materialized'
      ? { kind: 'materialized', genome: restoreGenome(s.genome.genome) }
      : { kind: 'lazy', pool: s.genome.pool, seed: s.genome.seed },
    traits: new Set(s.traits.map((t) => asId<TraitId>(t))),
    awakening: s.awakening,
    spellsKnown: s.spellsKnown.map((x) => asId<SpellbookId>(x)),
    membership: s.membership,
    marriages: s.marriages.map((m) => ({
      spouse: asId(m.spouse),
      from: m.from,
      ...(m.to !== undefined ? { to: m.to } : {}),
    })),
    madness: s.madness,
    rites: [...s.rites],
    acquired: s.acquired,
    taught: s.taught ? [...s.taught] : [],
    castSlots: s.castSlots,
    tier: s.tier,
  };

  if (s.epithet !== undefined) p.epithet = s.epithet;
  if (s.died !== undefined) p.died = s.died;
  if (s.causeOfDeath !== undefined) p.causeOfDeath = s.causeOfDeath;
  if (s.career) p.career = { career: asId(s.career.career), from: s.career.from };
  if (s.contract) p.contract = s.contract;
  if (s.becomesGuardian !== undefined) p.becomesGuardian = s.becomesGuardian;
  if (s.mintedFrom !== undefined) p.mintedFrom = s.mintedFrom;
  return p;
}

// ── Rival-house descent (issue #24 item 6) ──────────────────────────────────

function storeRivalLineage(l: RivalLineageState): SavedGame['rivalLineages'][number][1] {
  return {
    house: l.house,
    people: l.people.map((p) => ({
      id: p.id,
      house: p.house,
      sex: p.sex,
      born: p.born,
      ...(p.died !== undefined ? { died: p.died } : {}),
      ...(p.mother !== undefined ? { mother: p.mother } : {}),
      ...(p.father !== undefined ? { father: p.father } : {}),
      ...(p.spouse !== undefined ? { spouse: p.spouse } : {}),
      ...(p.left !== undefined ? { left: p.left } : {}),
      ...(p.courtship !== undefined ? { courtship: { ...p.courtship } } : {}),
      genome: storeGenome(p.genome),
    })),
  };
}

function restoreRivalLineage(s: SavedGame['rivalLineages'][number][1]): RivalLineageState {
  return {
    house: s.house,
    people: s.people.map((p) => ({
      id: p.id,
      house: p.house,
      sex: p.sex,
      born: p.born,
      ...(p.died !== undefined ? { died: p.died } : {}),
      ...(p.mother !== undefined ? { mother: p.mother } : {}),
      ...(p.father !== undefined ? { father: p.father } : {}),
      ...(p.spouse !== undefined ? { spouse: p.spouse } : {}),
      ...(p.left !== undefined ? { left: p.left } : {}),
      ...(p.courtship !== undefined ? { courtship: { ...p.courtship } } : {}),
      genome: restoreGenome(p.genome),
    })),
  };
}

function storeGenome(g: Genome): StoredGenome {
  return {
    autosomal: [[...g.autosomal[0]], [...g.autosomal[1]]],
    sex: [[...g.sex[0]], g.sex[1] ? [...g.sex[1]] : null],
    mutations: g.mutations,
  };
}

function restoreGenome(g: StoredGenome): Genome {
  return {
    autosomal: [Int16Array.from(g.autosomal[0]), Int16Array.from(g.autosomal[1])],
    sex: [Int16Array.from(g.sex[0]), g.sex[1] ? Int16Array.from(g.sex[1]) : null],
    mutations: g.mutations,
  };
}

/**
 * A stable fingerprint of a run.
 *
 * The determinism tests used to assert on a handful of hand-picked numbers —
 * population, treasury, the head's name — which caught the divergence they were
 * written for and nothing else. A digest of the whole save covers every field
 * the format knows about, including the ones added after the test was written.
 */
export function digest(save: SavedGame): string {
  // #66: adding campaign identity to the save must not make an otherwise
  // identical Long Line look like a different simulation. Format 22 predates
  // this field; an absent campaign therefore means Long, while a new Short
  // save writes its identity explicitly. Omit the explicit Long default from
  // the fingerprint so the additive field does not move existing digests.
  const value: Record<string, unknown> = { ...save };
  // Provenance says whether this save may be loaded against a content bundle;
  // it is not simulation state and must not move deterministic fingerprints.
  delete value.contentSources;
  if (save.campaign === 'long') {
    // Campaign identity is additive on the current save envelope. Old
    // format-22 saves had no field and therefore mean Long; omit the explicit
    // default here so adding the field does not move Long-Line digests.
    delete value.campaign;
  }
  // Issue #149: an EMPTY rival lineage is additive state, just like #70's
  // empty installation library. Peel each additive save envelope back in
  // order so a Long run that never uses either feature keeps its old digest.
  if (save.rivalLineages.length === 0 && save.counters.rival === 0) {
    delete value.rivalLineages;
    const counters = value.counters as SavedGame['counters'];
    const { rival: _rival, ...legacyCounters } = counters;
    value.counters = legacyCounters;
    value.format = 23;
  }
  if (value.format === 23 && save.libraryMemories.length === 0) {
    // Issue #70: an EMPTY installation library must be byte-identical to the
    // game before the Library of Houses existed. The saved envelope needs a
    // new field/format for populated memories, but an empty array is no state.
    // Normalize that additive absence back to the format-22 fingerprint.
    delete value.libraryMemories;
    const counters = value.counters as SavedGame['counters'];
    if (counters.library === 0) {
      const { library: _library, ...legacyCounters } = counters;
      value.counters = legacyCounters;
    }
    value.format = 22;
  }
  const json = canonical(value);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < json.length; i++) {
    const c = json.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0;
  }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}:${json.length}`;
}

export function digestOf(ctx: SimCtx): string {
  return digest(saveGame(ctx));
}

/**
 * JSON with object keys in a fixed order, and `savedAt` dropped.
 *
 * Property insertion order is not state. A membership record written as
 * `{ house, kind, from, branch }` and later given a `to` serialises differently
 * from the same record rebuilt by Zod in schema order — identical data, two
 * different strings. A digest that noticed the difference would fail every
 * round-trip test for a reason that means nothing, which is worse than having
 * no digest: it would be the tests crying wolf about the one property they
 * exist to protect.
 *
 * Array order IS state and is left alone.
 */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([k, v]) => v !== undefined && k !== 'savedAt')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}
