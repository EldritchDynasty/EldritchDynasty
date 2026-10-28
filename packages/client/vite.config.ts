import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { edContent } from './build/content-plugin.js';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const REPO = r('../..');
const CONTENT = r('../content');

/**
 * The commit this build came from, for the reading log (#1945): a playtest
 * artifact that cannot name its build cannot be compared with another one.
 * `ED_BUILD_SHA` wins, for builds made outside a checkout. The platform is
 * declared by whoever builds (`ED_BUILD_PLATFORM`), because the client itself
 * never names its host.
 */
function buildSha(): string {
  if (process.env.ED_BUILD_SHA) return process.env.ED_BUILD_SHA;
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

/**
 * The game, served. Deliberately thinner than the editor's config: the editor
 * needs a middleware that writes YAML back to disk, and the client must never
 * be able to. It reads the content directory and nothing else.
 */
export default defineConfig({
  // Relative asset paths, so a build loads from file:// as well as from a
  // server — the same reason the editor's build does.
  base: './',
  // `edContent` parses the content directory on this machine and serves it as
  // one JSON module, so the player's cold start does not pay for YAML (#109).
  plugins: [vue(), edContent(CONTENT)],
  define: {
    __ED_BUILD__: JSON.stringify({ sha: buildSha(), platform: process.env.ED_BUILD_PLATFORM ?? 'unrecorded' }),
  },
  resolve: {
    alias: {
      '@ed/schema': r('../schema/src/index.ts'),
      '@ed/core': r('../core/src/index.ts'),
    },
  },
  server: {
    // The editor holds 5173. Running both at once is the normal way to work on
    // content: author on one port, play it on the other.
    port: 5174,
    fs: { allow: [REPO] },
  },
});
