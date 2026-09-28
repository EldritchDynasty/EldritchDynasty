import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { EventTemplateS, type Choice, type EventTemplate, type Purpose } from '@ed/schema';
import { newGame } from '../session.js';
import { LADDER_BLOCKERS } from '../ascension.js';
import type { PendingChoice } from '../events/decisions.js';
import {
  densityLines, shapeFrequencies,
  type DensityRun, type ShapeFrequency,
} from './density-report.js';
import { isPredetermined, shapeOf } from './shapes.js';

const PURPOSES_A: Purpose[] = ['change_standing', 'buy_patience', 'worldbuild_through_action'];
const PURPOSES_B: Purpose[] = ['plant_rumour', 'test_magic_rule', 'change_relationship'];

function choice(id: string, effects: Choice['outcomes'][number]['effects']): Choice {
  return {
    id,
    label: `Take ${id}`,
    requires: [],
    outcomes: [{
      id: `${id}_outcome`,
      weight: 100,
      text: `${id} happens.`,
      tags: [],
      effects,
    }],
  };
}

function event(
  id: string,
  choices: Choice[],
  over: Partial<Pick<EventTemplate, 'title' | 'body' | 'frequency' | 'purposes'>> = {},
): EventTemplate {
  return EventTemplateS.parse({
    id,
    title: over.title ?? `Title for ${id}`,
    tier: 'individual',
    frequency: over.frequency ?? 'common',
    purposes: over.purposes ?? PURPOSES_A,
    body: over.body ?? `Body for ${id}.`,
    interaction: { kind: 'choice', choices },
  });
}

function pending(e: EventTemplate, unavailable: string[] = []): PendingChoice {
  if (e.interaction.kind === 'narration') throw new Error('test event must offer choices');
  return {
    kind: 'choice',
    id: `decision_${e.id}`,
    year: 1042,
    event: e,
    body: e.body,
    fill: {},
    choices: e.interaction.choices.map((c) => ({
      id: c.id,
      label: c.label,
      available: !unavailable.includes(c.id),
      ...(!unavailable.includes(c.id) ? {} : { blockedBy: 'test fixture' }),
    })),
    cast: [],
    decidedBy: e.interaction.decidedBy,
    choicesAreOpen: true,
  };
}

const pay = (id: string, delta: number) => choice(id, [{ kind: 'treasury', delta }]);
const remember = (id: string, flag: string) => choice(id, [{ kind: 'flag', flag, set: true }]);
const mark = (id: string, trait: string) => choice(id, [{ kind: 'trait', target: 'head', trait, op: 'add' }]);

function noBlockerYears(): DensityRun['blockerSpan'] {
  return Object.fromEntries(LADDER_BLOCKERS.map((blocker) => [blocker, 0]))
    as DensityRun['blockerSpan'];
}

function densityFixture(seed: number, top: ShapeFrequency[]): DensityRun {
  const choices = top.reduce((sum, shape) => sum + shape.count, 0);
  return {
    seed,
    years: 500,
    generations: 20,
    ages: 8,
    choices,
    matches: 20,
    records: 15,
    names: 10,
    perGeneration: choices / 20,
    perAge: choices / 8,
    repeatRun: 0.25,
    repeatAge: 0.03,
    shapeRepeat: {
      kind: { run: 0.32, age: 0.04, runWithoutPredetermined: 0.30, ageWithoutPredetermined: 0.035 },
      category: { run: 0.52, age: 0.10, runWithoutPredetermined: 0.49, ageWithoutPredetermined: 0.09 },
    },
    shapeWindow: 0.20,
    blockerSpan: noBlockerYears(),
    actionableGap: noBlockerYears(),
    stallAges: {},
    ambitionFlat: {},
    repeatedFailure: { campaign: { check: 0, order: 0 }, ages: {} },
    predeterminedShare: 0.12,
    topShapes: {
      campaign: top,
      ages: {
        the_long_peace: top,
      },
    },
    ordinary: 30,
    reach: 75,
    meaningfulChoices: 50,
    meaningfulRecords: 8,
  };
}

function frequencies(entries: [string, number][]): ShapeFrequency[] {
  const total = entries.reduce((sum, [, count]) => sum + count, 0);
  return shapeFrequencies(entries, total);
}

