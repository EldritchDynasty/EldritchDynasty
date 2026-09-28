import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO = join(import.meta.dirname, '../../../..');
const tool = (await import(pathToFileURL(join(REPO, 'tools/closing-keywords.mjs')).href)) as {
  closingIssues: (text: string) => string[];
  negatedClosings: (text: string) => number[];
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

  it('is wired into both pull-request admission paths', () => {
    const remote = readFileSync(join(REPO, '.github/workflows/remote-land.yml'), 'utf8');
    const check = readFileSync(join(REPO, '.github/workflows/check.yml'), 'utf8');
    expect(remote).toContain('CHECK_PR_BODY');
    expect(check).toContain('CHECK_PR_BODY');
  });
});
