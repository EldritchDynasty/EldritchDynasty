import type { ContentBundle } from './content.js';
import type { Content } from './content-index.js';
import { indexContent } from './content-index.js';
import { CONTENT_RULES as BASE_CONTENT_RULES } from './rules.js';
import { proseVariantsRule } from './prose-variants.js';

export interface Issue {
  level: 'error' | 'warning';
  /** Which rule said so. Groups the editor panel, and makes a warning greppable. */
  rule: string;
  where: string;
  message: string;
}

/**
 * CONTENT VALIDATION, as a list of named rules.
 *
 * This was one 277-line function checking frequency obligations, slot
 * references, arc wiring, Age coverage, the Madness gate and the prose contract
 * in a single pass, in one scope, appending to one shared array. Adding a rule
 * meant finding the middle of it. Testing a rule meant running all of them
 * against the whole game and filtering the output by message text.
 *
 * A rule is a value now: an id, a sentence saying what it is for, and a
 * function from the content to its complaints. Three things follow —
 *
 *   the editor groups and counts by rule instead of by string matching,
 *   a test can run ONE rule against a two-event bundle,
 *   and an author reading a warning has a token to search for.
 *
 * Errors block a save; warnings do not, and that is deliberate. A linter that
 * stops writers gets turned off within a fortnight.
 */
export interface ValidationRule {
  /** Stable, slash-cased. It appears on every issue the rule raises. */
  readonly id: string;
  /** One line, shown in the editor beside the count. */
  readonly about: string;
  check(content: Content): Issue[];
}

/**
 * Keep the large long-lived registry in rules.ts, while #415's prose migration
 * guardrail lives beside the prose schema it protects. Public callers still
 * see one authoritative list through @ed/schema.
 */
export const CONTENT_RULES: readonly ValidationRule[] = [
  ...BASE_CONTENT_RULES,
  proseVariantsRule,
];

export function validateBundle(source: ContentBundle | Content, only?: readonly string[]): Issue[] {
  const content = indexContent(source);
  const rules = only ? CONTENT_RULES.filter((r) => only.includes(r.id)) : CONTENT_RULES;
  return rules.flatMap((rule) => rule.check(content));
}

/** Run exactly one rule. The unit of a validation test. */
export function runRule(id: string, source: ContentBundle | Content): Issue[] {
  const rule = CONTENT_RULES.find((r) => r.id === id);
  if (!rule) throw new Error(`no validation rule '${id}'`);
  return rule.check(indexContent(source));
}

export { PROSE_SENTENCE_THRESHOLD, proseIssues, splitSentences } from './prose.js';
