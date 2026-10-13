import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isMap, isScalar, isSeq, parseDocument } from 'yaml';
import { proseOriginalHash } from '@ed/schema';

/**
 * #343 — THE NARRATOR IS A ROLE, NOT A NAME.
 *
 * The founder may now take the player's name, so core/content must never use
 * the old default name to identify the Narrator. Comments may discuss the
 * historical/default name; player-facing or executable text may not.
 *
 * The exceptions are the authored blank-name fallback in founding.yaml and
 * its reviewed proper-name gloss (#1576), at that field's exact address.
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
const foundingPath = join(repoRoot, 'packages/content/characters/founding.yaml');
const founderNameAddress = 'content:characters/founding.yaml#characters[key=founder].name';

function withoutReviewedFounderGloss(source: string): string {
  const ranges: [number, number][] = [];
  const document = parseDocument(source);
  if (document.errors.length || !isMap(document.contents)) return source;
  const variants = document.get('proseVariants', true);
  if (!isSeq(variants)) return source;
  for (const row of variants.items) {
    if (!isMap(row) || row.get('address') !== founderNameAddress
      || row.get('of') !== proseOriginalHash(defaultFounderName)) continue;
    const wording = row.get('plainenglish', true);
    if (!isScalar(wording) || !wording.range
      || wording.value !== `${defaultFounderName} (the founder and narrator)`) continue;
    ranges.push([wording.range[0], wording.range[1]]);
  }
  // Remove only the scalar, preserving line numbers and other fields even
  // when a flow-map puts them on the same line as the allowed counterpart.
  for (const [start, end] of ranges.sort((a, b) => b[0] - a[0])) {
    source = source.slice(0, start) + source.slice(start, end).replace(/[^\r\n]/g, ' ') + source.slice(end);
  }
  return source;
}

function filesUnder(root: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    if (statSync(path).isDirectory()) out.push(...filesUnder(path));
    else if (['.ts', '.vue', '.yaml', '.yml'].includes(extname(path))) out.push(path);
  }
  return out;
}

function codeLines(path: string, source = readFileSync(path, 'utf8')): { line: number; text: string }[] {
  const yaml = ['.yaml', '.yml'].includes(extname(path));
  const lines = (path === foundingPath ? withoutReviewedFounderGloss(source) : source).split(/\r?\n/);
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
  it('allows the default founder name only as the blank-name fallback and its reviewed gloss', () => {
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

  it('still detects a default name outside the exact reviewed fallback-name variant', () => {
    const counterpart = (address = founderNameAddress, of = proseOriginalHash(defaultFounderName)) =>
      `proseVariants:\n  - address: "${address}"\n    of: "${of}"\n    plainenglish: >-\n      ${defaultFounderName} (the founder and narrator)\n`;
    const hits = (path: string, source: string) => codeLines(path, source)
      .filter(({ text }) => text.includes(defaultGivenName));
    expect(hits(foundingPath, counterpart())).toEqual([]);
    expect(hits(foundingPath, counterpart(founderNameAddress.replace('.name', '.note')))).toHaveLength(1);
    expect(hits(foundingPath, counterpart(founderNameAddress, '0000000000000000'))).toHaveLength(1);
    expect(hits(join(repoRoot, 'packages/content/prologue.yaml'), counterpart())).toHaveLength(1);
    expect(hits(foundingPath, counterpart() + `extra: ${defaultFounderName}\n`)).toHaveLength(1);
    const flow = `proseVariants: [{address: "${founderNameAddress}", of: "${proseOriginalHash(defaultFounderName)}", plainenglish: "${defaultFounderName} (the founder and narrator)", extra: "${defaultFounderName}"}]`;
    expect(hits(foundingPath, flow)).toHaveLength(1);
  });
});
