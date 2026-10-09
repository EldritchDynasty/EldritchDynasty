import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadBundle, loadContent } from '@ed/content';
import { PurposeS, assembleBundle, bundleWithUserContent, indexContent, type EventTemplate, type Purpose } from '@ed/schema';
import { parse } from 'yaml';
import { bootstrap, digestOf, loadGame, runYears, saveGame } from '@ed/core';
import { CONTENT_MODULE, contentFiles, readContentDocs, readProseDocs, readStartupDocs } from '../../build/content-plugin.js';
import { installPlainEnglishCatalogue, loadBundle as clientBundle } from './content.js';
import type { Platform, SmokeCommand, SmokeResult } from '../platform.js';
import { createGame } from './game.js';

const CLIENT = join(import.meta.dirname, '../..');
const CONTENT = join(CLIENT, '../content');

/**
 * THE PARSE MOVED, AND THE BUNDLE DID NOT (issue #109).
 *
 * The client used to run `yaml.parse` over 1.6 MB at module scope, before
 * first paint — 328 ms on a warm container, seconds in an Android WebView,
 * to redo work whose answer cannot change. It happens on the build machine
 * now, and `assembleBundle` gets `JSON.parse` for a parser instead.
 *
 * That is a cheap change to get almost right and a silent one to get wrong:
 * a build-time loader that drops one file, or reads an empty document as a
 * missing collection, produces a bundle that is merely SMALLER. Nothing
 * throws. The game plays, the tests pass, and some rite has no scenes in it.
 * So the check is the whole bundle against the one the node loader builds
 * off the same directory — not a sample of it, and not a count.
 */
