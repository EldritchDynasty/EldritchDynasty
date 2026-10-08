/**
 * GitHub closing keywords, with the one distinction GitHub itself does not make:
 * whether the surrounding prose negates the close.
 *
 * GitHub closes an issue whenever a supported keyword sits immediately before
 * #N. It does not understand "does not close #N". Repository tooling does need
 * to understand that sentence, because treating it as positive landing evidence
 * repeats the same mistake locally and in the janitor.
 */

import { execFileSync } from 'node:child_process';

const CLOSING = /\b(?:clos(?:e|es|ed)|fix(?:e[sd])?|resolv(?:e|es|ed))\s+#(\d+)\b/gi;
const MARKDOWN = /[*_`~]/g;
const NEGATION = /(?:\bnot\b|\bnever\b|\bwithout\b|\brather\s+than\b|\binstead\s+of\b|\b\w+n['’]t\b)[^.;:!?\n]{0,120}$/i;

/**
 * Read only the clause that can grammatically govern the closing keyword.
 * "not only refs #1, but closes #2" is positive after "but"; ordinary commas
 * remain inside the clause so "does not close #1, fix #2" negates both.
 */
function governingClause(text, keywordAt) {
  const window = text.slice(Math.max(0, keywordAt - 220), keywordAt);
  const boundary = Math.max(
    window.lastIndexOf('\n'),
    window.lastIndexOf('.'),
    window.lastIndexOf(';'),
    window.lastIndexOf(':'),
    window.lastIndexOf('!'),
    window.lastIndexOf('?'),
  );
  let clause = window.slice(boundary + 1).replace(MARKDOWN, '');
  const buts = [...clause.matchAll(/\bbut\b/gi)];
  const lastBut = buts.at(-1);
  if (lastBut?.index !== undefined) clause = clause.slice(lastBut.index + lastBut[0].length);
  return clause;
}

function matches(text) {
  CLOSING.lastIndex = 0;
  return [...text.matchAll(CLOSING)];
}

function isNegated(text, match) {
  return NEGATION.test(governingClause(text, match.index ?? 0));
}

/** Closing issue numbers that are real positive landing evidence. */
export function closingIssues(text) {
  return matches(text).filter((m) => !isNegated(text, m)).map((m) => m[1]);
}

/** Issue numbers GitHub would close even though the prose says not to. */
export function negatedClosings(text) {
  return [...new Set(matches(text).filter((m) => isNegated(text, m)).map((m) => Number(m[1])))];
}

/**
 * Affirmative same-repository issue closings from a PR GitHub reports as
 * actually merged into this repository's default branch.
 *
 * The caller supplies repository/defaultBranch rather than trusting fields in
 * the body or a branch name. Bare #N references are then necessarily issues in
 * that repository, matching GitHub's closing-keyword semantics.
 */
export function mergedPrClosingIssues(pr, { repository, defaultBranch }) {
  if (!pr || !repository || !defaultBranch) return [];
  if (!pr.merged_at) return [];
  if (pr.base?.ref !== defaultBranch) return [];
  if (pr.base?.repo?.full_name !== repository) return [];
  return [...new Set(closingIssues(pr.body ?? ''))];
}

export function prBodyError(text) {
  const issues = negatedClosings(text);
  if (!issues.length) return null;
  const lines = issues.map((n) =>
    `#${n}: replace the negated closing keyword with "Refs #${n}" or "Part of #${n}".`
  );
  return [
    'PR body contains a negated GitHub closing keyword. GitHub ignores the negation and would close the issue:',
    ...lines,
  ].join('\n');
}

/**
 * Commit messages are landing instructions too. GitHub ignores grammatical
 * negation and can close an issue that a PR author explicitly kept open.
 *
 * On a PR we additionally require every affirmative commit closure to appear
 * affirmatively in its PR body. A mere "Refs" or "Part of" is not consent to
 * close. Merge groups have no authoritative single PR body (a group can
 * contain several PRs), so they recheck dangerous negations; each constituent
 * PR's affirmative declarations are checked on its exact-head CI before the
 * automatic merge-queue admission.
 */
export function commitMessagesError(prBody, commitLog, { mergeGroup = false } = {}) {
  const negated = negatedClosings(commitLog);
  const declared = new Set(closingIssues(prBody));
  const undeclared = mergeGroup ? [] :
    [...new Set(closingIssues(commitLog).filter((n) => !declared.has(n)))];
  if (!negated.length && !undeclared.length) return null;

  const lines = [
    ...negated.map((n) =>
      `#${n}: commit message negates a GitHub closing keyword; use "Refs #${n}" or "Part of #${n}".`),
    ...undeclared.map((n) =>
      `#${n}: commit message closes the issue, but the PR body does not. Declare "Closes #${n}" in the PR body, or replace the commit keyword with "Refs #${n}" or "Part of #${n}".`),
  ];
  return ['Unsafe closing keywords in PR commit messages:', ...lines].join('\n');
}

/** Fail closed if the complete, exact revision range cannot be inspected. */
function checkedCommitLog(base, head) {
  if (!/^[0-9a-f]{40}$/i.test(base ?? '') || !/^[0-9a-f]{40}$/i.test(head ?? '')) {
    throw new Error('missing or invalid full base/head SHA for commit-closure audit');
  }
  const range = `${base}..${head}`;
  const count = Number(execFileSync('git', ['rev-list', '--count', range], { encoding: 'utf8' }).trim());
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new Error(`no PR/merge-group commits found in ${range}; refusing to skip the closure audit`);
  }
  return execFileSync('git', ['log', '--format=%B', range], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
}

// CI workflows set this explicitly; normal imports from land/janitor remain pure.
if (process.env.CHECK_PR_BODY === '1') {
  const error = prBodyError(process.env.PR_BODY ?? '');
  if (error) {
    process.stderr.write(`${error}\n`);
    process.exitCode = 1;
  }
}

if (process.env.CHECK_COMMIT_CLOSINGS === '1') {
  try {
    const event = process.env.CLOSINGS_EVENT;
    if (event !== 'pull_request' && event !== 'merge_group') {
      throw new Error(`commit-closure audit needs pull_request or merge_group, got ${String(event)}`);
    }
    const log = checkedCommitLog(process.env.CLOSINGS_BASE, process.env.CLOSINGS_HEAD);
    const error = commitMessagesError(process.env.PR_BODY ?? '', log, {
      mergeGroup: event === 'merge_group',
    });
    if (error) throw new Error(error);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
