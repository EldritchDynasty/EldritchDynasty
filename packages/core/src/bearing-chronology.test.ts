import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { ECHO_AFTER, ECHO_SPACING, noteBearing, testWorld } from '@ed/core';
import { echoBearing } from './bearing.js';

const content = loadContent();

describe('Bearing echoes respect their recorded year (#2689)', () => {
  it('does not let a future saved echo permanently swallow a due echo', () => {
    const ctx = testWorld(content, 268901);
    const start = ctx.world.year;
    noteBearing(ctx, 'wrote_it_larger', 'the account written today');
    const due = start + ECHO_AFTER;
    const future = due + ECHO_SPACING;
    ctx.world.bearing.acts.push({
      year: start, kind: 'wrote_it_larger', about: 'an account echoed in the future',
      echoed: true, echoedIn: future,
    });
    ctx.world.year = due;
    const before = ctx.world.chronicle.length;

    expect(echoBearing(ctx)).toBe(1);
    expect(ctx.world.bearing.acts[0]).toMatchObject({ echoed: true, echoedIn: due });
    expect(ctx.world.bearing.acts[1]).toMatchObject({ echoed: true, echoedIn: future });
    const written = ctx.world.chronicle.slice(before);
    expect(written).toHaveLength(1);
    expect(written[0]!.year).toBe(due);
    expect(written[0]!.text).toContain('the account written today');

    // The present echo is still a one-shot event.
    expect(echoBearing(ctx)).toBe(0);
    expect(ctx.world.chronicle).toHaveLength(before + 1);
  });

  it('still spaces out genuinely prior echoes of the same kind', () => {
    const ctx = testWorld(content, 268902);
    const start = ctx.world.year;
    noteBearing(ctx, 'refused_a_hand', 'first refusal');
    ctx.world.year = start + 1;
    noteBearing(ctx, 'refused_a_hand', 'next refusal');
    ctx.world.year = start + ECHO_AFTER;

    expect(echoBearing(ctx)).toBe(1);
    ctx.world.year += 1;
    expect(echoBearing(ctx)).toBe(0);
    expect(ctx.world.bearing.acts[0]?.echoedIn).toBe(start + ECHO_AFTER);
    expect(ctx.world.bearing.acts[1]?.echoed).toBe(true);
    expect(ctx.world.bearing.acts[1]?.echoedIn).toBeUndefined();
  });
});
