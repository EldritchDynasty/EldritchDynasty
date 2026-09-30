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
 * `NOT_YET` held the sites known to read English while #270 and #276 took
 * them out, so this guard could land before the last was fixed. It is empty
 * now, and it stays in the file only so its "still true" check keeps anyone
 * from quietly re-listing a site instead of fixing it: an entry must be
 * earned by a real match, and the test below insists the list is empty.
 */

const SRC = join(import.meta.dirname);

/** A player-facing string, then a substring test on it. */
const ENGLISH_READ =
  /\b(?:text|title|label|blocked|teller|words)\??\.(?:includes|startsWith|endsWith|match)\(/g;

const ALLOWED: Record<string, string> = {};

/** File → how many matches it still has, and who is taking them out. */
const NOT_YET: Record<string, { sites: number; owner: string }> = {};

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
    expect(Object.keys(NOT_YET), 'every known English-reading site was fixed; fix a new one rather than listing it').toEqual([]);
  });

  it('finds no new site that reads a sentence to decide something', () => {
    const unexpected = [...found]
      .filter(([file]) => !(file in NOT_YET))
      .flatMap(([file, reads]) => reads.map((r) => `packages/core/src/${file}:${r}`));
    expect(
      unexpected,
      'a rule reads English here. Decide from an id, enum or field the writer of the sentence set, '
      + 'not from the sentence — a reworded or translated line silently stops deciding',
    ).toEqual([]);
  });

  for (const [file, { sites, owner }] of Object.entries(NOT_YET)) {
    it(`still has the ${sites} known site(s) in ${file}, or the entry goes`, () => {
      const now = found.get(file)?.length ?? 0;
      expect(
        now,
        now < sites
          ? `${file} reads English in fewer places than NOT_YET says (${owner}). Lower or delete its entry.`
          : `${file} reads English in MORE places than NOT_YET allows. The new one is not owned by anybody.`,
      ).toBe(sites);
    });
  }
});
