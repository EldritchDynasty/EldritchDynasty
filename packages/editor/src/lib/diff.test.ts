import { describe, expect, it } from 'vitest';
import { collapseContext, diffLines, type DiffLine } from './diff.js';

/**
 * THE DIFF THE AUTHOR READS BEFORE ANYTHING REACHES DISK.
 *
 * Issue #21 exists because the write-back store cannot promise a minimal diff:
 * an edited item re-serialises from its live, Zod-parsed state, so optional
 * fields Zod filled in become explicit and flow-style arrays come back block
 * style. The diff is how an author sees that before saying yes.
 *
 * It is sixty-five lines of hand-rolled LCS with no dependency and, until now,
 * no test — the whole `editor` package had never been imported by anything.
 * These are pure functions over two strings, so the only thing that was ever
 * stopping this was that nobody had written it.
 */

const render = (lines: (DiffLine | { kind: 'gap' })[]) =>
  lines.map((l) => ('text' in l ? `${l.kind[0]} ${l.text}` : '...')).join('\n');

describe('diffLines', () => {
  it('calls two identical texts identical', () => {
    const out = diffLines('a\nb\nc', 'a\nb\nc');
    expect(out.every((l) => l.kind === 'same')).toBe(true);
    expect(out).toHaveLength(3);
  });

  it('finds a single inserted line and leaves the rest alone', () => {
    expect(render(diffLines('a\nc', 'a\nb\nc'))).toBe('s a\na b\ns c');
  });

  it('finds a single deleted line', () => {
    expect(render(diffLines('a\nb\nc', 'a\nc'))).toBe('s a\nd b\ns c');
  });

  /** A changed line is a delete and an add, which is what a line diff can say. */
  it('reads a changed line as a delete beside an add', () => {
    expect(render(diffLines('a\nb\nc', 'a\nB\nc'))).toBe('s a\nd b\na B\ns c');
  });

  it('does not invent a blank line for an entirely empty document (#932)', () => {
    expect(diffLines('', '')).toEqual([]);
    expect(diffLines('', 'alpha\nbeta')).toEqual([
      { kind: 'add', text: 'alpha' },
      { kind: 'add', text: 'beta' },
    ]);
    expect(diffLines('alpha\nbeta', '')).toEqual([
      { kind: 'del', text: 'alpha' },
      { kind: 'del', text: 'beta' },
    ]);
  });

  it('preserves real blank lines when a nonempty document ends in a newline', () => {
    expect(diffLines('', '\n')).toEqual([
      { kind: 'add', text: '' },
      { kind: 'add', text: '' },
    ]);
    expect(diffLines('\n', '')).toEqual([
      { kind: 'del', text: '' },
      { kind: 'del', text: '' },
    ]);
  });

  it('handles an empty side in both directions', () => {
    expect(diffLines('', 'a\nb').filter((l) => l.kind === 'add')).toHaveLength(2);
    expect(diffLines('a\nb', '').filter((l) => l.kind === 'del')).toHaveLength(2);
  });

  it('keeps the longest common subsequence rather than rewriting the file', () => {
    const before = 'one\ntwo\nthree\nfour\nfive';
    const after = 'one\ntwo\nTHREE\nfour\nfive';

    const out = diffLines(before, after);

    expect(out.filter((l) => l.kind === 'same')).toHaveLength(4);
    expect(out.filter((l) => l.kind === 'del')).toHaveLength(1);
    expect(out.filter((l) => l.kind === 'add')).toHaveLength(1);
  });

  /**
   * The property that makes a diff a diff: replaying it reconstructs both
   * sides. Cheaper to assert than every shape the LCS table can take.
   */
  it('replays back to both texts', () => {
    const before = 'alpha\nbeta\ngamma\ndelta\nepsilon\nzeta';
    const after = 'alpha\ngamma\nGAMMA2\ndelta\nzeta\neta';
    const out = diffLines(before, after);

    const rebuiltBefore = out.filter((l) => l.kind !== 'add').map((l) => l.text).join('\n');
    const rebuiltAfter = out.filter((l) => l.kind !== 'del').map((l) => l.text).join('\n');

    expect(rebuiltBefore).toBe(before);
    expect(rebuiltAfter).toBe(after);
  });

  it('replays back for a reordering, which is the case naive diffs get wrong', () => {
    const before = 'a\nb\nc\nd';
    const after = 'd\nc\nb\na';
    const out = diffLines(before, after);

    expect(out.filter((l) => l.kind !== 'add').map((l) => l.text).join('\n')).toBe(before);
    expect(out.filter((l) => l.kind !== 'del').map((l) => l.text).join('\n')).toBe(after);
  });

  it('treats a trailing newline as the empty last line it is', () => {
    const out = diffLines('a\n', 'a');
    expect(out.filter((l) => l.kind === 'del').map((l) => l.text)).toEqual(['']);
  });
});

describe('collapseContext', () => {
  const lines = (n: number) => Array.from({ length: n }, (_, i) => `line ${i}`).join('\n');

  it('leaves an unchanged diff exactly as it found it', () => {
    const same = diffLines(lines(20), lines(20));
    expect(collapseContext(same)).toBe(same);
  });

  it('keeps the changed line and the context either side of it', () => {
    const before = lines(20);
    const after = before.split('\n').map((l, i) => (i === 10 ? 'CHANGED' : l)).join('\n');

    const out = collapseContext(diffLines(before, after), 2);
    const texts = out.filter((l): l is DiffLine => 'text' in l).map((l) => l.text);

    expect(texts).toContain('line 8');
    expect(texts).toContain('CHANGED');
    expect(texts).toContain('line 12');
    expect(texts).not.toContain('line 0');
    expect(texts).not.toContain('line 19');
  });

  it('marks each elision once, and not at the very start when the change is there', () => {
    const before = lines(30);
    const after = before.split('\n').map((l, i) => (i === 1 || i === 25 ? `${l}!` : l)).join('\n');

    const out = collapseContext(diffLines(before, after), 2);
    const gaps = out.filter((l) => l.kind === 'gap');

    // One gap between the two changed regions, and none before the first,
    // which begins within the context window of line 0.
    expect(gaps).toHaveLength(1);
    expect(out[0]!.kind).not.toBe('gap');
  });

  it('a wide enough context window elides nothing', () => {
    const before = lines(10);
    const after = before.split('\n').map((l, i) => (i === 5 ? 'CHANGED' : l)).join('\n');

    const out = collapseContext(diffLines(before, after), 50);
    expect(out.some((l) => l.kind === 'gap')).toBe(false);
  });

  it('a zero context window keeps only what actually changed', () => {
    const before = lines(10);
    const after = before.split('\n').map((l, i) => (i === 5 ? 'CHANGED' : l)).join('\n');

    const out = collapseContext(diffLines(before, after), 0);
    const texts = out.filter((l): l is DiffLine => 'text' in l).map((l) => l.text);

    expect(texts).toEqual(['line 5', 'CHANGED']);
  });
});
