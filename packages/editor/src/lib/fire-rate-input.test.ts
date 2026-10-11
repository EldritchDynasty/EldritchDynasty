import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fireRateInputError } from './fire-rate-input';

describe('editor fire-rate evidence inputs (#1311)', () => {
  it('accepts valid whole-number run/year bounds', () => {
    expect(fireRateInputError(1, 10, 500)).toBeNull();
    expect(fireRateInputError(800, 500, 500)).toBeNull();
    expect(fireRateInputError(15, 300, 500)).toBeNull();
  });

  it('rejects empty, non-finite, zero, fractional and out-of-range run counts', () => {
    for (const runs of [0, -1, 0.5, 1.5, 801, NaN, Infinity, -Infinity]) {
      expect(fireRateInputError(runs, 300, 500), String(runs)).toContain('Runs');
    }
  });

  it('rejects years outside the campaign and invalid/partial number input', () => {
    for (const years of [0, -1, 9, 10.5, 501, NaN, Infinity]) {
      expect(fireRateInputError(10, years, 500), String(years)).toContain('Years');
    }
  });

  it('wires the real Instruments view to reject invalid runs before invoking gate 4', () => {
    const source = readFileSync(join(import.meta.dirname, '../components/Instruments.vue'), 'utf8');
    expect(source).toContain('fireRateInputError(runs.value, years.value, CAMPAIGN_YEARS)');
    expect(source).toContain('if (running.value || fireRateError.value) return;');
    expect(source).toContain(':disabled="running || !!fireRateError"');
    expect(source).toContain('watch([runs, years], () => { fireRate.value = undefined; });');
  });
});
