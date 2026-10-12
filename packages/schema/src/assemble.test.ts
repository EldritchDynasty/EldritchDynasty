import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { assertNoTruncatedFlowProse } from './assemble.js';

describe('YAML flow prose guard (#1352)', () => {
  it('names the file and line when an unquoted comma cuts an effect text short', () => {
    const source = [
      'events:',
      '  - interaction:',
      '      outcomes:',
      '        - effects:',
      '            - { kind: chronicle, text: The wall was entered at Cawdry, and the line entered. }',
    ].join('\n');
    const parsed = parse(source) as { events: unknown[] };
    expect(() => assertNoTruncatedFlowProse('events/neighbours.yaml', source, parsed))
      .toThrow(/events\/neighbours\.yaml:5 .*yaml\/flow-comma.*and the line entered/);
  });

  it('accepts the same words in a quoted flow value', () => {
    const source = [
      'events:',
      '  - effects:',
      '      - { kind: chronicle, text: "The wall was entered at Cawdry, and the line entered." }',
    ].join('\n');
    expect(() => assertNoTruncatedFlowProse('events/neighbours.yaml', source, parse(source)))
      .not.toThrow();
  });

  it('does not mistake explicit null fields or commas outside flow mappings for truncation', () => {
    const source = [
      'events:',
      '  - effects:',
      '      - kind: chronicle',
      '        text: "One step, then another."',
      '        note: null',
    ].join('\n');
    expect(() => assertNoTruncatedFlowProse('events/test.yaml', source, parse(source)))
      .not.toThrow();
  });

  it('also protects flow mappings inside Record claims', () => {
    const source = [
      'events:',
      '  - record:',
      '      claims:',
      '        - { kind: chronicle, because: The church said the house owed it, and the tithe was taken. }',
    ].join('\n');
    expect(() => assertNoTruncatedFlowProse('events/claims.yaml', source, parse(source)))
      .toThrow(/events\/claims\.yaml:4 .*yaml\/flow-comma/);
  });
});
