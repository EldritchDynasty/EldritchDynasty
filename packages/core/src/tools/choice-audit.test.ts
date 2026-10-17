import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { auditChoices, GOD_RITE_FAILED, isProseOnly, type ChoiceAudit, type Content, type ContentSources } from '@ed/schema';
import {
  choiceWorklist,
  loadChoiceDecisions,
  renderChoiceWorklistJson,
  writeOnlyBySource,
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

  it('keeps deliberate non-intervention choices explicitly classified as self-expression (#1783)', () => {
    // These are decisions to preserve the status quo, not promises of a new
    // mechanic. Their authored outcome and Chronicle prose remain unchanged.
    const reviewed = [
      ['the_letter_nobody_answered', 'let_it_close'],
      ['a_neighbour_short_before_michaelmas', 'let_it_go'],
      ['the_marker_stays_moved', 'walk_it_back'],
      ['the_iron_over_the_door', 'leave_the_iron'],
      ['the_grandmother_who_remembers', 'leave_her_alone'],
    ] as const;
    const audit = auditChoices(content);
    const work = choiceWorklist(content);

    for (const [eventId, choiceId] of reviewed) {
      const row = audit.rows.find((r) => r.event === eventId && r.choice === choiceId);
      expect(row?.categories, `${eventId}/${choiceId} must declare self-expression`)
        .toContain('self_expression');
      expect(work.proseOnly.some((r) => r.event === eventId && r.choice === choiceId))
        .toBe(false);

      const event = content.events.find((e) => e.id === eventId);
      expect(event?.interaction.kind).toBe('choice');
      if (event?.interaction.kind !== 'choice') continue;
      const choice = event.interaction.choices.find((c) => c.id === choiceId);
      expect(choice?.outcomes.length).toBeGreaterThan(0);
      expect(choice?.outcomes.every((outcome) => outcome.tags.includes('self_expression')))
        .toBe(true);
      // If a real effect is authored later, remove this declaration and its
      // no-consequence classification instead of silently masking the change.
      expect(choice?.outcomes.every((outcome) => outcome.effects.length === 0))
        .toBe(true);
    }
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

  it('counts the built-in ending reader without a stale unread-key decision (#1187)', () => {
    const audit = auditChoices(content);
    const work = choiceWorklist(content, loadChoiceDecisions());
    expect(audit.read.flag).toContain(GOD_RITE_FAILED);
    expect(audit.writeOnly).not.toContainEqual(expect.objectContaining({
      kind: 'flag', key: GOD_RITE_FAILED,
    }));
    expect(work.memory.some((row) => row.kind === 'flag' && row.key === GOD_RITE_FAILED)).toBe(false);
    expect(work.summary.unclassifiedWriteOnlyKeys).toBe(0);
  });

  it('loads the committed decision ledger and accounts for classified versus unclassified keys', () => {
    const decisions = loadChoiceDecisions();
    const work = choiceWorklist(content, decisions);
    expect(work.summary.unclassifiedWriteOnlyKeys).toBe(0);

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
      memory: [{ ...valid, kind: 'unsupported_memory_kind' }],
    } as unknown as ChoiceDecisionFile)).toThrow(/kind and key must be non-empty strings/);

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

  it('attributes a shared unread key to every writing file without double-counting a file', () => {
    const audit = {
      writeOnly: [{
        kind: 'flag',
        key: 'shared_test_flag',
        writers: [
          'event:alpha/choices[0]/outcomes[0]',
          'event:alpha/choices[1]/outcomes[0]',
          'event:beta/choices[0]/outcomes[0]',
        ],
      }],
    } as unknown as ChoiceAudit;
    const fixture = { sourceOf: (id: string) => `events/${id}.yaml` } as unknown as Content;

    expect([...writeOnlyBySource(audit, fixture)]).toEqual([
      ['events/alpha.yaml', [{
        kind: 'flag',
        key: 'shared_test_flag',
        writers: [
          'event:alpha/choices[0]/outcomes[0]',
          'event:alpha/choices[1]/outcomes[0]',
        ],
      }]],
      ['events/beta.yaml', [{
        kind: 'flag',
        key: 'shared_test_flag',
        writers: ['event:beta/choices[0]/outcomes[0]'],
      }]],
    ]);
  });

  it('keeps text-audit per-file memory attribution aligned with the JSON worklist', () => {
    const audit = auditChoices(content);
    const grouped = writeOnlyBySource(audit, content);
    const work = choiceWorklist(content);

    for (const file of work.files) {
      const normalise = (item: { kind: string; key: string; writers: string[] }) =>
        [item.kind, item.key, ...[...item.writers].sort()].join('\u0000');
      expect((grouped.get(file.file) ?? []).map(normalise).sort())
        .toEqual(file.memory.map(normalise).sort());
    }
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
