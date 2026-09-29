/**
 * The engine-tick land routes, read off a year's report (issue #276).
 *
 * Kept apart from `land-gate.ts` for the same reason `blood-market.ts` is kept
 * apart from `blood-gate.ts`: that module plays whole campaigns, so a fast
 * suite importing it would be declared a batch driver in `lanes.test.ts`. This
 * one plays nothing, and its test can plant a report by hand.
 *
 * Blight and the Sarrow sink are engine-tick risks (`tickLandRisks`), never an
 * authored `land` effect, so the gate cannot find them by scanning content.
 * It used to find them by searching the chronicle for two English phrases,
 * which a reworded or translated sentence would have broken in silence.
 */
import type { LandRiskRoute } from '../land.js';
import type { YearReport } from '../year/report.js';

export function landRiskRoutes(report: Pick<YearReport, 'landRisks'>): LandRiskRoute[] {
  return [...new Set((report.landRisks?.struck ?? []).map((s) => s.route))];
}
