import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { proseOriginalHash, type EventTemplate, type RecordBlock } from '@ed/schema';
import { newGame } from './session.js';
import { queueRecord, type PendingRecord, type RecordOption } from './events/decisions.js';
import { recordStakes } from './record-stakes.js';
import { coreMessageEntries } from './tools/core-message-audit.js';
import { setProseMode, setProseVariants } from './prose.js';
import { testWorld } from './testing.js';

const content = loadContent();

/** A Record docket over `block`, offering `offered`. Nothing else about the decision is read. */
function docket(block: RecordBlock, offered: RecordOption[] = ['record', 'omit', 'embellish']): PendingRecord {
  return {
    kind: 'record', id: 'dec_test', year: 1050, subject: block.subject, entryId: 'chr_test', fill: {},
    event: { record: block } as EventTemplate,
    options: offered.map((option) => ({ option, chronicle: option === 'omit' ? null : 'a page' })),
  };
}

const plainBlock = (over: Partial<RecordBlock['options']> = {}): RecordBlock => ({
  subject: 'the account',
  options: {
    record: { chronicle: 'It happened.', effects: [], claims: [] },
    omit: { chronicle: null, effects: [] },
    embellish: {
      chronicle: 'It happened better.', effects: [], claims: [],
      discrepancy: { id: 'd_test', severity: 'minor', provableBy: ['k_test'] },
    },
    ...over,
  },
});

/**
 * WHAT EACH WAY OF WRITING IT COSTS (#1867 §5). The pull of each option is the
 * advisers' to voice; these assert the price is stated, by the rules, beside it.
 */
describe('the Record docket states what each option costs', () => {
  it('reads an authored block: the page stands, the blank is read, the improvement can be proven', () => {
    const chapel = content.bundle.events.find((e) => e.record?.subject === 'the stone in the chapel')!;
    const stakes = recordStakes(testWorld(content), docket(chapel.record!));
    expect(stakes).toEqual({
      record: 'The page stands as it happened, for the house to lean on later.',
      omit: 'The year is left blank. It claims nothing the house could show, and the blanks are read at the reckoning.',
      embellish: expect.stringMatching(/^The page reads better, and carries .*contradiction.* Respect \+1\.$/),
    });
  });

  it('names knowledge kept, a gap that is itself a lie, every severity, and what the effects move', () => {
    const ctx = testWorld(content);
    const block = plainBlock({
      record: {
        chronicle: 'It happened.', grantsKnowledge: 'k_learned', claims: [],
        effects: [{ kind: 'respect', delta: -2 }, { kind: 'treasury', delta: 5 }],
      },
      omit: { chronicle: null, effects: [{ kind: 'discrepancy', op: 'create', id: 'd_gap', severity: 'minor' }] },
    });
    const stakes = recordStakes(ctx, docket(block));
    expect(stakes.record).toBe('The page stands as it happened, and the house keeps what it learned. Respect −2. +5 crowns.');
    expect(stakes.omit).toBe('The year is left blank, and the gap is itself a contradiction someone could prove.');

    const by = (severity: 'minor' | 'major' | 'total') => recordStakes(ctx, docket(plainBlock({
      embellish: { ...plainBlock().options.embellish, discrepancy: { id: 'd', severity, provableBy: ['k'] } },
    }))).embellish;
    expect(by('minor')).toContain('a small contradiction');
    expect(by('major')).toContain('a serious contradiction');
    expect(by('total')).toContain('would undo the whole account');
  });

  it('prices only what the docket offers', () => {
    expect(Object.keys(recordStakes(testWorld(content), docket(plainBlock(), ['record', 'embellish']))))
      .toEqual(['record', 'embellish']);
  });

  it('reaches the session docket beside the options, and nowhere else', () => {
    const game = newGame(content, { seed: 1867, campaign: 'short', decider: 'chronicler' });
    const chapel = content.bundle.events.find((e) => e.record?.subject === 'the stone in the chapel')!;
    expect(queueRecord(game.ctx, chapel, 'chr_none')).toBeDefined();
    const shown = game.view().docket.find((d) => d.kind === 'record' && d.event.id === chapel.id);
    expect(shown?.stakes?.omit).toContain('left blank');
    expect(game.view().docket.filter((d) => d.kind !== 'record').every((d) => d.stakes === undefined)).toBe(true);
  });

  it('keys every line, and reads them in Plain English', () => {
    const keyed = coreMessageEntries(readFileSync(new URL('./record-stakes.ts', import.meta.url), 'utf8'));
    expect(keyed.map((e) => e.address.split('#')[1]).sort()).toEqual([
      'record.stakes.embellish_major', 'record.stakes.embellish_minor', 'record.stakes.embellish_total',
      'record.stakes.omit', 'record.stakes.omit_discrepancy', 'record.stakes.record', 'record.stakes.record_knowledge',
      'record.stakes.respect_down', 'record.stakes.respect_up', 'record.stakes.treasury_down', 'record.stakes.treasury_up',
    ]);
    const read = (mode: 'original' | 'plainenglish') => {
      const ctx = testWorld(content);
      setProseVariants(ctx, keyed.map((entry) => ({
        address: entry.address, of: proseOriginalHash(entry.text), plainenglish: `plain: ${entry.text}`,
      })));
      setProseMode(ctx, mode);
      return recordStakes(ctx, docket(plainBlock(), ['omit']));
    };
    expect(read('plainenglish').omit).toBe(`plain: ${read('original').omit}`);
  });
});
