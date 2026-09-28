/**
 * GitHub closing keywords, with the one distinction GitHub itself does not make:
 * whether the surrounding prose negates the close.
 *
 * GitHub closes an issue whenever a supported keyword sits immediately before
 * #N. It does not understand "does not close #N". Repository tooling does need
 * to understand that sentence, because treating it as positive landing evidence
 * repeats the same mistake locally and in the janitor.
 */

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

// Workflows set this explicitly. Imports from land/janitor remain pure.
if (process.env.CHECK_PR_BODY === '1') {
  const error = prBodyError(process.env.PR_BODY ?? '');
  if (error) {
    process.stderr.write(`${error}\n`);
    process.exitCode = 1;
  }
}
