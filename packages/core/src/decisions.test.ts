import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { EventTemplateS, indexContent, proseOriginalHash, type EventTemplate } from '@ed/schema';
import { makeRng } from './rng.js';
import { loadGame, saveGame } from './save.js';
import { missingPlainEnglish, setProseMode, setProseVariants } from './prose.js';
import { place, testWorld } from './testing.js';
import { stepYear } from './year/step.js';
import { coreMessageAddress } from './messages.js';
import { evalCondition } from './events/conditions.js';
import { resolveSlots } from './events/slots.js';
import {
  applyRecord, autoResolveAll, queueChoice, queueMatch, queueRecord, recordEventForChoice, resolveChoice, resolveMatch, resolveRecord,
} from './events/decisions.js';

const content = indexContent(loadContent());

function fixture(seed: number, year?: number) {
  const ctx = testWorld(content, seed, year);
  place(ctx, { sex: 'male', age: 22, name: `Decision Young Man ${seed}` });
  place(ctx, { sex: 'male', age: 41, name: `Decision Older Man ${seed}` });
  place(ctx, { sex: 'female', age: 27, name: `Decision Woman ${seed}` });
  return ctx;
}

/**
 * Turn one already-fillable narration into the smallest possible player
 * choice. This tests the docket/commit mechanism without seed-mining a played
 * century for whichever authored choice happens to fire first.
 */
function playerChoiceFixture(seed: number) {
  const ctx = fixture(seed);

  for (const [index, source] of content.events.entries()) {
    if (
      source.arc
      || source.record
      || source.tier === 'frame'
      || source.interaction.kind !== 'narration'
      || source.interaction.outcomes.length !== 1
      || !evalCondition(source.conditions, ctx)
    ) continue;

    const slots = resolveSlots(source, ctx, makeRng(seed + index + 1));
    if (!slots.ok || slots.playerCast.length) continue;

    const event = structuredClone(source);
    if (event.interaction.kind !== 'narration') continue;
    const outcome = event.interaction.outcomes[0]!;
    const choiceId = 'decision_witness_choice';
    event.interaction = {
      kind: 'choice',
      decidedBy: 'player',
      choices: [{
        id: choiceId,
        label: 'Take the witnessed choice',
        requires: [],
        outcomes: [outcome],
      }],
    };

    const pending = queueChoice(ctx, event, event.body, slots.fill, []);
    return { ctx, event, pending, choiceId };
  }

  throw new Error('fixture has no fillable single-outcome narration for a choice witness');
}

function recordFixture(seed: number) {
  const ctx = fixture(seed);

  for (const [index, event] of content.events.entries()) {
    if (!event.record || event.arc) continue;
    const slots = resolveSlots(event, ctx, makeRng(seed + index + 1));
    if (!slots.ok || slots.playerCast.length) continue;

    const entryId = `decision_record_witness_${seed}`;
    ctx.world.chronicle.push({
      id: entryId,
      year: ctx.world.year,
      weight: 'paragraph',
      text: 'The event happened.',
      eventId: event.id,
      named: false,
    });
    const pending = queueRecord(ctx, event, entryId, slots.fill);
    if (pending) return { ctx, event, entryId, pending };
  }

  throw new Error('fixture has no fillable Record event');
}

describe('the decision docket mechanism', () => {
  it('keeps an invalid choice standing and spends one ration only on the valid commit', () => {
    const { ctx, event, pending, choiceId } = playerChoiceFixture(451);
    const tier = event.frequency;
    const before = ctx.world.frequency.firedThisRun[tier];

    expect(pending.body).not.toMatch(/\{[A-Z_]+\}/);

    const refused = resolveChoice(ctx, pending.id, 'not_an_authored_choice', makeRng(1));
    expect(refused.ok).toBe(false);
    expect(ctx.world.pendingDecisions.some((decision) => decision.id === pending.id)).toBe(true);
    expect(ctx.world.frequency.firedThisRun[tier]).toBe(before);

    const accepted = resolveChoice(ctx, pending.id, choiceId, makeRng(2));
    expect(accepted.ok, accepted.reason).toBe(true);
    expect(ctx.world.pendingDecisions.some((decision) => decision.id === pending.id)).toBe(false);
    expect(ctx.world.frequency.firedThisRun[tier]).toBe(before + 1);

    // Retrying an answer to a decision that has already committed is a refusal,
    // not a second spend of the tier ration.
    expect(resolveChoice(ctx, pending.id, choiceId, makeRng(3)).ok).toBe(false);
    expect(ctx.world.frequency.firedThisRun[tier]).toBe(before + 1);
  });

  it('stops the clock on an open decision and lets it move after the docket clears', () => {
    const { ctx, pending, choiceId } = playerChoiceFixture(452);
    const year = ctx.world.year;

    const blocked = stepYear(ctx, false);
    expect(blocked.year).toBe(year);
    expect(blocked.blocked?.length).toBeGreaterThan(0);
    expect(ctx.world.year).toBe(year);

    expect(resolveChoice(ctx, pending.id, choiceId, makeRng(4)).ok).toBe(true);
    stepYear(ctx, false);
    expect(ctx.world.year).toBe(year + 1);
  });

  it('drains the same production choice through the chronicler path', () => {
    const { ctx, event } = playerChoiceFixture(453);
    const tier = event.frequency;
    const before = ctx.world.frequency.firedThisRun[tier];

    autoResolveAll(ctx, makeRng(5));

    expect(ctx.world.pendingDecisions).toHaveLength(0);
    expect(ctx.world.frequency.firedThisRun[tier]).toBe(before + 1);
    expect(ctx.world.decisionLog.at(-1)).toMatchObject({
      kind: 'outcome',
      event: event.id,
      choiceId: 'decision_witness_choice',
    });
  });
});

