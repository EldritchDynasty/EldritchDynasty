import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { proseOriginalHash } from '@ed/schema';
import type { ProseMode } from '@ed/schema';
import {
  branchOf, endowParcel, heldParcels, loadGame, missingPlainEnglish, order, phase, place,
  recallToMain, saveGame, setProseMode, setProseVariants, settleBranches, testWorld, tickBranches,
} from '@ed/core';
import { coreMessageEntries } from './tools/core-message-audit.js';

const bundle = loadContent();

const messages = coreMessageEntries(readFileSync(new URL('./people/branches.ts', import.meta.url), 'utf8'));
const translated: Record<string, string> = {
  'core:messages#branches.name': "{FOUNDER}'s branch",
  'core:messages#branches.founded.title': 'A New House',
  'core:messages#branches.founded.text': '{FOUNDER} moved into his own house. He kept the family name but did not become Head.',
  'core:messages#branches.extinct': '{BRANCH} had no one left after {YEARS} years.',
  'core:messages#branches.recalled.title': 'The Cousin Came Home',
  'core:messages#branches.recalled.text': '{PERSON} was called back from the smaller house to take the seal.',
};
const variants = messages.map((entry) => ({
  address: entry.address, of: proseOriginalHash(entry.text), plainenglish: translated[entry.address]!,
}));

function household(mode: ProseMode = 'original', reviewed = true) {
  const ctx = testWorld(bundle, 731);
  for (const person of ctx.world.people.living()) {
    ctx.world.people.kill(person.id, ctx.world.year, 'before the fixture');
  }
  for (const person of ctx.world.people.all()) person.castSlots = [];
  const head = place(ctx, { name: 'Marek', sex: 'male', age: 50 });
  head.castSlots.push('head');
  const cousin = place(ctx, { name: 'Oren', sex: 'male', age: 30 });
  ctx.world.chronicle = [];
  if (reviewed) setProseVariants(ctx, variants);
  setProseMode(ctx, mode);
  return { ctx, cousin };
}

function branchLife(mode: ProseMode = 'original', reviewed = true) {
  const { ctx, cousin } = household(mode, reviewed);
  const branches = settleBranches(ctx);
  expect(branches).toHaveLength(1);
  const branch = branches[0]!;
  expect(branchOf(ctx.world, cousin, ctx.world.year)).toBe(branch.id);

  ctx.world.year += 1;
  branch.grievance = 80;
  recallToMain(ctx, cousin);
  expect(branchOf(ctx.world, cousin, ctx.world.year)).toBe('main');
  expect(branch.grievance).toBe(35);
  expect(branch.recalled).toBe(ctx.world.year);
  expect(branch.heldSeal).toBe(ctx.world.year);

  ctx.world.year += 6;
  tickBranches(ctx);
  expect(branch.extinct).toBe(ctx.world.year);
  expect(ctx.world.chronicle).toHaveLength(3);
  expect(ctx.world.chronicle.at(-1)?.greyed).toBe(true);
  return { ctx, branch };
}

function savedRun(ctx: ReturnType<typeof testWorld>) {
  const saved = saveGame(ctx);
  saved.savedAt = '2026-10-10T00:00:00.000Z';
  // Compare the persisted JSON, whose absent optional properties are omitted.
  return JSON.parse(JSON.stringify(saved)) as typeof saved;
}

function structure(ctx: ReturnType<typeof testWorld>) {
  const saved = savedRun(ctx);
  return {
    ...saved,
    branches: saved.branches.map((branch) => ({ ...branch, name: undefined })),
    chronicle: saved.chronicle.map((page) => ({ ...page, title: undefined, text: undefined })),
  };
}

