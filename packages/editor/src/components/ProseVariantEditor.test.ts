import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const COMPONENTS = import.meta.dirname;

describe('dual prose authoring surface (#414)', () => {
  it('uses one shared prose-variant editor in every authored prose view', () => {
    for (const name of ['EventEditor.vue', 'ArcEditor.vue', 'CharacterEditor.vue']) {
      const source = readFileSync(join(COMPONENTS, name), 'utf8');
      expect(source, name).toContain("import ProseVariantEditor from './ProseVariantEditor.vue'");
      expect(source, name).toContain('<ProseVariantEditor');
    }
  });

  it('labels both variants, checks placeholders, and never prose-lints Plain English', () => {
    const source = readFileSync(join(COMPONENTS, 'ProseVariantEditor.vue'), 'utf8');

    expect(source).toContain('Original');
    expect(source).toContain('Plain English');
    expect(source).toContain('contentInterpolationTokens');
    expect(source).toContain('Placeholders match.');
    expect(source).toContain('missing ');
    expect(source).toContain('extra ');
    expect(source).not.toContain('proseIssues');
    expect(source).toContain('isWritableContentPath');
  });
});
