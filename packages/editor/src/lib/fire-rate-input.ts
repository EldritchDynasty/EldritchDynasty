/**
 * The editor must never report gate 4 as green without a non-empty batch.
 * Native number-input min/max/step are UI hints; v-model.number can still
 * hold 0, a fraction, or NaN when an author types or clears a field.
 */
export function fireRateInputError(runs: number, years: number, maxYears: number): string | null {
  if (!Number.isSafeInteger(runs) || runs < 1 || runs > 800) {
    return 'Runs must be a whole number from 1 to 800.';
  }
  if (!Number.isSafeInteger(years) || years < 10 || years > maxYears) {
    return `Years must be a whole number from 10 to ${maxYears}.`;
  }
  return null;
}
