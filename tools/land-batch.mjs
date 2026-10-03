/**
 * Pure merge-train decisions for issue #353.
 *
 * The workflow owns GitHub I/O. This module owns the parts that must be
 * deterministic and unit-testable before any queue mutation happens:
 * immutable admission identity, batch order, member removal, ordered-prefix
 * recovery, and the single structured retry decision.
 */

/**
 * @typedef {Object} LandRequest
 * @property {number} pr
 * @property {string} requestedHead
 * @property {string} requestedAt
 * @property {number} sourceCommentId
 * @property {boolean} noIssueCheck
 */

/**
 * A queued request is immutable. If the PR head moved after /land, the old
 * request cannot silently authorize the new code.
 *
 * @param {LandRequest} request
 * @param {string} liveHead
 */
export function requestedHeadIsCurrent(request, liveHead) {
  return request.requestedHead === liveHead;
}

/**
 * Own request first, then the oldest other requests. A later workflow run may
 * therefore consume neighbours without waiting for the batch to fill.
 *
 * Admission history is append-only, so duplicate PR records are collapsed to
 * their newest request generation (requestedAt, then sourceCommentId). A fresh
 * /land therefore cannot inherit an older requested head or issue-check mode.
 *
 * @param {LandRequest[]} requests
 * @param {LandRequest} ownRequest The exact immutable request that admitted this run.
 * @param {number} [max=3]
 * @returns {LandRequest[]}
 */
export function selectBatch(requests, ownRequest, max = 3) {
  if (!Number.isInteger(max) || max < 1) throw new Error('batch max must be a positive integer');

  // #422 persists request history append-only. Canonicalize that history to the
  // newest admitted generation for each PR before selecting queue neighbours;
  // otherwise an older marker could silently restore a stale requested head or
  // stale --no-issue-check authority.
  const latestByPr = new Map();
  for (const request of requests) {
    const current = latestByPr.get(request.pr);
    if (
      !current
      || request.requestedAt > current.requestedAt
      || (
        request.requestedAt === current.requestedAt
        && request.sourceCommentId > current.sourceCommentId
      )
    ) {
      latestByPr.set(request.pr, request);
    }
  }

  const own = latestByPr.get(ownRequest.pr);
  if (
    !own
    || own.requestedHead !== ownRequest.requestedHead
    || own.requestedAt !== ownRequest.requestedAt
    || own.sourceCommentId !== ownRequest.sourceCommentId
    || own.noIssueCheck !== ownRequest.noIssueCheck
  ) {
    // Never let an older queued workflow silently adopt a newer generation for
    // its own PR. #422's verifier should reject that run first; this keeps the
    // pure #353 decision layer safe if call ordering ever changes.
    return [];
  }

  const rest = [...latestByPr.values()]
    .filter((request) => request.pr !== ownRequest.pr)
    .sort((a, b) => {
      const byTime = a.requestedAt.localeCompare(b.requestedAt);
      if (byTime) return byTime;
      const bySource = a.sourceCommentId - b.sourceCommentId;
      return bySource || a.pr - b.pr;
    });

  return [own, ...rest].slice(0, max);
}

/**
 * Remove members that cannot participate without changing the order of the
 * survivors. This is used for per-PR admission failures and rebase conflicts:
 * one bad neighbour must not poison the valid requests around it.
 *
 * @param {LandRequest[]} members
 * @param {Iterable<number>} removedPrs
 */
export function withoutMembers(members, removedPrs) {
  const removed = new Set(removedPrs);
  return members.filter((member) => !removed.has(member.pr));
}

/**
 * The only legal red recovery is an ordered prefix.
 *
 * The full stacked head is already known red. Recovery therefore probes only
 * proper prefixes, one longer each time. The caller feeds the result of the
 * last probe back in; this function never needs an oracle telling it which PR
 * is the culprit.
 *
 * Examples for A/B/C:
 *   greenPrefix=0                  -> probe A
 *   greenPrefix=0, lastProbeRed    -> bounce A; requeue B,C
 *   greenPrefix=1                  -> probe A,B
 *   greenPrefix=1, lastProbeRed    -> land A; bounce B; requeue C
 *   greenPrefix=2                  -> land A,B; bounce C
 *
 * @param {LandRequest[]} members
 * @param {number} greenPrefixLength Number of leading members already proved green.
 * @param {boolean} [lastProbeFailed=false] Whether the just-tested next prefix was red.
 */
export function nextPrefixRecovery(members, greenPrefixLength, lastProbeFailed = false) {
  if (!members.length) throw new Error('cannot recover an empty batch');
  if (
    !Number.isInteger(greenPrefixLength)
    || greenPrefixLength < 0
    || greenPrefixLength >= members.length
  ) {
    throw new Error('green prefix length must identify the next batch boundary');
  }

  if (lastProbeFailed || greenPrefixLength === members.length - 1) {
    return {
      done: true,
      probe: null,
      land: members.slice(0, greenPrefixLength),
      bounce: members[greenPrefixLength],
      requeue: members.slice(greenPrefixLength + 1),
    };
  }

  return {
    done: false,
    probe: members.slice(0, greenPrefixLength + 1),
    land: [],
    bounce: null,
    requeue: [],
  };
}

/**
 * @typedef {'step'|'gate'|'test'} FailureKind
 * @typedef {{ kind: FailureKind, name: string }} StructuredFailure
 */

/**
 * Stable identity for machine-readable retry metadata.
 *
 * @param {StructuredFailure} failure
 */
export function failureKey(failure) {
  return `${failure.kind}:${failure.name}`;
}

/**
 * Retry the whole stacked check at most once, and only when EVERY failure is
 * explicitly declared retryable. Empty failure sets are not retry requests.
 *
 * @param {StructuredFailure[]} failures
 * @param {Iterable<string>} retryable
 * @param {boolean} [alreadyRetried=false]
 */
export function shouldRetry(failures, retryable, alreadyRetried = false) {
  if (alreadyRetried || failures.length === 0) return false;
  const allowed = new Set(retryable);
  return failures.every((failure) => allowed.has(failureKey(failure)));
}

/**
 * Configuration guard: retry metadata must not silently outlive the structured
 * gate/test result it names.
 *
 * @param {Iterable<string>} retryable
 * @param {Iterable<string>} knownChecks
 */
export function staleRetryEntries(retryable, knownChecks) {
  const known = new Set(knownChecks);
  return [...new Set(retryable)].filter((entry) => !known.has(entry)).sort();
}
