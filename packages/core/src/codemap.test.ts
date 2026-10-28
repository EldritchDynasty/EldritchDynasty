import { afterAll, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { SAVE_FORMAT } from '@ed/schema';

const REPO = join(import.meta.dirname, '../../..');

{
  interface BriefPath {
    ref: string; status: string; paths: string[]; candidates: string[]; issueLine: number;
    sourceText: string; range: { start: number; end: number } | null;
  }
  interface Brief {
    issue: { number: number; title: string; body: string; state: string | null; labels: string[] | null };
    source: { label: string; fetchedAt: string | null; loadedAt: string; stale: boolean };
    repository: { headSha: string | null };
    acceptance: { line: number; text: string } | null;
    paths: BriefPath[];
    guides: { path: string; certainty: string }[];
    taskRoutes: { task: string; reading: string }[];
    authorities: { path: string }[];
    references: { number: number; kind: string; relation: string; state: string }[];
    claims: { stale: boolean; refresh: string; active: { slug: string; ageHours: number; overlappingPaths: string[] }[] };
    gaps: { kind: string; message: string }[];
    verification: { scope: string; uncertain: boolean; recommendedLocal: { command: string }[]; scheduledEvidence: { command: string }[] };
  }
  const tool = await import(pathToFileURL(join(REPO, 'tools/brief.mjs')).href) as {
    normalizeIssue: (raw: unknown, expected?: number) => { issue: Brief['issue']; gaps: Brief['gaps'] };
    acceptanceOf: (body: string) => Brief['acceptance'];
    referencedPaths: (body: string, files: string[]) => BriefPath[];
    resolveIssuePath: (ref: string, files: string[]) => { status: string; paths: string[]; candidates: string[] };
    referencedIssues: (body: string, url: string) => Brief['references'];
    buildBrief: (input: object) => Brief;
    gatherBrief: (input: { cwd: string; issueNumber: number; issueFile: string; now: number }) => Promise<Brief>;
    formatBrief: (brief: Brief) => string;
  };
  const claimTool = await import(pathToFileURL(join(REPO, 'tools/agents.mjs')).href) as {
    parseClaims: (text: string, options?: { now: number }) => {
      slug: string; paths: string[]; released: boolean; malformed: boolean; ageHours: number | null;
    }[];
    readCachedClaims: (options: { cwd: string; now: number; strict: boolean }) => object[];
  };
  const readingMap = await import(pathToFileURL(join(REPO, 'tools/codemap.mjs')).href) as {
    parseCodemap: (markdown: string, options: { files: string[] }) => object;
    parseTaskRoutes: (markdown: string) => { entries: { task: string; reading: string; line: number }[]; problems: object[] };
  };
  const NOW = Date.parse('2026-10-28T10:00:00Z');
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: REPO, encoding: 'utf8' }).split('\0').filter(Boolean);
  const agentText = readFileSync(join(REPO, 'AGENTS.md'), 'utf8');
  const routes = readingMap.parseTaskRoutes(agentText);
  const map = readingMap.parseCodemap(readFileSync(join(REPO, 'ARCHITECTURE.md'), 'utf8'), { files: tracked });
  const evidence = JSON.parse(readFileSync(join(REPO, 'tools/ci-evidence.json'), 'utf8'));
  const snapshot = (body: string) => ({ number: 7, title: 'Fixture issue', body, state: 'open', labels: [], url: 'https://github.com/example/repo/issues/7' });
  const make = (body: string, extra = {}) => tool.buildBrief({ snapshot: snapshot(body), source: 'file:fixture.json',
    headSha: 'revision-fixture', files: tracked, map, routes, evidence, agentText, now: NOW, ...extra });
  const temps: string[] = [];
  afterAll(() => { for (const path of temps) rmSync(path, { recursive: true, force: true }); });

  describe('read-only issue preparation', () => {
    it('preserves acceptance text exactly, including CRLF, nested headings and trailing whitespace', () => {
      const text = '## Expected behavior and acceptance\r\n\r\n- Keep this.  \r\n### Detail\r\nLiteral.\r\n\r\n';
      expect(tool.acceptanceOf('Before\r\n' + text + '## Next\r\nOther')).toEqual({ line: 2, text });
      expect(tool.acceptanceOf('No explicit criteria')).toBeNull();
    });

    it('resolves suffixes, en-dash ranges and globs and exposes every ambiguous or missing candidate', () => {
      const files = ['packages/core/src/save.ts', 'packages/schema/src/save.ts', 'packages/core/src/events/arcs.ts',
        'packages/core/AGENTS.md', 'packages/content/AGENTS.md'];
      const refs = tool.referencedPaths('Change `events/arcs.ts:12–17`, `save.ts`, `new-file.ts` and `packages/*/AGENTS.md`.', files);
      expect(refs).toHaveLength(4);
      expect(refs[0]).toMatchObject({ status: 'resolved', range: { start: 12, end: 17 }, issueLine: 1,
        paths: ['packages/core/src/events/arcs.ts'] });
      expect(refs[1]).toMatchObject({ status: 'ambiguous', paths: [], candidates: ['packages/core/src/save.ts', 'packages/schema/src/save.ts'] });
      expect(refs[2]).toMatchObject({ status: 'missing', paths: [], candidates: [] });
      expect(refs[3]).toMatchObject({ status: 'resolved', paths: ['packages/core/AGENTS.md', 'packages/content/AGENTS.md'] });
      expect(refs.every((ref) => ref.sourceText.startsWith('Change '))).toBe(true);
      expect(tool.resolveIssuePath('packages\\core\\src\\save.ts', files).paths).toEqual(['packages/core/src/save.ts']);
      expect(tool.resolveIssuePath('../save.ts', files).status).toBe('unsafe');
      expect(tool.resolveIssuePath('C:\\outside\\save.ts', files).status).toBe('unsafe');
    });

    it('does not turn a mentioned issue into a known remote state or a declared blocker', () => {
      const refs = tool.referencedIssues('Blocked by #11; mentions PR #12.\nDepends on [#13](https://github.com/example/repo/pull/13).\nSee https://github.com/example/repo/issues/14.', 'https://github.com/example/repo/issues/7');
      expect(refs.map((ref) => [ref.number, ref.kind, ref.relation])).toEqual([
        [11, 'issue', 'declared-blocker'], [12, 'pr', 'mentioned'], [13, 'pr', 'declared-blocker'], [14, 'issue', 'mentioned'],
      ]);
      expect(refs.every((ref) => ref.state === 'unverified')).toBe(true);
    });

    it('reuses the claim parser for canonical paths, legacy paths, release receipts and malformed refs', () => {
      const record = (slug: string, message: string) => `refs/remotes/origin/claim/${slug}\0sha-${slug}\0${message}\0${NOW / 1000 - 7200}\0\n`;
      const raw = record('11', 'claim 11\n\nagent: alpha\nlane: code\npath: packages/core/src/save.ts\npath: path with spaces\n')
        + record('12', 'claim 12\nagent: beta\npaths: tools/brief.mjs, docs/COMMANDS.md\n')
        + record('13', 'claim 13\nreleased: beta\n') + record('14', 'not a claim\nagent: rogue\n');
      const parsed = claimTool.parseClaims(raw, { now: NOW });
      expect(parsed[0]).toMatchObject({ slug: '11', paths: ['packages/core/src/save.ts', 'path with spaces'], ageHours: 2, malformed: false });
      expect(parsed[1]?.paths).toEqual(['tools/brief.mjs', 'docs/COMMANDS.md']);
      expect(parsed[2]?.released).toBe(true);
      expect(parsed[3]?.malformed).toBe(true);
      expect(claimTool.parseClaims(raw)[0]?.ageHours).toBeNull();
      expect(() => claimTool.parseClaims('incomplete\0record')).toThrow('Incomplete cached claim');
      const result = make('## Acceptance\nKeep it.\n## Paths\n`packages/core/src/save.ts`', { claims: parsed });
      expect(result.claims.active).toEqual([expect.objectContaining({ slug: '11', ageHours: 2 })]);
      expect(result.claims.stale).toBe(true);
      expect(result.claims.refresh).toContain('npm run agents -- check');
      expect(result.gaps.some((item) => item.kind === 'malformed-claim')).toBe(true);
    });

    it('reports obsolete citations, missing acceptance and uncertain ownership without guessing', () => {
      const body = 'The function `loadGame` is at `core/src/save.ts:2–3`.\nAlso inspect `save.ts:99999` and `new.ts`.';
      const result = make(body, { sourceContents: { 'packages/core/src/save.ts': 'one\ntwo\nthree\nfunction loadGame() {}\n' } });
      expect(result.acceptance).toBeNull();
      const empty = make('## Acceptance\n\n## Notes\nNo criteria supplied.');
      expect(empty.acceptance?.text).toBe('## Acceptance\n\n');
      expect(empty.gaps).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'acceptance', message: expect.stringContaining('no criteria text') })]));
      expect(result.gaps.map((item) => item.kind)).toEqual(expect.arrayContaining(['acceptance', 'citation-symbol', 'path-ambiguous', 'path-missing']));
      expect(result.verification.uncertain).toBe(true);
      expect(result.guides.some((guide) => guide.certainty === 'possible')).toBe(true);
      expect(make('`core/src/save.ts:99999`', { sourceContents: { 'packages/core/src/save.ts': 'one' } }).gaps)
        .toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'citation-range' })]));
      const content = make('`the_scene` (`events/papers.yaml:1`; `head`, `uncommon`, `weight`).', {
        sourceContents: { 'packages/content/events/papers.yaml': 'id: the_scene\ntier: head\nfrequency: uncommon\nweight: 1\n' },
      });
      expect(content.gaps.some((item) => item.kind === 'citation-symbol')).toBe(false);
    });

    it('takes task-specific reading verbatim from the root table and verification from planFor', () => {
      expect(routes.problems).toEqual([]);
      const result = make('## Acceptance\nKeep it.\n## Paths\n`tools/agents.mjs`');
      expect(result.taskRoutes.map((route) => route.reading)).toEqual([routes.entries.find((route) => /Tooling/.test(route.task))!.reading]);
      expect(result.authorities).toEqual([]);
      expect(result.verification.recommendedLocal).toEqual([expect.objectContaining({ command: 'npm run land -- --full-preflight' })]);
    });

    it('accepts connector wrappers and issue_number while rejecting malformed or mismatched snapshots', () => {
      const { number, ...rest } = snapshot('Body');
      expect(tool.normalizeIssue({ structuredContent: { issue: { ...rest, issue_number: number } } }, 7).issue.number).toBe(7);
      expect(() => tool.normalizeIssue(snapshot('Body'), 99)).toThrow('requested #99');
      expect(() => tool.normalizeIssue({ title: 'No number' })).toThrow('number');
      expect(() => tool.normalizeIssue({ number: 7, title: '' })).toThrow('title');
      const partial = tool.normalizeIssue({ number: 7, title: 'Partial', body: 123 });
      expect(partial.issue.body).toBe('');
      expect(partial.gaps.map((item) => item.kind)).toContain('issue-body');
      const dated = make('## Acceptance\nKeep it.', { snapshot: { ...snapshot('## Acceptance\nKeep it.'), fetchedAt: '2026-10-26T01:02:03Z' } });
      expect(dated.source.fetchedAt).toBe('2026-10-26T01:02:03Z');
      expect(dated.source.loadedAt).toBe(new Date(NOW).toISOString());
      expect(dated.source.stale).toBe(true);
    });

    it('bounds Markdown and explicitly defers oversized verbatim acceptance to JSON', () => {
      const result = make('## Acceptance\nKeep it.\n## Paths\n' + Array.from({ length: 300 }, (_, index) => `\`missing-${index}.ts\``).join('\n'));
      expect(tool.formatBrief(result).split('\n').length).toBeLessThanOrEqual(150);
      expect(tool.formatBrief(result)).toContain('further entries; use --json');
      expect(result.paths).toHaveLength(300);
      expect(() => tool.formatBrief(make('## Acceptance\n' + 'verbatim\n'.repeat(200)))).toThrow('use --json');
    });

    it.each([
      { name: 'content', number: 1946, guide: 'packages/content/AGENTS.md' },
      { name: 'save', number: 1932, guide: 'packages/core/AGENTS.md' },
      { name: 'tooling', number: 1936, guide: 'AGENTS.md' },
    ])('prepares the real $name issue through both output views', async ({ name, number, guide }) => {
      const result = await tool.gatherBrief({ cwd: REPO, issueNumber: number, now: NOW,
        issueFile: `packages/core/src/tools/fixtures/brief/${name}-${number}.json` });
      const markdown = tool.formatBrief(result);
      const json = JSON.parse(JSON.stringify(result)) as Brief;
      expect(json.issue.number).toBe(number);
      expect(json.repository.headSha).toBe(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim());
      expect(json.source.stale).toBe(true);
      expect(json.source.fetchedAt).toBeNull();
      expect(json.acceptance?.text).toBeTruthy();
      expect(markdown).toContain(json.acceptance!.text);
      expect(json.guides.some((item) => item.path === guide)).toBe(true);
      expect(json.taskRoutes.length).toBeGreaterThan(0);
      expect(json.verification.recommendedLocal.length).toBeGreaterThan(0);
      expect(markdown).toContain(guide);
      expect(markdown).toContain(json.repository.headSha!);
      expect(markdown).toContain('Required integration CI');
      expect(markdown).toContain('Scheduled evidence');
      expect(markdown.split('\n').length).toBeLessThanOrEqual(150);
    });

    it('runs the CLI offline without modifying the worktree, index, branch or refs', () => {
      const cwd = mkdtempSync(join(tmpdir(), 'ed-brief-'));
      temps.push(cwd);
      const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
      git('init', '-q');
      git('config', 'user.name', 'Brief fixture');
      git('config', 'user.email', 'fixture@example.invalid');
      writeFileSync(join(cwd, 'AGENTS.md'), agentText);
      writeFileSync(join(cwd, 'ARCHITECTURE.md'), '## Where a thing lives\n| If you are changing | Go to | Guarded by |\n|---|---|---|\n| Fixture | `fixture.ts` | `fixture.test.ts` |\n---\n');
      writeFileSync(join(cwd, 'fixture.ts'), 'export const n = 1;\n');
      writeFileSync(join(cwd, 'fixture.test.ts'), '// fixture\n');
      git('add', '.');
      git('commit', '-qm', 'Fixture');
      git('remote', 'add', 'origin', 'http://127.0.0.1:1/no-network');
      const claimSha = execFileSync('git', ['commit-tree', 'HEAD^{tree}'], { cwd, input: 'claim 8\n\nagent: other\nlane: code\npath: fixture.ts\n', encoding: 'utf8' }).trim();
      git('update-ref', 'refs/remotes/origin/claim/8', claimSha);
      const inputDir = mkdtempSync(join(tmpdir(), 'ed-brief-input-'));
      temps.push(inputDir);
      const issueFile = join(inputDir, 'issue with spaces.json');
      writeFileSync(issueFile, JSON.stringify(snapshot('## Acceptance\nPreserve me.\n## Files\n`fixture.ts`')));
      const before = { status: git('status', '--porcelain'), refs: git('show-ref'), head: git('rev-parse', 'HEAD'),
        files: readdirSync(cwd).sort(), index: createHash('sha256').update(readFileSync(join(cwd, '.git/index'))).digest('hex') };
      const run = (...args: string[]) => spawnSync(process.execPath, [join(REPO, 'tools/brief.mjs'), ...args], { cwd, encoding: 'utf8',
        env: { ...process.env, GITHUB_TOKEN: '', GH_TOKEN: '', GIT_TERMINAL_PROMPT: '0' }, timeout: 15000 });
      const result = run('--issue', '7', '--issue-file', issueFile, '--json');
      expect(result.status, result.stderr).toBe(0);
      const data = JSON.parse(result.stdout) as Brief;
      expect(data.source.label).toBe(`file:${issueFile}`);
      expect(data.claims.active[0]?.slug).toBe('8');
      expect(data.source.fetchedAt).toBeNull();
      expect(data.repository.headSha).toBe(before.head);
      const human = run('--issue', '7', '--issue-file', issueFile);
      expect(human.status, human.stderr).toBe(0);
      expect(human.stdout).toContain(data.acceptance!.text);
      expect(human.stdout).toContain('claim/8');
      expect({ status: git('status', '--porcelain'), refs: git('show-ref'), head: git('rev-parse', 'HEAD'),
        files: readdirSync(cwd).sort(), index: createHash('sha256').update(readFileSync(join(cwd, '.git/index'))).digest('hex') }).toEqual(before);
      expect(run('--issue', '99', '--issue-file', issueFile).stderr).toContain('requested #99');
      expect(run('--issue', '7').stderr).toContain('--issue-file');
      writeFileSync(issueFile, '{bad json');
      expect(run('--issue', '7', '--issue-file', issueFile).stderr).toContain('Cannot read issue JSON');
    });
  });
}

