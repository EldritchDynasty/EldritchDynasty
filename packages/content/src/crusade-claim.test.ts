import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { proseOriginalHash } from '@ed/schema';
import { CONTENT_ROOT, loadContent } from './index.js';

/**
 * #584: a comma in an unquoted YAML flow-map scalar ends the value.
 * Zod used to strip the resulting null-valued extra key, making a half-deed
 * look valid. Exercise both raw YAML and the indexed content the game reads.
 */
describe('the Crusade chapel deed claim', () => {
  const eventId = 'what_the_chapel_is_for';
  const fullText = 'keeps an altar stone older than the chapel, which this house did not set there';
  const address = 'content:events/age_crusade.yaml#events[id=what_the_chapel_is_for].record.options.record.claims[0].text';

  it('parses the complete claim without swallowing extra flow-map keys', () => {
    const source = readFileSync(join(CONTENT_ROOT, 'events', 'age_crusade.yaml'), 'utf8');
    const doc = parse(source) as {
      events: Array<{ id: string; record?: {
        options: { record: { claims: Array<Record<string, unknown>> } };
      } }>;
    };
    const claim = doc.events.find((event) => event.id === eventId)?.record?.options.record.claims[0];
    expect(claim).toStrictEqual({
      kind: 'deed',
      target: { slot: 'HEAD' },
      text: fullText,
    });
  });

  it('preserves the full deed in gameplay content and keeps the reviewed variant current', () => {
    const content = loadContent();
    const claim = content.mustEvent(eventId).record?.options.record.claims[0];
    expect(claim).toStrictEqual({
      kind: 'deed',
      target: { slot: 'HEAD' },
      text: fullText,
    });
    const variant = content.proseVariants.find((row) => row.address === address);
    expect(variant?.of).toBe(proseOriginalHash(fullText));
  });
});
