#!/usr/bin/env node
/**
 * WHO IS WORKING ON WHAT, IN A PLACE NO AGENT OWNS.
 *
 * Every agent on this project authenticates to GitHub as JamesFlames. There is
 * one identity between all of them, so `assignees` cannot say which agent holds
 * an issue — every claim reads the same. Labels and comments cannot arbitrate a
 * race either: both are read-then-write over an API with no compare-and-swap,
 * so two agents that look a second apart both see the issue free and both take
 * it. The tracker is where a HUMAN sees what is claimed. It is not the lock.
 *
 * Git ref creation IS a compare-and-swap. Pushing a branch that already exists,
 * carrying a commit that is not a descendant of the one already there, is
 * rejected by the server — always, by protocol, for every ref under
 * refs/heads/. So a claim here is an ORPHAN commit (no parent, empty tree)
 * pushed to `claim/<slug>`. Orphan, so that no second claim can ever be a
 * fast-forward of the first and quietly win. Empty tree, so that taking a claim
 * touches no file, needs no clean working copy, and cannot be merged into
 * anything by accident.
 *
 * The commit message is the payload: which agent, which lane, which paths it
 * means to write. That last field is the useful one — `check` reads every open
 * claim and tells an agent whose declared paths overlap its own BEFORE either
 * has written a line, which is the only cheap moment to find out.
 *
 * A claim is advisory. It stops two agents starting the same issue; it cannot
 * stop one that never ran this. See docs/PARALLEL.md for the lanes and for the
 * part of this repo that is not parallel-safe at all.
 *
 *   npm run agents                       # who holds what, and for how long
 *   npm run agents -- take 93 --paths packages/core/src/economy
 *   npm run agents -- check              # my claim, and anyone overlapping it
 *   npm run agents -- release 93         # tombstones the ref; the issue is free again
 *   npm run agents -- steal 93           # only once a claim has gone stale
 */
import { execFileSync } from 'node:child_process';

const NS = 'claim';
/** A claim older than this is presumed abandoned — a session dies without releasing. */
const STALE_HOURS = 6;
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

const git = (args, opts = {}) =>
  execFileSync('git', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...opts }).trim();

const tryGit = (args, opts) => {
  try {
    return { ok: true, out: git(args, opts) };
  } catch (e) {
    return { ok: false, out: `${e.stdout ?? ''}${e.stderr ?? ''}`.trim() };
  }
};

/** The branch an agent is working on is the best name it has; sessions are one-branch each. */
const thisAgent = () => {
  const flag = argOf('--agent');
  if (flag) return flag;
  if (process.env.ED_AGENT) return process.env.ED_AGENT;
  const b = tryGit(['rev-parse', '--abbrev-ref', 'HEAD']);
  return b.ok && b.out !== 'HEAD' ? b.out : `unnamed-${process.pid}`;
};

const args = process.argv.slice(2);
const flags = args.filter((a) => a.startsWith('--'));
const positional = args.filter((a) => !a.startsWith('--'));
const has = (f) => flags.some((x) => x === f || x.startsWith(`${f}=`));
function argOf(name) {
  const i = args.indexOf(name);
  if (i >= 0 && args[i + 1] && !args[i + 1].startsWith('--')) return args[i + 1];
  const eq = flags.find((x) => x.startsWith(`${name}=`));
  return eq ? eq.slice(name.length + 1) : undefined;
}

/**
 * --paths is intentionally friendlier than scalar flags. Agents naturally type
 * `--paths a b c`; consume every token up to the next flag, and accept commas
 * inside a token too. Claim commits then store one `path:` line per entry, so
 * the persisted format has no list delimiter to get wrong.
 */
function pathArgs() {
  const i = args.indexOf('--paths');
  const values = [];
  if (i >= 0) {
    for (let j = i + 1; j < args.length && !args[j].startsWith('--'); j++) values.push(args[j]);
  } else {
    const eq = flags.find((x) => x.startsWith('--paths='));
    if (eq) values.push(eq.slice('--paths='.length));
  }
  return values.flatMap((value) => value.split(',')).map((p) => p.trim()).filter(Boolean);
}

/** An issue number, or a named lane like `lane-content`. Both are just ref names. */
const slugOf = (raw) => {
  if (!raw) die('name an issue number or a lane — e.g. `take 93` or `take lane-content`');
  const s = String(raw).replace(/^#/, '');
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(s)) die(`not a usable claim name: ${raw}`);
  return s;
};

