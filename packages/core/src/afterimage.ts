import type { ChronicleEntry, SimCtx } from './world.js';
import { visibleEpithet } from './byname.js';
import { campaignDef } from './campaign.js';

/** A recoverable visible account, never an inferred account of what really happened. */
export interface AfterimageSource {
  year: number;
  page?: string;
  title?: string;
  text: string | null;
  choice?: string;
}

/** The rite's named victim and the exact surviving page that attributes the act. */
export interface AfterimageSpent {
  person: string;
  name: string;
  epithet?: string;
  source: AfterimageSource;
}

export interface AfterimageEvidence {
  people: { person: string; name: string; epithet?: string; sources: AfterimageSource[] }[];
  /** The last seal-holder's surviving recorded ancestry, including archived people. */
  line?: { id: string; name: string; epithet?: string; head: boolean; record: { parents: { mother?: string; father?: string } } }[];
  /** Earliest documented sacrifice, whatever house the subject came from. */
  spent?: AfterimageSpent;
  /** Earliest surviving documented sacrifice of this house's blood, for its reckoning. */
  spentBlood?: AfterimageSpent;
  /** Smallest preserved generation-opening count, not a continuous population minimum. */
  brush?: { count: number; source: AfterimageSource };
  embellishment?: AfterimageSource;
  blank?: AfterimageSource;
}

const sourceOf = (page: ChronicleEntry): AfterimageSource => ({
  year: page.year, text: page.text,
  ...(page.id ? { page: page.id } : {}),
  ...(page.text !== null && page.title ? { title: page.title } : {}),
});

/**
 * Inventory for #1808: book() has pages; line() has the seal's recorded spine;
 * view() has living names and only the last sixty pages' name index. Neither
 * exposes old decision casts or the current state of an embellished page.
 * Supply only the missing, attributed evidence through epilogue(), rather than
 * exporting a save or teaching the client to read simulation state.
 */
