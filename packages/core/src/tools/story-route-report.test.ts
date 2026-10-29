import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { asId, indexContent, type Content } from '@ed/schema';
import { dueArcSteps } from '../events/arcs.js';
import { executeOutcomeWitness } from '../events/reach.js';
import { selectEvents } from '../events/selection.js';
import { queueChoice, resolveChoice, resolveRecord, type OutcomeObservation } from '../events/decisions.js';
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

function letter(ctx: ReturnType<typeof testWorld>, rng = testRng('letter')) {
  const result = executeOutcomeWitness(ctx, ctx.content.mustEvent('the_hall_that_waited'), {
    expectedOutcomeId: 'somebody_reads_it_properly', targetWeightedOutcome: true, rng,
  });
  expect(result.ok, result.reason).toBe(true);
}

function herald(ctx: ReturnType<typeof testWorld>) {
  const event = ctx.content.mustEvent('the_heralds_visitation');
  const slots = resolveSlots(event, ctx, testRng('visit-cast'));
  if (!slots.ok) throw new Error('herald witness cannot cast');
  const pending = queueChoice(ctx, event, event.body, slots.fill, []);
  const result = resolveChoice(ctx, pending.id, 'the_short_descent', testRng('visit'));
  expect(result.ok, result.reason).toBe(true);
  const page = result.resolved!.entryId;
  const record = ctx.world.pendingDecisions.find(decision => decision.kind === 'record' && decision.entryId === page)!;
  expect(resolveRecord(ctx, record.id, 'record').ok).toBe(true);
  return page;
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
    let beforeObservation: OutcomeObservation | undefined;
    ctx.observeOutcome = observation => { previous(); beforeObservation = observation; };
    const previousOutcome = ctx.observeOutcome;
    const applied: string[] = [];
    const previousApplied = (observation: OutcomeObservation, entryId: string) => {
      expect(observation).toBe(beforeObservation);
      expect(ctx.world.chronicle.some(page => page.id === entryId && page.eventId === observation.event.id)).toBe(true);
      applied.push(entryId);
    };
    ctx.observeAppliedOutcome = previousApplied;
    const observer = new StoryRouteObserver(ctx);
    const observedRng = testRng('neutral-letter'), controlRng = testRng('neutral-letter');
    letter(ctx, observedRng);
    letter(control, controlRng);
    expect([observedRng.next(), observedRng.next()]).toEqual([controlRng.next(), controlRng.next()]);
    observer.afterYear();
    const before = canonical(saveGame(control));
    expect(canonical(saveGame(ctx))).toBe(before);
    expect(previousCalls).toBe(1);
    expect(applied).toEqual([ctx.world.chronicle.at(-1)!.id]);
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
    expect(ctx.observeOutcome).toBe(previousOutcome);
    expect(ctx.observeAppliedOutcome).toBe(previousApplied);
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
    const observer = new StoryRouteObserver(ctx);
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
    const promises = observer.finish();
    expect(promises.map(promise => promise.status)).toEqual(['delivered', 'retired_without_delivery']);
    expect(promises.map(promise => promise.launchPage)).toEqual(pages);
    expect(promises[0]!.deliveryPage).toBe(delivered[0]!.id);
    expect(promises[1]!.deliveredYear).toBeUndefined();
    expect(promises[1]!.cause).toBeUndefined();
  });

  it.each([false, true])('attributes repeatable same-year deliveries separately, automatic=%s', (automatic) => {
    const source = indexContent(structuredClone(content.bundle));
    source.mustEvent('the_herald_opens_the_old_question').repeatable = true;
    const ctx = testWorld(source, 197400);
    const observer = new StoryRouteObserver(ctx);
    const pages = [herald(ctx), herald(ctx)];
    ctx.world.year++;
    runPhase('ambient', ctx, emptyReport(ctx.world.year), automatic);
    if (!automatic) {
      observer.afterYear();
      const pending = ctx.world.pendingDecisions.filter(decision => decision.kind === 'choice'
        && decision.event.id === 'the_herald_opens_the_old_question');
      expect(pending).toHaveLength(2);
      expect(ctx.world.scheduled).toEqual([]);
      const resumed = loadGame(JSON.parse(JSON.stringify(saveGame(ctx))), source);
      for (const decision of [...pending].reverse()) {
        expect(resolveChoice(ctx, decision.id, 'answer_the_account', testRng('same-year-answers')).ok).toBe(true);
        expect(resolveChoice(resumed, decision.id, 'answer_the_account', testRng('same-year-answers')).ok).toBe(true);
      }
      expect(canonical(saveGame(resumed))).toBe(canonical(saveGame(ctx)));
    }
    const promises = observer.finish();
    const delivered = ctx.world.chronicle.filter(page => page.eventId === 'the_herald_opens_the_old_question');
    expect(delivered).toHaveLength(2);
    expect(promises.map(promise => promise.status)).toEqual(['delivered', 'delivered']);
    expect(promises.map(promise => promise.launchPage)).toEqual(pages);
    for (const promise of promises) {
      expect(promise.cause?.page).toBe(promise.launchPage);
      expect(promise.deliveryPage).toBe(delivered.find(page => page.cause?.page === promise.launchPage)!.id);
    }
    expect(new Set(promises.map(promise => promise.deliveryPage)).size).toBe(2);
  });

  it('keeps a saved unanswered scheduled choice pending after it leaves the calendar', () => {
    const ctx = testWorld(content, 197404);
    const observer = new StoryRouteObserver(ctx);
    const page = herald(ctx);
    ctx.world.year++;
    runPhase('ambient', ctx, emptyReport(ctx.world.year), false);
    expect(ctx.world.scheduled).toEqual([]);
    const resumed = loadGame(JSON.parse(JSON.stringify(saveGame(ctx))), content);
    const pending = resumed.world.pendingDecisions.find(decision => decision.kind === 'choice'
      && decision.event.id === 'the_herald_opens_the_old_question');
    expect(pending).toMatchObject({ cause: { page } });
    const [promise] = observer.finish();
    expect(promise).toMatchObject({ launchPage: page, status: 'awaiting_decision', queued: true });
    expect(promise!.deliveredYear).toBeUndefined();
  });

  it('does not credit a newer promise\'s delivery to an older one still retrying', () => {
    const ctx = testWorld(content, 197401);
    const observer = new StoryRouteObserver(ctx);
    const first = herald(ctx);
    ctx.world.year++;
    ctx.world.flags.set('the_elder_descent_not_produced', false);
    expect(selectEvents(ctx, testRng('retry'), 0)).toEqual([]);
    const second = herald(ctx);
    ctx.world.year++;
    runPhase('ambient', ctx, emptyReport(ctx.world.year));
    observer.afterYear();
    expect(ctx.world.scheduled.map(schedule => schedule.cause?.page)).toEqual([first]);
    ctx.world.year += 4;
    expect(selectEvents(ctx, testRng('retire'), 0)).toEqual([]);
    const promises = observer.finish();
    expect(promises.map(promise => promise.status)).toEqual(['retired_without_delivery', 'delivered']);
    expect(promises[1]!.cause?.page).toBe(second);
    expect(promises[0]!.deliveryPage).toBeUndefined();
  });

  it('never attaches an existing same-year arc to a refused concurrent launch', () => {
    const { ctx } = hall();
    letter(ctx);
    const existing = [...ctx.world.arcs.values()][0]!;
    const observer = new StoryRouteObserver(ctx);
    letter(ctx);
    const [promise] = observer.finish();
    expect(promise).toMatchObject({ status: 'start_refused_concurrency', queued: false });
    expect(promise!.instance).toBeUndefined();
    expect(promise!.launchPage).not.toBe(existing.cause!.page);
  });

  it('keeps concurrent same-year inline deliveries attached to their own launch pages', () => {
    const source = indexContent(structuredClone(content.bundle));
    const mechanism = routeLaunchers(source, ['the_hall_is_answered'])[0]!.mechanism;
    if (!('arc' in mechanism)) throw new Error('Hall continuation is not an arc');
    source.mustArc(mechanism.arc).maxConcurrentInstances = 2;
    const { ctx } = hall(source);
    const observer = new StoryRouteObserver(ctx);
    letter(ctx);
    letter(ctx);
    const instances = [...ctx.world.arcs.values()];
    expect(instances).toHaveLength(2);
    ctx.world.year = Math.max(...instances.map(instance => instance.dueYear!));
    const steps = dueArcSteps(ctx, testRng('two-hall-steps'));
    for (const step of [...steps].reverse()) {
      const result = executeOutcomeWitness(ctx, ctx.content.mustEvent('the_hall_is_answered'), {
        choiceId: 'give_them_something_real', expectedOutcomeId: 'given', arcStep: step, rng: testRng('two-hall-answers'),
      });
      expect(result.ok, result.reason).toBe(true);
    }
    const promises = observer.finish();
    expect(promises.map(promise => promise.status)).toEqual(['delivered', 'delivered']);
    expect(new Set(promises.map(promise => promise.deliveryPage)).size).toBe(2);
    for (const promise of promises) {
      expect(ctx.world.arcs.get(promise.instance!)!.cause?.page).toBe(promise.launchPage);
      expect(ctx.world.chronicle.find(page => page.id === promise.deliveryPage)?.cause?.page).toBe(promise.launchPage);
    }
  });

  it('reports an actual restart when the launching effects cancel the previous instance', () => {
    const source = indexContent(structuredClone(content.bundle));
    const { ctx } = hall(source);
    letter(ctx);
    const existing = [...ctx.world.arcs.values()][0]!;
    const launch = source.mustEvent('the_hall_that_waited');
    if (launch.interaction.kind !== 'narration') throw new Error('letter is not narration');
    launch.interaction.outcomes.find(outcome => outcome.id === 'somebody_reads_it_properly')!.effects.push({
      kind: 'arc', arc: existing.arc, op: 'cancel',
    });
    const observer = new StoryRouteObserver(ctx);
    letter(ctx);
    const [promise] = observer.finish();
    expect(existing.status).toBe('cancelled');
    expect(promise).toMatchObject({ status: 'pending_at_observation_end', queued: true });
    expect(promise!.instance).not.toBe(existing.id);
    expect(ctx.world.arcs.get(promise!.instance!)!.cause?.page).toBe(promise!.launchPage);
  });

  it('does not infer an inline instance from event/year when its provenance is absent', () => {
    const { ctx } = hall();
    const observer = new StoryRouteObserver(ctx);
    letter(ctx);
    delete [...ctx.world.arcs.values()][0]!.cause;
    const [promise] = observer.finish();
    expect(promise!.status).toBe('not_started_or_provenance_unknown');
    expect(promise!.instance).toBeUndefined();
  });

  it('reports an uncited delivery as unknown rather than crediting it to a new promise', () => {
    const ctx = testWorld(content, 197402);
    const observer = new StoryRouteObserver(ctx);
    herald(ctx);
    delete ctx.world.scheduled[0]!.cause; // Legacy schedule, no launching identity.
    ctx.world.year++;
    runPhase('ambient', ctx, emptyReport(ctx.world.year));
    expect(ctx.world.chronicle.filter(page => page.eventId === 'the_herald_opens_the_old_question')).toHaveLength(1);
    const [promise] = observer.finish();
    expect(promise!.status).toBe('delivery_provenance_unknown');
    expect(promise!.deliveryPage).toBeUndefined();
    expect(promise!.deliveredYear).toBeUndefined();
    expect(promise!.cause).toBeUndefined();
  });

  it.each(['schedule', 'decision'] as const)('keeps an uncited saved %s uncertain rather than declaring it retired', (stage) => {
    const ctx = testWorld(content, 197405);
    const observer = new StoryRouteObserver(ctx);
    herald(ctx);
    if (stage === 'schedule') delete ctx.world.scheduled[0]!.cause;
    else {
      ctx.world.year++;
      runPhase('ambient', ctx, emptyReport(ctx.world.year), false);
      const pending = ctx.world.pendingDecisions.find(decision => decision.kind === 'choice'
        && decision.event.id === 'the_herald_opens_the_old_question')!;
      if (pending.kind !== 'choice') throw new Error('scheduled scene has no choice');
      delete pending.cause;
    }
    ctx.world = loadGame(JSON.parse(JSON.stringify(saveGame(ctx))), content).world;
    const [promise] = observer.finish();
    expect(promise!.status).toBe(`${stage}_provenance_unknown`);
    expect(promise!.deliveryPage).toBeUndefined();
    expect(promise!.deliveredYear).toBeUndefined();
  });

  it('marks multiple schedules from one source page as ambiguous', () => {
    const bundle = structuredClone(content.bundle);
    const visit = bundle.events.find(event => event.id === 'the_heralds_visitation')!;
    if (visit.interaction.kind !== 'choice') throw new Error('visitation is not a choice');
    const outcome = visit.interaction.choices.find(choice => choice.id === 'the_short_descent')!.outcomes[0]!;
    outcome.effects.push(structuredClone(outcome.effects.find(effect => effect.kind === 'schedule')!));
    const ctx = testWorld(indexContent(bundle), 197403);
    const observer = new StoryRouteObserver(ctx);
    const page = herald(ctx);
    ctx.world.year++;
    runPhase('ambient', ctx, emptyReport(ctx.world.year));
    const promises = observer.finish();
    expect(promises.map(promise => promise.launchPage)).toEqual([page, page]);
    expect(promises.map(promise => promise.status)).toEqual(['ambiguous_launch_provenance', 'ambiguous_launch_provenance']);
    expect(promises.every(promise => promise.deliveredYear === undefined)).toBe(true);
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
