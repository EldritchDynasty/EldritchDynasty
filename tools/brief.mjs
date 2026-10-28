#!/usr/bin/env node
/** A read-only issue starting brief. No fetch, claim, checkout, check or write. */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, posix, resolve, win32 } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readCachedClaims, overlaps } from './agents.mjs';
import { parseCodemap, parseTaskRoutes } from './codemap.mjs';
import { planFor } from './verify-plan.mjs';
import { repoRelative } from './portable.mjs';

const REFRESH = 'Refresh with npm run agents; run npm run agents -- check before the long run.';
const norm = (path) => path.replaceAll('\\', '/').replace(/^\.\//, '');
const unique = (items) => [...new Set(items)];
const gap = (kind, message, extra = {}) => ({ kind, message, ...extra });
const validDate = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));

export function normalizeIssue(raw, expectedNumber) {
  const issue = raw?.structuredContent?.issue ?? raw?.issue ?? raw;
  if (!issue || typeof issue !== 'object' || Array.isArray(issue)) throw new Error('Issue JSON must contain an issue object.');
  const number = issue.number ?? issue.issue_number;
  if (!Number.isSafeInteger(number) || number < 1) throw new Error('Issue JSON needs a positive integer number (or issue_number).');
  if (expectedNumber !== undefined && number !== expectedNumber) throw new Error(`Issue file is #${number}, but --issue requested #${expectedNumber}.`);
  if (typeof issue.title !== 'string' || !issue.title.trim()) throw new Error(`Issue #${number} needs a nonempty title.`);
  const gaps = [];
  if (typeof issue.body !== 'string') gaps.push(gap('issue-body', 'The tracker snapshot has no issue body.'));
  const state = ['open', 'closed'].includes(issue.state) ? issue.state : null;
  if (!state) gaps.push(gap('issue-state', 'Issue state is unavailable in the snapshot.'));
  let labels = null;
  if (Array.isArray(issue.labels)) {
    labels = issue.labels.map((label) => typeof label === 'string' ? label : label?.name);
    if (labels.some((label) => typeof label !== 'string')) {
      labels = labels.filter((label) => typeof label === 'string');
      gaps.push(gap('issue-labels', 'Some snapshot labels have no name.'));
    }
  } else gaps.push(gap('issue-labels', 'Issue labels were not supplied; unknown is not an empty list.'));
  const url = issue.html_url ?? issue.url;
  const fetchedAt = raw.fetchedAt ?? raw.fetched_at ?? raw.source?.fetchedAt;
  return { issue: { number, title: issue.title, body: typeof issue.body === 'string' ? issue.body : '', state, labels,
    url: typeof url === 'string' && /^https?:\/\//.test(url) ? url : null },
    fetchedAt: validDate(fetchedAt) ? fetchedAt : null, gaps };
}

/** Keep the heading and section text, including whitespace, exactly as authored. */
export function acceptanceOf(body) {
  const headings = [...body.matchAll(/^(#{1,6})[ \t]+(.+)\r?$/gm)];
  let start = headings.findIndex((match) => /^acceptance\b/i.test(match[2]));
  if (start < 0) start = headings.findIndex((match) => /\bacceptance\b/i.test(match[2]));
  if (start < 0) return null;
  const heading = headings[start];
  const end = headings.slice(start + 1).find((match) => match[1].length <= heading[1].length)?.index ?? body.length;
  return { line: body.slice(0, heading.index).split('\n').length, text: body.slice(heading.index, end) };
}

function globRegex(pattern) {
  let source = '';
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] === '*') {
      if (pattern[i + 1] === '*') {
        i++;
        if (pattern[i + 1] === '/') { i++; source += '(?:.*/)?'; }
        else source += '.*';
      } else source += '[^/]*';
    } else if (pattern[i] === '?') source += '[^/]';
    else source += pattern[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${source}$`);
}

export function resolveIssuePath(raw, files) {
  const ref = norm(raw);
  if (posix.isAbsolute(ref) || win32.isAbsolute(ref) || ref.split('/').includes('..')) {
    return { status: 'unsafe', paths: [], candidates: [], files: [] };
  }
  if (/[*?]/.test(ref)) {
    const pattern = globRegex(ref);
    const matches = files.filter((file) => pattern.test(file));
    return { status: matches.length ? 'resolved' : 'missing', glob: true, paths: matches, candidates: matches, files: matches };
  }
  const directory = ref.endsWith('/') || files.some((file) => file.startsWith(`${ref}/`));
  const target = directory ? `${ref.replace(/\/$/, '')}/` : ref;
  const inventory = directory ? unique(files.flatMap((file) => {
    const parts = file.split('/');
    return parts.slice(0, -1).map((_, index) => `${parts.slice(0, index + 1).join('/')}/`);
  })) : files;
  // A repo-relative spelling is exact. A shorthand suffix must be unique.
  const candidates = inventory.includes(target) ? [target]
    : inventory.filter((file) => file.endsWith(`/${target}`));
  const paths = candidates.length === 1 ? candidates : [];
  return { status: paths.length ? 'resolved' : candidates.length ? 'ambiguous' : 'missing',
    paths, candidates, files: directory ? files.filter((file) => paths.some((path) => file.startsWith(path))) : paths };
}

export function referencedPaths(body, inventory) {
  const result = [];
  const extension = /\.(?:[cm]?[jt]sx?|vue|ya?ml|json|md|toml|txt)(?::\d+(?:[-–]\d+)?)?$/i;
  for (const [offset, sourceText] of body.split(/\r?\n/).entries()) {
    const code = [...sourceText.matchAll(/`([^`\n]+)`/g)].map((match) => match[1]);
    const prose = sourceText.replace(/https?:\/\/\S+/g, '').replace(/`[^`]*`/g, '')
      .match(/(?:[\w.*?/-]+\.(?:[cm]?[jt]sx?|vue|ya?ml|json|md|toml|txt))(?::\d+(?:[-–]\d+)?)?/gi) ?? [];
    for (const token of unique([...code, ...prose])) {
      if (/^(?:npm|npx|node|git)\s/.test(token)) continue;
      if (!extension.test(token) && !token.endsWith('/') && !/^(?:packages|tools|docs)\/[\w./*-]+$/.test(token)) continue;
      const citation = /^(.*?):(\d+)(?:[-–](\d+))?$/.exec(token);
      const path = citation?.[1] ?? token;
      const range = citation ? { start: Number(citation[2]), end: Number(citation[3] ?? citation[2]) } : null;
      result.push({ ref: token, path: norm(path), issueLine: offset + 1, sourceText, range,
        ...resolveIssuePath(path, inventory) });
    }
  }
  return result;
}

/** References stay unresolved remotely; classification records the literal clause. */
export function referencedIssues(body, issueUrl) {
  const base = /^(https?:\/\/[^/]+\/[^/]+\/[^/]+)\/(?:issues|pull)\//.exec(issueUrl ?? '')?.[1];
  const result = [];
  for (const [offset, line] of body.split(/\r?\n/).entries()) {
    for (const match of line.matchAll(/#(\d+)\b/g)) {
      const number = Number(match[1]);
      const before = line.slice(0, match.index);
      const clause = before.split(/[.;!?](?=\s|$)|\s+[—–]\s+/).at(-1);
      const blocker = /\b(?:after|depends? on|blocked by|needs?|requires?)\b/i.test(clause)
        || /\b(?:correct|fix)\s*$/i.test(before) && /\bbefore\b/i.test(line.slice(match.index));
      const linkedUrl = /^#\d+\]\((https?:\/\/[^)]+)\)/.exec(line.slice(match.index))?.[1];
      const kind = /\b(?:PR|pull request)\s*\[?$/i.test(before) || /\/pull\/$/.test(before) || /\/pull\/\d+/.test(linkedUrl ?? '') ? 'pr' : 'issue';
      result.push({ number, kind, relation: blocker ? 'declared-blocker' : 'mentioned',
        issueLine: offset + 1, sourceText: line, state: 'unverified',
        url: linkedUrl ?? (base ? `${base}/${kind === 'pr' ? 'pull' : 'issues'}/${number}` : null) });
    }
    for (const match of line.matchAll(/https?:\/\/[^\s)]+?\/(issues|pull)\/(\d+)\b/g)) {
      const number = Number(match[2]);
      const kind = match[1] === 'pull' ? 'pr' : 'issue';
      if (result.some((ref) => ref.issueLine === offset + 1 && ref.number === number && ref.kind === kind)) continue;
      const before = line.slice(0, match.index).split(/[.;!?](?=\s|$)/).at(-1);
      result.push({ number, kind, relation: /\b(?:after|depends? on|blocked by|needs?|requires?)\b/i.test(before) ? 'declared-blocker' : 'mentioned',
        issueLine: offset + 1, sourceText: line, state: 'unverified', url: match[0] });
    }
  }
  return result;
}

const toolingPath = (path) => /^(?:tools\/|docs\/|\.claude\/|\.codex\/|\.github\/|package(?:-lock)?\.json$|vitest\.|packages\/core\/src\/(?:tools\/|codemap\.test\.ts$))/.test(path);

/** All facts are inputs; the same object drives Markdown and JSON. */
export function buildBrief({ snapshot, issueNumber, source, headSha, files, map, routes,
  claims = [], claimsError = null, evidence = {}, sourceContents = {}, agentText = '', now }) {
  const normalized = normalizeIssue(snapshot, issueNumber);
  const issue = normalized.issue;
  const gaps = [...normalized.gaps];
  if (!normalized.fetchedAt) gaps.push(gap('snapshot-time', 'Snapshot fetch time is unknown; loadedAt is not a fetch time.'));
  if (!headSha) gaps.push(gap('revision', 'Repository HEAD could not be resolved.'));
  const acceptance = acceptanceOf(issue.body);
  if (!acceptance) gaps.push(gap('acceptance', 'No explicit Acceptance section was found; no criteria were inferred.'));
  const paths = referencedPaths(issue.body, files);
  if (!paths.length) gaps.push(gap('paths', 'The issue names no recognizable paths; ownership and verification need review.'));
  for (const path of paths) {
    if (path.status !== 'resolved') gaps.push(gap(`path-${path.status}`, `${path.ref}: ${path.status}.`, { issueLine: path.issueLine, candidates: path.candidates }));
    if (!path.range || path.status !== 'resolved' || path.paths.length !== 1) continue;
    const contents = sourceContents[path.paths[0]];
    if (contents === undefined) {
      gaps.push(gap('citation-unchecked', `${path.ref}: source text is unavailable.`, { issueLine: path.issueLine }));
      continue;
    }
    const lines = contents.split(/\r?\n/);
    if (path.range.start < 1 || path.range.end < path.range.start || path.range.end > lines.length) {
      gaps.push(gap('citation-range', `${path.ref}: cited range is outside the current ${lines.length}-line file.`, { issueLine: path.issueLine }));
      continue;
    }
    const symbols = [...path.sourceText.matchAll(/\bfunction\s+`([a-z_$][\w$]*)(?:\(\))?`/gi)].map((match) => match[1]);
    const beforePath = path.sourceText.slice(0, path.sourceText.indexOf(path.ref)).replace(/`$/, '');
    const adjacent = /`([a-z_$][\w$]*)`\s*\(?\s*$/i.exec(beforePath)?.[1];
    if (adjacent && new RegExp(`\\bfunction\\s+${adjacent.replaceAll('$', '\\$')}\\b`).test(contents)) symbols.push(adjacent);
    const cited = lines.slice(path.range.start - 1, path.range.end).join('\n');
    for (const symbol of unique(symbols)) {
      if (!new RegExp(`\\b${symbol.replaceAll('$', '\\$')}\\b`).test(cited)) gaps.push(gap('citation-symbol',
        `${path.ref}: referenced symbol ${symbol} is not in the cited lines; confirm this citation against the current file.`, { issueLine: path.issueLine }));
    }
  }
  const resolved = unique(paths.flatMap((path) => path.files));
  const proposed = paths.filter((path) => path.status === 'missing' && path.path.includes('/') && !/[*?]/.test(path.path)).map((path) => path.path);
  const possible = paths.filter((path) => path.status === 'ambiguous').flatMap((path) => path.candidates);
  for (const path of paths.filter((item) => item.status === 'ambiguous' || item.status === 'missing' && !item.path.includes('/'))) {
    gaps.push(gap('ownership', `${path.ref}: ownership is uncertain; resolve the shorthand before selecting a package.`, { issueLine: path.issueLine }));
  }
  const ownershipPaths = unique([...resolved, ...proposed, ...possible]);
  const guides = [];
  for (const path of ownershipPaths) {
    const pkg = /^packages\/([^/]+)\//.exec(path)?.[1];
    const guide = pkg ? `packages/${pkg}/AGENTS.md` : 'AGENTS.md';
    const certainty = possible.includes(path) ? 'possible' : proposed.includes(path) ? 'proposed-path' : 'resolved-path';
    if (!files.includes(guide)) {
      gaps.push(gap('ownership', `No tracked guide identifies the owner of ${path}.`));
      continue;
    }
    let entry = guides.find((item) => item.path === guide && item.certainty === certainty);
    if (!entry) { entry = { path: guide, certainty, paths: [] }; guides.push(entry); }
    entry.paths.push(path);
  }
  const taskRoutes = routes.entries.filter((route) => ownershipPaths.some((path) => toolingPath(path)
    ? route.links.some((link) => link.path.split('#')[0] === 'docs/COMMANDS.md')
    : route.guides.some((guide) => path.startsWith(`${posix.dirname(guide)}/`))));
  if (!taskRoutes.length) gaps.push(gap('task-route', 'No task reading route is established by these paths.'));
  const authorities = taskRoutes.some((route) => /\bconcept\b|\bworld\b/i.test(route.reading))
    ? [...agentText.matchAll(/\[([^\]]+)\]\(((?:DesignConcepts|Background)\/[^)]+)\)/g)].map((m) => ({ label: m[1], path: m[2] })) : [];
  for (const problem of [...map.problems, ...routes.problems]) gaps.push(gap('routing-source', problem.reason, { source: problem.ref ?? null, line: problem.line ?? null }));
  if (claimsError) gaps.push(gap('claims', claimsError));
  const activeClaims = claims.filter((claim) => !claim.released && !claim.malformed)
    .map((claim) => ({ ...claim, overlappingPaths: ownershipPaths.filter((path) => claim.paths.some((held) => overlaps(held, path))) }))
    .filter((claim) => claim.overlappingPaths.length);
  for (const claim of claims.filter((item) => item.malformed)) gaps.push(gap('malformed-claim', `Malformed cached claim/${claim.slug}; refresh and inspect it.`));
  const uncertainPaths = paths.some((path) => path.status !== 'resolved') || !paths.length;
  const verification = planFor({ files: unique([...resolved, ...proposed]), baseSha: headSha, headSha, evidence,
    map: uncertainPaths ? { ...map, problems: [...map.problems, { reason: 'Issue paths are unresolved' }] } : map });
  verification.notes.push('Planning referenced/proposed issue paths at HEAD, not a diff or an authorization to edit them.');
  return { version: 1, issue, source: { kind: 'file', label: source, fetchedAt: normalized.fetchedAt,
    loadedAt: new Date(now).toISOString(), stale: true }, repository: { headSha, sources: 'tracked working-tree files; HEAD identifies the commit only' }, acceptance, paths,
    references: referencedIssues(issue.body, issue.url), guides, taskRoutes, authorities,
    claims: { source: 'cached refs/remotes/origin/claim/*', stale: true, refresh: REFRESH, active: activeClaims },
    verification, gaps, freshness: ['Tracker snapshot and referenced issue/PR states were not refreshed.', REFRESH] };
}

