import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ContentPathError, resolveContentPath, resolveExistingContentPath } from '../tools/content-path.mjs';

/**
 * THE GUARD ON THE ONE WRITABLE DIRECTORY.
 *
 * Written out four times across two transports and never once tested, which is
 * how three of the four copies came to disagree with each other. The weak one
 * was on the WRITE half of the dev-server bridge, and it let a sibling
 * directory through — `packages/content-x/` starts with `packages/content`.
 *
 * The table below is mostly refusals, because a guard is mostly refusals, and
 * the only way to know one works is to hand it the things it exists to stop.
 */

const ROOT = resolve('/repo/packages/content');

const rejects = (path: unknown) => expect(() => resolveContentPath(ROOT, path)).toThrow(ContentPathError);

describe('resolveContentPath admits content files', () => {
  it('takes an ordinary path under the root', () => {
    expect(resolveContentPath(ROOT, 'events/portions.yaml')).toBe(join(ROOT, 'events/portions.yaml'));
  });

  it('takes a file sitting directly in the root', () => {
    expect(resolveContentPath(ROOT, 'careers.yaml')).toBe(join(ROOT, 'careers.yaml'));
  });

  it('normalises a path that goes down and back up without leaving', () => {
    expect(resolveContentPath(ROOT, 'events/../careers.yaml')).toBe(join(ROOT, 'careers.yaml'));
  });
});

describe('resolveContentPath refuses everything else', () => {
  /**
   * THE DRIFT, as a test. `resolve` lands this at `packages/content-x/a.yaml`,
   * which `startsWith('/repo/packages/content')` answers TRUE for. The read
   * half caught it; the write half did not.
   */
  it('refuses a sibling directory that merely shares the root prefix', () => {
    rejects('../content-x/a.yaml');
    rejects('../contentx/a.yaml');
    rejects('../content-evil/events/a.yaml');
  });

  it('refuses a climb out of the repo', () => {
    rejects('../../../etc/passwd.yaml');
    rejects('../../schema/src/rules.yaml');
  });

  it('refuses an absolute path', () => {
    rejects('/etc/passwd.yaml');
    rejects(join(ROOT, '..', 'elsewhere.yaml'));
  });

  it('refuses the root directory itself', () => {
    rejects('');
    rejects('.');
    rejects('events/..');
  });

  /**
   * The shell refused non-YAML and the dev server did not, so the same editor
   * could write `.env` through one transport and not the other. The stricter
   * of the two is the correct one.
   */
  it('refuses anything that is not YAML, on both transports now', () => {
    rejects('events/portions.yml');
    rejects('.env');
    rejects('events/notes.md');
    rejects('events/');
  });

  it('refuses a path that is not a string at all', () => {
    rejects(undefined);
    rejects(null);
    rejects(42);
    rejects({ path: 'events/portions.yaml' });
  });

  it('says which rule refused, so the transport can report it', () => {
    expect(() => resolveContentPath(ROOT, '../content-x/a.yaml')).toThrow(/escapes content root/);
    expect(() => resolveContentPath(ROOT, 'events/notes.md')).toThrow(/YAML/);
  });
});


// The lexical resolver deliberately has no filesystem dependency: its old
// callers also need this physical check before opening an existing file.
describe('disk-bound content paths reject symlink escapes (#875)', () => {
  const temporary: string[] = [];
  afterEach(() => temporary.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

  function fixture() {
    const parent = mkdtempSync(join(tmpdir(), 'ed-content-path-'));
    temporary.push(parent);
    const root = join(parent, 'content');
    mkdirSync(join(root, 'events'), { recursive: true });
    const original = join(root, 'events', 'scene.yaml');
    writeFileSync(original, 'events: []\n');
    return { parent, root, original };
  }

  function linkOrSkip(destination: string, link: string, kind: 'file' | 'dir') {
    try {
      symlinkSync(destination, link, kind);
      return true;
    } catch (error) {
      if (['EPERM', 'EACCES', 'ENOSYS', 'EINVAL'].includes(
        (error as NodeJS.ErrnoException).code ?? '')) return false;
      throw error;
    }
  }

  it('returns a real existing YAML file path, not an unchecked input alias', () => {
    const { root, original } = fixture();
    expect(resolveExistingContentPath(root, 'events/scene.yaml')).toBe(realpathSync(original));
    expect(readFileSync(resolveExistingContentPath(root, 'events/scene.yaml'), 'utf8')).toBe('events: []\n');
    expect(() => resolveExistingContentPath(root, 'events/missing.yaml')).toThrow(ContentPathError);
  });

  it('refuses a YAML symlink to a sibling file outside the root', () => {
    const { parent, root } = fixture();
    const outside = join(parent, 'outside.yaml');
    writeFileSync(outside, 'outside: must-not-edit\n');
    if (!linkOrSkip(outside, join(root, 'events', 'redirect.yaml'), 'file')) return;
    expect(() => resolveExistingContentPath(root, 'events/redirect.yaml'))
      .toThrow(/escapes content root/);
    expect(readFileSync(outside, 'utf8')).toBe('outside: must-not-edit\n');
  });

  it('refuses traversal through a symlinked directory', () => {
    const { parent, root } = fixture();
    const outside = join(parent, 'outside');
    mkdirSync(outside);
    writeFileSync(join(outside, 'scene.yaml'), 'outside: true\n');
    if (!linkOrSkip(outside, join(root, 'events', 'redirected'), 'dir')) return;
    expect(() => resolveExistingContentPath(root, 'events/redirected/scene.yaml'))
      .toThrow(/escapes content root/);
  });

  it('allows an internal YAML symlink but opens its resolved in-root target', () => {
    const { root, original } = fixture();
    if (!linkOrSkip(original, join(root, 'events', 'alias.yaml'), 'file')) return;
    expect(resolveExistingContentPath(root, 'events/alias.yaml')).toBe(realpathSync(original));
  });

  it('refuses a YAML alias to a non-YAML file and a directory named .yaml', () => {
    const { root } = fixture();
    const hidden = join(root, 'private.txt');
    writeFileSync(hidden, 'not YAML');
    if (linkOrSkip(hidden, join(root, 'events', 'aliased.yaml'), 'file')) {
      expect(() => resolveExistingContentPath(root, 'events/aliased.yaml'))
        .toThrow(/content is YAML/);
    }
    mkdirSync(join(root, 'events', 'directory.yaml'));
    expect(() => resolveExistingContentPath(root, 'events/directory.yaml'))
      .toThrow(/not a regular file/);
  });
});
