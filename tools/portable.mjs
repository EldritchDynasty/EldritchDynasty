/**
 * THE FOUR THINGS THAT ARE DIFFERENT ON WINDOWS, IN ONE FILE.
 *
 * AGENTS.md says this repository is supported on Windows and Linux, under
 * Claude Code and Codex, and that all four combinations are first-class. That
 * was prose for months while the session hook, the orientation step, the two
 * edit guards and the janitor were all `#!/usr/bin/env bash` — and two of them
 * shelled out to `jq`, which is not installed on a Windows box, a Linux box or
 * a CI runner unless somebody put it there.
 *
 * A bash script does not fail loudly on Windows. A SessionStart hook that
 * cannot run prints nothing an agent sees, so the clone stays shallow, every
 * ancestry question answers wrongly, and the claims other sessions hold are
 * invisible. That is this codebase's signature failure mode wearing a shell
 * script, and `portability.test.ts` is the gate that keeps it fixed.
 *
 * Everything here is one of four facts:
 *
 *   1. npm is a `.cmd` shim on Windows and cannot be spawned without a shell.
 *   2. A symlink needs a privilege on Windows that a junction does not.
 *   3. Paths arrive with backslashes, a drive letter of either case, and
 *      compare case-insensitively.
 *   4. stdin is how a hook is handed its payload, and `jq` is not available
 *      to read it.
 */
import { spawnSync } from 'node:child_process';
import { posix, win32 } from 'node:path';

/**
 * NODE 24 DOES NOT SPAWN WINDOWS `.cmd` SHIMS WITHOUT A SHELL.
 *
 * `npm` on Windows is `npm.cmd`, and a `.cmd` is not an executable — it is a
 * script the command processor interprets. Spawning it without `shell: true`
 * fails with ENOENT, and spawning it WITH a shell hands every argument to the
 * command processor to re-split, which breaks the moment one of them contains
 * a space.
 *
 * npm gives every lifecycle script the path to its own JavaScript CLI in
 * `npm_execpath`, so the way through is to run that CLI with the Node binary
 * already running this process. Argument boundaries survive, and there is no
 * shell in the middle.
 *
 * Lives here rather than in `land.mjs` because the landing is no longer the
 * only thing that spawns npm: the session hook installs dependencies and warms
 * the content cache, and it was calling a bare `npm` that does not exist under
 * that name on half the platforms this repository claims to support.
 */
export const npmInvocation = (
  platform = process.platform,
  node = process.execPath,
  cli = process.env.npm_execpath ?? process.env.NPM_CLI_JS,
) => platform === 'win32' && cli
  ? { command: node, prefix: [cli] }
  : { command: 'npm', prefix: [] };

/**
 * A SYMLINK IS A PRIVILEGE ON WINDOWS AND A JUNCTION IS NOT.
 *
 * Creating a directory symlink on Windows needs either Developer Mode or an
 * elevated process; a junction needs neither and behaves the same way for
 * everything this repository does with one. `symlinkSync(target, path, type)`
 * takes the type as its third argument and ignores it everywhere else.
 */
export const nodeModulesLinkType = (platform = process.platform) =>
  platform === 'win32' ? 'junction' : 'dir';

/**
 * Run an npm script the way `npmInvocation` says to, inheriting the terminal.
 * Returns whether it succeeded rather than throwing: every caller here is a
 * hook or an orientation step, and neither is allowed to fail a session.
 */
