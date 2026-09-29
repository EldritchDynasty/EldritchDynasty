import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import type { EventTemplate } from '@ed/schema';
import { newGame, resumeGame } from '@ed/core';
import { ambitionRelevance, ambitionView } from './ambition.js';
import { mustSurface } from './delegation.js';
import { queueChoice, type PendingMatch, type PendingRecord } from './events/decisions.js';
import type { SimCtx } from './world.js';

const content = loadContent();

function oneSubject(ctx: SimCtx) {
  const subject = ctx.world.people.household(ctx.world.playerHouse, ctx.world.year)[0];
  if (!subject) throw new Error('the bootstrap world has no household subject');
  return subject;
}

function bloodMatch(ctx: SimCtx, outward: boolean): PendingMatch {
  const subject = oneSubject(ctx);
  return {
    kind: 'match',
    id: outward ? 'outward_hand' : 'inward_hand',
    year: ctx.world.year,
    subject: {
      id: subject.id,
      name: subject.name,
      sex: subject.sex,
      age: ctx.world.year - subject.born,
    },
    cards: [{
      id: outward ? 'outward_card' : 'inward_card',
      kind: outward ? 'outsider' : 'household',
      name: outward ? 'Mara of the Vale' : 'Mara of the Hall',
      sex: subject.sex === 'male' ? 'female' : 'male',
      age: 22,
      house: outward ? 'house_vale' : ctx.world.playerHouse,
      houseName: outward ? 'House Vale' : 'the household',
      blurb: 'The same visible line, from a different distance.',
      dowry: 20,
      kinship: outward ? 0 : 0.0625,
      line: 'ordinary',
      lineSeen: 3,
      words: 'an ordinary watched line',
      papersAsked: 0,
      papersShown: 0,
      panel: { issue: [], woken: [], said: [], ourBook: [] },
      available: true,
    }],
  };
}

function quietRecord(ctx: SimCtx): PendingRecord {
  const source = content.bundle.events[0];
  if (!source) throw new Error('content has no event to use as a record shell');
  const event = {
    ...source,
    id: 'quiet_account_page',
    title: 'A Quiet Account',
    tier: 'record',
    frequency: 'common',
    tags: [],
    purposes: ['change_relationship', 'worldbuild_through_action', 'force_record_choice'],
    conditions: undefined,
    slots: {},
    interaction: {
      kind: 'narration',
      outcomes: [{
        id: 'quiet',
        weight: 100,
        text: 'The steward counted what was on the shelf.',
        tags: [],
        effects: [],
      }],
    },
    record: {
      subject: 'the ordinary household account',
      options: {
        record: { chronicle: 'The shelf was counted.', effects: [], claims: [] },
        omit: { chronicle: null, effects: [] },
        embellish: {
          chronicle: 'The shelf was finer than it was.',
          effects: [],
          claims: [],
          discrepancy: { id: 'quiet_account_lie', severity: 'minor', provableBy: ['household_account'] },
        },
      },
    },
  } as unknown as EventTemplate;

  return {
    kind: 'record',
    id: 'quiet_record',
    year: ctx.world.year,
    event,
    subject: 'the ordinary household account',
    entryId: 'chr_quiet',
    fill: {},
    options: [
      { option: 'record', chronicle: 'The shelf was counted.' },
      { option: 'omit', chronicle: null },
      { option: 'embellish', chronicle: 'The shelf was finer than it was.' },
    ],
  };
}

function bloodChoice(ctx: SimCtx) {
  const source = content.bundle.events.find((event) => event.interaction.kind === 'choice');
  if (!source) throw new Error('content has no choice event to use as a decision shell');
  const event = {
    ...source,
    id: 'bloodward_choice',
    title: 'Which Marriage Is Opened',
    frequency: 'common',
    tags: [],
    purposes: ['change_relationship', 'worldbuild_through_action', 'buy_patience'],
    conditions: undefined,
    slots: {},
    record: undefined,
    interaction: {
      kind: 'choice',
      decidedBy: 'player',
      choices: [
        {
          id: 'open_the_match',
          label: 'Open the match',
          requires: [],
          outcomes: [{
            id: 'opened',
            weight: 100,
            text: 'The house sends one of its own to market.',
            tags: [],
            effects: [{ kind: 'priorityMatch', target: 'head' }],
          }],
        },
        {
          id: 'leave_it',
          label: 'Leave it',
          requires: [],
          outcomes: [{
            id: 'left',
            weight: 100,
            text: 'Nothing is changed.',
            tags: [],
            effects: [],
          }],
        },
      ],
    },
  } as unknown as EventTemplate;
  const pending = queueChoice(ctx, event, event.body, {}, []);
  ctx.world.delegation.choices[event.id] = 'open_the_match';
  return pending;
}

