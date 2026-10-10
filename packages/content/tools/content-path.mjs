import { realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

/**
 * THE ONE GUARD ON THE ONE WRITABLE DIRECTORY.
 *
 * The editor writes YAML back to disk over two transports — a Vite middleware
 * in dev, IPC to the Electron main process in the shell — and each transport
 * has a read half and a write half. That made four copies of this check, and
 * four copies is three too many: they had already drifted. Two were written
 *
 *     target !== CONTENT && !target.startsWith(CONTENT + '/')
 *
 * and one was written
 *
 *     !target.startsWith(CONTENT)
 *
 * which is the same check with the separator dropped, and it lets a sibling
 * directory through: `../content-x/a.yaml` resolves to `packages/content-x/`,
 * which starts with `.../packages/content` and passes. It was the WRITE half
 * that had the weak one. Separately, the shell refused anything that was not
 * `.yaml` and the dev server did not, so the two transports disagreed about
 * what a content file even is.
 *
 * This is that check, once. It is written with `relative` rather than a string
 * prefix on purpose: prefix comparison needs a trailing separator to be correct
 * and needs the RIGHT separator to be correct on Windows, and both of those are
 * easy to leave out — as three of the four copies demonstrated. `relative`
 * answers the actual question, which is whether the path is reachable from the
 * root by going downward only.
 */

/** Thrown for any path that is not a content file. Callers turn it into their transport's error. */
export class ContentPathError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ContentPathError';
  }
}

/**
 * Resolve an editor-relative path against the content root, or throw.
 *
 * @param {string} root  absolute path of `packages/content`
 * @param {unknown} path the untrusted path, as the transport received it
 * @returns {string} the absolute path, guaranteed inside `root` and ending `.yaml`
 */
export function resolveContentPath(root, path) {
  if (typeof path !== 'string' || path === '') {
    throw new ContentPathError('a content path is required');
  }

  const target = resolve(root, path);
  const rel = relative(root, target);

  // '' is the root directory itself; '..' anywhere at the front is upward;
  // an absolute result means `path` was absolute and landed off the root
  // entirely. Everything else is a descendant, which is the whole rule.
  if (rel === '' || rel === '..' || rel.startsWith(`..${'/'}`) || rel.startsWith('..\\') || isAbsolute(rel)) {
    throw new ContentPathError('path escapes content root');
  }

  if (!target.endsWith('.yaml')) {
    throw new ContentPathError('content is YAML');
  }

  return target;
}

/**
 * A content bridge must READ and WRITE only an existing YAML file inside its
 * own physical root. The lexical guard alone is insufficient: readFileSync
 * and writeFileSync follow symlinks in both the last path component and any
 * ancestor directory. Resolve the physical target once and return that path
 * to both transport callers, rather than returning to the symlink after the
 * check. We do not create new files through either editor transport.
 */
export function resolveExistingContentPath(root, path) {
  const lexical = resolveContentPath(root, path);
  let physicalRoot;
  let physicalTarget;
  try {
    physicalRoot = realpathSync(root);
    physicalTarget = realpathSync(lexical);
    if (!statSync(physicalTarget).isFile()) {
      throw new ContentPathError('content is not a regular file');
    }
  } catch (error) {
    if (error instanceof ContentPathError) throw error;
    throw new ContentPathError('content file is unavailable');
  }

  const rel = relative(physicalRoot, physicalTarget);
  if (rel === '' || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) {
    throw new ContentPathError('path escapes content root through a link');
  }
  // A link to another file type inside the root must not bypass the YAML
  // restriction merely because its link name ends in .yaml.
  if (!physicalTarget.endsWith('.yaml')) {
    throw new ContentPathError('content is YAML');
  }

  return physicalTarget;
}