const die = (msg) => {
  console.error(`agents: ${msg}`);
  process.exit(2);
};

// ---------------------------------------------------------------------------

function fetchClaims() {
  // --prune, so a claim released elsewhere stops showing up here as held.
  const r = tryGit([
    'fetch', '--quiet', '--prune', '--prune-tags', 'origin',
    `+refs/heads/${NS}/*:refs/remotes/origin/${NS}/*`,
  ]);
  if (!r.ok && /could not read|Could not resolve|unable to access/i.test(r.out)) {
    die(`cannot reach origin — ${r.out.split('\n')[0]}`);
  }
}

function readRefs() {
  fetchClaims();
  const refs = tryGit(['for-each-ref', '--format=%(refname)%09%(objectname)', `refs/remotes/origin/${NS}/`]);
  if (!refs.ok || !refs.out) return [];
  return refs.out.split('\n').map((line) => {
    const [ref, sha] = line.split('\t');
    const slug = ref.slice(`refs/remotes/origin/${NS}/`.length);
    const body = tryGit(['log', '-1', '--format=%B%x00%ct', sha]).out;
    const [message = '', ts = '0'] = body.split('\0');
    const field = (k) => (message.match(new RegExp(`^${k}:\\s*(.*)$`, 'm'))?.[1] ?? '').trim();
    const fields = (k) => [...message.matchAll(new RegExp(`^${k}:\\s*(.*)$`, 'gm'))]
      .map((m) => m[1].trim())
      .filter(Boolean);
    const released = field('released') !== '';
    const claimSlug = message.match(/^claim\s+(\S+)\s*(?:\n|$)/)?.[1] ?? '';
    const agent = field('agent');
    const canonicalPaths = fields('path');
    // Backward compatibility for every claim written before #250, including
    // claims that accidentally used whitespace instead of commas.
    const legacyPaths = canonicalPaths.length
      ? []
      : field('paths').split(/[,\s]+/).map((p) => p.trim()).filter(Boolean);
    const malformed = !released && (claimSlug !== slug || !agent);
    const seconds = Number(ts);
    return {
      slug,
      sha,
      malformed,
      // A released claim is a ref whose head says so. Deleting the ref would be
      // tidier and is not available everywhere: a web session's git proxy
      // refuses ref deletion outright (403), so a release that deleted would
      // work on a laptop, fail in a container, and leave the issue looking held
      // by an agent that finished with it hours ago.
      released,
      agent: agent || '(unnamed)',
      lane: field('lane') || 'unspecified',
      paths: canonicalPaths.length ? canonicalPaths : legacyPaths,
      note: field('note'),
      takenAt: new Date(seconds * 1000).toISOString(),
      ageHours: (Date.now() / 1000 - seconds) / 3600,
    };
  }).sort((a, b) => a.slug.localeCompare(b.slug, undefined, { numeric: true }));
}

/** What is HELD. A tombstoned ref is a free issue with a receipt attached. */
const readClaims = () => readRefs().filter((c) => !c.released && !c.malformed);

/** Prefix overlap, with a trailing wildcard or slash meaning "and everything under it". */
const overlaps = (a, b) => {
  const norm = (p) => p.replace(/\/?\*+$/, '').replace(/\/$/, '');
  const [x, y] = [norm(a), norm(b)];
  return x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`);
};

/**
 * The closing keywords for every issue a branch is holding, ready to paste.
 * GitHub requires the keyword before EACH number, which is the rule everybody
 * discovers by finding a second issue still open a week later.
 */
const landingLine = (claims) => {
  const issues = [...new Set(claims.map((c) => c.slug).filter((s) => /^\d+$/.test(s)))]
    .sort((a, b) => Number(a) - Number(b));
  return issues.length ? issues.map((n, i) => `${i === 0 ? 'Closes' : 'closes'} #${n}`).join(', ') : '';
};

const age = (h) => (h < 1 ? `${Math.round(h * 60)}m` : h < 48 ? `${h.toFixed(1)}h` : `${(h / 24).toFixed(1)}d`);

// ---------------------------------------------------------------------------

