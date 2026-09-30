import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * THE OTHER AGENT'S HALF OF THE HARNESS.
 *
 * AGENTS.md says this repository is supported under both Claude Code and
 * Codex and that all four platform/agent combinations are first-class. That
 * was prose, and everything it claimed about the Codex half was false:
 *
 *  - `.codex/hooks.json` named `C:\Users\GGPC\Documents\repos\...`. An
 *    absolute path on one developer's machine registers nothing on any other,
 *    and nothing at all on Linux.
 *  - The script it named was a COPY of the Claude one, gated on
 *    `CLAUDE_CODE_REMOTE = true`. Codex sets no environment variables of its
 *    own, so that copy exited at line one of every session it ran in — no
 *    install, no cache warm, and no orientation, which is the step that
 *    unshallows the clone and is the difference between git answering
 *    ancestry questions and git answering them WRONGLY.
 *  - `PreToolUse` and `PostToolUse` were not registered for Codex at all, so
 *    the generated-file guard — the enforcement half of two rules in the "Do
 *    not" list — did not exist there.
 *  - And the "Do not" list itself did not reach Codex either: see the budget
 *    test at the bottom.
 *
 * Every one of those is silent. A session under Codex looked exactly like a
 * session with a working harness, which is this codebase's signature failure
 * mode showing up inside its own enforcement.
 */

const REPO = join(import.meta.dirname, '../../../..');
type Hook = { command: string; args?: string[] };
const CLAUDE = JSON.parse(readFileSync(join(REPO, '.claude/settings.json'), 'utf8')) as {
  hooks: Record<string, { matcher?: string; hooks: Hook[] }[]>;
};
const CODEX = JSON.parse(readFileSync(join(REPO, '.codex/hooks.json'), 'utf8')) as {
  hooks: Record<string, { matcher?: string; hooks: Hook[] }[]>;
};

/**
 * Every command registered for an agent, as one string per hook.
 *
 * Claude Code's registration is EXEC FORM — `command: "node"` with the script
 * in `args` — which is what keeps a shell out of it on Windows, where shell
 * form would reach `sh -c`, Git Bash or PowerShell depending on what is
 * installed. Codex's is a command line. Joining the two shapes lets every
 * assertion below read one string and stay true of both.
 */
const commands = (cfg: typeof CODEX) =>
  Object.values(cfg.hooks).flatMap((entries) =>
    entries.flatMap((e) => e.hooks.map((h) => [h.command, ...(h.args ?? [])].join(' '))));

/** The script a command runs, as a repo-relative path. */
const scriptOf = (command: string) => /(\.claude\/hooks\/[\w.-]+\.mjs)/.exec(command)?.[1];

