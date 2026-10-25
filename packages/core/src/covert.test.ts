import { describe, expect, it, vi } from 'vitest';
import { loadContent } from '@ed/content';
import {
  asId, CovertAttemptS, CovertDrawsS, CovertObservationS, CovertWarningS,
  EventTemplateS, SeedPersonS, type ProseMode, type SavedGame,
  type CovertAttempt, type CovertDefence, type CovertDraws,
} from '@ed/schema';
import { place, testWorld, phase } from './testing.js';
import { addGrudge } from './people/relationships.js';
import { saveGame, loadGame, canonical } from './save.js';
import { applyEffect } from './events/effects.js';
import { assessHarm } from './events/harm.js';
import { captureFamily, ransomCaptive } from './people/captivity.js';
import { streamFor } from './rng.js';
import {
  covertDefenceQuote, covertDraws, covertPreparationQuote, observeCovertApproach,
  resolveCovertAttempt, type CovertResolved,
} from './covert.js';

import { assignDuty, householdProtection, quoteDuty, releaseDuty, tickMystic } from './mystic.js';
import { defendHousehold, householdSecurityView, householdThreatCandidates, quoteThreatResponse,
  releaseThreatPrisoner, tickHouseholdThreats } from './covert-lifecycle.js';
import { DEBT_FLOOR, tickEconomy } from './economy.js';
import { genomeOf, phenotypeOf } from './people/factory.js';
import { ELDRITCH_GIFT } from './genetics/expression.js';
import { newGame, resumeGame } from './session.js';
import { replay } from './replay.js';

const content = loadContent();
const dice: CovertDraws = { warning: 0.99, prevention: 0.99, strike: 0, survival: 0.99, escape: 0, evidence: 0.99 };

function scene(guardSex: 'male' | 'female' = 'female') {
  const ctx = testWorld(content, 1914);
  const target = place(ctx, { sex: 'female', age: 28, name: 'Intended target' });
  const sponsor = place(ctx, { sex: 'male', age: 40, house: 'house_marrow', name: 'Unseen patron' });
  const operative = place(ctx, { sex: 'female', age: 24, house: 'house_marrow', name: 'Unseen operative' });
  const guard = place(ctx, { sex: guardSex, age: 30, name: 'Named guard' });
  const grudge = addGrudge(ctx, sponsor.id, target.id, { severity: 60, inheritance: 'house_wide' });
  const preparedAt = ctx.world.year;
  ctx.world.year += 2;
  const attempt: CovertAttempt = {
    id: 'covert_1', sponsor: sponsor.id, operative: operative.id, target: target.id,
    motive: { kind: 'grudge', grudge: grudge.id },
    site: { kind: 'hall', hall: 'main', visitors: ['INTRUDER'] }, bindings: { INTRUDER: operative.id },
    preparation: 'careful', preparedAt, attemptYear: ctx.world.year, paidCrowns: 45,
  };
  const defence: CovertDefence = { guards: [], response: 'ordinary', paidCrowns: 0 };
  return { ctx, target, sponsor, operative, guard, attempt, defence, grudge };
}

function resolved(result: ReturnType<typeof resolveCovertAttempt>): CovertResolved {
  expect(result.kind).toBe('resolved');
  if (result.kind !== 'resolved') throw new Error(result.reason);
  return result;
}

function completeState(ctx: ReturnType<typeof scene>['ctx']) {
  return JSON.stringify({ ...saveGame(ctx), savedAt: '' });
}