describe('the Record docket mechanism', () => {
  it('offers all three answers and rewrites the event page in place', () => {
    const { ctx, entryId, pending } = recordFixture(461);
    const before = ctx.world.chronicle.length;

    expect(pending.options.map((option) => option.option)).toEqual(['record', 'omit', 'embellish']);
    expect(resolveRecord(ctx, pending.id, 'record').ok).toBe(true);
    expect(ctx.world.chronicle).toHaveLength(before);
    expect(ctx.world.chronicle.find((entry) => entry.id === entryId)?.record).toBe('record');
  });

  it('keeps an omission as a dated blank page', () => {
    const { ctx, entryId, pending } = recordFixture(462);

    expect(resolveRecord(ctx, pending.id, 'omit').ok).toBe(true);
    const entry = ctx.world.chronicle.find((candidate) => candidate.id === entryId);
    expect(entry?.text).toBeNull();
    expect(entry?.record).toBe('omit');
    expect(entry?.year).toBe(pending.year);
  });

  it('opens the authored discrepancy when the house embellishes', () => {
    const { ctx, entryId, pending } = recordFixture(463);
    const discrepancy = pending.options.find((option) => option.option === 'embellish')?.discrepancy;
    if (!discrepancy) throw new Error('Record witness has no embellishment discrepancy');

    expect(resolveRecord(ctx, pending.id, 'embellish').ok).toBe(true);
    expect(ctx.world.discrepancies.get(discrepancy)?.state).toBe('open');
    expect(ctx.world.chronicle.find((entry) => entry.id === entryId)?.discrepancyId).toBe(discrepancy);
  });

  it('grants knowledge through an honest Record answer', () => {
    const ctx = testWorld(content, 464);
    const event = content.events.find((candidate) => candidate.record?.options.record.grantsKnowledge);
    expect(event, 'no event grants knowledge through its Record block').toBeDefined();

    applyRecord(ctx, event!, 'decision_knowledge_witness', 'record');

    expect(ctx.world.knowledge.has(event!.record!.options.record.grantsKnowledge!)).toBe(true);
  });
});

