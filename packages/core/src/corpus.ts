import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { CampaignId, Content, ContentBundle } from '@ed/schema';
import type { SimCtx } from './world.js';
import { bootstrap } from './sim.js';
import { runYears } from './year/step.js';
import { loadGame, saveGame } from './save.js';

/**
 * ── THE RUN CORPUS ────────────────────────────────────────────────────────
 *
 * Forty-three slow suites play whole millennia and every one of them plays
 * its own, from scratch, throwing away everything the others wanted.
 * `record.slow.test.ts` alone plays 240 runs of 458 years — 110,000 simulated
 * years — to make TWO assertions, and at 451 seconds it is the floor the
 * whole suite waits behind, because vitest parallelises per file.
 *
 * Measured on a four-core container:
 *
 *   one 458-year run                    2,207 ms
 *   saveGame + loadGame round trip        111 ms      20x cheaper
 *   the resulting save                    725 KB      97 KB gzipped
 *
 * So a played run is stored and read back instead of replayed. `loadGame`
 * returns a full `SimCtx`, which is what the suites already hold, so a
 * suite's `run(seed)` becomes a lookup and everything downstream of it —
 * `familySnapshot(ctx)`, `ctx.world.decisionLog` — is unchanged.
 *
 * ── WHY THIS IS NOT A GOLDEN FILE ─────────────────────────────────────────
 *
 * Nothing here is checked in and nothing is asserted against a stored value.
 * The corpus is a CACHE of a pure function: `(content, code, seed, years)`
 * fully determines the run (invariant 8) — with the campaign, which decides the
 * Ledger's size, the endings, and what `campaignProgress` means in a given
 * year — so the key is a hash of all of them
 * and a stale entry is unreachable rather than merely unlikely. Change a byte
 * of content or of `core`, and every key changes with it. That is the same
 * bargain `@ed/content`'s parse cache already makes, deliberately mirrored,
 * down to the escape hatch.
 *
 * THE CODE HALF OF THE KEY IS THE PART THAT IS EASY TO GET WRONG. Hashing
 * only the content would leave the corpus authoritative across a simulation
 * change — the suite would keep asserting against runs the current code no
 * longer produces, which is precisely the failure this repository is named
 * for, installed as infrastructure.
 *
 * `ED_RUN_CORPUS=off` bypasses it entirely and plays everything.
 */

const ROOT = join(import.meta.dirname, '../../..');
const CACHE_DIR = join(ROOT, 'node_modules', '.cache', 'ed-runs');

/**
 * Everything that can change what a run does, hashed once per process.
 *
 * `core` and `schema` sources, not `content` — the content half arrives
 * separately, because callers already hold the bundle and hashing it here
 * would mean re-reading the whole directory.
 */
let codeKey: string | undefined;

function hashSources(dir: string, h: ReturnType<typeof createHash>): void {
  for (const entry of readdirSync(dir).sort()) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    /**
     * `tools/` DRIVES runs; it does not define them. Gates, the harness, the
     * digest and this file's own warmer all live there, and nothing on the
     * simulation path imports from any of them — only `index.ts` re-exports
     * `testFamilies`, which is a re-export and not a dependency.
     *
     * Including it cost a whole corpus the first time this file was written:
     * adding `corpus-warm.ts` changed the key and threw away 241 runs that
     * were still perfectly valid. `corpus.slow.test.ts` asserts the
     * assumption this rests on, because an exclusion that quietly stops being
     * true would make the corpus authoritative across a simulation change.
     */
    // `basename`, not `endsWith('/src')`: on Windows the separator is a
    // backslash, the test was never true, and `tools/` went into the key — so
    // the same sources hashed differently on the two platforms and editing a
    // gate threw away a Windows corpus that was still valid.
    if (basename(dir) === 'src' && entry === 'tools') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) { hashSources(path, h); continue; }
    // Tests cannot change what a run does. Excluding them means editing a
    // suite does not throw away a corpus that is still perfectly valid,
    // which is the difference between a cache that helps and one that does
    // not survive the working day.
    if (!entry.endsWith('.ts') || entry.endsWith('.test.ts')) continue;
    h.update(path.slice(ROOT.length));
    h.update('\0');
    h.update(readFileSync(path));
    h.update('\0');
  }
}

