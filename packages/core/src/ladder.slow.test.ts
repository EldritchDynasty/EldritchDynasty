import { describe, expect, it } from 'vitest';
import { loadBundle } from '@ed/content';
import { isLadderRole, type ContentBundle } from '@ed/schema';
import { gateLadder } from './tools/ladder-gate.js';
import { gateLadderScales } from './tools/gates.js';

const bundle = loadBundle();

/**
 * ISSUE #41'S SECOND HALF, PLAYED.
 *
 * `gate:ladder` is a function over a bundle rather than a script, for the
 * reason every gate here is: a gate nobody has watched fail is
 * indistinguishable from a gate that cannot fail. The negative it is handed
 * is not a contrived bundle — it is the game as it stood the day the issue
 * was written, with the ladder's bargains still offered and costing nothing.
 */
describe('the ladder gate', () => {
  // Six paired seeds keep the shipped-game measurement broad enough to be
  // distributional. The negative control below is deterministic for a
  // stronger reason: it strips every ladder cost kind the policy recognises
  // (direct Madness and rites), so climb and spare have no ladder decision
  // left on which they can differ.
  const seeds = [4000, 4013, 4026, 4039, 4052, 4065];
  const years = 500;

  // These synchronous batches are bounded by the CI job, not by per-test
  // wall-clock limits (vitest.config.ts). Busy runners can exceed 120s
  // after completing the same deterministic simulation and assertions.

  it('passes the shipped game: paying separates from refusing', () => {
    const { ok, lines } = gateLadder(bundle, { seeds, years });
    expect(ok, lines.join('\n')).toBe(true);
  });

  it('fails a game whose ladder costs are removed', () => {
    // Remove every cost that `costsTheClimber` recognises: direct Madness
    // on a ladder role and rites whose ascendant is on the ladder. The latter
    // matters because the Vessel transfers the consumed relative's Madness;
    // leaving rites in made this supposedly cost-free control still expensive.
    // The scenes and choices remain authored, but climb has no costly ladder
    // branch left to distinguish it from spare.
    const declawed: ContentBundle = {
      ...bundle,
      events: bundle.events.map((e) => {
        // EVERY ladder role (issue #61, Stage E5). Hand-written, this declawed
        // only `foremost` scenes — so a bundle meant to have every charge on
        // the climbing man removed still had the second man's rites in it, and
        // the negative control this test IS was quietly incomplete.
        const onTheLadder = new Set(
          Object.entries(e.slots).filter(([, s]) => isLadderRole(s.role)).map(([id]) => id),
        );
        if (!onTheLadder.size || e.interaction.kind === 'narration') return e;
        return {
          ...e,
          interaction: {
            ...e.interaction,
            choices: e.interaction.choices.map((c) => ({
              ...c,
              outcomes: c.outcomes.map((o) => ({
                ...o,
                effects: o.effects.filter(
                  (f) => !(
                    (f.kind === 'madness' && typeof f.target === 'object'
                      && 'slot' in f.target && onTheLadder.has(f.target.slot))
                    || (f.kind === 'rite' && onTheLadder.has(f.ascendant))
                  ),
                ),
              })),
            })),
          },
        };
      }),
    };

    const { ok, lines } = gateLadder(declawed, { seeds, years });
    expect(ok, `the gate passed a game that charges nobody:\n${lines.join('\n')}`).toBe(false);
  });
});

// Population ceilings need the configured gate sample, not a reduced verdict fixture.
// Keep this campaign batch in the measured slow lane (#1982).
describe('the measured ladder floors', () => {
  it('passes the shipped ladder, and says what share clears each floor', () => {
    const { ok, lines } = gateLadderScales(bundle);
    const out = lines.join('\n');
    expect(ok, out).toBe(true);
    expect(out).toMatch(/wants mind 70/);
    expect(out).toMatch(/#378 diagnostic — sampled Madness by progression route/);
    expect(out).toMatch(/none\s+samples\s+\d+ · max \d+\.\d · >=60 \d+\.\d% · >=90 \d+\.\d% · >=90 viable (?:\d+\.\d%|n\/a) of >=90/);
    expect(out).toMatch(/vessel\s+samples\s+\d+ · max \d+\.\d · >=60 \d+\.\d% · >=90 \d+\.\d% · >=90 viable (?:\d+\.\d%|n\/a) of >=90/);
    expect(out).toMatch(/great_rite\s+samples\s+\d+ · max \d+\.\d · >=60 \d+\.\d% · >=90 \d+\.\d% · >=90 viable (?:\d+\.\d%|n\/a) of >=90/);
    expect(out).toMatch(/unmaking\s+samples\s+\d+ · max \d+\.\d · >=60 \d+\.\d% · >=90 \d+\.\d% · >=90 viable (?:\d+\.\d%|n\/a) of >=90/);
    expect(out).toMatch(/#378 diagnostic — resolved Madness-progression decisions across batch/);
    for (const event of [
      'the_drowning',
      'the_vessel_rite',
      'the_great_rite',
      'the_second_name',
      'the_second_widening',
      'the_unmaking',
    ]) {
      expect(out).toMatch(new RegExp(`${event}\\s+resolved\\s+\\d+ ·`));
    }
    expect(out).toMatch(/#378 diagnostic — top distinct sampled Madness holders per run/);

    // The diagnostic must not let one long-lived man occupy all three rows
    // merely because the 25/50-year sampler saw him repeatedly.
    for (const seed of [5000, 5007]) {
      const rows = lines.filter((line) => line.includes(`seed ${seed} #`));
      const ids = rows.map((line) => /\bid ([^ ]+)/.exec(line)?.[1]);
      expect(rows.length, `no Madness provenance rows for seed ${seed}`).toBeGreaterThan(0);
      expect(ids.every(Boolean), `seed ${seed} emitted a provenance row without a person id`).toBe(true);
      expect(new Set(ids).size, `seed ${seed} repeated one holder in its top rows`).toBe(ids.length);
    }
  });
});
