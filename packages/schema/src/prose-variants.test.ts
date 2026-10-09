import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import {
  contentProseEntries,
  indexContent,
  proseOriginalAt,
  proseOriginalHash,
  ProseVariantS,
  runRule,
  type ContentBundle,
} from '@ed/schema';

const content = indexContent(loadContent());

const fixture = (() => {
  for (const event of content.events) {
    const file = content.sourceOf(String(event.id));
    if (!file) continue;
    const body = contentProseEntries(file, { events: [event] })
      .find((entry) => entry.address.endsWith('.body') && entry.interpolations.length > 0);
    if (body) return body;
  }
  throw new Error('shipped content has no interpolated event body for prose-variant tests');
})();

function withVariant(
  mutate: (variant: { address: string; plainenglish: string; of?: string }) => void = () => {},
): ContentBundle {
  const bundle = structuredClone(content.bundle);
  const variant = {
    address: fixture.address,
    plainenglish: `${fixture.text} Put plainly.`,
    of: proseOriginalHash(fixture.text),
  };
  mutate(variant);
  bundle.proseVariants = [variant];
  return bundle;
}

describe('Plain English variant guardrails (#415)', () => {
  it('keeps the Original fingerprint on the canonical ProseVariant schema', () => {
    const of = proseOriginalHash(fixture.text);
    expect(ProseVariantS.parse({
      address: fixture.address,
      of,
      plainenglish: `${fixture.text} Put plainly.`,
    }).of).toBe(of);
  });

  it('accepts a current counterpart that preserves every interpolation token', () => {
    expect(runRule('prose/variants', withVariant())).toEqual([]);
  });

  it('rejects an address whose Original no longer exists', () => {
    const issues = runRule('prose/variants', withVariant((variant) => {
      variant.address = variant.address.replace(/\.body$/, '.field_that_is_not_there');
    }));
    expect(issues).toEqual([
      expect.objectContaining({ level: 'error', rule: 'prose/variants', message: expect.stringMatching(/does not resolve/) }),
    ]);
  });

  it('does not let the right id under the wrong YAML filename count as resolved', () => {
    const wrongFile = fixture.address.replace(/^content:[^#]+#/, 'content:events/not_the_source_file.yaml#');
    expect(proseOriginalAt(content, wrongFile)).toBeUndefined();
  });

  it('reports malformed percent escapes without aborting validation of other variants', () => {
    const malformed = fixture.address.replace('[id=', '[id=%ZZ');
    const bundle = withVariant();
    bundle.proseVariants.unshift({
      address: malformed,
      plainenglish: 'This selector contains an invalid escape.',
    });

    expect(proseOriginalAt(content, malformed)).toBeUndefined();
    expect(runRule('prose/variants', bundle)).toEqual([
      expect.objectContaining({
        level: 'error',
        rule: 'prose/variants',
        where: `prose:${malformed}`,
        message: expect.stringMatching(/does not resolve/),
      }),
    ]);
  });

  it('rejects a resolved string that is not a narrative prose field', () => {
    const issues = runRule('prose/variants', withVariant((variant) => {
      variant.address = variant.address.replace(/\.body$/, '.id');
    }));
    expect(issues).toEqual([
      expect.objectContaining({
        level: 'error',
        rule: 'prose/variants',
        message: expect.stringMatching(/does not resolve/),
      }),
    ]);
  });

  it('still resolves valid percent-encoded authored identities', () => {
    const id = /\[id=([^\]]+)\]/.exec(fixture.address)?.[1];
    if (!id) throw new Error('fixture has no identity segment');
    const encoded = `%${id.charCodeAt(0).toString(16).padStart(2, '0')}${id.slice(1)}`;
    const address = fixture.address.replace(`[id=${id}]`, `[id=${encoded}]`);

    expect(proseOriginalAt(content, address)).toBe(fixture.text);
    expect(runRule('prose/variants', withVariant((variant) => {
      variant.address = address;
    }))).toEqual([]);
  });

  it('rejects numeric aliases for prose rows that have stable authored identities', () => {
    const eventAlias = fixture.address.replace(/events\[id=[^\]]+\]/, 'events[0]');
    // The worklist always uses [id=...] when an item has an authored id.
    // Resolving a numeric alias would pass validation but never be shown.
    const prologue = contentProseEntries('prologue.yaml', { prologue: content.bundle.prologue })
      .find((entry) => entry.address.endsWith('.opening'));
    expect(prologue).toBeDefined();
    const numericPrologue = prologue!.address.replace(/prologue\[id=[^\]]+\]/, 'prologue[0]');

    expect(proseOriginalAt(content, numericPrologue)).toBeUndefined();
    expect(proseOriginalAt(content, eventAlias)).toBeUndefined();
    expect(runRule('prose/variants', withVariant((variant) => {
      variant.address = eventAlias;
    })).some((entry) => entry.level === 'error' && /does not resolve/.test(entry.message))).toBe(true);
  });

  it('rejects prose attributed to a different collection\'s YAML source', () => {
    const prologue = contentProseEntries('prologue.yaml', { prologue: content.bundle.prologue })
      .find((entry) => entry.address.endsWith('.opening'));
    expect(prologue).toBeDefined();
    expect(proseOriginalAt(content, prologue!.address)).toBe(prologue!.text);

    // Numeric selection used to bypass the id/provenance check, letting
    // a bogus events filename claim a real prologue passage.
    const wrongSource = prologue!.address
      .replace('content:prologue.yaml#', 'content:events/not_prologue.yaml#')
      .replace(/prologue\[id=[^\]]+\]/, 'prologue[0]');
    expect(proseOriginalAt(content, wrongSource)).toBeUndefined();
  });

  it('rejects a counterpart that drops one occurrence of an interpolation token', () => {
    const token = fixture.interpolations[0]!;
    const issues = runRule('prose/variants', withVariant((variant) => {
      variant.plainenglish = variant.plainenglish.replace(token, '');
    }));
    expect(issues.some((entry) => entry.level === 'error' && /tokens differ/.test(entry.message))).toBe(true);
  });

  it('warns when the Original changed after the counterpart was reviewed', () => {
    const issues = runRule('prose/variants', withVariant((variant) => {
      variant.of = '0000000000000000';
    }));
    expect(issues.some((entry) => entry.level === 'warning' && /stale/.test(entry.message))).toBe(true);
    expect(issues.every((entry) => entry.level !== 'error')).toBe(true);
  });

  it('treats a legacy row with no Original fingerprint as stale, not unloadable', () => {
    const issues = runRule('prose/variants', withVariant((variant) => {
      delete variant.of;
    }));
    expect(issues.some((entry) => entry.level === 'warning' && /no Original fingerprint/.test(entry.message))).toBe(true);
    expect(issues.every((entry) => entry.level !== 'error')).toBe(true);
  });

  it('warns about an identical counterpart without running the Original voice lint on it', () => {
    const issues = runRule('prose/variants', withVariant((variant) => {
      variant.plainenglish = fixture.text;
    }));
    expect(issues).toEqual([
      expect.objectContaining({ level: 'warning', rule: 'prose/variants', message: expect.stringMatching(/identical/) }),
    ]);
  });
});
