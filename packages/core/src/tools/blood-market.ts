import type { LineRead } from '../people/match.js';

/**
 * The structured market signal behind the broker's sentence.
 *
 * Keep this separate from blood-gate.ts: the gate plays whole simulated
 * campaigns, while this scoring rule is pure and belongs in the fast lane.
 */
export interface BloodMarketSignal {
  line: LineRead;
  fontCarrierRate: number;
}

export function saidScore(signal: BloodMarketSignal): number {
  let n = 0;
  if (signal.fontCarrierRate >= 0.04) n += 4;
  else if (signal.fontCarrierRate > 0) n += 1;
  if (signal.line === 'fertile') n += 2;
  else if (signal.line === 'thin') n -= 2;
  return n;
}
