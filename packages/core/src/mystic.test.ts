import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { asId, type Person, type SceneSite } from '@ed/schema';
import { DEBT_FLOOR, economyReading } from './economy.js';
import { rollDeath } from './people/demography.js';
import { beginStudy, canStudySpellbook, tickLibraryWear } from './people/library.js';
import { beginImprovement, damageParcel, landView } from './land.js';
import { order, tableView } from './table.js';
import { lifeCareFor, mysticView, quoteDuty, wardedYieldFactor } from './mystic.js';
import { resolvePresence } from './presence.js';
import { canonical, loadGame, saveGame } from './save.js';
import { runYears } from './year/step.js';
import { phase, place, testWorld } from './testing.js';
import type { Rng } from './rng.js';
import type { SimCtx } from './world.js';
import { improvementSupport } from './mystic-civilian.js';
import { tickEconomy } from './economy.js';

/**
 * #1866 B / #1873 — the Life/Terra pilot's merge-blocking mechanism claims.
 * Built state throughout: the claims are about who is where and what is
 * paid, and four hundred years of simulation would only make them rarer.
 */
const bundle = loadContent();
const SEAT: SceneSite = { kind: 'hall', hall: 'main' };
const FARM = 'hallowfield';
const farmSite: SceneSite = { kind: 'parcel', parcel: FARM, slots: ['WARDEN'] };

describe('learned collaborators change a paid land project (#1877)', () => {
  function team() {
    const { ctx } = world();
    const terra = reader(ctx, 'male', ['lesser_workings_of_terra', 'greater_workings_of_terra'], 'The surveyor');
    const thermal = reader(ctx, 'male', ['lesser_workings_of_thermal', 'greater_workings_of_thermal'], 'The kiln reader');
    const ordinary = landView(ctx).held.find(p => p.parcel === FARM)!.improveCost;
    for (const [person, working] of [[terra.id, 'setting_the_culverts'], [thermal.id, 'firing_the_liners']]) {
      expect(order(ctx, { kind: 'mysticAssign', person: person!, working: working!, target: farmSite }).ok).toBe(true);
    }
    ctx.world.year = Math.max(...ctx.world.mystic.assignments.map(a => a.ready));
    phase('mystic', ctx);
    return { ctx, terra, thermal, ordinary };
  }
  it('quotes and charges one bounded reduction while both paid readers occupy the same holding', () => {
    const { ctx, ordinary } = team();
    const quoted = landView(ctx).held.find(p => p.parcel === FARM)!.improveCost;
    expect(quoted).toBe(Math.ceil(ordinary * .75));
    expect(improvementSupport(ctx, FARM)!.assignments).toHaveLength(2);
    const before = ctx.world.treasury;
    expect(beginImprovement(ctx, FARM).ok).toBe(true);
    expect(ctx.world.treasury).toBe(before - quoted);
    expect(ctx.world.landImprovements[0]!.completes).toBe(ctx.world.year + 4);
    const services = ctx.world.mystic.assignments.map(a => a.service);
    expect(services.every(s => s.usefulYears === 1)).toBe(true);
    expect(services.reduce((n,s) => n + (s.crownsKept ?? 0), 0)).toBe(ordinary - quoted);
  });
  it.each(['missing', 'wounded', 'unpaid', 'another_place'] as const)('restores the ordinary price when only the Thermal role is %s', absence => {
    const { ctx, thermal, ordinary } = team();
    const duty = ctx.world.mystic.assignments.find(a => a.practitioner === thermal.id)!;
    switch (absence) {
      case 'missing': thermal.status = 'missing'; break;
      case 'wounded': thermal.acquired.health = -20; break;
      case 'unpaid': duty.paidThrough = ctx.world.year - 1; break;
      case 'another_place': duty.target = { kind: 'parcel', parcel: bundle.bundle.parcels.find(p => p.kind === 'tenant_farm' && p.id !== FARM)!.id, slots: [] }; break;
    }
    expect(landView(ctx).held.find(p => p.parcel === FARM)!.improveCost).toBe(ordinary);
    const before = ctx.world.treasury;
    expect(beginImprovement(ctx, FARM).ok).toBe(true);
    expect(ctx.world.treasury).toBe(before - ordinary);
  });
  it('retains the real team, paid year and quoted project through save/reload', () => {
    const { ctx } = team();
    const loaded = loadGame(JSON.parse(JSON.stringify(saveGame(ctx))), bundle);
    expect(landView(loaded).held).toEqual(landView(ctx).held);
    beginImprovement(ctx, FARM); beginImprovement(loaded, FARM);
    expect(canonical(saveGame(loaded))).toBe(canonical(saveGame(ctx)));
  });
});

