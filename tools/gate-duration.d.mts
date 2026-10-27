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
  /** Measurements on other runner classes, keyed by logical CPU count (#1947). */
  byCpus?: Record<string, { seconds: number; evidence: string }>;
}

export interface GateDurationConfig {
  note?: string;
  measured: string;
  maxFactor: number;
  /** The runner class each lane's `seconds` was measured on. */
  cpus?: number;
  lanes: Record<string, GateDurationLane>;
}

/** `judged: false` means no baseline exists for this runner class. */
export type GateDurationResult =
  | {
    lane: string;
    seconds: number;
    cpus: number;
    judged: true;
    baselineSeconds: number;
    factor: number;
    maxFactor: number;
    limitSeconds: number;
    ok: boolean;
  }
  | {
    lane: string;
    seconds: number;
    cpus: number;
    judged: false;
    baselineSeconds: null;
    factor: null;
    maxFactor: number;
    limitSeconds: null;
    ok: true;
  };

export const GATE_DURATIONS_FILE: string;
export function readGateDurations(): GateDurationConfig;
export function baselineFor(
  spec: GateDurationLane,
  config: GateDurationConfig,
  cpus: number,
): number | undefined;
export function checkGateDuration(
  lane: string,
  seconds: number,
  config?: GateDurationConfig,
  cpus?: number,
): GateDurationResult;