const mapParser = await import(pathToFileURL(join(REPO, 'tools/codemap.mjs')).href) as {
  parseCodemap: (text: string, options: { files: string[] }) => {
    entries: { paths: string[]; suites: string[] }[]; problems: object[];
  };
};

describe('the architecture map consumed by verification and task briefs', () => {
  it('resolves every Go to path and Guarded by suite without ambiguity', () => {
    const files = execFileSync('git', ['ls-files', '-z'], { cwd: REPO, encoding: 'utf8' }).split('\0').filter(Boolean);
    const map = mapParser.parseCodemap(readFileSync(join(REPO, 'ARCHITECTURE.md'), 'utf8'), { files });
    expect(map.entries.length).toBeGreaterThan(0);
    expect(map.problems).toEqual([]);
    for (const entry of map.entries) {
      for (const path of [...entry.paths, ...entry.suites]) expect(existsSync(join(REPO, path)), path).toBe(true);
    }
    // Identical basenames exist in core and schema, or core and tools. The
    // source's package/directory is evidence; a global first-match is not.
    expect(map.entries.find((entry) => entry.paths.includes('packages/core/src/events/tales.ts'))?.suites)
      .toContain('packages/core/src/tales.test.ts');
    expect(map.entries.find((entry) => entry.paths.length === 1 && entry.paths[0] === 'packages/core/src/land.ts')?.suites)
      .toContain('packages/core/src/land.test.ts');
  });

  it('refuses an ambiguous shorthand and missing guards rather than picking a filename', () => {
    const map = mapParser.parseCodemap('## Where a thing lives\n| Fixture | `same.ts` | `missing.test.ts` |\n---', {
      files: ['packages/core/src/same.ts', 'packages/schema/src/same.ts'],
    });
    expect(map.problems).toHaveLength(2);
    expect(map.entries[0]?.paths).toEqual([]);
  });
});

