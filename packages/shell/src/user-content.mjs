import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

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
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        walk(path);
        continue;
      }
      if (!stat.isFile() || !entry.endsWith('.yaml')) continue;
      out[relative(root, path).split(sep).join('/')] = readFileSync(path, 'utf8');
    }
  };
  walk(root);
  return out;
}
