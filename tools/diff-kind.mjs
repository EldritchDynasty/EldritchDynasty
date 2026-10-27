/** Pure shared policy. The CLI that reads verdict refs lives in docs-only.mjs. */
export const DOCS_ONLY_STEPS = ['typecheck', 'validate', 'test:fast'];
const MARKDOWN = /\.md$/i;

/**
 * Short or full from changed paths and the base verdict. Paths must come from
 * a rename-blind diff: a.ts → a.md includes the deleted TypeScript too.
 */
export function classify(files, baseState) {
  if (!files.length) return { short: false, reason: 'no changed files to classify' };
  const code = files.filter((f) => !MARKDOWN.test(f));
  if (code.length) {
    const named = code.slice(0, 3).join(', ') + (code.length > 3 ? `, and ${code.length - 3} more` : '');
    return { short: false, reason: `not markdown only: ${named}` };
  }
  if (baseState !== 'green') {
    return {
      short: false,
      reason: `markdown only, but the base is ${baseState.toUpperCase()}, not green — ` +
        'a short run on top of it would report green for a trunk that is not',
    };
  }
  return { short: true, reason: `markdown only (${files.length} file${files.length === 1 ? '' : 's'}) on a green base` };
}
