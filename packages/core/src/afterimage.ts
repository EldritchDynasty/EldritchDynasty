import type { ChronicleEntry, SimCtx } from './world.js';

/** A recoverable visible account, never an inferred account of what really happened. */
export interface AfterimageSource {
  year: number;
  page?: string;
  title?: string;
  text: string | null;
  choice?: string;
}

export interface AfterimageEvidence {
  people: { person: string; name: string; sources: AfterimageSource[] }[];
  /** The last seal-holder's surviving recorded ancestry, including archived people. */
  line?: { id: string; name: string; head: boolean; record: { parents: { mother?: string; father?: string } } }[];
  spent?: { person: string; name: string; source: AfterimageSource };
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
  const pages = w.chronicle.map((page, index) => ({ page, index }))
    .sort((a, b) => a.page.year - b.page.year || a.index - b.index)
    .map(({ page }) => page);
  const written = pages.filter((page) => page.text !== null);
  const people = new Map<string, { person: string; name: string; sources: AfterimageSource[] }>();
  const mention = (id: string, source: AfterimageSource): void => {
    const p = w.people.get(id);
    if (!p) return;
    const reading = people.get(id) ?? { person: id, name: p.name, sources: [] };
    reading.sources.push(source);
    people.set(id, reading);
  };
  for (const page of written) {
    for (const id of new Set([
      ...(page.people ?? []), ...(page.claims ?? []).map((claim) => claim.person),
    ])) mention(id, sourceOf(page));
  }

  let spent: AfterimageEvidence['spent'];
  for (const decision of w.decisionLog) {
    if (decision.kind !== 'outcome') continue;
    // Omitted outcomes cannot supply names or reconstruct the missing account.
    const matches = written.filter((entry) => entry.eventId === decision.event && entry.year === decision.year);
    // The old log has no page id. Repeated same-year firings cannot be joined
    // unambiguously, so do not attach one decision to somebody else's page.
    if (matches.length !== 1) continue;
    const page = matches[0]!;
    if (decision.choiceId) {
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
        if (!p || p.died !== decision.year || !page.people?.includes(id)) continue;
        if (effect.rite === 'vessel' && p.status !== 'vessel_consumed') continue;
        if (effect.rite === 'unmaking' && p.status !== 'dead') continue;
        if (!spent || page.year < spent.source.year) {
          spent = { person: id, name: p.name, source: sourceOf(page) };
        }
      }
    }
  }

  const brush = w.succession.flatMap((reign) => {
    const q = reign.question;
    return q?.kind === 'thin_line' && q.text && Number.isFinite(q.baseline)
      ? [{ count: q.baseline, source: { year: q.opened, text: q.text } }]
      : [];
  }).sort((a, b) => a.count - b.count || a.source.year - b.source.year)[0];
  const embellishment = written.find((page) => page.record === 'embellish'
    && page.discrepancyId && w.discrepancies.get(page.discrepancyId)?.state === 'open');
  const blank = pages.find((page) => page.text === null);
  const line: NonNullable<AfterimageEvidence['line']> = [];
  const lastHead = w.succession.at(-1)?.person;
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
    line.push({ id, name: p.name, head: id === lastHead, record: { parents: { ...p.claimedParents } } });
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
    ...(brush ? { brush } : {}),
    ...(embellishment ? { embellishment: sourceOf(embellishment) } : {}),
    ...(blank ? { blank: sourceOf(blank) } : {}),
  };
}
