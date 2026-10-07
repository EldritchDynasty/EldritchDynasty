import type { SmokeCommand, SmokeResult } from '../../client/src/platform.js';

const SMOKE_PROTOCOL = 'eldritchdynasty-smoke:';

export function parseSmokeCommand(raw: string): SmokeCommand | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== SMOKE_PROTOCOL) return null;

  const kind = url.hostname;
  if (kind === 'save') {
    const seed = Number(url.searchParams.get('seed') ?? '1042');
    const years = Number(url.searchParams.get('years') ?? '40');
    if (!Number.isSafeInteger(seed) || !Number.isSafeInteger(years) || years < 0) return null;
    return { kind, seed, years };
  }
  if (kind === 'resume' || kind === 'export') return { kind };
  if (kind === 'import') {
    const path = url.searchParams.get('path');
    return path ? { kind, path } : null;
  }
  return null;
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalJson(item)]),
  );
}

async function sha256(value: unknown): Promise<string> {
  // Native storage is JSON, so compare semantic JSON rather than insertion
  // order. Zod/load-save reconstruction is allowed to rebuild objects in a
  // different key order without changing the saved world. `savedAt` is
  // deliberately refreshed by every GameSession.save(); it is transport
  // metadata, not simulation state.
  const serializable = canonicalJson(value);
  if (serializable !== null && typeof serializable === 'object' && !Array.isArray(serializable)) {
    delete (serializable as Record<string, unknown>).savedAt;
  }
  const bytes = new TextEncoder().encode(JSON.stringify(serializable));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function smokeEvidence(command: SmokeCommand, result: SmokeResult): Promise<{
  command: SmokeCommand['kind'];
  ok: true;
  sha256: string;
  year?: number;
  path?: string;
}> {
  return {
    command: command.kind,
    ok: true,
    sha256: await sha256(result.snapshot),
    ...(result.year === undefined ? {} : { year: result.year }),
    ...(result.path === undefined ? {} : { path: result.path }),
  };
}