/** Gather local facts only, with no optional git writes or lazy network fetch. */
export async function gatherBrief({ cwd = process.cwd(), issueNumber, issueFile, now = Date.now() }) {
  if (!issueFile) throw new Error('Supply --issue-file <json> saved from the GitHub connector; live issue fetching is not performed.');
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_NO_LAZY_FETCH: '1' } }).trimEnd();
  const root = git('rev-parse', '--show-toplevel');
  const attempt = (fn, fallback) => { try { return fn(); } catch { return fallback; } };
  const read = (path) => readFileSync(join(root, path), 'utf8');
  const absoluteFile = resolve(cwd, issueFile);
  let snapshot;
  try { snapshot = JSON.parse(readFileSync(absoluteFile, 'utf8')); }
  catch (error) { throw new Error(`Cannot read issue JSON ${issueFile}: ${error.message}`); }
  const files = git('ls-files', '-z').split('\0').filter(Boolean);
  const headSha = attempt(() => git('rev-parse', '--verify', 'HEAD^{commit}'), null);
  const agentText = attempt(() => read('AGENTS.md'), '');
  const map = parseCodemap(attempt(() => read('ARCHITECTURE.md'), ''), { files });
  const routes = parseTaskRoutes(agentText);
  let evidence = attempt(() => JSON.parse(read('tools/ci-evidence.json')), {});
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) evidence = {};
  for (const key of ['jobs', 'slowSuites', 'gates', 'telemetryGates']) {
    if (evidence[key] !== undefined && !Array.isArray(evidence[key])) evidence[key] = [];
  }
  evidence.baseState = 'absent';
  // Reuse the workflow reader too; importing it only gathers local CLI state.
  const { ciScripts } = await import('./land.mjs');
  evidence.workflowScripts = [...ciScripts(attempt(() => read('.github/workflows/check.yml'), ''))].sort();
  let claims = [], claimsError = null;
  try { claims = readCachedClaims({ cwd: root, now, strict: true }); }
  catch (error) { claimsError = error.message; }
  const issue = normalizeIssue(snapshot, issueNumber).issue;
  const sourceContents = {};
  for (const path of referencedPaths(issue.body, files).filter((entry) => entry.range && entry.paths.length === 1)) {
    const text = attempt(() => read(path.paths[0]), undefined);
    if (text !== undefined) sourceContents[path.paths[0]] = text;
  }
  const relativeFile = repoRelative(absoluteFile, root);
  return buildBrief({ snapshot, issueNumber, source: `file:${relativeFile ?? absoluteFile}`,
    headSha, files, map, routes, claims, claimsError, evidence, sourceContents, agentText, now });
}