export function runNpm(args, { cwd = process.cwd(), stdio = 'inherit' } = {}) {
  const npm = npmInvocation();
  const r = spawnSync(npm.command, [...npm.prefix, ...args], { cwd, stdio, encoding: 'utf8' });
  return { ok: r.status === 0, status: r.status, signal: r.signal,
    ...(r.error ? { error: r.error.message } : {}), out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/** Is this executable on PATH? `command -v`, without a shell to run it in. */
export function onPath(cmd) {
  try {
    const r = spawnSync(cmd, ['--version'], { stdio: 'ignore' });
    return !r.error && r.status !== null;
  } catch {
    return false;
  }
}

/**
 * A REPOSITORY PATH, IN THE ONE SPELLING EVERYTHING ELSE COMPARES AGAINST.
 *
 * The edit guards match on `packages/content/loci.yaml`. What a hook is handed
 * on Windows is `C:\Users\somebody\repos\EldritchDynasty\packages\content\loci.yaml`,
 * and on Linux the same path with the other slash. Three things differ and all
 * three are silent: the separator, the case of the drive letter, and the case
 * of every segment after it.
 *
 * So this is the only place a path is turned into something to compare: POSIX
 * separators, relative to the repository root, and — on Windows only — folded
 * to lower case, because that is the platform where two spellings name one
 * file. Folding case on Linux would let a guard refuse a file it has no
 * business refusing, which is the failure that gets a guard switched off.
 *
 * Returns null when the path is outside the repository, which every caller
 * treats as "not mine to judge".
 *
 * IT RESOLVES WITH THE NAMED PLATFORM'S RULES RATHER THAN THE HOST'S, and
 * that is the difference between a platform branch and a platform branch
 * anybody can check. `path.resolve` on Linux does not know that `C:\repo` is
 * absolute, so it makes one up relative to the cwd and the fold silently
 * returns `c:/repo/packages/...` — a wrong answer, in a function whose entire
 * job is to produce the string two guards compare against, on the platform
 * where no test could reach it. AGENTS.md asks for exactly this: platform-only
 * behaviour must be guarded and covered by a test, and a test on a Linux
 * runner can only cover it if the platform is an argument all the way down.
 */
export function repoRelative(path, root, platform = process.platform) {
  if (typeof path !== 'string' || !path) return null;
  const on = platform === 'win32' ? win32 : posix;
  const slash = (p) => p.replace(/\\/g, '/');
  const abs = foldPath(slash(on.resolve(root, path)), platform);
  const base = foldPath(slash(on.resolve(root)), platform);
  if (abs === base) return '';
  if (!abs.startsWith(`${base}/`)) return null;
  return abs.slice(base.length + 1);
}

/**
 * THE ONE DEFINITION OF "THESE TWO PATHS NAME ONE FILE".
 *
 * Windows compares paths case-insensitively and Linux does not, so
 * `repoRelative` folds case on Windows only. The consequence caught everyone,
 * including the author: a path that comes BACK from it is folded, so anything
 * matched AGAINST it has to be folded the same way. `docs/VOCABULARY.md`
 * arrived as `docs/vocabulary.md` and missed a lookup table keyed by the
 * spelling in the repository — so on Windows the guard allowed the edit to
 * VOCABULARY.md that it denied on Linux, which is a guard that works on one
 * platform and lies on the other.
 *
 * Exported, and taking the platform as an argument, so both sides of every
 * comparison can use it and a Linux runner can test the Windows rule.
 */
export const foldPath = (p, platform = process.platform) =>
  (platform === 'win32' ? p.toLowerCase() : p);

/**
 * THE PATHS A TOOL CALL TOUCHES, UNDER EITHER AGENT.
 *
 * Both guards used to read `tool_input.file_path` and nothing else. That is
 * the CLAUDE payload. Codex sends a different shape for the same act: the tool
 * is `apply_patch`, and the files it writes are named inside a unified-diff
 * envelope on `tool_input.command`, as `*** Update File: <path>` lines. There
 * is no `file_path` key in it at all.
 *
 * So under Codex the lookup returned nothing, the guard hit its "no path, not
 * mine to judge" line, and every rule it enforces passed silently on the exact
 * edit it exists to refuse. A guard that cannot read the payload is
 * indistinguishable from no guard, and neither one ever prints anything — this
 * repository's signature failure, inside its own enforcement.
 *
 * Returns EVERY path the call touches, repo-relative, because one Codex patch
 * writes several files and the generated one need not be first. A rename is an
 * edit of its destination, so `*** Move to:` counts. Anything unparseable
 * yields nothing, which every caller treats as a call to allow.
 */
export function hookPaths(payload, root, platform = process.platform) {
  const input = payload?.tool_input ?? {};
  const direct = [input.file_path, payload?.tool_response?.filePath];

  // The apply_patch envelope. Codex spells the verb three ways for a write and
  // a fourth for the destination half of a rename.
  const command = typeof input.command === 'string' ? input.command : '';
  const patched = [...command.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)].map((m) => m[1])
    .concat([...command.matchAll(/^\*\*\* Move to: (.+)$/gm)].map((m) => m[1]));

  const seen = new Set();
  for (const raw of [...direct, ...patched]) {
    if (typeof raw !== 'string' || !raw.trim()) continue;
    const rel = repoRelative(raw.trim().replace(/^\.\//, ''), root, platform);
    if (rel) seen.add(rel);
  }
  return [...seen];
}

/**
 * THE HOOK PAYLOAD, WITHOUT `jq`.
 *
 * Claude Code and Codex both hand a hook its tool call as JSON on stdin. The
 * shell versions of these hooks piped that into `jq`, which is not installed
 * on a Windows box and is not installed on a CI runner either — and a hook
 * whose only dependency is missing does not error in a way anybody sees. It
 * prints to a stream nothing reads and the edit goes through.
 *
 * Never throws. A guard that fails on its own bug is worse than the bug it
 * guards against, so an unreadable payload comes back as `{}` and every
 * caller's lookup misses and allows the call.
 */
export async function readHookPayload(stream = process.stdin) {
  try {
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const text = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8').trim();
    if (!text) return {};
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** One JSON object on stdout, which is the whole hook protocol. */
export const emit = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
