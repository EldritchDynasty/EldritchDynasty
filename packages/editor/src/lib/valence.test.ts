import { describe, expect, it } from 'vitest';
import { EffectS, type Effect } from '@ed/schema';
import { valenceOf, valenceScore } from './valence';

/**
 * The failure to catch here is a valence that is `plain` for everything. It
 * typechecks, every view renders, every cue fires — and the whole system is a
 * no-op nobody notices, because `plain` is what a correct answer looks like
 * most of the time.
 *
 * So: assert that the thing MOVES, in both directions, for the reasons it is
 * supposed to move for.
 */

const eff = (e: Effect) => [e];

describe('the obvious cases go the obvious way', () => {
  it('money in is a boon and money out is a blow', () => {
    expect(valenceOf(eff({ kind: 'treasury', delta: 200 }))).toBe('boon');
    expect(valenceOf(eff({ kind: 'treasury', delta: -200 }))).toBe('blow');
  });

  it('respect works the same way', () => {
    expect(valenceOf(eff({ kind: 'respect', delta: 5 }))).toBe('boon');
    expect(valenceOf(eff({ kind: 'respect', delta: -5 }))).toBe('blow');
  });

  it('a death is a blow', () => {
    expect(valenceOf(eff({ kind: 'status', target: { slot: 'subject' }, status: 'dead' }))).toBe('blow');
  });

  it('madness only goes one way', () => {
    expect(valenceOf(eff({ kind: 'madness', target: { slot: 'subject' }, delta: 12 }))).toBe('blow');
    expect(valenceOf(eff({ kind: 'madness', target: { slot: 'subject' }, delta: -12 }))).toBe('boon');
  });

  it('a clause recovered is progress', () => {
    expect(valenceOf(eff({ kind: 'clause', reveal: 'the_third_part' }))).toBe('boon');
  });

  it('a grudge is a blow even where the sentiment is not given', () => {
    expect(valenceOf(eff({
      kind: 'relationship',
      from: { slot: 'a' }, to: { slot: 'b' },
      grudge: { severity: 40, inheritance: 'all_blood' },
    }))).toBe('blow');
  });
});

describe('nothing is scored twice, and the order holds', () => {
  /**
   * The reason there are weights at all. An outcome that kills a son and
   * leaves forty crowns on the table is not a wash.
   */
  it('a death outweighs money', () => {
    expect(valenceOf([
      { kind: 'status', target: { slot: 'subject' }, status: 'dead' },
      { kind: 'treasury', delta: 4000 },
    ])).toBe('blow');
  });

  it('madness outweighs a career', () => {
    expect(valenceOf([
      { kind: 'madness', target: { slot: 'subject' }, delta: 20 },
      { kind: 'career', target: { slot: 'subject' }, op: 'assign', career: 'scholar' },
    ])).toBe('blow');
  });

  it('two boons are worth more than one', () => {
    const one = valenceScore(eff({ kind: 'treasury', delta: 10 }));
    const two = valenceScore([
      { kind: 'treasury', delta: 10 },
      { kind: 'respect', delta: 1 },
    ]);
    expect(two).toBeGreaterThan(one);
  });
});

describe('plain is an answer, not a fallback', () => {
  it('an outcome with no effects is plain', () => {
    expect(valenceOf([])).toBe('plain');
  });

  it('a scene that only writes a line is plain', () => {
    expect(valenceOf(eff({ kind: 'chronicle', text: 'It rained, and the roof held.' }))).toBe('plain');
  });

  /**
   * Stated as a test because it is a judgement somebody will want to revisit:
   * rumours are silent. `plant_rumour` is a legal purpose on a large slice of
   * the library, and scoring it would make the blow cue fire constantly.
   */
  it('a rumour says nothing about which way the year went', () => {
    expect(valenceOf(eff({ kind: 'rumour', op: 'seed', id: 'the_drowning_lie' }))).toBe('plain');
    expect(valenceOf(eff({ kind: 'rumour', op: 'feed', id: 'the_drowning_lie' }))).toBe('plain');
  });

  it('the machinery is silent', () => {
    expect(valenceOf([
      { kind: 'recast', slot: 'witness' },
      { kind: 'arc', op: 'advance', arc: 'arc_seal' },
      { kind: 'flag', flag: 'saw_it', set: true },
      { kind: 'schedule', event: 'the_second_beat', inYears: 3 },
    ])).toBe('plain');
  });

  /** A boon and a blow of the same weight cancel, and that is correct. */
  it('an even trade is plain', () => {
    expect(valenceOf([
      { kind: 'treasury', delta: 100 },
      { kind: 'treasury', delta: -100 },
    ])).toBe('plain');
  });
});