describe('choice-scoped Record wording (#864)', () => {
  function scene() {
    const original = content.events.find((item) => item.id === 'blood_on_our_own_land')!;
    if (!original?.record) throw new Error('High-justice fixture lost its Record');
    const lawful = {
      id: 'hand_him_to_cawdry',
      subject: 'What did the house do after the killing?',
      options: {
        record: {
          chronicle: 'The house sent the accused to the Warden for lawful judgement.',
          effects: [],
          claims: [],
        },
        omit: { chronicle: null, effects: [] },
        embellish: {
          chronicle: 'The house kept the accused in Wick and hid the killing.',
          effects: [],
          claims: [],
          discrepancy: { id: 'test_false_cawdry_story', severity: 'major' as const, provableBy: ['commons'] },
        },
      },
    };
    const event: EventTemplate = { ...original, recordByChoice: [lawful] };
    expect(EventTemplateS.parse(event).recordByChoice?.[0]?.id).toBe(lawful.id);
    expect(() => EventTemplateS.parse({ ...event, recordByChoice: [lawful, lawful] }))
      .toThrow(/duplicate choice-specific Record id/);
    return { event, lawful };
  }

  it('keeps lawful and unlawful choices on separate Record blocks with a legacy fallback', () => {
    const { event, lawful } = scene();
    const ctx = testWorld(content, 86401);
    const id = 'test_record_lawful';
    ctx.world.chronicle.push({
      id, year: ctx.world.year, weight: 'paragraph', text: 'A killing occurred.',
      eventId: event.id, named: false,
    });
    const record = queueRecord(ctx, event, id, {}, lawful.id)!;
    expect(record.recordChoiceId).toBe(lawful.id);
    expect(record.subject).toBe(lawful.subject);
    expect(record.options.find((item) => item.option === 'record')?.chronicle)
      .toBe(lawful.options.record.chronicle);
    expect(record.options.find((item) => item.option === 'embellish')?.discrepancy)
      .toBe('test_false_cawdry_story');
    expect(resolveRecord(ctx, record.id, 'record').line).toBe(lawful.options.record.chronicle);
    expect(ctx.world.discrepancies.has('test_false_cawdry_story')).toBe(false);

    const selected = recordEventForChoice(event, 'keep_it_in_the_parish');
    expect(selected?.recordChoiceId).toBeUndefined();
    expect(selected?.event.record?.options.record.chronicle).toBe(event.record!.options.record.chronicle);

    const otherId = 'test_record_parish';
    const other = queueRecord(ctx, event, otherId, {}, 'keep_it_in_the_parish')!;
    expect(other.options.find((item) => item.option === 'record')?.chronicle)
      .toBe(event.record!.options.record.chronicle);
    expect(resolveRecord(ctx, other.id, 'embellish').ok).toBe(true);
    expect(ctx.world.discrepancies.get(event.record!.options.embellish.discrepancy.id)?.state).toBe('open');
  });

  it('freezes selected Plain English wording across save/reload and later mode changes', () => {
    const { event, lawful } = scene();
    const ctx = testWorld(content, 86402);
    const base = 'content:events/rare_crown.yaml#events[id=blood_on_our_own_land].recordByChoice[id=hand_him_to_cawdry]';
    const plainSubject = 'What happened to the accused?';
    const plainRecord = 'The house sent the accused to the Warden as the law required.';
    setProseVariants(ctx, [
      { address: `${base}.subject`, of: proseOriginalHash(lawful.subject), plainenglish: plainSubject },
      { address: `${base}.options.record.chronicle`, of: proseOriginalHash(lawful.options.record.chronicle), plainenglish: plainRecord },
    ]);
    setProseMode(ctx, 'plainenglish');

    const id = 'test_record_pending_save';
    ctx.world.chronicle.push({
      id, year: ctx.world.year, weight: 'paragraph', text: 'A killing occurred.',
      eventId: event.id, named: false,
    });
    const pending = queueRecord(ctx, event, id, {}, lawful.id)!;
    expect(pending.subject).toBe(plainSubject);
    expect(pending.options[0]?.chronicle).toBe(plainRecord);
    expect(missingPlainEnglish(ctx)).not.toContain(`${base}.options.record.chronicle`);

    const reloaded = loadGame(JSON.parse(JSON.stringify(saveGame(ctx))), content);
    const restored = reloaded.world.pendingDecisions.find((item) => item.kind === 'record' && item.id === pending.id);
    expect(restored?.kind).toBe('record');
    if (!restored || restored.kind !== 'record') throw new Error('Saved Record vanished');
    expect(restored.recordChoiceId).toBe(lawful.id);
    expect(restored.subject).toBe(plainSubject);
    expect(restored.options[0]?.chronicle).toBe(plainRecord);
    setProseMode(reloaded, 'original');
    expect(resolveRecord(reloaded, restored.id, 'record').line).toBe(plainRecord);
    expect(reloaded.world.chronicle.find((line) => line.id === id)?.text).toBe(plainRecord);
  });

  it('routes the actual player decision to the matching authored Record block', () => {
    const { ctx, pending, choiceId } = playerChoiceFixture(86404);
    const authored = content.events.find((item) => item.id === 'blood_on_our_own_land')!.record!;
    const selected = {
      ...authored,
      id: choiceId,
      subject: 'A specific choice was taken.',
      options: {
        ...authored.options,
        record: { ...authored.options.record, chronicle: 'This is the account of that choice.' },
      },
    };
    pending.event.record = authored;
    pending.event.recordByChoice = [selected];

    const answer = resolveChoice(ctx, pending.id, choiceId, makeRng(86404));
    expect(answer.ok, answer.reason).toBe(true);
    const record = ctx.world.pendingDecisions.find((item) => item.kind === 'record');
    expect(record?.kind).toBe('record');
    if (!record || record.kind !== 'record') throw new Error('Choice did not queue its Record');
    expect(record.recordChoiceId).toBe(choiceId);
    expect(record.subject).toBe(selected.subject);
    expect(record.options[0]?.chronicle).toBe(selected.options.record.chronicle);
    expect(resolveRecord(ctx, record.id, 'record').line).toBe(selected.options.record.chronicle);
  });

  it('chooses factual outcome-specific accounts before choice-wide fallbacks', () => {
    const { event, lawful } = scene();
    const first = {
      ...lawful,
      id: 'keep_it_in_the_parish/kept_in_the_parish',
      subject: 'The killer was sent south.',
      options: {
        ...lawful.options,
        record: { ...lawful.options.record, chronicle: 'He went south before nightfall.' },
      },
    };
    const second = {
      ...lawful,
      id: 'keep_it_in_the_parish/cawdry_hears_of_it',
      subject: 'The Warden heard of the unlawful judgement.',
      options: {
        ...lawful.options,
        record: { ...lawful.options.record, chronicle: 'After two years the Warden summoned the house.' },
      },
    };
    event.recordByOutcome = [first, second];
    expect(EventTemplateS.parse(event).recordByOutcome).toHaveLength(2);
    expect(() => EventTemplateS.parse({ ...event, recordByOutcome: [first, first] }))
      .toThrow(/duplicate outcome-specific Record id/);
    expect(() => EventTemplateS.parse({ ...event, recordByOutcome: [{ ...first, id: 'not_a_pair' }] }))
      .toThrow(/choice_id\/outcome_id/);

    const ctx = testWorld(content, 86405);
    const base = `content:events/rare_crown.yaml#events[id=blood_on_our_own_land].recordByOutcome[id=${encodeURIComponent(second.id)}]`;
    const plainSubject = 'The Warden learned about the case.';
    const plainRecord = 'Two years later the Warden called the house to court.';
    setProseVariants(ctx, [
      { address: `${base}.subject`, of: proseOriginalHash(second.subject), plainenglish: plainSubject },
      { address: `${base}.options.record.chronicle`, of: proseOriginalHash(second.options.record.chronicle), plainenglish: plainRecord },
    ]);
    setProseMode(ctx, 'plainenglish');

    const early = queueRecord(ctx, event, 'early-page', {}, 'keep_it_in_the_parish', 'kept_in_the_parish')!;
    expect(early.recordChoiceId).toBe('keep_it_in_the_parish');
    expect(early.recordOutcomeId).toBe('kept_in_the_parish');
    expect(early.options[0]?.chronicle).toBe(first.options.record.chronicle);
    expect(resolveRecord(ctx, early.id, 'record').line).toBe(first.options.record.chronicle);

    const late = queueRecord(ctx, event, 'late-page', {}, 'keep_it_in_the_parish', 'cawdry_hears_of_it')!;
    expect(late.recordChoiceId).toBe('keep_it_in_the_parish');
    expect(late.recordOutcomeId).toBe('cawdry_hears_of_it');
    expect(late.subject).toBe(plainSubject);
    expect(late.options[0]?.chronicle).toBe(plainRecord);

    // A loaded docket retains the exact account and its prose address.
    const loaded = loadGame(JSON.parse(JSON.stringify(saveGame(ctx))), content);
    const restored = loaded.world.pendingDecisions.find((item) => item.kind === 'record' && item.id === late.id);
    if (!restored || restored.kind !== 'record') throw new Error('Outcome-scoped Record was not saved');
    expect(restored.recordOutcomeId).toBe('cawdry_hears_of_it');
    expect(restored.recordChoiceId).toBe('keep_it_in_the_parish');
    setProseMode(loaded, 'original');
    expect(resolveRecord(loaded, restored.id, 'record').line).toBe(plainRecord);
    expect(loaded.world.chronicle.find((entry) => entry.id === 'late-page')?.text).toBe(plainRecord);

    // Without an exact override, a still-authored choice override wins.
    const fallback = recordEventForChoice(event, lawful.id, 'other_outcome');
    expect(fallback?.recordChoiceId).toBe(lawful.id);
    expect(fallback?.recordOutcomeId).toBeUndefined();
  });

  it('passes the committed outcome id from the player to the pending Record', () => {
    const { ctx, pending, choiceId } = playerChoiceFixture(86406);
    if (pending.event.interaction.kind === 'narration') throw new Error('fixture is not a choice');
    const outcome = pending.event.interaction.choices[0]!.outcomes[0]!;
    const original = content.events.find((item) => item.id === 'blood_on_our_own_land')!.record!;
    const specific = {
      ...original,
      id: `${choiceId}/${outcome.id}`,
      subject: 'The actual outcome is remembered.',
    };
    pending.event.record = original;
    pending.event.recordByOutcome = [specific];

    const resolved = resolveChoice(ctx, pending.id, choiceId, makeRng(86406));
    expect(resolved.ok, resolved.reason).toBe(true);
    const record = ctx.world.pendingDecisions.find((item) => item.kind === 'record');
    if (!record || record.kind !== 'record') throw new Error('Outcome produced no Record');
    expect(record.recordChoiceId).toBe(choiceId);
    expect(record.recordOutcomeId).toBe(outcome.id);
    expect(record.subject).toBe(specific.subject);
  });

  it('an authored choice override may be omitted without modifying narration and old Record fields', () => {
    const { event, lawful } = scene();
    const ctx = testWorld(content, 86403);
    const selected = recordEventForChoice(event, lawful.id)!;
    expect(selected.recordChoiceId).toBe(lawful.id);
    expect(recordEventForChoice(event)?.recordChoiceId).toBeUndefined();
    const pending = queueRecord(ctx, event, 'test_blank_record', {}, lawful.id)!;
    expect(resolveRecord(ctx, pending.id, 'omit').line).toBeNull();
    expect(ctx.world.chronicle.find((page) => page.id === 'test_blank_record')?.text).toBeNull();
  });
});

