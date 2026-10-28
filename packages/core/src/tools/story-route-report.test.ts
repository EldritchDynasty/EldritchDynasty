import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { asId, indexContent, type Content } from '@ed/schema';
import { dueArcSteps } from '../events/arcs.js';
import { executeOutcomeWitness } from '../events/reach.js';
import { selectEvents } from '../events/selection.js';
import { queueChoice, resolveChoice, resolveRecord } from '../events/decisions.js';
import { resolveSlots } from '../events/slots.js';
import { evalCondition } from '../events/conditions.js';
import { canonical, loadGame, saveGame } from '../save.js';
import { place, testRng, testWorld } from '../testing.js';
import { runPhase } from '../year/phases.js';
import { emptyReport } from '../year/report.js';
import { binomialInterval, routeLaunchers, StoryRouteObserver, withoutGlimpses } from './story-route-report.js';

const content = loadContent();

function hall(source: Content = content, year = 1280) {
  const ctx = testWorld(source, 194600, year);
  for (const person of ctx.world.people.living()) {
    person.castSlots = person.castSlots.filter(slot => slot !== 'head');
    for (const membership of person.membership) if (membership.to === undefined && membership.kind === 'cadet') {
      membership.kind = 'blood';
      membership.branch = 'main';
    }
  }
  ctx.world.branches.clear();
  place(ctx, { sex: 'female', age: 45, name: 'The sitting Head', castSlots: ['head'] });
  const cousin = place(ctx, { sex: 'male', age: 35, name: 'The letter writer', branch: 'third_hall' });
  cousin.membership[0]!.kind = 'cadet';
  ctx.world.branches.set('third_hall', {
    id: asId('third_hall'), house: asId(ctx.world.playerHouse), name: 'Third Hall', founder: cousin.id,
    speaker: cousin.id, splitFrom: 'main', foundedYear: year - 30, grievance: 40,
  });
  ctx.world.discontent = 40;
  return { ctx, cousin };
}

function letter(ctx: ReturnType<typeof testWorld>) {
  const result = executeOutcomeWitness(ctx, ctx.content.mustEvent('the_hall_that_waited'), {
    expectedOutcomeId: 'somebody_reads_it_properly', targetWeightedOutcome: true, rng: testRng('letter'),
  });
  expect(result.ok, result.reason).toBe(true);
}

