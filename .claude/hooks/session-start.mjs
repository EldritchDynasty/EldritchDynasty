#!/usr/bin/env node
/**
 * THE SESSION HOOK BOTH AGENTS RUN.
 *
 * Thin on purpose: the work is in `tools/session-start.mjs`. This file is what
 * `.claude/settings.json` and `.codex/hooks.json` both name — there is no
 * Codex copy, the same arrangement `.agents/skills` uses for the skills, and
 * for the same reason. The copy that used to exist drifted: it carried the
 * gate below unchanged, and the gate below used to be `CLAUDE_CODE_REMOTE`
 * alone.
 *
 * THE GATE ASKS THE QUESTION IT ALWAYS MEANT. `CLAUDE_CODE_REMOTE` is set by
 * one harness. Codex sets no variable of its own, so the Codex copy exited at
 * line one of every session it ever ran in — installing nothing, warming
 * nothing, orienting nothing, and printing nothing to say so. What the gate is
 * actually for is "a checkout that has not been set up". That readiness test
 * lives in `tools/setup.mjs`, the module `npm run setup` runs: dependencies
 * whose fingerprint still matches package-lock.json — not merely present —
 * plus the exact Chromium executable the installed Playwright needs, so
 * neither a stale install nor a restored package cache passes for ready.
 *
 * A local checkout that is already installed still skips it, which is the
 * whole point: a hook that runs on every session start there is a tax with no
 * payer.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sessionReady } from '../../tools/setup.mjs';
import { sessionStart } from '../../tools/session-start.mjs';

const ROOT = process.env.CLAUDE_PROJECT_DIR
  ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..');

if (process.env.CLAUDE_CODE_REMOTE !== 'true' && sessionReady(ROOT)) {
  process.exit(0);
}

sessionStart(ROOT);
