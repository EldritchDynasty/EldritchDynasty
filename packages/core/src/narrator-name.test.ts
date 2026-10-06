import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * #343 — THE NARRATOR IS A ROLE, NOT A NAME.
 *
 * The founder may now take the player's name, so core/content must never use
 * the old default name to identify the Narrator. Comments may discuss the
 * historical/default name; player-facing or executable text may not.
 *
 * The single non-comment exception is the authored blank-name fallback in
 * characters/founding.yaml.
 */

const repoRoot = resolve(import.meta.dirname, '../../..');
const roots = [
  join(repoRoot, 'packages/core/src'),
  join(repoRoot, 'packages/content'),
];

// Keep the executable test itself out of the literal grep it enforces. The
// historical default may appear in comments, per #343, but not as code/data.
const defaultGivenName = ['Dav', 'eed'].join('');
const defaultFounderName = `${defaultGivenName} Gearithy`;

function filesUnder(root: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    if (statSync(path).isDirectory()) out.push(...filesUnder(path));
    else if (['.ts', '.vue', '.yaml', '.yml'].includes(extname(path))) out.push(path);
  }
  return out;
}

function codeLines(path: string): { line: number; text: string }[] {
  const yaml = ['.yaml', '.yml'].includes(extname(path));
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  const out: { line: number; text: string }[] = [];
  let inBlockComment = false;

  for (let index = 0; index < lines.length; index += 1) {
    let text = lines[index]!;
    if (yaml) {
      if (!text.trimStart().startsWith('#')) out.push({ line: index + 1, text });
      continue;
    }

    let code = '';
    let cursor = 0;
    while (cursor < text.length) {
      if (inBlockComment) {
        const end = text.indexOf('*/', cursor);
        if (end < 0) {
          cursor = text.length;
          continue;
        }
        inBlockComment = false;
        cursor = end + 2;
        continue;
      }

      const lineComment = text.indexOf('//', cursor);
      const blockComment = text.indexOf('/*', cursor);
      if (lineComment >= 0 && (blockComment < 0 || lineComment < blockComment)) {
        code += text.slice(cursor, lineComment);
        cursor = text.length;
        continue;
      }
      if (blockComment >= 0) {
        code += text.slice(cursor, blockComment);
        inBlockComment = true;
        cursor = blockComment + 2;
        continue;
      }

      code += text.slice(cursor);
      cursor = text.length;
    }
    out.push({ line: index + 1, text: code });
  }

  return out;
}

describe('the Narrator is never identified by the default founder name (#343)', () => {
  it('allows the default founder name only as the blank-name fallback in founding.yaml', () => {
    const hits = roots
      .flatMap(filesUnder)
      .flatMap((path) => codeLines(path)
        .filter(({ text }) => text.includes(defaultGivenName))
        .map(({ line, text }) => ({
          path: relative(repoRoot, path).replaceAll('\\', '/'),
          line,
          text: text.trim(),
        })));

    expect(hits).toEqual([
      {
        path: 'packages/content/characters/founding.yaml',
        line: expect.any(Number),
        text: `name: ${defaultFounderName}`,
      },
    ]);
  });
});
