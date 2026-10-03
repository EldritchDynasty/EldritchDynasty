import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO = join(import.meta.dirname, '../../../..');
const TOOL = join(REPO, 'tools/land-batch.mjs');

interface LandRequest {
  pr: number;
  requestedHead: string;
  requestedAt: string;
  sourceCommentId: number;
  noIssueCheck: boolean;
}

type StructuredFailure = { kind: 'step' | 'gate' | 'test'; name: string };

const batch = (await import(pathToFileURL(TOOL).href)) as {
  requestedHeadIsCurrent: (request: LandRequest, liveHead: string) => boolean;
  selectBatch: (requests: LandRequest[], ownRequest: LandRequest, max?: number) => LandRequest[];
  withoutMembers: (members: LandRequest[], removedPrs: Iterable<number>) => LandRequest[];
  nextPrefixRecovery: (
    members: LandRequest[],
    greenPrefixLength: number,
    lastProbeFailed?: boolean,
  ) => {
    done: boolean;
    probe: LandRequest[] | null;
    land: LandRequest[];
    bounce: LandRequest | null;
    requeue: LandRequest[];
  };
  failureKey: (failure: StructuredFailure) => string;
  shouldRetry: (
    failures: StructuredFailure[],
    retryable: Iterable<string>,
    alreadyRetried?: boolean,
  ) => boolean;
  staleRetryEntries: (retryable: Iterable<string>, knownChecks: Iterable<string>) => string[];
};

const request = (
  pr: number,
  requestedAt: string,
  requestedHead = `head-${pr}`,
  noIssueCheck = false,
  sourceCommentId = pr,
): LandRequest => ({ pr, requestedAt, requestedHead, noIssueCheck, sourceCommentId });

const prs = (requests: LandRequest[]) => requests.map((item) => item.pr);

