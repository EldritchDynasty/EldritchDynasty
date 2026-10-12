import { describe, expect, it, vi } from 'vitest';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CONTENT_ROOT, loadBundle } from './index.js';

/**
 * THE CACHE MUST BE INVISIBLE.
 *
 * Parsed YAML is cached to disk so 54 test files stop paying 670ms each to
 * re-read the same 74 documents. A cache that changes what the game loads, or
 * that keeps serving yesterday's content after an edit, would be far more
 * expensive than the parse it saves — and both failures are silent, which is
 * this codebase's whole problem.
 *
 * So: same bundle with the cache on and off, and an edit is seen immediately.
 */

function withCopiedContent<T>(fn: (root: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'ed-content-'));
  try {
    cpSync(CONTENT_ROOT, dir, { recursive: true, filter: (src) => !src.includes('node_modules') });
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('the content cache', () => {
  it('retains truncation diagnostics after the in-memory cache is discarded', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ed-content-flow-'));
    try {
      cpSync(CONTENT_ROOT, root, { recursive: true, filter: (src) => !src.includes('node_modules') });
      writeFileSync(join(root, 'events', 'flow_guard.yaml'),
        'events:\n  - effects:\n      - { kind: chronicle, text: The debt stood, unpaid. }');
      expect(() => loadBundle(root)).toThrow(/yaml\/flow-comma/);
      vi.resetModules();
      const fresh = await import('./index.js');
      expect(() => fresh.loadBundle(root)).toThrow(/events\/flow_guard.yaml:3 .*yaml\/flow-comma.*unpaid/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it('rejects truncated prose with the cache warm, on repeat loads, and without the cache', () => {
    withCopiedContent((root) => {
      loadBundle(root);
      const path = join(root, 'events', 'flow_guard.yaml');
      writeFileSync(path, 'events:\n  - effects:\n      - { kind: chronicle, text: The debt stood, unpaid. }');
      const reject = () => expect(() => loadBundle(root)).toThrow(/events\/flow_guard.yaml:3 .*yaml\/flow-comma.*unpaid/);
      reject();
      reject();
      process.env.ED_CONTENT_CACHE = 'off';
      try { reject(); } finally { delete process.env.ED_CONTENT_CACHE; }
    });
  });
  it('loads exactly what an uncached load would', () => {
    process.env.ED_CONTENT_CACHE = 'off';
    const plain = loadBundle();
    delete process.env.ED_CONTENT_CACHE;
    const cached = loadBundle();

    expect(JSON.stringify(cached)).toBe(JSON.stringify(plain));
  });

  it('still validates on every load, rather than caching a bundle that passed once', () => {
    withCopiedContent((root) => {
      loadBundle(root);

      // A tier no closed union has. Zod must reject it — if the cache held a
      // validated bundle instead of parsed documents, this would load fine.
      const path = join(root, 'events', 'rites.yaml');
      const broken = readFileSync(path, 'utf8').replace(/frequency: rare/, 'frequency: occasionally');
      expect(broken).not.toBe(readFileSync(path, 'utf8'));
      writeFileSync(path, broken);

      expect(() => loadBundle(root)).toThrow();
    });
  });

  it('sees an edit, because the key is the content', () => {
    withCopiedContent((root) => {
      const weightOf = (root: string): number | undefined =>
        loadBundle(root).events.find((e) => e.id === 'the_drowning')?.weight;

      // Warm the cache on the unedited copy first — without this the test
      // passes on a cache that never reads anything back.
      expect(weightOf(root)).toBe(600);

      const path = join(root, 'events', 'rites.yaml');
      const text = readFileSync(path, 'utf8');
      const edited = text.replace('weight: 600', 'weight: 601');
      expect(edited).not.toBe(text);
      writeFileSync(path, edited);

      expect(weightOf(root)).toBe(601);
    });
  });
});
