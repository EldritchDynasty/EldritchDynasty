import type { Effect, RecordBlock } from '@ed/schema';
import { assertNever } from '@ed/schema';
import type { SimCtx } from './world.js';
import type { PendingRecord, RecordOption } from './events/decisions.js';
import { msg } from './messages.js';

/**
 * WHAT EACH WAY OF WRITING IT COSTS (#1867 §5).
 *
 * The advisers already voice the pull of each Record option. Nothing said
 * what it costs, so the Record docket offered three lines of prose and a
 * temptation with the price hidden. These are the rules, stated once:
 *
 * - **Written as it happened** stands as a page the house can later lean on.
 * - **Left out** is a dated blank. It claims nothing the house could ever
 *   show, and the blanks are read at the reckoning with everything else.
 * - **Improved** reads better and carries the contradiction the block
 *   authors: something that can be proven against the house later.
 *
 * Plus whatever the option's own effects move that a player can see: Respect
 * and the treasury. A reading of the authored block and the rules, never a
 * prediction — no check is rolled and no later proof is guessed at.
 */
export type RecordStakes = Partial<Record<RecordOption, string>>;

export function recordStakes(ctx: SimCtx, decision: PendingRecord): RecordStakes {
  const block = decision.event.record;
  if (!block) return {};
  const stakes: RecordStakes = {};
  for (const { option } of decision.options) {
    const rule = ruleOf(ctx, option, block);
    const moved = movedBy(ctx, block.options[option].effects);
    stakes[option] = moved ? `${rule} ${moved}` : rule;
  }
  return stakes;
}

function ruleOf(ctx: SimCtx, kind: RecordOption, block: RecordBlock): string {
  switch (kind) {
    case 'record':
      return block.options.record.grantsKnowledge
        ? msg(ctx, 'record.stakes.record_knowledge',
          'The page stands as it happened, and the house keeps what it learned.')
        : msg(ctx, 'record.stakes.record', 'The page stands as it happened, for the house to lean on later.');
    case 'omit':
      return block.options.omit.effects.some((e) => e.kind === 'discrepancy' && e.op === 'create')
        ? msg(ctx, 'record.stakes.omit_discrepancy',
          'The year is left blank, and the gap is itself a contradiction someone could prove.')
        : msg(ctx, 'record.stakes.omit',
          'The year is left blank. It claims nothing the house could show, and the blanks are read at the reckoning.');
    case 'embellish': {
      const severity = block.options.embellish.discrepancy.severity;
      switch (severity) {
        case 'minor':
          return msg(ctx, 'record.stakes.embellish_minor',
            'The page reads better, and carries a small contradiction someone could prove.');
        case 'major':
          return msg(ctx, 'record.stakes.embellish_major',
            'The page reads better, and carries a serious contradiction someone could prove.');
        case 'total':
          return msg(ctx, 'record.stakes.embellish_total',
            'The page reads better, and carries a contradiction that would undo the whole account if proven.');
        default:
          return assertNever(severity, 'discrepancy severity');
      }
    }
    default:
      return assertNever(kind, 'record option');
  }
}

/** What the option's own effects move that the player can already see. */
function movedBy(ctx: SimCtx, effects: readonly Effect[]): string | undefined {
  let respect = 0;
  let treasury = 0;
  for (const e of effects) {
    if (e.kind === 'respect') respect += e.delta;
    if (e.kind === 'treasury') treasury += e.delta;
  }
  const parts: string[] = [];
  if (respect > 0) parts.push(msg(ctx, 'record.stakes.respect_up', 'Respect +{N}.', { N: String(respect) }));
  if (respect < 0) parts.push(msg(ctx, 'record.stakes.respect_down', 'Respect −{N}.', { N: String(-respect) }));
  if (treasury > 0) parts.push(msg(ctx, 'record.stakes.treasury_up', '+{N} crowns.', { N: String(treasury) }));
  if (treasury < 0) parts.push(msg(ctx, 'record.stakes.treasury_down', '−{N} crowns.', { N: String(-treasury) }));
  return parts.length ? parts.join(' ') : undefined;
}