export function simulationKey(): string {
  if (codeKey) return codeKey;
  const h = createHash('sha1');
  hashSources(join(ROOT, 'packages/core/src'), h);
  hashSources(join(ROOT, 'packages/schema/src'), h);
  codeKey = h.digest('hex').slice(0, 16);
  return codeKey;
}

/** The content half. Cheap: the bundle is already in memory. */
function contentKey(source: ContentBundle | Content): string {
  const bundle = 'bundle' in source ? (source as Content).bundle : source;
  return createHash('sha1').update(JSON.stringify(bundle)).digest('hex').slice(0, 16);
}

let contentMemo: { source: unknown; key: string } | undefined;

function keyFor(
  source: ContentBundle | Content,
  seed: number,
  years: number,
  from: number,
  campaign: CampaignId,
): string {
  if (!contentMemo || contentMemo.source !== source) {
    contentMemo = { source, key: contentKey(source) };
  }
  return `${simulationKey()}-${contentMemo.key}-${campaign}-${from}-${years}-${seed}`;
}

/** Play it, for real. The only place in this file that advances a clock. */
function play(
  source: ContentBundle | Content,
  seed: number,
  years: number,
  from: number,
  campaign: CampaignId,
): SimCtx {
  const ctx = bootstrap(source, seed, from, campaign);
  runYears(ctx, years);
  return ctx;
}

export interface CorpusStats {
  hits: number;
  misses: number;
}

const stats: CorpusStats = { hits: 0, misses: 0 };

/** What the corpus has done this process. For the integrity suite to assert on. */
export function corpusStats(): CorpusStats {
  return { ...stats };
}

/**
 * A run of `years` from `from`, seeded `seed` — played, or read back from a
 * run played earlier under identical content and identical simulation code.
 *
 * Never throws on a cache problem. A corrupt or unreadable entry is a slow
 * test, not a failed one, so every filesystem step falls back to playing.
 *
 * `campaign` defaults to the Long Line. A Short Line is NOT the first 300
 * years of one: its Ledger holds three clauses, it ends on `settled`, and
 * every `campaignProgress` condition reads a different fraction in the same
 * year. `gate:replay` read truncated Long runs as Short ones until the
 * campaign became part of the key.
 */
export function playedRun(
  source: ContentBundle | Content,
  seed: number,
  years: number,
  from = 1042,
  campaign: CampaignId = 'long',
): SimCtx {
  if (process.env.ED_RUN_CORPUS === 'off') {
    stats.misses += 1;
    return play(source, seed, years, from, campaign);
  }

  const file = join(CACHE_DIR, `${keyFor(source, seed, years, from, campaign)}.json.gz`);

  if (existsSync(file)) {
    try {
      const raw = JSON.parse(gunzipSync(readFileSync(file)).toString('utf8')) as unknown;
      const ctx = loadGame(raw, source);
      stats.hits += 1;
      return ctx;
    } catch {
      // Fall through and play it. A bad entry is overwritten below.
    }
  }

  stats.misses += 1;
  const ctx = play(source, seed, years, from, campaign);
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(file, gzipSync(Buffer.from(JSON.stringify(saveGame(ctx)), 'utf8')));
  } catch {
    // A corpus that cannot be written is a slow suite, not a broken one.
  }
  return ctx;
}

/**
 * Play a run WITHOUT consulting or writing the corpus.
 *
 * The integrity suite needs a second opinion that the corpus cannot have
 * influenced; so does anything measuring what playing actually costs.
 */
export function playedFresh(
  source: ContentBundle | Content,
  seed: number,
  years: number,
  from = 1042,
  campaign: CampaignId = 'long',
): SimCtx {
  return play(source, seed, years, from, campaign);
}
