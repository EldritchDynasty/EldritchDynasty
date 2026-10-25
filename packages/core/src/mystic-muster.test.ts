import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { asId, MysticWorkingDefS, type MysticFieldBenefit, type Person } from '@ed/schema';
import { beginCommitment, addOfficer, musterExposure, musterUpkeep, tickMuster, withdrawCommitment } from './muster.js';
import { assignDuty, fieldCareFor, fieldCasualties, fieldSupplySaving, lifeCareFor, mysticUpkeep,
  mysticView, quoteDuty, releaseDuty, tickFieldAccount, tickFieldRisks, tickMystic } from './mystic.js';
import { deployedPeople, resolvePresence } from './presence.js';
import { canonical, digestOf, loadGame, saveGame } from './save.js';
import { rollDeath } from './people/demography.js';
import { ransomCaptive } from './people/captivity.js';
import { relate } from './people/relationships.js';
import { ensureHead } from './people/succession.js';
import { place, testWorld, testRng } from './testing.js';
import { streamFor, type Rng } from './rng.js';
import type { SimCtx } from './world.js';
import { DEBT_FLOOR } from './economy.js';

const authored = loadContent().bundle;
const noRisk = { death: 0, capture: 0, injury: 0, ransom: 35 };
// Mechanism fixtures deliberately isolate each reader from field accidents.
const care = MysticWorkingDefS.parse({ id: 'test_field_care', name: 'Field care', affinity: 'life',
  books: ['lesser_workings_of_life'], description: 'Care for a wounded levy.',
  preparation: { crowns: 8, years: 0 }, upkeep: 2,
  benefit: { kind: 'field_care', risk: noRisk, casualtyReduction: 0.5, officerReduction: 0.5 } });
const supply = MysticWorkingDefS.parse({ ...care, id: 'test_field_supply', affinity: 'fluid',
  books: ['lesser_workings_of_fluid'], benefit: { kind: 'field_supply', risk: noRisk, crownsPerMan: 0.3, maxMen: 12 } });
const watch = MysticWorkingDefS.parse({ ...care, id: 'test_field_watch', affinity: 'light',
  books: ['lesser_workings_of_light'], benefit: { kind: 'field_watch', risk: noRisk, opportunityChance: 0.5, credit: 1 } });
const cloak = MysticWorkingDefS.parse({ ...care, id: 'test_field_concealment', affinity: 'darkness',
  books: ['lesser_workings_of_darkness'], benefit: { kind: 'field_concealment', risk: noRisk, captureReduction: 0.6, observationReduction: 0.6 } });
const content = { ...authored, mysticWorkings: [...authored.mysticWorkings, care, supply, watch, cloak] };

function world(seed = 1874) {
  const ctx = testWorld(content, seed);
  ctx.world.treasury = 500;
  const c = beginCommitment(ctx, 11, 'the_wars');
  // Keep enough men for the small-levy rounding witness at every starting tier.
  c.men = 11;
  return { ctx, c };
}
function reader(ctx: SimCtx, working = care, sex: 'male' | 'female' = 'female', house?: string) {
  const p = place(ctx, { name: 'Maud', sex, age: 30, ...(house ? { house } : {}) });
  p.spellsKnown = working.books.map(b => asId(b));
  return p;
}
function send(ctx: SimCtx, p: Person, working = care) {
  const c = ctx.world.muster.commitments.find(c => c.status === 'in_the_field')!;
  const order = { person: String(p.id), working: working.id, target: { kind: 'muster' as const, commitment: c.id } };
  expect(assignDuty(ctx, order).ok).toBe(true);
  return order;
}
function serve(ctx: SimCtx) { ctx.world.year += 1; tickMystic(ctx); }
function fixed(roll: number, seen: number[] = []): Rng {
  return { next: () => roll, bool: (p: number) => { seen.push(p); return roll < p; } } as unknown as Rng;
}

