import { parse, stringify } from 'yaml';
import { indexContent, type Content, type ContentBundle } from '@ed/schema';
import { assembleYamlBundle } from '../../../content/src/yaml.js';

/**
 * Browser-side content loader. Its whole job is to hand the files over as text
 * — what a bundle IS lives in `@ed/schema`'s CONTENT_LAYOUT, which the node
 * loader in `@ed/content` reads from too.
 *
 * The two loaders used to carry a copy of that table each. When they drifted
 * nothing threw: the editor simply simulated a different game to the harness.
 */
const files = import.meta.glob('../../../content/**/*.yaml', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** Editor path (relative to packages/content) -> raw text. */
export const rawFiles: Record<string, string> = Object.fromEntries(
  Object.entries(files).map(([k, v]) => [k.replace(/^.*\/content\//, ''), v]),
);

const userContentPaths = new Set<string>();

export function loadBundle(): ContentBundle {
  return assembleYamlBundle(rawFiles);
}

/** The bundle with its indexes built. What the simulation actually wants. */
export function loadContent(): Content {
  return indexContent(loadBundle());
}

/** Which file did this event come from? Needed to write it back. */
export function fileOfEvent(eventId: string): string | undefined {
  for (const [path, text] of Object.entries(rawFiles)) {
    if (!path.startsWith('events/')) continue;
    const doc = parse(text) as { events?: { id: string }[] } | null;
    if (doc?.events?.some((e) => e.id === eventId)) return path;
  }
  return undefined;
}

/**
 * Two transports, one API. In the browser the dev server takes the write
 * through a Vite middleware; inside the Electron shell it goes over IPC to the
 * main process, which does its own path validation. The editor above this
 * function does not know or care which it is running in.
 */
interface ShellBridge {
  isShell: true;
  mode?: 'game' | 'mod-editor';
  writeContent(path: string, text: string): Promise<{ ok: boolean; error?: string }>;
  readContent(path: string): Promise<{ ok: boolean; text?: string; error?: string }>;
  readUserContent(): Promise<{ ok: boolean; files?: Record<string, string>; error?: string }>;
}

export function shell(): ShellBridge | undefined {
  return (globalThis as { ed?: ShellBridge }).ed;
}

export async function hydrateUserContent(): Promise<void> {
  const bridge = shell();
  if (bridge?.mode !== 'mod-editor') return;

  const res = await bridge.readUserContent();
  if (!res.ok) throw new Error(res.error ?? 'the host refused user content');
  for (const [path, text] of Object.entries(res.files ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
    if (path in rawFiles) {
      throw new Error(`user content '${path}' shadows a shipped file; v1 supports new files and ids only`);
    }
    rawFiles[path] = text;
    userContentPaths.add(path);
  }
}

export function isWritableContentPath(path: string): boolean {
  const bridge = shell();
  return bridge?.mode !== 'mod-editor' || userContentPaths.has(path);
}

export async function writeFile(path: string, text: string): Promise<{ ok: boolean; error?: string }> {
  const bridge = shell();
  if (bridge?.mode === 'mod-editor' && !userContentPaths.has(path)) {
    return { ok: false, error: `'${path}' is shipped content and is read-only in Mod Editor` };
  }
  if (bridge) return bridge.writeContent(path, text);

  const res = await fetch('/api/content', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path, text }),
  });
  return res.json();
}

/**
 * Read a file's CURRENT text off disk — not the copy `rawFiles` loaded at
 * startup. This is what "detect uncommitted changes" (issue #21) is checking
 * against: has something outside the editor touched this file since.
 */
export async function readFile(path: string): Promise<{ ok: boolean; text?: string; error?: string }> {
  const bridge = shell();
  if (bridge?.mode === 'mod-editor' && !userContentPaths.has(path)) {
    const text = rawFiles[path];
    return text === undefined ? { ok: false, error: 'no such shipped content file' } : { ok: true, text };
  }
  if (bridge) return bridge.readContent(path);

  const res = await fetch(`/api/content?path=${encodeURIComponent(path)}`);
  return res.json();
}

export function toYaml(value: unknown): string {
  return stringify(value, { lineWidth: 78, defaultStringType: 'PLAIN', defaultKeyType: 'PLAIN' });
}
