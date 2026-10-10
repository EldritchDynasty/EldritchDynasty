import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { loadContent } from '@ed/content';
import {
  assembleBundle,
  CORE_MESSAGE_ADDRESS_PREFIX,
  CORE_MESSAGE_VARIANTS_FILE,
  contentInterpolationTokens,
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

  it('rejects a duplicate address even when both counterparts are individually valid', () => {
    const bundle = withVariant();
    bundle.proseVariants.push({
      ...bundle.proseVariants[0]!,
      plainenglish: `${fixture.text} In other words.`,
    });

    expect(runRule('prose/variants', bundle)).toEqual([
      expect.objectContaining({
        level: 'error',
        rule: 'prose/variants',
        where: `prose:${fixture.address}`,
        message: expect.stringMatching(/duplicate Plain English variant address/),
      }),
    ]);
  });

  it('reports every extra counterpart for the same address', () => {
    const bundle = withVariant();
    bundle.proseVariants.push({ ...bundle.proseVariants[0]! });
    bundle.proseVariants.push({ ...bundle.proseVariants[0]! });

    const issues = runRule('prose/variants', bundle);
    expect(issues).toHaveLength(2);
    expect(issues.every((entry) => entry.level === 'error' && /duplicate/.test(entry.message))).toBe(true);
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

  it('validates a Plain English counterpart for a one-word tale bias', () => {
    const tale = content.tales[0]!;
    const address = `content:tales.yaml#tales[id=${encodeURIComponent(tale.id)}].bias`;
    const entries = contentProseEntries('tales.yaml', { tales: [tale] });

    expect(entries.find((entry) => entry.address === address)?.text).toBe(tale.bias);
    expect(proseOriginalAt(content, address)).toBe(tale.bias);
    const bundle = structuredClone(content.bundle);
    bundle.proseVariants = [{
      address,
      of: proseOriginalHash(tale.bias),
      plainenglish: 'They hope for a return that has not happened.',
    }];
    expect(runRule('prose/variants', bundle)).toEqual([]);
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
  it('includes repeated leading-underscore placeholders used by core messages', () => {
    expect(contentInterpolationTokens(
      '{_NAME} told {HEAD} about {_NAME} and {_laterYear}.',
    )).toEqual(['{_NAME}', '{HEAD}', '{_NAME}', '{_laterYear}']);
  });

  it('enumerates uppercase, lowercase and mixed-case runtime placeholders including repetitions', () => {
    expect(contentInterpolationTokens(
      '{HEAD} gives {years} years to {endYear}; {house} remembers {teller}; {HEAD} listens.',
    )).toEqual(['{HEAD}', '{years}', '{endYear}', '{house}', '{teller}', '{HEAD}']);
  });

  it('rejects Plain English that drops a lower/mixed-case campaign substitution', () => {
    const campaign = contentProseEntries('prologue.yaml', { prologue: content.bundle.prologue })
      .find((entry) => entry.address.endsWith('.triad[2].owed.campaignText'));
    expect(campaign).toBeDefined();
    expect(campaign!.interpolations).toContain('{years}');
    expect(campaign!.interpolations).toContain('{endYear}');

    const bundle = structuredClone(content.bundle);
    bundle.proseVariants = [{
      address: campaign!.address,
      of: proseOriginalHash(campaign!.text),
      plainenglish: campaign!.text.replace('{endYear}', ''),
    }];
    expect(runRule('prose/variants', bundle)).toEqual([
      expect.objectContaining({
        level: 'error',
        rule: 'prose/variants',
        where: `prose:${campaign!.address}`,
        message: expect.stringMatching(/tokens differ/),
      }),
    ]);

    bundle.proseVariants[0]!.plainenglish = campaign!.text.replace('THE TERM.', 'THE PERIOD.');
    expect(runRule('prose/variants', bundle)).toEqual([]);
  });

  it('rejects a missing lower-case inherited-account attribution token', () => {
    const inherited = contentProseEntries('prologue.yaml', { prologue: content.bundle.prologue })
      .find((entry) => entry.address.endsWith('.inheritedLine'));
    expect(inherited).toBeDefined();
    expect(inherited!.interpolations).toContain('{house}');
    expect(inherited!.interpolations).toContain('{teller}');

    const bundle = structuredClone(content.bundle);
    bundle.proseVariants = [{
      address: inherited!.address,
      of: proseOriginalHash(inherited!.text),
      plainenglish: inherited!.text.replace('{teller}', ''),
    }];
    expect(runRule('prose/variants', bundle).some(
      (entry) => entry.level === 'error' && /tokens differ/.test(entry.message),
    )).toBe(true);
  });

});

/**
 * A `msg()` Original lives in TypeScript, so its counterpart has one home
 * file rather than a neighbour (#1010). Before this, every `core:messages#`
 * row was an error here and none could ship.
 */
describe('core message counterparts (#1010)', () => {
  const coreRow = (of?: string) => ({
    address: `${CORE_MESSAGE_ADDRESS_PREFIX}service.unpaid`,
    ...(of === undefined ? {} : { of }),
    plainenglish: '{PERSON} was not kept on.',
  });
  const withRows = (rows: ContentBundle['proseVariants']): ContentBundle => {
    const bundle = structuredClone(content.bundle);
    bundle.proseVariants = rows;
    return bundle;
  };

  it('leaves the Original to core, and still asks what the row was reviewed against', () => {
    expect(runRule('prose/variants', withRows([coreRow('0123456789abcdef')]))).toEqual([]);
    expect(runRule('prose/variants', withRows([coreRow()]))).toEqual([
      expect.objectContaining({ level: 'warning', message: expect.stringMatching(/no Original fingerprint/) }),
    ]);
  });

  it('still rejects a duplicate, an empty key, and an unkeyed core literal', () => {
    const duplicate = runRule('prose/variants', withRows([coreRow('0123456789abcdef'), coreRow('0123456789abcdef')]));
    expect(duplicate).toEqual([expect.objectContaining({ level: 'error', message: expect.stringMatching(/duplicate/) })]);

    const empty = runRule('prose/variants', withRows([{ address: CORE_MESSAGE_ADDRESS_PREFIX, plainenglish: 'x y' }]));
    expect(empty).toEqual([expect.objectContaining({ level: 'error', message: expect.stringMatching(/names no key/) })]);

    // A legacy literal has no runtime seam: a counterpart on it would never show.
    const literal = runRule('prose/variants', withRows([{ address: 'core:session.ts#literal[3]', plainenglish: 'x y' }]));
    expect(literal).toEqual([expect.objectContaining({ level: 'error', message: expect.stringMatching(/does not resolve/) })]);
  });

  it('assembles a core row from its home file, and refuses one filed anywhere else', () => {
    const files = (path: string): Record<string, string> => ({
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
      'events/one.yaml': 'events: []',
      [path]: [
        ...(path === 'events/one.yaml' ? ['events: []'] : []),
        'proseVariants:',
        `  - address: "${CORE_MESSAGE_ADDRESS_PREFIX}service.unpaid"`,
        '    plainenglish: "{PERSON} was not kept on."',
      ].join('\n'),
    });

    expect(assembleBundle(files(CORE_MESSAGE_VARIANTS_FILE), parse).proseVariants.map((v) => v.address))
      .toEqual([`${CORE_MESSAGE_ADDRESS_PREFIX}service.unpaid`]);
    expect(() => assembleBundle(files('events/one.yaml'), parse))
      .toThrow(/core:messages#service\.unpaid.*events\/one\.yaml.*messages\.yaml/);
  });
});