describe('recurring civilian readers (#1877)', () => {
  const transport = <T>(value: T): T => JSON.parse(JSON.stringify(value));
  it('a named woman preserves a real copy, and losing only her learning restores its normal wear', () => {
    const { ctx } = world();
    const book = 'lesser_workings_of_death';
    ctx.world.library.set(book, { id: book, acquiredYear: 1041, condition: 80 });
    const p = reader(ctx, 'female', [book], 'The vellum keeper');
    expect(order(ctx, { kind: 'mysticAssign', person: p.id, working: 'the_still_binding', target: { kind: 'book', book } }).ok).toBe(true);
    ctx.world.year++; phase('mystic', ctx);
    const control = loadGame(transport(saveGame(ctx)), bundle);
    control.world.people.mustGet(p.id).spellsKnown = [];
    tickLibraryWear(ctx); tickLibraryWear(control);
    expect(ctx.world.library.get(book)!.condition).toBe(79.9);
    expect(control.world.library.get(book)!.condition).toBe(79.8);
    expect(ctx.world.mystic.assignments[0]!.service.bookWearKept).toBeCloseTo(.1);
    expect(p.career).toBeUndefined();
  });
  it('quotes and charges a real repair saving, then suspends care while the physical copy is away', () => {
    const { ctx } = world(); const book = 'lesser_workings_of_death';
    ctx.world.library.set(book, { id: book, acquiredYear: 1041, condition: 20 });
    const p = reader(ctx, 'female', ['lesser_workings_of_light'], 'The copyist');
    const ordinary = tableView(ctx).shelf.find(b => b.book === book)!.restore!.fee;
    expect(order(ctx, { kind: 'mysticAssign', person: p.id, working: 'the_copyists_light', target: { kind: 'book', book } }).ok).toBe(true);
    ctx.world.year++; phase('mystic', ctx);
    const quote = tableView(ctx).shelf.find(b => b.book === book)!.restore!;
    expect(quote.fee).toBeLessThan(ordinary);
    const before = ctx.world.treasury;
    expect(order(ctx, { kind: 'restore', book }).ok).toBe(true);
    expect(ctx.world.treasury).toBe(before - quote.fee);
    ctx.world.year++; phase('mystic', ctx);
    expect(ctx.world.mystic.assignments[0]).toMatchObject({ status: 'suspended', reason: 'not_resident' });
  });
  it('reduces actual food charges once and records the same saving in the single economy tally', () => {
    const { ctx } = world(); const p = reader(ctx, 'female', ['lesser_workings_of_death'], 'The larder keeper');
    expect(order(ctx, { kind: 'mysticAssign', person: p.id, working: 'the_still_larder', target: SEAT }).ok).toBe(true);
    ctx.world.year++; phase('mystic', ctx);
    const control = loadGame(transport(saveGame(ctx)), bundle);
    control.world.people.mustGet(p.id).spellsKnown = [];
    const kept = economyReading(ctx).provision!.reduce((sum,s) => sum + s.crowns, 0);
    expect(kept).toBeGreaterThan(0); expect(kept).toBeLessThanOrEqual(8 * .3);
    expect(economyReading(control).upkeep - economyReading(ctx).upkeep).toBeCloseTo(kept);
    const before = ctx.world.treasury; const report = tickEconomy(ctx);
    expect(ctx.world.treasury).toBeCloseTo(before + report.net);
    expect(ctx.world.mystic.assignments[0]!.service.crownsKept).toBeCloseTo(kept);
    const other = reader(ctx, 'male', ['lesser_workings_of_thermal'], 'Another keeper');
    expect(order(ctx, { kind: 'mysticAssign', person: other.id, working: 'the_dry_store', target: SEAT }).ok).toBe(false);
  });
  it('changes an actual injury and recovery term only with the learned available carer', () => {
    const { ctx } = world();
    const patient = place(ctx, { sex: 'female', age: 30 }); patient.acquired.health = -8;
    patient.fieldRecoveryUntil = ctx.world.year + 4;
    const p = reader(ctx, 'female', ['lesser_workings_of_life', 'greater_workings_of_life'], 'The carer');
    expect(order(ctx, { kind: 'mysticAssign', person: p.id, working: 'the_mending_watch', target: { kind: 'person', person: patient.id } }).ok).toBe(true);
    const control = loadGame(transport(saveGame(ctx)), bundle); control.world.people.mustGet(p.id).spellsKnown = [];
    ctx.world.year++; control.world.year++; phase('mystic', ctx); phase('mystic', control);
    expect(patient.acquired.health).toBe(-5); expect(control.world.people.mustGet(patient.id).acquired.health).toBe(-8);
    expect(patient.fieldRecoveryUntil).toBe(control.world.people.mustGet(patient.id).fieldRecoveryUntil! - 1);
  });
  it('earns a study year from three real lessons and preserves the lesson count across reload', () => {
    const { ctx } = world();
    const books = ctx.content.spellbooks.filter(b => b.affinity === 'light').sort((a,b) => b.studyYears - a.studyYears);
    const book = books[0]!;
    ctx.world.library.set(book.id, { id: book.id, acquiredYear: 1041, condition: 100 });
    const pupil = reader(ctx, 'female', [], 'The successor'); pupil.acquired.light = 100;
    expect(beginStudy(ctx, pupil, book)).toBe(true);
    const teacher = reader(ctx, 'female', books.map(b => b.id), 'The teacher');
    expect(order(ctx, { kind: 'mysticAssign', person: teacher.id, working: 'the_readers_lamp', target: { kind: 'person', person: pupil.id } }).ok).toBe(true);
    const term = ctx.world.studies.find(s => s.person === pupil.id)!; const due = term.completes;
    for (let year=0; year<2; year++) { ctx.world.year++; phase('mystic', ctx); }
    const loaded = loadGame(transport(saveGame(ctx)), bundle);
    ctx.world.year++; loaded.world.year++; phase('mystic', ctx); phase('mystic', loaded);
    expect(term.completes).toBe(due - 1);
    expect(ctx.world.mystic.assignments[0]!.service.studyYearsKept).toBe(1);
    expect(canonical(saveGame(loaded))).toBe(canonical(saveGame(ctx)));
  });
});

