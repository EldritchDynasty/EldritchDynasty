import { describe, expect, it, vi } from 'vitest';
import { loadContent } from '@ed/content';
import {
  asId, CovertAttemptS, CovertDrawsS, CovertObservationS, CovertWarningS,
  type CovertAttempt, type CovertDefence, type CovertDraws,
} from '@ed/schema';
import { place, testWorld } from './testing.js';
import { addGrudge } from './people/relationships.js';
import { saveGame, loadGame } from './save.js';
import { applyEffect } from './events/effects.js';
import { assessHarm } from './events/harm.js';
import { captureFamily, ransomCaptive } from './people/captivity.js';
import { streamFor } from './rng.js';
import {
  covertDefenceQuote, covertDraws, covertPreparationQuote, observeCovertApproach,
  resolveCovertAttempt, type CovertResolved,
} from './covert.js';

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
          const parcel = [...ctx.world.parcels.values()].find(p => content.parcel(p.defId)?.kind === 'tenant_farm')!;
          guard.spellsKnown = working.books.map(book => asId(book));
          ctx.world.mystic.assignments.push({
            id: 'mys_other', practitioner: guard.id, working: working.id,
            target: { kind: 'parcel', parcel: parcel.defId, slots: [] }, bindings: {},
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
