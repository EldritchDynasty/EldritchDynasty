import { z } from 'zod';
import { RiteS } from './rung.js';
import { RESPECT_ORDER } from './conditions.js';
import type { Effect, EventTemplate, Outcome } from './event.js';
import { assertNever } from './exhaustive.js';

/** Physical attendance, never inferred from ownership or a prose token. */
export const SceneSiteS = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('hall'), hall: z.union([z.literal('main'), z.object({ slot: z.string() }).strict()]), visitors: z.array(z.string()).optional() }).strict(),
  z.object({ kind: z.literal('party'), slots: z.array(z.string()).min(1) }).strict(),
  z.object({ kind: z.literal('muster') }).strict(),
  z.object({ kind: z.literal('elsewhere'), slots: z.array(z.string()) }).strict(),
  /** One held parcel (#1873). Attendance is the named party; ownership alone puts nobody there. */
  z.object({ kind: z.literal('parcel'), parcel: z.string(), slots: z.array(z.string()) }).strict(),
]);
export type SceneSite = z.infer<typeof SceneSiteS>;

/** A price applies to ONE effect, never to its whole bundle. */
export const AgreedPriceS = z.object({
  effect: z.number().int().nonnegative(),
  reason: z.enum(['purchase', 'tribute', 'contract', 'gift', 'sacrifice']),
  rite: RiteS.optional(),
}).strict();
export type AgreedPrice = z.infer<typeof AgreedPriceS>;

export const HarmCategoryS = z.enum(['life', 'liberty', 'financial', 'estate', 'inheritance', 'political']);
export type HarmCategory = z.infer<typeof HarmCategoryS>;

export const HarmAssessmentS = z.object({
  categories: z.array(HarmCategoryS), deaths: z.array(z.string()), missing: z.array(z.string()),
  cashLoss: z.number(), estateLoss: z.number(), estateShare: z.number(), seatLost: z.array(z.string()),
  titlesLost: z.array(z.string()), knowledgeLost: z.array(z.string()), regaliaLost: z.array(z.string()), respectDrop: z.number(),
});
export type HarmAssessment = z.infer<typeof HarmAssessmentS>;

/** Private gameplay evidence survives omission/embellishment of the public page. */
export const PrimordialRecordS = z.object({
  occurrence: z.string(), page: z.string(), actor: z.string(), actorName: z.string(),
  site: SceneSiteS, hall: z.string().optional(), normalOutcome: z.string(), finalOutcome: z.string(),
  normal: HarmAssessmentS, committed: HarmAssessmentS, manifestation: z.string(), receipt: z.string(),
});
export type PrimordialRecord = z.infer<typeof PrimordialRecordS>;

/** §12: emergency manifestation is involuntary and never certain per actor. */
export function primordialChance(ep: number): number {
  return Number.isFinite(ep) ? Math.min(0.9, Math.max(0, ep) / 100) : 0;
}

/**
 * Every Effect has an explicit policy. Annual mortality/attrition and rites'
 * intrinsic prices are outside the authored-outcome contract. Settle/withdraw
 * return the survivors; neither destroys a quarter of a force. Injuries have
 * no typed effect yet and cannot be inferred from an attribute penalty.
 */
export function effectHarmPolicy(e: Effect): HarmCategory | undefined {
  switch (e.kind) {
    case 'status': return e.status === 'dead' ? 'life' : e.status === 'missing' ? 'liberty' : undefined;
    case 'treasury': return e.delta < 0 ? 'financial' : undefined;
    case 'respect': return e.delta < 0 ? 'political' : undefined;
    case 'land': return e.op === 'seize' || e.op === 'damage' ? 'estate' : undefined;
    case 'spellbook': return e.op === 'lose' || e.op === 'remove_copy' || e.op === 'degrade' ? 'inheritance' : undefined;
    case 'discrepancy': return e.op === 'prove' ? 'political' : undefined;
    case 'heirloom': return e.op === 'transfer' ? 'inheritance' : undefined;
    case 'attribute': case 'trait': case 'madness': case 'awakening':
    case 'career': case 'bond': case 'marriage': case 'priorityMatch':
    case 'flag': case 'relationship': case 'chronicle': case 'knowledge':
    case 'rumour': case 'clause': case 'branch':
    case 'recast': case 'rite': case 'schedule': case 'arc': case 'arc_flag':
    case 'forge_lineage': case 'tutor': case 'muster': return undefined;
    default: return assertNever(e, 'primordial harm policy');
  }
}

/** Conservative authoring audit, including a small shock causing first debt. */
export function potentialHarms(o: Pick<Outcome, 'effects' | 'agreedPrices'>): HarmCategory[] {
  const prices = new Set(o.agreedPrices?.map(p => p.effect));
  const harms = new Set<HarmCategory>();
  let cash = 0;
  const standing = RESPECT_ORDER.map((_, index) => index);
  for (const [i, e] of o.effects.entries()) {
    if (prices.has(i)) continue;
    if (e.kind === 'treasury') { cash += e.delta; continue; }
    if (e.kind === 'respect' || (e.kind === 'discrepancy' && e.op === 'prove')) {
      const delta = e.kind === 'respect' ? e.delta : -1;
      for (let j = 0; j < standing.length; j++) standing[j] = Math.max(0, Math.min(standing.length - 1, standing[j]! + delta));
      continue;
    }
    const policy = effectHarmPolicy(e);
    if (policy) harms.add(policy);
  }
  if (cash < 0) harms.add('financial');
  if (standing.some((after, before) => before - after >= 2)) harms.add('political');
  return [...harms];
}

/** Audit ordinary effects too, so a forgotten response/tag cannot hide harm. */
export function primordialInventory(events: readonly EventTemplate[]) {
  return events.flatMap(event => {
    const groups = event.interaction.kind === 'narration'
      ? [{ id: '', outcomes: event.interaction.outcomes }] : event.interaction.choices;
    return groups.flatMap(choice => choice.outcomes.flatMap(outcome => {
      const candidates = potentialHarms({ effects: outcome.effects });
      if (!candidates.length) return [];
      return [{
        path: `${event.id}/${choice.id || '_'}/${outcome.id}`,
        candidates,
        harms: potentialHarms(outcome),
        site: outcome.site ?? event.site ?? null,
        agreedPrices: outcome.agreedPrices ?? [],
        response: outcome.primordial?.id ?? null,
        normalWitness: `packages/core/src/events/reach.test.ts: ${event.id}|${choice.id}|${outcome.id}`,
        assessmentWitness: outcome.primordial ? `packages/core/src/events/primordial-catalogue.test.ts: ${event.id}/${choice.id || '_'}/${outcome.id}: assessed material reduction` : null,
      }];
    }));
  }).sort((a, b) => a.path.localeCompare(b.path));
}
