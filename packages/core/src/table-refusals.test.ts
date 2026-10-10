import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadContent } from '@ed/content';
import { canBeTaught, proseOriginalHash } from '@ed/schema';
import {
  beginTutoring, DEMIGOD_AGEING_STOPPED, LEDGER_SEARCH_FEE, order, place, setProseMode, setProseVariants, missingPlainEnglish,
  MAX_BOND, tableView, testWorld, TUTOR_FEE, type SimCtx, type TableOrder,
} from '@ed/core';
import { coreMessageAddress } from './messages.js';

const bundle = loadContent();
const source = readFileSync(new URL('./table.ts', import.meta.url), 'utf8');

/** Every `msg(ctx, key, original…)` call in table.ts whose key starts with one of `prefixes`. */
function keyed(prefixes: readonly string[]): [string, string][] {
  return [...source.matchAll(/msg\(ctx,\s*'([^']+)',\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g)]
    .map(([, key, literal]) => [key!, literal!.slice(1, -1)] as [string, string])
    .filter(([key]) => prefixes.some((prefix) => key.startsWith(prefix)));
}

function translate(ctx: SimCtx, rows: Record<string, [original: string, plain: string]>): void {
  setProseVariants(ctx, Object.entries(rows).map(([key, [original, plain]]) => ({
    address: coreMessageAddress(key),
    of: proseOriginalHash(original),
    plainenglish: plain,
  })));
  setProseMode(ctx, 'plainenglish');
}

/** The world facts a refusal must never move, in either mode. */
function stateOf(ctx: SimCtx) {
  const w = ctx.world;
  return {
    treasury: w.treasury,
    tutoring: JSON.stringify(w.tutoring),
    pending: w.pendingDecisions.length,
    clauses: [...w.clausesRecovered].sort(),
    chronicle: w.chronicle.length,
  };
}

/** The exact Original of every tutor, rite-offer and Ledger-search refusal (#810). */
const OFFER_ORIGINALS: Record<string, string> = {
  'table.tutor.no_subject': 'nothing anybody teaches',
  'table.tutor.unteachable': '{ATTRIBUTE} is not a thing a tutor can teach',
  'table.tutor.too_old': 'too old to be taught',
  'table.tutor.in_term': 'already in a term',
  'table.tutor.fee': 'the house cannot raise {FEE} crowns',
  'table.rite.closed': 'the Ledger has closed',
  'table.rite.pending': 'this rite is already before the house',
  'table.rite.standing': 'the house has not reached the standing this rite demands',
  'table.rite.unfielded_slot': 'the house cannot field {SLOT}',
  'table.rite.unfielded': 'the house cannot field the rite',
  'table.rite.no_candidate': 'nobody can stand as {SLOT}',
  'table.rite.repeat': 'he has already taken this rite',
  'table.rite.fallback': 'the family cannot field the rite',
  'table.ledger.closed': 'the Ledger has closed',
  'table.ledger.enough': 'the book already holds enough clauses for the last working',
  'table.ledger.no_demigod': 'nobody raised by the Unmaking has yet attained Demigod',
  'table.ledger.no_keeper': 'nobody living in the house can search the old contracts',
  'table.ledger.searched': 'the Ledger has already been searched this year',
  'table.ledger.fee': 'the house cannot raise {FEE} crowns for the search',
  'table.ledger.exhausted': 'the old contracts have nothing left to reveal',
  'table.ledger.exhausted_fallback': 'the old contracts have nothing left to reveal',
};

describe('tutor, rite-offer and Ledger-search refusals in Plain English (#810)', () => {
  it('pins every keyed Original at its own call site', () => {
    const found = keyed(['table.tutor.', 'table.rite.', 'table.ledger.']);
    expect(Object.fromEntries(found)).toEqual(OFFER_ORIGINALS);
    // One key per call site, even where two sites share the wording.
    expect(found).toHaveLength(Object.keys(OFFER_ORIGINALS).length);
  });

  it('translates a refused tutor term, substituting the attribute, and charges nothing', () => {
    const run = (plain: boolean) => {
      const ctx = testWorld(bundle, 8101, 1400);
      const child = place(ctx, { sex: 'male', age: 8, name: 'The Pupil' });
      ctx.world.treasury = 500;
      const body = ctx.content.attributes.find((a) => !canBeTaught(a.kind))!;
      if (plain) {
        translate(ctx, {
          'table.tutor.no_subject': [OFFER_ORIGINALS['table.tutor.no_subject']!, 'No tutor teaches that.'],
          'table.tutor.unteachable': [OFFER_ORIGINALS['table.tutor.unteachable']!, 'A tutor cannot teach {ATTRIBUTE}.'],
        });
      }
      const none = beginTutoring(ctx, child, 'no_such_attribute');
      const unteachable = beginTutoring(ctx, child, String(body.id));
      return { none, unteachable, name: body.name, state: stateOf(ctx), missing: missingPlainEnglish(ctx) };
    };
    const original = run(false);
    const translated = run(true);
    expect(original.none).toEqual({ ok: false, reason: 'nothing anybody teaches' });
    expect(original.unteachable).toEqual({ ok: false, reason: `${original.name} is not a thing a tutor can teach` });
    expect(translated.none).toEqual({ ok: false, reason: 'No tutor teaches that.' });
    expect(translated.unteachable).toEqual({ ok: false, reason: `A tutor cannot teach ${translated.name}.` });
    expect(translated.state).toEqual(original.state);
    expect(translated.missing).toEqual([]);
  });

  it('translates a tutor fee refusal with the fee filled in', () => {
    const ctx = testWorld(bundle, 8102, 1400);
    const child = place(ctx, { sex: 'male', age: 8, name: 'The Poor Pupil' });
    const taught = ctx.content.attributes.find((a) => canBeTaught(a.kind))!;
    ctx.world.treasury = -10_000;
    expect(beginTutoring(ctx, child, String(taught.id)).reason).toBe(`the house cannot raise ${TUTOR_FEE} crowns`);
    translate(ctx, {
      'table.tutor.fee': [OFFER_ORIGINALS['table.tutor.fee']!, 'The house does not have {FEE} crowns.'],
    });
    expect(beginTutoring(ctx, child, String(taught.id)))
      .toEqual({ ok: false, reason: `The house does not have ${TUTOR_FEE} crowns.` });
    expect(ctx.world.treasury).toBe(-10_000);
    expect(ctx.world.tutoring).toEqual([]);
  });

  it('translates a refused rite and Ledger search, on the order and on the table view alike', () => {
    const run = (plain: boolean) => {
      const ctx = testWorld(bundle, 8103, 1400);
      ctx.world.treasury = 500;
      if (plain) {
        translate(ctx, Object.fromEntries(Object.entries(OFFER_ORIGINALS)
          .filter(([key]) => key.startsWith('table.rite.') || key.startsWith('table.ledger.'))
          .map(([key, original]) => [key, [original, `plain:${key}${original.includes('{SLOT}') ? ' {SLOT}' : ''}${original.includes('{FEE}') ? ' {FEE}' : ''}`]])));
      }
      const orders: TableOrder[] = [{ kind: 'vesselRite' }, { kind: 'greatRite' }, { kind: 'unmaking' }, { kind: 'seekClause' }];
      const results = orders.map((o) => order(ctx, o));
      const view = tableView(ctx);
      return {
        results,
        viewed: [view.ledgerSearch.reason, view.vesselRite.reason, view.greatRite.reason, view.unmaking.reason],
        state: stateOf(ctx),
      };
    };
    const original = run(false);
    const translated = run(true);
    for (const r of original.results) {
      expect(r.ok).toBe(false);
      expect(Object.values(OFFER_ORIGINALS).some((o) => r.reason === o || r.reason?.startsWith(o.split('{')[0]!))).toBe(true);
    }
    for (const [i, r] of translated.results.entries()) {
      expect(r.ok).toBe(original.results[i]!.ok);
      expect(r.reason).toMatch(/^plain:table\.(rite|ledger)\./);
    }
    expect(translated.viewed.every((reason) => reason?.startsWith('plain:'))).toBe(true);
    expect(translated.state).toEqual(original.state);
  });

  it('fills the Ledger search fee in both modes', () => {
    const ctx = testWorld(bundle, 8104, 1400);
    const ascendant = place(ctx, { sex: 'male', age: 35, name: 'The Waiting Man', awakened: true });
    ascendant.rites.push('unmaking');
    ascendant.acquired[DEMIGOD_AGEING_STOPPED] = 1;
    place(ctx, {
      sex: 'male', age: 50, name: 'The Archivist',
      contract: {
        role: 'archivist', term: 'lifetime', wage: 3, loyalty: 70, boundTo: ascendant.id,
        onEmployerDeath: 'passes_to_heir', debt: 0, knowsSecrets: [],
      },
    });
    ctx.world.treasury = -10_000;
    const recovered = ctx.world.clausesRecovered.size;
    expect(order(ctx, { kind: 'seekClause' }).reason)
      .toBe(`the house cannot raise ${LEDGER_SEARCH_FEE} crowns for the search`);
    translate(ctx, {
      'table.ledger.fee': [OFFER_ORIGINALS['table.ledger.fee']!, 'The search costs {FEE} crowns the house does not have.'],
    });
    expect(order(ctx, { kind: 'seekClause' }).reason)
      .toBe(`The search costs ${LEDGER_SEARCH_FEE} crowns the house does not have.`);
    expect(ctx.world.clausesRecovered.size).toBe(recovered);
    expect(ctx.world.treasury).toBe(-10_000);
  });
});

/** The exact Original of every refusal `carryOut` writes itself (#811). */
const ORDER_ORIGINALS: Record<string, string> = {
  'table.order.study.unknown': 'nobody of this house by that name',
  'table.order.study.no_book': 'no such book',
  'table.order.study.not_held': 'the house does not hold it',
  'table.order.study.already': 'he is already at it, or already has it',
  'table.order.pedigree.unknown': 'nobody of this house by that name',
  'table.order.pedigree.fee': 'the house cannot raise {PRICE} crowns',
  'table.order.pedigree.covered': 'the record already shows that much',
  'table.order.bond.unknown': 'nobody of this house by that name',
  'table.order.bond.not_in_service': "they are not in the house's service",
  'table.order.bond.none_to_free': 'there is no bond on them to tear up',
  'table.order.bond.already': 'they are bonded already',
  'table.order.bond.range': 'a bond runs from 1 to {MAX} marks',
  'table.order.bond.fee': 'the house cannot advance {MARKS} marks',
  'table.order.bond.unwritable': 'that bond cannot be written',
  'table.order.tutor.unknown': 'nobody of this house by that name',
  'table.order.career.unknown': 'nobody of this house by that name',
  'table.order.career.no_post': 'no such post',
  'table.order.career.held': 'he already holds it',
  'table.order.career.too_young': 'too young for a post',
  'table.order.career.fee': 'the house cannot raise {FEE} crowns for the place',
  'table.order.bid.not_a_figure': 'not a figure',
  'table.order.scion.unknown': 'nobody of this house by that name',
  'table.order.scionHeir.self': 'the Scion cannot be his own heir',
  'table.order.scionHeir.unknown': 'nobody of this house by that name',
  'table.order.withhold.unknown': 'nobody of this house by that name',
};

describe('table order refusals in Plain English (#811)', () => {
  it('pins every keyed Original at its own call site', () => {
    const found = keyed(['table.order.']);
    expect(Object.fromEntries(found)).toEqual(ORDER_ORIGINALS);
    expect(found).toHaveLength(Object.keys(ORDER_ORIGINALS).length);
  });

  it('translates refused orders, tokens filled, without moving the world', () => {
    const run = (plain: boolean) => {
      const ctx = testWorld(bundle, 8111, 1400);
      ctx.world.treasury = 500;
      const servant = place(ctx, { sex: 'male', age: 30, name: 'The Clerk' });
      if (plain) {
        translate(ctx, Object.fromEntries(Object.entries(ORDER_ORIGINALS).map(([key, original]) => {
          const tokens = original.match(/\{[A-Z]+\}/g) ?? [];
          return [key, [original, [`plain:${key}`, ...tokens].join(' ')]];
        })));
      }
      const orders: TableOrder[] = [
        { kind: 'tutor', person: 'nobody', attr: 'wit' },
        { kind: 'withhold', person: 'nobody', hold: true },
        { kind: 'scion', person: 'nobody' },
        { kind: 'bid', ceiling: Number.NaN },
        { kind: 'bond', person: servant.id, op: 'free' },
        { kind: 'career', person: servant.id, career: 'no_such_post' },
      ];
      const results = orders.map((o) => order(ctx, o));
      return { results, state: stateOf(ctx), scion: ctx.world.scion, bid: ctx.world.bidCeiling };
    };
    const original = run(false);
    const translated = run(true);
    expect(original.results.map((r) => r.reason)).toEqual([
      'nobody of this house by that name',
      'nobody of this house by that name',
      'nobody of this house by that name',
      'not a figure',
      "they are not in the house's service",
      'no such post',
    ]);
    expect(translated.results.map((r) => r.reason)).toEqual([
      'plain:table.order.tutor.unknown',
      'plain:table.order.withhold.unknown',
      'plain:table.order.scion.unknown',
      'plain:table.order.bid.not_a_figure',
      'plain:table.order.bond.not_in_service',
      'plain:table.order.career.no_post',
    ]);
    expect(translated.results.map((r) => r.ok)).toEqual(original.results.map((r) => r.ok));
    expect({ ...translated, results: undefined }).toEqual({ ...original, results: undefined });
  });

  it('fills the bond range and advance into the translated reason', () => {
    const ctx = testWorld(bundle, 8112, 1400);
    const servant = place(ctx, { sex: 'male', age: 30, name: 'The Bound Clerk' });
    servant.contract = {
      role: 'archivist', term: 'lifetime', wage: 3, loyalty: 70, boundTo: servant.id,
      onEmployerDeath: 'passes_to_heir', debt: 0, knowsSecrets: [],
    };
    ctx.world.treasury = -10_000;
    const range = order(ctx, { kind: 'bond', person: servant.id, op: 'bind', marks: 0 });
    const fee = order(ctx, { kind: 'bond', person: servant.id, op: 'bind', marks: 40 });
    expect(range.reason).toBe(`a bond runs from 1 to ${MAX_BOND} marks`);
    expect(fee.reason).toBe('the house cannot advance 40 marks');
    translate(ctx, {
      'table.order.bond.range': [ORDER_ORIGINALS['table.order.bond.range']!, 'A bond must be between 1 and {MAX} marks.'],
      'table.order.bond.fee': [ORDER_ORIGINALS['table.order.bond.fee']!, 'The house cannot lend {MARKS} marks.'],
    });
    expect(order(ctx, { kind: 'bond', person: servant.id, op: 'bind', marks: 0 }))
      .toEqual({ ok: false, reason: `A bond must be between 1 and ${MAX_BOND} marks.` });
    expect(order(ctx, { kind: 'bond', person: servant.id, op: 'bind', marks: 40 }))
      .toEqual({ ok: false, reason: 'The house cannot lend 40 marks.' });
    expect(ctx.world.treasury).toBe(-10_000);
    expect(missingPlainEnglish(ctx)).toEqual([]);
  });
});
