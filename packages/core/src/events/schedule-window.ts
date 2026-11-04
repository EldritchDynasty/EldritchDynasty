import { assertNever, type Condition } from '@ed/schema';

/**
 * The earliest calendar year a condition could possibly hold.
 *
 * This is a necessary bound, not a substitute for evalCondition: an all
 * must pass every time gate; an any can pass whichever alternative opens
 * first, but has no shared floor when any arm has no proven floor. All other
 * conditions (including negation) remain the selection engine's business.
 *
 * A forced follow-up with a promised date decades out must not use up its
 * 40-year patience while that date is still in the future (#2627).
 */
export function earliestCalendarYear(condition: Condition | undefined): number | undefined {
  if (!condition) return undefined;

  if ('all' in condition) {
    let floor: number | undefined;
    for (const part of condition.all) {
      const next = earliestCalendarYear(part);
      if (next !== undefined) floor = floor === undefined ? next : Math.max(floor, next);
    }
    return floor;
  }

  if ('any' in condition) {
    if (!condition.any.length) return undefined;
    let floor = Infinity;
    for (const part of condition.any) {
      const next = earliestCalendarYear(part);
      if (next === undefined) return undefined;
      floor = Math.min(floor, next);
    }
    return floor;
  }

  if ('year' in condition) {
    const { op, value } = condition.year;
    switch (op) {
      case 'gte': return Math.ceil(value);
      case 'gt': return Math.floor(value) + 1;
      case 'eq': return Number.isInteger(value) ? value : undefined;
      // Upper bounds and inequality do not establish a lower bound.
      case 'lt':
      case 'lte':
      case 'ne': return undefined;
      default: return assertNever(op, 'schedule calendar comparison');
    }
  }

  return undefined;
}
