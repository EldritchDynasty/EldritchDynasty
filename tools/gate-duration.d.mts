/**
 * TYPES FOR `gate-duration.mjs`, BECAUSE A TEST IN `packages/` IMPORTS IT.
 *
 * Same reason, and the same `.d.mts` rule, as `shards.d.mts`: the strict
 * typecheck refuses an untyped `.mjs` import from `gate-duration.test.ts` as
 * an implicit `any`, and under `moduleResolution: Bundler` only a `.d.mts`
 * sibling is consulted. Thin on purpose — it describes what the test uses.
 */
export interface GateDurationLane {
  seconds: number;
  evidence: string;
}

export interface GateDurationConfig {
  note?: string;
  measured: string;
  maxFactor: number;
  lanes: Record<string, GateDurationLane>;
}

export interface GateDurationResult {
  lane: string;
  seconds: number;
  baselineSeconds: number;
  factor: number;
  maxFactor: number;
  limitSeconds: number;
  ok: boolean;
}

export const GATE_DURATIONS_FILE: string;
export function readGateDurations(): GateDurationConfig;
export function checkGateDuration(
  lane: string,
  seconds: number,
  config?: GateDurationConfig,
): GateDurationResult;
