import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * NO RULE READS ENGLISH (issue #276, step 2).
 *
 * A rule that decides something by searching a sentence — `blocked.startsWith
 * ('the book holds ')`, `card.words.includes('deep blood')`, a chronicle line
 * `includes('Blight took hold in')` — works exactly until somebody rewords the
 * sentence or translates it, and then it silently stops deciding. Nothing
 * throws. The page is never written, the card reads a different future, the
 * gate stops counting a loss route; every one of those shipped, and #276 took
 * them out one at a time.
 *
 * So this scans `packages/core/src` for the shape they all had: a player-facing
 * string field followed by `.includes(`, `.startsWith(`, `.endsWith(` or
 * `.match(`. Read structure instead — an id, an enum, a tag, a field the
 * writer of the sentence set at the same moment it chose the words.
 *
 * `ALLOWED` is the exception list, and it is EMPTY. An entry there needs a
 * reason a reviewer would accept for a rule depending on the wording of a
 * sentence; there has not been one yet.
 *
 * There are no grandfathered sites: the scan is expected to stay empty.
 */

const SRC = join(import.meta.dirname);

/** A player-facing string, then a substring test on it. */
const ENGLISH_READ =
  /\b(?:text|title|label|blocked|teller|words)\??\.(?:includes|startsWith|endsWith|match)\(/g;

const ALLOWED: Record<string, string> = {};

/** Every non-test TypeScript file under a directory, `/`-separated and relative to it. */
function sources(dir: string, rel = '', out: string[] = []): string[] {
  for (const entry of readdirSync(join(dir, rel)).sort()) {
    const path = rel ? `${rel}/${entry}` : entry;
    if (statSync(join(dir, path)).isDirectory()) sources(dir, path, out);
    else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) out.push(path);
  }
  return out;
}

/** Each English-reading line in a source, as `line: text`. */
function englishReads(source: string): string[] {
  return source.split('\n').flatMap((line, i) => {
    const hits = line.match(ENGLISH_READ)?.length ?? 0;
    return Array.from({ length: hits }, () => `${i + 1}: ${line.trim()}`);
  });
}

describe('no rule reads English (issue #276)', () => {
  const found = new Map<string, string[]>();
  for (const file of sources(SRC)) {
    const reads = englishReads(readFileSync(join(SRC, file), 'utf8'));
    if (reads.length) found.set(file, reads);
  }

  it('catches the shape it is looking for', () => {
    // Planted, so this guard is seen failing and not merely passing.
    expect(englishReads("if (card.words.includes('deep blood')) score += 3;")).toHaveLength(1);
    expect(englishReads("standing.blocked?.startsWith('the book holds ')")).toHaveLength(1);
    expect(englishReads('entry.text?.includes(a) || entry.teller.includes(b)')).toHaveLength(2);
    expect(englishReads("if (card.blood === 'deep') score += 3;")).toEqual([]);
  });

  it('has no exceptions', () => {
    expect(Object.keys(ALLOWED)).toEqual([]);
  });

  it('finds no new site that reads a sentence to decide something', () => {
    const unexpected = [...found]
      .flatMap(([file, reads]) => reads.map((r) => `packages/core/src/${file}:${r}`));
    expect(
      unexpected,
      'a rule reads English here. Decide from an id, enum or field the writer of the sentence set, '
      + 'not from the sentence — a reworded or translated line silently stops deciding',
    ).toEqual([]);
  });

});