describe('one learned body, one actual commitment (#1874)', () => {
  it('requires completed knowledge and accepts a female specialist without a military post', () => {
    const { ctx, c } = world();
    const p = reader(ctx);
    p.spellsKnown = [];
    const order = { person: String(p.id), working: care.id, target: { kind: 'muster' as const, commitment: c.id } };
    expect(quoteDuty(ctx, order).gap).toBe('unlearned');
    p.spellsKnown = care.books.map(b => asId(b));
    expect(assignDuty(ctx, order).ok).toBe(true);
    expect(p.career).toBeUndefined();
    expect(c.officers).not.toContain(p.id);
    expect(quoteDuty(ctx, { ...order, working: 'sickroom_watch', target: { kind: 'hall', hall: 'main' } }).ok).toBe(false);
    expect(addOfficer(ctx, p.id)).toBe(false);
  });

  it('removes home presence during travel and an unpaid suspension, then returns it on release', () => {
    const { ctx } = world();
    const p = reader(ctx);
    const order = send(ctx, p);
    expect(deployedPeople(ctx).has(p.id)).toBe(true);
    expect(resolvePresence(ctx, { kind: 'hall', hall: 'main' }, {}).people).not.toContain(p.id);
    expect(resolvePresence(ctx, order.target, {}).people).toContain(p.id);
    ctx.world.treasury = -1_000_000;
    serve(ctx);
    expect(ctx.world.mystic.assignments[0]).toMatchObject({ status: 'suspended', reason: 'unpaid' });
    expect(deployedPeople(ctx).has(p.id)).toBe(true);
    expect(releaseDuty(ctx, ctx.world.mystic.assignments[0]!.id).ok).toBe(true);
    expect(deployedPeople(ctx).has(p.id)).toBe(false);
  });

  it('cannot keep home care and field care at once, or attach an old order to a new war', () => {
    const { ctx, c } = world();
    const p = reader(ctx);
    expect(assignDuty(ctx, { person: p.id, working: 'sickroom_watch', target: { kind: 'hall', hall: 'main' } }).ok).toBe(true);
    serve(ctx);
    const ward = place(ctx, { sex: 'male', age: 0 });
    tickMystic(ctx);
    expect(lifeCareFor(ctx, ward)).toBeDefined();
    expect(quoteDuty(ctx, { person: p.id, working: care.id, target: { kind: 'muster', commitment: c.id } }).ok).toBe(false);
    releaseDuty(ctx, ctx.world.mystic.assignments[0]!.id);
    const order = send(ctx, p);
    expect(lifeCareFor(ctx, ward)).toBeUndefined();
    expect(withdrawCommitment(ctx)).toBe(true);
    beginCommitment(ctx, 5, 'the_wars');
    expect(ctx.world.mystic.assignments).toHaveLength(0);
    expect(quoteDuty(ctx, order).gap).toBe('target_lost');
    expect(c.fieldService).toHaveLength(1);
  });
});

