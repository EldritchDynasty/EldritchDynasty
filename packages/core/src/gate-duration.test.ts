import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  checkGateDuration,
  readGateDurations,
} from '../../../tools/gate-duration.mjs';

const REPO = join(import.meta.dirname, '../../..');

const config = {
  measured: '2026-09-28',
  maxFactor: 1.25,
  lanes: {
    batch: { seconds: 100, evidence: 'fixture' },
    war: { seconds: 50, evidence: 'fixture' },
  },
};

describe('gate duration guard', () => {
  it('accepts a measurement inside the stated factor', () => {
    expect(checkGateDuration('batch', 124, config).ok).toBe(true);
  });

  it('rejects a stale committed figure beyond the stated factor', () => {
    const result = checkGateDuration('batch', 126, config);
    expect(result.ok).toBe(false);
    expect(result.factor).toBeCloseTo(1.26);
    expect(result.limitSeconds).toBe(125);
  });

  it('fails closed when CI adds a lane with no committed duration', () => {
    expect(() => checkGateDuration('endings', 10, config)).toThrow(/no committed duration/);
  });

  it('rejects invalid elapsed time instead of treating it as fast', () => {
    expect(() => checkGateDuration('batch', Number.NaN, config)).toThrow(/invalid elapsed/);
  });

  it('covers every gate lane CI runs', () => {
    const workflow = readFileSync(join(REPO, '.github/workflows/check.yml'), 'utf8');
    const matrix = /^\s*lane:\s*\[([^\]]+)\]/m.exec(workflow);
    expect(matrix, 'check.yml no longer declares a gate lane matrix this rule can read').toBeTruthy();

    const ciLanes = matrix![1]!.split(',').map((lane) => lane.trim()).sort();
    const recorded = Object.keys(readGateDurations().lanes).sort();
    expect(recorded).toEqual(ciLanes);
  });
});
