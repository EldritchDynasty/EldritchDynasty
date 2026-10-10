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

function contradicted(claim: ResolvedClaim): ResolvedClaim | undefined {
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

function subjectOf(entry: LibraryEntry, person: string): string {
  return entry.people[person] ?? 'the person named there';
}

function claimName(content: Content, claim: ResolvedClaim): string {
  switch (claim.kind) {
    case 'attr':
      return content.attribute(claim.attr)?.name ?? human(claim.attr);
    case 'trait':
      return content.trait(claim.trait)?.name ?? human(claim.trait);
    case 'death':
      return 'death';
    case 'deed':
      return 'deed';
    default:
      return assertNever(claim);
  }
}

type ReadingShape = 'kept' | 'attr' | 'trait_with' | 'trait_without' | 'death';
interface LibraryVoiceTemplate {
  form: LibraryMemory['form'];
  teller: string;
  bias: string;
  sentences: Record<ReadingShape, string>;
}

/** Whole-sentence Originals: one for each voice and reachable reading shape. */
const LIBRARY_VOICES: LibraryVoiceTemplate[] = [
  { form: "song", teller: "the household singers of {RIVAL}", bias: "keeping the version {RIVAL} has found pleasant to remember", sentences: {
    kept: "“{SAID}” So the singers of {RIVAL} have it; but in their refrain, the old words are kept entire. The first singer's name is gone.",
    attr: "“{SAID}” So the singers of {RIVAL} have it; but in their refrain, {SUBJECT}'s {QUALITY} is entered as {VALUE}. The first singer's name is gone.",
    trait_with: "“{SAID}” So the singers of {RIVAL} have it; but in their refrain, {SUBJECT} is entered with {QUALITY}. The first singer's name is gone.",
    trait_without: "“{SAID}” So the singers of {RIVAL} have it; but in their refrain, {SUBJECT} is entered without {QUALITY}. The first singer's name is gone.",
    death: "“{SAID}” So the singers of {RIVAL} have it; but in their refrain, {SUBJECT}'s death is entered in {YEAR}. The first singer's name is gone.",
  } },
  { form: "doctrine", teller: "the chaplain who keeps {RIVAL}'s old books", bias: "making the inherited account sit obediently inside {RIVAL}'s doctrine", sentences: {
    kept: "“{SAID}” The copy kept at {RIVAL} gives no argument, only a correction in the narrow hand of its chaplain: the old words are kept entire. No earlier hand is named.",
    attr: "“{SAID}” The copy kept at {RIVAL} gives no argument, only a correction in the narrow hand of its chaplain: {SUBJECT}'s {QUALITY} is entered as {VALUE}. No earlier hand is named.",
    trait_with: "“{SAID}” The copy kept at {RIVAL} gives no argument, only a correction in the narrow hand of its chaplain: {SUBJECT} is entered with {QUALITY}. No earlier hand is named.",
    trait_without: "“{SAID}” The copy kept at {RIVAL} gives no argument, only a correction in the narrow hand of its chaplain: {SUBJECT} is entered without {QUALITY}. No earlier hand is named.",
    death: "“{SAID}” The copy kept at {RIVAL} gives no argument, only a correction in the narrow hand of its chaplain: {SUBJECT}'s death is entered in {YEAR}. No earlier hand is named.",
  } },
  { form: "rival_chronicle", teller: "the archivist of {RIVAL}", bias: "keeping {RIVAL}'s inherited account of the old house", sentences: {
    kept: "“{SAID}” Thus stands the older house's own page. The archivist of {RIVAL} copies it beneath another heading, where the old words are kept entire; and leaves the disagreement without apology.",
    attr: "“{SAID}” Thus stands the older house's own page. The archivist of {RIVAL} copies it beneath another heading, where {SUBJECT}'s {QUALITY} is entered as {VALUE}; and leaves the disagreement without apology.",
    trait_with: "“{SAID}” Thus stands the older house's own page. The archivist of {RIVAL} copies it beneath another heading, where {SUBJECT} is entered with {QUALITY}; and leaves the disagreement without apology.",
    trait_without: "“{SAID}” Thus stands the older house's own page. The archivist of {RIVAL} copies it beneath another heading, where {SUBJECT} is entered without {QUALITY}; and leaves the disagreement without apology.",
    death: "“{SAID}” Thus stands the older house's own page. The archivist of {RIVAL} copies it beneath another heading, where {SUBJECT}'s death is entered in {YEAR}; and leaves the disagreement without apology.",
  } },
  { form: "rhyme", teller: "the children of {RIVAL}'s lower hall", bias: "keeping only what {RIVAL}'s children can carry from one winter to the next", sentences: {
    kept: "“{SAID}” The children below {RIVAL}'s hall make a smaller thing of it, and a harder thing to lose: the old words are kept entire. They do not know whose book taught them.",
    attr: "“{SAID}” The children below {RIVAL}'s hall make a smaller thing of it, and a harder thing to lose: {SUBJECT}'s {QUALITY} is entered as {VALUE}. They do not know whose book taught them.",
    trait_with: "“{SAID}” The children below {RIVAL}'s hall make a smaller thing of it, and a harder thing to lose: {SUBJECT} is entered with {QUALITY}. They do not know whose book taught them.",
    trait_without: "“{SAID}” The children below {RIVAL}'s hall make a smaller thing of it, and a harder thing to lose: {SUBJECT} is entered without {QUALITY}. They do not know whose book taught them.",
    death: "“{SAID}” The children below {RIVAL}'s hall make a smaller thing of it, and a harder thing to lose: {SUBJECT}'s death is entered in {YEAR}. They do not know whose book taught them.",
  } },
  { form: "play", teller: "the players retained for {RIVAL}'s winter feast", bias: "turning an old house's dignity into the version {RIVAL} will applaud", sentences: {
    kept: "“{SAID}” At {RIVAL}'s winter feast the line is spoken before the candles gutter; then the second player answers that the old words are kept entire. The audience laughs at a quarrel older than the script.",
    attr: "“{SAID}” At {RIVAL}'s winter feast the line is spoken before the candles gutter; then the second player answers that {SUBJECT}'s {QUALITY} is entered as {VALUE}. The audience laughs at a quarrel older than the script.",
    trait_with: "“{SAID}” At {RIVAL}'s winter feast the line is spoken before the candles gutter; then the second player answers that {SUBJECT} is entered with {QUALITY}. The audience laughs at a quarrel older than the script.",
    trait_without: "“{SAID}” At {RIVAL}'s winter feast the line is spoken before the candles gutter; then the second player answers that {SUBJECT} is entered without {QUALITY}. The audience laughs at a quarrel older than the script.",
    death: "“{SAID}” At {RIVAL}'s winter feast the line is spoken before the candles gutter; then the second player answers that {SUBJECT}'s death is entered in {YEAR}. The audience laughs at a quarrel older than the script.",
  } },
  { form: "footnote", teller: "an unnamed annotator in {RIVAL}'s library", bias: "correcting the old house from the safety of {RIVAL}'s margin", sentences: {
    kept: "“{SAID}” Beside it, in {RIVAL}'s copy, an unnamed hand has written only this: the old words are kept entire. The ink is younger than the page and older than any living witness.",
    attr: "“{SAID}” Beside it, in {RIVAL}'s copy, an unnamed hand has written only this: {SUBJECT}'s {QUALITY} is entered as {VALUE}. The ink is younger than the page and older than any living witness.",
    trait_with: "“{SAID}” Beside it, in {RIVAL}'s copy, an unnamed hand has written only this: {SUBJECT} is entered with {QUALITY}. The ink is younger than the page and older than any living witness.",
    trait_without: "“{SAID}” Beside it, in {RIVAL}'s copy, an unnamed hand has written only this: {SUBJECT} is entered without {QUALITY}. The ink is younger than the page and older than any living witness.",
    death: "“{SAID}” Beside it, in {RIVAL}'s copy, an unnamed hand has written only this: {SUBJECT}'s death is entered in {YEAR}. The ink is younger than the page and older than any living witness.",
  } },
  { form: "charm", teller: "the nurses of {RIVAL}, from one nursery to the next", bias: "keeping the inherited warning useful to {RIVAL}'s children", sentences: {
    kept: "“{SAID}” The nurses of {RIVAL} say the words before a child sleeps, and finish them always the same way: the old words are kept entire. None remembers when the last line entered the charm.",
    attr: "“{SAID}” The nurses of {RIVAL} say the words before a child sleeps, and finish them always the same way: {SUBJECT}'s {QUALITY} is entered as {VALUE}. None remembers when the last line entered the charm.",
    trait_with: "“{SAID}” The nurses of {RIVAL} say the words before a child sleeps, and finish them always the same way: {SUBJECT} is entered with {QUALITY}. None remembers when the last line entered the charm.",
    trait_without: "“{SAID}” The nurses of {RIVAL} say the words before a child sleeps, and finish them always the same way: {SUBJECT} is entered without {QUALITY}. None remembers when the last line entered the charm.",
    death: "“{SAID}” The nurses of {RIVAL} say the words before a child sleeps, and finish them always the same way: {SUBJECT}'s death is entered in {YEAR}. None remembers when the last line entered the charm.",
  } },
];

/** Stable keyed inventory for review and regression tests. */
export const LIBRARY_MESSAGE_ORIGINALS: Readonly<Record<string, string>> = Object.fromEntries(
  LIBRARY_VOICES.flatMap((voice) => [
    [`library.${voice.form}.teller`, voice.teller],
    [`library.${voice.form}.bias`, voice.bias],
    ...Object.entries(voice.sentences).map(([shape, original]) => [`library.${voice.form}.${shape}`, original]),
  ]),
);

function readingOf(entry: LibraryEntry, changed: ResolvedClaim | undefined, content: Content): {
  shape: ReadingShape;
  values: Record<string, string>;
} {
  if (!changed) return { shape: 'kept', values: {} };
  const subject = subjectOf(entry, changed.person);
  switch (changed.kind) {
    case 'attr': return { shape: 'attr', values: { SUBJECT: subject, QUALITY: claimName(content, changed), VALUE: String(Math.round(changed.value * 10) / 10) } };
    case 'trait': return { shape: changed.has ? 'trait_with' : 'trait_without', values: { SUBJECT: subject, QUALITY: claimName(content, changed) } };
    case 'death': return { shape: 'death', values: { SUBJECT: subject, YEAR: String(changed.year) } };
    case 'deed': return { shape: 'kept', values: {} };
    default: return assertNever(changed);
  }
}

/** Structural guard for the seven authored forms required by #70. */
export const LIBRARY_VOICE_FORMS = LIBRARY_VOICES.map((voice) => voice.form);

function memoryVoice(
  ctx: SimCtx,
  rng: Rng,
): Pick<LibraryMemory, 'form' | 'teller' | 'bias'> & {
  render: (entry: LibraryEntry, changed: ResolvedClaim | undefined, content: Content) => string;
} {
  const rivals = ctx.content.houses.filter((h) => !h.isPlayerHouse);
  const rival = rivals.length ? rng.pick(rivals) : undefined;
  const rivalName = rival?.name ?? msg(ctx, 'library.fallback.rival', 'a rival house');
  const template = rng.pick(LIBRARY_VOICES);
  const values = { RIVAL: rivalName };
  return {
    form: template.form,
    teller: msg(ctx, `library.${template.form}.teller`, template.teller, values),
    bias: msg(ctx, `library.${template.form}.bias`, template.bias, values),
    render: (entry, changed, content) => {
      const reading = readingOf(entry, changed, content);
      return msg(ctx, `library.${template.form}.${reading.shape}`, template.sentences[reading.shape], {
        ...values, SAID: entry.said, ...reading.values,
      });
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
    let changed: ResolvedClaim | undefined;
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
