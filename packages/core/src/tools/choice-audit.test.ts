import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { auditChoices, isProseOnly, type ContentSources } from '@ed/schema';
import { choiceWorklist, renderChoiceWorklistJson } from './choice-audit.js';

function shipped() {
  const sources: ContentSources = new Map();
  return loadContent(undefined, sources);
}

const content = shipped();

describe('the #334 choice-debt worklist', () => {
  it('is byte-stable JSON and contains no clock-shaped metadata', () => {
    const first = renderChoiceWorklistJson(content);
    const second = renderChoiceWorklistJson(content);

    expect(second).toBe(first);
    expect(JSON.parse(first)).toEqual(choiceWorklist(content));
    expect(first).not.toMatch(/generatedAt|timestamp|Date\(/);
  });

  it('accounts for every current write-only key, writer and prose-only choice', () => {
    const audit = auditChoices(content);
    const work = choiceWorklist(content);
    const prose = audit.rows.filter(isProseOnly);

    expect(work.summary.writeOnlyKeys).toBe(audit.writeOnly.length);
    expect(work.summary.writeOnlyWrites)
      .toBe(audit.writeOnly.reduce((sum, item) => sum + item.writers.length, 0));
    expect(work.summary.proseOnly).toBe(prose.length);
    expect(work.summary.files).toBe(work.files.length);

    expect(work.memory.map((item) => [item.kind, item.key, item.writers.map((w) => w.where)]))
      .toEqual(audit.writeOnly.map((item) => [item.kind, item.key, item.writers]));

    expect(work.proseOnly.map((row) => [row.event, row.choice, row.decider]).sort())
      .toEqual(prose.map((row) => [row.event, row.choice, row.decider]).sort());
  });

  it('regroups the same debt by source file without losing or inventing provenance', () => {
    const work = choiceWorklist(content);

    const byKey = work.memory.flatMap((item) =>
      item.writers.map((writer) =>
        [writer.file, item.kind, item.key, writer.where].join('\u0000')))
      .sort();
    const byFile = work.files.flatMap((file) =>
      file.memory.flatMap((item) =>
        item.writers.map((where) =>
          [file.file, item.kind, item.key, where].join('\u0000'))))
      .sort();
    expect(byFile).toEqual(byKey);

    const proseByKey = work.proseOnly
      .map((row) => [row.file, row.event, row.choice, row.decider].join('\u0000'))
      .sort();
    const proseByFile = work.files.flatMap((file) =>
      file.proseOnly.map((row) =>
        [file.file, row.event, row.choice, row.decider].join('\u0000')))
      .sort();
    expect(proseByFile).toEqual(proseByKey);
  });

  it('sorts keys and file slices so two commits can be diffed mechanically', () => {
    const work = choiceWorklist(content);

    expect(work.memory).toEqual([...work.memory].sort((a, b) =>
      a.kind.localeCompare(b.kind) || a.key.localeCompare(b.key)));

    const files = work.files.map((item) => item.file);
    expect(files).toEqual([...files].sort((a, b) => a.localeCompare(b)));

    for (const file of work.files) {
      expect(file.memory).toEqual([...file.memory].sort((a, b) =>
        a.kind.localeCompare(b.kind) || a.key.localeCompare(b.key)));
      expect(file.proseOnly).toEqual([...file.proseOnly].sort((a, b) =>
        a.event.localeCompare(b.event) || a.choice.localeCompare(b.choice)));
    }
  });
});
