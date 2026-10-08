import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { proseOriginalHash, type ProseVariant } from '@ed/schema';
import type { PlainEnglishWorkItem } from './string-audit.js';
import { auditStringsOutput, pendingPlainEnglishWorklist } from './string-audit-cli.js';

const item = (
  address: string,
  text: string,
  source: PlainEnglishWorkItem['source'] = 'content',
): PlainEnglishWorkItem => ({
  source,
  file: source === 'content' ? 'events/example.yaml' : 'year/example.ts',
  voice: source === 'content' ? 'event' : 'chronicler',
  address,
  text,
  words: text.trim().split(/\s+/).length,
  interpolations: [],
});

describe('the Plain English migration worklist (#415)', () => {
  it('drops current variants and returns missing or stale work with the expected fingerprint', () => {
    const currentText = 'The current wording stays reviewed.';
    const staleText = 'The Original wording changed after review.';
    const items = [
      item('content:events/example.yaml#events[id=current].body', currentText),
      item('content:events/example.yaml#events[id=stale].body', staleText),
      item('content:events/example.yaml#events[id=missing].body', 'No counterpart exists here.'),
      item('core:year/example.ts#literal[1]', 'Generated prose is still pending.', 'core'),
    ];
    const variants: ProseVariant[] = [
      {
        address: items[0]!.address,
        plainenglish: 'The reviewed direct wording.',
        of: proseOriginalHash(currentText),
      },
      {
        address: items[1]!.address,
        plainenglish: 'The old direct wording.',
        of: '0000000000000000',
      },
    ];

    const pending = pendingPlainEnglishWorklist(items, variants);
    expect(pending.map((entry) => [entry.address, entry.variantStatus])).toEqual([
      [items[1]!.address, 'stale'],
      [items[2]!.address, 'missing'],
      [items[3]!.address, 'missing'],
    ]);
    expect(pending[0]).toMatchObject({
      authoredOf: '0000000000000000',
      expectedOf: proseOriginalHash(staleText),
    });
    expect(pending[1]!.expectedOf).toBe(proseOriginalHash(items[2]!.text));
  });

  it('treats an unfingerprinted legacy variant as stale so it cannot disappear from the worklist', () => {
    const original = item('content:events/example.yaml#events[id=legacy].body', 'The old row still loads.');
    const variants: ProseVariant[] = [{
      address: original.address,
      plainenglish: 'The old row has a counterpart.',
    }];

    expect(pendingPlainEnglishWorklist([original], variants)).toEqual([
      expect.objectContaining({ address: original.address, variantStatus: 'stale' }),
    ]);
  });
});

describe('audit:strings CLI dispatch (#623)', () => {
  it('emits the JSON coverage report through the npm entry point, not the inventory', () => {
    const repo = mkdtempSync(join(tmpdir(), 'ed-audit-cli-'));
    try {
      const dir = join(repo, 'packages/content/events');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'tiny.yaml'), [
        'events:',
        '  - id: example',
        '    body: The house keeps the written record.',
        '',
      ].join('\n'), 'utf8');

      const coverage = JSON.parse(auditStringsOutput(['--plainenglish-coverage'], repo));
      expect(coverage).toMatchObject({
        total: 1,
        current: 0,
        missing: 1,
        stale: 0,
        invalid: 0,
        remaining: [{
          source: 'content',
          file: 'events/tiny.yaml',
          address: 'content:events/tiny.yaml#events[id=example].body',
          status: 'missing',
          expectedOf: proseOriginalHash('The house keeps the written record.'),
        }],
      });
      expect(coverage.remaining).toHaveLength(1);

      // Coverage wins over the legacy worklist flag; --files retains the
      // original human-readable inventory output.
      expect(JSON.parse(auditStringsOutput([
        '--plainenglish-worklist', '--plainenglish-coverage',
      ], repo))).toEqual(coverage);
      expect(auditStringsOutput(['--files'], repo)).toContain('STRING SOURCES');
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