// Use the real authored choice and its real outcome/effects, but restrict
// the random outcome draw to one authored result. Each witness is therefore
// deterministic without seed-mining a Long Line or rewriting the outcome.
function crownWitness(
  eventId: string, choiceId: string, outcomeId: string, seed: number,
  cast: { childAge?: number; year?: number } = {},
) {
  const ctx = fixture(seed, cast.year);
  const son = place(ctx, { sex: 'male', age: 23, name: 'Witness Son ' + seed });
  const head = place(ctx, { sex: 'male', age: 45, name: 'Witness Head ' + seed, castSlots: ['head'] });
  // Every other Crown scene's cast. The authored slot filters are the
  // selector's business, not this witness's, so each is placed inside them.
  const candidate = place(ctx, { sex: 'male', age: 40, name: 'Witness Candidate ' + seed });
  const daughter = place(ctx, { sex: 'female', age: 18, name: 'Witness Daughter ' + seed });
  const rival = place(ctx, { sex: 'male', age: 50, name: 'Witness Rival ' + seed });
  const child = place(ctx, { sex: 'male', age: cast.childAge ?? 9, name: 'Witness Child ' + seed });
  const event = structuredClone(content.events.find((item) => item.id === eventId)!);
  if (event.interaction.kind === 'narration') throw new Error('Crown scene lost its choice');

  event.interaction.choices = event.interaction.choices.map((choice) =>
    choice.id === choiceId
      ? { ...choice, outcomes: choice.outcomes.filter((outcome) => outcome.id === outcomeId) }
      : choice,
  );
  // A deterministic narrowed interaction must also narrow its authored
  // Record selectors. The save schema rightly rejects a selector for an
  // outcome that no longer exists in this isolated fixture (#874).
  // Keep selectors belonging to other choices and preserve the real
  // selected outcome's Record block unmodified.
  if (event.recordByOutcome) {
    event.recordByOutcome = event.recordByOutcome.filter(
      (row) => !row.id.startsWith(`${choiceId}/`) || row.id === `${choiceId}/${outcomeId}`,
    );
  }
  const fill = {
    HEAD: head.id, SON: son.id, CANDIDATE: candidate.id, DAUGHTER: daughter.id, RIVAL: rival.id, CHILD: child.id,
  };
  const pending = queueChoice(ctx, event, event.body, fill, []);
  const answer = resolveChoice(ctx, pending.id, choiceId, makeRng(seed + 1));
  expect(answer.ok, answer.reason).toBe(true);
  expect(ctx.world.decisionLog.at(-1)).toMatchObject({
    kind: 'outcome', event: eventId, choiceId, outcomeId,
  });

  const record = ctx.world.pendingDecisions.find((item) => item.kind === 'record');
  if (!record || record.kind !== 'record') throw new Error('Chosen Crown outcome has no Record');
  return { ctx, event, record, son, candidate, child, entryId: answer.resolved!.entryId };
}