const code = (text) => `\`${String(text).replaceAll('`', "'").replaceAll('\n', ' ↵ ')}\``;
const oneLine = (text) => String(text).replace(/\r?\n/g, ' ');

export function formatBrief(brief, { maxLines = 150 } = {}) {
  const lines = [`# #${brief.issue.number} ${oneLine(brief.issue.title)}`,
    `Source: ${code(brief.source.label)}; fetched: ${brief.source.fetchedAt ?? 'unknown'}; loaded: ${brief.source.loadedAt} (stale snapshot).`,
    `HEAD: ${brief.repository.headSha ?? 'unresolved'}; issue state: ${brief.issue.state ?? 'unknown'}; labels: ${brief.issue.labels?.join(', ') || (brief.issue.labels ? '(none)' : 'unknown')}.`,
    'Routes and citations read tracked working-tree files; HEAD is not a snapshot of local edits.',
    ...(brief.issue.url ? [`Issue: ${brief.issue.url}`] : []), '',
    'Tracker/dependency state is unverified; cached claims may omit remote work.', brief.claims.refresh, '',
    ...(brief.acceptance ? brief.acceptance.text.split('\n') : ['## Acceptance', 'Not supplied; see gaps.'])];
  const sections = [
    ['Gaps to resolve', brief.gaps.map((item) => `${item.kind}: ${item.message}${item.issueLine ? ` (issue line ${item.issueLine})` : ''}`)],
    ['Referenced paths', brief.paths.map((path) => `${code(path.ref)} — ${path.status}; issue line ${path.issueLine}`
      + (path.candidates.length ? `: ${path.candidates.map(code).join(', ')}` : ''))],
    ['Issue / PR references (remote states unverified)', brief.references.map((ref) => `${ref.kind} #${ref.number}: ${ref.relation}; issue line ${ref.issueLine}${ref.url ? ` — ${ref.url}` : ''}`)],
    ['Owning guides', brief.guides.map((guide) => `${code(guide.path)} (${guide.certainty})`)],
    ['Task reading routes', [...brief.taskRoutes.map((route) => `${route.task}: ${route.reading} (${route.source}:${route.line})`),
      ...brief.authorities.map((authority) => `[${authority.label}](${authority.path})`)]],
    ['Overlapping cached claims (stale)', brief.claims.active.map((claim) => `claim/${claim.slug}: ${claim.agent}; ${claim.lane}; age ${claim.ageHours?.toFixed(2) ?? 'unknown'}h; ${claim.overlappingPaths.map(code).join(', ')}`)],
    ['Verification scope (referenced paths, not a diff)', [
      `${brief.verification.scope}${brief.verification.uncertain ? ' (uncertain)' : ''}; source: tools/verify-plan.mjs#planFor.`]],
    ['Recommended local checks', brief.verification.recommendedLocal.map((item) => `${item.command} [${item.currentTier ?? 'advisory'}] — ${item.reasons.map((reason) => `${reason.reason} (${reason.source})`).join('; ')}`)],
    ['Required integration CI', brief.verification.requiredIntegration.map((job) => `${job.id} [${job.currentTier}] (${job.source})`)],
    ['Scheduled evidence', brief.verification.scheduledEvidence.map((item) => `${item.command} [${item.currentTier}]`)],
  ];
  const reserve = sections.length * 3 + 3;
  if (lines.length + reserve > maxLines) throw new Error('Verbatim acceptance text exceeds the Markdown brief budget; use --json for the complete brief.');
  let remaining = maxLines - lines.length - reserve;
  let abbreviated = false;
  for (const [title, entries] of sections) {
    lines.push('', `## ${title}`);
    const allowance = Math.min(entries.length, 10, remaining);
    for (const entry of entries.slice(0, allowance)) {
      const text = oneLine(entry);
      abbreviated ||= text.length > 500;
      lines.push(`- ${text.length > 500 ? `${text.slice(0, 460)} … [full entry: --json]` : text}`);
    }
    remaining -= allowance;
    if (!entries.length) lines.push('- None identified.');
    else if (entries.length > allowance) {
      lines.push(`- ${entries.length - allowance} further entries; use --json for all facts.`);
      abbreviated = true;
    }
  }
  lines.push('', abbreviated ? 'Bounded Markdown view; --json retains all entries and exact source lines.' : 'Markdown and JSON are views of the same brief object.');
  return lines.join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  const usage = 'usage: npm run brief -- --issue N --issue-file <json> [--json]';
  if (args.includes('--help')) { console.log(usage); return; }
  let issueNumber, issueFile, json = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--json') json = true;
    else if (['--issue', '--issue-file'].includes(args[i]) && args[i + 1] && !args[i + 1].startsWith('--')) {
      if (args[i] === '--issue') issueNumber = Number(args[++i]);
      else issueFile = args[++i];
    } else throw new Error(usage);
  }
  if (!Number.isSafeInteger(issueNumber) || issueNumber < 1) throw new Error(usage);
  const brief = await gatherBrief({ issueNumber, issueFile });
  console.log(json ? JSON.stringify(brief, null, 2) : formatBrief(brief));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { await main(); } catch (error) { console.error(`brief: ${error.message}`); process.exitCode = 2; }
}
