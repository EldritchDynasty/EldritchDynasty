import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { runRule } from './validate.js';
import { GlossaryTermS } from './glossary.js';

const source = loadContent();
const term = source.glossary[0]!;

describe('authored glossary source (#1991)', () => {
  it('loads one validated definition in both registers', () => {
    expect(term).toEqual(GlossaryTermS.parse(term));
    expect(term.id).toBe('standing');
    expect(runRule('glossary/refs', source)).toEqual([]);
  });
  it('rejects empty definitions and unmatchable labels', () => {
    expect(() => GlossaryTermS.parse({ ...term, definition: { ...term.definition, original: '' } })).toThrow();
    const issues = runRule('glossary/refs', { ...source.bundle,
      glossary: [{ ...term, names: { ...term.names, original: 'Other' } }] });
    expect(issues.some(i => i.message.includes('display name must be a matchable alias'))).toBe(true);
  });
  it('rejects duplicate ids, aliases and missing related-term references', () => {
    const issues = runRule('glossary/refs', { ...source.bundle,
      glossary: [term, { ...term, related: ['missing'] }] });
    expect(issues.some(i => i.message === 'duplicate glossary id')).toBe(true);
    expect(issues.some(i => i.message.includes("alias 'Standing'"))).toBe(true);
    expect(issues.some(i => i.message.includes("unknown related term 'missing'"))).toBe(true);
  });
});
