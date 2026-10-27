#!/usr/bin/env node
/**
 * WHAT EVERY SESSION DOES BEFORE THE AGENT DOES ANYTHING.
 *
 * Orient, set up whatever is stale (`tools/setup.mjs`), warm the content cache.
 * The body lives here and the gate lives in `.claude/hooks/session-start.mjs`,
 * which BOTH agents register — there is no second copy, because the second
 * copy is exactly how they diverged: it was a duplicate of the Claude hook,
 * gated on `CLAUDE_CODE_REMOTE`, a variable Codex never sets, so it exited 0
 * having done nothing, every session, for its whole life. Nothing reported it,
 * because a session hook that does nothing looks precisely like a session hook
 * with nothing to do.
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runNpm } from './portable.mjs';
import { describeSetup, setup } from './setup.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

export function sessionStart(root = join(HERE, '..')) {
  /**
   * Orientation first: unshallow the clone, say what CI last said about
   * `main`, and print who is holding which issue. All three are invisible
   * otherwise, and the shallow clone in particular makes git answer ancestry
   * questions WRONGLY rather than refusing them — see tools/orient.mjs.
   */
  spawnSync(process.execPath, [join(HERE, 'orient.mjs')], { cwd: root, stdio: 'inherit' });

  /**
   * Dependencies and Chromium through `tools/setup.mjs`, the same function
   * `npm run setup -- --browser` calls, so a hook and a person cannot disagree
   * about what "set up" means. It reuses an install whose fingerprint still
   * matches the lockfile, runs `npm ci` only when node_modules is absent (a
   * remote container's image is cached after this hook, and `ci` on a warm
   * tree would throw that cache away), and refreshes anything else with
   * `npm install`.
   *
   * Nothing here fails the session — the same policy as content warming
   * below. What is not ready is printed with the command that fixes it, and
   * a browser that is unavailable leaves headless work untouched.
   */
  const ready = setup(root, { browser: true });
  if (!ready.ok) for (const line of describeSetup(ready)) console.log(line);

  /**
   * Warm the parsed-content cache (packages/content/src/index.ts). The first
   * loadContent() of a session pays ~730ms to parse 74 YAML files and writes
   * the result to node_modules/.cache; every test file after it pays ~225ms.
   *
   * `npm run validate` is the warmer because it already loads the content and
   * takes about a second, so it costs nothing extra and answers a second
   * question on the way past: whether this checkout's content is even valid. A
   * failure here is worth printing and is not worth blocking the session over
   * — the agent will run the same command and get the same list.
   */
  console.log('warming the content cache…');
  if (!runNpm(['run', 'validate'], { cwd: root }).ok) {
    console.log('content does not validate — see the errors above');
  }
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('tools/session-start.mjs')) {
  sessionStart(process.env.CLAUDE_PROJECT_DIR ?? join(HERE, '..'));
}