describe('cadet-branch prose (#731)', () => {
  it('keeps Original names and every page exact, including the missing-variant fallback', () => {
    const { ctx, branch } = branchLife();
    expect(branch.name).toBe("Oren's line");
    expect(ctx.world.chronicle.map((page) => [page.title, page.text])).toEqual([
      ['A Second Roof', 'Oren took the east rooms and then took a house of his own, which the family called generous and the family called sensible, and which was both. He kept the name. He did not keep the seal.'],
      ['They Sent for the Cousin', 'Oren was born in the smaller house and had not expected to see the inside of the seal room. He was sent for in the winter and the road was bad. Nobody in the main line had thought about him in thirty years, and every one of them knew his name by spring.'],
      [undefined, "Oren's line ended, 7 years after it began."],
    ]);
    const fallback = branchLife('plainenglish', false);
    expect(savedRun(fallback.ctx)).toEqual(savedRun(ctx));
    expect(missingPlainEnglish(fallback.ctx)).toEqual(Object.keys(translated).sort());
  });

  it('renders all six inventoried messages without changing branch mechanics or page metadata', () => {
    expect(messages.map((entry) => entry.address).sort()).toEqual(Object.keys(translated).sort());
    const original = branchLife();
    const plain = branchLife('plainenglish');
    expect(plain.branch.name).toBe("Oren's branch");
    expect(plain.ctx.world.chronicle.map((page) => [page.title, page.text])).toEqual([
      ['A New House', 'Oren moved into his own house. He kept the family name but did not become Head.'],
      ['The Cousin Came Home', 'Oren was called back from the smaller house to take the seal.'],
      [undefined, "Oren's branch had no one left after 7 years."],
    ]);
    expect(missingPlainEnglish(plain.ctx)).toEqual([]);
    expect(structure(plain.ctx)).toEqual(structure(original.ctx));
  });

  it('freezes names and existing pages across mode changes and save/reload while new pages follow the mode', () => {
    const { ctx, cousin } = household('plainenglish');
    const branch = settleBranches(ctx)[0]!;
    const foundingPage = structuredClone(ctx.world.chronicle[0]);
    setProseMode(ctx, 'original');
    ctx.world.year += 1;
    recallToMain(ctx, cousin);
    expect(ctx.world.chronicle.at(-1)?.title).toBe('They Sent for the Cousin');
    expect(ctx.world.chronicle[0]).toEqual(foundingPage);
    expect(branch.name).toBe("Oren's branch");

    const saved = savedRun(ctx);
    const loaded = loadGame(saved, bundle);
    expect(savedRun(loaded)).toEqual(saved);
    setProseVariants(loaded, variants);
    setProseMode(loaded, 'plainenglish');
    loaded.world.year += 6;
    tickBranches(loaded);
    expect(loaded.world.chronicle.slice(0, 2)).toEqual(saved.chronicle);
    expect(loaded.world.chronicle.at(-1)?.text).toBe("Oren's branch had no one left after 7 years.");
  });
});

/**
 * THE SCION IS FED, AND A HALL NOTICES (issue #61, Stage C).
 *
 * Concentration is not a free mechanic — see `people/branches.ts`'s own
 * `GRIEVANCE_SCION_FED`. This is deterministic and fast on purpose: `tickBranches`
 * takes no `rng`, so a single call either moves the two halls apart or it does
 * not, and there is nothing here that needs a played run to see.
 */
describe('the scion is fed, and a hall notices (issue #61, Stage C)', () => {
  it('raises grievance in the hall that is not his, and not in the one that is', () => {
    const ctx = testWorld(bundle, 7701);
    const w = ctx.world;

    // SAME NAME, SAME AGE, on purpose: `place`'s genome is a pure function of
    // name and age, so this gives both cousins the identical roll on
    // whether either of them can express — the one thing that would
    // otherwise make one branch's `passedOver` term differ from the
    // other's for a reason that has nothing to do with the scion.
    const scionMember = place(ctx, { sex: 'male', age: 30, name: 'A Cousin', branch: 'branch_scion' });
    const otherMember = place(ctx, { sex: 'male', age: 30, name: 'A Cousin', branch: 'branch_other' });
    w.branches.set('branch_scion' as never, {
      id: 'branch_scion', name: 'Scion Hall', house: w.playerHouse, founder: scionMember.id,
      splitFrom: 'main', foundedYear: w.year - 30, grievance: 10,
    } as never);
    w.branches.set('branch_other' as never, {
      id: 'branch_other', name: 'Other Hall', house: w.playerHouse, founder: otherMember.id,
      splitFrom: 'main', foundedYear: w.year - 30, grievance: 10,
    } as never);

    expect(order(ctx, { kind: 'scion', person: scionMember.id }).ok).toBe(true);

    phase('branches', ctx);

    const scionHall = w.branches.get('branch_scion' as never)!;
    const otherHall = w.branches.get('branch_other' as never)!;
    expect(
      otherHall.grievance,
      'the hall without the scion did not end the year more aggrieved than the hall with him',
    ).toBeGreaterThan(scionHall.grievance);
  });

  it('adds nothing when nobody has been named', () => {
    const ctx = testWorld(bundle, 7702);
    const w = ctx.world;
    const member = place(ctx, { sex: 'male', age: 30, name: 'A Cousin', branch: 'branch_only' });
    w.branches.set('branch_only' as never, {
      id: 'branch_only', name: 'Only Hall', house: w.playerHouse, founder: member.id,
      splitFrom: 'main', foundedYear: w.year - 30, grievance: 10,
    } as never);

    phase('branches', ctx);

    // No scion at all: whatever moved it, it was not this issue's addition.
    // `GRIEVANCE_FADE` alone can only ever move it down.
    expect(w.branches.get('branch_only' as never)!.grievance).toBeLessThanOrEqual(10);
  });
});

