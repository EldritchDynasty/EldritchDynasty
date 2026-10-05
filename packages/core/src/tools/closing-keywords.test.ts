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