describe('authored Crown justice and levy Record truth (#869)', () => {
  const scenes = [
    { event: 'blood_on_our_own_land', choice: 'hand_him_to_cawdry', outcome: 'sent_to_the_assize', selected: 'choice' },
    { event: 'blood_on_our_own_land', choice: 'keep_it_in_the_parish', outcome: 'kept_in_the_parish', selected: 'fallback' },
    { event: 'blood_on_our_own_land', choice: 'keep_it_in_the_parish', outcome: 'cawdry_hears_of_it', selected: 'fallback' },
    { event: 'the_levy_in_earnest', choice: 'send_them', outcome: 'seven_come_back', selected: 'outcome' },
    { event: 'the_levy_in_earnest', choice: 'send_them', outcome: 'he_does_not', selected: 'outcome' },
    { event: 'the_levy_in_earnest', choice: 'commute_it', outcome: 'commuted', selected: 'fallback' },
  ] as const;

  for (const [index, scene] of scenes.entries()) {
    it(`${scene.event}: ${scene.choice}/${scene.outcome} records the chosen fact and a distinct lie`, () => {
      const { ctx, event, record, son, entryId } = crownWitness(
        scene.event, scene.choice, scene.outcome, 86900 + index,
      );
      const chosen = recordEventForChoice(event, scene.choice, scene.outcome)!;
      const expected = chosen.event.record!;
      const expectedDiscrepancy = expected.options.embellish.discrepancy.id;

      expect(record.subject).toBe(expected.subject);
      expect(record.options[0]?.chronicle).toBe(expected.options.record.chronicle);
      expect(record.options[2]?.chronicle).toBe(expected.options.embellish.chronicle);
      expect(record.options[2]?.discrepancy).toBe(expectedDiscrepancy);
      expect(record.recordChoiceId === undefined ? 'fallback' : record.recordOutcomeId ? 'outcome' : 'choice')
        .toBe(scene.selected);

      const saved = loadGame(JSON.parse(JSON.stringify(saveGame(ctx))), content);
      const restored = saved.world.pendingDecisions.find((item) => item.kind === 'record' && item.id === record.id);
      if (!restored || restored.kind !== 'record') throw new Error('Save lost the selected Record');
      expect(restored.options).toEqual(record.options);
      expect(restored.recordChoiceId).toBe(record.recordChoiceId);
      expect(restored.recordOutcomeId).toBe(record.recordOutcomeId);

      const res = resolveRecord(saved, restored.id, 'record');
      expect(res.ok).toBe(true);
      expect(res.line).not.toBeNull();
      if (scene.event === 'the_levy_in_earnest' && scene.choice === 'send_them') {
        expect(res.line).toContain(son.name);
      }
      const page = saved.world.chronicle.find((entry) => entry.id === entryId)!;
      expect(page.record).toBe('record');
      expect(page.text).toBe(res.line);
      expect(page.claims).toHaveLength(1);
      expect(page.claims?.[0]?.kind).toBe('deed');
      expect(page.discrepancyId).toBeUndefined();
      expect(saved.world.discrepancies.has(expectedDiscrepancy)).toBe(false);
    });
  }

  it('keeps new Plain English Chronicle copy frozen across a saved pending docket and a mode switch', () => {
    for (const [index, scene] of scenes.entries()) {
      const { ctx, event, record, son, entryId } = crownWitness(
        scene.event, scene.choice, scene.outcome, 86920 + index,
      );
      // A real prose-mode choice happens while the Record docket is visible.
      // Queue a second witnessed Record in Plain English to test that fork
      // without changing the actual chosen outcome.
      const selected = recordEventForChoice(event, scene.choice, scene.outcome)!;
      // The catalogue is host-supplied presentation state, not bundled into
      // a simulation's default ProseRuntime. Exercise the same setup as the
      // game/editor host before selecting the translated register.
      setProseVariants(ctx, content.proseVariants);
      setProseMode(ctx, 'plainenglish');
      const pageId = entryId + '_plain';
      ctx.world.chronicle.push({
        id: pageId, year: ctx.world.year, weight: 'paragraph',
        text: 'The event happened.', eventId: event.id, named: false,
      });
      const plain = queueRecord(ctx, event, pageId, { SON: son.id }, scene.choice, scene.outcome)!;
      const base = `content:events/rare_crown.yaml#events[id=${scene.event}]`
        + (selected.recordOutcomeId
          ? `.recordByOutcome[id=${encodeURIComponent(`${scene.choice}/${scene.outcome}`)}]`
          : selected.recordChoiceId ? `.recordByChoice[id=${scene.choice}]` : '.record');
      const variant = content.proseVariants.find((item) => item.address === `${base}.options.record.chronicle`);
      expect(plain.options[0]?.chronicle)
        .toBe(variant?.plainenglish ?? selected.event.record!.options.record.chronicle);

      // Resolve the Original's original docket first, then the frozen
      // translated docket after reloading in the opposite display mode.
      expect(resolveRecord(ctx, record.id, 'omit').line).toBeNull();
      const saved = loadGame(JSON.parse(JSON.stringify(saveGame(ctx))), content);
      setProseMode(saved, 'original');
      const text = resolveRecord(saved, plain.id, 'record').line;
      expect(text).not.toBeNull();
      expect(text).not.toContain('{SON}');
      expect(saved.world.chronicle.find((entry) => entry.id === pageId)?.text).toBe(text);
      expect(saved.world.chronicle.find((entry) => entry.id === entryId)?.text).toBeNull();
    }
  });

  it('an embellishment creates proof debt, while an omission remains a dated blank', () => {
    for (const [index, scene] of scenes.entries()) {
      const { ctx, event, record, entryId } = crownWitness(
        scene.event, scene.choice, scene.outcome, 86940 + index,
      );
      const selected = recordEventForChoice(event, scene.choice, scene.outcome)!;
      const debt = selected.event.record!.options.embellish.discrepancy.id;
      expect(resolveRecord(ctx, record.id, 'embellish').ok).toBe(true);
      expect(ctx.world.discrepancies.get(debt)?.state).toBe('open');
      const page = ctx.world.chronicle.find((entry) => entry.id === entryId)!;
      expect(page.discrepancyId).toBe(debt);
      expect(page.record).toBe('embellish');
      expect(page.claims).toHaveLength(1);

      const blank = queueRecord(ctx, event, entryId + '_omitted', {}, scene.choice, scene.outcome)!;
      expect(resolveRecord(ctx, blank.id, 'omit').line).toBeNull();
      const omitted = ctx.world.chronicle.find((entry) => entry.id === entryId + '_omitted')!;
      expect(omitted.record).toBe('omit');
      expect(omitted.text).toBeNull();
      expect(omitted.claims).toBeUndefined();
    }
  });
});