describe('story-route promises (#1946)', () => {
  it('reads both ordinary and intervened schedule wiring from the actual content', () => {
    const launchers = routeLaunchers(content, ['the_cellar_shelf_is_found']);
    expect(launchers.map(launcher => launcher.outcome).sort()).toEqual(['hidden', 'hidden_primordial']);
    expect(launchers.every(launcher => launcher.choice === 'hide_them' && launcher.event === 'the_shelf_that_has_to_go')).toBe(true);
    expect(launchers.every(launcher => 'schedule' in launcher.mechanism && launcher.mechanism.schedule === 1)).toBe(true);
  });

  it('reports the exact kept people and causal page when a real hall promise is delivered', () => {
    const { ctx, cousin } = hall();
    const observer = new StoryRouteObserver(ctx);
    letter(ctx);
    observer.afterYear();
    const instance = [...ctx.world.arcs.values()].find(instance => instance.arc.includes('the_hall_that_waited'))!;
    const origin = ctx.world.chronicle.find(page => page.eventId === 'the_hall_that_waited')!;
    const kept = { ...instance.bindings };
    expect(kept.COUSIN).toBe(cousin.id);
    ctx.world.year = instance.dueYear!;
    const step = dueArcSteps(ctx, testRng('due')).find(step => step.instance.id === instance.id)!;
    const result = executeOutcomeWitness(ctx, ctx.content.mustEvent('the_hall_is_answered'), {
      choiceId: 'give_them_something_real', expectedOutcomeId: 'given', arcStep: step, rng: testRng('answer'),
    });
    expect(result.ok, result.reason).toBe(true);
    const [promise] = observer.finish();
    expect(promise).toMatchObject({ queued: true, status: 'delivered', instance: instance.id,
      keptCast: kept, finalBindings: kept, deliveredYear: ctx.world.year, cause: { year: origin.year, page: origin.id } });
    expect(instance.status).toBe('ended');
    expect(dueArcSteps(ctx, testRng('again')).some(step => step.instance.id === instance.id)).toBe(false);
  });

  it.each(['HEAD', 'COUSIN'] as const)('reports a missing kept %s without substituting another person', (slot) => {
    const { ctx } = hall();
    const observer = new StoryRouteObserver(ctx);
    letter(ctx);
    observer.afterYear();
    const instance = [...ctx.world.arcs.values()].find(instance => instance.arc.includes('the_hall_that_waited'))!;
    const id = instance.bindings[slot]!;
    const kept = { ...instance.bindings };
    ctx.world.people.kill(id, ctx.world.year, 'before the answer');
    place(ctx, { sex: 'male', age: 35, name: 'A different man', branch: 'third_hall', castSlots: slot === 'HEAD' ? ['head'] : [] });
    ctx.world.year = instance.dueYear!;
    expect(dueArcSteps(ctx, testRng('missing')).some(step => step.instance.id === instance.id)).toBe(false);
    const [promise] = observer.finish();
    expect(promise).toMatchObject({ status: 'cancelled_missing_kept_person', keptCast: kept, finalBindings: kept,
      missing: [{ slot, person: id, status: 'dead', policy: 'cancel_arc' }] });
  });

  it('distinguishes a late start refusal from a missing cast', () => {
    const { ctx } = hall(content, 1537);
    const observer = new StoryRouteObserver(ctx);
    letter(ctx);
    const [promise] = observer.finish();
    expect(promise).toMatchObject({ queued: false, status: 'start_refused_term_window', missing: [] });
    expect(ctx.world.arcs.size).toBe(0);
  });

  it('distinguishes an expired story from a condition still waiting', () => {
    for (const expires of [true, false]) {
      const { ctx } = hall(indexContent(structuredClone(content.bundle)));
      const observer = new StoryRouteObserver(ctx);
      letter(ctx);
      observer.afterYear();
      const instance = [...ctx.world.arcs.values()][0]!;
      if (expires) ctx.content.mustArc(instance.arc).expiresAfterYears = 1;
      else ctx.content.mustEvent('the_hall_is_answered').conditions = { flag: 'a_condition_not_yet_met', is: true };
      ctx.world.year = instance.dueYear!;
      expect(dueArcSteps(ctx, testRng('unready')).some(step => step.instance.id === instance.id)).toBe(false);
      const [promise] = observer.finish();
      expect(promise!.status).toBe(expires ? 'expired' : 'pending_at_observation_end');
      if (!expires) {
        expect(promise!.waits).toEqual([{ year: ctx.world.year, reason: 'condition_false_at_due_checkpoint' }]);
        expect(instance.dueYear).toBe(ctx.world.year + 5);
      }
    }
  });

  it('does not record a promise when the opening cannot cast', () => {
    const { ctx, cousin } = hall();
    ctx.world.people.kill(cousin.id, ctx.world.year, 'before the letter');
    const observer = new StoryRouteObserver(ctx);
    const result = executeOutcomeWitness(ctx, content.mustEvent('the_hall_that_waited'), {
      expectedOutcomeId: 'somebody_reads_it_properly', targetWeightedOutcome: true, rng: testRng(),
    });
    expect(result.ok).toBe(false);
    expect(observer.finish()).toEqual([]);
  });

  it('keeps the saved chain and complete state identical with and without the observer', () => {
    const { ctx } = hall();
    const control = loadGame(saveGame(ctx), content);
    let previousCalls = 0;
    const previous = () => previousCalls++;
    ctx.observeOutcome = previous;
    const observer = new StoryRouteObserver(ctx);
    letter(ctx);
    letter(control);
    observer.afterYear();
    const before = canonical(saveGame(control));
    expect(canonical(saveGame(ctx))).toBe(before);
    expect(previousCalls).toBe(1);
    const resumed = loadGame(saveGame(ctx), content);
    const due = [...resumed.world.arcs.values()][0]!.dueYear!;
    resumed.world.year = due;
    control.world.year = due;
    const originalStep = dueArcSteps(control, testRng('resume'))[0]!;
    const resumedStep = dueArcSteps(resumed, testRng('resume'))[0]!;
    expect(resumedStep.fill).toEqual(originalStep.fill);
    expect(resumedStep.instance.bindings).toEqual(originalStep.instance.bindings);
    expect(canonical(saveGame(resumed))).toBe(canonical(saveGame(control)));
    observer.finish();
    expect(ctx.observeOutcome).toBe(previous);
  });

  it.each([false, true])('preserves a herald promise through retries, save/resume and automatic=%s delivery', (automatic) => {
    const ctx = testWorld(content, 194601);
    const observer = new StoryRouteObserver(ctx);
    const event = content.mustEvent('the_heralds_visitation');
    const slots = resolveSlots(event, ctx, testRng('herald-cast'));
    if (!slots.ok) throw new Error('herald witness cannot cast');
    const pending = queueChoice(ctx, event, event.body, slots.fill, []);
    const result = resolveChoice(ctx, pending.id, 'the_short_descent', testRng('visitation'));
    expect(result.ok, result.reason).toBe(true);
    const origin = ctx.world.chronicle.find(page => page.eventId === event.id)!;
    const record = ctx.world.pendingDecisions.find(decision => decision.kind === 'record')!;
    expect(resolveRecord(ctx, record.id, 'omit').ok).toBe(true);
    observer.afterYear();
    expect(observer.offers.the_heralds_visitation).toEqual({ full_descent: 1, the_short_descent: 1 });
    expect(observer.answers['the_heralds_visitation|the_short_descent|short']).toBe(1);
    ctx.world.year++;
    ctx.world.flags.set('the_elder_descent_not_produced', false);
    expect(selectEvents(ctx, testRng('wait'), 0)).toEqual([]);
    expect(ctx.world.scheduled[0]).toMatchObject({ first: ctx.world.year,
      cause: { year: origin.year, page: origin.id } });
    ctx.world.flags.set('the_elder_descent_not_produced', true);
    ctx.world.year += 5;
    const scheduledSave = saveGame(ctx);
    expect(loadGame(JSON.parse(JSON.stringify(scheduledSave)), content).world.scheduled).toEqual(ctx.world.scheduled);
    runPhase('ambient', ctx, emptyReport(ctx.world.year), automatic);
    if (!automatic) {
      const question = ctx.world.pendingDecisions.find(decision => decision.kind === 'choice' && decision.event.id === 'the_herald_opens_the_old_question')!;
      const resumed = loadGame(JSON.parse(JSON.stringify(saveGame(ctx))), content);
      expect(resolveChoice(ctx, question.id, 'answer_the_account', testRng('herald-answer')).ok).toBe(true);
      expect(resolveChoice(resumed, question.id, 'answer_the_account', testRng('herald-answer')).ok).toBe(true);
      expect(canonical(saveGame(resumed))).toBe(canonical(saveGame(ctx)));
    }
    const [promise] = observer.finish();
    expect(promise).toMatchObject({ queued: true, status: 'delivered', deliveredYear: ctx.world.year,
      cause: { year: origin.year, page: origin.id } });
    ctx.world.scheduled.push({ event: 'the_herald_opens_the_old_question', year: ctx.world.year });
    expect(selectEvents(ctx, testRng('once'), 0).some(candidate => candidate.event.id === 'the_herald_opens_the_old_question')).toBe(false);
  });

  it('does not invent a source for an old schedule', () => {
    const ctx = testWorld(content, 194603);
    ctx.world.flags.set('the_elder_descent_not_produced', true);
    ctx.world.scheduled.push({ event: 'the_herald_opens_the_old_question', year: ctx.world.year });
    const resumed = loadGame(JSON.parse(JSON.stringify(saveGame(ctx))), content);
    runPhase('ambient', resumed, emptyReport(resumed.world.year));
    const page = resumed.world.chronicle.find(page => page.eventId === 'the_herald_opens_the_old_question');
    expect(page).toBeDefined();
    expect(page!.cause).toBeUndefined();
  });

  it('cites the first of two same-year herald promises and retires its duplicate', () => {
    const ctx = testWorld(content, 194604);
    const event = content.mustEvent('the_heralds_visitation');
    const pages: string[] = [];
    for (let i = 0; i < 2; i++) {
      const slots = resolveSlots(event, ctx, testRng('two-visits'));
      if (!slots.ok) throw new Error('herald witness cannot cast');
      const pending = queueChoice(ctx, event, event.body, slots.fill, []);
      expect(resolveChoice(ctx, pending.id, 'the_short_descent', testRng('two-visits')).ok).toBe(true);
      pages.push(ctx.world.chronicle.at(-1)!.id!);
      const record = ctx.world.pendingDecisions.find(decision => decision.kind === 'record')!;
      expect(resolveRecord(ctx, record.id, 'record').ok).toBe(true);
    }
    ctx.world.year++;
    runPhase('ambient', ctx, emptyReport(ctx.world.year));
    const delivered = ctx.world.chronicle.filter(page => page.eventId === 'the_herald_opens_the_old_question');
    expect(delivered).toHaveLength(1);
    expect(delivered[0]!.cause?.page).toBe(pages[0]);
    expect(ctx.world.scheduled).toEqual([]);
  });

  it('also carries a saved scheduled narration through the real ambient phase', () => {
    const ctx = testWorld(content, 194605, 1090);
    const result = executeOutcomeWitness(ctx, content.mustEvent('the_line_carried_forward'), {
      expectedOutcomeId: 'carried', rng: testRng('the-line'),
    });
    expect(result.ok, result.reason).toBe(true);
    const parent = ctx.world.chronicle.at(-1)!;
    const cause = { year: parent.year, page: parent.id };
    expect(ctx.world.scheduled[0]?.cause).toEqual(cause);
    ctx.world.year += 22;
    const resumed = loadGame(JSON.parse(JSON.stringify(saveGame(ctx))), content);
    runPhase('ambient', resumed, emptyReport(resumed.world.year));
    expect(resumed.world.chronicle.find(page => page.eventId === 'the_letters_to_the_weighers')?.cause).toEqual(cause);
  });

  it('disables only the three glimpse premises in the diagnostic counterfactual', () => {
    const original = canonical(content.bundle);
    const without = withoutGlimpses(content);
    const ctx = testWorld(without, 194602, 1080);
    expect(evalCondition(without.mustEvent('the_line_carried_forward').conditions, ctx)).toBe(false);
    expect(canonical(content.bundle)).toBe(original);
    expect(without.mustEvent('the_heralds_visitation')).toEqual(content.mustEvent('the_heralds_visitation'));
    expect(without.arcs).toEqual(content.arcs);
  });

  it('shows uncertainty for a thin tail and does not invent a zero-denominator rate', () => {
    expect(binomialInterval(0, 0)).toEqual({ hits: 0, n: 0, rate: null, lower: null, upper: null });
    const interval = binomialInterval(5, 800);
    expect(interval.rate).toBe(0.00625);
    expect(interval.lower!).toBeLessThan(0.005);
    expect(interval.upper!).toBeGreaterThan(0.01);
    expect(binomialInterval(0, 10).upper!).toBeGreaterThan(0);
  });
});