function list() {
  const all = readRefs();
  const malformed = all.filter((c) => c.malformed);
  const openClaims = all.filter((c) => !c.released && !c.malformed);
  const claims = has('--all') ? all : openClaims;
  if (has('--json')) return console.log(JSON.stringify(claims, null, 2));
  for (const c of malformed) {
    console.log(`  ⚠ INVALID claim/${c.slug} ignored — its tip is not a claim message for that slug`);
  }
  if (claims.length === 0) {
    const released = all.filter((c) => c.released).length;
    const done = released ? ` (${released} released, \`--all\` to see them)` : '';
    return console.log(`no open claims — every issue is free${done}`);
  }
  /**
   * WHAT THIS BRANCH'S LANDING COMMIT WILL NEED, at every session start.
   *
   * `orient.mjs` runs this on the SessionStart hook, so a session that has
   * been resumed — or that has been looping on an issue long enough to have
   * lost the original instruction out of its context — is told the keyword
   * again, in the place it is already reading. The convention lived in
   * AGENTS.md and docs/PARALLEL.md and was correct in both; #106 still landed
   * green with the issue open, because a rule you have to go and find is a
   * rule a long session forgets.
   *
   * Printed before the roster rather than after it: the roster can run to
   * twenty lines across six claims, and the sentence about YOUR branch is the
   * one that is worth reading every time.
   */
  const line = landingLine(claims.filter((c) => !c.released && c.agent === thisAgent()));
  if (line) console.log(`this branch's landing commit needs: ${line}\n`);

  const open = claims.filter((c) => !c.released && !c.malformed).length;
  console.log(has('--all')
    ? `${claims.length} claim ref${claims.length === 1 ? '' : 's'}, ${open} open:\n`
    : `${open} open claim${open === 1 ? '' : 's'}:\n`);
  for (const c of claims) {
    const stale = c.released ? '  (released)' : c.ageHours > STALE_HOURS ? '  ← STALE, stealable' : '';
    console.log(`  ${c.slug.padEnd(16)} handled by ${c.agent}${stale}`);
    console.log(`  ${''.padEnd(16)} lane ${c.lane} · held ${age(c.ageHours)} · since ${c.takenAt}`);
    if (c.paths.length) console.log(`  ${''.padEnd(16)} paths ${c.paths.join(', ')}`);
    if (c.note) console.log(`  ${''.padEnd(16)} ${c.note}`);
    console.log();
  }
}