describe('bounded named-threat resolver (#1914 / #1875)', () => {
  it('proposes named normal harm and leaves all world changes to the single commit path', () => {
    const { ctx, target, attempt, defence } = scene();
    const before = completeState(ctx);
    const kill = vi.spyOn(ctx.world.people, 'kill');
    const result = resolved(resolveCovertAttempt(ctx, attempt, defence, 'attempt', dice));
    expect(result.target).toBe('dead');
    expect(result.normal.bindings).toEqual({ COVERT_TARGET: target.id });
    expect(result.normal.effects).toEqual([
      { kind: 'status', target: { slot: 'COVERT_TARGET' }, status: 'dead', cause: 'covert_attack' },
    ]);
    expect(kill).not.toHaveBeenCalled();
    expect(completeState(ctx)).toBe(before);
    for (const effect of result.normal.effects) applyEffect(effect, ctx, result.normal.bindings);
    expect(kill).toHaveBeenCalledWith(target.id, ctx.world.year, 'covert_attack');
    expect(target.status).toBe('dead');
  });

  it('survival proposes an acquired injury rather than killing or rewriting the genome', () => {
    const { ctx, target, attempt, defence } = scene();
    const result = resolved(resolveCovertAttempt(ctx, attempt, defence, 'attempt', { ...dice, survival: 0 }));
    expect(result.target).toBe('wounded');
    expect(target.acquired.health).toBeUndefined();
    for (const effect of result.normal.effects) applyEffect(effect, ctx, result.normal.bindings);
    expect(target.status).toBe('alive');
    expect(target.acquired.health).toBe(-8);
  });

  it('the existing primordial assessor sees only the normal harm left after prevention', () => {
    const { ctx, target, guard, attempt, defence } = scene();
    const roll = { ...dice, prevention: 0.2 };
    const ordinary = resolved(resolveCovertAttempt(ctx, attempt, defence, 'attempt', roll));
    expect(assessHarm(ctx, ordinary.normal, ordinary.normal.bindings).deaths).toEqual([target.id]);
    const guarded = resolved(resolveCovertAttempt(ctx, attempt, { ...defence, guards: [guard.id], paidCrowns: 8 }, 'attempt', roll));
    expect(guarded.prevented).toBe(true);
    expect(assessHarm(ctx, guarded.normal, guarded.normal.bindings).categories).toEqual([]);
    expect(target.status).toBe('alive');
  });

  it.each(['sponsor', 'operative', 'target'] as const)('rejects an unknown %s', role => {
    const { ctx, attempt, defence } = scene();
    attempt[role] = 'no_such_person';
    expect(resolveCovertAttempt(ctx, attempt, defence, 'attempt', dice)).toEqual({ kind: 'refused', reason: `invalid_${role}` });
  });

  it.each(['dead', 'missing', 'guardian'] as const)('rejects a %s target', status => {
    const { ctx, target, attempt, defence } = scene();
    if (status === 'dead') ctx.world.people.kill(target.id, ctx.world.year, 'test');
    else target.status = status;
    expect(resolveCovertAttempt(ctx, attempt, defence)).toEqual({ kind: 'refused', reason: 'invalid_target' });
  });

  it('never targets the living founder or a captive', () => {
    const { ctx, target, attempt, defence } = scene();
    target.becomesGuardian = true;
    expect(resolveCovertAttempt(ctx, attempt, defence)).toEqual({ kind: 'refused', reason: 'invalid_target' });
    target.becomesGuardian = false;
    target.membership[0]!.kind = 'hostage';
    expect(resolveCovertAttempt(ctx, attempt, defence)).toEqual({ kind: 'refused', reason: 'invalid_target' });
  });

  it('does not turn the founder’s death exemption into a ban on living actors or guards', () => {
    const { ctx, sponsor, operative, guard, attempt, defence } = scene();
    sponsor.becomesGuardian = true;
    operative.becomesGuardian = true;
    guard.becomesGuardian = true;
    expect(resolveCovertAttempt(ctx, attempt, { ...defence, guards: [guard.id], paidCrowns: 8 }).kind).toBe('resolved');
    guard.status = 'guardian';
    expect(resolveCovertAttempt(ctx, attempt, { ...defence, guards: [guard.id], paidCrowns: 8 }))
      .toEqual({ kind: 'refused', reason: 'invalid_guard' });
  });

  it.each(['missing', 'hostage', 'child', 'disabled', 'different_house'] as const)('refuses a %s operative', gap => {
    const { ctx, operative, attempt, defence } = scene();
    switch (gap) {
      case 'missing': operative.status = 'missing'; break;
      case 'hostage': operative.membership[0]!.kind = 'hostage'; break;
      case 'child': operative.born = ctx.world.year - 15; break;
      case 'disabled': operative.acquired.health = -20; break;
      case 'different_house': operative.membership[0]!.house = asId('house_ilm'); break;
    }
    expect(resolveCovertAttempt(ctx, attempt, defence)).toEqual({ kind: 'refused', reason: 'invalid_operative' });
  });

  it('reads the directed grievance rather than reversing it or inventing hostility', () => {
    const { ctx, target, sponsor, attempt, defence } = scene();
    ctx.world.relationships.clear();
    const reverse = addGrudge(ctx, target.id, sponsor.id, { severity: 90, inheritance: 'none' });
    reverse.originYear = attempt.preparedAt;
    attempt.motive.grudge = reverse.id;
    expect(resolveCovertAttempt(ctx, attempt, defence)).toEqual({ kind: 'refused', reason: 'no_motive' });
    ctx.world.relationships.clear();
    expect(resolveCovertAttempt(ctx, attempt, defence)).toEqual({ kind: 'refused', reason: 'no_motive' });
  });

  it('accepts an inherited current-house feud but not a departed spouse’s birth-house feud', () => {
    const { ctx, target, sponsor, attempt, defence } = scene();
    ctx.world.relationships.clear();
    const inherited = addGrudge(ctx, 'house_marrow', ctx.world.playerHouse, { severity: 60, inheritance: 'house_wide' });
    inherited.originYear = attempt.preparedAt;
    attempt.motive.grudge = inherited.id;
    expect(resolveCovertAttempt(ctx, attempt, defence).kind).toBe('resolved');
    sponsor.membership[0]!.house = asId('house_ilm');
    // Keep the operative in the sponsor's new household: only the motive changed.
    ctx.world.people.mustGet(attempt.operative).membership[0]!.house = asId('house_ilm');
    expect(sponsor.houseOfOrigin).toBe('house_marrow');
    expect(target.status).toBe('alive');
    expect(resolveCovertAttempt(ctx, attempt, defence)).toEqual({ kind: 'refused', reason: 'no_motive' });
  });

  it.each(['minor', 'later', 'gone'] as const)('rejects a %s grievance', state => {
    const { ctx, attempt, defence, grudge } = scene();
    if (state === 'minor') grudge.severity = 39;
    if (state === 'later') grudge.originYear = attempt.preparedAt + 1;
    if (state === 'gone') attempt.motive.grudge = 'forgotten_grievance';
    expect(resolveCovertAttempt(ctx, attempt, defence)).toEqual({ kind: 'refused', reason: 'no_motive' });
  });

  it.each([-1, 1])('does not resolve %i years outside the due year', delta => {
    const { ctx, attempt, defence } = scene();
    ctx.world.year += delta;
    expect(resolveCovertAttempt(ctx, attempt, defence)).toEqual({ kind: 'refused', reason: 'not_due' });
  });

  it('requires finite paid preparation and the actual preparation term', () => {
    const { ctx, attempt, defence } = scene();
    expect(covertPreparationQuote('hasty')).toEqual({ crowns: 20, years: 1 });
    expect(covertPreparationQuote('careful')).toEqual({ crowns: 45, years: 2 });
    attempt.paidCrowns = 44;
    expect(resolveCovertAttempt(ctx, attempt, defence)).toEqual({ kind: 'refused', reason: 'unpaid' });
    attempt.paidCrowns = 45;
    attempt.preparedAt = attempt.attemptYear - 1;
    expect(resolveCovertAttempt(ctx, attempt, defence)).toEqual({ kind: 'refused', reason: 'unprepared' });
  });

  it('has no opportunity when the operative never reached the scene', () => {
    const { ctx, attempt, defence } = scene();
    attempt.site = { kind: 'hall', hall: 'main' };
    expect(resolveCovertAttempt(ctx, attempt, defence)).toEqual({ kind: 'refused', reason: 'no_opportunity' });
  });

  it('a hall watch cannot protect a journey or another hall', () => {
    const { ctx, target, operative, guard, attempt, defence } = scene();
    attempt.site = { kind: 'party', slots: ['TRAVELLERS'] };
    attempt.bindings = { TRAVELLERS: [target.id, operative.id] };
    defence.guards = [guard.id]; defence.paidCrowns = 8;
    expect(resolveCovertAttempt(ctx, attempt, defence)).toEqual({ kind: 'refused', reason: 'invalid_guard' });
    attempt.site = { kind: 'hall', hall: 'main', visitors: ['INTRUDER'] };
    attempt.bindings = { INTRUDER: operative.id };
    target.membership[0]!.branch = 'elsewhere_hall';
    expect(resolveCovertAttempt(ctx, attempt, defence)).toEqual({ kind: 'refused', reason: 'no_opportunity' });
  });

  it.each(['unknown', 'duplicate', 'target', 'operative', 'hostage', 'missing', 'away', 'deployed', 'disabled', 'duty_elsewhere'] as const)(
    'cannot buy guard coverage with a %s guard', gap => {
      const { ctx, target, operative, guard, attempt, defence } = scene(gap === 'duty_elsewhere' ? 'male' : 'female');
      defence.guards = [guard.id]; defence.paidCrowns = 24;
      switch (gap) {
        case 'unknown': defence.guards = ['phantom']; break;
        case 'duplicate': defence.guards = [guard.id, guard.id]; break;
        case 'target': defence.guards = [target.id]; break;
        case 'operative': defence.guards = [operative.id]; break;
        case 'hostage': guard.membership[0]!.kind = 'hostage'; break;
        case 'missing': guard.status = 'missing'; break;
        case 'away': guard.career = { career: asId('court'), from: ctx.world.year }; break;
        case 'disabled': guard.acquired.health = -20; break;
        case 'deployed': ctx.world.muster.commitments.push({
          id: 'field', began: ctx.world.year, age: 'the_wars', men: 10, from: {}, officers: [guard.id], credit: 0, status: 'in_the_field',
        }); break;
        case 'duty_elsewhere': {
          const working = content.mysticWorkings.find(w => w.benefit.kind === 'estate_protection')!;
          const parcel = content.parcels.find(p => p.kind === 'tenant_farm'
            && [...ctx.world.parcels.values()].some(held => held.defId === p.id))!;
          guard.spellsKnown = working.books.map(book => asId(book));
          ctx.world.mystic.assignments.push({
            id: 'mys_other', practitioner: guard.id, working: working.id,
            target: { kind: 'parcel', parcel: parcel.id, slots: [] }, bindings: {},
            started: ctx.world.year - 1, ready: ctx.world.year, paidPreparation: 0,
            paidThrough: ctx.world.year, status: 'serving',
            service: { servedYears: 1, usefulYears: 0, livesKept: 0, yieldKept: 0, spent: 0 },
          }); break;
        }
      }
      expect(resolveCovertAttempt(ctx, attempt, defence)).toEqual({ kind: 'refused', reason: 'invalid_guard' });
    },
  );

  it('guards, safe lodging and escorts each change the same ordinary roll without guaranteeing safety', () => {
    const { ctx, guard, attempt, defence } = scene();
    const roll = { ...dice, warning: 0, prevention: 0.2 };
    expect(resolved(resolveCovertAttempt(ctx, attempt, defence, 'attempt', roll)).target).toBe('dead');
    const guarded = { ...defence, guards: [guard.id], paidCrowns: 8 };
    expect(resolved(resolveCovertAttempt(ctx, attempt, guarded, 'attempt', roll)).prevented).toBe(true);
    const sheltered = { ...defence, response: 'safe_lodging' as const, paidCrowns: 16 };
    expect(resolved(resolveCovertAttempt(ctx, attempt, sheltered, 'attempt', roll)).prevented).toBe(true);
    const escorted = { ...guarded, response: 'escort' as const, paidCrowns: 20 };
    const escortRoll = { ...roll, prevention: 0.3 };
    expect(resolved(resolveCovertAttempt(ctx, attempt, guarded, 'attempt', escortRoll)).target).toBe('dead');
    expect(resolved(resolveCovertAttempt(ctx, attempt, escorted, 'attempt', escortRoll)).prevented).toBe(true);
    expect(resolved(resolveCovertAttempt(ctx, attempt, escorted, 'attempt', { ...dice, warning: 0 })).target).toBe('dead');
  });

  it('a stronger response needs both an actionable warning and its payment', () => {
    const { ctx, attempt, defence } = scene();
    defence.response = 'safe_lodging'; defence.paidCrowns = 16;
    expect(resolveCovertAttempt(ctx, attempt, defence, 'attempt', dice)).toEqual({ kind: 'refused', reason: 'no_warning' });
    defence.paidCrowns = 15;
    expect(resolveCovertAttempt(ctx, attempt, defence, 'attempt', { ...dice, warning: 0 })).toEqual({ kind: 'refused', reason: 'unpaid' });
    expect(covertDefenceQuote(3, 'ordinary')).toBe(24);
    expect(() => covertDefenceQuote(4, 'ordinary')).toThrow();
    expect(() => covertDefenceQuote(1.5, 'ordinary')).toThrow();
  });

  it('lodging does not cover an open journey, and an escort needs an actual escort', () => {
    const { ctx, target, operative, attempt, defence } = scene();
    attempt.site = { kind: 'elsewhere', slots: ['PARTY'] };
    attempt.bindings = { PARTY: [target.id, operative.id] };
    defence.response = 'safe_lodging'; defence.paidCrowns = 16;
    expect(resolveCovertAttempt(ctx, attempt, defence, 'attempt', { ...dice, warning: 0 })).toEqual({ kind: 'refused', reason: 'wrong_place' });
    defence.response = 'escort';
    expect(resolveCovertAttempt(ctx, attempt, defence, 'attempt', { ...dice, warning: 0 })).toEqual({ kind: 'refused', reason: 'invalid_guard' });
  });

  it('a paid named watch changes warning without implying prevention or a sponsor’s identity', () => {
    const { ctx, guard, target, sponsor, operative, attempt, defence } = scene();
    const roll = { ...dice, warning: 0.2 };
    expect(observeCovertApproach(ctx, attempt, defence, roll)).toEqual({ kind: 'approach', warning: undefined });
    const seen = observeCovertApproach(ctx, attempt, { guards: [guard.id], paidCrowns: 8 }, roll);
    expect(seen.kind).toBe('approach');
    if (seen.kind !== 'approach') throw new Error(seen.reason);
    expect(CovertWarningS.parse(seen.warning)).toEqual({
      occurrence: attempt.id, target: target.id, year: ctx.world.year, trace: 'observed_approach',
    });
    expect(JSON.stringify(seen)).not.toContain(sponsor.id);
    expect(JSON.stringify(seen)).not.toContain(operative.id);
    const result = resolved(resolveCovertAttempt(ctx, attempt, { ...defence, guards: [guard.id], paidCrowns: 8 }, 'attempt', roll));
    expect(result.warned).toBe(true);
    expect(result.target).toBe('dead');
    expect(observeCovertApproach(ctx, attempt, { guards: [guard.id], paidCrowns: 7 }, roll))
      .toEqual({ kind: 'refused', reason: 'unpaid' });
  });

  it('keeps success, failure, survival, withdrawal and exposure independently reachable', () => {
    const { ctx, guard, operative, sponsor, attempt, defence } = scene();
    const watch = { ...defence, guards: [guard.id], paidCrowns: 8 };
    const concealedDeath = resolved(resolveCovertAttempt(ctx, attempt, watch, 'attempt', dice));
    expect(concealedDeath.target).toBe('dead');
    expect(concealedDeath.observation?.identifiedOperative).toBeUndefined();
    const exposedDeath = resolved(resolveCovertAttempt(ctx, attempt, watch, 'attempt', { ...dice, evidence: 0 }));
    expect(exposedDeath.target).toBe('dead');
    expect(exposedDeath.observation?.identifiedOperative).toBe(operative.id);
    expect(exposedDeath.observation?.witnesses).toEqual([guard.id]);
    const exposedMiss = resolved(resolveCovertAttempt(ctx, attempt, watch, 'attempt', { ...dice, strike: 0.99, evidence: 0 }));
    expect(exposedMiss.target).toBe('unharmed');
    expect(exposedMiss.observation?.identifiedOperative).toBe(operative.id);
    expect(resolved(resolveCovertAttempt(ctx, attempt, watch, 'attempt', { ...dice, survival: 0 })).target).toBe('wounded');
    const withdrawal = resolved(resolveCovertAttempt(ctx, attempt, watch, 'withdraw', dice));
    expect(withdrawal.operative).toBe('withdrawn');
    expect(withdrawal.normal.effects).toEqual([]);
    expect(withdrawal.observation).toBeUndefined();
    expect(JSON.stringify(exposedDeath.observation)).not.toContain(sponsor.id);
  });

  it('custody requires present captors and reveals only the operative, leaving actual capture uncommitted', () => {
    const { ctx, guard, operative, attempt, defence } = scene();
    const roll = { ...dice, escape: 0.99 };
    expect(resolved(resolveCovertAttempt(ctx, attempt, defence, 'attempt', roll)).operative).toBe('escaped');
    const result = resolved(resolveCovertAttempt(ctx, attempt, { ...defence, guards: [guard.id], paidCrowns: 8 }, 'attempt', roll));
    expect(result.operative).toBe('captured');
    expect(result.observation?.capturedOperative).toBe(operative.id);
    expect(result.observation?.identifiedOperative).toBe(operative.id);
    expect(result.normal.effects).not.toContainEqual(expect.objectContaining({ status: 'missing' }));
    expect(operative.captivity).toBeUndefined();
    expect(operative.status).toBe('alive');
    expect(CovertObservationS.safeParse(result.observation).success).toBe(true);
  });

  it('an unwitnessed killing cannot generate a witness, and an unseen failed approach reveals nothing', () => {
    const { ctx, attempt, defence } = scene();
    const death = resolved(resolveCovertAttempt(ctx, attempt, defence, 'attempt', { ...dice, evidence: 0 }));
    expect(death.observation?.identifiedOperative).toBeUndefined();
    expect(death.observation?.witnesses).toEqual([]);
    const stopped = resolved(resolveCovertAttempt(ctx, attempt, defence, 'attempt', { ...dice, prevention: 0 }));
    expect(stopped.prevented).toBe(true);
    expect(stopped.observation).toBeUndefined();
    const withdrawn = resolved(resolveCovertAttempt(ctx, attempt, defence, 'withdraw', { ...dice, warning: 0 }));
    expect(withdrawn.warned).toBe(false);
    expect(withdrawn.observation).toBeUndefined();
  });

  it('withdraws before travel or payment for a response, even when the old opportunity has gone', () => {
    const { ctx, target, attempt, defence } = scene();
    ctx.world.people.kill(target.id, ctx.world.year, 'unrelated');
    ctx.world.year -= 1;
    attempt.site = { kind: 'elsewhere', slots: [] };
    defence.response = 'safe_lodging';
    const before = completeState(ctx);
    const result = resolved(resolveCovertAttempt(ctx, attempt, defence, 'withdraw'));
    expect(result.operative).toBe('withdrawn');
    expect(result.normal.effects).toEqual([]);
    expect(result.observation).toBeUndefined();
    expect(completeState(ctx)).toBe(before);
  });

  it('uses the same guards and resolution rules for a stored outsider’s defence', () => {
    const { ctx, target, guard, attempt, defence } = scene();
    target.membership[0]!.house = asId('house_ilm');
    guard.membership[0]!.house = asId('house_ilm');
    attempt.site = { kind: 'party', slots: ['PRESENT'] };
    attempt.bindings = { PRESENT: [target.id, guard.id, attempt.operative] };
    const result = resolved(resolveCovertAttempt(ctx, attempt, { ...defence, guards: [guard.id], paidCrowns: 8 }, 'attempt', { ...dice, prevention: 0.2 }));
    expect(result.prevented).toBe(true);
    guard.membership[0]!.house = asId(ctx.world.playerHouse);
    expect(resolveCovertAttempt(ctx, attempt, { ...defence, guards: [guard.id], paidCrowns: 8 }))
      .toEqual({ kind: 'refused', reason: 'invalid_guard' });
  });

  it('a captured family operative can use the existing custody and fixed-ransom return path', () => {
    const { ctx, target, sponsor, operative, guard, attempt, defence } = scene();
    target.membership[0]!.house = asId('house_ilm');
    guard.membership[0]!.house = asId('house_ilm');
    sponsor.membership[0]!.house = asId(ctx.world.playerHouse);
    operative.membership[0]!.house = asId(ctx.world.playerHouse);
    attempt.site = { kind: 'party', slots: ['PRESENT'] };
    attempt.bindings = { PRESENT: [target.id, guard.id, operative.id] };
    const result = resolved(resolveCovertAttempt(ctx, attempt, { ...defence, guards: [guard.id], paidCrowns: 8 }, 'attempt', { ...dice, escape: 0.99 }));
    expect(result.operative).toBe('captured');
    expect(operative.captivity).toBeUndefined();
    expect(captureFamily(ctx, operative.id, 'house_ilm', 40)).toBe(true);
    expect(operative.captivity?.ransom).toBe(40);
    ctx.world.treasury = 100;
    expect(ransomCaptive(ctx, operative.id).ok).toBe(true);
    expect(operative.captivity).toBeUndefined();
    expect(ctx.world.people.householdOf(operative.id, ctx.world.year)).toBe(ctx.world.playerHouse);
    expect(ctx.world.treasury).toBe(60);
  });

  it('keyed stage draws survive other incidents, reordering and reload without changing a complete save', () => {
    const { ctx, attempt, defence } = scene();
    const before = completeState(ctx);
    const draws = covertDraws(ctx, attempt);
    const result = resolveCovertAttempt(ctx, attempt, defence);
    covertDraws(ctx, { ...attempt, id: 'covert_unrelated' });
    resolveCovertAttempt(ctx, { ...attempt, id: 'covert_unrelated' }, defence);
    expect(covertDraws(ctx, attempt)).toEqual(draws);
    expect(resolveCovertAttempt(ctx, attempt, defence)).toEqual(result);
    const loaded = loadGame(saveGame(ctx), content);
    expect(resolveCovertAttempt(loaded, attempt, defence)).toEqual(result);
    expect(completeState(ctx)).toBe(before);
    expect(streamFor(ctx.world, 'lifecycle').next()).toBe(streamFor(loaded.world, 'lifecycle').next());
    expect(streamFor(ctx.world, 'muster').next()).toBe(streamFor(loaded.world, 'muster').next());
  });

  it('never treats a shelf, raw affinity, Eldritch power or Madness as attack support', () => {
    const { ctx, target, operative, attempt, defence } = scene();
    const before = resolveCovertAttempt(ctx, attempt, defence, 'attempt', dice);
    const book = content.spellbooks[0]!;
    ctx.world.library.set(String(book.id), { id: String(book.id), condition: 100, acquiredYear: ctx.world.year });
    operative.acquired.life = 1000;
    operative.acquired.death = 1000;
    operative.madness = 1000;
    target.madness = 1000;
    expect(resolveCovertAttempt(ctx, attempt, defence, 'attempt', dice)).toEqual(before);
    expect(operative.madness).toBe(1000);
  });

  it('refuses malformed and nonfinite inputs before producing facts', () => {
    const { ctx, attempt, defence } = scene();
    expect(CovertAttemptS.safeParse({ ...attempt, paidCrowns: Infinity }).success).toBe(false);
    expect(CovertAttemptS.safeParse({ ...attempt, preparation: 'perfect' }).success).toBe(false);
    expect(CovertDrawsS.safeParse({ ...dice, evidence: 1 }).success).toBe(false);
    expect(resolveCovertAttempt(ctx, { ...attempt, paidCrowns: NaN }, defence)).toEqual({ kind: 'refused', reason: 'malformed' });
    expect(resolveCovertAttempt(ctx, attempt, { ...defence, paidCrowns: Infinity })).toEqual({ kind: 'refused', reason: 'malformed' });
    expect(resolveCovertAttempt(ctx, attempt, defence, 'attempt', { ...dice, survival: -1 })).toEqual({ kind: 'refused', reason: 'malformed' });
    expect(observeCovertApproach(ctx, attempt, { guards: [], paidCrowns: 0 }, { ...dice, escape: Infinity })).toEqual({ kind: 'refused', reason: 'malformed' });
  });
});