function reader(ctx: SimCtx, sex: 'male' | 'female', books: string[], name: string): Person {
  const p = place(ctx, { sex, age: 30, name, awakened: true });
  for (const b of books) p.spellsKnown.push(asId(b));
  return p;
}

/** One draw, fixed. `bool` records the hazard it was asked about. */
function fixedRng(roll: number, seen: number[] = []): Rng {
  return { next: () => roll, bool: (p: number) => { seen.push(p); return roll < p; } } as unknown as Rng;
}

function world(seed = 1873) {
  const ctx = testWorld(bundle, seed);
  ctx.world.treasury = 400;
  const infant = place(ctx, { sex: 'male', age: 0, name: 'Wren' });
  return { ctx, infant };
}

/** The same ward's hazard in an untouched world, read off the one draw `rollDeath` makes. */
function bareHazard(year: number, seed = 1873): number {
  const { ctx, infant } = world(seed);
  ctx.world.year = year;
  const p = infant;
  const seen: number[] = [];
  rollDeath(p, ctx, fixedRng(0.999999, seen));
  expect(seen).toHaveLength(1);
  return seen[0]!;
}

function serveCare(ctx: SimCtx, carer: Person, working = 'sickroom_watch') {
  const result = order(ctx, { kind: 'mysticAssign', person: carer.id, working, target: SEAT });
  expect(result).toMatchObject({ ok: true });
  ctx.world.year += 1;
  phase('mystic', ctx);
  const duty = ctx.world.mystic.assignments.find((a) => a.practitioner === carer.id)!;
  expect(duty.status).toBe('serving');
  return duty;
}