describe('field readers change the existing war account (#1874)', () => {
  it('accumulates recoverable losses in a small levy and leaves the tide draw unchanged', () => {
    const a = world(); const b = world();
    send(a.ctx, reader(a.ctx)); reader(b.ctx);
    for (let year = 0; year < 2; year++) {
      serve(a.ctx); serve(b.ctx);
      tickMuster(a.ctx, testRng('the same tide'));
      tickMuster(b.ctx, testRng('the same tide'));
      expect(a.ctx.world.muster.tide).toBe(b.ctx.world.muster.tide);
    }
    expect(a.c.men).toBe(b.c.men + 1);
    expect(a.ctx.world.mystic.assignments[0]!.service).toMatchObject({ menKept: 1, usefulYears: 1 });
    a.ctx.world.people.kill(a.ctx.world.mystic.assignments[0]!.practitioner, a.ctx.world.year, 'the control');
    expect(fieldCasualties(a.ctx, a.c, 2)).toBe(2);
  });

  it('keeps a named officer only on the same roll that would have killed him without care', () => {
    const a = world(); const b = world();
    const carer = reader(a.ctx); reader(b.ctx);
    const officerA = place(a.ctx, { name: 'Wren', sex: 'male', age: 30 });
    const officerB = place(b.ctx, { name: 'Wren', sex: 'male', age: 30 });
    addOfficer(a.ctx, officerA.id); addOfficer(b.ctx, officerB.id);
    send(a.ctx, carer); serve(a.ctx); serve(b.ctx);
    const seen: number[] = [];
    rollDeath(officerB, b.ctx, fixed(0.999999, seen));
    const reduction = musterExposure(a.ctx, officerA).ordinary - musterExposure(a.ctx, officerA).hazard;
    const roll = seen[0]! - reduction / 2;
    expect(rollDeath(officerA, a.ctx, fixed(roll))).toBe(false);
    expect(rollDeath(officerB, b.ctx, fixed(roll))).toBe(true);
    expect(a.ctx.world.mystic.assignments[0]!.service.livesKept).toBe(1);
  });

  it('reduces supplies in the economy quote only while the paid reader is available', () => {
    const { ctx, c } = world();
    const p = reader(ctx, supply, 'male');
    send(ctx, p, supply); serve(ctx);
    expect(fieldSupplySaving(ctx, c)).toBeCloseTo(3.3);
    expect(musterUpkeep(ctx)).toBeCloseTo(11 * 1.2 - 3.3);
    tickFieldAccount(ctx, c);
    expect(ctx.world.mystic.assignments[0]!.service.crownsKept).toBeCloseTo(3.3);
    p.fieldRecoveryUntil = ctx.world.year + 2;
    expect(fieldSupplySaving(ctx, c)).toBe(0);
    expect(musterUpkeep(ctx)).toBeCloseTo(11 * 1.2);
  });

  it('reserves the year once across duties and still charges after a field return', () => {
    const { ctx } = world();
    send(ctx, reader(ctx)); send(ctx, reader(ctx, watch), watch);
    ctx.world.treasury = DEBT_FLOOR + 2; // only one upkeep fits
    serve(ctx);
    expect(ctx.world.mystic.assignments.filter(a => a.status === 'serving')).toHaveLength(1);
    expect(mysticUpkeep(ctx)).toBe(2);
    withdrawCommitment(ctx);
    expect(mysticUpkeep(ctx)).toBe(2);
  });
});