function take() {
  const slug = slugOf(positional[1]);
  const agent = thisAgent();
  const paths = pathArgs();
  const lane = argOf('--lane') ?? (paths.some((p) => p.startsWith('packages/content')) ? 'content' : 'code');
  const note = argOf('--note') ?? '';

  const all = readRefs();
  const held = all.filter((c) => !c.released && !c.malformed);
  const existing = all.find((c) => c.slug === slug);   // may be a tombstone
  const mine = held.find((c) => c.slug === slug);
  if (mine) {
    /**
     * RE-TAKING YOUR OWN CLAIM RENEWS IT — AND WIDENS IT.
     *
     * This used to return here whenever `--renew` was absent, DISCARDING the
     * `--paths` parsed eleven lines above. So an agent that started narrow,
     * found the change reached further, and re-ran `take` with the wider set
     * was told "already yours" while the ref kept the old list. `check` then
     * compared against that stale list and answered "none overlapping yours"
     * — not "no overlap", but "no overlap with what you declared when you
     * started", which the message did not say and the exit code did not
     * either.
     *
     * That is how this session edited CLAUDE.md at 09:50 on 2026-09-07 while
     * `claude/test-suite-improvement-bf6yie` held it, having been told at
     * 09:44 that nothing overlapped. Both branches then raised the same
     * constant in the same file, and both comments began "RAISED ONCE".
     *
     * A tool that says nothing is the ordinary failure. One that gives a
     * confident all-clear is the kind this repository writes documents about.
     * Renewing the clock and widening the paths are the same write to the same
     * ref; there was never a reason for one to need a flag the other did not.
     */
    if (mine.agent === agent && !has('--renew') && paths.length === 0) {
      console.log(`already yours — ${slug}, held ${age(mine.ageHours)}. \`--renew\` to reset the clock.`);
      return;
    }
    if (mine.agent === agent && paths.length) {
      const added = paths.filter((p) => !mine.paths.includes(p));
      const dropped = mine.paths.filter((p) => !paths.includes(p));
      if (added.length) console.log(`  widened ${slug}: + ${added.join(', ')}`);
      if (dropped.length) console.log(`  narrowed ${slug}: − ${dropped.join(', ')}`);
    }
    if (mine.agent !== agent) {
      console.error(`DENIED — ${slug} is held by ${mine.agent}, ${age(mine.ageHours)} ago.`);
      if (mine.paths.length) console.error(`  they are writing: ${mine.paths.join(', ')}`);
      console.error(mine.ageHours > STALE_HOURS
        ? `  that claim is stale — \`npm run agents -- steal ${slug}\` if that session is gone.`
        : `  pick another issue. Do not work it in parallel.`);
      process.exit(1);
    }
  }

  const message = [
    `claim ${slug}`, '',
    `agent: ${agent}`,
    `lane: ${lane}`,
    ...paths.map((p) => `path: ${p}`),
    note ? `note: ${note}` : '',
    `taken: ${new Date().toISOString()}`,
  ].filter(Boolean).join('\n');

  const sha = git(['commit-tree', EMPTY_TREE, '-m', message]);
  // No --force. If another agent won the race between the read above and this
  // push, the server rejects it and that agent holds the issue. That rejection
  // is the whole mechanism.
  // A ref that exists — held by me, or tombstoned by whoever finished with it —
  // is taken by compare-and-swap on the sha just read. A ref that does not exist
  // is taken by a plain create, and the server's rejection of the second one is
  // the entire mutex.
  const lease = existing ? [`--force-with-lease=refs/heads/${NS}/${slug}:${existing.sha}`] : [];
  const push = tryGit(['push', ...lease, 'origin', `${sha}:refs/heads/${NS}/${slug}`]);
  if (!push.ok) {
    console.error(`DENIED — ${slug} was claimed by another agent while this one was deciding.`);
    console.error(push.out.split('\n').filter((l) => l.trim()).slice(-3).join('\n'));
    process.exit(1);
  }

  console.log(`held: ${slug} → ${agent} (lane ${lane})`);
  // The landing commit is what closes an issue: GitHub honours a closing keyword
  // in any commit that reaches the default branch, PR or no PR, and this
  // repository fast-forwards straight onto main. A branch may be holding
  // SEVERAL issues by now, and GitHub needs the keyword before each number —
  // `Closes #12, closes #13` closes both, `Closes #12, #13` closes only #12 —
  // so the reminder is the whole line rather than this one issue.
  const line = landingLine([...held.filter((c) => c.agent === agent), { slug }]);
  if (line) {
    console.log(`  land it with: ${line}`);
    console.log('  the janitor retires the claims and deletes the branch behind that.');
  }
  const clash = held.filter((c) => c.slug !== slug && c.paths.some((p) => paths.some((q) => overlaps(p, q))));
  for (const c of clash) console.log(`  ⚠ ${c.agent} declared overlapping paths on ${c.slug}: ${c.paths.join(', ')}`);
  if (lane === 'content') {
    const others = held.filter((c) => c.slug !== slug && c.lane === 'content');
    for (const c of others) {
      console.log(`  ⚠ ${c.agent} is also in the CONTENT lane (${c.slug}). Two content branches that each`);
      console.log('    pass the gates can merge into a main that does not — see docs/PARALLEL.md.');
    }
  }
}

function release() {
  const slug = slugOf(positional[1]);
  const agent = thisAgent();
  const claim = readRefs().find((c) => c.slug === slug);
  if (!claim) return console.log(`nothing to release — ${slug} is not claimed`);
  if (claim.released) return console.log(`${slug} was already released by ${claim.agent}`);
  if (claim.agent !== agent && !has('--force')) {
    die(`${slug} is held by ${claim.agent}, not by you. \`--force\` if you are certain.`);
  }

  const message = [
    `released ${slug}`, '',
    `agent: ${claim.agent}`,
    `lane: ${claim.lane}`,
    `released: ${new Date().toISOString()}`,
    agent === claim.agent ? '' : `note: released by ${agent}`,
  ].filter(Boolean).join('\n');
  const sha = git(['commit-tree', EMPTY_TREE, '-m', message]);
  const push = tryGit([
    'push', `--force-with-lease=refs/heads/${NS}/${slug}:${claim.sha}`,
    'origin', `${sha}:refs/heads/${NS}/${slug}`,
  ]);
  if (!push.ok) die(`could not release ${slug} — it moved while this ran:\n${push.out}`);
  console.log(`released: ${slug}`);

  // Tidying the ref away is a nicety and is not available in every environment.
  // Failing to delete is not failing to release.
  if (has('--prune')) {
    const gone = tryGit(['push', 'origin', '--delete', `refs/heads/${NS}/${slug}`]);
    console.log(gone.ok ? `pruned: claim/${slug}` : `left the tombstone in place — this environment refuses ref deletion`);
  }
}

