import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * THE COMMANDS THIS REPOSITORY TELLS AN AGENT TO RUN, AND THE ONES IT ALLOWS.
 *
 * `docs/PARALLEL.md` tells every agent to claim before reading code, re-check
 * before the long run, and release when the work lands — three or four calls to
 * `npm run agents` per session. It was not in the twenty-five allowed commands,
 * and neither was any form of `git commit` or `git push`, which the landing
 * protocol requires. `git fetch` was allowed: a session could read the remote
 * and not land on it.
 *
 * A permission prompt is a turn, which is the cheap cost. The expensive one is
 * WHERE it lands — a prompt on `agents -- take` arrives at the exact moment an
 * agent is deciding whether claiming is worth the trouble, and an unclaimed
 * issue is invisible to every other session. The lock is only as good as its
 * uptake.
 *
 * So the rule is the same one `agents.test.ts` states about the mutex itself:
 * a list nobody has watched fail is indistinguishable from no list.
 */

const REPO = join(import.meta.dirname, '../../../..');
const SETTINGS = join(REPO, '.claude/settings.json');

type Hook = { type: string; command: string; args?: string[] };
type Settings = {
  permissions: { allow: string[] };
  hooks?: Record<string, { matcher?: string; hooks: Hook[] }[]>;
};
const settings = JSON.parse(readFileSync(SETTINGS, 'utf8')) as Settings;

/**
 * Every `npm run <script>` named in docs/COMMANDS.md's canonical command block.
 *
 * The block is the one place this repository states what to run, so it is the
 * one place worth deriving from — the same argument `land.test.ts` makes about
 * deriving the landing's steps from the workflow rather than restating them.
 */
const documented = (): string[] => {
  const text = readFileSync(join(REPO, 'docs/COMMANDS.md'), 'utf8');
  const block = /```bash\n([\s\S]*?)```/.exec(text)?.[1] ?? '';
  const names = new Set<string>();
  for (const [, name] of block.matchAll(/^npm (?:run )?([\w:-]+)/gm)) names.add(name!);
  names.delete('install');
  return [...names].sort();
};

/**
 * Commands deliberately left out, with the reason. `dev`, `play` and `shell`
 * are long-running servers rather than checks — a session that starts one is
 * doing something a prompt should stop and ask about. `build:shell` packages a
 * Windows installer (issue #67): it downloads Electron and NSIS binaries,
 * writes several hundred megabytes to `packages/shell/release`, and is never
 * part of an ordinary check — the same shape of thing `build` and
 * `build:client` already are, for smaller reasons.
 */
const EXCLUDED = new Set(['dev', 'play', 'shell', 'shell:preview', 'build', 'build:client', 'build:shell', 'test:watch']);

/** Does any allow entry cover `npm run <name> …`? Prefix rules end in `:*`. */
const allows = (name: string) => {
  const forms = [`npm run ${name}`, name === 'test' ? 'npm test' : `npm run ${name}`];
  return settings.permissions.allow.some((rule) => {
    const inner = /^Bash\((.*)\)$/.exec(rule)?.[1];
    if (!inner) return false;
    const prefix = inner.endsWith(':*') ? inner.slice(0, -2) : inner;
    return forms.some((f) => (inner.endsWith(':*') ? f.startsWith(prefix) : f === inner));
  });
};

describe('every documented command is allowed or deliberately excluded', () => {
  it('finds a command block to check, so this cannot pass by finding nothing', () => {
    expect(documented().length).toBeGreaterThan(5);
  });

  it('leaves no documented command needing a permission prompt', () => {
    const unaccounted = documented().filter((n) => !EXCLUDED.has(n) && !allows(n));
    expect(
      unaccounted,
      `docs/COMMANDS.md tells an agent to run ${unaccounted.join(', ')}, and .claude/settings.json ` +
      `does not allow it. Add it to permissions.allow, or to EXCLUDED here with the reason. ` +
      `A prompt on a documented command is a turn spent, and on \`npm run agents\` it is a ` +
      `turn spent at the moment the agent is deciding whether to claim at all.`,
    ).toEqual([]);
  });

  /**
   * The list it must reject: a command in the block that is in neither list.
   * Without this, the rule above passes forever on a block nobody grows.
   */
  it('catches a documented command that is in neither list', () => {
    // Not `gate:aurochs`: `Bash(npm run gate:*)` covers that, correctly, and
    // the first draft of this test used it and passed for the wrong reason.
    // The case that matters is a name no prefix rule reaches.
    const invented = 'exhume';
    expect(EXCLUDED.has(invented)).toBe(false);
    expect(allows(invented), 'a command nobody allowed read as allowed').toBe(false);
  });

  it('allows the mutex, which the whole parallel protocol rests on', () => {
    expect(allows('agents')).toBe(true);
  });

  it('allows the write half of git, not only the read half', () => {
    const inner = settings.permissions.allow
      .map((r) => /^Bash\((.*)\)$/.exec(r)?.[1] ?? '')
      .filter((c) => c.startsWith('git '));
    for (const verb of ['git add', 'git commit', 'git push']) {
      expect(
        inner.some((c) => c.startsWith(verb)),
        `${verb} is not allowed, so a session can read the remote and not land on it`,
      ).toBe(true);
    }
  });
});