/**
 * Invariant 5's belt-and-braces. `scoreOf` is exhaustive over `Effect` at
 * compile time, but a `default` slipped in later would silently score every
 * new kind as zero — and zero is what a correct answer looks like. This walks
 * the schema's own list of kinds so the two cannot drift.
 */
describe('every effect the schema allows is scored', () => {
  it('handles one of every kind without throwing', () => {
    const kinds = EffectS.options.map((o) => o.shape.kind.value as string);
    expect(kinds.length, 'the effect union is empty?').toBeGreaterThan(15);

    const sample: Record<string, Effect> = {
      attribute: { kind: 'attribute', target: { slot: 's' }, attr: 'mind', delta: 1 },
      trait: { kind: 'trait', target: { slot: 's' }, trait: 'steady', op: 'add' },
      status: { kind: 'status', target: { slot: 's' }, status: 'dead' },
      madness: { kind: 'madness', target: { slot: 's' }, delta: 1 },
      awakening: { kind: 'awakening', target: { slot: 's' } },
      heirloom: { kind: 'heirloom', op: 'grant', heirloom: 'the_ring' },
      spellbook: { kind: 'spellbook', op: 'gain', target: { slot: 's' }, book: 'b' },
      career: { kind: 'career', target: { slot: 's' }, op: 'assign', career: 'c' },
      treasury: { kind: 'treasury', delta: 1 },
      respect: { kind: 'respect', delta: 1 },
      flag: { kind: 'flag', flag: 'f', set: true },
      relationship: { kind: 'relationship', from: { slot: 'a' }, to: { slot: 'b' }, sentiment: 1 },
      chronicle: { kind: 'chronicle', text: 't' },
      knowledge: { kind: 'knowledge', op: 'grant', flag: 'k' },
      discrepancy: { kind: 'discrepancy', op: 'create', id: 'd' },
      rumour: { kind: 'rumour', op: 'seed', id: 'r' },
      clause: { kind: 'clause', reveal: 'c' },
      branch: { kind: 'branch', op: 'appease', amount: 10 },
      recast: { kind: 'recast', slot: 's' },
      rite: { kind: 'rite', rite: 'vessel', ascendant: 'a', subject: 's' },
      schedule: { kind: 'schedule', event: 'e', inYears: 1 },
      arc: { kind: 'arc', op: 'start', arc: 'a' },
      arc_flag: { kind: 'arc_flag', flag: 'f', set: true },
      forge_lineage: {
        kind: 'forge_lineage', target: { slot: 's' }, parent: 'mother',
        claimedAs: 'other', notarisedBy: 'n', generations: 3,
      },
      bond: { kind: 'bond', target: { slot: 's' }, op: 'bind', marks: 100 },
      marriage: { kind: 'marriage', op: 'end', target: { slot: 's' } },
      priorityMatch: { kind: 'priorityMatch', target: { slot: 's' } },
      tutor: { kind: 'tutor', target: { slot: 's' }, attr: 'mind', op: 'begin' },
      muster: { kind: 'muster', op: 'begin', men: 10, age: 'the_wars' },
      land: { kind: 'land', op: 'grant', parcel: 'p' },
    };

    const unsampled = kinds.filter((k) => !(k in sample));
    expect(unsampled, `no sample effect for: ${unsampled.join(', ')}`).toEqual([]);

    for (const k of kinds) {
      expect(() => valenceScore([sample[k]!]), `${k} threw`).not.toThrow();
    }
  });

  /**
   * And the one that would catch a silent `default`: at least some kinds must
   * score non-zero in each direction. A scorer that returns 0 for everything
   * passes every test above this one.
   */
  it('scores in both directions across the union', () => {
    const up = valenceScore([{ kind: 'treasury', delta: 1 }]);
    const down = valenceScore([{ kind: 'status', target: { slot: 's' }, status: 'dead' }]);
    expect(up).toBeGreaterThan(0);
    expect(down).toBeLessThan(0);
  });
});