describe('field risk, captivity and the saved account (#1874)', () => {
  function riskyWorld(seed: number, risk: MysticFieldBenefit['risk']) {
    const dangerous = { ...care, benefit: { kind: 'field_care' as const, casualtyReduction: 0.5, officerReduction: 0.5, risk } };
    const source = { ...content, mysticWorkings: content.mysticWorkings.map(w => w.id === care.id ? dangerous : w) };
    const ctx = testWorld(source, seed); ctx.world.treasury = 500;
    const c = beginCommitment(ctx, 11, 'the_wars');
    const p = reader(ctx);
    const captor = source.houses.find(h => !h.isPlayerHouse)!.id;
    relate(ctx.world, ctx.world.playerHouse, captor, -30);
    return { ctx, c, p, captor, source };
  }

  it('automatically captures a reader, preserves paused study, and uses the normal ransom path', () => {
    let witnessed = false;
    for (let seed = 1; seed <= 80; seed++) {
      const { ctx, c, p, captor, source } = riskyWorld(seed, { ...noRisk, capture: 0.1 });
      ctx.world.studies.push({ person: p.id, book: asId('greater_workings_of_life'), completes: ctx.world.year + 4 });
      send(ctx, p); serve(ctx);
      const roll = streamFor(ctx.world, 'mystic-field-risk', c.id, p.id).next();
      if (roll >= 0.15) continue;
      tickFieldRisks(ctx, c);
      expect(p.captivity).toMatchObject({ captor, ransom: 35, studies: [{ remainingYears: 4 }] });
      expect(fieldCareFor(ctx, c)).toBeUndefined();
      expect(c.fieldService?.[0]).toMatchObject({ fate: 'captured' });
      const loaded = loadGame(JSON.parse(JSON.stringify(saveGame(ctx))), source);
      expect(digestOf(loaded)).toBe(digestOf(ctx));
      expect(ransomCaptive(loaded, p.id).ok).toBe(true);
      expect(loaded.world.people.get(p.id)!.captivity).toBeUndefined();
      witnessed = true; break;
    }
    expect(witnessed).toBe(true);
  });

  it('retains recovery after release and reproduces its exact save', () => {
    let witnessed = false;
    for (let seed = 1; seed <= 80; seed++) {
      const { ctx, c, p, source } = riskyWorld(seed, { ...noRisk, injury: 0.15 });
      const order = send(ctx, p); serve(ctx);
      if (streamFor(ctx.world, 'mystic-field-risk', c.id, p.id).next() >= 0.225) continue;
      tickFieldRisks(ctx, c);
      expect(p.fieldRecoveryUntil).toBe(ctx.world.year + 2);
      releaseDuty(ctx, ctx.world.mystic.assignments[0]!.id);
      expect(quoteDuty(ctx, order).gap).toBe('wounded');
      const loaded = loadGame(JSON.parse(JSON.stringify(saveGame(ctx))), source);
      expect(loaded.world.people.get(p.id)!.fieldRecoveryUntil).toBe(p.fieldRecoveryUntil);
      expect(digestOf(loaded)).toBe(digestOf(ctx));
      witnessed = true; break;
    }
    expect(witnessed).toBe(true);
  });

  it('opposition uses a named learned body and finite wealth, without exposing its duty in the Table', () => {
    const { ctx, c } = world();
    const house = content.houses.find(h => !h.isPlayerHouse)!.id;
    relate(ctx.world, ctx.world.playerHouse, house, -30);
    const enemy = reader(ctx, cloak, 'female', house);
    send(ctx, reader(ctx, watch), watch);
    const opposing = ctx.world.mystic.assignments.find(a => a.house === house);
    expect(opposing?.practitioner).toBe(enemy.id);
    expect(releaseDuty(ctx, opposing!.id).ok).toBe(false);
    expect(ctx.world.mystic.foreignSpent?.[house]).toBe(8);
    expect(mysticView(ctx).duties).toHaveLength(1);
    serve(ctx);
    expect(ctx.world.mystic.foreignSpent?.[house]).toBe(10);
    expect(mysticUpkeep(ctx)).toBe(2);
    const loaded = loadGame(JSON.parse(JSON.stringify(saveGame(ctx))), content);
    expect(canonical(saveGame(loaded).mystic)).toBe(canonical(saveGame(ctx).mystic));
    enemy.spellsKnown = [];
    tickMystic(ctx);
    expect(ctx.world.mystic.assignments.some(a => a.house === house)).toBe(false);
    expect(c.opponent).toBe(house);
  });

  it('does not replace a foreign reader’s completed books or exhausted purse with innate ability', () => {
    const { ctx } = world();
    const house = content.houses.find(h => !h.isPlayerHouse)!.id;
    relate(ctx.world, ctx.world.playerHouse, house, -30);
    const enemy = reader(ctx, cloak, 'female', house);
    enemy.spellsKnown = [];
    send(ctx, reader(ctx, watch), watch);
    expect(ctx.world.mystic.assignments.some(a => a.house === house)).toBe(false);
    enemy.spellsKnown = cloak.books.map(b => asId(b));
    const wealth = ctx.world.houses.get(house)!.wealth;
    const ledger = ctx.world.mystic.foreignSpent = { [house]: wealth };
    serve(ctx);
    expect(ctx.world.mystic.assignments.some(a => a.house === house)).toBe(false);
    // Setup can be paid alone, but does not buy a free serving year.
    ledger[house] = wealth - cloak.preparation.crowns;
    serve(ctx);
    expect(ctx.world.mystic.assignments.find(a => a.house === house)?.status).toBe('preparing');
    serve(ctx);
    expect(ctx.world.mystic.assignments.find(a => a.house === house)).toMatchObject({ status: 'suspended', reason: 'unpaid' });
    ledger[house] = wealth - cloak.upkeep;
    serve(ctx);
    expect(ctx.world.mystic.assignments.find(a => a.house === house)?.status).toBe('serving');
    serve(ctx);
    expect(ctx.world.mystic.assignments.find(a => a.house === house)).toMatchObject({ status: 'suspended', reason: 'unpaid' });
  });

  it('the actual opposing concealer changes only a matching local sighting', () => {
    let witnessed = false;
    for (let seed = 1; seed <= 80; seed++) {
      const { ctx, c } = world(seed);
      const house = content.houses.find(h => !h.isPlayerHouse)!.id;
      relate(ctx.world, ctx.world.playerHouse, house, -30);
      const enemy = reader(ctx, cloak, 'female', house);
      send(ctx, reader(ctx, watch), watch); serve(ctx);
      const roll = streamFor(ctx.world, 'mystic-field-opportunity', c.id).next();
      if (roll < 0.2 || roll >= 0.5) continue;
      const control = loadGame(JSON.parse(JSON.stringify(saveGame(ctx))), content);
      control.world.people.get(enemy.id)!.status = 'missing';
      tickFieldAccount(ctx, c);
      tickFieldAccount(control, control.world.muster.commitments[0]!);
      expect(c.credit).toBe(0);
      expect(control.world.muster.commitments[0]!.credit).toBe(1);
      expect(ctx.world.mystic.assignments.find(a => a.house === house)!.service.usefulYears).toBe(1);
      witnessed = true; break;
    }
    expect(witnessed).toBe(true);
  });

  it('resolves a named person’s existing hostility to that person’s actual house', () => {
    const { ctx, c } = world();
    ctx.world.relationships.clear();
    const house = content.houses.find(h => !h.isPlayerHouse)!.id;
    const enemy = reader(ctx, cloak, 'female', house);
    const own = reader(ctx, watch);
    relate(ctx.world, own.id, enemy.id, -30);
    send(ctx, own, watch);
    expect(c.opponent).toBe(house);
    expect(ctx.world.mystic.assignments.find(a => a.house === house)?.practitioner).toBe(enemy.id);
  });

  it('concealment prevents a real capture only while the assigned reader is present', () => {
    let witnessed = false;
    for (let seed = 1; seed <= 80; seed++) {
      const { ctx, c, p, source } = riskyWorld(seed, { ...noRisk, capture: 0.1 });
      send(ctx, p);
      const hidden = reader(ctx, cloak); send(ctx, hidden, cloak); serve(ctx);
      const roll = streamFor(ctx.world, 'mystic-field-risk', c.id, p.id).next();
      if (roll < 0.06 || roll >= 0.15) continue;
      const control = loadGame(JSON.parse(JSON.stringify(saveGame(ctx))), source);
      control.world.people.get(hidden.id)!.status = 'missing';
      tickFieldRisks(ctx, c);
      tickFieldRisks(control, control.world.muster.commitments[0]!);
      expect(p.captivity).toBeUndefined();
      expect(control.world.people.get(p.id)!.captivity).toBeDefined();
      witnessed = true; break;
    }
    expect(witnessed).toBe(true);
  });

  it('field deaths use the normal kill gate, including the founder’s guardian redirection', () => {
    for (const founder of [false, true]) {
      let witnessed = false;
      for (let seed = 1; seed <= 80; seed++) {
        const { ctx, c, p } = riskyWorld(seed, { ...noRisk, death: 0.05 });
        const person = founder ? ctx.world.people.get(ctx.world.narrator!)! : reader(ctx, care, 'male');
        if (!founder) {
          for (const member of ctx.world.people.all()) member.castSlots = member.castSlots.filter(slot => slot !== 'head');
          person.castSlots.push('head');
        }
        person.spellsKnown = care.books.map(b => asId(b));
        send(ctx, person); serve(ctx);
        if (streamFor(ctx.world, 'mystic-field-risk', c.id, person.id).next() >= 0.075) continue;
        tickFieldRisks(ctx, c);
        expect(person.status).toBe(founder ? 'guardian' : 'dead');
        expect(fieldCareFor(ctx, c)).toBeUndefined();
        expect(ctx.world.mystic.assignments).toHaveLength(0);
        if (!founder) {
          ensureHead(ctx, testRng('field succession'));
          expect(ctx.world.people.living().some(member => member.castSlots.includes('head'))).toBe(true);
        }
        witnessed = true; break;
      }
      expect(witnessed).toBe(true);
    }
  });
});
