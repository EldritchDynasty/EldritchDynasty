import { describe, expect, it } from 'vitest';
import { earliestCalendarYear } from './schedule-window.js';

describe('the earliest year a scheduled promise can become eligible', () => {
  it('extracts inclusive, exclusive and exact calendar lower bounds', () => {
    expect(earliestCalendarYear({ year: { op: 'gte', value: 1291 } })).toBe(1291);
    expect(earliestCalendarYear({ year: { op: 'gt', value: 1290 } })).toBe(1291);
    expect(earliestCalendarYear({ year: { op: 'gte', value: 1290.5 } })).toBe(1291);
    expect(earliestCalendarYear({ year: { op: 'eq', value: 1330 } })).toBe(1330);
    expect(earliestCalendarYear({ year: { op: 'eq', value: 1330.5 } })).toBeUndefined();
  });

  it('takes the latest required date through conjunctions, including nested ones', () => {
    expect(earliestCalendarYear({ all: [
      { knowledge: 'account_read', has: true },
      { year: { op: 'gte', value: 1291 } },
      { all: [{ year: { op: 'gt', value: 1329 } }, { flag: 'archive_open', is: true }] },
    ] })).toBe(1330);
  });

  it('only defers disjunctions when every possible route has a known floor', () => {
    expect(earliestCalendarYear({ any: [
      { year: { op: 'gte', value: 1330 } },
      { all: [{ year: { op: 'gte', value: 1291 } }, { flag: 'x' }] },
    ] })).toBe(1291);
    expect(earliestCalendarYear({ any: [
      { year: { op: 'gte', value: 1330 } },
      { flag: 'already_possible' },
    ] })).toBeUndefined();
  });

  it('never speculates from negations, upper bounds, or unrelated conditions', () => {
    expect(earliestCalendarYear({ not: { year: { op: 'lt', value: 1291 } } })).toBeUndefined();
    expect(earliestCalendarYear({ year: { op: 'lte', value: 1330 } })).toBeUndefined();
    expect(earliestCalendarYear({ year: { op: 'ne', value: 1291 } })).toBeUndefined();
    expect(earliestCalendarYear({ flag: 'x', is: true })).toBeUndefined();
    expect(earliestCalendarYear(undefined)).toBeUndefined();
  });
});
