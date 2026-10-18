import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import {
  contentInterpolationTokens,
  contentProseEntries,
  proseOriginalHash,
  type ProseVariant,
} from '@ed/schema';

/**
 * Every authored event must retain its Original prose AND have a usable
 * Plain English counterpart for every eligible player-facing prose field.
 *
 * The shared worklist defines eligibility; one-word identifiers/actions are
 * intentionally not migration items. Walk the raw bundle, not the indexed
 * synthetic follow-up events, whose prose belongs to their parent event.
 */
type LoadedContent = ReturnType<typeof loadContent>;

function eventProseGaps(
  content: LoadedContent,
  variants: readonly ProseVariant[] = content.proseVariants,
): string[] {
  const gaps: string[] = [];
  const byAddress = new Map(variants.map((variant) => [variant.address, variant]));
  const seenEvents = new Set<string>();

  for (const event of content.bundle.events) {
    const id = String(event.id);
    if (seenEvents.has(id)) {
      gaps.push(`event:${id}: duplicate event id`);
      continue;
    }
    seenEvents.add(id);

    const file = content.sourceOf(id);
    if (file === undefined) {
      gaps.push(`event:${id}: missing YAML source`);
      continue;
    }

    const entries = contentProseEntries(file, { events: [event] });
    if (entries.length === 0) {
      gaps.push(`event:${id}: no eligible Original prose`);
    }

    for (const entry of entries) {
      const variant = byAddress.get(entry.address);
      if (!entry.text.trim()) {
        gaps.push(`${entry.address}: empty Original`);
      }
      if (variant === undefined) {
        gaps.push(`${entry.address}: missing plainenglish`);
        continue;
      }
      if (!variant.plainenglish.trim()) {
        gaps.push(`${entry.address}: empty plainenglish`);
      }
      if (variant.of !== proseOriginalHash(entry.text)) {
        gaps.push(`${entry.address}: plainenglish is not reviewed against the current Original`);
      }
      const originalTokens = contentInterpolationTokens(entry.text).sort();
      const plainTokens = contentInterpolationTokens(variant.plainenglish).sort();
      if (originalTokens.length !== plainTokens.length
        || originalTokens.some((token, index) => token !== plainTokens[index])) {
        gaps.push(`${entry.address}: plainenglish changes interpolation tokens`);
      }
    }
  }

  if (seenEvents.size === 0) gaps.push('No authored events loaded');
  return gaps.sort();
}

describe('authored event prose completeness (#1833)', () => {
  const content = loadContent();

  it('provides current Original and plainenglish wording for every event prose field', () => {
    const gaps = eventProseGaps(content);
    // Keep the failure readable when a bulk content edit omits several rows.
    expect(gaps.slice(0, 30).concat(
      gaps.length > 30 ? [`... ${gaps.length - 30} more gaps`] : [],
    )).toEqual([]);
  });

  it('detects an event counterpart removed from the catalogue', () => {
    const event = content.bundle.events[0]!;
    const file = content.sourceOf(String(event.id));
    expect(file).toBeDefined();
    const address = contentProseEntries(file!, { events: [event] })[0]?.address;
    expect(address).toBeDefined();

    const variants = content.proseVariants.filter((variant) => variant.address !== address);
    expect(eventProseGaps(content, variants))
      .toContain(`${address}: missing plainenglish`);
  });

  it('rejects stale and placeholder-breaking counterparts', () => {
    const event = content.bundle.events.find((candidate) => {
      const file = content.sourceOf(String(candidate.id));
      return file !== undefined
        && contentProseEntries(file, { events: [candidate] })
          .some((entry) => entry.interpolations.length > 0);
    });
    expect(event, 'shipped events need an interpolated Original fixture').toBeDefined();

    const file = content.sourceOf(String(event!.id))!;
    const entry = contentProseEntries(file, { events: [event!] })
      .find((candidate) => candidate.interpolations.length > 0)!;
    const variants = content.proseVariants.map((variant) => (
      variant.address !== entry.address
        ? variant
        : {
          ...variant,
          of: '0000000000000000',
          plainenglish: variant.plainenglish.replace(entry.interpolations[0]!, ''),
        }
    ));
    const gaps = eventProseGaps(content, variants);
    expect(gaps).toContain(
      `${entry.address}: plainenglish is not reviewed against the current Original`,
    );
    expect(gaps).toContain(`${entry.address}: plainenglish changes interpolation tokens`);
  });
});
