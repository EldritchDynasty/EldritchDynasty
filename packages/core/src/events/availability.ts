import type { Choice, EventTemplate } from '@ed/schema';
import { compare } from '@ed/schema';
import type { SimCtx } from '../world.js';
import { influencedAttr } from './influence.js';
import { soleCast, type SlotFill } from './slots.js';
import { msg } from '../messages.js';
import { proseForContentField } from '../prose.js';
import { missingPracticalReader } from './practice.js';
import { evalFilter } from './conditions.js';
import { householdDutyOrder, quoteDuty } from '../mystic.js';

/**
 * Lives here rather than in `decisions.ts` because `deciders.ts` needs it and
 * `decisions.ts` needs `deciders.ts`. A choice's availability is not a fact
 * about the docket; it is a fact about the event, and both the docket and the
 * decider ask it.
 */
export interface DecisionChoice {
  id: string;
  label: string;
  /**
   * Visibly unavailable choices are themselves information (concept §16), so
   * they are listed rather than filtered out, with the reason attached.
   */
  available: boolean;
  blockedBy?: string;
}

/**
 * `requires` reads attributes off the people already cast in the event, which
 * is why it is checked at ask time rather than at authoring time: the same
 * choice is open to one generation and closed to the next, and that difference
 * is the game.
 */
export function choiceAvailability(c: Choice, ctx: SimCtx, fill: SlotFill, event: EventTemplate): DecisionChoice {
  const absentReader = missingPracticalReader(c, event, ctx, fill);
  if (absentReader) return unavailableReader(c, ctx, absentReader);
  // A parked docket may outlive another order. Ask the same live quote as
  // the Table before committing a promise, never after printing its success.
  for (const effect of c.outcomes.flatMap(outcome => outcome.effects)) {
    if (effect.kind !== 'mystic_duty') continue;
    const slot = typeof effect.target === 'object' && 'slot' in effect.target ? effect.target.slot : undefined;
    const spec = slot === undefined ? undefined : event.slots[slot];
    const p = ctx.world.people.get(slot === undefined ? '' : soleCast(fill, slot) ?? '');
    if (!p || !spec || !spec.filters.every(filter => evalFilter(filter, p, ctx, fill, spec.role))
      || !quoteDuty(ctx, householdDutyOrder(ctx, p, effect.working)).ok) {
      return { id: c.id, label: c.label, available: false,
        blockedBy: msg(ctx, 'choice.blocked.duty', 'The reader or the promised work is no longer available.') };
    }
  }
  for (const req of c.requires) {
    const p = ctx.world.people.get(soleCast(fill, req.slot) ?? '');
    if (!p) {
      const knowledge = event.slots[req.slot]?.filters.find(filter => 'knows' in filter);
      if (knowledge && 'knows' in knowledge) return unavailableReader(c, ctx, knowledge.knows.affinity);
      return {
        id: c.id,
        label: c.label,
        available: false,
        blockedBy: msg(ctx, 'choice.blocked.uncast', 'nobody stands as {SLOT}', { SLOT: req.slot }),
      };
    }
    const role = event.slots[req.slot]?.role;
    const have = influencedAttr(ctx, p, req.attr, role);
    if (!compare(have, req.op, req.value)) {
      return {
        id: c.id,
        label: c.label,
        available: false,
        // The docket prints this under the closed choice. It named the
        // attribute by its content id ("strength") and was never switchable;
        // the attribute's display name is the one every other surface uses (#410).
        blockedBy: msg(ctx, 'choice.blocked.attribute', "{PERSON}'s {ATTRIBUTE} is {VALUE}", {
          PERSON: p.name,
          ATTRIBUTE: attributeName(ctx, req.attr),
          VALUE: String(Math.round(have)),
        }),
      };
    }
  }
  return { id: c.id, label: c.label, available: true };
}

function unavailableReader(c: Choice, ctx: SimCtx, affinity: string): DecisionChoice {
  return { id: c.id, label: c.label, available: false,
    blockedBy: msg(ctx, 'choice.blocked.reader', 'No eligible reader of {AFFINITY} is available.', {
      AFFINITY: attributeName(ctx, affinity),
    }) };
}

function attributeName(ctx: SimCtx, id: string): string {
  const def = ctx.content.attributes.find((a) => String(a.id) === id);
  return def ? proseForContentField(ctx, 'attributes', String(def.id), 'name', def.name) : id;
}