describe('interaction shapes', () => {
  it('collapses different ids and prose when the available option effects have the same shape', () => {
    const a = pending(event('shape_alpha', [pay('pay_a', -3), mark('mark_a', 'stern')], {
      title: 'A bargain in rain',
      body: 'The steward puts one account before the house.',
    }));
    const b = pending(event('shape_beta', [pay('coin_b', -17), mark('scar_b', 'patient')], {
      title: 'A different scene entirely',
      body: 'Nothing in these words is shared.',
    }));

    expect(shapeOf(a, 'kind')).toBe(shapeOf(b, 'kind'));
    expect(shapeOf(a, 'category')).toBe(shapeOf(b, 'category'));
    expect(shapeOf(a, 'category')).toBe('[lasting | money]');
  });

  it('is indifferent to authored option order', () => {
    const forward = pending(event('shape_forward', [pay('pay', -4), remember('remember', 'shape_test')]));
    const reverse = pending(event('shape_reverse', [remember('remember', 'other_key'), pay('pay', -90)]));

    expect(shapeOf(forward, 'kind')).toBe(shapeOf(reverse, 'kind'));
    expect(shapeOf(forward, 'category')).toBe(shapeOf(reverse, 'category'));
  });

  it('changes when an option becomes unavailable', () => {
    const e = event('shape_availability', [pay('pay', -4), mark('mark', 'resolute')]);
    const open = pending(e);
    const blocked = pending(e, ['mark']);

    expect(shapeOf(open, 'kind')).not.toBe(shapeOf(blocked, 'kind'));
    expect(shapeOf(blocked, 'category')).toBe('[money]');
  });

  it('does not read purpose metadata', () => {
    const a = pending(event('shape_purpose_a', [pay('pay', -2), remember('remember', 'one')], { purposes: PURPOSES_A }));
    const b = pending(event('shape_purpose_b', [pay('pay', -30), remember('remember', 'two')], { purposes: PURPOSES_B }));

    expect(shapeOf(a, 'kind')).toBe(shapeOf(b, 'kind'));
    expect(shapeOf(a, 'category')).toBe(shapeOf(b, 'category'));
  });

  it('calls same-kind choices predetermined even when the interruption guard would surface them', () => {
    const ctx = newGame(loadContent(), { seed: 271 }).ctx;
    const d = pending(event('shape_same_kind', [pay('small', -2), pay('large', -20)], { frequency: 'rare' }));

    expect(isPredetermined(ctx, d)).toBe(true);
  });

  it('calls a guard-routine choice predetermined even when its option kinds differ', () => {
    const ctx = newGame(loadContent(), { seed: 272 }).ctx;
    const d = pending(event('shape_routine', [pay('pay', -2), mark('mark', 'steady')]));

    expect(isPredetermined(ctx, d)).toBe(true);
  });

  it('keeps a consequential choice with different option kinds open', () => {
    const ctx = newGame(loadContent(), { seed: 273 }).ctx;
    const d = pending(event('shape_consequential', [pay('pay', -2), mark('mark', 'steady')], { frequency: 'rare' }));

    expect(isPredetermined(ctx, d)).toBe(false);
  });

  it('lets a consistently just-below-cutoff shape become a batch top shape', () => {
    const shared = '[shared below cutoff]';
    const runA = frequencies([
      ...Array.from({ length: 10 }, (_, i) => [`[run-a-${i}]`, 6] as [string, number]),
      [shared, 5],
    ]);
    const runB = frequencies([
      ...Array.from({ length: 10 }, (_, i) => [`[run-b-${i}]`, 6] as [string, number]),
      [shared, 5],
    ]);

    // Each run ranks the shared shape 11th. It must still survive measurement,
    // because across the batch its count is 10 while every one-off shape is 6.
    expect(runA).toHaveLength(11);
    expect(runB).toHaveLength(11);
    expect(runA.at(-1)?.shape).toBe(shared);
    expect(runB.at(-1)?.shape).toBe(shared);

    const output = densityLines([{
      term: 500,
      runs: [densityFixture(903, runA), densityFixture(904, runB)],
    }]).join('\n');
    const campaignRows = output.split('\n').filter((line) => /^500\s+campaign\s+/.test(line));

    expect(campaignRows).toHaveLength(10);
    expect(campaignRows[0]).toContain(shared);
  });

  it('prints byte-identical aggregate tables regardless of run order', () => {
    const a = densityFixture(901, frequencies([
      ['[money | money]', 5],
      ['[lasting | money]', 5],
    ]));
    const b = densityFixture(902, frequencies([
      ['[lasting | money]', 5],
      ['[money | money]', 5],
    ]));

    const forward = densityLines([{ term: 500, runs: [a, b] }]).join('\n');
    const reverse = densityLines([{ term: 500, runs: [b, a] }]).join('\n');

    expect(reverse).toBe(forward);
    expect(forward).toContain('category shape');
    expect(forward).toContain('[lasting | money]');
    expect(forward).toContain('[money | money]');
  });
});