/**
 * THE GUARDS THAT FIRE AT THE MOMENT OF THE MISTAKE.
 *
 * Every invariant here is enforced by a test, and a test is a minute away at
 * best and half an hour at worst. Two rules in AGENTS.md's "Do not" list are
 * one-line checks on the path being written, and both were prose only.
 *
 * These assertions run the hook the way the harness runs it — a JSON payload on
 * stdin — because that is the only thing that proves it is wired correctly. A
 * hook with a malformed matcher, a bad path or the wrong output shape does not
 * error. It silently does nothing, which is this codebase's signature failure.
 */
describe('the hooks, run the way the harness runs them', () => {
  const GUARD = join(REPO, '.claude/hooks/guard-edit.mjs');

  /**
   * `process.execPath`, not `'node'` and certainly not `'bash'`. This suite
   * runs on a Windows runner as well as a Linux one, and the only interpreter
   * guaranteed to be there is the one already running these tests.
   */
  const fire = (script: string, payload: unknown) =>
    execFileSync(process.execPath, [script], { input: JSON.stringify(payload), encoding: 'utf8' }).trim();

  const edit = (file: string, extra: Record<string, string> = {}) => ({
    tool_name: 'Edit',
    tool_input: { file_path: join(REPO, file), ...extra },
  });

  /**
   * EXEC FORM IS THE THING BEING ASSERTED, NOT JUST THE FILE'S EXISTENCE.
   *
   * A hook with a single `command` string is run through a shell, and which
   * shell depends on the platform — sh -c on Linux and macOS, Git Bash on
   * Windows, PowerShell where Git Bash is absent. `$CLAUDE_PROJECT_DIR`
   * expands in the first two and is a literal in the third, so a shell-form
   * hook is a hook that works on some of the platforms AGENTS.md calls
   * first-class. Naming `command` and `args` separately removes the shell from
   * the question entirely.
   */
  const scriptOf = (h: Hook) =>
    (h.args?.[0] ?? h.command).replace('${CLAUDE_PROJECT_DIR}/', '').replace('$CLAUDE_PROJECT_DIR/', '');

  it('is registered on Write and Edit for both events', () => {
    for (const event of ['PreToolUse', 'PostToolUse']) {
      const entries = settings.hooks?.[event] ?? [];
      const matching = entries.filter((e) => e.matcher === 'Write|Edit');
      expect(matching.length, `${event} has no Write|Edit hook`).toBeGreaterThan(0);
      for (const e of matching) {
        for (const h of e.hooks) {
          const path = scriptOf(h);
          expect(existsSync(join(REPO, path)), `${event} names ${path}, which is not there`).toBe(true);
        }
      }
    }
  });

  it('spawns every hook without a shell, which is what makes it run on Windows', () => {
    for (const entries of Object.values(settings.hooks ?? {})) {
      for (const e of entries) {
        for (const h of e.hooks) {
          expect(h.command, 'a hook must name an executable, not a shell command line')
            .toBe('node');
          expect(h.args?.length, `${h.command} has no args, so it is shell form`).toBe(1);
          expect(scriptOf(h)).toMatch(/\.mjs$/);
        }
      }
    }
  });

  it('refuses an edit to loci.yaml, and names the command that fixes it', () => {
    const out = JSON.parse(fire(GUARD, edit('packages/content/loci.yaml')));
    expect(out.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain('npm run gen:loci');
  });

  it('refuses an edit to VOCABULARY.md, and names the command that fixes it', () => {
    const out = JSON.parse(fire(GUARD, edit('docs/VOCABULARY.md')));
    expect(out.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain('npm run gen:docs');
  });

  /**
   * The other half, and the one that keeps the guard usable: a hook that
   * blocks correct work gets switched off within a week. Everything that is
   * not one of the two generated files passes silently.
   */
  it('says nothing about a file it has no business refusing', () => {
    expect(fire(GUARD, edit('packages/core/src/session.ts'))).toBe('');
    expect(fire(GUARD, edit('packages/content/events/rites.yaml'))).toBe('');
  });

  it('warns rather than refuses when a field is added to WorldState', () => {
    const out = fire(GUARD, edit('packages/core/src/world.ts', { new_string: '  muster: MusterState;' }));
    const parsed = JSON.parse(out);
    expect(parsed.systemMessage).toContain('save.ts');
    // A WARNING. The legitimate two-step edit exists — add the field, then add
    // it to the save format — and a refusal would make it impossible.
    expect(parsed.hookSpecificOutput?.permissionDecision).toBeUndefined();
  });

  it('says nothing when WorldState is edited without adding a field', () => {
    expect(fire(GUARD, edit('packages/core/src/world.ts', { new_string: '  // a reworded comment' }))).toBe('');
  });
});