describe('house ambition (issue #210)', () => {
  it('chooses, replaces, clears, and derives progress from the world', () => {
    const g = newGame(content, { seed: 210, campaign: 'short', decider: 'chronicler' });
    expect(g.view().ambition).toBeUndefined();

    expect(g.setAmbition('restore_ledger')).toBe(true);
    const before = g.view().ambition!;
    expect(before.id).toBe('restore_ledger');
    expect(before.progress.current).toBe(g.ctx.world.clausesRecovered.size);

    g.ctx.world.clausesRecovered.add('test_clause');
    const after = g.view().ambition!;
    expect(after.progress.current).toBe(before.progress.current + 1);

    expect(g.setAmbition('secure_branches')).toBe(true);
    expect(g.view().ambition?.id).toBe('secure_branches');
    expect(g.setAmbition(null)).toBe(true);
    expect(g.view().ambition).toBeUndefined();
  });

  it('persists only the selected ambition and resumes it', () => {
    const g = newGame(content, { seed: 211, campaign: 'long', decider: 'chronicler' });
    g.setAmbition('raise_ascendant');
    const saved = JSON.parse(JSON.stringify(g.save()));

    expect(saved.houseAmbition).toBe('raise_ascendant');
    expect(saved.ambitionProgress).toBeUndefined();

    const resumed = resumeGame(saved, content, { decider: 'chronicler' });
    expect(resumed.view().ambition?.id).toBe('raise_ascendant');
  });

  it('does not alter simulation outcomes', () => {
    const withAmbition = newGame(content, { seed: 212, campaign: 'short', decider: 'chronicler' });
    const without = newGame(content, { seed: 212, campaign: 'short', decider: 'chronicler' });
    withAmbition.setAmbition('deepen_blood');

    withAmbition.advance(60);
    without.advance(60);

    const a = JSON.parse(JSON.stringify(withAmbition.save()));
    const b = JSON.parse(JSON.stringify(without.save()));
    delete a.savedAt; delete b.savedAt;
    delete a.houseAmbition; delete b.houseAmbition;
    expect(a).toEqual(b);
  });

  it('reads the actual Match hand rather than one fixed blood blurb', () => {
    const g = newGame(content, { seed: 3271, campaign: 'short', decider: 'chronicler' });
    g.setAmbition('deepen_blood');

    const inward = ambitionRelevance(g.ctx, bloodMatch(g.ctx, false));
    const outward = ambitionRelevance(g.ctx, bloodMatch(g.ctx, true));

    expect(inward?.effect).toBe('endanger');
    expect(outward?.effect).toBe('advance');
    expect(inward?.reason).not.toBe(outward?.reason);
  });

  it('leaves an unrelated Record page irrelevant to restore_ledger and delegatable', () => {
    const g = newGame(content, { seed: 3272, campaign: 'short', decider: 'chronicler' });
    g.setAmbition('restore_ledger');
    const pending = quietRecord(g.ctx);
    g.ctx.world.delegation.records[pending.event.id] = 'record';

    expect(ambitionRelevance(g.ctx, pending)).toBeUndefined();
    expect(mustSurface(g.ctx, pending)).toBeUndefined();
  });

  it('reads only the exact remembered choice branch when it changes the bloodline', () => {
    const g = newGame(content, { seed: 3273, campaign: 'short', decider: 'chronicler' });
    g.setAmbition('deepen_blood');
    const pending = bloodChoice(g.ctx);

    delete g.ctx.world.delegation.choices[pending.event.id];
    expect(ambitionRelevance(g.ctx, pending)).toBeUndefined();

    g.ctx.world.delegation.choices[pending.event.id] = 'open_the_match';
    expect(ambitionRelevance(g.ctx, pending)).toEqual(expect.objectContaining({
      surface: 'choice',
      effect: 'advance',
    }));
  });

  it('puts the derived reading on the session docket and omits it when irrelevant', () => {
    const g = newGame(content, { seed: 3274, campaign: 'short', decider: 'chronicler' });
    g.setAmbition('deepen_blood');
    g.ctx.world.pendingDecisions.length = 0;
    g.ctx.world.pendingDecisions.push(bloodMatch(g.ctx, true));

    expect(g.view().docket[0]?.ambition).toEqual(expect.objectContaining({
      surface: 'match',
      effect: 'advance',
    }));

    g.setAmbition('restore_ledger');
    g.ctx.world.pendingDecisions.length = 0;
    g.ctx.world.pendingDecisions.push(quietRecord(g.ctx));
    expect(g.view().docket[0]?.ambition).toBeUndefined();
  });

  it('reports current Ascension standing as progress and keeps the best rung as history', () => {
    const g = newGame(content, { seed: 3275, campaign: 'long', decider: 'chronicler' });
    g.setAmbition('raise_ascendant');
    g.ctx.world.ascension.rung = 'hierophant';
    g.ctx.world.ascension.best = 'hierophant';
    const before = ambitionView(g.ctx)!;

    g.ctx.world.ascension.rung = 'adept';
    const after = ambitionView(g.ctx)!;

    expect(after.progress.current).toBeLessThan(before.progress.current);
    expect(after.progress.label).toContain('Adept');
    expect(after.progress.label).toContain('Hierophant');
    expect(after.progress.label).toContain('reached before');
  });

  it('keeps the ambition reader out of hidden genetics, Bearing, RNG and checks', () => {
    const source = readFileSync(new URL('./ambition.ts', import.meta.url), 'utf8');
    const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);

    expect(imports).toEqual([
      '@ed/schema',
      './world.js',
      './people/branches.js',
      './ascension.js',
      './campaign.js',
      './events/decisions.js',
    ]);
    expect(imports.some((path) => (path ?? '').includes('genetics/') || /bearing|rng|checks/i.test(path ?? ''))).toBe(false);
  });

  it('adapts campaign horizons without changing the catalogue', () => {
    const short = newGame(content, { seed: 213, campaign: 'short', decider: 'chronicler' });
    const long = newGame(content, { seed: 213, campaign: 'long', decider: 'chronicler' });
    short.setAmbition('raise_ascendant');
    long.setAmbition('raise_ascendant');

    expect(short.ambitionOptions()).toHaveLength(4);
    expect(long.ambitionOptions()).toHaveLength(4);
    expect(short.view().ambition?.progress.target).toBeLessThan(long.view().ambition!.progress.target);
  });
});
