import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  lstatSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readRunLibrary, writeRunLibrary } from './run-library.mjs';

describe('the native Library read boundary (#2285)', () => {
  let root: string;
  const libraryPath = () => join(root, 'library.json');

  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'ed-library-handle-')); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it('distinguishes a missing Library from a present, readable object', () => {
    expect(readRunLibrary(root)).toBeNull();
    const library = { format: 1, runs: [{ id: 'remembered' }] };
    expect(writeRunLibrary(root, library)).toBe(libraryPath());
    expect(readRunLibrary(root)).toEqual(library);
    expect(readdirSync(root)).toEqual(['library.json']);
  });

  it('refuses a present null, array or malformed Library rather than treating it as missing', () => {
    for (const text of ['null', '[]', 'false', '42', '{not json']) {
      writeFileSync(libraryPath(), text, 'utf8');
      expect(() => readRunLibrary(root), text).toThrow();
      expect(readFileSync(libraryPath(), 'utf8')).toBe(text);
    }
  });

  it('rejects a link in place of library.json without reading the linked data', () => {
    const outside = join(root, 'private.json');
    writeFileSync(outside, '{"secret":"not the Library"}', 'utf8');
    try {
      symlinkSync(outside, libraryPath(), 'file');
    } catch (error) {
      if (['EPERM', 'EACCES', 'ENOSYS', 'EINVAL'].includes(
        (error as NodeJS.ErrnoException).code ?? '',
      )) return; // Windows may require Developer Mode for file symlinks.
      throw error;
    }
    expect(() => readRunLibrary(root)).toThrow('library is not a regular file');
    expect(readFileSync(outside, 'utf8')).toBe('{"secret":"not the Library"}');
  });

  it('closes the handle even when a present file fails parsing', () => {
    writeFileSync(libraryPath(), '{broken', 'utf8');
    expect(() => readRunLibrary(root)).toThrow();
    // On Windows an unclosed read handle prevents replacing/renaming this file.
    renameSync(libraryPath(), join(root, 'unreadable.json'));
    expect(readdirSync(root)).toEqual(['unreadable.json']);
  });

  it('holds one verified file descriptor instead of reopening a path after lstat', () => {
    // The race is a pathname swap between the first check and the read.
    // Keep this structural guard: replacing a path-based read with a second
    // open revives the race even though ordinary valid-file tests pass.
    const source = readFileSync(new URL('./run-library.mjs', import.meta.url), 'utf8');
    expect(source).toContain('openSync(path, flags)');
    expect(source).toContain('fstatSync(fd)');
    expect(source).toContain('lstatSync(path)');
    expect(source).toContain('constants.O_NOFOLLOW');
    expect(source).toContain("readFileSync(fd, 'utf8')");
    expect(source).not.toContain("readFileSync(path, 'utf8')");
    expect(source).toContain('closeSync(fd)');
  });

  it('does not accept a directory at the Library pathname', () => {
    const path = libraryPath();
    // This tests the existing nonregular-file refusal on the same new code path.
    const parent = mkdtempSync(join(root, 'directory-'));
    renameSync(parent, path);
    expect(lstatSync(path).isDirectory()).toBe(true);
    expect(() => readRunLibrary(root)).toThrow('library is not a regular file');
  });
});
