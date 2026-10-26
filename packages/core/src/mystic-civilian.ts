import type { SimCtx } from './world.js';
import { liveDuties, markUseful } from './mystic.js';
import { resolvePresence } from './presence.js';
import { assertNever, type MysticWorkingDef } from '@ed/schema';

/** Application inventory used by the repertoire evidence; upgrades share an application. */
export function civilianApplication(working: MysticWorkingDef): string | undefined {
  const benefit = working.benefit;
  switch (benefit.kind) {
    case 'life_care': return benefit.maxWardAge === undefined ? 'ordinary_health' : 'infant_care';
    case 'estate_protection': return 'estate_protection';
    case 'project_support': return 'construction';
    case 'library_care': return 'physical_library';
    case 'household_provision': return 'provisions';
    case 'convalescence': return 'recovery';
    case 'teaching': return 'teaching';
    case 'commission': return `commission:${benefit.domain}`;
    case 'field_care': case 'field_supply': case 'field_watch': case 'field_concealment':
    case 'household_protection': case 'covert_support': return undefined;
    default: return assertNever(benefit, 'civilian application');
  }
}

/** A real paid team at this holding, capped by its strongest role rather than summed. */
export function improvementSupport(ctx: SimCtx, parcel: string) {
  const candidates = liveDuties(ctx, 'project_support').filter(({ a }) => a.target.kind === 'parcel' && a.target.parcel === parcel);
  const best = candidates.sort((a, b) => {
    const left = a.working.benefit.kind === 'project_support' ? a.working.benefit.costReduction : 0;
    const right = b.working.benefit.kind === 'project_support' ? b.working.benefit.costReduction : 0;
    return right - left || a.a.id.localeCompare(b.a.id);
  })[0];
  if (!best || best.working.benefit.kind !== 'project_support') return undefined;
  const partner = best.working.collaborator && candidates.find(c => c.working.id === best.working.collaborator);
  return { reduction: best.working.benefit.costReduction, assignments: [best.a, ...(partner ? [partner.a] : [])] };
}

export function improvementPrice(ctx: SimCtx, parcel: string, ordinary: number): number {
  return Math.max(1, Math.ceil(ordinary * (1 - (improvementSupport(ctx, parcel)?.reduction ?? 0))));
}

export function noteImprovementSupport(ctx: SimCtx, parcel: string, saved: number): void {
  if (saved <= 0) return;
  const support = improvementSupport(ctx, parcel);
  if (!support) return;
  for (const a of support.assignments) markUseful(a, ctx.world.year);
  // Coin is counted once for the joint work; each role still records its useful year.
  const a = support.assignments[0]!;
  a.service.crownsKept = (a.service.crownsKept ?? 0) + saved;
}

/** A physical copy's strongest actual custodian, with no benefit at the binder. */
export function libraryCare(ctx: SimCtx, book: string, focus: 'wearReduction' | 'restorationReduction' = 'wearReduction') {
  return liveDuties(ctx, 'library_care').filter(({ a }) => a.target.kind === 'book' && a.target.book === book)
    .map(({ a, working }) => ({ a, benefit: working.benefit }))
    .filter((row): row is typeof row & { benefit: Extract<typeof row.benefit, { kind: 'library_care' }> } => row.benefit.kind === 'library_care')
    .sort((a, b) => b.benefit[focus] - a.benefit[focus] || a.a.id.localeCompare(b.a.id))[0];
}

export function noteBookRestoration(ctx: SimCtx, book: string, paid: number): void {
  const care = libraryCare(ctx, book, 'restorationReduction');
  const copy = ctx.world.library.get(book);
  const def = ctx.content.spellbook(book);
  if (!care || !copy || !def) return;
  const ordinary = Math.max(1, Math.ceil(def.price.min * .2 * Math.max(0, 100 - copy.condition) / 100));
  const kept = Math.max(0, ordinary - paid);
  if (!kept) return;
  markUseful(care.a, ctx.world.year);
  care.a.service.crownsKept = (care.a.service.crownsKept ?? 0) + kept;
}

