import type {
  Content, LibraryEntry, LibraryMemory, LibraryRun, PersonId, ResolvedClaim,
} from '@ed/schema';
import {
  LIBRARY_ENTRY_CAP, LIBRARY_MEMORY_CAP, assertNever, asId,
} from '@ed/schema';
import type { SimCtx } from './world.js';
import { hashSeed, streamFor, type Rng } from './rng.js';
import { msg } from './messages.js';

/** A historical claim that can be contradicted mechanically rather than by literary judgement. */
function canContradict(claim: ResolvedClaim): boolean {
  switch (claim.kind) {
    case 'attr':
    case 'trait':
    case 'death':
      return true;
    case 'deed':
      return false;
    default:
      return assertNever(claim);
  }
}

/**
 * Whether two attributed historical claims disagree on the same closed fact.
 * Deeds are deliberately excluded: two different sentences about what somebody
 * did are not a contradiction the game can adjudicate without inventing truth.
 */
export function libraryClaimsContradict(a: ResolvedClaim, b: ResolvedClaim): boolean {
  if (a.kind !== b.kind || a.person !== b.person) return false;
  switch (a.kind) {
    case 'attr':
      return b.kind === 'attr' && a.attr === b.attr && a.value !== b.value;
    case 'trait':
      return b.kind === 'trait' && a.trait === b.trait && a.has !== b.has;
    case 'death':
      return b.kind === 'death' && (a.year !== b.year || a.cause !== b.cause);
    case 'deed':
      return false;
    default:
      return assertNever(a);
  }
}

/**
 * The claims a retelling can change. A deed is never contradicted (above), so
 * no voice needs a sentence for one, and the type says so rather than a
 * branch nothing reaches.
 */
type ContradictedClaim = Exclude<ResolvedClaim, { kind: 'deed' }>;

function contradicted(claim: ResolvedClaim): ContradictedClaim | undefined {
  switch (claim.kind) {
    case 'attr': {
      // Narrative only: keep the number plausible and unmistakably different.
      // Recordable attributes in the shipped content are non-negative.
      const step = Math.max(2, Math.round(Math.abs(claim.value) * 0.2) || 10);
      return { ...claim, value: claim.value <= step ? claim.value + step : claim.value - step };
    }
    case 'trait':
      return { ...claim, has: !claim.has };
    case 'death':
      // A different year is a contradiction without inventing a second cause.
      return { ...claim, year: claim.year + 1 };
    case 'deed':
      return undefined;
    default:
      return assertNever(claim);
  }
}

function human(id: string): string {
  return id.replace(/_/g, ' ');
}

function subjectOf(ctx: SimCtx, entry: LibraryEntry, person: string): string {
  return entry.people[person] ?? msg(ctx, 'library.subject_unknown', 'the person named there');
}

function claimName(content: Content, claim: Extract<ResolvedClaim, { kind: 'attr' | 'trait' }>): string {
  return claim.kind === 'attr'
    ? content.attribute(claim.attr)?.name ?? human(claim.attr)
    : content.trait(claim.trait)?.name ?? human(claim.trait);
}

/** One later reading of an inherited page: which sentence shape a voice tells it in. */
type ReadingShape = 'kept' | 'attr' | 'trait_with' | 'trait_without' | 'death';
type Told = (ctx: SimCtx, values: Readonly<Record<string, string>>) => string;

interface LibraryVoiceTemplate {
  form: LibraryMemory['form'];
  teller: Told;
  bias: Told;
  /** One WHOLE sentence per reading shape, so a translator sees the clause it carries (#846). */
  told: Record<ReadingShape, Told>;
}

/**
 * The interpolated FACT, not the voice around it. The prose below is authored
 * once per form and per shape; runtime code supplies only the old page and the
 * closed claim that changed. That is #70's line between inherited content and
 * authored telling.
 */
