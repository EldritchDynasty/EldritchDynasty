/** Inventory and validation shared by the duration importer and its CI repair. */
import { readdirSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';

export function testInventory(root, dir = 'packages') {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name === 'dist') return [];
    const path = `${dir}/${entry.name}`;
    return entry.isDirectory() ? testInventory(root, path)
      : entry.isFile() && entry.name.endsWith('.test.ts') ? [path] : [];
  }).sort();
}

/** A failed, partial, foreign-host or malformed report cannot replace the table. */
export function validateDurationReport(raw, root, { complete = false, cpus = 4 } = {}) {
  if (!raw?.files || typeof raw.files !== 'object' || Array.isArray(raw.files)) {
    throw new Error('Duration report has no file measurements');
  }
  const files = {};
  for (const [path, parts] of Object.entries(raw.files)) {
    const key = (isAbsolute(path) ? relative(root, path) : path).split(sep).join('/');
    if (!key.startsWith('packages/') || !key.endsWith('.test.ts')
      || key.split('/').includes('..') || !Number.isFinite(parts?.total) || parts.total < 0) {
      throw new Error(`Invalid duration measurement: ${path}`);
    }
    if (Object.hasOwn(files, key)) throw new Error(`Duplicate duration measurement: ${key}`);
    files[key] = Math.round(parts.total);
  }
  if (!Object.keys(files).length) throw new Error('Duration report is empty');
  if (raw.summary?.success === false) throw new Error('Duration report contains failed tests');
  if (complete) {
    if (raw.summary?.success !== true || raw.host?.cpus !== cpus) {
      throw new Error(`Complete duration report requires a successful ${cpus}-CPU run`);
    }
    const expected = testInventory(root);
    const actual = Object.keys(files).sort();
    if (JSON.stringify(expected) !== JSON.stringify(actual)
      || raw.summary.files !== actual.length) {
      throw new Error('Duration report does not cover the complete current test inventory');
    }
  }
  return files;
}