describe('authored Crown Record truth for the remaining six scenes (#864)', () => {
  // Every choice/outcome pair of the six scenes, and which authored Record it
  // must select. A pair this table misses is a pair whose truth nobody
  // checked, so the first test fails when the content grows one.
  const scenes = [
    { event: 'the_third_reading_of_the_roll', choice: 'send_a_man_to_caster', outcome: 'corrected', selected: 'outcome' },
    { event: 'the_third_reading_of_the_roll', choice: 'send_a_man_to_caster', outcome: 'it_was_not_an_error', selected: 'fallback' },
    { event: 'the_third_reading_of_the_roll', choice: 'let_the_reading_stand', outcome: 'stood', selected: 'choice' },
    { event: 'the_wardenship_falls_vacant', choice: 'put_the_name_forward', outcome: 'not_chosen', selected: 'outcome' },
    { event: 'the_wardenship_falls_vacant', choice: 'put_the_name_forward', outcome: 'chosen', selected: 'outcome' },
    { event: 'the_wardenship_falls_vacant', choice: 'stay_out_of_it', outcome: 'stayed_out', selected: 'fallback' },
    { event: 'the_king_passes_within_a_day', choice: 'ride_out', outcome: 'seen', selected: 'outcome' },
    { event: 'the_king_passes_within_a_day', choice: 'ride_out', outcome: 'seated_badly', selected: 'outcome' },
    { event: 'the_king_passes_within_a_day', choice: 'stay_at_ardwen', outcome: 'stayed', selected: 'fallback' },
    { event: 'the_house_next_door_attainted', choice: 'buy_the_land', outcome: 'bought', selected: 'choice' },
    { event: 'the_house_next_door_attainted', choice: 'stay_clear_of_it', outcome: 'stayed_clear', selected: 'fallback' },
    { event: 'the_hostage_asked_for', choice: 'give_the_child', outcome: 'given', selected: 'choice' },
    { event: 'the_hostage_asked_for', choice: 'give_the_child', outcome: 'something_was_noticed', selected: 'choice' },
    { event: 'the_hostage_asked_for', choice: 'refuse_the_surety', outcome: 'refused_surety', selected: 'fallback' },
    { event: 'the_heralds_open_the_descent', choice: 'send_what_we_have', outcome: 'three_and_a_gap', selected: 'fallback' },
    { event: 'the_heralds_open_the_descent', choice: 'send_what_we_have', outcome: 'they_go_looking', selected: 'outcome' },
    { event: 'the_heralds_open_the_descent', choice: 'buy_the_fourth', outcome: 'bought_the_fourth', selected: 'choice' },
  ] as const;
  const eventIds = [...new Set(scenes.map((scene) => scene.event))];

  function authored(eventId: string): EventTemplate {
    const event = content.events.find((item) => item.id === eventId);
    if (!event || event.interaction.kind === 'narration') throw new Error(`${eventId} lost its choice`);
    return event;
  }

  it('lists every choice and outcome of the six scenes', () => {
    for (const eventId of eventIds) {
      const event = authored(eventId);
      if (event.interaction.kind === 'narration') throw new Error('unreachable');
      const pairs = event.interaction.choices
        .flatMap((choice) => choice.outcomes.map((outcome) => `${choice.id}/${outcome.id}`));
      const listed = scenes.filter((scene) => scene.event === eventId)
        .map((scene) => `${scene.choice}/${scene.outcome}`);
      expect(listed.sort(), eventId).toEqual(pairs.sort());
    }
  });

  it('gives every Record a scene can select its own lie', () => {
    // A lie shared by two Records is a lie that is true of one of them.
    for (const eventId of eventIds) {
      const event = authored(eventId);
      const blocks = [event.record!, ...(event.recordByChoice ?? []), ...(event.recordByOutcome ?? [])];
      const lies = blocks.map((block) => block.options.embellish.discrepancy.id);
      expect(new Set(lies).size, eventId).toBe(lies.length);
    }
  });

  for (const [index, scene] of scenes.entries()) {
    it(`${scene.event}: ${scene.choice}/${scene.outcome} records the chosen fact and embellishes a lie`, () => {
      const { ctx, event, record, entryId } = crownWitness(
        scene.event, scene.choice, scene.outcome, 86400 + index,
      );
      const chosen = recordEventForChoice(event, scene.choice, scene.outcome)!;
      const block = chosen.event.record!;
      expect(record.recordChoiceId === undefined ? 'fallback' : record.recordOutcomeId ? 'outcome' : 'choice')
        .toBe(scene.selected);
      expect(record.subject).toBe(block.subject);

      // The truthful account survives a save, interpolates its cast, and
      // owes nothing.
      const saved = loadGame(JSON.parse(JSON.stringify(saveGame(ctx))), content);
      const restored = saved.world.pendingDecisions.find((item) => item.kind === 'record' && item.id === record.id);
      if (!restored || restored.kind !== 'record') throw new Error('Save lost the selected Record');
      expect(restored.options).toEqual(record.options);
      const told = resolveRecord(saved, restored.id, 'record');
      expect(told.ok).toBe(true);
      expect(told.line).not.toMatch(/\{[A-Z_]+\}/);
      const page = saved.world.chronicle.find((entry) => entry.id === entryId)!;
      expect(page.record).toBe('record');
      expect(page.discrepancyId).toBeUndefined();
      expect(saved.world.discrepancies.has(block.options.embellish.discrepancy.id)).toBe(false);

      // The same branch embellished opens the selected block's own debt.
      const lie = crownWitness(scene.event, scene.choice, scene.outcome, 86450 + index);
      expect(resolveRecord(lie.ctx, lie.record.id, 'embellish').ok).toBe(true);
      expect(lie.ctx.world.discrepancies.get(block.options.embellish.discrepancy.id)?.state).toBe('open');
      expect(lie.ctx.world.chronicle.find((entry) => entry.id === lie.entryId)?.discrepancyId)
        .toBe(block.options.embellish.discrepancy.id);
    });
  }
});