/**
 * THE HEIR IS FED TOO, AND A HALL NOTICES TWICE (issue #61, Stage E4).
 *
 * `GRIEVANCE_SCION_FED` is added a second time when a hall holds neither
 * the Scion nor the heir — the programme now costs the rest of the family
 * twice over, not once, and a hall passed over for both should end the
 * year more aggrieved than one passed over for only one of them.
 */
/**
 * ESCHEAT, COME HOME (issue #91, Stage H). A branch going extinct is the
 * same event as a neighbour running out of sons — ground it holds has
 * nobody left to answer for it and returns to the seat, through the
 * ordinary recall rather than a second mechanism.
 */
describe('escheat on extinction (issue #91, Stage H)', () => {
  it('recalls an endowed parcel to the seat the year its hall goes extinct', () => {
    const ctx = testWorld(bundle, 7704);
    const w = ctx.world;
    const founder = place(ctx, { sex: 'male', age: 30, name: 'A Cousin', branch: 'branch_gone' });
    w.branches.set('branch_gone' as never, {
      id: 'branch_gone', name: 'The Gone Hall', house: w.playerHouse, founder: founder.id,
      splitFrom: 'main', foundedYear: w.year - 30, grievance: 0,
    } as never);
    expect(endowParcel(ctx, 'hallowfield', 'branch_gone').ok).toBe(true);

    w.people.kill(founder.id, w.year, 'the last of the hall');
    phase('branches', ctx);

    expect(w.branches.get('branch_gone' as never)!.extinct).toBe(w.year);
    expect(heldParcels(ctx).find((p) => p.defId === 'hallowfield')?.holder).toBeUndefined();
  });

  it('leaves an extinct hall\'s other affairs alone when it held no land', () => {
    const ctx = testWorld(bundle, 7705);
    const w = ctx.world;
    const founder = place(ctx, { sex: 'male', age: 30, name: 'A Cousin', branch: 'branch_landless' });
    w.branches.set('branch_landless' as never, {
      id: 'branch_landless', name: 'The Landless Hall', house: w.playerHouse, founder: founder.id,
      splitFrom: 'main', foundedYear: w.year - 30, grievance: 0,
    } as never);

    w.people.kill(founder.id, w.year, 'the last of the hall');
    expect(() => phase('branches', ctx)).not.toThrow();

    expect(w.branches.get('branch_landless' as never)!.extinct).toBe(w.year);
  });
});

describe('the heir is fed too, and a hall notices twice (issue #61, Stage E4)', () => {
  it('a hall holding neither ends more aggrieved than a hall holding one of the pair', () => {
    const ctx = testWorld(bundle, 7703);
    const w = ctx.world;

    // SAME NAME, SAME AGE across all three, for the same reason the Scion's
    // own test uses it: an identical roll on canExpress for every founder,
    // so nothing but the programme itself can move one hall's grievance
    // differently from another's.
    const scionMember = place(ctx, { sex: 'male', age: 30, name: 'A Cousin', branch: 'branch_scion' });
    const heirMember = place(ctx, { sex: 'male', age: 30, name: 'A Cousin', branch: 'branch_heir' });
    const neitherMember = place(ctx, { sex: 'male', age: 30, name: 'A Cousin', branch: 'branch_neither' });
    w.branches.set('branch_scion' as never, {
      id: 'branch_scion', name: 'Scion Hall', house: w.playerHouse, founder: scionMember.id,
      splitFrom: 'main', foundedYear: w.year - 30, grievance: 10,
    } as never);
    w.branches.set('branch_heir' as never, {
      id: 'branch_heir', name: 'Heir Hall', house: w.playerHouse, founder: heirMember.id,
      splitFrom: 'main', foundedYear: w.year - 30, grievance: 10,
    } as never);
    w.branches.set('branch_neither' as never, {
      id: 'branch_neither', name: 'Neither Hall', house: w.playerHouse, founder: neitherMember.id,
      splitFrom: 'main', foundedYear: w.year - 30, grievance: 10,
    } as never);

    expect(order(ctx, { kind: 'scion', person: scionMember.id }).ok).toBe(true);
    expect(order(ctx, { kind: 'scionHeir', person: heirMember.id }).ok).toBe(true);

    phase('branches', ctx);

    const scionHall = w.branches.get('branch_scion' as never)!;
    const heirHall = w.branches.get('branch_heir' as never)!;
    const neitherHall = w.branches.get('branch_neither' as never)!;
    expect(
      neitherHall.grievance,
      'a hall holding neither did not end more aggrieved than one holding the Scion',
    ).toBeGreaterThan(scionHall.grievance);
    expect(
      neitherHall.grievance,
      'a hall holding neither did not end more aggrieved than one holding the heir',
    ).toBeGreaterThan(heirHall.grievance);
  });
});
