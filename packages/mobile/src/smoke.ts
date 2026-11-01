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
    // A smoke witness must identify one run: get() silently accepts the first
    // of several different seeds or year counts in an externally opened URL.
    if (url.searchParams.getAll('seed').length > 1
      || url.searchParams.getAll('years').length > 1) return null;
    const rawSeed = url.searchParams.get('seed');
    const rawYears = url.searchParams.get('years');
    // Number('') and Number(' ') are zero, and Number('0x10') accepts hex.
    // Smoke links identify reproducible runs: supplied values must be decimal.
    if ((rawSeed !== null && !/^-?[0-9]+$/.test(rawSeed))
      || (rawYears !== null && !/^[0-9]+$/.test(rawYears))) return null;
    const seed = Number(rawSeed ?? '1042');
    const years = Number(rawYears ?? '40');
    // A diagnostic link must not request more simulation than a full 500-year Long Line.
    if (!Number.isSafeInteger(seed) || !Number.isSafeInteger(years) || years < 0 || years > 500) return null;
    return { kind, seed, years };
  }
  if (kind === 'resume' || kind === 'export') return { kind };
  if (kind === 'import') {
    // Do not choose an arbitrary first filename from conflicting parameters.
    if (url.searchParams.getAll('path').length !== 1) return null;
    const path = url.searchParams.get('path');
    // The Debug-only smoke URL comes from an external appUrlOpen event.
    // Only a Documents basename may reach Filesystem.readFile; never let an
    // absolute/traversal path escape the simulator's interchange directory.
    if (!path || path !== path.trim() || path === '.' || path === '..'
      || /[\\/:\x00-\x1f\x7f]/u.test(path)) return null;
    return { kind, path };
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

/**
 * A client callback may reject its Promise or throw before returning one.
 * Both failures need terminal smoke evidence; otherwise the native bridge
 * leaves the simulator staring at the earlier "received" checkpoint.
 * Keep failure normalisation here so the host never needs to call .then()
 * on a callback whose execution has already thrown.
 */
export async function settleSmokeCommand(
  command: SmokeCommand,
  listener: (command: SmokeCommand) => Promise<SmokeResult>,
): Promise<Awaited<ReturnType<typeof smokeEvidence>> | {
  command: SmokeCommand['kind'];
  ok: false;
  error: string;
}> {
  try {
    return await smokeEvidence(command, await listener(command));
  } catch (error: unknown) {
    return {
      command: command.kind,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