export function afterimageEvidence(ctx: SimCtx): AfterimageEvidence {
  const w = ctx.world;
  // The Afterimage is a last-night projection. Unfinished worlds can still
  // be inspected by authoring/tests with synthetic Chronicle histories whose
  // pages lie beyond the test clock; never censor those diagnostic inventories.
  // Once a house has an ending, only evidence available by that year may be
  // quoted, counted, or used to attribute outcomes.
  const fromYear = w.ending ? campaignDef(w.campaign).startYear : -Infinity;
  const throughYear = w.ending ? w.ending.year : Infinity;
  const pages = w.chronicle.map((page, index) => ({ page, index }))
    .filter(({ page }) => page.year >= fromYear && page.year <= throughYear)
    .sort((a, b) => a.page.year - b.page.year || a.index - b.index)
    .map(({ page }) => page);
  // Legacy/imported omissions may retain old text. Their words are not
  // written testimony, even if the saved page's `text` was never cleared.
  const written = pages.filter((page) => page.text !== null && page.record !== 'omit');
  // Greyed pages still existed historically (the broad rite inventory reads
  // them), but their words are lost as surviving testimony. They must not
  // supply people or an outstanding embellishment to the shareable Afterimage.
  const survivingWritten = written.filter((page) => !page.greyed);
  // A recorded outcome can be attributed only to exactly one written page
  // for its event and year. Index once instead of re-scanning the entire
  // Chronicle for each outcome in a centuries-long decision log (#2607).
  // null means multiple pages share that key, so attribution is ambiguous.
  const writtenByEvent = new Map<string, Map<number, ChronicleEntry | null>>();
  for (const page of written) {
    if (page.eventId === undefined) continue;
    let years = writtenByEvent.get(page.eventId);
    if (!years) {
      years = new Map<number, ChronicleEntry | null>();
      writtenByEvent.set(page.eventId, years);
    }
    years.set(page.year, years.has(page.year) ? null : page);
  }
  const people = new Map<string, { person: string; name: string; epithet?: string; sources: AfterimageSource[] }>();
  const mention = (id: string, source: AfterimageSource): void => {
    const p = w.people.get(id);
    // A completed last-night account cannot witness someone before birth.
    // Unfinished authoring inventories intentionally admit synthetic histories;
    // later accounts *about* the dead remain valid in either case.
    if (!p || (w.ending && p.born > source.year)) return;
    const epithet = visibleEpithet(p, throughYear);
    const reading = people.get(id) ?? {
      person: id, name: p.name,
      ...(epithet ? { epithet } : {}),
      sources: [],
    };
    reading.sources.push(source);
    people.set(id, reading);
  };
  for (const page of survivingWritten) {
    for (const id of new Set([
      ...(page.people ?? []), ...(page.claims ?? []).map((claim) => claim.person),
    ])) mention(id, sourceOf(page));
  }

  let spent: AfterimageSpent | undefined;
  let spentBlood: AfterimageSpent | undefined;
  for (const decision of w.decisionLog) {
    if (decision.kind !== 'outcome') continue;
    // Omitted outcomes cannot supply names or reconstruct the missing account.
    // The old log has no page id. Repeated same-year firings cannot be joined
    // unambiguously, so do not attach one decision to somebody else's page.
    const page = writtenByEvent.get(decision.event)?.get(decision.year);
    if (!page) continue;
    if (decision.choiceId && !page.greyed) {
      for (const id of new Set(Object.values(decision.fill).flat())) {
        mention(id, { ...sourceOf(page), choice: decision.choiceId });
      }
    }
    const event = ctx.content.event(decision.event);
    const interaction = event?.interaction;
    const outcomes = interaction?.kind === 'narration' ? interaction.outcomes
      : interaction?.choices.find((choice) => choice.id === decision.choiceId)?.outcomes;
    const outcome = outcomes?.find((candidate) => candidate.id === decision.outcomeId);
    for (const effect of outcome?.effects ?? []) {
      if (effect.kind !== 'rite' || !effect.subject || effect.rite === 'great_rite') continue;
      for (const id of decision.fill[effect.subject] ?? []) {
        const p = w.people.get(id);
        // A cast is not proof of a successful rite. Require its visible mark
        // and a written page explicitly naming the subject. Keep the account's
        // own words even where they contradict another page.
        // A completed account cannot treat a pre-birth rite as a witnessed
        // cost; unfinished diagnostic inventories remain intentionally open.
        if (!p || (w.ending && p.born > decision.year)
          || p.died !== decision.year || !page.people?.includes(id)) continue;
        if (effect.rite === 'vessel' && p.status !== 'vessel_consumed') continue;
        if (effect.rite === 'unmaking' && p.status !== 'dead') continue;
        const epithet = visibleEpithet(p, throughYear);
        const witnessed = { person: id, name: p.name, ...(epithet ? { epithet } : {}), source: sourceOf(page) };
        if (!spent || page.year < spent.source.year) spent = witnessed;
        // The Afterimage may rightly lead with an outsider, but that must not
        // hide a later blood-relative sacrifice from the bloodline reckoning.
        // The Long Line reckoning needs surviving testimony. A lost earlier
        // page must not eclipse a later, still-readable sacrifice of the blood.
        // Keep the broader Afterimage's `spent` selection unchanged.
        if (p.houseOfOrigin === w.playerHouse && !page.greyed
          && (!spentBlood || page.year < spentBlood.source.year)) {
          spentBlood = witnessed;
        }
      }
    }
  }

  const brush = w.succession.flatMap((reign) => {
    const q = reign.question;
    return reign.from >= fromYear && reign.from <= throughYear
      && q?.kind === 'thin_line' && q.opened >= fromYear && q.opened <= throughYear
      && q.text && Number.isFinite(q.baseline)
      ? [{ count: q.baseline, source: { year: q.opened, text: q.text } }]
      : [];
  }).sort((a, b) => a.count - b.count || a.source.year - b.source.year)[0];
  const embellishment = survivingWritten.find((page) => page.record === 'embellish'
    && page.discrepancyId && w.discrepancies.get(page.discrepancyId)?.state === 'open');
  const blank = pages.find((page) => page.text === null);
  const line: NonNullable<AfterimageEvidence['line']> = [];
  // Recovered succession rows need not be stored in tenure order. Choose the
  // latest admissible start year, retaining the later stored entry for ties.
  const lastHead = w.succession.reduce<(typeof w.succession)[number] | undefined>(
    (latest, reign) => reign.from >= fromYear && reign.from <= throughYear
      && (!latest || reign.from >= latest.from)
      ? reign : latest,
    undefined,
  )?.person;
  const ancestors = lastHead ? [String(lastHead)] : [];
  const seen = new Set<string>();
  while (ancestors.length) {
    const id = ancestors.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const p = w.people.get(id);
    if (!p) continue;
    // Exactly session.ts's record.parents projection. No true parentage,
    // phenotype or inferred missing ancestor crosses the seam.
    const epithet = visibleEpithet(p, throughYear);
    line.push({
      id, name: p.name, ...(epithet ? { epithet } : {}),
      head: id === lastHead, record: { parents: { ...p.claimedParents } },
    });
    for (const parent of [p.claimedParents.father, p.claimedParents.mother]) {
      if (parent) ancestors.push(parent);
    }
  }
  return {
    ...(line.length ? { line } : {}),
    // Ranking is a selection method, never a player-facing grade. Stable id
    // breaks the final tie without depending on locale or Map insertion order.
    people: [...people.values()].map((person) => ({
      ...person, sources: person.sources.sort((a, b) => a.year - b.year),
    })).sort((a, b) => b.sources.length - a.sources.length
      || a.sources[0]!.year - b.sources[0]!.year
      || (a.person < b.person ? -1 : a.person > b.person ? 1 : 0)).slice(0, 3),
    ...(spent ? { spent } : {}),
    ...(spentBlood ? { spentBlood } : {}),
    ...(brush ? { brush } : {}),
    ...(embellishment ? { embellishment: sourceOf(embellishment) } : {}),
    ...(blank ? { blank: sourceOf(blank) } : {}),
  };
}
