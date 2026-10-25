import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { asId, type CovertDraws } from '@ed/schema';
import { place, testWorld, phase } from './testing.js';
import { addGrudge } from './people/relationships.js';
import { assignDuty, householdProtection, quoteDuty, releaseDuty, tickMystic } from './mystic.js';
import { covertDraws, observeCovertApproach, resolveCovertAttempt } from './covert.js';
import { defendHousehold, householdSecurityView, householdThreatCandidates, quoteThreatResponse,
  releaseThreatPrisoner, tickHouseholdThreats } from './covert-lifecycle.js';
import { canonical, loadGame, saveGame } from './save.js';
import { DEBT_FLOOR, tickEconomy } from './economy.js';
import { streamFor } from './rng.js';
import { genomeOf, phenotypeOf } from './people/factory.js';
import { ELDRITCH_GIFT } from './genetics/expression.js';

const content = loadContent();
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
    guard.status = 'missing';
    expect(quoteThreatResponse(ctx, order).ok).toBe(false);
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