function steal() {
  const slug = slugOf(positional[1]);
  const claim = readRefs().find((c) => c.slug === slug);
  if (!claim || claim.released || claim.malformed) return console.log(`${slug} is free — take it, no stealing needed`);
  if (claim.ageHours <= STALE_HOURS && !has('--force')) {
    die(`${slug} is held by ${claim.agent} and is only ${age(claim.ageHours)} old — not stale yet (${STALE_HOURS}h).`);
  }
  const agent = thisAgent();
  const message = [
    `claim ${slug}`, '',
    `agent: ${agent}`,
    `lane: ${claim.lane}`,
    ...claim.paths.map((p) => `path: ${p}`),
    `note: stolen from ${claim.agent}, whose claim had stood ${age(claim.ageHours)}`,
    `taken: ${new Date().toISOString()}`,
  ].join('\n');
  const sha = git(['commit-tree', EMPTY_TREE, '-m', message]);
  // Compare-and-swap on the sha we read: a claim renewed one second ago is not stolen.
  const push = tryGit([
    'push', `--force-with-lease=refs/heads/${NS}/${slug}:${claim.sha}`,
    'origin', `${sha}:refs/heads/${NS}/${slug}`,
  ]);
  if (!push.ok) die(`${slug} was renewed or re-taken while this ran — leave it alone.`);
  console.log(`stolen: ${slug} → ${agent} (was ${claim.agent}, ${age(claim.ageHours)} stale)`);
}

function check() {
  const agent = thisAgent();
  const claims = readClaims();
  const mine = claims.filter((c) => c.agent === agent);
  const theirs = claims.filter((c) => c.agent !== agent);

  if (mine.length === 0) console.log(`${agent} holds nothing. \`take <issue>\` before writing anything.`);
  for (const c of mine) {
    console.log(`holding ${c.slug} (lane ${c.lane}, ${age(c.ageHours)})`);
    if (c.ageHours > STALE_HOURS) console.log('  ⚠ your own claim reads stale — `take --renew` so nobody steals it');
  }

  const myPaths = mine.flatMap((c) => c.paths);
  let clashes = 0;
  for (const c of theirs) {
    const shared = c.paths.filter((p) => myPaths.some((q) => overlaps(p, q)));
    if (shared.length) {
      clashes++;
      console.log(`  ⚠ ${c.agent} (${c.slug}) is writing the same paths: ${shared.join(', ')}`);
    }
    if (c.lane === 'content' && mine.some((m) => m.lane === 'content')) {
      clashes++;
      console.log(`  ⚠ ${c.agent} (${c.slug}) is in the CONTENT lane with you — the frequency pool is shared;`);
      console.log('    both branches can pass the gates and the merge still fail. docs/PARALLEL.md.');
    }
  }
  /**
   * AM I WRITING OUTSIDE WHAT I CLAIMED?
   *
   * The overlap check above can only compare what the ref says. If the work
   * has grown past the declared paths — which is normal, and is exactly what
   * happened to the session that wrote this — then a clean answer is clean
   * about the wrong set. `git status` is one command and asks the question
   * directly, so the drift is visible here rather than at a rebase conflict.
   */
  const dirty = tryGit(['status', '--porcelain']).out
    .split('\n')
    // Columns 1-2 are the status, whatever it is; everything after is the path.
    // `slice(3)` ate a character of the filename on the first run of this.
    .map((l) => l.slice(2).trim())
    .filter(Boolean);
  const undeclared = dirty.filter((f) => !myPaths.some((p) => overlaps(p, f)));
  if (undeclared.length) {
    console.log(`  ⚠ modified but not in your claim: ${undeclared.slice(0, 6).join(', ')}` +
      (undeclared.length > 6 ? ` (+${undeclared.length - 6} more)` : ''));
    console.log(`    \`npm run agents -- take <issue> --paths …\` to widen it, so an overlap`);
    console.log(`    with another session can be reported before either of you writes.`);
  }

  const line = landingLine(mine);
  if (line) console.log(`landing commit needs: ${line}`);
  // Say what was compared. "None overlapping yours" over a stale path list is
  // a confident wrong answer, and the count is what makes it checkable.
  if (theirs.length && clashes === 0) {
    console.log(`${theirs.length} other claim(s) open, none overlapping the ` +
      `${myPaths.length} path(s) your claim declares.`);
  }
  process.exit(clashes > 0 ? 1 : 0);
}

const cmd = positional[0] ?? 'list';
({ list, take, release, steal, check }[cmd] ?? (() => die(`unknown command: ${cmd}`)))();