describe('the content is parsed on the build machine', () => {
  it('assembles the full Original gameplay bundle before optional prose loads', () => {
    const built = assembleBundle(readStartupDocs(CONTENT), JSON.parse);
    const live = clientBundle();
    expect({ ...built, proseVariants: [] }).toEqual({ ...live, proseVariants: [] });
    expect(built.proseVariants).toEqual([]);
  });

  it('keeps first-frame bytes constant across a 5,000-word translation batch', () => {
    const root = mkdtempSync(join(tmpdir(), 'ed-prose-chunk-'));
    const eventsDir = join(root, 'events');
    mkdirSync(eventsDir);
    const file = join(eventsDir, 'sample.yaml');
    const original = [
      'events:',
      '  - id: sample',
      '    body: The archive stayed closed for many years.',
    ].join('\n');
    try {
      writeFileSync(file, original);
      const before = readStartupDocs(root);
      const bytesBefore = Buffer.byteLength(JSON.stringify(before));

      writeFileSync(file, [
        original,
        'proseVariants:',
        '  - address: "content:events/sample.yaml#events[id=sample].body"',
        '    of: "0000000000000000"',
        '    plainenglish: >-',
        '      ' + Array(5000).fill('translated').join(' '),
      ].join('\n'));
      const after = readStartupDocs(root);
      expect(after).toEqual(before);
      expect(Buffer.byteLength(JSON.stringify(after))).toBe(bytesBefore);
      expect(JSON.stringify(readProseDocs(root)).length).toBeGreaterThan(50_000);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('restores all reviewed variants from a separate optional chunk', async () => {
    const full = assembleBundle(readContentDocs(CONTENT), JSON.parse);
    const packed = readProseDocs(CONTENT);
    expect(Object.keys(packed).length).toBeGreaterThan(0);
    const eager = readStartupDocs(CONTENT);
    expect((JSON.parse(eager['events/guardian.yaml']!) as { proseVariants?: unknown }).proseVariants)
      .toBeUndefined();

    const catalogue = await installPlainEnglishCatalogue();
    expect(catalogue).toEqual(full.proseVariants);
    expect(clientBundle().proseVariants).toEqual(full.proseVariants);
  });

  it('reads every file in the content directory', () => {
    const docs = readContentDocs(CONTENT);
    expect(contentFiles(CONTENT).length).toBeGreaterThan(70);
    expect(Object.keys(docs).length).toBe(contentFiles(CONTENT).length);
    // Both source shapes `CONTENT_LAYOUT` knows about: a named file, and a
    // directory whose files are concatenated. Keyed relative to the content
    // root and posix-style, which is what `assembleBundle` matches against.
    expect(docs).toHaveProperty('attributes.yaml');
    expect(Object.keys(docs).some((k) => k.startsWith('events/'))).toBe(true);
  });

  it('keeps an empty document rather than dropping its file', () => {
    // `assembleBundle` reads `doc?.[key]` and skips a null. Dropping the key
    // instead would make an empty file and a MISSING file the same thing, and
    // a missing named file is a broken checkout that has to keep throwing.
    expect(JSON.parse(JSON.stringify(null))).toBeNull();
    expect(() => assembleBundle({ 'attributes.yaml': 'null' }, JSON.parse)).toThrow();
  });
});

describe('precompiled Plain English catalogue packing (#708)', () => {
  it('packs redundant file prefixes and restores the exact authored counterpart', () => {
    const docs = readContentDocs(CONTENT);
    const file = 'events/guardian.yaml';
    const authored = parse(readFileSync(join(CONTENT, file), 'utf8')) as {
      proseVariants: { address: string; of?: string; plainenglish: string }[];
    };
    const packed = JSON.parse(docs[file]!) as { proseVariants: unknown[][] };
    const first = authored.proseVariants[0]!;

    expect(packed.proseVariants[0]).toEqual([
      first.address.slice(`content:${file}#`.length),
      first.of,
      first.plainenglish,
    ]);
    const reassembled = assembleBundle(docs, JSON.parse);
    expect(reassembled.proseVariants.find((row) => row.address === first.address)).toEqual(first);
    // The optional-chunk parity test above covers all restored rows.
  });

  it('keeps the original 1.6MB budget by removing repeated metadata, not prose', () => {
    const packedDocs = readContentDocs(CONTENT);
    const authoredDocs = Object.fromEntries(Object.keys(packedDocs).map((file) => [
      file,
      JSON.stringify(parse(readFileSync(join(CONTENT, file), 'utf8')) ?? null),
    ]));
    const savings = Buffer.byteLength(JSON.stringify(authoredDocs))
      - Buffer.byteLength(JSON.stringify(packedDocs));
    // The Eight Days migration needs at least 3,108 bytes of headroom.
    expect(savings).toBeGreaterThan(3_107);
    // Only Original content is needed for first paint. Reviewed translations
    // live in a separate chunk and cannot consume the first-frame budget.
    expect(Buffer.byteLength(JSON.stringify(readStartupDocs(CONTENT)))).toBeLessThan(1_600_000);
  });

  it('still rejects variants claiming a different source file', () => {
    const docs = readContentDocs(CONTENT);
    const file = 'events/guardian.yaml';
    const authored = parse(readFileSync(join(CONTENT, file), 'utf8')) as {
      events: unknown[];
      proseVariants: { address: string; of?: string; plainenglish: string }[];
    };
    const wrong = {
      ...authored.proseVariants[0]!,
      address: authored.proseVariants[0]!.address.replace(
        `content:${file}#`, 'content:events/not-guardian.yaml#',
      ),
    };
    const malformed = { ...docs, [file]: JSON.stringify({ ...authored, proseVariants: [wrong] }) };
    expect(() => assembleBundle(malformed, JSON.parse)).toThrow(/but its Original is in/);
  });
});

describe('YAML stays off the ordinary startup path', () => {
  const pkg = JSON.parse(readFileSync(join(CLIENT, 'package.json'), 'utf8')) as {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  };

  /**
   * The proof the change actually landed. `yaml` shipped to the client purely
   * to do work that has no reason to happen at runtime; leaving it in the
   * `dependencies` block means something still reaches for it.
   */
  it('keeps the YAML parser out of the eager startup path', () => {
    expect(Object.keys(pkg.dependencies)).not.toContain('yaml');
    expect(Object.keys(pkg.devDependencies)).toContain('yaml');
    const loader = readFileSync(join(CLIENT, 'src/lib/content.ts'), 'utf8');
    const empty = loader.indexOf('Object.keys(files).length === 0');
    const yaml = loader.indexOf("import('yaml')");
    const validation = loader.indexOf("import('@ed/schema')");
    expect(empty).toBeGreaterThan(-1);
    expect(yaml).toBeGreaterThan(empty);
    expect(validation).toBeGreaterThan(empty);
    expect(loader).not.toMatch(/^import .* from ['"]yaml['"]/m);
  });

  /**
   * A BUDGET, SO THIS CANNOT CREEP BACK ONE CONTENT DROP AT A TIME.
   *
   * Structural rather than a stopwatch, for the reason `lanes.test.ts` gives:
   * a timing assertion fails on a noisy CI machine and gets muted. What
   * actually grows is the content, one authored file at a time, and the
   * emitted JSON is exactly what the player's first frame waits behind. So
   * the budget is over bytes, which are the same on every machine.
   */
  it('the precompiled content stays inside its cold-start budget', () => {
    const CEILING = 1_600_000;
    const size = Buffer.byteLength(JSON.stringify(readStartupDocs(CONTENT)));
    expect(
      size,
      `the precompiled content is ${(size / 1024).toFixed(0)} kB, over the ` +
      `${(CEILING / 1024).toFixed(0)} kB budget. Every byte of it is parsed ` +
      'before the player sees anything. Raising the ceiling is a decision ' +
      'about how long a phone spends on a blank screen, not a formality.',
    ).toBeLessThan(CEILING);
  });

  it('the loader reads the precompiled module', () => {
    const loader = readFileSync(join(CLIENT, 'src/lib/content.ts'), 'utf8');
    expect(loader).toContain(CONTENT_MODULE);
    expect(loader).toContain("import('virtual:ed-prose-variants')");
    expect(loader).not.toMatch(/^import .* from ['"]virtual:ed-prose-variants['"]/m);
    // The glob this replaced. It would work — and would put the parse back on
    // the critical path with nothing anywhere reporting it.
    expect(loader).not.toContain('import.meta.glob');
  });
});


describe('desktop user content composition', () => {
  const shipped = readContentDocs(CONTENT);

  function leastUsedPurposeTriple(events: EventTemplate[]): Purpose[] {
    const choices = PurposeS.options;
    const counts = new Map<string, number>();
    for (const event of events) {
      const key = [...event.purposes].sort().join('+');
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    let best: Purpose[] | undefined;
    let bestCount = Number.POSITIVE_INFINITY;
    for (let a = 0; a < choices.length; a++) {
      for (let b = a + 1; b < choices.length; b++) {
        for (let d = b + 1; d < choices.length; d++) {
          const triple = [choices[a]!, choices[b]!, choices[d]!] as Purpose[];
          const n = counts.get([...triple].sort().join('+')) ?? 0;
          if (n < bestCount) {
            best = triple;
            bestCount = n;
          }
        }
      }
    }
    if (!best) throw new Error('the purpose vocabulary has fewer than three entries');
    return best;
  }

  function modFixture() {
    const baseline = assembleBundle(shipped, JSON.parse);
    const event = structuredClone(baseline.events[0]!);
    event.id = 'mod_fixture_event';
    event.title = 'A Page From Outside the Box';
    event.tier = 'family';
    event.frequency = 'common';
    event.weight = 1_000_000;
    event.repeatable = true;
    event.cooldownYears = 0;
    event.tags = ['mod_fixture'];
    event.purposes = leastUsedPurposeTriple(baseline.events);
    event.slots = {};
    delete event.conditions;
    event.checks = [];
    event.reads = [];
    event.body = 'A page from the user-content folder enters the family chronicle.';
    delete event.absentBody;
    event.interaction = {
      kind: 'narration',
      outcomes: [{
        id: 'seen',
        weight: 100,
        text: 'The added page was seen.',
        tags: [],
        effects: [],
      }],
    };
    delete event.record;
    delete event.rumour;
    event.accounts = [];
    delete event.arc;
    delete event.ages;

    const path = 'events/mod-fixture.yaml';
    const combined = bundleWithUserContent(
      shipped,
      { [path]: JSON.stringify({ events: [event] }) },
      parse,
    );
    return { baseline, combined, path, event };
  }

  it('leaves the shipped bundle unchanged when an added file contributes nothing', () => {
    const baseline = assembleBundle(shipped, JSON.parse);
    const combined = bundleWithUserContent(
      shipped,
      { 'events/empty-mod.yaml': 'events: []\n' },
      parse,
    );
    expect(combined).toEqual(baseline);
  });

  it('rejects a shipped-file shadow before it can replace content', () => {
    expect(() => bundleWithUserContent(
      shipped,
      { 'attributes.yaml': 'attributes: []\n' },
      parse,
    )).toThrow(/shadows a shipped file/);
  });

  it('rejects duplicate ids through the same named rule as CI', () => {
    const baseline = assembleBundle(shipped, JSON.parse);
    const duplicate = structuredClone(baseline.events[0]!);
    expect(() => bundleWithUserContent(
      shipped,
      { 'events/duplicate.yaml': JSON.stringify({ events: [duplicate] }) },
      parse,
    )).toThrow(/ERROR  \[ids\/unique\].*event:/);
  });


  it('keeps an empty user-content directory simulation-identical to the shipped game', () => {
    const baseline = assembleBundle(shipped, JSON.parse);
    const combined = bundleWithUserContent(shipped, {}, parse);

    expect(combined).toEqual(baseline);

    const ordinary = bootstrap(indexContent(baseline), 7501, 1042);
    const emptyMod = bootstrap(indexContent(combined), 7501, 1042);
    runYears(ordinary, 20);
    runYears(emptyMod, 20);
    expect(digestOf(emptyMod)).toBe(digestOf(ordinary));
  });

  it('loads a user event through the documented composition path and actually fires it', () => {
    const { combined, event } = modFixture();
    const ctx = bootstrap(indexContent(combined), 7502, 1042);

    runYears(ctx, 20);

    expect(ctx.world.frequency.templateFires[event.id] ?? 0).toBeGreaterThan(0);
    expect(ctx.content.sourceOf(event.id)).toBe('events/mod-fixture.yaml');
  });

  it('refuses a modded save after its referenced user event is removed, naming the id and former file', () => {
    const { baseline, combined, event, path } = modFixture();
    const ctx = bootstrap(indexContent(combined), 7503, 1042);
    runYears(ctx, 20);
    expect(ctx.world.frequency.templateFires[event.id] ?? 0).toBeGreaterThan(0);

    const saved = saveGame(ctx);
    expect(saved.contentSources).toContainEqual([event.id, path]);

    const shippedOnly = indexContent(baseline);
    let message = '';
    try {
      loadGame(saved, shippedOnly);
    } catch (error) {
      message = String(error);
    }
    expect(message).toContain(event.id);
    expect(message).toContain(path);
    expect(message).toMatch(/missing content/);
  });
});

/**
 * THE EXPORT COMMAND STARTS IN A NEW PROCESS.
 *
 * The iOS runtime smoke deliberately terminates and relaunches the app before
 * every command. Save/resume/import each cause this process to write an
 * autosave, but export does not: its entire job is to prove that the PREVIOUS
 * process left one durable enough to read and carry across the interchange
 * boundary. Waiting for saveStatus === "saved" here therefore waits for an
 * operation that export never starts.
 */
describe('native cold-process smoke export', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('exports the durable autosave without requiring a write in this process', async () => {
    vi.useFakeTimers();

    const persisted = { format: 28, year: 1082, savedAt: 'prior-process', world: { marker: 7 } };
    let smoke: ((command: SmokeCommand) => Promise<SmokeResult>) | undefined;
    const writeSave = vi.fn(async () => undefined);
    const writeSmokeInterchange = vi.fn(async () => 'eldritch-smoke-export.json');

    const platform: Platform = {
      async listSaves() { return []; },
      async readSave(slot) { return slot === 'autosave' ? persisted : null; },
      writeSave,
      async deleteSave() {},
      async readLibrary() { return null; },
      async writeLibrary() {},
      async readUserContent() { return {}; },
      async exportSave() {},
      async importSave() { return null; },
      onPause() { return () => undefined; },
      onBack() { return () => undefined; },
      onSmokeCommand(listener) {
        smoke = listener;
        return () => undefined;
      },
      writeSmokeInterchange,
    };

    createGame(loadContent(), platform);
    expect(smoke).toBeDefined();

    const resultPromise = smoke!({ kind: 'export' });
    await vi.runAllTimersAsync();

    await expect(resultPromise).resolves.toEqual({
      snapshot: persisted,
      year: 1082,
      path: 'eldritch-smoke-export.json',
    });
    expect(writeSave).not.toHaveBeenCalled();
    expect(writeSmokeInterchange).toHaveBeenCalledWith(persisted);
  });
});
