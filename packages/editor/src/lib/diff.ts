/**
 * A line-level diff, hand-rolled — no dependency, in keeping with the house
 * style (`FamilyTree.vue`, `Sigil.vue`). Classic LCS via dynamic programming;
 * content files run tens to a few hundred lines, so the O(n·m) table is
 * nothing to worry about.
 */
export type DiffLine =
  | { kind: 'same'; text: string }
  | { kind: 'add'; text: string }
  | { kind: 'del'; text: string };

export function diffLines(before: string, after: string): DiffLine[] {
  // Exactly empty files have no lines; a trailing newline in a nonempty
  // file still denotes an actual empty final line.
  const a = before === '' ? [] : before.split('\n');
  const b = after === '' ? [] : after.split('\n');
  const n = a.length;
  const m = b.length;

  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: 'same', text: a[i]! });
      i += 1;
      j += 1;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      out.push({ kind: 'del', text: a[i]! });
      i += 1;
    } else {
      out.push({ kind: 'add', text: b[j]! });
      j += 1;
    }
  }
  while (i < n) { out.push({ kind: 'del', text: a[i]! }); i += 1; }
  while (j < m) { out.push({ kind: 'add', text: b[j]! }); j += 1; }
  return out;
}

/** Same lines dropped except a little context — a diff nobody can read is a diff nobody checks before writing. */
export function collapseContext(lines: DiffLine[], context = 2): (DiffLine | { kind: 'gap' })[] {
  const changed = lines.map((l, i) => (l.kind !== 'same' ? i : -1)).filter((i) => i >= 0);
  if (!changed.length) return lines;

  const keep = new Set<number>();
  for (const c of changed) {
    for (let k = Math.max(0, c - context); k <= Math.min(lines.length - 1, c + context); k++) keep.add(k);
  }

  const out: (DiffLine | { kind: 'gap' })[] = [];
  // -1, so the first kept line at index 0 reads as "nothing was skipped before
  // this". At -2 it read as a gap, and the view drew a `⋯` above the first line
  // of every diff that began at the top of the file — an elision marker for an
  // elision that had not happened.
  let lastKept = -1;
  for (let i = 0; i < lines.length; i++) {
    if (!keep.has(i)) continue;
    if (i > lastKept + 1) out.push({ kind: 'gap' });
    out.push(lines[i]!);
    lastKept = i;
  }
  return out;
}