export function noteBookCare(ctx: SimCtx, book: string, wearKept: number): void {
  const care = libraryCare(ctx, book);
  if (!care || wearKept <= 0) return;
  markUseful(care.a, ctx.world.year);
  care.a.service.bookWearKept = (care.a.service.bookWearKept ?? 0) + wearKept;
}

/** Actual charged residents only; each person's food bill can fall by at most a quarter. */
export function provisionSavings(ctx: SimCtx, charges: ReadonlyMap<string, number>) {
  const accounted = new Set<string>();
  const results: { assignment: string; crowns: number }[] = [];
  const duties = liveDuties(ctx, 'household_provision').map(row => ({ ...row, benefit: row.working.benefit }))
    .filter((row): row is typeof row & { benefit: Extract<typeof row.benefit, { kind: 'household_provision' }> } => row.benefit.kind === 'household_provision')
    .sort((a,b) => b.benefit.crownsPerPerson - a.benefit.crownsPerPerson || a.a.id.localeCompare(b.a.id));
  for (const { a, benefit } of duties) {
    const residents = resolvePresence(ctx, a.target, a.bindings).people.filter(id => charges.has(id) && !accounted.has(id))
      .sort((a,b) => charges.get(b)! - charges.get(a)! || a.localeCompare(b)).slice(0, benefit.maxPeople);
    const crowns = residents.reduce((sum,id) => sum + Math.min(charges.get(id)! * .25, benefit.crownsPerPerson), 0);
    for (const id of residents) accounted.add(id);
    if (crowns > 0) results.push({ assignment: a.id, crowns });
  }
  return results;
}

export function noteProvisionSavings(ctx: SimCtx, savings: ReturnType<typeof provisionSavings>): void {
  for (const saved of savings) {
    const a = ctx.world.mystic.assignments.find(a => a.id === saved.assignment);
    if (!a) continue;
    markUseful(a, ctx.world.year);
    a.service.crownsKept = (a.service.crownsKept ?? 0) + saved.crowns;
  }
}

/** Ordinary recovery and lessons run once in the paid annual phase, before mortality/study. */
export function tickCivilianPractice(ctx: SimCtx): void {
  const w = ctx.world;
  const treated = new Set<string>();
  const carers = liveDuties(ctx, 'convalescence').map(row => ({ ...row, benefit: row.working.benefit }))
    .filter((row): row is typeof row & { benefit: Extract<typeof row.benefit, { kind: 'convalescence' }> } => row.benefit.kind === 'convalescence')
    .sort((a,b) => b.benefit.healthPerYear - a.benefit.healthPerYear || a.a.id.localeCompare(b.a.id));
  for (const { a, benefit } of carers) {
    if (a.target.kind !== 'person' || treated.has(a.target.person)) continue;
    const p = w.people.mustGet(a.target.person); treated.add(p.id);
    const healed = Math.min(Math.max(0, -(p.acquired.health ?? 0)), benefit.healthPerYear);
    const rest = Math.max(w.year, (p.fieldRecoveryUntil ?? w.year) - benefit.recoveryYears);
    const accelerated = rest < (p.fieldRecoveryUntil ?? w.year);
    if (!healed && !accelerated) continue;
    if (healed) {
      p.acquired.health = (p.acquired.health ?? 0) + healed;
      if (p.phenotype) p.phenotype.dirty = true;
    }
    if (accelerated) p.fieldRecoveryUntil = rest;
    markUseful(a, w.year);
    a.service.healthRestored = (a.service.healthRestored ?? 0) + healed;
  }
  for (const { a, p: teacher } of liveDuties(ctx, 'teaching')) {
    if (a.target.kind !== 'person' || a.lesson?.lastYear === w.year) continue;
    const person = a.target.person;
    const study = w.studies.find(s => s.person === person && s.completes > w.year);
    if (!study || !teacher.spellsKnown.some(id => String(id) === study.book)) continue;
    const years = a.lesson?.book === study.book ? a.lesson.years : 0;
    a.lesson = { book: study.book, years: years + 1, lastYear: w.year };
    if (a.lesson.years < 3) continue;
    a.lesson.years = 0; study.completes--;
    markUseful(a, w.year);
    a.service.studyYearsKept = (a.service.studyYearsKept ?? 0) + 1;
  }
}