function laterReading(
  ctx: SimCtx,
  entry: LibraryEntry,
  changed: ContradictedClaim | undefined,
  content: Content,
): { shape: ReadingShape; values: Record<string, string> } {
  if (!changed) return { shape: 'kept', values: {} };
  const PERSON = subjectOf(ctx, entry, changed.person);
  switch (changed.kind) {
    case 'attr':
      return {
        shape: 'attr',
        values: { PERSON, QUALITY: claimName(content, changed), VALUE: String(Math.round(changed.value * 10) / 10) },
      };
    case 'trait':
      return { shape: changed.has ? 'trait_with' : 'trait_without', values: { PERSON, TRAIT: claimName(content, changed) } };
    case 'death':
      return { shape: 'death', values: { PERSON, YEAR: String(changed.year) } };
    default:
      return assertNever(changed);
  }
}

/**
 * SEVEN AUTHORED VOICES, ONE FOR EACH TALE FORM (#70).
 *
 * These are deliberately fixed prose, not a sentence generator. Each voice
 * belongs to the rival house chosen for this memory; only the inherited page
 * and its closed claim are interpolated. A writer owns the voice and bias, the
 * old run owns the quoted content, and the simulation owns neither opinion.
 */
const LIBRARY_VOICES: LibraryVoiceTemplate[] = [
  {
    form: 'song',
    teller: (ctx, v) => msg(ctx, 'library.song.teller', 'the household singers of {RIVAL}', v),
    bias: (ctx, v) => msg(ctx, 'library.song.bias', 'keeping the version {RIVAL} has found pleasant to remember', v),
    told: {
      kept: (ctx, v) => msg(ctx, 'library.song.kept',
        "“{SAID}” So the singers of {RIVAL} have it; but in their refrain, the old words are kept entire. The first singer's name is gone.", v),
      attr: (ctx, v) => msg(ctx, 'library.song.attr',
        "“{SAID}” So the singers of {RIVAL} have it; but in their refrain, {PERSON}'s {QUALITY} is entered as {VALUE}. The first singer's name is gone.", v),
      trait_with: (ctx, v) => msg(ctx, 'library.song.trait_with',
        "“{SAID}” So the singers of {RIVAL} have it; but in their refrain, {PERSON} is entered with {TRAIT}. The first singer's name is gone.", v),
      trait_without: (ctx, v) => msg(ctx, 'library.song.trait_without',
        "“{SAID}” So the singers of {RIVAL} have it; but in their refrain, {PERSON} is entered without {TRAIT}. The first singer's name is gone.", v),
      death: (ctx, v) => msg(ctx, 'library.song.death',
        "“{SAID}” So the singers of {RIVAL} have it; but in their refrain, {PERSON}'s death is entered in {YEAR}. The first singer's name is gone.", v),
    },
  },
  {
    form: 'doctrine',
    teller: (ctx, v) => msg(ctx, 'library.doctrine.teller', "the chaplain who keeps {RIVAL}'s old books", v),
    bias: (ctx, v) => msg(ctx, 'library.doctrine.bias', "making the inherited account sit obediently inside {RIVAL}'s doctrine", v),
    told: {
      kept: (ctx, v) => msg(ctx, 'library.doctrine.kept',
        '“{SAID}” The copy kept at {RIVAL} gives no argument, only a correction in the narrow hand of its chaplain: the old words are kept entire. No earlier hand is named.', v),
      attr: (ctx, v) => msg(ctx, 'library.doctrine.attr',
        "“{SAID}” The copy kept at {RIVAL} gives no argument, only a correction in the narrow hand of its chaplain: {PERSON}'s {QUALITY} is entered as {VALUE}. No earlier hand is named.", v),
      trait_with: (ctx, v) => msg(ctx, 'library.doctrine.trait_with',
        '“{SAID}” The copy kept at {RIVAL} gives no argument, only a correction in the narrow hand of its chaplain: {PERSON} is entered with {TRAIT}. No earlier hand is named.', v),
      trait_without: (ctx, v) => msg(ctx, 'library.doctrine.trait_without',
        '“{SAID}” The copy kept at {RIVAL} gives no argument, only a correction in the narrow hand of its chaplain: {PERSON} is entered without {TRAIT}. No earlier hand is named.', v),
      death: (ctx, v) => msg(ctx, 'library.doctrine.death',
        "“{SAID}” The copy kept at {RIVAL} gives no argument, only a correction in the narrow hand of its chaplain: {PERSON}'s death is entered in {YEAR}. No earlier hand is named.", v),
    },
  },
  {
    form: 'rival_chronicle',
    teller: (ctx, v) => msg(ctx, 'library.rival_chronicle.teller', 'the archivist of {RIVAL}', v),
    bias: (ctx, v) => msg(ctx, 'library.rival_chronicle.bias', "keeping {RIVAL}'s inherited account of the old house", v),
    told: {
      kept: (ctx, v) => msg(ctx, 'library.rival_chronicle.kept',
        "“{SAID}” Thus stands the older house's own page. The archivist of {RIVAL} copies it beneath another heading, where the old words are kept entire; and leaves the disagreement without apology.", v),
      attr: (ctx, v) => msg(ctx, 'library.rival_chronicle.attr',
        "“{SAID}” Thus stands the older house's own page. The archivist of {RIVAL} copies it beneath another heading, where {PERSON}'s {QUALITY} is entered as {VALUE}; and leaves the disagreement without apology.", v),
      trait_with: (ctx, v) => msg(ctx, 'library.rival_chronicle.trait_with',
        "“{SAID}” Thus stands the older house's own page. The archivist of {RIVAL} copies it beneath another heading, where {PERSON} is entered with {TRAIT}; and leaves the disagreement without apology.", v),
      trait_without: (ctx, v) => msg(ctx, 'library.rival_chronicle.trait_without',
        "“{SAID}” Thus stands the older house's own page. The archivist of {RIVAL} copies it beneath another heading, where {PERSON} is entered without {TRAIT}; and leaves the disagreement without apology.", v),
      death: (ctx, v) => msg(ctx, 'library.rival_chronicle.death',
        "“{SAID}” Thus stands the older house's own page. The archivist of {RIVAL} copies it beneath another heading, where {PERSON}'s death is entered in {YEAR}; and leaves the disagreement without apology.", v),
    },
  },
  {
    form: 'rhyme',
    teller: (ctx, v) => msg(ctx, 'library.rhyme.teller', "the children of {RIVAL}'s lower hall", v),
    bias: (ctx, v) => msg(ctx, 'library.rhyme.bias', "keeping only what {RIVAL}'s children can carry from one winter to the next", v),
    told: {
      kept: (ctx, v) => msg(ctx, 'library.rhyme.kept',
        "“{SAID}” The children below {RIVAL}'s hall make a smaller thing of it, and a harder thing to lose: the old words are kept entire. They do not know whose book taught them.", v),
      attr: (ctx, v) => msg(ctx, 'library.rhyme.attr',
        "“{SAID}” The children below {RIVAL}'s hall make a smaller thing of it, and a harder thing to lose: {PERSON}'s {QUALITY} is entered as {VALUE}. They do not know whose book taught them.", v),
      trait_with: (ctx, v) => msg(ctx, 'library.rhyme.trait_with',
        "“{SAID}” The children below {RIVAL}'s hall make a smaller thing of it, and a harder thing to lose: {PERSON} is entered with {TRAIT}. They do not know whose book taught them.", v),
      trait_without: (ctx, v) => msg(ctx, 'library.rhyme.trait_without',
        "“{SAID}” The children below {RIVAL}'s hall make a smaller thing of it, and a harder thing to lose: {PERSON} is entered without {TRAIT}. They do not know whose book taught them.", v),
      death: (ctx, v) => msg(ctx, 'library.rhyme.death',
        "“{SAID}” The children below {RIVAL}'s hall make a smaller thing of it, and a harder thing to lose: {PERSON}'s death is entered in {YEAR}. They do not know whose book taught them.", v),
    },
  },
  {
    form: 'play',
    teller: (ctx, v) => msg(ctx, 'library.play.teller', "the players retained for {RIVAL}'s winter feast", v),
    bias: (ctx, v) => msg(ctx, 'library.play.bias', "turning an old house's dignity into the version {RIVAL} will applaud", v),
    told: {
      kept: (ctx, v) => msg(ctx, 'library.play.kept',
        "“{SAID}” At {RIVAL}'s winter feast the line is spoken before the candles gutter; then the second player answers that the old words are kept entire. The audience laughs at a quarrel older than the script.", v),
      attr: (ctx, v) => msg(ctx, 'library.play.attr',
        "“{SAID}” At {RIVAL}'s winter feast the line is spoken before the candles gutter; then the second player answers that {PERSON}'s {QUALITY} is entered as {VALUE}. The audience laughs at a quarrel older than the script.", v),
      trait_with: (ctx, v) => msg(ctx, 'library.play.trait_with',
        "“{SAID}” At {RIVAL}'s winter feast the line is spoken before the candles gutter; then the second player answers that {PERSON} is entered with {TRAIT}. The audience laughs at a quarrel older than the script.", v),
      trait_without: (ctx, v) => msg(ctx, 'library.play.trait_without',
        "“{SAID}” At {RIVAL}'s winter feast the line is spoken before the candles gutter; then the second player answers that {PERSON} is entered without {TRAIT}. The audience laughs at a quarrel older than the script.", v),
      death: (ctx, v) => msg(ctx, 'library.play.death',
        "“{SAID}” At {RIVAL}'s winter feast the line is spoken before the candles gutter; then the second player answers that {PERSON}'s death is entered in {YEAR}. The audience laughs at a quarrel older than the script.", v),
    },
  },
  {
    form: 'footnote',
    teller: (ctx, v) => msg(ctx, 'library.footnote.teller', "an unnamed annotator in {RIVAL}'s library", v),
    bias: (ctx, v) => msg(ctx, 'library.footnote.bias', "correcting the old house from the safety of {RIVAL}'s margin", v),
    told: {
      kept: (ctx, v) => msg(ctx, 'library.footnote.kept',
        "“{SAID}” Beside it, in {RIVAL}'s copy, an unnamed hand has written only this: the old words are kept entire. The ink is younger than the page and older than any living witness.", v),
      attr: (ctx, v) => msg(ctx, 'library.footnote.attr',
        "“{SAID}” Beside it, in {RIVAL}'s copy, an unnamed hand has written only this: {PERSON}'s {QUALITY} is entered as {VALUE}. The ink is younger than the page and older than any living witness.", v),
      trait_with: (ctx, v) => msg(ctx, 'library.footnote.trait_with',
        "“{SAID}” Beside it, in {RIVAL}'s copy, an unnamed hand has written only this: {PERSON} is entered with {TRAIT}. The ink is younger than the page and older than any living witness.", v),
      trait_without: (ctx, v) => msg(ctx, 'library.footnote.trait_without',
        "“{SAID}” Beside it, in {RIVAL}'s copy, an unnamed hand has written only this: {PERSON} is entered without {TRAIT}. The ink is younger than the page and older than any living witness.", v),
      death: (ctx, v) => msg(ctx, 'library.footnote.death',
        "“{SAID}” Beside it, in {RIVAL}'s copy, an unnamed hand has written only this: {PERSON}'s death is entered in {YEAR}. The ink is younger than the page and older than any living witness.", v),
    },
  },
  {
    form: 'charm',
    teller: (ctx, v) => msg(ctx, 'library.charm.teller', 'the nurses of {RIVAL}, from one nursery to the next', v),
    bias: (ctx, v) => msg(ctx, 'library.charm.bias', "keeping the inherited warning useful to {RIVAL}'s children", v),
    told: {
      kept: (ctx, v) => msg(ctx, 'library.charm.kept',
        '“{SAID}” The nurses of {RIVAL} say the words before a child sleeps, and finish them always the same way: the old words are kept entire. None remembers when the last line entered the charm.', v),
      attr: (ctx, v) => msg(ctx, 'library.charm.attr',
        "“{SAID}” The nurses of {RIVAL} say the words before a child sleeps, and finish them always the same way: {PERSON}'s {QUALITY} is entered as {VALUE}. None remembers when the last line entered the charm.", v),
      trait_with: (ctx, v) => msg(ctx, 'library.charm.trait_with',
        '“{SAID}” The nurses of {RIVAL} say the words before a child sleeps, and finish them always the same way: {PERSON} is entered with {TRAIT}. None remembers when the last line entered the charm.', v),
      trait_without: (ctx, v) => msg(ctx, 'library.charm.trait_without',
        '“{SAID}” The nurses of {RIVAL} say the words before a child sleeps, and finish them always the same way: {PERSON} is entered without {TRAIT}. None remembers when the last line entered the charm.', v),
      death: (ctx, v) => msg(ctx, 'library.charm.death',
        "“{SAID}” The nurses of {RIVAL} say the words before a child sleeps, and finish them always the same way: {PERSON}'s death is entered in {YEAR}. None remembers when the last line entered the charm.", v),
    },
  },
];

