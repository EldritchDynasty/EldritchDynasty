import type { Issue } from '@ed/schema';

/**
 * Validation locations begin with `event:<id>`. Following path segments
 * identify the field, not another event; exact ID matching avoids mistaking
 * `some_event` for `some_event_extra` in error badges and navigation.
 */
export function eventIssueId(issue: Pick<Issue, 'where'>): string | undefined {
  const match = /^event:([a-z0-9_]+)(?=$|[.:/])/.exec(issue.where);
  return match?.[1];
}

export function issuesForEvent(issues: readonly Issue[], id: string): Issue[] {
  return issues.filter((issue) => eventIssueId(issue) === id);
}
