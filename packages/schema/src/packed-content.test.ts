import { describe, expect, it } from 'vitest';
import { packContentDocument, unpackContentDocument } from './packed-content.js';

describe('compiled content interning (#1868)', () => {
  it('round-trips repeated nested prose and effect bundles through JSON', () => {
    const response = { text: 'The beam stopped above the bed. The outer door still broke.', effects: [{ kind: 'treasury', delta: -20 }] };
    const authored = { events: Array.from({ length: 10 }, (_, id) => ({ id: String(id), primordial: response })), nil: null, empty: [] };
    const packed = packContentDocument(authored);
    expect(JSON.stringify(packed).length).toBeLessThan(JSON.stringify(authored).length);
    expect(unpackContentDocument(JSON.parse(JSON.stringify(packed)))).toEqual(authored);
  });
  it('leaves ordinary data untouched and refuses invalid, dangling or cyclic refs', () => {
    expect(unpackContentDocument({ events: [] })).toEqual({ events: [] });
    expect(packContentDocument({ '$ed': 'authored', text: 'unchanged' })).toEqual({ '$ed': 'authored', text: 'unchanged' });
    expect(() => unpackContentDocument({ $edPacked: 1, dictionary: [], document: { $ed: 0 } })).toThrow('reference');
    expect(() => unpackContentDocument({ $edPacked: 1, dictionary: [{ $ed: 0 }], document: { $ed: 0 } })).toThrow('cyclic');
    expect(() => unpackContentDocument({ $edPacked: 2, dictionary: [], document: null })).toThrow('envelope');
  });
  it('interns repeated field names without changing unique text, arrays or nested values', () => {
    const authored = { entries: Array.from({ length: 80 }, (_, id) => ({
      preparation: { crowns: id, years: id % 4 }, description: `A distinct account numbered ${id}.`,
      benefit: { kind: 'commission', annualCrowns: id, favour: 2 },
    })) };
    const packed = packContentDocument(authored) as { $edPacked: number };
    expect(packed.$edPacked).toBe(2);
    expect(JSON.stringify(packed).length).toBeLessThan(JSON.stringify(authored).length);
    expect(unpackContentDocument(JSON.parse(JSON.stringify(packed)))).toEqual(authored);
    expect(packContentDocument({ entries: [{ '~0': 'authored key' }] })).toEqual({ entries: [{ '~0': 'authored key' }] });
  });
  it('keeps legacy envelopes readable and rejects malformed compacted fields', () => {
    expect(unpackContentDocument({ $edPacked: 1, dictionary: ['old wording'], document: { text: { $ed: 0 } } }))
      .toEqual({ text: 'old wording' });
    for (const document of [{ '~1': 1 }, { '~00': 1 }, { '~!': 1 }, { '~0': 1, name: 2 }]) {
      expect(() => unpackContentDocument({ $edPacked: 2, fields: ['name'], dictionary: [], document })).toThrow('field');
    }
    expect(() => unpackContentDocument({ $edPacked: 2, fields: ['name', 'name'], dictionary: [], document: {} })).toThrow('envelope');
  });
});
