import { CAMPAIGNS, CAMPAIGN_YEARS } from '../campaign.js';

/**
 * The merge-blocking gate ids, in canonical order.
 *
 * This is the one lightweight source of truth for gate identity. The runner's
 * implementation table, #441's fingerprint entry table, and the proof-visible
 * execution configuration are all keyed by it, so adding or removing a
 * blocking gate cannot leave trusted proof reuse silently out of step with CI.
 */
export const BLOCKING_GATE_IDS = [
  'clauses',
  'library-neutrality',
  'outcome-reach-blocking',
  'short-line',
  'ladder',
  'ladder-scales',
  'purposes',
  'vocabulary-reach',
  'bottleneck',
  'land',
  'slot-fillability',
  'post-fillability',
] as const;

export type BlockingGateId = (typeof BLOCKING_GATE_IDS)[number];

export function isBlockingGateId(value: string): value is BlockingGateId {
  return (BLOCKING_GATE_IDS as readonly string[]).includes(value);
}

/** Shared deterministic played-batch sequence. */
export const GATE_BATCH_SEED_START = 5000;
export const GATE_BATCH_SEED_STEP = 7;

const CLAUSE_SEEDS = [
  1001, 1003, 1004, 1008, 1013, 1016, 1019, 1020, 1024, 1025, 1026, 1031,
] as const;
const LIBRARY_NEUTRALITY_SEEDS = [811, 912, 1013, 1114] as const;
const LADDER_SEEDS = [4000, 4013, 4026, 4039, 4052, 4065] as const;
const LADDER_POLICIES = ['climb', 'spare', 'scion', 'pair', 'pair_climb'] as const;
const LAND_SEEDS = [
  61101, 61707, 61808, 61909, 62010, 62212, 62313, 62414, 62515, 62616,
  62818, 62919, 63020, 63121, 63222, 63323, 63424, 63525, 63727, 64232,
  64434, 64939, 65040, 65545, 65646, 65747, 66050, 66353, 66454, 66555,
  66656, 66757, 66959, 67161, 67262, 67363, 67464, 67767, 68070, 68171,
  70001, 70018, 70069, 70086, 70120, 70137, 70171, 70188, 70205, 70239,
  70256, 70307, 70324, 70341, 70358, 70375, 70392, 70409, 70460, 70528,
  70545, 70579, 70613, 70630, 70647, 70664, 70698, 70766, 70800, 70817,
  70834, 70851, 70868, 70885, 70936, 70953, 70970, 70987, 71021, 71055,
  71072, 71089, 71106, 71123, 71140, 71157, 71174, 71191, 71208, 71225,
] as const;

/**
 * Human-auditable merge-gate execution configuration.
 *
 * Gate implementations consume these same values as their defaults. A changed
 * run count, seed set/sequence, pairing, campaign span, bid, policy matrix, or
 * sampling cadence therefore changes the proof manifest and invalidates reuse.
 */
export const BLOCKING_GATE_CONFIG = {
  clauses: {
    kind: 'explicit-seeds',
    seeds: CLAUSE_SEEDS,
    years: CAMPAIGN_YEARS,
    floor: 6,
  },
  'library-neutrality': {
    kind: 'paired-explicit-seeds',
    seeds: LIBRARY_NEUTRALITY_SEEDS,
    pairs: LIBRARY_NEUTRALITY_SEEDS.length,
    campaign: 'short',
    decider: 'chronicler',
    years: CAMPAIGNS.short.years,
    advanceYears: CAMPAIGNS.short.years + 1,
    fixedLibrarySeed: 9090,
  },
  'outcome-reach-blocking': {
    kind: 'seed-sequence',
    runs: 800,
    seedStart: GATE_BATCH_SEED_START,
    seedStep: GATE_BATCH_SEED_STEP,
    years: CAMPAIGN_YEARS,
  },
  'short-line': {
    kind: 'seed-sequence',
    runs: 100,
    seedStart: 6600,
    seedStep: 1,
    campaign: 'short',
    decider: 'chronicler',
    years: CAMPAIGNS.short.years,
  },
  ladder: {
    kind: 'policy-matrix',
    seeds: LADDER_SEEDS,
    years: CAMPAIGN_YEARS,
    bid: 600,
    policies: LADDER_POLICIES,
  },
  'ladder-scales': {
    kind: 'seed-sequence',
    runs: 32,
    seedStart: GATE_BATCH_SEED_START,
    seedStep: GATE_BATCH_SEED_STEP,
    years: CAMPAIGN_YEARS,
    sampleEveryYears: 25,
  },
  purposes: { kind: 'deterministic' },
  'vocabulary-reach': { kind: 'deterministic' },
  bottleneck: {
    kind: 'seed-sequence',
    runs: 24,
    seedStart: 1000,
    seedStep: 13,
    years: CAMPAIGN_YEARS,
  },
  land: {
    kind: 'explicit-seeds',
    seeds: LAND_SEEDS,
    runs: LAND_SEEDS.length,
    years: CAMPAIGN_YEARS,
  },
  'slot-fillability': { kind: 'deterministic' },
  'post-fillability': { kind: 'deterministic' },
} as const satisfies Record<BlockingGateId, Record<string, unknown>>;

/**
 * Repository inputs read imperatively rather than through the TypeScript import
 * graph. Runtime tracing verifies this list fail-safe; this table makes the
 * known reads part of the fingerprint instead of permanently disabling reuse.
 */
export const BLOCKING_GATE_EXTRA_INPUTS = {
  clauses: [],
  'library-neutrality': [],
  'outcome-reach-blocking': ['tools/outcome-witnesses.json'],
  'short-line': [],
  ladder: [],
  'ladder-scales': [],
  purposes: [],
  'vocabulary-reach': [],
  bottleneck: [],
  land: [],
  'slot-fillability': [],
  'post-fillability': [],
} as const satisfies Record<BlockingGateId, readonly string[]>;

export type BlockingGateConfiguration = (typeof BLOCKING_GATE_CONFIG)[BlockingGateId];
