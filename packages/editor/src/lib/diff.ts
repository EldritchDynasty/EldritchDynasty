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

/**
 * Keep the expensive LCS table proportional to the changed region, not the
 * whole YAML file. A large divergent file still needs a safe preview: when
 * the middle exceeds the cell budget, show truthful deletes and adds instead
 * of exhausting the editor's memory before an author can review a save.
 */
export const MAX_DIFF_LCS_CELLS = 1_000_000;

export function diffLines(before: string, after: string): DiffLine[] {
  // A trailing newline in a nonempty file denotes a real empty final line.
  const a = before === '' ? [] : before.split('\n');
  const b = after === '' ? [] : after.split('\n');

  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;

  let suffix = 0;
  while (suffix < a.length - prefix && suffix < b.length - prefix
    && a[a.length - suffix - 1] === b[b.length - suffix - 1]) suffix++;

  const left = a.slice(prefix, a.length - suffix);
  const right = b.slice(prefix, b.length - suffix);
  const n = left.length;
  const m = right.length;
  const out: DiffLine[] = [];

  for (let i = 0; i < prefix; i++) out.push({ kind: 'same', text: a[i]! });

  if ((n + 1) * (m + 1) > MAX_DIFF_LCS_CELLS) {
    // A non-minimal diff is preferable to a stalled or crashed write preview.
    // Both complete sides remain reconstructable; no changed line is hidden.
    for (const text of left) out.push({ kind: 'del', text });
    for (const text of right) out.push({ kind: 'add', text });
  } else {
    const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lcs[i]![j] = left[i] === right[j] ? lcs[i + 1]![j + 1]! + 1
          : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
      }
    }

    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (left[i] === right[j]) {
        out.push({ kind: 'same', text: left[i]! });
        i++;
        j++;
      } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
        out.push({ kind: 'del', text: left[i]! });
        i++;
      } else {
        out.push({ kind: 'add', text: right[j]! });
        j++;
      }
    }
    while (i < n) { out.push({ kind: 'del', text: left[i]! }); i++; }
    while (j < m) { out.push({ kind: 'add', text: right[j]! }); j++; }
  }

  for (let i = a.length - suffix; i < a.length; i++) {
    out.push({ kind: 'same', text: a[i]! });
  }
  return out;
}

/** Same lines dropped except a little context — a diff nobody can read is a diff nobody checks before writing. */
export function collapseContext(lines: DiffLine[], context = 2): (DiffLine | { kind: 'gap' })[] {
  const changed = lines.map((l, i) => (l.kind !== 'same' ? i : -1)).filter((i) => i >= 0);
  if (!changed.length) return lines;

  // A fractional window walks fractional indexes and never keeps the changed
  // integer indexes; a negative/NaN window can hide every edit altogether.
  // Normalize first so even a bad caller cannot conceal the author's changes.
  const radius = context === Infinity ? lines.length
    : Number.isFinite(context) ? Math.max(0, Math.floor(context)) : 0;
  const keep = new Set<number>();
  for (const c of changed) {
    for (let k = Math.max(0, c - radius); k <= Math.min(lines.length - 1, c + radius); k++) keep.add(k);
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
  // A preview that hides the untouched suffix must say so. Without this
  // marker the author can mistake a truncated file for its actual end.
  if (lastKept < lines.length - 1) out.push({ kind: 'gap' });
  return out;
}
