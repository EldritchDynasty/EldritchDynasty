import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadContent } from '@ed/content';
import { canBeTaught, proseOriginalHash } from '@ed/schema';
import {
  beginTutoring, DEMIGOD_AGEING_STOPPED, LEDGER_SEARCH_FEE, order, place, setProseMode, setProseVariants, missingPlainEnglish,
  tableView, testWorld, TUTOR_FEE, type SimCtx, type TableOrder,
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
