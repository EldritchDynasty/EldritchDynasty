import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import {
  AGE_STRATEGIES, activeMatchPriorities, activeRecordPriorities,
  matchFuture, strategicPressures, tableView, testWorld, type MatchCard,
} from '@ed/core';
import { readFileSync } from 'node:fs';
import { proseOriginalHash } from '@ed/schema';
import { coreMessageAddress } from './messages.js';
import { setProseMode, setProseVariants } from './prose.js';
import { coreMessageEntries } from './tools/core-message-audit.js';

const bundle = loadContent();

function inAge(id: string) {
  const ctx = testWorld(bundle);
  ctx.world.age.active = [{
    age: id,
    began: ctx.world.year - 5,
    named: false,
    paid: { standing: false },
  }];
  return ctx;
}

describe('Age strategic identity', () => {
  it('covers every shipped Age with two date/name-stripped player priorities', () => {
    expect(Object.keys(AGE_STRATEGIES).sort()).toEqual(bundle.ages.map((a) => a.id).sort());

    for (const def of bundle.ages) {
      const ctx = inAge(def.id);
      const pressures = strategicPressures(ctx);
      expect(pressures, def.id).toHaveLength(2);
      expect(new Set(pressures).size, def.id).toBe(2);
      const diagnostic = pressures.join(' ').toLowerCase();
      expect(diagnostic).not.toContain(def.id.toLowerCase());
      expect(diagnostic).not.toContain(def.name.toLowerCase());
      expect(diagnostic).not.toContain(String(ctx.world.year));
    }
  });

  it('changes Match desirability in several different directions', () => {
    expect(activeMatchPriorities(inAge('the_long_peace'))).toEqual(['continuity']);
    expect(activeMatchPriorities(inAge('the_crusade'))).toEqual(['standing']);
    expect(activeMatchPriorities(inAge('the_withering'))).toEqual(['blood']);
  });

  it('changes the reading of the same date-stripped Match evidence', () => {
    const card: MatchCard = {
      id: 'same-card',
      kind: 'household',
      name: 'Aldren',
      sex: 'male',
      age: 23,
      house: 'house_test',
      houseName: 'House Test',
      blurb: 'The same visible evidence in either century.',
      dowry: 0,
      kinship: 0.0625,
      line: 'fertile',
      lineSeen: 3,
      words: 'close kin · a full line',
      papersAsked: 0,
      papersShown: 0,
      panel: { issue: [], woken: [], said: [], ourBook: [] },
      person: 'aldren',
      available: true,
    };

    expect(matchFuture(card, ['blood']).kind).toBe('blood');
    expect(matchFuture(card, ['continuity']).kind).toBe('continuity');
  });

  it('changes live Table value for the favoured career rather than scaling every post', () => {
    const neutral = testWorld(bundle);
    const wars = inAge('the_wars');

    const ordinaryMilitary = tableView(neutral).posts.find((post) => post.career === 'military')!;
    const warMilitary = tableView(wars).posts.find((post) => post.career === 'military')!;
    const ordinaryScholar = tableView(neutral).posts.find((post) => post.career === 'scholar')!;
    const warScholar = tableView(wars).posts.find((post) => post.career === 'scholar')!;

    expect(warMilitary.fee).toBeLessThan(ordinaryMilitary.fee);
    expect(warMilitary.usualFee).toBe(ordinaryMilitary.fee);
    expect(warScholar.fee).toBe(ordinaryScholar.fee);
    expect(warScholar.usualFee).toBeUndefined();
  });

  it('changes recurring Record temptation without removing any option', () => {
    const crusade = inAge('the_crusade');
    expect(activeRecordPriorities(crusade)).toEqual(['omit']);

    const quickening = inAge('the_quickening');
    expect(activeRecordPriorities(quickening)).toEqual(['embellish']);
  });

  it('combines overlapping Ages as distinct pressures, not a late-game multiplier', () => {
    const ctx = inAge('the_wars');
    ctx.world.age.active.push({
      age: 'the_crusade',
      began: ctx.world.year - 3,
      named: false,
      paid: { standing: false },
    });
    expect(activeMatchPriorities(ctx)).toEqual(['continuity', 'standing']);
    expect(activeRecordPriorities(ctx)).toEqual(['omit']);
    expect(strategicPressures(ctx)).toHaveLength(4);
  });
});

describe('the Age priorities speak the reader\'s setting (#781)', () => {
  const source = readFileSync(new URL('./ages/strategy.ts', import.meta.url), 'utf8');
  const keyed = coreMessageEntries(source).filter((entry) => entry.address.includes('#age_strategy.'));

  it('keys exactly two priorities for every shipped Age', () => {
    expect(keyed).toHaveLength(bundle.ages.length * 2);
    for (const def of bundle.ages) {
      const ctx = inAge(def.id);
      expect(strategicPressures(ctx)).toEqual([0, 1].map((i) =>
        keyed.find((entry) => entry.address === coreMessageAddress(`age_strategy.${def.id}.${i}`))!.text));
    }
  });

  it('gives the reviewed Plain English priorities, the same count of them', () => {
    for (const def of bundle.ages) {
      const ctx = inAge(def.id);
      setProseVariants(ctx, keyed.map((entry) => ({
        address: entry.address, of: proseOriginalHash(entry.text), plainenglish: `plain: ${entry.text}`,
      })));
      const original = strategicPressures(ctx);
      setProseMode(ctx, 'plainenglish');
      expect(strategicPressures(ctx)).toEqual(original.map((text) => `plain: ${text}`));
    }
  });
});