describe('Crown chronology holds whenever the scene can fire (#885)', () => {
  // Neither scene is scoped to an Age, so either can fire in any year of a
  // Long Line, and in any of the years the CHILD slot admits.
  const years = [1042, 1541];
  const outcomeText = (event: EventTemplate, choiceId: string, outcomeId: string): string => {
    if (event.interaction.kind === 'narration') throw new Error(`${event.id} lost its choice`);
    return event.interaction.choices.find((choice) => choice.id === choiceId)!
      .outcomes.find((outcome) => outcome.id === outcomeId)!.text;
  };

  it('the attainder scene names no year later than the one it fires in', () => {
    const pairs = [['buy_the_land', 'bought'], ['stay_clear_of_it', 'stayed_clear']] as const;
    for (const [index, year] of years.entries()) {
      for (const [choiceId, outcomeId] of pairs) {
        const { ctx, event, record } = crownWitness(
          'the_house_next_door_attainted', choiceId, outcomeId, 88500 + index, { year },
        );
        const told = resolveRecord(ctx, record.id, 'record').line;
        const texts = [outcomeText(event, choiceId, outcomeId), told, ...record.options.map((option) => option.chronicle)];
        for (const text of texts) {
          for (const named of (text ?? '').matchAll(/\b1[0-9]{3}\b/g)) {
            expect(Number(named[0]), `${choiceId}/${outcomeId} in ${year}: ${text}`).toBeLessThanOrEqual(year);
          }
        }
      }
    }
  });

  it('the surety scene states no age a child at either end of the slot would contradict', () => {
    const event = content.events.find((item) => item.id === 'the_hostage_asked_for')!;
    const ageFilters = (event.slots.CHILD?.filters ?? []).flatMap((filter) => ('age' in filter ? [filter.age] : []));
    const youngest = ageFilters.find((age) => age.op === 'gte')!.value;
    const oldest = ageFilters.find((age) => age.op === 'lte')!.value;
    expect(oldest).toBeGreaterThan(youngest);
    const NAMED_AGE = /\b(?:at|of|aged) (?:six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|\d+)\b/i;

    for (const [index, childAge] of [youngest, oldest].entries()) {
      for (const outcomeId of ['given', 'something_was_noticed']) {
        const { ctx, event: played, record, child } = crownWitness(
          'the_hostage_asked_for', 'give_the_child', outcomeId, 88600 + index, { childAge },
        );
        expect(ctx.world.year - child.born).toBe(childAge);
        const text = outcomeText(played, 'give_the_child', outcomeId);
        expect(text, outcomeId).not.toMatch(NAMED_AGE);
        expect(text, outcomeId).toMatch(/five years|fifth year/);
        const told = resolveRecord(ctx, record.id, 'record').line!;
        expect(told).not.toMatch(NAMED_AGE);
        expect(told).toContain(child.name);
      }
    }
  });
});

describe('Record-option Chronicle-effect prose (#806)', () => {
  it('selects reviewed wording at commit time and never rewrites earlier pages', () => {
    const source = content.events.find((item) => item.id === 'a_second_hand_that_agrees')!;
    if (!source?.record) throw new Error('Cawdry fixture has no Record block');

    const original = 'The notary recorded another copy of the supporting document.';
    const plain = 'The notary wrote down another copy of the supporting document.';
    const event: EventTemplate = {
      ...source,
      record: {
        ...source.record,
        options: {
          ...source.record.options,
          record: {
            ...source.record.options.record,
            effects: [{ kind: 'chronicle', text: original }],
          },
        },
      },
    };
    const address = 'content:events/burying.yaml#events[id=a_second_hand_that_agrees].record.options.record.effects[0].text';
    const ctx = testWorld(content);
    setProseVariants(ctx, [{ address, of: proseOriginalHash(original), plainenglish: plain }]);
    const written = () => ctx.world.chronicle.filter((page) => page.weight === 'line').map((page) => page.text);

    applyRecord(ctx, event, 'fixture-original', 'record');
    expect(written()).toEqual([original]);

    setProseMode(ctx, 'plainenglish');
    applyRecord(ctx, event, 'fixture-plain', 'record');
    expect(written()).toEqual([original, plain]);
    expect(missingPlainEnglish(ctx)).not.toContain(address);

    setProseVariants(ctx, [{ address, of: '0000000000000000', plainenglish: plain }]);
    applyRecord(ctx, event, 'fixture-stale', 'record');
    expect(written()).toEqual([original, plain, original]);
    expect(missingPlainEnglish(ctx)).toContain(address);

    setProseMode(ctx, 'original');
    expect(written()).toEqual([original, plain, original]);
  });
});