/** Structural guard for the seven authored forms required by #70. */
export const LIBRARY_VOICE_FORMS = LIBRARY_VOICES.map((voice) => voice.form);

function memoryVoice(
  ctx: SimCtx,
  rng: Rng,
): Pick<LibraryMemory, 'form' | 'teller' | 'bias'> & {
  render: (entry: LibraryEntry, changed: ContradictedClaim | undefined, content: Content) => string;
} {
  const rivals = ctx.content.houses.filter((h) => !h.isPlayerHouse);
  const rival = rivals.length ? rng.pick(rivals) : undefined;
  const RIVAL = rival?.name ?? msg(ctx, 'library.rival_unknown', 'a rival house');
  const template = rng.pick(LIBRARY_VOICES);
  return {
    form: template.form,
    teller: template.teller(ctx, { RIVAL }),
    bias: template.bias(ctx, { RIVAL }),
    render: (entry, changed, content) => {
      const reading = laterReading(ctx, entry, changed, content);
      return template.told[reading.shape](ctx, { SAID: entry.said, RIVAL, ...reading.values });
    },
  };
}

function entryOf(ctx: SimCtx, entry: SimCtx['world']['chronicle'][number], index: number): LibraryEntry | undefined {
  if (!entry.text) return undefined;

  const people: Record<string, string> = {};
  for (const claim of entry.claims ?? []) {
    const person = ctx.world.people.get(asId<PersonId>(claim.person));
    if (person) people[claim.person] = person.name;
  }

  const discrepancy = entry.discrepancyId
    ? ctx.world.discrepancies.get(entry.discrepancyId)
    : undefined;

  return {
    id: entry.id ?? `page_${entry.year}_${index.toString(36)}`,
    said: entry.text,
    year: entry.year,
    ...(entry.record ? { record: entry.record } : {}),
    ...(entry.discrepancyId && discrepancy
      ? { discrepancy: { id: entry.discrepancyId, state: discrepancy.state } }
      : {}),
    people,
    claims: (entry.claims ?? []).map((claim) => ({ ...claim })),
  };
}

