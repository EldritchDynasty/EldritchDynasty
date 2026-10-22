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
});