describe('the Codex registration points at something that exists', () => {
  it('registers the same three events Claude does', () => {
    for (const event of ['SessionStart', 'PreToolUse', 'PostToolUse']) {
      expect(CODEX.hooks[event], `Codex has no ${event} hook, so that rule is Claude-only`).toBeTruthy();
    }
  });

  /**
   * The bug, stated as a rule. Not "does this path exist on this machine" —
   * that would pass on the machine the path was written on. Any absolute path
   * is wrong here, in both directions: a Windows drive letter and a POSIX
   * root are each correct on exactly one checkout.
   */
  it('names no absolute path, on either platform', () => {
    for (const c of [...commands(CODEX), ...commands(CLAUDE)]) {
      expect(c, `an absolute path registers a hook on one machine only: ${c}`).not.toMatch(/[A-Za-z]:\\/);
      expect(c, `an absolute path registers a hook on one machine only: ${c}`).not.toMatch(/(^|["\s])\/(home|Users|root)\//);
    }
  });

  it('runs scripts that are actually in the tree', () => {
    for (const c of commands(CODEX)) {
      const script = scriptOf(c);
      expect(script, `no .claude/hooks script in: ${c}`).toBeTruthy();
      expect(existsSync(join(REPO, script!)), `${script} is registered and is not there`).toBe(true);
    }
  });

  /**
   * ONE SCRIPT, TWO REGISTRATIONS. `.codex/hooks.json` carried a copy once and
   * the copy drifted immediately — it was missing the orientation step the
   * Claude one had gained. The skills already work this way (`.agents/skills`
   * are pointers, not copies); the hooks now do too.
   */
  it('runs the same scripts Claude runs, rather than copies of them', () => {
    const claude = new Set(commands(CLAUDE).map(scriptOf));
    const codex = new Set(commands(CODEX).map(scriptOf));
    expect([...codex].sort()).toEqual([...claude].sort());
    expect(existsSync(join(REPO, '.codex/hooks')), '.codex/hooks is a second copy of .claude/hooks').toBe(false);
  });

  /**
   * `apply_patch` is the tool_name Codex sends for every file write. A matcher
   * of `Write|Edit` alone is an alias list that a future Codex need not keep.
   */
  it('matches the tool Codex actually reports for a file write', () => {
    for (const event of ['PreToolUse', 'PostToolUse']) {
      const matchers = CODEX.hooks[event]!.map((e) => e.matcher ?? '');
      expect(matchers.some((m) => m.includes('apply_patch')), `${event} does not match apply_patch`).toBe(true);
    }
  });
});

/**
 * THE GUARD, FIRED WITH THE PAYLOAD CODEX ACTUALLY SENDS.
 *
 * `settings.test.ts` fires it with Claude's shape. This is the other shape,
 * and it is the one that was passing on every edit it exists to refuse: Codex
 * sends no `tool_input.file_path`, so `jq -r '.tool_input.file_path // empty'`
 * came back empty and the guard exited 0 before reaching its first rule.
 */
describe('the guard reads a Codex apply_patch payload', () => {
  const GUARD = join(REPO, '.claude/hooks/guard-edit.mjs');

  const fire = (payload: unknown) =>
    execFileSync(process.execPath, [GUARD], { input: JSON.stringify(payload), encoding: 'utf8' }).trim();

  /** What Codex puts on stdin: snake_case, and the paths live in the diff. */
  const applyPatch = (...files: string[]) => ({
    hook_event_name: 'PreToolUse',
    tool_name: 'apply_patch',
    cwd: REPO,
    tool_input: {
      command: ['*** Begin Patch', ...files.map((f) => `*** Update File: ${f}`), '*** End Patch'].join('\n'),
    },
  });

  it('refuses a patch that edits loci.yaml, and names the command that fixes it', () => {
    const out = JSON.parse(fire(applyPatch('packages/content/loci.yaml')));
    expect(out.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain('npm run gen:loci');
  });

  it('refuses a patch that edits VOCABULARY.md', () => {
    const out = JSON.parse(fire(applyPatch('docs/VOCABULARY.md')));
    expect(out.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain('npm run gen:docs');
  });

  /**
   * The case a per-file guard misses and a per-patch guard does not: one
   * apply_patch touches many files, and the generated one is not first.
   */
  it('refuses a multi-file patch where only one file is generated', () => {
    const out = JSON.parse(fire(applyPatch('packages/core/src/world.ts', 'packages/content/loci.yaml')));
    expect(out.hookSpecificOutput.permissionDecision).toBe('deny');
  });

  it('refuses a RENAME onto a generated file, which is an edit of it', () => {
    const out = JSON.parse(
      fire({
        hook_event_name: 'PreToolUse',
        tool_name: 'apply_patch',
        tool_input: {
          command: '*** Begin Patch\n*** Move to: docs/VOCABULARY.md\n*** End Patch',
        },
      }),
    );
    expect(out.hookSpecificOutput.permissionDecision).toBe('deny');
  });

  /** The other half: a guard that blocks correct work gets switched off. */
  it('says nothing about a patch it has no business refusing', () => {
    expect(fire(applyPatch('packages/core/src/session.ts'))).toBe('');
    expect(fire(applyPatch('packages/content/events/rites.yaml'))).toBe('');
  });

  /**
   * Codex rejects a bare `permissionDecision: "allow"` as an unsupported hook
   * response — an allowed call must produce EMPTY stdout. Asserted because the
   * obvious "be explicit" refactor of `deny()` would break Codex only.
   */
  it('emits nothing at all when it allows, rather than an explicit allow', () => {
    expect(fire(applyPatch('packages/core/src/session.ts'))).not.toContain('allow');
  });
});

/**
 * THE SESSION-START GATE, WHICH HAS TO MEAN SOMETHING UNDER BOTH AGENTS.
 */
describe('the session-start hook is not gated on a Claude-only variable', () => {
  const launcher = readFileSync(join(REPO, '.claude/hooks/session-start.mjs'), 'utf8');
  const body = readFileSync(join(REPO, 'tools/session-start.mjs'), 'utf8');

  it('does not exit on CLAUDE_CODE_REMOTE alone', () => {
    // The shape that was there: a bare early return on the variable. Under
    // Codex, which sets no variables, that is an unconditional exit. The gate
    // must ask something Codex can answer too — whether this checkout is set
    // up — so the variable may only appear alongside that question.
    expect(
      /CLAUDE_CODE_REMOTE !== 'true'\)\s*(?:\{\s*)?process\.exit/.test(launcher),
      'the hook exits at line one of every Codex session',
    ).toBe(false);
    expect(launcher, 'the launcher does not consult the shared readiness gate')
      .toContain('sessionReady(ROOT)');
    expect(body, 'the shared gate asks nothing a fresh Codex checkout can answer')
      .toContain('node_modules');
  });

  it('still orients the session, which is where the clone is unshallowed', () => {
    expect(launcher).toContain('sessionStart');
    expect(body).toContain('orient.mjs');
  });
});

/**
 * THE DOC BUDGET — THE ONE THAT COST THE MOST AND SHOWED THE LEAST.
 *
 * Codex concatenates the AGENTS.md files from the repository root down to the
 * working directory and stops once the total reaches `project_doc_max_bytes`.
 * The default is 32 KiB and the truncation is SILENT — no warning in the TUI,
 * nothing in the log (openai/codex#7138).
 *
 * The root file is over 51 KiB. At the default, Codex read about 63% of it and
 * stopped mid-section, which put "Working style" (the standing authorisation
 * for `npm run land`), the whole of "Do not", and "Known gaps" past the cut —
 * and because the root file alone overran the budget, every per-package
 * AGENTS.md reached Codex at ZERO bytes.
 *
 * `.codex/config.toml` raises the budget. This asserts the file still fits in
 * what it raised it to, because the file grows and the failure says nothing.
 */
describe('AGENTS.md fits in the budget Codex is configured with', () => {
  const toml = readFileSync(join(REPO, '.codex/config.toml'), 'utf8');
  const budget = Number(/^\s*project_doc_max_bytes\s*=\s*(\d+)/m.exec(toml)?.[1] ?? 0);

  const sizeOf = (p: string) => statSync(join(REPO, p)).size;
  const packages = ['content', 'core', 'schema', 'editor', 'client', 'mobile', 'shell']
    .map((p) => `packages/${p}/AGENTS.md`)
    .filter((p) => existsSync(join(REPO, p)));

  it('sets a budget at all, so this cannot pass by finding nothing', () => {
    expect(budget).toBeGreaterThan(32 * 1024);
  });

  it('leaves room for the root file and the package file read with it', () => {
    const root = sizeOf('AGENTS.md');
    const worst = Math.max(...packages.map(sizeOf));
    const total = root + worst;
    expect(
      total,
      `AGENTS.md (${root}B) plus the largest package AGENTS.md (${worst}B) is ${total}B against a ` +
      `project_doc_max_bytes of ${budget}B. Codex will truncate, silently, from the END — so the ` +
      `LAST sections of AGENTS.md are the ones that stop reaching it, and the package file may not ` +
      `reach it at all. Either cut the root file or raise the budget in .codex/config.toml.`,
    ).toBeLessThanOrEqual(budget);
  });

  /**
   * Every package file must fit beside the root one, not merely the largest.
   * Stated separately so the failure names the package.
   */
  it('leaves room for every package file individually', () => {
    const root = sizeOf('AGENTS.md');
    for (const p of packages) {
      expect(root + sizeOf(p), `${p} does not fit beside the root AGENTS.md`).toBeLessThanOrEqual(budget);
    }
  });
});

/**
 * THE CODEX SKILL LAUNCHERS ARE POINTERS, NOT COPIES.
 *
 * AGENTS.md calls them "thin launchers" and README calls them "no duplicated
 * manuals". Both were false: `.agents/` carried byte-identical copies of the
 * 46 KB prose manual and the 68 KB story manual, referenced by nothing — the
 * launchers link to the canonical `.claude/` path. 114 KB of specification
 * with two copies and one reader is the exact arrangement AGENTS.md says
 * drifts, and it is why the data-model and event-editor briefs are gone.
 */
describe('the Codex launchers duplicate nothing', () => {
  const list = (dir: string) =>
    execFileSync('git', ['ls-files', dir], { cwd: REPO, encoding: 'utf8' }).trim().split('\n').filter(Boolean);

  it('has a launcher for every canonical skill', () => {
    const skills = (dir: string) =>
      new Set(list(dir).map((f) => f.split('/')[2]).filter(Boolean));
    expect([...skills('.agents/skills')].sort()).toEqual([...skills('.claude/skills')].sort());
  });

  it('keeps every launcher small enough to be a launcher', () => {
    for (const f of list('.agents/skills')) {
      if (f.endsWith('LICENSE.txt')) continue; // a licence travels with what it licenses
      expect(statSync(join(REPO, f)).size, `${f} is too big to be a pointer — is it a copy?`).toBeLessThan(2048);
    }
  });

  it('points at the canonical file rather than restating it', () => {
    for (const f of list('.agents/skills').filter((f) => f.endsWith('SKILL.md'))) {
      expect(readFileSync(join(REPO, f), 'utf8'), `${f} does not link to .claude/skills`).toContain('.claude/skills/');
    }
  });
});