function memoryScore(entry: LibraryEntry): number {
  const discrepancy = entry.discrepancy;
  return (entry.record === 'embellish' ? 20 : entry.record === 'record' ? 5 : 0)
    + (discrepancy?.state === 'buried' ? 12 : discrepancy?.state === 'open' ? 8 : 0)
    + (entry.claims.some(canContradict) ? 4 : 0);
}

/**
 * The finished account which may outlive this run. It contains only what the
 * family's record exposed; hidden genomes, true parentage and unrecorded state
 * never cross this boundary.
 */
export function libraryRunOf(ctx: SimCtx): LibraryRun | undefined {
  const w = ctx.world;
  if (!w.ending) return undefined;

  const entries = w.chronicle
    .map((entry, index) => entryOf(ctx, entry, index))
    .filter((entry): entry is LibraryEntry => entry !== undefined)
    .sort((a, b) => memoryScore(b) - memoryScore(a) || b.year - a.year || a.id.localeCompare(b.id))
    .slice(0, LIBRARY_ENTRY_CAP)
    .sort((a, b) => a.year - b.year || a.id.localeCompare(b.id));

  const house = w.founding?.houseName ?? w.houses.get(w.playerHouse)?.name ?? w.playerHouse;
  const ending = ctx.content.ending(w.ending.id);
  const fingerprint = JSON.stringify(entries.map((entry) => [
    entry.id, entry.year, entry.record, entry.discrepancy?.id, entry.discrepancy?.state, entry.claims,
  ]));
  const id = `lib_${hashSeed(w.seed, w.campaign, w.ending.year, w.ending.id, house, fingerprint).toString(36)}`;

  return {
    id,
    seed: w.seed,
    campaign: w.campaign,
    endedYear: w.ending.year,
    house,
    ending: { id: w.ending.id, title: ending?.title ?? human(w.ending.id) },
    entries,
  };
}

