/**
 * Deterministic partition/reducer substrate for expensive gate batches (#440).
 *
 * Workers are allowed to compute partitions in any completion order. They are
 * not allowed to decide the gate: each returns raw observations tagged with
 * the canonical input index, and one reducer reconstructs the original batch
 * before the existing gate verdict runs.
 *
 * The plan is deliberately platform-neutral. Worker count is data, not a
 * process-global guess, so Windows/Linux and CI/local callers can exercise the
 * same partitioning logic.
 */

export interface GatePartitionItem<T> {
  index: number;
  input: T;
}

export interface GatePartition<T> {
  id: number;
  items: GatePartitionItem<T>[];
}

export interface GatePartitionObservation<T> {
  index: number;
  value: T;
}

export interface GatePartitionResult<T> {
  id: number;
  observations: GatePartitionObservation<T>[];
}

const MAX_PARTITION_WORKERS = 4;

/**
 * Split the canonical input list into up to four balanced contiguous
 * partitions. Contiguous slices make diagnostics readable; correctness does
 * not depend on partition completion order.
 */
export function partitionGateInputs<T>(
  inputs: readonly T[],
  requestedWorkers = MAX_PARTITION_WORKERS,
): GatePartition<T>[] {
  if (!Number.isInteger(requestedWorkers) || requestedWorkers < 1 || requestedWorkers > MAX_PARTITION_WORKERS) {
    throw new Error(`gate worker count must be an integer from 1 to ${MAX_PARTITION_WORKERS}`);
  }
  if (inputs.length === 0) return [];

  const workers = Math.min(requestedWorkers, inputs.length);
  const base = Math.floor(inputs.length / workers);
  const extra = inputs.length % workers;
  const partitions: GatePartition<T>[] = [];

  let start = 0;
  for (let id = 0; id < workers; id++) {
    const size = base + (id < extra ? 1 : 0);
    const items = inputs.slice(start, start + size).map((input, offset) => ({
      index: start + offset,
      input,
    }));
    partitions.push({ id, items });
    start += size;
  }

  return partitions;
}

/**
 * Reconstruct the canonical observation list and fail closed on any worker
 * omission, duplicate, unexpected index, or malformed partition id.
 */
export function reduceGatePartitions<TInput, TOutput>(
  plan: readonly GatePartition<TInput>[],
  results: readonly GatePartitionResult<TOutput>[],
): TOutput[] {
  if (results.length !== plan.length) {
    throw new Error(`gate partition result count mismatch: expected ${plan.length}, got ${results.length}`);
  }

  const expectedByPartition = new Map<number, Set<number>>();
  const total = plan.reduce((n, partition) => n + partition.items.length, 0);
  for (const partition of plan) {
    if (expectedByPartition.has(partition.id)) {
      throw new Error(`duplicate gate partition id in plan: ${partition.id}`);
    }
    expectedByPartition.set(partition.id, new Set(partition.items.map((item) => item.index)));
  }

  const output = new Array<TOutput>(total);
  const seenPartitions = new Set<number>();
  const seenIndexes = new Set<number>();

  for (const result of results) {
    if (seenPartitions.has(result.id)) {
      throw new Error(`duplicate gate partition result: ${result.id}`);
    }
    seenPartitions.add(result.id);

    const expected = expectedByPartition.get(result.id);
    if (!expected) throw new Error(`unexpected gate partition result: ${result.id}`);
    if (result.observations.length !== expected.size) {
      throw new Error(
        `gate partition ${result.id} observation count mismatch: expected ${expected.size}, got ${result.observations.length}`,
      );
    }

    for (const observation of result.observations) {
      if (!Number.isInteger(observation.index) || !expected.has(observation.index)) {
        throw new Error(`gate partition ${result.id} returned unexpected index ${observation.index}`);
      }
      if (seenIndexes.has(observation.index)) {
        throw new Error(`duplicate gate observation index: ${observation.index}`);
      }
      seenIndexes.add(observation.index);
      output[observation.index] = observation.value;
    }
  }

  if (seenPartitions.size !== plan.length || seenIndexes.size !== total) {
    throw new Error(
      `gate partition reduction incomplete: ${seenPartitions.size}/${plan.length} partitions, `
      + `${seenIndexes.size}/${total} observations`,
    );
  }

  return output;
}
