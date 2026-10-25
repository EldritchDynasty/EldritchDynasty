import type { Choice, EventTemplate, Filter, Person, PoolSpec, SceneSite } from '@ed/schema';
import type { SimCtx } from '../world.js';
import { knowsAffinity } from '../people/library.js';
import { resolvePresence } from '../presence.js';
import { castIn, type SlotFill } from './fill.js';

/** A learned check whose named practitioner acts at one explicit authored site. */
export interface PracticeScope {
  affinity: string;
  slots: string[];
  site: SceneSite;
}

/** Knowledge required by every branch, rather than a background possibility. */
function requiredKnowledge(filter: Filter): string[] {
  if ('knows' in filter) return [filter.knows.affinity];
  if ('all' in filter) return filter.all.flatMap(requiredKnowledge);
  if ('any' in filter) {
    const branches = filter.any.map(requiredKnowledge);
    return (branches[0] ?? []).filter(a => branches.every(b => b.includes(a)));
  }
  return [];
}

function slotKnowledge(event: EventTemplate, slot: string): string[] {
  return event.slots[slot]?.filters?.flatMap(requiredKnowledge) ?? [];
}

/** Do not infer a visit from knowledge. Every checked outcome must name the same site. */
export function practiceScope(event: EventTemplate, pool: PoolSpec): PracticeScope | undefined {
  if (event.interaction.kind !== 'choice' || (pool.kind !== 'family_knows' && pool.kind !== 'slot')) return undefined;
  const affinity = pool.kind === 'family_knows' ? pool.affinity : slotKnowledge(event, pool.slot)[0];
  if (!affinity) return undefined;
  const slots = pool.kind === 'slot' ? [pool.slot]
    : Object.keys(event.slots).filter(slot => slotKnowledge(event, slot).includes(affinity));
  if (!slots.length) return undefined;
  const checks = event.checks.filter(c => c.pool === pool).map(c => c.id);
  const choices = event.interaction.choices.filter(c => c.check && checks.includes(c.check));
  const outcomes = choices.flatMap(c => c.outcomes);
  const site = outcomes[0]?.site;
  if (!site || outcomes.some(o => !o.site || JSON.stringify(o.site) !== JSON.stringify(site))) return undefined;
  return { affinity, slots, site };
}

/** No draws or cached attendance: a stale cast asks the real place again. */
function canPractiseHere(ctx: SimCtx, p: Person, scope: PracticeScope, fill: SlotFill): boolean {
  return knowsAffinity(ctx, p, scope.affinity)
    && (p.fieldRecoveryUntil ?? -Infinity) <= ctx.world.year
    && resolvePresence(ctx, scope.site, fill).people.includes(p.id);
}

function presentPractitioners(ctx: SimCtx, scope: PracticeScope, fill: SlotFill): Person[] {
  return scope.slots.flatMap(slot => castIn(fill, slot)).flatMap(id => {
    const p = ctx.world.people.get(id);
    return p && canPractiseHere(ctx, p, scope, fill) ? [p] : [];
  });
}

/** Filter before bestBy: a stronger absent reader cannot displace a present one. */
export function practicalCandidate(event: EventTemplate, slot: string, ctx: SimCtx, fill: SlotFill, p: Person): boolean {
  if (!slotKnowledge(event, slot).length || !event.checks?.length) return true;
  const scopes = event.checks.flatMap(check => {
    const scope = practiceScope(event, check.pool);
    return scope?.slots.includes(slot) ? [scope] : [];
  });
  return !scopes.length || scopes.some(scope => canPractiseHere(ctx, p, scope, { ...fill, [slot]: p.id }));
}

/** Keep the authored unlearned attempt; do not call a known but absent reader unlearned. */
export function missingPracticalReader(choice: Choice, event: EventTemplate, ctx: SimCtx, fill: SlotFill): string | undefined {
  if (!choice.check) return undefined;
  const check = event.checks?.find(c => c.id === choice.check);
  if (!check) return undefined;
  const scope = practiceScope(event, check.pool);
  if (!scope || presentPractitioners(ctx, scope, fill).length) return undefined;
  if (check.pool.kind === 'family_knows' && !ctx.world.people.household(ctx.world.playerHouse, ctx.world.year)
    .some(p => knowsAffinity(ctx, p, scope.affinity))) return undefined;
  return scope.affinity;
}