function chosenEntries(runs: readonly LibraryRun[], rng: Rng): Array<{ run: LibraryRun; entry: LibraryEntry }> {
  const all = runs.flatMap((run) => run.entries.map((entry) => ({ run, entry })));
  if (!all.length) return [];

  const picked: Array<{ run: LibraryRun; entry: LibraryEntry }> = [];
  const firstContradictable = all.filter(({ entry }) => entry.claims.some(canContradict));
  if (firstContradictable.length) picked.push(rng.pick(firstContradictable));

  const remaining = all.filter((candidate) => !picked.some(
    (held) => held.run.id === candidate.run.id && held.entry.id === candidate.entry.id,
  ));
  while (picked.length < LIBRARY_MEMORY_CAP && remaining.length) {
    const index = rng.int(remaining.length);
    picked.push(remaining.splice(index, 1)[0]!);
  }
  return picked;
}

/**
 * Seed narrative memory once. Nothing else in the simulation reads
 * `world.libraryMemories`; the whole feature is intentionally incapable of
 * changing money, genes, land, standing or event selection.
 */
export function seedLibraryMemories(ctx: SimCtx, runs: readonly LibraryRun[]): LibraryMemory[] {
  if (!runs.some((run) => run.entries.length)) {
    ctx.world.libraryMemories = [];
    return [];
  }

  // Issue #70 / invariant 8: the library owns a named per-world stream.
  // The empty-library return above happens before this call, so adding the
  // feature consumes no dice at all when there is nothing to inherit.
  const rng = streamFor(ctx.world, 'library');

  const memories = chosenEntries(runs, rng).map(({ run, entry }): LibraryMemory => {
    const voice = memoryVoice(ctx, rng);
    const candidates = entry.claims
      .map((claim, claimIndex) => ({ claim, claimIndex }))
      .filter(({ claim }) => canContradict(claim));
    const target = candidates.length ? rng.pick(candidates) : undefined;
    const claims = entry.claims.map((claim) => ({ ...claim }));
    let changed: ContradictedClaim | undefined;
    if (target) {
      changed = contradicted(target.claim);
      if (changed) claims[target.claimIndex] = changed;
    }

    return {
      id: `library_memory_${(ctx.world.counters.library += 1).toString(36)}`,
      sourceRun: run.id,
      sourceHouse: run.house,
      sourceYear: entry.year,
      sourceText: entry.said,
      form: voice.form,
      teller: voice.teller,
      bias: voice.bias,
      text: voice.render(entry, changed, ctx.content),
      about: `library:${run.id}:${entry.id}`,
      since: ctx.world.year,
      mutations: 0,
      people: { ...entry.people },
      sourceClaims: entry.claims.map((claim) => ({ ...claim })),
      claims,
    };
  });

  ctx.world.libraryMemories = memories;
  return memories;
}
