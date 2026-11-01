import { closeSync, constants, fstatSync, lstatSync, openSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { resolveExistingContentPath } from '../../content/tools/content-path.mjs';

export function userContentRoot(userData) {
  return join(userData, 'mods', 'content');
}

// The walker checks descendants with lstat, but readdirSync follows directory
// symlinks before seeing any child. Check the profile, mods, and content
// directories themselves before descending; never manufacture a missing root.
function hasRegularContentRoot(root) {
  for (const dir of [dirname(dirname(root)), dirname(root), root]) {
    let stat;
    try {
      stat = lstatSync(dir);
    } catch (error) {
      if (error?.code === 'ENOENT') return false;
      throw error;
    }
    if (!stat.isDirectory()) {
      throw new TypeError('user content root is not a regular directory');
    }
  }
  return true;
}

// The Mod Editor may read AND overwrite existing YAML. Unlike the game's
// read-only mod scan, a missing root must be an error. Crucially, check each
// lexical ancestor with lstat BEFORE the shared resolver calls realpathSync:
// resolving a linked mods/content root first would bless the external target.
export function resolveModEditorContentPath(root, path) {
  if (!hasRegularContentRoot(root)) {
    throw new TypeError('user content root is not a regular directory');
  }
  return resolveExistingContentPath(root, path);
}

/**
 * Scan exactly the YAML file lstat inspected, not a new target reopened by
 * pathname after another editor has replaced it. The descriptor protects the
 * read even if the filename changes again later.
 */
function readVerifiedYaml(path, before) {
  const flags = constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW);
  const fd = openSync(path, flags);
  try {
    const opened = fstatSync(fd);
    const after = lstatSync(path);
    if (!opened.isFile() || !after.isFile()
      || opened.dev !== before.dev || opened.ino !== before.ino
      || after.dev !== opened.dev || after.ino !== opened.ino) {
      throw new TypeError('user content changed while being read');
    }
    return readFileSync(fd, 'utf8');
  } finally {
    closeSync(fd);
  }
}

export function readUserContent(root) {
  const out = {};
  if (!hasRegularContentRoot(root)) return out;
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir).sort();
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      const path = join(dir, entry);
      // The Mod Editor (or another editor) may replace/remove an entry after
      // readdirSync returned its name. Losing one file must not discard every
      // healthy mod in the scan. Only ENOENT means this entry vanished; other
      // filesystem failures remain errors instead of silent omissions.
      let stat;
      try {
        stat = lstatSync(path);
      } catch (error) {
        if (error?.code === 'ENOENT') continue;
        throw error;
      }
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        walk(path);
        continue;
      }
      if (!stat.isFile() || !entry.endsWith('.yaml')) continue;
      try {
        out[relative(root, path).split(sep).join('/')] = readVerifiedYaml(path, stat);
      } catch (error) {
        if (error?.code === 'ENOENT') continue;
        throw error;
      }
    }
  };
  walk(root);
  return out;
}
