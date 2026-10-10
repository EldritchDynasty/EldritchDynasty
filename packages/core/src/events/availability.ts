import type { Choice, EventTemplate } from '@ed/schema';
import { compare } from '@ed/schema';
import type { SimCtx } from '../world.js';
import { influencedAttr } from './influence.js';
import { soleCast, type SlotFill } from './slots.js';
import { msg } from '../messages.js';
import { proseForContentField } from '../prose.js';

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
  for (const req of c.requires) {
    const p = ctx.world.people.get(soleCast(fill, req.slot) ?? '');
    if (!p) {
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

function attributeName(ctx: SimCtx, id: string): string {
  const def = ctx.content.attributes.find((a) => String(a.id) === id);
  return def ? proseForContentField(ctx, 'attributes', String(def.id), 'name', def.name) : id;
}
