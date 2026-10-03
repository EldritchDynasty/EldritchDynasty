import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  VOICES, auditContentFile, auditRepository, auditVueFile, contentVoice,
  plainEnglishContentWorkItems, plainEnglishCoreWorkItems, plainEnglishWorklist, report,
  sentenceLiterals, unclassifiedContentKeys,
} from './string-audit.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../../../..');

describe('the string-source audit (issue #276)', () => {
  it('tags content by where it lives', () => {
    expect(contentVoice('prologue.yaml')).toBe('prologue');
    expect(contentVoice('clauses.yaml')).toBe('ledger');
    expect(contentVoice('tales.yaml')).toBe('tale');
    expect(contentVoice('endings.yaml')).toBe('frame');
    expect(contentVoice('ages/ages.yaml')).toBe('age');
    expect(contentVoice('events/weather.yaml')).toBe('event');
  });

  it('makes a frame-tier event an interlude wherever it is filed, and counts its slots', () => {
    const rows = auditContentFile('events/somewhere.yaml', [
      'events:',
      '  - id: a_plain_scene',
      '    title: The Plain Scene',
      '    body: "{HEAD} went out to the barn and {KIN} did not."',
      '  - id: frame_a_cut_away',
      '    tier: frame',
      '    title: A Room in 1542',
      '    body: The candle was lower than it had been.',
    ].join('\n'));
    expect(rows.map((r) => [r.voice, r.strings, r.interpolations])).toEqual([
      ['event', 2, 2],
      ['interlude', 2, 0],
    ]);
  });

  it('counts no id, and no designer note the player never sees', () => {
    const rows = auditContentFile('characters/founding.yaml', [
      'characters:',
      '  - id: daveed_gearithy',
      '    name: Daveed Gearithy',
      '    note: The first head. Never shown to anybody at all.',
    ].join('\n'));
    expect(rows).toEqual([expect.objectContaining({ voice: 'event', strings: 1, words: 2 })]);
  });

  it('gives prose stable semantic work-item addresses instead of wording identity', () => {
    const authored = [
      'events:',
      '  - id: a_scene',
      '    title: The Same Words',
      '    body: "{HEAD} heard the same words and {KIN} answered."',
      '    interaction:',
      '      choices:',
      '        - id: take_it',
      '          label: Take the same words',
      '          outcomes:',
      '            - id: accepted',
      '              text: The same words appear here',
      '  - id: another_scene',
      '    title: The Same Words',
      '    body: The same words appear here',
    ].join('\n');
    const reworded = authored
      .replace('The same words appear here', 'Different language appears here')
      .replace('Take the same words', 'Choose the offered answer');

    const before = plainEnglishContentWorkItems('events/example.yaml', authored);
    const after = plainEnglishContentWorkItems('events/example.yaml', reworded);

    expect(before.map((x) => x.address)).toEqual(after.map((x) => x.address));
    expect(new Set(before.map((x) => x.address)).size).toBe(before.length);
    expect(before.find((x) => x.address.endsWith('events[id=a_scene].body'))?.interpolations)
      .toEqual(['{HEAD}', '{KIN}']);
    expect(before.find((x) => x.text === 'The same words appear here')?.address)
      .toContain('outcomes[id=accepted].text');
    expect(before.filter((x) => x.text === 'The Same Words').map((x) => x.address)).toEqual([
      'content:events/example.yaml#events[id=a_scene].title',
      'content:events/example.yaml#events[id=another_scene].title',
    ]);
  });

  it('uses a founding character key rather than its array position', () => {
    const items = plainEnglishContentWorkItems('characters/founding.yaml', [
      'characters:',
      '  - key: founder',
      '    name: Daveed Gearithy',
      '  - key: wife',
      '    name: Eilwen Gearithy',
    ].join('\n'));
    expect(items.map((x) => x.address)).toEqual([
      'content:characters/founding.yaml#characters[key=founder].name',
      'content:characters/founding.yaml#characters[key=wife].name',
    ]);
  });

  it('gives generated narrative prose a wording-independent source ordinal and keeps template tokens', () => {
    const before = plainEnglishCoreWorkItems('year/example.ts', [
      "const first = 'The house paid and the clerk looked away.';",
      "const second = `\${name} was born, and \${guardian.name} named the child.`;",
    ].join('\n'));
    const after = plainEnglishCoreWorkItems('year/example.ts', [
      "const first = 'The family paid and the clerk said nothing.';",
      "const second = `\${name} arrived, and \${guardian.name} gave the child a name.`;",
    ].join('\n'));
    expect(before.map((x) => x.address)).toEqual(after.map((x) => x.address));
    expect(before.map((x) => x.address)).toEqual([
      'core:year/example.ts#literal[1]',
      'core:year/example.ts#literal[2]',
    ]);
    expect(before[1]).toMatchObject({
      text: '${name} was born, and ${guardian.name} named the child.',
      interpolations: ['${name}', '${guardian.name}'],
    });
  });

  it('does not renumber later core work items when earlier wording stops qualifying as prose', () => {
    const before = plainEnglishCoreWorkItems('year/example.ts', [
      "const first = 'The house remembers this sentence.';",
      "const second = 'The second sentence keeps its identity.';",
    ].join('\n'));
    const after = plainEnglishCoreWorkItems('year/example.ts', [
      "const first = 'Gone now';",
      "const second = 'The second sentence keeps its identity.';",
    ].join('\n'));

    expect(before.map((x) => x.address)).toEqual([
      'core:year/example.ts#literal[1]',
      'core:year/example.ts#literal[2]',
    ]);
    expect(after).toHaveLength(1);
    expect(after[0]?.address).toBe('core:year/example.ts#literal[2]');
    expect(after[0]?.address).toBe(before[1]?.address);
  });

  it('finds sentences in code, and not comments, imports or developer messages', () => {
    const found = sentenceLiterals([
      "import { x } from './a module with spaces.js';",
      '// a comment that reads like a sentence here',
      "/* and 'a quoted one' in a block comment too */",
      "throw new Error('this is for a developer only');",
      "const id = 'not_a_sentence';",
      "const line = `${name} was born, and named.`;",
      "const other = 'The house paid, and did not say why.';",
    ].join('\n'));
    expect(found).toEqual(['X was born, and named.', 'The house paid, and did not say why.']);
  });

  it('reads a component three ways and skips bound attributes and mustaches', () => {
    const rows = auditVueFile('components/Thing.vue', [
      '<template>',
      '  <!-- not this -->',
      '  <button title="Answer the docket" :title="bound">Answer {{ count }}</button>',
      '  <p>{{ onlyAnExpression }}</p>',
      '</template>',
      '<script setup lang="ts">',
      "const hint = 'Nobody in the hall can read.';",
      '</script>',
    ].join('\n'));
    expect(rows.map((r) => [r.source, r.strings])).toEqual([
      ['client-template', 1],
      ['client-attribute', 1],
      ['client-script', 1],
    ]);
  });

  it('notices a prose field that neither list accounts for', () => {
    expect(unclassifiedContentKeys([
      'events:',
      '  - id: a_scene',
      '    title: Counted, because title is known',
      '    whisper: a new field somebody added last week',
      '    note: a designer note, known not to count',
      '    tag: single_word_ids_are_never_prose',
    ].join('\n'))).toEqual(['whisper']);
  });

  it('knows whether every multi-word content field counts', () => {
    const content = join(REPO, 'packages/content');
    const walk = (d: string): string[] => readdirSync(join(content, d)).flatMap((e) => {
      const rel = d ? `${d}/${e}` : e;
      return statSync(join(content, rel)).isDirectory() ? walk(rel) : rel.endsWith('.yaml') ? [rel] : [];
    });
    const unknown = walk('').flatMap((f) =>
      unclassifiedContentKeys(readFileSync(join(content, f), 'utf8')).map((k) => `${f} → ${k}`));
    expect(
      unknown,
      'a content key carries prose and string-audit.ts does not say whether a player reads it: '
      + 'add it to CONTENT_PROSE_KEYS, or to CONTENT_NOT_PROSE with the reason',
    ).toEqual([]);
  });

  it('inventories the real repository in every voice, the same way twice', () => {
    const rows = auditRepository(REPO);
    const voices = new Set(rows.map((r) => r.voice));
    expect(VOICES.filter((v) => !voices.has(v))).toEqual([]);
    expect(report(auditRepository(REPO), { files: true })).toEqual(report(rows, { files: true }));
  });

  it('makes the #410 worklist exactly cover the audit\'s non-interface narrative strings', () => {
    const rows = auditRepository(REPO);
    const expected = rows
      .filter((r) => r.voice !== 'interface')
      .reduce((sum, r) => sum + r.strings, 0);
    const items = plainEnglishWorklist(REPO);
    expect(items.length).toBe(expected);
    expect(new Set(items.map((x) => x.address)).size).toBe(items.length);
    expect(plainEnglishWorklist(REPO)).toEqual(items);
    expect(items.some((x) => x.voice === 'event')).toBe(true);
    expect(items.some((x) => x.voice === 'chronicler')).toBe(true);
  });
});
