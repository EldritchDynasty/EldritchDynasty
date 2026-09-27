import { categoryOf, type Choice, type ChoiceCategory } from '@ed/schema';
import type { SimCtx } from '../world.js';
import { mustSurface } from '../delegation.js';
import type { PendingChoice } from '../events/decisions.js';

/**
 * HOW A CHOICE FEELS, WITHOUT ITS NAME (issue #271).
 *
 * #266's exact effect signature answers a stricter question: whether two
 * authored branches are mechanically identical all the way down to values,
 * outcome odds and callbacks. Repetition needs a coarser reading. A player
 * recognises "money or money plus a lasting change" even when the pounds,
 * prose, event id and purpose metadata differ.
 */
export type ShapeGrain = 'kind' | 'category';

/**
 * categoryOf cannot decide whether a memory write is eligibility or write-only
 * without the whole indexed bundle. Runtime shape measurement is deliberately
 * pure over a pending decision, so memory remains neutral here instead of
 * pretending to know a fact only the static audit can know.
 */
export type RuntimeChoiceCategory = ChoiceCategory | 'memory';

const CATEGORY_LABEL: Record<RuntimeChoiceCategory, string> = {
  persistent: 'lasting',
  people: 'people',
  relationship: 'relationship',
  record: 'record',
  resources: 'money',
  eligibility: 'eligibility',
  callback: 'callback',
  write_only: 'write-only',
  self_expression: 'self-expression',
  memory: 'memory',
};

function authoredAvailableChoices(d: PendingChoice): Choice[] {
  if (d.event.interaction.kind === 'narration') return [];
  const authored = new Map(d.event.interaction.choices.map((choice) => [choice.id, choice]));
  return d.choices.flatMap((shown) => {
    if (!shown.available) return [];
    const choice = authored.get(shown.id);
    return choice ? [choice] : [];
  });
}

/**
 * One option reduced to the set of things any of its outcomes can do.
 *
 * Outcome weights and magnitudes intentionally disappear at this grain; #266's
 * effectSignature remains the exact instrument for those. Duplicated kinds
 * disappear too: two treasury deltas still present as "money".
 */
function optionShape(choice: Choice, grain: ShapeGrain): string {
  const tokens = new Set<string>();
  for (const outcome of choice.outcomes) {
    for (const effect of outcome.effects) {
      if (grain === 'kind') tokens.add(effect.kind);
      else tokens.add(CATEGORY_LABEL[categoryOf(effect.kind)]);
    }
  }
  return [...tokens].sort().join('+') || 'none';
}

/**
 * A deterministic, readable key for the options the player can actually take.
 *
 * Sorting the option projections makes authored option order irrelevant while
 * retaining multiplicity: [money | money] is not [money].
 */
export function shapeOf(d: PendingChoice, grain: ShapeGrain): string {
  const options = authoredAvailableChoices(d).map((choice) => optionShape(choice, grain)).sort();
  return `[${options.join(' | ')}]`;
}

/**
 * A presentation whose answer is already effectively settled for this
 * instrument: one available branch; every available branch has the same
 * effect-kind shape; or #219's interruption guard proves the decision routine.
 */
export function isPredetermined(ctx: SimCtx, d: PendingChoice): boolean {
  const choices = authoredAvailableChoices(d);
  if (choices.length <= 1) return true;
  if (new Set(choices.map((choice) => optionShape(choice, 'kind'))).size === 1) return true;
  return mustSurface(ctx, d) === undefined;
}