// Keep the incident mechanism and its short public-session witness in one suite.
describe('household lifecycle fixtures', () => {
  const start = 1042;
  function seedFor(predicate: (dice: CovertDraws, seed: number) => boolean): number {
    for (let seed = 1; seed < 100_000; seed++) {
      if (streamFor({ seed, year: start }, 'covert_preparation').next() >= 0.08) continue;
      if (predicate(covertDraws({ world: { seed, year: start + 2 } }, { id: 'cov_1', preparedAt: start }), seed)) return seed;
    }
    throw new Error('no built-state incident witness');
  }
  const fatalSeed = seedFor(d => d.prevention > 0.6 && d.strike < 0.4 && d.survival > 0.7 && d.survival < 0.94);

  function scene(seed = fatalSeed) {
    const ctx = testWorld(content, seed);
    for (const p of ctx.world.people.all()) p.awakening.awakened = false;
    ctx.world.relationships.clear(); ctx.world.treasury = 1000;
    const victim = place(ctx, { name: 'Nella', sex: 'female', age: 25 });
    const enemy = place(ctx, { name: 'Hostile neighbour', sex: 'male', age: 40, house: 'house_marrow' });
    const reader = place(ctx, { name: 'Maud', sex: 'female', age: 30, awakened: true });
    reader.spellsKnown = [asId('lesser_workings_of_life')];
    const guard = place(ctx, { name: 'Cesse', sex: 'female', age: 22 });
    addGrudge(ctx, enemy.id, victim.id, { severity: 70, inheritance: 'house_wide' });
    tickHouseholdThreats(ctx);
    const threat = ctx.world.covert.threats[0]!;
    expect(threat).toBeDefined();
    return { ctx, victim, enemy, reader, guard, threat };
  }
  function turn(ctx: ReturnType<typeof scene>['ctx']) {
    ctx.world.year += 1; tickMystic(ctx); tickEconomy(ctx); tickHouseholdThreats(ctx);
  }
  const saved = (ctx: ReturnType<typeof scene>['ctx']) => canonical(saveGame(ctx));

  describe('staged household security (#1875)', () => {
    it('prepares against actual hostility, spends foreign money once, and gives two years of notice', () => {
      const { ctx, enemy, victim, threat } = scene();
      expect(threat.plan).toMatchObject({ sponsor: enemy.id, target: victim.id, preparedAt: start, attemptYear: start + 2, paidCrowns: 20 });
      expect(ctx.world.mystic.foreignSpent?.house_marrow).toBe(20);
      expect(victim.status).toBe('alive');
      const before = saved(ctx);
      tickHouseholdThreats(ctx);
      expect(saved(ctx)).toBe(before);
      expect(ctx.world.covert.threats).toHaveLength(1);
      expect(householdSecurityView(ctx).threats[0]!.due).toBe(start + 2);
    });

    it('has no incident or clock question without an eligible hostile actor', () => {
      const ctx = testWorld(content, fatalSeed);
      ctx.world.relationships.clear();
      const before = saved(ctx);
      phase('covert', ctx, false);
      expect(saved(ctx)).toBe(before);
      expect(ctx.world.pendingDecisions).toEqual([]);
    });

    it('owning a ward never supplies a motive or increases preparation chances', () => {
      const { ctx, reader, victim } = scene();
      ctx.world.covert.threats = []; ctx.world.counters.covert = 0;
      delete ctx.world.mystic.foreignSpent;
      const control = loadGame(saveGame(ctx), content);
      expect(assignDuty(ctx, { person: reader.id, working: 'the_bedside_thread', target: { kind: 'person', person: victim.id } }).ok).toBe(true);
      expect(householdThreatCandidates(ctx).map(c => [c.sponsor.id, c.target.id, c.grudge]))
        .toEqual(householdThreatCandidates(control).map(c => [c.sponsor.id, c.target.id, c.grudge]));
      tickHouseholdThreats(ctx); tickHouseholdThreats(control);
      expect(ctx.world.covert.threats.map(t => t.plan)).toEqual(control.world.covert.threats.map(t => t.plan));
      ctx.world.relationships.clear(); ctx.world.covert.threats = [];
      expect(householdThreatCandidates(ctx)).toEqual([]);
    });

    it('does not target the founder, sitting Head or a small house', () => {
      const { ctx, victim } = scene();
      victim.castSlots.push('head');
      expect(householdThreatCandidates(ctx)).toEqual([]);
      victim.castSlots = []; victim.becomesGuardian = true;
      expect(householdThreatCandidates(ctx)).toEqual([]);
      victim.becomesGuardian = false;
      for (const p of ctx.world.people.living()) if (p.id !== victim.id) p.membership = [];
      expect(householdThreatCandidates(ctx)).toEqual([]);
    });

    it('an assigned woman changes the same named fatal incident, and removing only her restores death', () => {
      const { ctx, victim, reader } = scene();
      expect(assignDuty(ctx, { person: reader.id, working: 'the_bedside_thread', target: { kind: 'person', person: victim.id } }).ok).toBe(true);
      turn(ctx);
      const control = loadGame(saveGame(ctx), content);
      control.world.people.mustGet(reader.id).status = 'missing';
      turn(ctx); turn(control);
      expect(victim.status).toBe('alive');
      expect(victim.acquired.health).toBe(-8);
      expect(control.world.people.mustGet(victim.id).status).toBe('dead');
      expect(reader.career).toBeUndefined();
      expect(ctx.world.mystic.assignments[0]!.service.protections).toBe(1);
      expect(ctx.world.covert.threats[0]!.observation?.result).toBe('wounded');
      expect(ctx.world.chronicle.some(p => p.text?.includes(reader.name) && p.text.includes(victim.name))).toBe(true);
    });

    it('assesses only harm remaining after deliberate care and records the actual primordial replacement', () => {
      const seed = seedFor((d, s) => d.prevention > .6 && d.strike < .4 && d.survival > .7 && d.survival < .94
        && streamFor({ seed: s, year: start + 2 }, 'primordial:chr_1').next() < .8);
      const { ctx, victim, reader } = scene(seed);
      const source = ctx.world.people.living().find(p => phenotypeOf(p, ctx.genetics, ctx.world.year).eldritch.canExpress)!;
      const expresser = place(ctx, { name: 'The local expresser', sex: 'male', age: 30, awakened: true });
      expresser.genome = { kind: 'materialized', genome: genomeOf(source, ctx.genetics) };
      expresser.phenotype = undefined;
      expresser.acquired[ELDRITCH_GIFT] = 1000;
      assignDuty(ctx, { person: reader.id, working: 'the_bedside_thread', target: { kind: 'person', person: victim.id } });
      turn(ctx);
      const without = loadGame(saveGame(ctx), content);
      without.world.people.mustGet(reader.id).status = 'missing';
      const assessments: { deaths: string[]; probability: number; actor?: string }[] = [];
      const unprotected: typeof assessments = [];
      ctx.observePrimordial = o => assessments.push({ deaths: o.normal.deaths, probability: o.probability, actor: o.actor });
      without.observePrimordial = o => unprotected.push({ deaths: o.normal.deaths, probability: o.probability, actor: o.actor });
      turn(ctx); turn(without);
      expect(assessments).toEqual([{ deaths: [], probability: 0, actor: undefined }]);
      expect(unprotected[0]!.deaths).toEqual([victim.id]);
      expect(unprotected[0]!.actor).toBe(expresser.id);
      const actual = without.world.covert.threats[0]!;
      expect(actual.observation).toMatchObject({ result: 'prevented', witnesses: [] });
      expect(actual.observation?.identifiedOperative).toBeUndefined();
      expect(actual.prisoner).toBeUndefined();
      expect(without.world.people.mustGet(victim.id).status).toBe('alive');
      const log = without.world.decisionLog.find(d => d.kind === 'outcome' && d.event === 'covert_household_attempt');
      expect(log).toMatchObject({ selectedOutcomeId: 'dead', outcomeId: 'intervened', primordial: { actor: expresser.id } });
    });

    it('a man’s equally learned Life working has the same result without an Eldritch or Madness resource', () => {
      const { ctx, victim, reader } = scene();
      assignDuty(ctx, { person: reader.id, working: 'the_bedside_thread', target: { kind: 'person', person: victim.id } });
      const control = loadGame(saveGame(ctx), content);
      const man = control.world.people.mustGet(reader.id); man.sex = 'male'; man.madness = 1000;
      turn(ctx); turn(ctx); turn(control); turn(control);
      expect(control.world.people.mustGet(victim.id).status).toBe(victim.status);
      expect(control.world.people.mustGet(victim.id).acquired.health).toBe(victim.acquired.health);
      expect(man.madness).toBe(1000);
    });

    it.each(['unpaid', 'hostage', 'wounded', 'deployed', 'dead'] as const)('a %s maintainer provides no continuing protection', gap => {
      const { ctx, victim, reader } = scene();
      assignDuty(ctx, { person: reader.id, working: 'the_bedside_thread', target: { kind: 'person', person: victim.id } });
      turn(ctx);
      switch (gap) {
        case 'unpaid': ctx.world.treasury = DEBT_FLOOR; break;
        case 'hostage': reader.membership[0]!.kind = 'hostage'; break;
        case 'wounded': reader.acquired.health = -20; break;
        case 'dead': ctx.world.people.kill(reader.id, ctx.world.year, 'test'); break;
        case 'deployed': ctx.world.muster.commitments.push({ id: 'away', began: start, age: 'the_wars', men: 10, from: {}, officers: [reader.id], credit: 0, status: 'in_the_field' }); break;
      }
      turn(ctx);
      expect(victim.status).toBe('dead');
    });

    it('raw affinity and a shelf copy cannot substitute for a learned assigned reader', () => {
      const { ctx, victim, reader } = scene();
      reader.spellsKnown = []; reader.acquired.life = 1000;
      ctx.world.library.set('lesser_workings_of_life', { id: 'lesser_workings_of_life', condition: 100, acquiredYear: start });
      expect(quoteDuty(ctx, { person: reader.id, working: 'the_bedside_thread', target: { kind: 'person', person: victim.id } }).gap).toBe('unlearned');
      turn(ctx); turn(ctx);
      expect(victim.status).toBe('dead');
    });

    it('named care is home coverage, not protection for another person or an uncovered journey', () => {
      const { ctx, victim, reader, guard } = scene();
      assignDuty(ctx, { person: reader.id, working: 'the_bedside_thread', target: { kind: 'person', person: guard.id } });
      turn(ctx);
      expect(householdProtection(ctx, victim.id, { kind: 'hall', hall: 'main' }, {})).toEqual([]);
      expect(householdProtection(ctx, guard.id, { kind: 'party', slots: ['PARTY'] }, { PARTY: [guard.id, reader.id] })).toEqual([]);
      turn(ctx); expect(victim.status).toBe('dead');
    });

    it('pauses study for one primary duty and resumes only its remaining term on release', () => {
      const { ctx, victim, reader } = scene();
      const book = 'lesser_workings_of_light';
      ctx.world.library.set(book, { id: book, condition: 100, acquiredYear: start });
      ctx.world.studies.push({ person: reader.id, book, completes: start + 4 });
      assignDuty(ctx, { person: reader.id, working: 'the_bedside_thread', target: { kind: 'person', person: victim.id } });
      expect(ctx.world.studies).toEqual([]);
      expect(ctx.world.mystic.pauses[0]!.remainingYears).toBe(4);
      expect(quoteDuty(ctx, { person: reader.id, working: 'sickroom_watch', target: { kind: 'hall', hall: 'main' } }).ok).toBe(false);
      turn(ctx);
      releaseDuty(ctx, ctx.world.mystic.assignments[0]!.id);
      expect(ctx.world.studies[0]!.completes).toBe(ctx.world.year + 4);
    });

    it('a paid hall watcher reveals an approach without revealing its patron', () => {
      const { ctx, victim, reader, threat, enemy } = scene();
      reader.spellsKnown = [asId('lesser_workings_of_light')];
      assignDuty(ctx, { person: reader.id, working: 'the_door_lamp', target: { kind: 'hall', hall: 'main' } });
      ctx.world.year += 1; tickMystic(ctx);
      const draws = { warning: 0.4, prevention: 0.99, strike: 0, survival: 0.99, escape: 0, evidence: 0.99 };
      const seen = observeCovertApproach(ctx, threat.plan, threat.defence, draws);
      expect(seen.kind).toBe('approach');
      if (seen.kind !== 'approach') throw new Error(seen.reason);
      expect(seen.warning?.target).toBe(victim.id);
      expect(seen.support).toBe(ctx.world.mystic.assignments[0]!.id);
      expect(JSON.stringify(seen.warning)).not.toContain(enemy.id);
      const without = loadGame(saveGame(ctx), content);
      without.world.people.mustGet(reader.id).status = 'missing';
      expect(observeCovertApproach(without, threat.plan, threat.defence, draws)).toMatchObject({ warning: undefined });
    });

    it('does not turn a barrier’s unseen prevention into public testimony or an attack page', () => {
      const seed = seedFor((d, s) => d.prevention > .08 && d.prevention < .43 && d.warning > .2
        && covertDraws({ world: { seed: s, year: start + 1 } }, { id: 'cov_1', preparedAt: start }).warning > .2);
      const { ctx, reader, victim, threat } = scene(seed);
      reader.sex = 'male'; reader.spellsKnown = [asId('lesser_workings_of_terra')];
      expect(assignDuty(ctx, { person: reader.id, working: 'the_shut_threshold', target: { kind: 'hall', hall: 'main' } }).ok).toBe(true);
      turn(ctx); turn(ctx);
      expect(victim.status).toBe('alive');
      expect(threat).toMatchObject({ stage: 'resolved', warned: false });
      expect(threat.observation).toBeUndefined();
      expect(threat.page).toBeUndefined();
      expect(ctx.world.chronicle.some(p => p.eventId === 'covert_household_attempt')).toBe(false);
      expect(householdSecurityView(ctx).history[0]!.receipt).toContain('expired without an attack here');
    });

    it('distinct stages coexist, while overlapping prevention uses only the strongest actual reader', () => {
      const { ctx, victim, reader } = scene();
      reader.sex = 'male'; reader.spellsKnown = [asId('lesser_workings_of_terra')];
      const concealer = place(ctx, { sex: 'female', age: 30, awakened: true });
      concealer.spellsKnown = [asId('lesser_workings_of_darkness')];
      const watch = place(ctx, { sex: 'female', age: 30, awakened: true }); watch.spellsKnown = [asId('lesser_workings_of_light')];
      expect(assignDuty(ctx, { person: reader.id, working: 'the_shut_threshold', target: { kind: 'hall', hall: 'main' } }).ok).toBe(true);
      expect(assignDuty(ctx, { person: watch.id, working: 'the_door_lamp', target: { kind: 'hall', hall: 'main' } }).ok).toBe(true);
      expect(assignDuty(ctx, { person: concealer.id, working: 'the_unwatched_room', target: { kind: 'person', person: victim.id } }).ok).toBe(true);
      ctx.world.year += 1; tickMystic(ctx);
      const covered = householdProtection(ctx, victim.id, { kind: 'hall', hall: 'main' }, {});
      expect(covered.filter(c => c.stage === 'prevention')).toHaveLength(1);
      expect(covered.find(c => c.stage === 'prevention')!.bonus).toBe(0.35);
      expect(covered.find(c => c.stage === 'warning')!.bonus).toBe(0.4);
    });

    it('real payment, current guards and actionable evidence control the available responses', () => {
      const { ctx, guard, threat } = scene();
      const order = { threat: threat.plan.id, guards: [guard.id], response: 'ordinary' as const };
      const before = ctx.world.treasury;
      expect(quoteThreatResponse(ctx, order).price).toBe(8);
      expect(defendHousehold(ctx, order).ok).toBe(true);
      expect(ctx.world.treasury).toBe(before - 8);
      expect(defendHousehold(ctx, order).ok).toBe(true);
      expect(ctx.world.treasury).toBe(before - 8);
      expect(quoteThreatResponse(ctx, { ...order, response: 'escort' }).ok).toBe(false);
      threat.warned = true;
      expect(quoteThreatResponse(ctx, { ...order, response: 'escort' }).price).toBe(12);
      ctx.world.treasury = DEBT_FLOOR;
      expect(quoteThreatResponse(ctx, { ...order, response: 'escort' })).toMatchObject({ ok: false, price: 12 });
      guard.status = 'missing';
      expect(quoteThreatResponse(ctx, order).ok).toBe(false);
    });

    it('refuses a new payment when the warned relative has left the scene or died', () => {
      const { ctx, victim, guard, threat } = scene();
      const order = { threat: threat.plan.id, guards: [guard.id], response: 'ordinary' as const };
      const money = ctx.world.treasury;
      victim.status = 'missing';
      expect(defendHousehold(ctx, order).ok).toBe(false);
      victim.status = 'alive';
      ctx.world.people.kill(victim.id, ctx.world.year, 'test');
      expect(defendHousehold(ctx, order).ok).toBe(false);
      expect(ctx.world.treasury).toBe(money);
    });

    it('save/reload preserves preparation, payments, knowledge and frozen receipts through resolution', () => {
      const { ctx, victim, reader, guard, threat } = scene();
      assignDuty(ctx, { person: reader.id, working: 'the_bedside_thread', target: { kind: 'person', person: victim.id } });
      defendHousehold(ctx, { threat: threat.plan.id, guards: [guard.id], response: 'ordinary' });
      turn(ctx);
      const loaded = loadGame(JSON.parse(JSON.stringify(saveGame(ctx))), content);
      turn(ctx); turn(loaded);
      expect(saved(loaded)).toBe(saved(ctx));
      const after = loadGame(JSON.parse(JSON.stringify(saveGame(ctx))), content);
      expect(after.world.covert.threats).toEqual(ctx.world.covert.threats);
    });

    it('format 38 starts with no invented threats and keeps an empty-world fingerprint', () => {
      const ctx = testWorld(content, 1800);
      const old = JSON.parse(JSON.stringify(saveGame(ctx)));
      old.format = 38; delete old.covert; delete old.counters.covert;
      const loaded = loadGame(old, content);
      expect(loaded.world.covert).toEqual({ threats: [] });
      expect(loaded.world.counters.covert).toBe(0);
    });

    it('captures a real intruder, preserves testimony after a witness dies, and releases through ordinary custody', () => {
      const seed = seedFor(d => d.escape > 0.95 && d.prevention > 0.5);
      const { ctx, guard, threat, enemy } = scene(seed);
      defendHousehold(ctx, { threat: threat.plan.id, guards: [guard.id], response: 'ordinary' });
      turn(ctx); turn(ctx);
      expect(enemy.captivity?.captor).toBe(ctx.world.playerHouse);
      expect(threat.prisoner).toBe(enemy.id);
      expect(threat.observation?.identifiedOperative).toBe(enemy.id);
      const evidence = structuredClone(threat.observation);
      ctx.world.people.kill(guard.id, ctx.world.year, 'test');
      expect(threat.observation).toEqual(evidence);
      expect(releaseThreatPrisoner(ctx, threat.plan.id).ok).toBe(true);
      expect(enemy.captivity).toBeUndefined();
      expect(releaseThreatPrisoner(ctx, threat.plan.id).ok).toBe(false);
    });

    it('the public view and an unseen attack page expose no sponsor, operative, motive or private odds', () => {
      const { ctx, enemy } = scene();
      const view = JSON.stringify(householdSecurityView(ctx));
      expect(view).not.toContain(enemy.id);
      expect(view).not.toMatch(/sponsor|operative|motive|probability|bonus|bindings/);
      turn(ctx); turn(ctx);
      const page = ctx.world.chronicle.find(p => p.eventId === 'covert_household_attempt');
      expect(page?.people).not.toContain(enemy.id);
      expect(page?.text).not.toContain(enemy.name);
    });
  });
});

