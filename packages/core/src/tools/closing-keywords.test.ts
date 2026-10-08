import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO = join(import.meta.dirname, '../../../..');
const tool = (await import(pathToFileURL(join(REPO, 'tools/closing-keywords.mjs')).href)) as {
  closingIssues: (text: string) => string[];
  negatedClosings: (text: string) => number[];
  mergedPrClosingIssues: (
    pr: unknown,
    context: { repository: string; defaultBranch: string },
  ) => string[];
  prBodyError: (text: string) => string | null;
  commitMessagesError: (body: string, commits: string, opts?: { mergeGroup?: boolean }) => string | null;
  commitAuditBase: (event: string, base: string, head: string,
    prHead: string | undefined, parentsLine: string | null) => string;
};

describe('GitHub closing keywords with negation', () => {
  it.each([
    'This does **not** close #110',
    "This doesn't fix #110",
    'Never resolves #110',
    'Ships without close #110',
    'Refs #109 rather than close #110',
    'Uses Refs #110 instead of fixes #110',
    'This deliberately does not close #110',
  ])('detects negated closing evidence: %s', (body) => {
    expect(tool.negatedClosings(body)).toEqual([110]);
    expect(tool.closingIssues(body)).toEqual([]);
  });

  it.each(['Closes #110', 'closes #110', 'Fixes #110', 'fixed #110', 'Resolves #110'])(
    'keeps a real closing keyword positive: %s',
    (body) => {
      expect(tool.negatedClosings(body)).toEqual([]);
      expect(tool.closingIssues(body)).toEqual(['110']);
    },
  );

  it('does not mistake references for closing keywords', () => {
    expect(tool.negatedClosings('Refs #110. Part of #111.')).toEqual([]);
    expect(tool.closingIssues('Refs #110. Part of #111.')).toEqual([]);
  });

  it('carries one negation across two closing keywords in the same clause', () => {
    expect(tool.negatedClosings('This does not close #110 or resolve #111.')).toEqual([110, 111]);
  });

  it('lets an explicit contrast start a positive clause', () => {
    expect(tool.negatedClosings('This does not merely reference #110 but closes #110.')).toEqual([]);
    expect(tool.closingIssues('This does not merely reference #110 but closes #110.')).toEqual(['110']);
  });

  it('reports the exact safe replacements for the PR #154 failure shape', () => {
    const bad = tool.prBodyError('This does **not** close #110');
    expect(bad).toContain('Refs #110');
    expect(bad).toContain('Part of #110');
    expect(tool.prBodyError('Refs #110')).toBeNull();
  });

  it('reconciles only affirmative closings from a merged PR into this default branch', () => {
    const pr = {
      merged_at: '2026-10-05T05:29:14Z',
      body: 'Closes #123. Fixes #124. Closes #123. Refs #125. This does not resolve #126.',
      base: { ref: 'main', repo: { full_name: 'EldritchDynasty/EldritchDynasty' } },
    };
    expect(tool.mergedPrClosingIssues(pr, {
      repository: 'EldritchDynasty/EldritchDynasty',
      defaultBranch: 'main',
    })).toEqual(['123', '124']);
  });

  it('never treats an unmerged, wrong-branch, or other-repository PR as closing evidence', () => {
    const body = 'Closes #123';
    const base = { ref: 'main', repo: { full_name: 'EldritchDynasty/EldritchDynasty' } };
    const context = { repository: 'EldritchDynasty/EldritchDynasty', defaultBranch: 'main' };

    expect(tool.mergedPrClosingIssues({ merged_at: null, body, base }, context)).toEqual([]);
    expect(tool.mergedPrClosingIssues({
      merged_at: '2026-10-05T05:29:14Z',
      body,
      base: { ...base, ref: 'release' },
    }, context)).toEqual([]);
    expect(tool.mergedPrClosingIssues({
      merged_at: '2026-10-05T05:29:14Z',
      body,
      base: { ref: 'main', repo: { full_name: 'Elsewhere/Fork' } },
    }, context)).toEqual([]);
  });


  it('rejects the historical negated #61 commit even if the PR body calls it open', () => {
    const historical = [
      'balance(#61): widen the Apotheosis acceptance band',
      '',
      'This does not close #61. Apotheosis still fires in 0% of measured runs.',
    ].join('\n');
    expect(tool.commitMessagesError('Refs #61. Part of #332.', historical))
      .toMatch(/#61: commit message negates/);
    // An affirmative PR body cannot sanitize a negated commit message.
    expect(tool.commitMessagesError('Closes #61.', historical))
      .toMatch(/#61: commit message negates/);
    expect(tool.commitMessagesError('', historical, { mergeGroup: true }))
      .toMatch(/#61: commit message negates/);
  });

  it('rejects the historical positive Fix #378 when the PR only says Part of #378', () => {
    const historical = 'Fix #378 ladder diagnostic; preserve the other balance blockers.';
    expect(tool.commitMessagesError('Part of #378.', historical))
      .toMatch(/#378: commit message closes the issue, but the PR body does not/);
    expect(tool.commitMessagesError('Refs #378.', historical)).toContain('Closes #378');
    expect(tool.commitMessagesError('', historical)).toContain('Closes #378');
  });

  it('accepts matching explicit closings and ordinary nonclosing references', () => {
    expect(tool.commitMessagesError('Closes #594. Refs #332.', 'Fixes #594\n\nPart of #332.'))
      .toBeNull();
    expect(tool.commitMessagesError('Refs #332.', 'Docs polish. Part of #332.'))
      .toBeNull();
    expect(tool.commitMessagesError('Part of #378.', 'Fix #378', { mergeGroup: true }))
      .toBeNull();
    expect(tool.commitMessagesError('Closes #594', 'Closes #594 and resolves #595.'))
      .toContain('#595');
  });

  it('audits only PR commits when event base SHA trails the fetched synthetic merge parent (#605)', () => {
    const staleEventBase = 'a'.repeat(40);
    const realMainParent = 'b'.repeat(40);
    const exactPrHead = 'c'.repeat(40);
    const mergeHead = 'd'.repeat(40);
    const parents = [mergeHead, realMainParent, exactPrHead].join(' ');

    // PR #597 encountered exactly this shape: the event base was old but
    // actions/checkout checked out a merge whose first parent was newer main.
    expect(tool.commitAuditBase('pull_request', staleEventBase, mergeHead, exactPrHead, parents))
      .toBe(realMainParent);
    // Queue merges keep using the event's merge_group.base_sha.
    expect(tool.commitAuditBase('merge_group', staleEventBase, mergeHead, undefined, null))
      .toBe(staleEventBase);
    expect(() => tool.commitAuditBase('pull_request', staleEventBase, mergeHead, undefined, parents))
      .toThrow(/missing or invalid PR head/);
    expect(() => tool.commitAuditBase('pull_request', staleEventBase, mergeHead, 'e'.repeat(40), parents))
      .toThrow(/expected exact-head synthetic merge/);
    expect(() => tool.commitAuditBase('pull_request', staleEventBase, mergeHead, exactPrHead,
      [mergeHead, realMainParent].join(' ')))
      .toThrow(/expected exact-head synthetic merge/);
    expect(() => tool.commitAuditBase('pull_request', staleEventBase, mergeHead, exactPrHead,
      ['e'.repeat(40), realMainParent, exactPrHead].join(' ')))
      .toThrow(/expected exact-head synthetic merge/);
  });

  it('keeps the commit check on the authoritative PR and merge-group CI paths', () => {
    const check = readFileSync(join(REPO, '.github/workflows/check.yml'), 'utf8');
    expect(check).toContain("github.event_name == 'pull_request' || github.event_name == 'merge_group'");
    expect(check).toContain("CHECK_COMMIT_CLOSINGS: '1'");
    expect(check).toContain('CLOSINGS_BASE:');
    expect(check).toContain('CLOSINGS_HEAD:');
    expect(check).toContain('CLOSINGS_PR_HEAD:');
    expect(check).toContain('fetch-depth: 0');
  });

  it('is wired into pull-request admission and post-merge reconciliation', () => {
    const check = readFileSync(join(REPO, '.github/workflows/check.yml'), 'utf8');
    expect(check).toContain('CHECK_PR_BODY');

    const janitor = readFileSync(join(REPO, 'tools/janitor.mjs'), 'utf8');
    expect(janitor).toContain('mergedPrClosingIssues');
    expect(janitor).toContain('/commits/${sha}/pulls');

    const janitorWorkflow = readFileSync(join(REPO, '.github/workflows/janitor.yml'), 'utf8');
    expect(janitorWorkflow).toContain('pull-requests: read');
    expect(janitorWorkflow).toContain("JANITOR_RECONCILE_MERGED_PRS: '1'");
  });
});