/**
 * THE MAP MUST MATCH THE GROUND.
 *
 * `ARCHITECTURE.md` exists so an agent can find one file instead of reading
 * twenty, and the per-package `AGENTS.md` files exist so it loads only the
 * rules for where it is working. Both are worth exactly as much as their
 * accuracy: a codemap naming a file that was renamed six commits ago costs more
 * than no codemap, because it is read and believed.
 *
 * So the paths are checked. This is cheap, it runs in the fast suite, and it is
 * the only thing standing between a helpful map and a confident wrong one.
 */

const PACKAGE_GUIDES = readdirSync(join(REPO, 'packages'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => `packages/${entry.name}/AGENTS.md`);

const DOCS = [
  'AGENTS.md',
  'ARCHITECTURE.md',
  'README.md',
  'docs/COMMANDS.md',
  'docs/FAILURES.md',
  'docs/TEST-COVERAGE.md',
  ...PACKAGE_GUIDES,
];

/** `path/like/this.ts` inside backticks. Bare prose is not checked. */
const PATH_IN_TICKS = /`([A-Za-z0-9_./-]+\.(?:ts|md|yaml|mjs|json|vue))`/g;
/** [text](relative/link) — skip anchors and absolute URLs. */
const MD_LINK = /\[[^\]]*\]\((?!https?:|#)([^)]+)\)/g;

/**
 * Where a shorthand path may be resolved from. The docs write
 * `core/src/testing.ts` rather than `packages/core/src/testing.ts`, which reads
 * better and is unambiguous — so `packages` is a root, not a prefix anyone types.
 */
const SEARCH_ROOTS = [
  '', 'packages', 'packages/core/src', 'packages/schema/src', 'packages/content',
  'packages/editor/src', 'packages/core/src/people', 'packages/core/src/events',
  'packages/client/src', 'packages/client/src/lib', 'packages/client/src/components',
  'packages/core/src/year', 'packages/core/src/genetics', 'packages/core/src/ages',
  'packages/core/src/tools', 'packages/content/tools', 'packages/editor/src/components',
  'packages/editor/src/lib', 'packages/content/events',
  'packages/shell', 'packages/shell/src', 'packages/shell/scripts',
  'packages/mobile', 'packages/mobile/src', '.github/workflows',
];

function resolves(link: string, docDir: string): boolean {
  // `ARCHITECTURE.md#the-year` names a file and a heading in it. Only the file
  // half is a path; the fragment is checked by nothing, which is honest — a
  // renamed heading is a worse link, not a wrong one.
  const ref = link.split('#')[0]!;
  if (!ref) return true;
  if (existsSync(join(REPO, ref))) return true;
  if (existsSync(join(REPO, docDir, ref))) return true;
  return SEARCH_ROOTS.some((root) => existsSync(join(REPO, root, ref)));
}

/**
 * ONE PLACE STATES WHAT THE SUITE COSTS.
 *
 * `npm run test:fast` was documented as "~3s", "~2s", "two seconds" and "about
 * eight seconds" in four different files while actually taking a hundred, and
 * `npm test` had three different test counts across five. The sweep that fixed
 * them read a fixed list of files and missed two more — `ARCHITECTURE.md` still
 * said ~2s and `README.md` still claimed 699 tests, both found later by accident.
 *
 * A number that appears in five documents is wrong in four of them eventually.
 * So the command block lives in `docs/COMMANDS.md` and every other document links to
 * it, and this fails the build if a second copy grows back.
 */
const COST_HOME = 'docs/COMMANDS.md';

/**
 * Where a stray cost is looked for — WIDER than DOCS, and deliberately so.
 *
 * `docs/PARALLEL.md` carried "~27s" and "~9 min" for months, in the document
 * whose whole subject is what an agent should run, and `package.json`'s `//0`
 * comment said "~3s" while the lane took a hundred seconds. Neither was in the
 * list. The rule was never wrong; it was just short.
 *
 * These files are NOT in `DOCS`, because the path and link checks below would
 * then run over them too, and `BALANCE-LOG.md` legitimately names files that
 * do not exist yet — it is a design log, and a forward reference is not a
 * broken one. Two rules, two lists, each as wide as it should be.
 */
const COST_SCAN = [...DOCS, 'docs/PARALLEL.md', 'docs/BALANCE-LOG.md', 'package.json'];

/** `npm test  # 918 tests in 66 files` — a command line quoting its own cost. */
const TIMED_COMMAND =
  /^[^\n]*\bnpm (?:run )?(?:check|test|test:fast|test:slow)\b[^\n]*#[^\n]*?\d[\d,.]*\s*(?:s\b|ms\b|min\b|minutes?\b|seconds?\b|tests?\b|files?\b)/gm;

/**
 * The SAME claim, spelled out — which is how it hid.
 *
 * `TIMED_COMMAND` needs a `#` and a digit, so it catches the command-block
 * form and misses running prose. `AGENTS.md` said "`npm run test:fast` skips
 * them and takes about twenty-six seconds" the whole time the rule was in
 * force, in a file the rule scans, because the number was a word.
 */
const TIMED_PROSE =
  /`npm (?:run )?(?:check|test:fast|test:slow|test)`[^.]{0,80}?\b(?:about|roughly|around|takes|costs)\b[^.]{0,40}?\b(?:\d[\d,.]*|one|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|forty|fifty|sixty|ninety|hundred)\b/gi;

describe('what the suite costs is stated once', () => {
  for (const doc of COST_SCAN.filter((d) => d !== COST_HOME)) {
    it(`${doc} quotes no timing or count of its own`, () => {
      const text = readFileSync(join(REPO, doc), 'utf8');
      // Prose WRAPS. The first cut of TIMED_PROSE forbade newlines and so
      // could not see AGENTS.md's "takes about twenty-six / seconds", which
      // is the exact sentence it was written for — a rule that cannot fail,
      // passing. Matched against flowed text; the command form stays
      // line-based, because a command line is a line.
      const flowed = text.replace(/\n\s*/g, ' ');
      const copies = [
        ...[...text.matchAll(TIMED_COMMAND)].map((m) => m[0].trim()),
        ...[...flowed.matchAll(TIMED_PROSE)].map((m) => m[0].trim()),
      ];
      expect(
        copies,
        `${doc} states what a command costs. Link to ${COST_HOME}#commands ` +
        `instead — a number kept in two files is wrong in one of them within a ` +
        `few commits, and this one has been wrong in four at once:\n` +
        copies.map((c) => `  ${c}`).join('\n'),
      ).toEqual([]);
    });
  }
});

/**
 * THE SHARED, ALWAYS-LOADED FILE STAYS BOUNDED.
 *
 * `AGENTS.md` is read in full at the start of every session, before the task is
 * known — its size is a tax on every piece of work done in this repo. It is
 * also now the one canonical instruction file for Claude Code, Codex and other
 * agents. Task-specific detail belongs in routed guides; the command-cost
 * block lives in docs/COMMANDS.md. Universal constraints stay here.
 *
 * Nothing about that was visible, which is the usual story here. A document
 * does not fail; it just quietly costs more every session, and the cost is
 * paid by whoever reads it next.
 *
 * The root target is 12 KiB. codex.test.ts independently checks root plus
 * every package guide against Codex's default 32 KiB concatenation budget.
 */
const BUDGET = 12 * 1024;

/**
 * THE FIGURE IS TRUE, NOT MERELY UNIQUE.
 *
 * The rule above enforces that a cost is stated in ONE place. It has never
 * enforced that the place is right, and it was not: `~27s` against a measured
 * 68, `~25 min` against a measured 18, `~9 min` for a command that takes 30.
 *
 * A BAND, not an equality, and a wide one. A container is not a stopwatch and
 * the suite grows every time anybody lands — the same branch measured 1,748
 * tests at 09:46 and 1,767 at 19:00 on one day, having changed nothing itself.
 * What is worth failing a build over is the figure being off by a FACTOR,
 * which is what `test:fast` was. Ordinary drift is not a build failure; it is
 * what `npm run cost` is for.
 */
describe('the canonical command cost is close to the truth', () => {
  // The cost generator writes seconds for short runs and rounded minutes for
  // longer runs. CI's fast lane may be slower than a four-core developer box.
  function documentedFastSeconds(text: string): number | null {
    const m = /^npm run test:fast\s+# ~?(\d+)\s*(s|min)\b/m.exec(text);
    return m ? Number(m[1]) * (m[2] === 'min' ? 60 : 1) : null;
  }

  const stated = () => documentedFastSeconds(readFileSync(join(REPO, COST_HOME), 'utf8'));

  it('understands both generated timing units', () => {
    expect(documentedFastSeconds('npm run test:fast    # ~118s, the fix-and-rerun loop')).toBe(118);
    expect(documentedFastSeconds('npm run test:fast    # ~4 min, the fix-and-rerun loop')).toBe(240);
    expect(documentedFastSeconds('npm run test:fast    # no timing')).toBeNull();
  });

  it('states a figure for the fix-and-rerun loop at all', () => {
    expect(
      stated(),
      `${COST_HOME} no longer says what \`npm run test:fast\` costs. It is the one number ` +
      'an agent uses to decide whether it can afford to re-run, and the one place it lives.',
    ).not.toBeNull();
  });

  /**
   * Not measured here: running the lane inside the lane is a recursion, and a
   * timing assertion in CI fails on a noisy machine and gets muted — which is
   * the reason `lanes.test.ts` is structural rather than a stopwatch. What
   * this catches is a figure that is absurd on its face.
   */
  it('states a figure that could plausibly be a fast lane', () => {
    const s = stated()!;
    expect(s, `${COST_HOME} says test:fast takes ${s}s`).toBeGreaterThan(5);
    expect(
      s,
      `${COST_HOME} says test:fast takes ${s}s. Over ten minutes is not a ` +
      `fix-and-rerun loop — either a slow suite has landed in the fast lane ` +
      `(lanes.test.ts) or the figure is stale. \`npm run cost -- --write\`.`,
    ).toBeLessThan(600);
  });
});

describe('the file that loads every session', () => {
  it(`stays under ${BUDGET / 1000}KB`, () => {
    const bytes = statSync(join(REPO, 'AGENTS.md')).size;
    expect(
      bytes,
      `AGENTS.md is ${bytes} bytes, over its ${BUDGET} budget. Move what only ` +
      `some tasks need into a document the routing table points at, the way ` +
      `docs/BALANCE-LOG.md was split out.`,
    ).toBeLessThanOrEqual(BUDGET);
  });

  it('keeps CLAUDE.md as an import shim rather than a second instruction set', () => {
    const shim = readFileSync(join(REPO, 'CLAUDE.md'), 'utf8');
    expect(shim).toContain('@AGENTS.md');
    expect(
      shim.length,
      'CLAUDE.md has grown into a second copy of the shared instructions',
    ).toBeLessThan(500);
  });

  it('keeps every Claude package shim pointed at its scoped guide', () => {
    for (const guide of PACKAGE_GUIDES) {
      const shim = join(REPO, dirname(guide), 'CLAUDE.md');
      expect(readFileSync(shim, 'utf8'), `${guide} has no thin Claude import`).toBe('@AGENTS.md\n');
    }
  });
});

/**
 * THE NUMBER IN THE ALWAYS-LOADED FILE.
 *
 * `AGENTS.md` said `SAVE_FORMAT` was 7 while `schema/src/save.ts` said 10 —
 * three formats of drift, in the one document that is read in full at the
 * start of every session before the task is known. It is the single worst
 * place in the repo for a stale number, because it is guaranteed to be read
 * and believed, and nothing anywhere reported it.
 *
 * It was found by hand, twice. This is the third time it will not be.
 */
describe('the save format, as the always-loaded file states it', () => {
  it(`says ${SAVE_FORMAT}, because that is what the schema says`, () => {
    const text = readFileSync(join(REPO, 'AGENTS.md'), 'utf8');
    const stated = /`SAVE_FORMAT` is (\d+)/.exec(text);
    expect(stated, 'AGENTS.md no longer states the save format at all').toBeTruthy();
    expect(
      Number(stated![1]),
      `AGENTS.md says SAVE_FORMAT is ${stated?.[1]}, schema/src/save.ts says ${SAVE_FORMAT}`,
    ).toBe(SAVE_FORMAT);
  });
});

/**
 * A SKILL IS AN INSTRUCTION, AND CARRIES MORE AUTHORITY THAN A DOCUMENT.
 *
 * `DOCS` above is checked for paths that do not resolve, because "a codemap
 * naming a file that was renamed six commits ago costs more than no codemap,
 * because it is read and believed". Skills were never checked, and one of them
 * had eleven dangling references: `improve-codebase-architecture` opened by
 * telling the agent to run a `/codebase-design` skill that does not exist here
 * and to read `CONTEXT.md`, seven times, and ADRs in `docs/adr/` — none of the
 * three present in this repository.
 *
 * A document is read as reference and can be doubted. A skill is loaded as
 * instructions, so a wrong one does not get doubted; it gets followed, and the
 * session is spent looking for a file nobody ever wrote.
 *
 * Frontmatter is skipped: a `description` is prose about when to reach for the
 * skill, and names things like `packages/content/**.yaml` that are globs
 * rather than paths.
 */
/**
 * Paths a skill WRITES rather than reads. Absent is their normal state.
 *
 * `interface-design` offers to save a design system to
 * `.interface-design/system.md` and guards every mention of it with "if
 * present" or "if exists". Flagging that would make the rule cry wolf, and a
 * rule that cries wolf gets an exemption added carelessly the second time.
 * So the exemption is explicit, here, with the reason attached — the same
 * shape as `SEARCH_ROOTS` above and the `shell` exemption below.
 */
const WRITTEN_BY_SKILLS = new Set(['.interface-design/system.md']);

const SKILLS = readdirSync(join(REPO, '.claude/skills'), { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => join('.claude/skills', e.name, 'SKILL.md'))
  .filter((p) => existsSync(join(REPO, p)));

const CODEX_SKILLS = join(REPO, '.agents/skills');

/** Everything after the closing `---` of the YAML frontmatter. */
const withoutFrontmatter = (text: string) =>
  /^---\n[\s\S]*?\n---\n/.test(text) ? text.replace(/^---\n[\s\S]*?\n---\n/, '') : text;

describe('the skills, which are instructions rather than reference', () => {
  it('has at least one to check, so this cannot pass by finding nothing', () => {
    expect(SKILLS.length).toBeGreaterThan(0);
  });

  for (const skill of SKILLS) {
    const body = withoutFrontmatter(readFileSync(join(REPO, skill), 'utf8'));
    const dir = dirname(skill);

    it(`${skill} names only files that exist`, () => {
      const missing = [...body.matchAll(PATH_IN_TICKS)]
        .map((m) => m[1]!)
        .filter((ref) => !WRITTEN_BY_SKILLS.has(ref) && !resolves(ref, dir));
      expect(
        [...new Set(missing)],
        `${skill} tells an agent to read files that are not in this repository. ` +
        `A skill is loaded as instructions, so a wrong path is followed rather ` +
        `than doubted. Fix the reference, or delete the skill.`,
      ).toEqual([]);
    });

    it(`${skill} links only to documents that exist`, () => {
      const broken = [...body.matchAll(MD_LINK)]
        .map((m) => m[1]!)
        .filter((ref) => !resolves(ref, dir));
      expect([...new Set(broken)], `${skill} has broken links`).toEqual([]);
    });
  }

  /**
   * AGENTS.md says of the prose skills: "They do not overlap. Reach for the
   * right one." That sentence is only true if the file lists what is there.
   * Six directories exist under `.claude/skills` and three were named.
   */
  it('accounts for every skill in the always-loaded file', () => {
    const claude = readFileSync(join(REPO, 'AGENTS.md'), 'utf8');
    const unlisted = SKILLS.map((skill) => basename(dirname(skill)))
      .filter((name) => !claude.includes(name));
    expect(
      unlisted,
      `.claude/skills holds ${unlisted.join(', ')}, which AGENTS.md never mentions. ` +
      `An agent cannot reach for a skill it does not know exists, and cannot avoid ` +
      `one it does not know overlaps. Name it, or remove it.`,
    ).toEqual([]);
  });
  it('exposes every canonical skill to Codex without copying its instructions', () => {
    const canonical = SKILLS.map((skill) => basename(dirname(skill))).sort();
    const exposed = readdirSync(CODEX_SKILLS, { withFileTypes: true })
      .filter((e) => e.isDirectory() && existsSync(join(CODEX_SKILLS, e.name, 'SKILL.md')))
      .map((e) => e.name)
      .sort();
    expect(exposed, 'Claude Code and Codex see different project skills').toEqual(canonical);

    for (const name of canonical) {
      const launcher = readFileSync(join(CODEX_SKILLS, name, 'SKILL.md'), 'utf8');
      expect(launcher).toContain(`name: ${name}`);
      expect(launcher).toContain(`../../../.claude/skills/${name}/SKILL.md`);
    }
  });
});
describe('the codemap', () => {
  for (const doc of DOCS) {
    describe(doc, () => {
      const text = readFileSync(join(REPO, doc), 'utf8');
      const docDir = doc.includes('/') ? doc.slice(0, doc.lastIndexOf('/')) : '';

      it('names only files that exist', () => {
        const missing = [...text.matchAll(PATH_IN_TICKS)]
          .map((m) => m[1]!)
          .filter((ref) => !resolves(ref, docDir));
        expect([...new Set(missing)], `${doc} names files that are not there`).toEqual([]);
      });

      it('links only to documents that exist', () => {
        const broken = [...text.matchAll(MD_LINK)]
          .map((m) => m[1]!)
          .filter((ref) => !resolves(ref, docDir));
        expect([...new Set(broken)], `${doc} has broken links`).toEqual([]);
      });
    });
  }

  it('gives every package its own scoped AGENTS.md', () => {
    const packages = readdirSync(join(REPO, 'packages'), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
    for (const pkg of packages) {
      expect(
        existsSync(join(REPO, 'packages', pkg, 'AGENTS.md')),
        `packages/${pkg} has no AGENTS.md, so an agent working there gets the root file or nothing`,
      ).toBe(true);
    }
  });

  it('routes from the root file rather than restating', () => {
    const root = readFileSync(join(REPO, 'AGENTS.md'), 'utf8');
    for (const doc of DOCS.filter((d) => d !== 'AGENTS.md' && d !== 'README.md')) {
      expect(root, `AGENTS.md never points at ${doc}`).toContain(doc);
    }
  });
});


/**
 * The editor's Vite config imports a Node-side TypeScript source auditor from
 * another workspace. Vite's default bundled config loader externalizes that
 * source, leaving Node to resolve a .js specifier whose source is .ts. The
 * module runner handles workspace TypeScript without shipping Node-only code
 * to the editor renderer. Keep every CLI entry point on that same loader.
 */
describe('the editor Vite entry points', () => {
  const pkg = JSON.parse(readFileSync(join(REPO, 'packages/editor/package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };
  const commands = { dev: 'vite', build: 'vite build', preview: 'vite preview' };

  for (const [name, command] of Object.entries(commands)) {
    it(`${name} loads its workspace TypeScript config through the module runner`, () => {
      const invocation = pkg.scripts[name] ?? '';
      expect(invocation.split(/\s+/).slice(0, command.split(' ').length).join(' ')).toBe(command);
      expect(
        invocation,
        `Editor ${name} must pass --configLoader runner; default bundling cannot load core-message-audit.js from TypeScript sources`,
      ).toMatch(/(?:^|\s)--configLoader(?:\s+|=)runner(?=\s|$)/);
    });
  }
});

// Verification consumes this map; its planning and read-only CLI cases live
// with the existing map contract rather than in a second map-owning suite.
{
  const CLI = join(REPO, 'tools/verify-plan.mjs');
  interface Reason { reason: string; source: string }
  interface Command { command: string; args: string[]; currentTier: string | null; reasons: Reason[] }
  interface Plan {
    scope: string; uncertain: boolean; baseSha: string | null; headSha: string | null;
    reasons: Reason[]; notes: string[]; recommendedLocal: Command[]; scheduledEvidence: Command[];
    requiredIntegration: { id: string; currentTier: string }[];
    workflowScripts: { scripts: string[] }; files: string[];
  }
  const planner = await import(pathToFileURL(CLI).href) as {
    planFor: (input: object) => Plan;
    parseNameStatus: (text: string) => { files: string[]; renames: object[]; deletions: string[] };
    gatherPlan: (input: { cwd: string; base: string }) => Promise<Plan>;
    formatPlan: (plan: Plan) => string;
  };
  const codemap = await import(pathToFileURL(join(REPO, 'tools/codemap.mjs')).href) as {
    parseCodemap: (text: string, options: { files: string[] }) => {
      entries: { paths: string[]; suites: string[] }[]; problems: object[]; files: string[];
    };
  };
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: REPO, encoding: 'utf8' }).split('\0').filter(Boolean);
  const map = codemap.parseCodemap(readFileSync(join(REPO, 'ARCHITECTURE.md'), 'utf8'), { files: tracked });
  const inventory = JSON.parse(readFileSync(join(REPO, 'tools/ci-evidence.json'), 'utf8'));
  const evidence = { ...inventory, baseState: 'green', workflowScripts: ['test', 'gates', 'typecheck', 'validate'] };
  const plan = (files: string[], extra = {}) => planner.planFor({
    files, baseSha: 'base-sha', headSha: 'head-sha', evidence, map, ...extra,
  });
  const commands = (items: Command[]) => items.map((item) => item.command);
  const FULL = 'npm run land -- --full-preflight';

  describe('advisory verification from the canonical map', () => {
    it('selects mapped leaf evidence and colocated tests with reasons, without certifying safety', () => {
      const result = plan(['packages/core/src/people/library.ts']);
      expect(result.scope).toBe('focused');
      expect(commands(result.recommendedLocal)).toContain('npm test -- packages/core/src/library.test.ts');
      expect(commands(result.recommendedLocal)).toContain('npm run typecheck:core');
      expect(result.recommendedLocal.every((c) => c.reasons.every((r) => r.reason && r.source))).toBe(true);
      expect(result.requiredIntegration.some((job) => job.id === 'required')).toBe(true);
    });

    it('uses current enforcement even when proposed tiers disagree', () => {
      const changed = JSON.parse(JSON.stringify(evidence));
      changed.slowSuites.forEach((suite: { currentTier: string; proposedTier: string }) => {
        suite.proposedTier = suite.currentTier === 'weekly' ? 'merge-blocking' : 'weekly';
      });
      changed.telemetryGates.forEach((gate: { proposedTier: string }) => { gate.proposedTier = 'merge-blocking'; });
      expect(plan(['packages/content/events/age_crusade.yaml'], { evidence: changed }))
        .toEqual(plan(['packages/content/events/age_crusade.yaml']));
      const result = plan(['packages/core/src/events/arcs.ts']);
      expect(result.scheduledEvidence.find((c) => c.command.includes('arcs.slow.test.ts'))?.currentTier).toBe('weekly');
      expect(commands(result.scheduledEvidence)).toContain('npm run gates -- fire-rate');
    });

    it('checks saves and replay and calls out compatibility, without deciding the format', () => {
      const result = plan(['packages/schema/src/save.ts']);
      expect(commands(result.recommendedLocal)).toEqual(expect.arrayContaining([
        'npm test -- packages/core/src/save.test.ts', 'npm test -- packages/core/src/replay.test.ts',
      ]));
      expect(result.notes.join(' ')).toContain('SAVE_FORMAT');
    });

    it('selects loader/validation tests and separates scheduled exposure for YAML', () => {
      const result = plan(['packages/content/events/age_crusade.yaml']);
      expect(result.scope).toBe('focused');
      expect(commands(result.recommendedLocal)).toEqual(expect.arrayContaining([
        'npm run validate', 'npm test -- packages/schema/src/bundle.test.ts',
        'npm test -- packages/content/src/content-path.test.ts',
      ]));
      expect(commands(result.scheduledEvidence)).toEqual(expect.arrayContaining([
        'npm run gates -- fire-rate', 'npm run gates -- outcome-reach',
      ]));
      expect(commands(result.recommendedLocal).some((c) => /fire-rate|outcome-reach/.test(c))).toBe(false);
    });

    it.each(['green', 'red', 'pending', 'absent'])('reuses documentation classification for a %s cached base', (baseState) => {
      const result = plan(['README.md'], { evidence: { ...evidence, baseState } });
      expect(result.scope).toBe(baseState === 'green' ? 'docs' : 'broad');
      expect(commands(result.recommendedLocal)).toEqual(baseState === 'green'
        ? ['npm run typecheck', 'npm run validate', 'npm run test:fast'] : [FULL]);
      expect(result.reasons.some((r) => r.source.includes('diff-kind'))).toBe(true);
    });

    it.each([
      'packages/core/src/rng.ts', 'packages/core/src/world.ts', 'packages/core/src/testing.ts',
      'packages/core/src/year/phases.ts', 'packages/client/src/index.ts', 'some/unknown.ts',
    ])('broadens shared or unknown dependencies: %s', (path) => {
      const result = plan([path]);
      expect(result.scope).toBe('broad');
      expect(commands(result.recommendedLocal)).toEqual([FULL]);
    });

    it('never treats a colocated filename as proof of coverage', () => {
      const result = plan(['new-module.ts'], { map: { ...map, files: [...map.files, 'new-module.test.ts'] } });
      expect(result.scope).toBe('broad');
      expect(result.reasons.some((r) => /No architecture route/.test(r.reason))).toBe(true);
    });

    it.each([
      { shallow: true }, { baseSha: undefined }, { headSha: undefined }, { evidence: {} },
      { map: { ...map, problems: [{ ref: 'missing.ts' }] } },
    ])('marks incomplete facts uncertain: %j', (facts) => {
      const result = plan(['packages/core/src/people/library.ts'], facts);
      expect(result.uncertain).toBe(true);
      expect(commands(result.recommendedLocal)).toEqual([FULL]);
    });

    it('broadens renames, deletions and package boundaries, including a code → Markdown rename', () => {
      for (const extra of [
        { renames: [{ from: 'engine.ts', to: 'engine.md' }] },
        { deletions: ['removed.ts'] },
      ]) {
        const result = plan(['README.md'], extra);
        expect(result.scope).toBe('broad');
        expect(result.files).toContain('README.md');
        expect(commands(result.recommendedLocal)).toEqual([FULL]);
      }
      expect(plan(['packages/core/src/save.ts', 'packages/schema/src/save.ts']).scope).toBe('broad');
    });

    it('preserves NUL-delimited rename/deletion paths containing spaces and newlines', () => {
      expect(planner.parseNameStatus('R100\0old name.ts\0new\nname.ts\0D\0deleted.ts\0M\0changed.ts\0')).toEqual({
        files: ['old name.ts', 'new\nname.ts', 'deleted.ts', 'changed.ts'],
        renames: [{ from: 'old name.ts', to: 'new\nname.ts' }], deletions: ['deleted.ts'],
      });
    });

    it('accepts Windows path separators without changing the plan', () => {
      expect(plan(['packages\\core\\src\\people\\library.ts']))
        .toEqual(plan(['packages/core/src/people/library.ts']));
    });

    const fixtures = JSON.parse(readFileSync(join(REPO, 'tools/verify-plan-fixtures.json'), 'utf8')).fixtures as {
      name: string; baseSha: string; headSha: string; files: string[];
    }[];
    it.each(fixtures)('reproduces the $name commit fixture with explicit SHAs', (fixture) => {
      const result = plan(fixture.files, { baseSha: fixture.baseSha, headSha: fixture.headSha });
      expect(result).toEqual(plan(fixture.files, { baseSha: fixture.baseSha, headSha: fixture.headSha }));
      expect(result.baseSha).toBe(fixture.baseSha);
      expect(result.headSha).toBe(fixture.headSha);
      expect(result.scope).toBe(fixture.name === 'documentation audit' ? 'docs' : 'focused');
      const human = planner.formatPlan(result);
      for (const command of [...result.recommendedLocal, ...result.scheduledEvidence]) expect(human).toContain(command.command);
      for (const job of result.requiredIntegration) expect(human).toContain(`${job.id} [${job.currentTier}`);
      expect(human).toContain(fixture.headSha);
      expect(human).toContain('Scheduled evidence:');
    });
  });

  const temps: string[] = [];
  afterAll(() => { for (const temp of temps) rmSync(temp, { recursive: true, force: true }); });
  const gitEnv = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_CONFIG_NOSYSTEM: '1' };
  function checkout() {
    const cwd = mkdtempSync(join(tmpdir(), 'ed-verify-plan-'));
    temps.push(cwd);
    const write = (path: string, text: string) => {
      mkdirSync(dirname(join(cwd, path)), { recursive: true });
      writeFileSync(join(cwd, path), text);
    };
    const git = (...args: string[]) => execFileSync('git', args, { cwd, env: gitEnv, encoding: 'utf8', stdio: 'pipe' }).trim();
    git('init', '-q');
    git('config', 'user.name', 'Verification fixture');
    git('config', 'user.email', 'fixture@example.invalid');
    write('packages/core/src/example.ts', 'export const n = 1;\n');
    write('packages/core/src/example.test.ts', '// fixture suite\n');
    write('ARCHITECTURE.md', '## Where a thing lives\n\n| If you are changing… | Go to | Guarded by |\n|---|---|---|\n| Fixture | `core/src/example.ts` | `example.test.ts` |\n\n---\n');
    write('tools/ci-evidence.json', JSON.stringify(evidence));
    write('.github/workflows/check.yml', 'jobs:\n  fast:\n    steps:\n      - run: npm run test:fast\n');
    write('package.json', JSON.stringify({ scripts: {
      test: 'node -e "process.exit(7)"',
      'typecheck:core': 'node -e "require(\'fs\').writeFileSync(\'should-not-run\',\'bad\')"',
    } }));
    git('add', '.');
    git('commit', '-qm', 'fixture base');
    write('packages/core/src/example.ts', 'export const n = 2;\n');
    return { cwd, write, git };
  }
  function snapshot(root: string): string {
    const hash = createHash('sha256');
    const visit = (dir: string) => {
      for (const name of readdirSync(dir).sort()) {
        const path = join(dir, name);
        hash.update(path.slice(root.length));
        const stat = statSync(path);
        hash.update(`${stat.size}:${stat.mtimeMs}`);
        if (stat.isDirectory()) visit(path);
        else hash.update(readFileSync(path));
      }
    };
    visit(root);
    return hash.digest('hex');
  }

  describe('read-only CLI and explicit portable execution', () => {
    it('plans dirty local changes from a subdirectory without credentials or writes', async () => {
      const { cwd } = checkout();
      const before = snapshot(cwd);
      const result = spawnSync(process.execPath, [CLI, '--plan', '--base', 'HEAD', '--json'], {
        cwd, encoding: 'utf8', env: { ...gitEnv, GH_TOKEN: '', GITHUB_TOKEN: '' },
      });
      expect(result.status, result.stderr).toBe(0);
      const parsed = JSON.parse(result.stdout) as Plan;
      expect(parsed.scope).toBe('focused');
      expect(parsed.files).toEqual(['packages/core/src/example.ts']);
      expect(await planner.gatherPlan({ cwd: join(cwd, 'packages/core'), base: 'HEAD' })).toEqual(parsed);
      expect(snapshot(cwd)).toBe(before);
    });

    it('reports missing base and real shallow history as uncertain, without repairing either', () => {
      const { cwd, git } = checkout();
      for (const base of ['missing-remote/main', 'HEAD']) {
        if (base === 'HEAD') writeFileSync(join(cwd, '.git/shallow'), git('rev-parse', 'HEAD') + '\n');
        const before = snapshot(cwd);
        const result = spawnSync(process.execPath, [CLI, '--plan', '--base', base, '--json'], { cwd, env: gitEnv, encoding: 'utf8' });
        expect(result.status, result.stderr).toBe(0);
        const parsed = JSON.parse(result.stdout) as Plan;
        expect(parsed.uncertain).toBe(true);
        expect(commands(parsed.recommendedLocal)).toEqual([FULL]);
        expect(snapshot(cwd)).toBe(before);
      }
    });

    it('reports the actual npm failure status and stops before later commands', () => {
      const { cwd } = checkout();
      const result = spawnSync(process.execPath, [CLI, '--plan', '--base', 'HEAD', '--run', '--json'], {
        cwd, env: gitEnv, encoding: 'utf8',
      });
      expect(result.status, result.stderr).toBe(7);
      const parsed = JSON.parse(result.stdout) as Plan & { results: { ok: boolean; status: number }[] };
      expect(parsed.results).toHaveLength(1);
      expect(parsed.results[0]).toMatchObject({ ok: false, status: 7 });
      expect(readdirSync(cwd)).not.toContain('should-not-run');
    });
  });
}
