import { describe, expect, it } from 'vitest';
import { loadBundle, loadContent } from '@ed/content';
import { assembleBundle, ContentBundleS, CONTENT_LAYOUT, type ContentSources } from '@ed/schema';
import { parse } from 'yaml';

/**
 * The bundle used to be loaded twice by two different implementations —
 * `@ed/content` off the filesystem for tests and the harness, the editor over
 * `import.meta.glob` in the browser — and each carried its own copy of the
 * table saying which collection lived in which file.
 *
 * When they drifted the symptom was not an error. The editor simply simulated a
 * different game: the browser loader never collected `characterTemplates`, so
 * no spouses were minted, every line died out by 1150, and the tree view
 * disagreed with the harness for a whole session before anyone noticed.
 *
 * There is one table now — `CONTENT_LAYOUT` — and both loaders do nothing but
 * hand over files as text. These tests guard the table itself.
 */
describe('the content contract', () => {
  const bundle = loadBundle();

  it('gives every collection the schema declares a place to come from', () => {
    const declared = new Set(Object.keys(ContentBundleS.shape));
    const sourced = new Set(CONTENT_LAYOUT.map((c) => String(c.key)));
    for (const key of declared) {
      expect(sourced.has(key), `no CONTENT_LAYOUT row loads '${key}'`).toBe(true);
    }
    for (const key of sourced) {
      expect(declared.has(key), `CONTENT_LAYOUT loads '${key}', which is not in the bundle`).toBe(true);
    }
  });

  it('populates every collection unless its layout explicitly permits an empty migration state', () => {
    const specs = new Map(CONTENT_LAYOUT.map((spec) => [spec.key, spec]));
    for (const key of Object.keys(ContentBundleS.shape) as (keyof typeof bundle)[]) {
      const value = bundle[key];
      expect(Array.isArray(value), `${String(key)} is not an array`).toBe(true);
      if (!specs.get(key)?.allowEmpty) {
        expect((value as unknown[]).length, `${String(key)} is empty`).toBeGreaterThan(0);
      }
    }
  });

  it('says so out loud when a named file is missing', () => {
    // Silence is this codebase's failure mode. An absent attributes.yaml
    // produces `attributes: []`, which Zod accepts and a run survives — badly,
    // for a thousand years, with nothing to say what went wrong.
    expect(() => assembleBundle({ 'houses.yaml': 'houses: []' }, parse))
      .toThrow(/attributes\.yaml is missing/);
  });

  it('keeps content prose counterparts beside the Original file they answer', () => {
    const files = {
      'attributes.yaml': 'attributes: []',
      'loci.yaml': 'loci: []',
      'traits.yaml': 'traits: []',
      'houses.yaml': 'houses: []',
      'heirlooms.yaml': 'heirlooms: []',
      'spellbooks.yaml': 'spellbooks: []',
      'careers.yaml': 'careers: []',
      'clauses.yaml': 'clauses: []',
      'prologue.yaml': 'prologue: []',
      'endings.yaml': 'endings: []',
      'tales.yaml': 'tales: []',
      'parcels.yaml': 'parcels: []',
      'positions.yaml': 'positions: []',
      'events/one.yaml': [
        'events: []',
        'proseVariants:',
        '  - address: content:events/two.yaml#events[id=scene].body',
        '    plainenglish: A direct version.',
      ].join('\n'),
      'events/two.yaml': 'events: []',
    };

    expect(() => assembleBundle(files, parse))
      .toThrow(/prose variant.*events\/one\.yaml.*Original.*events\/two\.yaml/);
  });

  it('round-trips through its own schema', () => {
    expect(() => ContentBundleS.parse(bundle)).not.toThrow();
  });

  it('resolves ids through the index, and names the ones it cannot', () => {
    const content = loadContent();
    const first = content.events[0]!;
    expect(content.event(first.id)).toBe(first);
    expect(content.event('no_such_event')).toBeUndefined();
    expect(() => content.mustEvent('no_such_event', 'a test'))
      .toThrow(/no event 'no_such_event' \(wanted by a test\)/);
  });
});

/**
 * A validation issue names `event:the_drowning`, and acting on one used to
 * start with a grep for the id — every issue, every time, while the loader
 * that read the file had known the answer and thrown it away.
 */
describe('which file an id came from', () => {
  it('names the file for every id in the shipped content', () => {
    const sources: ContentSources = new Map();
    const bundle = loadBundle(undefined, sources);

    const missing = bundle.events.filter((e) => !sources.has(e.id)).map((e) => e.id);
    expect(missing, 'events the source map cannot place').toEqual([]);
    expect(sources.get('the_drowning')).toBe('events/rites.yaml');
  });

  it('places arcs and ages too, not only events', () => {
    const sources: ContentSources = new Map();
    const bundle = loadBundle(undefined, sources);

    for (const collection of [bundle.arcs, bundle.ages, bundle.clauses]) {
      const first = collection[0];
      expect(first, 'a collection this asserts over is empty').toBeTruthy();
      expect(sources.get(first!.id), `no file for ${first!.id}`).toMatch(/\.yaml$/);
    }
  });

  it('follows the id into whichever file actually holds it', () => {
    // The map must track the FILE, not the collection: `events/` is a
    // directory precisely so authors can split a collection across as many
    // files as they like, and an issue that named the collection would be no
    // better than the id it already names.
    const sources: ContentSources = new Map();
    const bundle = loadBundle(undefined, sources);

    const files = new Set(bundle.events.map((e) => sources.get(e.id)));
    expect(files.size, 'every event resolved to one file — the map is not reading paths')
      .toBeGreaterThan(10);
    for (const file of files) expect(file).toMatch(/^events\/.+\.yaml$/);
  });
});