describe('Life care changes a real death roll (#1873)', () => {
  it('a roll the infant would have died on is survived only while the assigned carer is there', () => {
    const { ctx, infant } = world();
    const carer = reader(ctx, 'female', ['lesser_workings_of_life'], 'Maud');
    const duty = serveCare(ctx, carer);
    const hazard = bareHazard(ctx.world.year);
    const roll = hazard * 0.99;

    expect(rollDeath(infant, ctx, fixedRng(roll))).toBe(false);
    expect(duty.service).toMatchObject({ livesKept: 1, usefulYears: 1, firstUsefulAt: 1 });
    expect(ctx.world.chronicle.at(-1)).toMatchObject({ named: true, people: [carer.id, infant.id] });

    // The SAME roll, with only the carer taken away, is the old outcome.
    const removed = world();
    const sameCarer = reader(removed.ctx, 'female', ['lesser_workings_of_life'], 'Maud');
    serveCare(removed.ctx, sameCarer);
    removed.ctx.world.people.kill(sameCarer.id, removed.ctx.world.year, 'in the ordinary way');
    expect(lifeCareFor(removed.ctx, removed.infant)).toBeUndefined();
    expect(rollDeath(removed.infant, removed.ctx, fixedRng(roll))).toBe(true);
  });

  it('sits with the most at-risk residents only, and does nothing for anybody else', () => {
    const { ctx, infant } = world();
    // Fill the seat past what one carer can attend, with people in their prime.
    const hale = Array.from({ length: 8 }, (_, i) => place(ctx, { sex: 'male', age: 22 + i, name: `Hale${i}` }));
    const duty = serveCare(ctx, reader(ctx, 'female', ['lesser_workings_of_life'], 'Maud'));
    const max = ctx.content.mysticWorking('sickroom_watch')!.benefit;
    expect(max.kind === 'life_care' && duty.attended!.length).toBe(max.kind === 'life_care' ? max.maxWards : 0);
    expect(duty.attended).toContain(infant.id);
    const unattended = hale.filter((p) => !duty.attended!.includes(p.id));
    expect(unattended.length).toBeGreaterThan(0);
    for (const p of unattended) expect(lifeCareFor(ctx, p)).toBeUndefined();
    expect(lifeCareFor(ctx, infant)).toBeDefined();
  });

  it('never reaches a roll the house was always going to survive, nor one care cannot cover', () => {
    const { ctx, infant } = world();
    const duty = serveCare(ctx, reader(ctx, 'female', ['lesser_workings_of_life'], 'Maud'));
    const hazard = bareHazard(ctx.world.year);
    expect(rollDeath(infant, ctx, fixedRng(hazard * 1.01))).toBe(false);
    expect(duty.service.livesKept).toBe(0);
    expect(rollDeath(infant, ctx, fixedRng(0))).toBe(true);
  });

  it('a woman keeps the Threshold watch exactly as well as a man, and needs no post to do it', () => {
    const her = world();
    const him = world();
    serveCare(her.ctx, reader(her.ctx, 'female', ['lesser_workings_of_life'], 'Maud'));
    serveCare(him.ctx, reader(him.ctx, 'male', ['lesser_workings_of_life'], 'Maud'));
    const a = lifeCareFor(her.ctx, her.infant)!;
    const b = lifeCareFor(him.ctx, him.infant)!;
    expect(a.mortality).toBe(b.mortality);
    expect(a.infant).toBe(b.infant);
    expect(a.carer.career).toBeUndefined();
  });

  it('a shelf copy and a high raw affinity are not a practitioner', () => {
    const { ctx, infant } = world();
    ctx.world.library.set('lesser_workings_of_life', { id: 'lesser_workings_of_life', acquiredYear: 1042, condition: 100 });
    const unread = reader(ctx, 'female', [], 'Agnes');
    unread.acquired['life'] = 100;
    const quote = quoteDuty(ctx, { person: unread.id, working: 'sickroom_watch', target: SEAT });
    expect(quote).toMatchObject({ ok: false, gap: 'unlearned' });
    expect(order(ctx, { kind: 'mysticAssign', person: unread.id, working: 'sickroom_watch', target: SEAT }).ok).toBe(false);
    expect(lifeCareFor(ctx, infant)).toBeUndefined();
  });

  it('an unpaid year and a captive carer both provide nothing, and say why', () => {
    const { ctx, infant } = world();
    const carer = reader(ctx, 'female', ['lesser_workings_of_life'], 'Maud');
    const duty = serveCare(ctx, carer);

    ctx.world.year += 1;
    ctx.world.treasury = DEBT_FLOOR;
    phase('mystic', ctx);
    expect(duty).toMatchObject({ status: 'suspended', reason: 'unpaid' });
    expect(lifeCareFor(ctx, infant)).toBeUndefined();
    expect(economyReading(ctx).mystic).toBe(0);

    ctx.world.treasury = 400;
    carer.membership.at(-1)!.to = ctx.world.year + 1;
    carer.membership.push({ house: 'house_corran', kind: 'hostage', from: ctx.world.year + 1 } as Person['membership'][number]);
    ctx.world.year += 1;
    phase('mystic', ctx);
    expect(duty).toMatchObject({ status: 'suspended', reason: 'hostage' });
    expect(lifeCareFor(ctx, infant)).toBeUndefined();
    expect(tableView(ctx).mystic.duties[0]).toMatchObject({ gap: 'hostage', status: 'suspended' });
  });
});