// Keep the incident mechanism and its short public-session witness in one suite.
describe('public-session fixtures', () => {
  const bundle = loadContent().bundle;
  const house = bundle.prologue[0]!.grudges[0]!.house;
  // An ordinary event supplies completed learning and a directed grievance.
  // No live world is edited, no threat is inserted, and no dice are replaced.
  const introduction = EventTemplateS.parse({
    id: 'security_reader_fixture', title: 'A Reader Is Ready', tier: 'family', frequency: 'common',
    weight: 1e9, repeatable: false,
    purposes: ['test_magic_rule', 'worldbuild_through_action', 'change_relationship'],
    conditions: { all: [{ year: { op: 'lte', value: 1050 } }, { grudgeAgainstUs: { op: 'gte', value: 0 } }] },
    slots: { READER: { role: 'tutor', filters: [{ sex: 'female' }] }, ENEMY: { role: 'rival' } },
    body: 'The reader opens the primer.',
    interaction: { kind: 'narration', outcomes: [{ id: 'learned', text: 'The working has been learned.', effects: [
      { kind: 'relationship', from: { slot: 'READER' }, to: { slot: 'ENEMY' }, sentiment: -20,
        grudge: { severity: 80, inheritance: 'none' } },
      { kind: 'awakening', target: { slot: 'READER' } },
      { kind: 'spellbook', op: 'gain', target: { slot: 'READER' }, book: 'lesser_workings_of_life' },
    ] }] },
  });
  const source = { ...bundle, characters: [...bundle.characters,
    SeedPersonS.parse({ key: 'security_reader', name: 'Maud Threadkeeper', sex: 'female', born: 1007,
      house: 'house_gearithy', castSlots: ['tutor'] }),
    SeedPersonS.parse({ key: 'security_enemy', name: 'Known Hostile Neighbour', sex: 'male', born: 1002,
      house, castSlots: ['rival'] }),
  ], events: [...bundle.events, introduction] };
  const transport = <T>(value: T): T => JSON.parse(JSON.stringify(value));

  describe('public household-security commands (#1875)', () => {
    it.each<ProseMode>(['original', 'plainenglish'])('replays and resumes the paid response and actual incident in %s', mode => {
      const game = newGame(source, { seed: 3, decider: 'chronicler', proseMode: mode });
      const prologue = game.prologue()!;
      expect(game.found({ houseName: 'The Guarded House', heirloom: prologue.heirlooms[0]!.heirloom, grudge: house }).ok).toBe(true);
      let checkpoint: SavedGame | undefined;
      let assigned = false;
      let responded = false;
      for (let years = 0; years < 11; years++) {
        const table = game.table();
        const warning = table.security.threats[0];
        if (warning && !assigned) {
          const offer = table.mystic.offers.find(o => o.working === 'the_bedside_thread')!;
          const reader = offer.practitioners[0]!;
          expect(reader.name).toBe('Maud Threadkeeper');
          expect(game.order({ kind: 'mysticAssign', person: reader.person, working: offer.working,
            target: { kind: 'person', person: warning.target } }).ok).toBe(true);
          assigned = true;
          const response = game.table().security.threats[0]!.options.find(o => o.ok && o.order.guards.length === 1 && o.order.response === 'ordinary')!;
          expect(response.price).toBe(8);
          expect(game.order(response.order).ok).toBe(true);
          responded = true;
          checkpoint = transport(game.save());
          expect(checkpoint.covert.threats[0]!.stage).toBe('preparing');
        }
        game.advance(1);
      }
      expect(game.year).toBe(1053);
      expect({ assigned, responded }).toEqual({ assigned: true, responded: true });
      const saved = transport(game.save());
      expect(saved.covert.threats[0]).toMatchObject({ stage: 'resolved', observation: { result: 'wounded' } });
      expect(saved.mystic.assignments[0]!.service.protections).toBe(1);
      expect(saved.decisionLog.some(d => d.kind === 'command' && d.command.kind === 'order' && d.command.order.kind === 'covertDefend')).toBe(true);
      const played = replay(source, saved.decisionLog, saved.seed, 1042, saved.year - 1042, saved.campaign);
      expect(canonical(saveGame(played))).toBe(canonical(saved));
      const loaded = resumeGame(checkpoint!, source, { decider: 'chronicler', proseMode: mode });
      for (let remaining = game.year - loaded.year; remaining > 0; remaining--) loaded.advance(1);
      expect(canonical(loaded.save())).toBe(canonical(saved));
      expect(resumeGame(saved, source, { proseMode: mode === 'original' ? 'plainenglish' : 'original' }).table().security.history)
        .toEqual(game.table().security.history);
    });
  });
});
