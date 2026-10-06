import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { auditChoices, isProseOnly, type ContentSources } from '@ed/schema';
import {
  choiceWorklist,
  loadChoiceDecisions,
  renderChoiceWorklistJson,
  type ChoiceDecisionFile,
} from './choice-audit.js';

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

  it('loads the committed decision ledger and accounts for classified versus unclassified keys', () => {
    const decisions = loadChoiceDecisions();
    const work = choiceWorklist(content, decisions);
    console.log('CHOICE-UNCLASSIFIED', JSON.stringify(work.memory.filter((item) => item.decision === undefined)));

    expect(work.summary.classifiedWriteOnlyKeys + work.summary.unclassifiedWriteOnlyKeys)
      .toBe(work.summary.writeOnlyKeys);
    expect(JSON.parse(renderChoiceWorklistJson(content, decisions))).toEqual(work);
  });

  it('attaches a persisted disposition and reason to the exact current unread key', () => {
    const current = choiceWorklist(content).memory[0]!;
    const decisions: ChoiceDecisionFile = {
      version: 1,
      memory: [{
        kind: current.kind,
        key: current.key,
        disposition: 'delete',
        reason: 'fixture: no later rule should read this key',
      }],
    };

    const work = choiceWorklist(content, decisions);
    const row = work.memory.find((item) => item.kind === current.kind && item.key === current.key)!;
    expect(row.decision).toEqual({
      disposition: 'delete',
      reason: 'fixture: no later rule should read this key',
    });
    const fileRows = work.files.flatMap((file) =>
      file.memory.filter((item) => item.kind === current.kind && item.key === current.key));
    expect(fileRows.length).toBeGreaterThan(0);
    expect(fileRows.every((item) => item.decision?.disposition === 'delete')).toBe(true);
    expect(work.summary.classifiedWriteOnlyKeys).toBe(1);
    expect(work.summary.unclassifiedWriteOnlyKeys).toBe(work.summary.writeOnlyKeys - 1);
  });

  it('fails closed on malformed, stale, duplicate, or reasonless decisions', () => {
    const current = choiceWorklist(content).memory[0]!;
    const valid = {
      kind: current.kind,
      key: current.key,
      disposition: 'delete' as const,
      reason: 'fixture reason',
    };

    expect(() => choiceWorklist(content, null as unknown as ChoiceDecisionFile))
      .toThrow(/expected an object/);

    expect(() => choiceWorklist(content, {
      version: 1,
      memory: null,
    } as unknown as ChoiceDecisionFile)).toThrow(/memory must be an array/);

    expect(() => choiceWorklist(content, {
      version: 1,
      memory: [null],
    } as unknown as ChoiceDecisionFile)).toThrow(/invalid choice decision at index 0/);

    expect(() => choiceWorklist(content, {
      version: 2,
      memory: [],
    } as unknown as ChoiceDecisionFile)).toThrow(/unsupported choice decision file version/);

    expect(() => choiceWorklist(content, {
      version: 1,
      memory: [{ ...valid, reason: 42 }],
    } as unknown as ChoiceDecisionFile)).toThrow(/lacks a reason/);

    expect(() => choiceWorklist(content, {
      version: 1,
      memory: [{ ...valid, key: '__not_a_current_write_only_key__' }],
    })).toThrow(/stale choice decision/);

    expect(() => choiceWorklist(content, {
      version: 1,
      memory: [valid, valid],
    })).toThrow(/duplicate choice decision/);

    expect(() => choiceWorklist(content, {
      version: 1,
      memory: [{ ...valid, reason: '   ' }],
    })).toThrow(/lacks a reason/);

    expect(() => choiceWorklist(content, {
      version: 1,
      memory: [{ ...valid, disposition: 'maybe' }],
    } as unknown as ChoiceDecisionFile)).toThrow(/invalid choice disposition/);
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