describe('Terra protection changes a real harvest (#1873)', () => {
  function warded() {
    const ctx = testWorld(bundle, 1874);
    ctx.world.treasury = 400;
    const warden = reader(ctx, 'male', ['lesser_workings_of_terra'], 'Hob');
    expect(order(ctx, { kind: 'mysticAssign', person: warden.id, working: 'shoring_the_banks', target: farmSite }).ok).toBe(true);
    ctx.world.year += 2; // one year of preparation
    phase('mystic', ctx);
    const def = ctx.content.parcel(FARM)!;
    const state = [...ctx.world.parcels.values()].find((s) => s.defId === FARM)!;
    return { ctx, warden, def, state, duty: ctx.world.mystic.assignments[0]! };
  }

  it('holds half a bad year up, leaves a good year alone, and only while the warden is there', () => {
    const { ctx, warden, def, state, duty } = warded();
    expect(duty.status).toBe('serving');
    expect(wardedYieldFactor(ctx, def, state, 0.8)).toBeCloseTo(0.94, 10);
    expect(wardedYieldFactor(ctx, def, state, 1.1)).toBe(1.1);
    expect(duty.service.usefulYears).toBe(1);

    ctx.world.people.kill(warden.id, ctx.world.year, 'in the ordinary way');
    expect(wardedYieldFactor(ctx, def, state, 0.8)).toBe(0.8);
  });

  it('takes most of the damage off the warded ground and none off any other', () => {
    const { ctx, state } = warded();
    damageParcel(ctx, FARM, 2);
    expect(state.yieldBonus).toBeCloseTo(-0.6, 10);
    const other = [...ctx.world.parcels.values()].find((s) => s.defId === 'nettlecombe')!;
    damageParcel(ctx, 'nettlecombe', 2);
    expect(other.yieldBonus).toBe(-2);
  });

  it('puts the warden at the parcel, not in the hall', () => {
    const { ctx, warden } = warded();
    expect(resolvePresence(ctx, SEAT, {}).people).not.toContain(warden.id);
    expect(resolvePresence(ctx, farmSite, { WARDEN: warden.id }).people).toEqual([warden.id]);
  });

  it('refuses ground the working cannot reach', () => {
    const ctx = testWorld(bundle, 1875);
    const warden = reader(ctx, 'male', ['lesser_workings_of_terra'], 'Hob');
    const wood: SceneSite = { kind: 'parcel', parcel: 'ardwen_wood', slots: ['WARDEN'] };
    expect(quoteDuty(ctx, { person: warden.id, working: 'shoring_the_banks', target: wood })).toMatchObject({ ok: false, gap: 'target_lost' });
    expect(tableView(ctx).mystic.offers.find((o) => o.working === 'shoring_the_banks')!.targets
      .map((t) => t.target)).not.toContainEqual(wood);
  });
});

