import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
// One implementation of the write guard, shared with the Electron main process.
import { resolveExistingContentPath } from '../content/tools/content-path.mjs';
import { coreMessageEntries } from '../core/src/tools/core-message-audit.js';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const REPO = r('../..');
const CONTENT = join(REPO, 'packages/content');
const CORE_SOURCE = join(REPO, 'packages/core/src');

/**
 * Resolve the Node-only TypeScript AST extractor while Vite is building, never
 * in the editor renderer. The shipped module contains JSON data, not a parser.
 */
function coreProseCatalogue() {
  const moduleId = 'virtual:ed-core-prose';
  const resolvedId = '\0' + moduleId;

  function sourceFiles(folder: string): string[] {
    return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')
        ? [path] : [];
    });
  }

  return {
    name: 'ed-core-prose-catalogue',
    resolveId(id: string) {
      if (id === moduleId) return resolvedId;
    },
    load(id: string) {
      if (id !== resolvedId) return;
      const seen = new Set<string>();
      const entries = sourceFiles(CORE_SOURCE).sort().flatMap((path) => {
        const file = path.slice(CORE_SOURCE.length + 1).replaceAll('\\', '/');
        return coreMessageEntries(readFileSync(path, 'utf8')).map((entry) => {
          if (seen.has(entry.address)) throw new Error('duplicate stable core msg key: ' + entry.address);
          seen.add(entry.address);
          return {
            address: entry.address,
            file: 'packages/core/src/' + file,
            text: entry.text,
            interpolations: entry.interpolations,
          };
        });
      });
      return 'export default ' + JSON.stringify(entries.sort((a, b) =>
        a.address.localeCompare(b.address))) + ';';
    },
  };
}

/**
 * Dev-only content bridge. The editor reads YAML through import.meta.glob and
 * writes it back through this endpoint, which keeps the round-trip on real
 * files and in git — the tool writes clean files and gets out of the way.
 *
 * The Electron build replaces this with IPC to the main process; the client
 * API surface is identical so nothing above it changes.
 */
function contentBridge() {
  return {
    name: 'ed-content-bridge',
    configureServer(server: any) {
      server.middlewares.use('/api/content', (req: any, res: any) => {
        // GET: read a file's current text off disk — the shell's IPC bridge has
        // always had this half (`ed:read-content`); the dev transport did not,
        // which is what made "detect uncommitted changes" impossible in dev.
        if (req.method === 'GET') {
          try {
            const url = new URL(req.url, 'http://localhost');
            const target = resolveExistingContentPath(CONTENT, url.searchParams.get('path') ?? '');
            const text = readFileSync(target, 'utf8');
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: true, text }));
          } catch (e) {
            res.statusCode = 400;
            res.end(JSON.stringify({ ok: false, error: String(e) }));
          }
          return;
        }

        if (req.method !== 'PUT') {
          res.statusCode = 405;
          return res.end('PUT only');
        }
        let body = '';
        req.on('data', (c: Buffer) => (body += c));
        req.on('end', () => {
          try {
            const { path, text } = JSON.parse(body) as { path: string; text: string };
            const target = resolveExistingContentPath(CONTENT, path);
            // Read-before-write: never overwrite something we have not seen.
            readFileSync(target, 'utf8');
            writeFileSync(target, text, 'utf8');
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: true, path }));
          } catch (e) {
            res.statusCode = 400;
            res.end(JSON.stringify({ ok: false, error: String(e) }));
          }
        });
      });
    },
  };
}

/**
 * A Content Security Policy on the BUILT page only.
 *
 * The build is what the Electron shell loads off disk, and a renderer with no
 * policy is a renderer that will happily run anything a content file talks it
 * into. Dev is left alone because Vite's HMR needs eval and the dev server is
 * not the thing we ship.
 */
function buildTimeCsp() {
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",   // Vue injects <style>, templates use style=""
    "img-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
  ].join('; ');

  return {
    name: 'ed-csp',
    apply: 'build' as const,
    transformIndexHtml(html: string) {
      return html.replace(
        '<head>',
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`,
      );
    },
  };
}

export default defineConfig({
  // Relative asset paths, so the built editor loads from file:// inside the
  // Electron shell as well as from a web server.
  base: './',
  plugins: [vue(), contentBridge(), coreProseCatalogue(), buildTimeCsp()],
  resolve: {
    alias: {
      '@ed/schema': r('../schema/src/index.ts'),
      '@ed/core': r('../core/src/index.ts'),
    },
  },
  server: {
    fs: { allow: [REPO] },
  },
});
