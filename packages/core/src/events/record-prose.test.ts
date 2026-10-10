import { describe, expect, it } from 'vitest';
import { loadBundle } from '@ed/content';
import { proseOriginalHash, type EventTemplate } from '@ed/schema';
import { applyRecord } from './decisions.js';
import { missingPlainEnglish, setProseMode, setProseVariants } from '../prose.js';
import { testWorld } from '../testing.js';

describe('Record-option Chronicle-effect prose (#806)', () => {
  it('selects reviewed wording at commit time and never rewrites earlier pages', () => {
    const bundle = loadBundle();
    const source = bundle.events.find((item) => item.id === 'a_second_hand_that_agrees')!;
    if (!source?.record) throw new Error('Cawdry fixture has no Record block');

    const original = 'The notary recorded another copy of the supporting document.';
    const plain = 'The notary wrote down another copy of the supporting document.';
    const event: EventTemplate = {
      ...source,
      record: {
        ...source.record,
        options: {
          ...source.record.options,
          record: {
            ...source.record.options.record,
            effects: [{ kind: 'chronicle', text: original }],
          },
        },
      },
    };
    const address = 'content:events/burying.yaml#events[id=a_second_hand_that_agrees].record.options.record.effects[0].text';
    const ctx = testWorld(bundle);
    setProseVariants(ctx, [{ address, of: proseOriginalHash(original), plainenglish: plain }]);
    const written = () => ctx.world.chronicle.filter((page) => page.weight === 'line').map((page) => page.text);

    applyRecord(ctx, event, 'fixture-original', 'record');
    expect(written()).toEqual([original]);

    setProseMode(ctx, 'plainenglish');
    applyRecord(ctx, event, 'fixture-plain', 'record');
    expect(written()).toEqual([original, plain]);
    expect(missingPlainEnglish(ctx)).not.toContain(address);

    setProseVariants(ctx, [{ address, of: '0000000000000000', plainenglish: plain }]);
    applyRecord(ctx, event, 'fixture-stale', 'record');
    expect(written()).toEqual([original, plain, original]);
    expect(missingPlainEnglish(ctx)).toContain(address);

    setProseMode(ctx, 'original');
    expect(written()).toEqual([original, plain, original]);
  });
});
