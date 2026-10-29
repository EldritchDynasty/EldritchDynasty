import { describe, expect, it } from 'vitest';
import { MusterOrderS, SessionCommandS, TableOrderS, type SessionCommand, type TableOrder } from '@ed/schema';
import {
  COMMAND_LOADS, MUSTER_ORDER_LOAD, TABLE_ORDER_LOAD, acceptedCommands, classifyCommand, emptyCommandTally, noteCommand,
  observeOrders,
} from './table-load.js';
import { newGame, type GameSession } from './session.js';
import { loadContent } from '@ed/content';

// The schema is the list; nothing here names an order kind it did not read off it.
const orderKinds = [...new Set(TableOrderS.options.map(o => o.shape.kind.value))];
const musterOps = MusterOrderS.options.map(o => o.shape.op.value);
const commandKinds = SessionCommandS.options.map(o => o.shape.kind.value);

describe("the Table's load rubric (#1992)", () => {
  it('classifies exactly the orders the schema accepts', () => {
    expect(Object.keys(TABLE_ORDER_LOAD).sort()).toEqual([...orderKinds].sort());
    expect(Object.keys(MUSTER_ORDER_LOAD).sort()).toEqual([...musterOps].sort());
  });

  it('gives every row a load and an argument', () => {
    for (const row of [...Object.values(TABLE_ORDER_LOAD), ...Object.values(MUSTER_ORDER_LOAD)]) {
      expect(COMMAND_LOADS).toContain(row.load);
      expect(row.why.length).toBeGreaterThan(10);
    }
  });

  it('keeps §4\'s three verbs consequential', () => {
    // Who marries whom, who is spent, what gets written down.
    for (const kind of ['marriages', 'withhold', 'vesselRite', 'greatRite', 'pedigree'] as const) {
      expect(TABLE_ORDER_LOAD[kind].load).toBe('consequential');
    }
  });

  it('classifies a command of every kind the session logs', () => {
    const samples: Record<SessionCommand['kind'], SessionCommand> = {
      advance: { kind: 'advance', years: 1, decider: 'ask' },
      order: { kind: 'order', order: { kind: 'study', person: 'p', book: 'b' } },
      muster: { kind: 'muster', order: { op: 'withdraw' } },
      choose: { kind: 'choose', decision: 'd', choice: 'c', cast: {} },
      send: { kind: 'send', decision: 'd', cast: {} },
      record: { kind: 'record', decision: 'd', option: 'omit' },
      match: { kind: 'match', decision: 'd', card: 'k' },
      declineHand: { kind: 'declineHand', decision: 'd' },
      letHimDecide: { kind: 'letHimDecide' },
      name: { kind: 'name', person: 'p', name: 'n' },
      nameParcel: { kind: 'nameParcel', parcel: 'p', name: 'n' },
      keepSuggestedName: { kind: 'keepSuggestedName', person: 'p' },
      keepSuggestedNames: { kind: 'keepSuggestedNames' },
      delegateChoice: { kind: 'delegateChoice', event: 'e', choice: null },
      delegateRecord: { kind: 'delegateRecord', event: 'e', option: null },
      setAmbition: { kind: 'setAmbition', ambition: null },
    };
    expect(Object.keys(samples).sort()).toEqual([...commandKinds].sort());
    for (const command of Object.values(samples)) {
      SessionCommandS.parse(command);
      const c = classifyCommand(command);
      expect(c.category.startsWith(command.kind === 'order' || command.kind === 'muster' ? `${command.kind}:` : command.kind)).toBe(true);
    }
    for (const kind of ['choose', 'send', 'record', 'match'] as const) expect(classifyCommand(samples[kind]).load).toBe('consequential');
    expect(classifyCommand(samples.advance).load).toBeNull();
    expect(classifyCommand(samples.order)).toEqual({ category: 'order:study', surface: 'table', system: 'library', load: 'maintenance' });
    expect(classifyCommand(samples.muster)).toEqual({ category: 'muster:withdraw', surface: 'muster', system: 'muster', load: 'consequential' });
  });

  it('counts attempts, acceptances and refusals apart', () => {
    const tally = emptyCommandTally();
    const study: SessionCommand = { kind: 'order', order: { kind: 'study', person: 'p', book: 'b' } };
    noteCommand(tally, study, true);
    noteCommand(tally, study, false);
    noteCommand(tally, { kind: 'order', order: { kind: 'marriages', policy: 'in' } }, true);
    noteCommand(tally, { kind: 'advance', years: 1, decider: 'chronicler' }, true);
    expect(tally.byCategory['order:study']).toEqual({ attempted: 2, accepted: 1, refused: 1 });
    expect(tally.byLoad.maintenance).toEqual({ attempted: 2, accepted: 1, refused: 1 });
    expect(tally.byLoad.consequential).toEqual({ attempted: 1, accepted: 1, refused: 0 });
    expect(tally.bySystem.library).toEqual({ attempted: 2, accepted: 1, refused: 1 });
    // The page turned, but nobody did any work at the Table.
    expect(tally.byCategory.advance).toEqual({ attempted: 1, accepted: 1, refused: 0 });
    expect(tally.byLoad.ambiguous.attempted).toBe(0);
  });

  it('reads accepted commands off a save, and a refusal leaves no row', () => {
    const s = newGame(loadContent(), { seed: 19920, campaign: 'short', decider: 'chronicler' });
    expect(s.order({ kind: 'marriages', policy: 'in' }).ok).toBe(true);
    expect(s.order({ kind: 'study', person: 'nobody', book: 'nothing' }).ok).toBe(false);
    s.advance();
    const rows = acceptedCommands(s.save().decisionLog).map(r => classifyCommand(r.command).category);
    expect(rows).toContain('order:marriages');
    expect(rows).toContain('advance');
    expect(rows).not.toContain('order:study');
  });
});

describe("the bot proxy's order observer (#1992)", () => {
  it('forwards each order untouched and counts what the session kept', () => {
    const s = newGame(loadContent(), { seed: 19921, campaign: 'short', decider: 'chronicler' });
    const tally = emptyCommandTally();
    observeOrders(s, tally);
    expect(s.order({ kind: 'marriages', policy: 'out' })).toEqual({ ok: true });
    const refused = s.order({ kind: 'tutor', person: 'nobody', attr: 'mind' });
    expect(refused.ok).toBe(false);
    expect(s.muster({ op: 'withdraw' }).ok).toBe(false);
    expect(s.order({ kind: 'nonsense' } as unknown as TableOrder).ok).toBe(false);
    expect(tally.byCategory['order:marriages']).toEqual({ attempted: 1, accepted: 1, refused: 0 });
    expect(tally.byCategory['order:tutor']).toEqual({ attempted: 1, accepted: 0, refused: 1 });
    expect(tally.byCategory['muster:withdraw']).toEqual({ attempted: 1, accepted: 0, refused: 1 });
    expect(Object.keys(tally.byCategory).sort()).toEqual(['muster:withdraw', 'order:marriages', 'order:tutor']);
    // The save agrees: only the accepted order left a row.
    expect(acceptedCommands(s.save().decisionLog).map(r => classifyCommand(r.command).category)).toEqual(['order:marriages']);
  });

  it('lets a throw through and counts nothing for it', () => {
    const failing = { order: () => { throw new Error('engine'); }, muster: () => ({ ok: true }) };
    const tally = emptyCommandTally();
    observeOrders(failing as unknown as GameSession, tally);
    expect(() => (failing as unknown as GameSession).order({ kind: 'bid', ceiling: 10 })).toThrow('engine');
    expect(tally.byCategory).toEqual({});
  });
});
