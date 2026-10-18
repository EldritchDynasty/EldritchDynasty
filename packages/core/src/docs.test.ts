import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT_RULES, EffectS, SlotRoleS, vocabulary } from '@ed/schema';
import { renderVocabulary, vocabularyIsCurrent, VOCABULARY_PATH } from './tools/gen-docs.js';
import { YEAR_PHASES } from './year/phases.js';

const REPO = join(import.meta.dirname, '../../..');

/** Only the inventory counts; mentioning a file elsewhere does not orient a reader. */
function unnamedRoots(roots: Iterable<string>, readme: string): string[] {
  const inventory = /## What's here\r?\n([\s\S]*?)(?=\r?\n## |$)/.exec(readme)?.[1] ?? '';
  const layout = /```[^\n]*\r?\n([\s\S]*?)```/.exec(inventory)?.[1] ?? '';
  const documents = /## Other documents\r?\n([\s\S]*?)(?=\r?\n## |$)/.exec(readme)?.[1] ?? '';
  const named = new Set([
    ...layout.split(/\r?\n/).filter((line) => /^\S/.test(line))
      .map((line) => line.split(/\s/)[0]!.split('/')[0]!),
    ...documents.split(/\r?\n/).filter((line) => line.startsWith('|'))
      .flatMap((line) => [...(line.split('|')[1] ?? '').matchAll(/`([^`]+)`|\[([^\]]+)\]\([^)]*\)/g)])
      .map((match) => (match[1] ?? match[2])!.split('/')[0]!),
  ]);
  return [...roots].filter((root) => !named.has(root)).sort();
}

describe('the README inventories the tracked root', () => {
  it('names every tracked root entry in the layout or Other documents table', () => {
    // git emits slash-separated paths on Windows too. -z preserves spaces and
    // avoids core.quotePath escaping a tracked name before we compare it.
    const roots = new Set(execFileSync('git', ['ls-files', '-z'], { cwd: REPO, encoding: 'utf8' })
      .split('\0').filter(Boolean).map((file) => file.split('/')[0]!));
    const missing = unnamedRoots(roots, readFileSync(join(REPO, 'README.md'), 'utf8'));
    expect(missing, `README inventory is missing tracked root entries: ${missing.join(', ')}`).toEqual([]);
  });

  it('reports missing entries by their literal names, including spaces and dotfiles', () => {
    const readme = [
      '## What\'s here', '', '```', 'packages/  Workspace packages.', '```', '',
      '## Other documents', '', '| File | Purpose |', '|---|---|',
      '| `market research.md` | Evidence. |', '| [.gitignore](.gitignore) | Exclusions. |', '',
      '## Elsewhere', '', '`missing.md` and `.github` are mentioned here.',
    ].join('\r\n');
    expect(unnamedRoots(['packages', 'market research.md', '.gitignore'], readme)).toEqual([]);
    expect(unnamedRoots(['missing.md', '.git', '.github', 'research.md', 'package'], readme))
      .toEqual(['.git', '.github', 'missing.md', 'package', 'research.md']);
    expect(unnamedRoots(['packages'], readme.replace('## What\'s here', '## Another section')))
      .toEqual(['packages']);
  });
});

/**
 * `docs/VOCABULARY.md` is generated the way `loci.yaml` is, and for the same
 * reason: a reference kept by hand is wrong by the second commit, and a wrong
 * reference is worse than none — it is read and believed.
 */
describe('the generated reference', () => {
  it('is up to date', () => {
    expect(
      vocabularyIsCurrent(),
      'docs/VOCABULARY.md is stale — run `npm run gen:docs`',
    ).toBe(true);
  });

  it('names every effect kind, slot role, phase and rule', () => {
    const text = renderVocabulary();
    for (const kind of EffectS.options.map((o) => o.shape.kind.value)) {
      expect(text, `effect '${kind}' is not in the reference`).toContain(`\`${kind}\``);
    }
    for (const role of SlotRoleS.options) {
      expect(text, `slot role '${role}' is not in the reference`).toContain(`\`${role}\``);
    }
    for (const phase of YEAR_PHASES) {
      expect(text, `phase '${phase.name}' is not in the reference`).toContain(`\`${phase.name}\``);
    }
    for (const rule of CONTENT_RULES) {
      expect(text, `rule '${rule.id}' is not in the reference`).toContain(`\`${rule.id}\``);
    }
  });

  it('says out loud that it is generated', () => {
    expect(readFileSync(VOCABULARY_PATH, 'utf8')).toContain('Generated');
  });

  it('does not describe a condition or filter twice', () => {
    const v = vocabulary();
    for (const group of [v.conditions, v.filters, v.effects]) {
      const names = group.map((x) => x.name);
      expect(new Set(names).size, `duplicate in ${names.join(', ')}`).toBe(names.length);
    }
  });

  it('describes every condition and filter the engine can evaluate', () => {
    const v = vocabulary();
    // `evalCondition` and `evalFilter` are exhaustive over these unions — see
    // the `assertNever` at the end of each. If the reference lists them all,
    // an author never has to open `conditions.ts` to find out what exists.
    const source = readFileSync(join(import.meta.dirname, 'events', 'conditions.ts'), 'utf8');
    for (const c of v.conditions) {
      expect(source, `condition '${c.name}' is in the schema and not in evalCondition`)
        .toContain(`'${c.name}' in c`);
    }
    for (const f of v.filters) {
      expect(source, `filter '${f.name}' is in the schema and not in evalFilter`)
        .toContain(`'${f.name}' in f`);
    }
  });
});
