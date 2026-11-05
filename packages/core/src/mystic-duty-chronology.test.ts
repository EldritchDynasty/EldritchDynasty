import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { asId, canLearn, type SceneSite } from '@ed/schema';
import { assignDuty, liveDuties, practitionerGap, quoteDuty, targetGap } from './mystic.js';
import { place, testWorld } from './testing.js';

const content = loadContent();
const bedside = content.bundle.mysticWorkings.find(w => w.benefit.kind === 'life_care');
const teaching = content.bundle.mysticWorkings.find(w => w.benefit.kind === 'teaching');

function readerWorld(seed: number) {
  const ctx = testWorld(content, seed, 1100);
  ctx.world.treasury = 1000;
  expect(bedside).toBeDefined();
  const sex = canLearn('female', bedside!.affinity) ? 'female' : 'male';
  const p = place(ctx, { sex, age: 30, awakened: true, name: 'The house reader' });
  for (const book of bedside!.books) p.spellsKnown.push(asId(book));
  const target: SceneSite = { kind: 'hall', hall: 'main' };
  const order = { person: p.id, working: bedside!.id, target };
  return { ctx, p, order };
}

describe('recovered Mystic duty chronology (#2969, #2970, #2971)', () => {
  it('rejects a reader whose saved death is already effective, not one who dies later (#2969)', () => {
    const { ctx, p, order } = readerWorld(2969);
    p.died = ctx.world.year + 2;
    expect(practitionerGap(ctx, p, bedside!)).toBeUndefined();
    expect(quoteDuty(ctx, order).ok).toBe(true);

    ctx.world.year = p.died;
    // Recovered rows can retain the stale alive flag; the death year is authoritative.
    expect(p.status).toBe('alive');
    expect(practitionerGap(ctx, p, bedside!)).toBe('dead');
    expect(quoteDuty(ctx, order).gap).toBe('dead');
    ctx.world.year++;
    expect(quoteDuty(ctx, order).gap).toBe('dead');
  });

  it('does not keep paying a recovered service after its practitioner died (#2969)', () => {
    const { ctx, p, order } = readerWorld(29691);
    expect(assignDuty(ctx, order).ok).toBe(true);
    const assignment = ctx.world.mystic.assignments.at(-1)!;
    ctx.world.year = assignment.ready;
    assignment.status = 'serving';
    assignment.paidThrough = ctx.world.year;
    p.died = ctx.world.year + 1;
    expect(liveDuties(ctx, 'life_care').some(row => row.p.id === p.id)).toBe(true);

    ctx.world.year++;
    assignment.paidThrough = ctx.world.year;
    expect(liveDuties(ctx, 'life_care').some(row => row.p.id === p.id)).toBe(false);
  });

  it('keeps a reader at home until an away career actually starts (#2970)', () => {
    const { ctx, p, order } = readerWorld(2970);
    p.career = { career: asId('clergy'), from: ctx.world.year + 3 };
    expect(practitionerGap(ctx, p, bedside!)).toBeUndefined();
    expect(quoteDuty(ctx, order).ok).toBe(true);

    ctx.world.year = p.career.from - 1;
    expect(quoteDuty(ctx, order).ok).toBe(true);
    ctx.world.year++;
    expect(practitionerGap(ctx, p, bedside!)).toBe('away_post');
    expect(quoteDuty(ctx, order).gap).toBe('away_post');
  });

  it('stops a serving duty at the actual first year of an away post (#2970)', () => {
    const { ctx, p, order } = readerWorld(29701);
    expect(assignDuty(ctx, order).ok).toBe(true);
    const assignment = ctx.world.mystic.assignments.at(-1)!;
    ctx.world.year = assignment.ready;
    assignment.status = 'serving';
    assignment.paidThrough = ctx.world.year;
    p.career = { career: asId('clergy'), from: ctx.world.year + 2 };
    expect(liveDuties(ctx, 'life_care').some(row => row.p.id === p.id)).toBe(true);
    ctx.world.year = p.career.from;
    assignment.paidThrough = ctx.world.year;
    expect(liveDuties(ctx, 'life_care').some(row => row.p.id === p.id)).toBe(false);
  });

  it('refuses a stale completed lesson and selects a later active book (#2971)', () => {
    const ctx = testWorld(content, 2971, 1100);
    ctx.world.treasury = 1000;
    expect(teaching).toBeDefined();
    const sex = canLearn('female', teaching!.affinity) ? 'female' : 'male';
    const teacher = place(ctx, { sex, age: 40, awakened: true, name: 'The tutor' });
    for (const book of teaching!.books) teacher.spellsKnown.push(asId(book));
    const pupil = place(ctx, { sex, age: 22, awakened: true, name: 'The pupil' });
    const target: SceneSite = { kind: 'person', person: pupil.id };
    ctx.world.studies.push({ person: pupil.id, book: 'old_completed_study', completes: ctx.world.year - 1 });

    expect(targetGap(ctx, teaching!, target, {}, ctx.world.playerHouse, teacher)).toBe('no_need');

    ctx.world.studies.push({ person: pupil.id, book: teaching!.books[0]!, completes: ctx.world.year + 8 });
    expect(targetGap(ctx, teaching!, target, {}, ctx.world.playerHouse, teacher)).toBeUndefined();
    expect(quoteDuty(ctx, { person: teacher.id, working: teaching!.id, target }).ok).toBe(true);

    const unlearned = place(ctx, { sex, age: 40, awakened: true, name: 'The unfamiliar tutor' });
    expect(targetGap(ctx, teaching!, target, {}, ctx.world.playerHouse, unlearned)).toBe('unlearned');

    ctx.world.year += 8;
    expect(targetGap(ctx, teaching!, target, {}, ctx.world.playerHouse, teacher)).toBe('no_need');
  });
});