describe('a duty is one occupation, paid once (#1873)', () => {
  it('sets a study down by its remaining years and picks it back up on release', () => {
    const { ctx } = world();
    const carer = reader(ctx, 'female', ['lesser_workings_of_life'], 'Maud');
    ctx.world.library.set('lesser_workings_of_death', { id: 'lesser_workings_of_death', acquiredYear: 1042, condition: 100 });
    ctx.world.studies.push({ person: carer.id, book: 'lesser_workings_of_death', completes: ctx.world.year + 3 });

    expect(order(ctx, { kind: 'mysticAssign', person: carer.id, working: 'sickroom_watch', target: SEAT }).ok).toBe(true);
    expect(ctx.world.studies).toEqual([]);
    expect(ctx.world.mystic.pauses).toMatchObject([{ person: carer.id, remainingYears: 3 }]);
    const def = ctx.content.spellbook('lesser_workings_of_death')!;
    expect(canStudySpellbook(ctx, carer, def)).toMatchObject({ ok: false });

    ctx.world.year += 5;
    phase('mystic', ctx);
    const duty = ctx.world.mystic.assignments[0]!;
    expect(order(ctx, { kind: 'mysticRelease', assignment: duty.id }).ok).toBe(true);
    expect(ctx.world.studies).toEqual([{ person: carer.id, book: 'lesser_workings_of_death', completes: ctx.world.year + 3 }]);
    expect(ctx.world.mystic).toMatchObject({ assignments: [], pauses: [], services: [expect.objectContaining({ id: duty.id, ended: ctx.world.year })],
      reservedUpkeep: { year: ctx.world.year, crowns: 4 } });
  });

  it('allows one duty a person and one keeper a place, and charges preparation once', () => {
    const { ctx } = world();
    const a = reader(ctx, 'female', ['lesser_workings_of_life'], 'Maud');
    const b = reader(ctx, 'female', ['lesser_workings_of_life'], 'Edith');
    const before = ctx.world.treasury;
    const first = order(ctx, { kind: 'mysticAssign', person: a.id, working: 'sickroom_watch', target: SEAT });
    expect(first).toMatchObject({ ok: true, spent: 12 });
    expect(ctx.world.treasury).toBe(before - 12);
    expect(order(ctx, { kind: 'mysticAssign', person: a.id, working: 'sickroom_watch', target: SEAT }).ok).toBe(false);
    expect(order(ctx, { kind: 'mysticAssign', person: b.id, working: 'sickroom_watch', target: SEAT }).ok).toBe(false);

    ctx.world.year += 1;
    phase('mystic', ctx);
    expect(economyReading(ctx).mystic).toBe(4);
    expect(ctx.world.mystic.assignments[0]!.service.spent).toBe(16);
  });

  it('ends with the carer and says so, without asking anything', () => {
    const { ctx } = world();
    const carer = reader(ctx, 'female', ['lesser_workings_of_life'], 'Maud');
    serveCare(ctx, carer);
    ctx.world.people.kill(carer.id, ctx.world.year, 'in the ordinary way');
    ctx.world.year += 1;
    const pending = ctx.world.pendingDecisions.length;
    phase('mystic', ctx);
    expect(ctx.world.mystic.assignments).toEqual([]);
    expect(ctx.world.pendingDecisions.length).toBe(pending);
    expect(ctx.world.chronicle.at(-1)?.people).toEqual([carer.id]);
  });

  it('is dormant in a house that keeps no duty', () => {
    const { ctx } = world();
    const before = canonical(saveGame(ctx));
    phase('mystic', ctx);
    expect(canonical(saveGame(ctx))).toBe(before);
    expect(mysticView(ctx).duties).toEqual([]);
  });
});

describe('duties survive save and load (#1873)', () => {
  it('a run continued from a save is the run that never stopped', () => {
    const make = () => {
      const { ctx } = world(1876);
      const carer = reader(ctx, 'female', ['lesser_workings_of_life'], 'Maud');
      const warden = reader(ctx, 'male', ['lesser_workings_of_terra'], 'Hob');
      ctx.world.treasury = 2000;
      expect(order(ctx, { kind: 'mysticAssign', person: carer.id, working: 'sickroom_watch', target: SEAT }).ok).toBe(true);
      expect(order(ctx, { kind: 'mysticAssign', person: warden.id, working: 'shoring_the_banks', target: farmSite }).ok).toBe(true);
      return ctx;
    };
    const straight = make();
    runYears(straight, 12);

    const halted = make();
    runYears(halted, 5);
    const resumed = loadGame(JSON.parse(JSON.stringify(saveGame(halted))), bundle);
    expect(resumed.world.mystic.assignments.length).toBeGreaterThan(0);
    runYears(resumed, 7);

    const strip = (ctx: SimCtx) => ({ ...saveGame(ctx), savedAt: undefined });
    expect(canonical(strip(resumed))).toBe(canonical(strip(straight)));
    expect(straight.world.mystic.assignments.some((a) => a.service.servedYears > 0)).toBe(true);
  });

  it('a format-33 save loads with no duties', () => {
    const { ctx } = world();
    const saved = saveGame(ctx) as Record<string, unknown>;
    delete saved.mystic;
    saved.format = 33;
    const loaded = loadGame(saved, bundle);
    expect(loaded.world.mystic).toEqual({ assignments: [], services: [], pauses: [] });
  });
});
