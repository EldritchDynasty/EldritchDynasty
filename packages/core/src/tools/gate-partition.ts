import {
  MessageChannel,
  Worker,
  receiveMessageOnPort,
  type MessagePort,
} from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

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


export interface GatePartitionWorkerCall {
  /** TypeScript module exporting the raw partition function. Usually import.meta.url. */
  moduleUrl: string;
  /** Export taking (...argsBefore, partition, ...argsAfter). It must return raw observations. */
  exportName: string;
  argsBefore?: readonly unknown[];
  argsAfter?: readonly unknown[];
}

interface WorkerSuccess<T> {
  ok: true;
  value: GatePartitionResult<T>;
}

interface WorkerFailure {
  ok: false;
  error: {
    name: string;
    message: string;
    stack?: string;
  };
}

type WorkerMessage<T> = WorkerSuccess<T> | WorkerFailure;

interface WorkerHandle<T> {
  worker: Worker;
  receive: MessagePort;
  signal: Int32Array;
  partitionId: number;
}

/**
 * The worker is deliberately plain JavaScript. It registers tsx inside the
 * isolated thread, then imports the gate module named by the caller. This
 * works the same on Windows and Linux and does not depend on shell quoting,
 * executable suffixes, or a platform-specific process launcher.
 */
const WORKER_SOURCE = String.raw`
const { workerData } = require('node:worker_threads');

(async () => {
  const signal = new Int32Array(workerData.signal);
  let message;
  try {
    // An eval worker can inherit the parent's argv. Make imported gate modules
    // unambiguously libraries so their "isMain" CLI blocks cannot fire here.
    process.argv[1] = '[eldritch-gate-worker]';

    const { tsImport } = await import('tsx/esm/api');
    const loaded = await tsImport(workerData.moduleUrl, {
      parentURL: workerData.parentURL,
      tsconfig: workerData.tsconfig,
    });
    const fn = loaded[workerData.exportName];
    if (typeof fn !== 'function') {
      throw new Error(
        'gate worker export ' + workerData.exportName + ' is not a function in ' + workerData.moduleUrl,
      );
    }

    const value = await fn(...workerData.args);
    message = { ok: true, value };
  } catch (error) {
    message = {
      ok: false,
      error: {
        name: error && error.name ? String(error.name) : 'Error',
        message: error && error.message ? String(error.message) : String(error),
        ...(error && error.stack ? { stack: String(error.stack) } : {}),
      },
    };
  }

  try {
    workerData.port.postMessage(message);
  } finally {
    Atomics.store(signal, 0, 1);
    Atomics.notify(signal, 0);
  }
})();
`;

const workerTsconfig = fileURLToPath(new URL('../../../../tsconfig.base.json', import.meta.url));

/**
 * Run every partition concurrently while preserving the existing synchronous
 * gate API.
 *
 * The main thread waits on one SharedArrayBuffer flag per worker, then reads
 * exactly one raw result from its MessagePort. Workers never return pass/fail
 * verdicts: the caller must feed these observations to reduceGatePartitions
 * and the gate's existing aggregate judgement.
 */
export function runGatePartitionsInWorkers<TInput, TOutput>(
  plan: readonly GatePartition<TInput>[],
  call: GatePartitionWorkerCall,
): GatePartitionResult<TOutput>[] {
  if (plan.length === 0) return [];

  const handles: WorkerHandle<TOutput>[] = plan.map((partition) => {
    const { port1, port2 } = new MessageChannel();
    const shared = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
    const signal = new Int32Array(shared);
    const args = [
      ...(call.argsBefore ?? []),
      partition,
      ...(call.argsAfter ?? []),
    ];

    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: {
        signal: shared,
        port: port2,
        moduleUrl: call.moduleUrl,
        exportName: call.exportName,
        args,
        parentURL: import.meta.url,
        tsconfig: workerTsconfig,
      },
      transferList: [port2],
    });

    return { worker, receive: port1, signal, partitionId: partition.id };
  });

  try {
    return handles.map(({ receive, signal, partitionId }) => {
      while (Atomics.load(signal, 0) === 0) {
        Atomics.wait(signal, 0, 0);
      }

      const envelope = receiveMessageOnPort(receive)?.message as WorkerMessage<TOutput> | undefined;
      if (!envelope) {
        throw new Error(`gate worker ${partitionId} signalled completion without returning evidence`);
      }
      if (!envelope.ok) {
        const detail = envelope.error.stack ?? `${envelope.error.name}: ${envelope.error.message}`;
        throw new Error(`gate worker ${partitionId} failed: ${detail}`);
      }
      if (envelope.value.id !== partitionId) {
        throw new Error(
          `gate worker ${partitionId} returned evidence for partition ${envelope.value.id}`,
        );
      }
      return envelope.value;
    });
  } finally {
    for (const { worker, receive } of handles) {
      receive.close();
      void worker.terminate();
    }
  }
}

/**
 * Worker-count configuration shared by blood and war. Four is the measured
 * experiment ceiling from #440; callers can lower it for diagnosis without
 * changing the canonical batch or its statistical claim.
 */
export function gatePartitionWorkerCount(
  raw: string | undefined = process.env.ED_GATE_WORKERS,
): number {
  if (raw === undefined || raw === '') return MAX_PARTITION_WORKERS;
  const workers = Number(raw);
  if (!Number.isInteger(workers) || workers < 1 || workers > MAX_PARTITION_WORKERS) {
    throw new Error(`ED_GATE_WORKERS must be an integer from 1 to ${MAX_PARTITION_WORKERS}`);
  }
  return workers;
}