describe('keyed docket refusals (#833)', () => {
  // Every literal is frozen here so an Original edit requires review of its hash.
  const MESSAGES = [
    ['decision.choice.missing', 'no such decision', 'That decision is no longer available.'],
    ['decision.choice.narration', 'narration takes no choice', 'This scene does not ask you to choose.'],
    ['decision.cast.at_most', '{SLOT} takes at most {MAX}', 'Choose no more than {MAX} people for {SLOT}.'],
    ['decision.cast.at_least', '{SLOT} takes at least {MIN}', 'Choose at least {MIN} people for {SLOT}.'],
    ['decision.cast.missing', 'nobody cast as {SLOT}', 'Choose someone for {SLOT}.'],
    ['decision.choice.player_required', "this decision is the house's to take", 'You must choose for the family.'],
    ['decision.choice.unknown', "no choice '{CHOICE}'", "The choice '{CHOICE}' is not available."],
    ['decision.match.missing', 'no such match', 'That marriage offer is no longer available.'],
    ['decision.match.unknown_card', 'no such card', 'That marriage card is not in the offer.'],
  ] as const;

  function run(mode: 'original' | 'plainenglish') {
    const { ctx, pending, choiceId } = playerChoiceFixture(8833);
    setProseVariants(ctx, MESSAGES.map(([key, original, plainenglish]) => ({
      address: coreMessageAddress(key), of: proseOriginalHash(original), plainenglish,
    })));
    setProseMode(ctx, mode);
    const rng = makeRng(833);
    const refused: Array<{ ok: boolean; reason?: string }> = [];
    refused.push(resolveChoice(ctx, 'does-not-exist', choiceId, rng));

    // A narration is not an authored branch even if a stale client attempts one.
    const actualInteraction = pending.event.interaction;
    pending.event.interaction = { kind: 'narration', outcomes: [] };
    refused.push(resolveChoice(ctx, pending.id, choiceId, rng));
    pending.event.interaction = actualInteraction;

    pending.cast = [{
      slot: 'party', optional: false,
      count: { min: 2, max: 2 },
      candidates: [
        { id: 'c1', name: 'First', age: 20 },
        { id: 'c2', name: 'Second', age: 22 },
        { id: 'c3', name: 'Third', age: 24 },
      ],
    }];
    refused.push(resolveChoice(ctx, pending.id, choiceId, rng, { party: ['c1', 'c2', 'c3'] }));
    refused.push(resolveChoice(ctx, pending.id, choiceId, rng, { party: ['c1'] }));
    pending.cast = [{ slot: 'witness', optional: false, candidates: [{ id: 'c1', name: 'First', age: 20 }] }];
    refused.push(resolveChoice(ctx, pending.id, choiceId, rng));

    pending.cast = [];
    refused.push(resolveChoice(ctx, pending.id, undefined, rng));
    refused.push(resolveChoice(ctx, pending.id, 'unknown_choice', rng));
    refused.push(resolveMatch(ctx, 'does-not-exist', 'missing'));
    const match = queueMatch(ctx, {
      subject: { id: 'c1', name: 'First', sex: 'male', age: 20 }, cards: [],
    });
    refused.push(resolveMatch(ctx, match.id, 'missing'));

    const beforeSuccess = structuredClone(ctx.world.pendingDecisions);
    const accepted = resolveChoice(ctx, pending.id, choiceId, rng);
    return {
      refused, beforeSuccess,
      accepted: accepted.ok,
      pending: structuredClone(ctx.world.pendingDecisions),
      decisions: structuredClone(ctx.world.decisionLog),
      frequency: structuredClone(ctx.world.frequency),
    };
  }

  it('keeps all nine Originals and translates the same refusals without moving the docket', () => {
    expect(MESSAGES).toHaveLength(9);
    expect(new Set(MESSAGES.map(([key]) => key)).size).toBe(9);
    const original = run('original');
    const plain = run('plainenglish');
    expect(original.refused.map((result) => result.reason)).toEqual([
      'no such decision',
      'narration takes no choice',
      'party takes at most 2',
      'party takes at least 2',
      'nobody cast as witness',
      "this decision is the house's to take",
      "no choice 'unknown_choice'",
      'no such match',
      'no such card',
    ]);
    expect(plain.refused.map((result) => result.reason)).toEqual([
      'That decision is no longer available.',
      'This scene does not ask you to choose.',
      'Choose no more than 2 people for party.',
      'Choose at least 2 people for party.',
      'Choose someone for witness.',
      'You must choose for the family.',
      "The choice 'unknown_choice' is not available.",
      'That marriage offer is no longer available.',
      'That marriage card is not in the offer.',
    ]);
    expect(original.refused.map((result) => result.ok)).toEqual(Array(9).fill(false));
    expect(plain.refused.map((result) => result.ok)).toEqual(Array(9).fill(false));
    expect(plain.beforeSuccess).toEqual(original.beforeSuccess);
    expect(plain.accepted).toBe(true);
    expect(plain.accepted).toBe(original.accepted);
    expect(plain.pending).toEqual(original.pending);
    expect(plain.decisions).toEqual(original.decisions);
    expect(plain.frequency).toEqual(original.frequency);
  });

  it('falls back to the Original if a host supplies a stale fingerprint', () => {
    const ctx = fixture(8834);
    setProseVariants(ctx, [{
      address: coreMessageAddress('decision.choice.missing'),
      of: '0000000000000000',
      plainenglish: 'The decision is missing.',
    }]);
    setProseMode(ctx, 'plainenglish');
    expect(resolveChoice(ctx, 'missing', undefined, makeRng(834)).reason).toBe('no such decision');
    expect(missingPlainEnglish(ctx)).toContain(coreMessageAddress('decision.choice.missing'));
  });
});
