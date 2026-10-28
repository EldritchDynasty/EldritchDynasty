/**
 * The architecture table is the path → evidence map. Keep parsing here pure:
 * verification and task briefs can consume the same result without git, I/O,
 * credentials, or another maintained path map.
 */
import { posix } from 'node:path';

const ticks = (cell) => [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
const pathLike = (ref) => /\.(?:ts|mjs|cjs|vue|yaml|json|md)$|\/$/.test(ref);
const normalize = (ref) => ref.replaceAll('\\', '/').replace(/^\.\//, '');

/** Resolve shorthand against the tracked inventory, refusing ambiguity. */
export function resolveMapPath(ref, files, directories = []) {
  ref = normalize(ref);
  if (posix.isAbsolute(ref) || ref.split('/').includes('..')) return undefined;
  const directory = ref.endsWith('/');
  const matches = (candidate) => directory
    ? files.some((file) => file.startsWith(candidate))
    : files.includes(candidate);
  for (const candidate of [ref, `packages/${ref}`]) {
    if (matches(candidate)) return candidate;
  }
  const nearby = [...new Set(directories.map((dir) => posix.join(dir, ref) + (directory ? '/' : '')))]
    .filter(matches);
  if (nearby.length === 1) return nearby[0];
  if (nearby.length > 1) return undefined;
  // A source under core/src/events is usually guarded in core/src, rather
  // than by a same-named schema suite. Walk within its package before using
  // a repository-wide suffix, and still refuse tied candidates.
  let parents = directories;
  while (parents.some((dir) => dir.split('/').length > 2)) {
    parents = [...new Set(parents.filter((dir) => dir.split('/').length > 2).map(posix.dirname))];
    const found = [...new Set(parents.map((dir) => posix.join(dir, ref) + (directory ? '/' : '')))].filter(matches);
    if (found.length === 1) return found[0];
    if (found.length > 1) return undefined;
  }
  const suffixes = directory
    ? [...new Set(files.flatMap((file) => {
      const at = file.indexOf(`/${ref}`);
      return at < 0 ? [] : [file.slice(0, at + 1) + ref];
    }))]
    : files.filter((file) => file.endsWith(`/${ref}`));
  return suffixes.length === 1 ? suffixes[0] : undefined;
}

/**
 * @returns {{source: string, files: string[], entries: object[], problems: object[]}}
 * `files` is supplied by the caller, so deleted/missing paths are observable
 * rather than silently accepted by a filesystem lookup in the parser.
 */
export function parseCodemap(markdown, { files = [], source = 'ARCHITECTURE.md' } = {}) {
  files = [...new Set(files.map(normalize))].sort();
  const entries = [];
  const problems = [];
  let inside = false;
  for (const [offset, line] of markdown.split(/\r?\n/).entries()) {
    if (/^## Where a thing lives\s*$/.test(line)) { inside = true; continue; }
    if (!inside) continue;
    if (/^(?:## |---\s*$)/.test(line)) break;
    if (!line.startsWith('|') || /If you are changing|^\|[-: ]+\|/.test(line)) continue;
    const cells = line.slice(1, -1).split('|').map((cell) => cell.trim());
    const [topic, goTo, guardedBy] = cells;
    if (cells.length !== 3 || !topic || goTo === undefined || guardedBy === undefined) {
      problems.push({ line: offset + 1, reason: 'malformed architecture table row' });
      continue;
    }
    const paths = [];
    const suites = [];
    const commands = [];
    const locations = [];
    const resolve = (ref, into, directories) => {
      const path = resolveMapPath(ref, files, directories);
      if (path) into.push(path);
      else problems.push({ line: offset + 1, ref, reason: 'missing or ambiguous map path' });
      return path;
    };
    for (const ref of ticks(goTo).filter(pathLike)) {
      const path = resolve(ref, paths, locations);
      if (path) locations.push(path.endsWith('/') ? path.slice(0, -1) : posix.dirname(path));
    }
    for (const ref of ticks(guardedBy)) {
      if (/\.test\.ts$/.test(ref)) resolve(ref, suites, locations);
      else if (/^(?:npm run |gate:)/.test(ref)) commands.push(ref);
      else if (pathLike(ref)) resolve(ref, [], locations);
    }
    entries.push({ topic, paths, suites, commands, guardedBy, line: offset + 1 });
  }
  if (!inside || !entries.length) problems.push({ reason: 'architecture map is missing or empty' });
  return { source, files, entries, problems };
}

export function routesForPaths(map, paths) {
  return map.entries.filter((entry) => entry.paths.some((mapped) => paths.some((path) =>
    mapped.endsWith('/') ? normalize(path).startsWith(mapped) : normalize(path) === mapped)));
}

/** Preserve the canonical reading routes verbatim; never copy their sections. */
export function parseTaskRoutes(markdown, { source = 'AGENTS.md' } = {}) {
  const entries = [];
  const problems = [];
  let inside = false;
  for (const [offset, line] of markdown.split(/\r?\n/).entries()) {
    if (/^## Task routes\s*$/.test(line)) { inside = true; continue; }
    if (!inside) continue;
    if (/^## /.test(line)) break;
    if (!line.startsWith('|') || /^\|\s*(?:Task\s*\||[-:])/i.test(line)) continue;
    const cells = line.slice(1, -1).split('|').map((cell) => cell.trim());
    if (!line.endsWith('|') || cells.length !== 2 || !cells[0] || !cells[1]) {
      problems.push({ line: offset + 1, reason: 'Malformed task reading-route row' });
      continue;
    }
    const [task, reading] = cells;
    const links = [...reading.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)]
      .map((m) => ({ label: m[1], path: m[2] }));
    entries.push({ task, reading, links, source, line: offset + 1,
      guides: links.map((link) => link.path.split('#')[0]).filter((path) => /^packages\/[^/]+\/AGENTS\.md$/.test(path)) });
  }
  if (!entries.length) problems.push({ reason: 'Task routes are missing or empty' });
  return { source, entries, problems };
}