describe('the #353 merge-train decision layer', () => {
  it('pins an immutable requested head', () => {
    const admitted = request(10, '2026-10-03T04:00:00Z', 'reviewed-sha');
    expect(batch.requestedHeadIsCurrent(admitted, 'reviewed-sha')).toBe(true);
    expect(batch.requestedHeadIsCurrent(admitted, 'later-unreviewed-sha')).toBe(false);
  });

  it('refuses to let an older run adopt a newer request generation for its own PR', () => {
    const A = request(10, '2026-10-03T04:00:00Z', 'head-a', false, 100);
    const B = request(10, '2026-10-03T04:01:00Z', 'head-b', true, 101);
    const neighbour = request(11, '2026-10-03T03:00:00Z');

    expect(batch.selectBatch([A, B, neighbour], A)).toEqual([]);
    expect(batch.selectBatch([A, B, neighbour], B)).toEqual([B, neighbour]);
  });

  it('puts its own request first, then the oldest neighbours, capped without waiting', () => {
    const queued = [
      request(12, '2026-10-03T04:03:00Z'),
      request(11, '2026-10-03T04:02:00Z'),
      request(10, '2026-10-03T04:05:00Z'),
      request(13, '2026-10-03T04:01:00Z'),
    ];

    expect(prs(batch.selectBatch(queued, queued[2]!))).toEqual([10, 13, 11]);
    expect(prs(batch.selectBatch(queued.slice(0, 2), queued[0]!))).toEqual([12, 11]);
    expect(batch.selectBatch(queued, request(99, '2026-10-03T04:06:00Z'))).toEqual([]);
  });

  it('keeps --no-issue-check authority attached to each request, never the batch leader', () => {
    const queued = [
      request(30, '2026-10-03T04:00:00Z', 'head-30', false),
      request(31, '2026-10-03T03:00:00Z', 'head-31', true),
      request(32, '2026-10-03T03:30:00Z', 'head-32', false),
    ];

    const selected = batch.selectBatch(queued, queued[0]!);
    expect(selected.map((item) => [item.pr, item.noIssueCheck])).toEqual([
      [30, false],
      [31, true],
      [32, false],
    ]);
  });

  it('uses only the newest request generation for each PR, including issue-check authority', () => {
    const queued = [
      request(20, '2026-10-03T04:00:00Z'),
      request(12, '2026-10-03T03:00:00Z'),
      request(11, '2026-10-03T02:00:00Z', 'old-head-11', false, 110),
      request(11, '2026-10-03T03:30:00Z', 'fresh-head-11', true, 111),
    ];

    const selected = batch.selectBatch(queued, queued[0]!);
    expect(prs(selected)).toEqual([20, 12, 11]);
    expect(selected[2]).toMatchObject({
      requestedHead: 'fresh-head-11',
      noIssueCheck: true,
      sourceCommentId: 111,
    });
    expect(selected).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ requestedHead: 'old-head-11' }),
    ]));
    expect(() => batch.selectBatch(queued, queued[0]!, 0)).toThrow(/positive integer/);
  });

  it('uses source comment order when request timestamps tie', () => {
    const queued = [
      request(20, '2026-10-03T04:00:00Z'),
      request(12, '2026-10-03T03:00:00Z', 'head-12', false, 120),
      request(11, '2026-10-03T03:00:00Z', 'head-11', false, 110),
      request(11, '2026-10-03T03:00:00Z', 'newer-head-11', true, 130),
    ];

    const selected = batch.selectBatch(queued, queued[0]!);
    expect(prs(selected)).toEqual([20, 12, 11]);
    expect(selected[2]).toMatchObject({
      requestedHead: 'newer-head-11',
      noIssueCheck: true,
      sourceCommentId: 130,
    });
  });

  it('drops an invalid or conflicting member without reordering its neighbours', () => {
    const members = [
      request(1, '2026-10-03T01:00:00Z'),
      request(2, '2026-10-03T02:00:00Z'),
      request(3, '2026-10-03T03:00:00Z'),
    ];

    expect(prs(batch.withoutMembers(members, [2]))).toEqual([1, 3]);
    expect(prs(batch.withoutMembers(members, [1, 3]))).toEqual([2]);
  });

  it('discovers the culprit using only ordered prefix probe results', () => {
    const members = [
      request(1, '2026-10-03T01:00:00Z'),
      request(2, '2026-10-03T02:00:00Z'),
      request(3, '2026-10-03T03:00:00Z'),
    ];

    // The full A+B+C stack is already known red. Probe A first.
    const start = batch.nextPrefixRecovery(members, 0);
    expect(start).toMatchObject({ done: false, land: [], bounce: null, requeue: [] });
    expect(prs(start.probe!)).toEqual([1]);

    // If A is red, A is the culprit and only the untouched suffix is requeued.
    const firstRed = batch.nextPrefixRecovery(members, 0, true);
    expect(firstRed.done).toBe(true);
    expect(prs(firstRed.land)).toEqual([]);
    expect(firstRed.bounce?.pr).toBe(1);
    expect(prs(firstRed.requeue)).toEqual([2, 3]);

    // If A was green, probe exactly A+B next.
    const afterA = batch.nextPrefixRecovery(members, 1);
    expect(afterA.done).toBe(false);
    expect(prs(afterA.probe!)).toEqual([1, 2]);

    // A+B red means land A, bounce B, requeue C.
    const secondRed = batch.nextPrefixRecovery(members, 1, true);
    expect(secondRed.done).toBe(true);
    expect(prs(secondRed.land)).toEqual([1]);
    expect(secondRed.bounce?.pr).toBe(2);
    expect(prs(secondRed.requeue)).toEqual([3]);

    // If A+B was green, the already-red full stack identifies C without
    // rerunning A+B+C.
    const afterAB = batch.nextPrefixRecovery(members, 2);
    expect(afterAB.done).toBe(true);
    expect(afterAB.probe).toBeNull();
    expect(prs(afterAB.land)).toEqual([1, 2]);
    expect(afterAB.bounce?.pr).toBe(3);
    expect(prs(afterAB.requeue)).toEqual([]);
  });

  it('bounces a lone red member without rechecking the already-red head', () => {
    const only = request(1, '2026-10-03T01:00:00Z');
    const recovery = batch.nextPrefixRecovery([only], 0);
    expect(recovery.done).toBe(true);
    expect(recovery.probe).toBeNull();
    expect(recovery.land).toEqual([]);
    expect(recovery.bounce?.pr).toBe(1);
    expect(recovery.requeue).toEqual([]);
  });

  it('rejects impossible prefix-recovery state', () => {
    const members = [request(1, '2026-10-03T01:00:00Z')];
    expect(() => batch.nextPrefixRecovery([], 0)).toThrow(/empty batch/);
    expect(() => batch.nextPrefixRecovery(members, -1)).toThrow(/next batch boundary/);
    expect(() => batch.nextPrefixRecovery(members, 1)).toThrow(/next batch boundary/);
  });

  it('retries once only when every structured failure is explicitly retryable', () => {
    const retryable = [
      'gate:outcome-reach',
      'test:packages/core/src/arcs.slow.test.ts',
    ];
    const coinTails: StructuredFailure[] = [
      { kind: 'gate', name: 'outcome-reach' },
      { kind: 'test', name: 'packages/core/src/arcs.slow.test.ts' },
    ];

    expect(batch.shouldRetry(coinTails, retryable)).toBe(true);
    expect(batch.shouldRetry(coinTails, retryable, true)).toBe(false);
    expect(batch.shouldRetry([], retryable)).toBe(false);
    expect(batch.shouldRetry([
      ...coinTails,
      { kind: 'gate', name: 'war' },
    ], retryable)).toBe(false);
    expect(batch.shouldRetry([
      coinTails[0]!,
      { kind: 'step', name: 'typecheck' },
    ], retryable)).toBe(false);
    expect(batch.failureKey(coinTails[0]!)).toBe('gate:outcome-reach');
    expect(batch.failureKey({ kind: 'step', name: 'typecheck' })).toBe('step:typecheck');
  });

  it('reports retry-policy entries that no longer exist in structured check metadata', () => {
    expect(batch.staleRetryEntries(
      ['gate:outcome-reach', 'test:old.slow.test.ts', 'test:old.slow.test.ts'],
      ['gate:outcome-reach', 'test:packages/core/src/arcs.slow.test.ts'],
    )).toEqual(['test:old.slow.test.ts']);
  });
});
