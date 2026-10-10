import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { asId, auditChoices, CONTENT_RULES, effectSignature, EventTemplateS, indexContent, inlineArcId, outcomeSignature, runRule, SigningQuestionS, SigningTermS, validateBundle, type ContentBundle, type SigningQuestion } from '@ed/schema';

const content = loadContent();

describe('Record selector validation (#874)', () => {
  const fixture = () => {
    const source = content.bundle.events.find((event) => event.id === 'blood_on_our_own_land');
    if (!source) throw new Error('Wick justice Record fixture is absent');
    const event = structuredClone(source);
    // Narrow the cloned fixture itself: a discriminated union's narrowing of
    // the source does not survive structuredClone's inferred generic type.
    if (!event.record || event.interaction.kind === 'narration') {
      throw new Error('Wick justice Record fixture missing its authored choices');
    }
    // Do not depend on #869's separately claimed authored overrides.
    event.recordByChoice = undefined;
    event.recordByOutcome = undefined;
    const [first, second] = event.interaction.choices;
    if (!first || !second || !first.outcomes[0] || !second.outcomes[0]) {
      throw new Error('Wick justice choices lost their outcomes');
    }
    return { event, first, second, record: event.record };
  };

  function errors(value: unknown): { path: string; message: string }[] {
    const parsed = EventTemplateS.safeParse(value);
    if (parsed.success) return [];
    return parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
  }

  it('accepts real choice and exact choice/outcome selectors, or no selectors', () => {
    const { event, first, second, record } = fixture();
    expect(errors(event)).toEqual([]);
    expect(errors({
      ...event,
      recordByChoice: [{ ...record, id: first.id }],
      recordByOutcome: [
        { ...record, id: `${first.id}/${first.outcomes[0]!.id}` },
        { ...record, id: `${second.id}/${second.outcomes[0]!.id}` },
      ],
    })).toEqual([]);
  });

  it('refuses misspelled choice selectors instead of silently choosing the legacy Record', () => {
    const { event, record } = fixture();
    expect(errors({ ...event, recordByChoice: [{ ...record, id: 'hand_him_to_cawdrey' }] }))
      .toEqual([expect.objectContaining({
        path: 'recordByChoice.0.id',
        message: expect.stringContaining('unknown choice-specific Record id'),
      })]);
  });

  it('refuses an unknown outcome on a real choice and a real outcome on the wrong choice', () => {
    const { event, first, second, record } = fixture();
    expect(errors({ ...event, recordByOutcome: [{ ...record, id: `${first.id}/not_an_outcome` }] }))
      .toEqual([expect.objectContaining({
        path: 'recordByOutcome.0.id',
        message: expect.stringContaining('unknown outcome for choice'),
      })]);
    expect(first.outcomes.some((outcome) => outcome.id === second.outcomes[0]!.id)).toBe(false);
    expect(errors({
      ...event,
      recordByOutcome: [{ ...record, id: `${first.id}/${second.outcomes[0]!.id}` }],
    })).toEqual([expect.objectContaining({
      path: 'recordByOutcome.0.id',
      message: expect.stringContaining('unknown outcome for choice'),
    })]);
    expect(errors({ ...event, recordByOutcome: [{ ...record, id: 'unknown_choice/actual_outcome' }] }))
      .toEqual([expect.objectContaining({
        path: 'recordByOutcome.0.id',
        message: expect.stringContaining('unknown choice in outcome-specific'),
      })]);
  });

  it('refuses choice-scoped selectors on narration without removing its legacy Record', () => {
    const { event, first, record } = fixture();
    const narration = { ...event, interaction: { kind: 'narration', outcomes: [first.outcomes[0]] } };
    expect(errors(narration)).toEqual([]);
    expect(errors({
      ...narration,
      recordByChoice: [{ ...record, id: first.id }],
      recordByOutcome: [{ ...record, id: `${first.id}/${first.outcomes[0]!.id}` }],
    })).toEqual([
      expect.objectContaining({ path: 'recordByChoice.0.id', message: expect.stringContaining('unknown choice') }),
      expect.objectContaining({ path: 'recordByOutcome.0.id', message: expect.stringContaining('unknown choice') }),
    ]);
  });

  it('still catches duplicate selectors, including two copies of a valid choice', () => {
    const { event, first, record } = fixture();
    expect(errors({
      ...event,
      recordByChoice: [{ ...record, id: first.id }, { ...record, id: first.id }],
    })).toEqual([expect.objectContaining({
      path: 'recordByChoice.1.id', message: expect.stringContaining('duplicate choice-specific Record id'),
    })]);
  });
});


/**
 * Validation used to be one function, so testing a rule meant running every
 * rule against the whole game and grepping the output for a phrase. These run
 * one rule against a bundle built to break it, which is the point of the
 * registry.
 */
describe('the content rules', () => {
  it('all have a distinct id and a sentence saying what they are for', () => {
    const ids = CONTENT_RULES.map((r) => r.id);
    expect(new Set(ids).size, `duplicate rule id in ${ids.join(', ')}`).toBe(ids.length);
    for (const rule of CONTENT_RULES) {
      expect(rule.about.length, rule.id).toBeGreaterThan(20);
      expect(rule.id, 'rule ids are slash-cased so they group').toMatch(/^[a-z]+\/[a-z-]+$/);
    }
  });

  it('stamp every issue with the rule that raised it', () => {
    for (const issue of validateBundle(content)) {
      expect(CONTENT_RULES.some((r) => r.id === issue.rule), issue.message).toBe(true);
    }
  });

  it('pass the shipped content with no errors', () => {
    const errors = validateBundle(content).filter((i) => i.level === 'error');
    expect(errors, errors.map((e) => `${e.rule} ${e.where}: ${e.message}`).join('\n')).toHaveLength(0);
  });

  it('runs one rule alone, and refuses a name it does not know', () => {
    expect(() => runRule('no/such-rule', content)).toThrow(/no validation rule/);
    expect(runRule('ids/unique', content)).toHaveLength(0);
  });

  // ── Rules that must actually fire ───────────────────────────────────────

  /**
   * A bundle with two events sharing an id. Built by mutating the real one,
   * because a rule that only passes against a toy bundle has not been tested
   * against anything the game would load.
   */
  const withEvents = (mutate: (b: ContentBundle) => void): ContentBundle => {
    const b = structuredClone(content.bundle);
    mutate(b);
    return b;
  };

  const signingQuestion = (): SigningQuestion => SigningQuestionS.parse({
    id: 'pricing_probe',
    situation: 'A question with a price on both sides.',
    answers: ['one', 'two', 'three'].map((id) => ({
      id,
      says: `Answer ${id}.`,
      given: 'Sixty crowns are given.',
      owed: 'A little is taken from the line.',
      terms: {
        given: [{ kind: 'treasury', amount: 60 }],
        owed: [{ kind: 'tithe', who: ['founder'], amount: 0.05 }],
      },
    })),
  });

  const withSigning = (mutate: (question: SigningQuestion, bundle: ContentBundle) => void): ContentBundle =>
    withEvents((b) => {
      const p = b.prologue[0]!;
      p.namePrompt = 'What are you called?';
      p.examination = [signingQuestion()];
      mutate(p.examination[0]!, b);
    });

  it('accepts a signing whose references, direction and price all agree', () => {
    const b = withSigning(() => {});
    expect(runRule('signing/refs', b)).toHaveLength(0);
    expect(runRule('signing/direction', b)).toHaveLength(0);
    expect(runRule('signing/priced', b)).toHaveLength(0);
  });

  it('catches a signing term naming an unknown founding seed key', () => {
    const b = withSigning((q) => {
      q.answers[0]!.terms.owed = [SigningTermS.parse({
        kind: 'tithe', who: ['seed_that_is_not'], amount: 0.05,
      })];
    });
    expect(runRule('signing/refs', b).some((i) =>
      i.level === 'error' && i.message.includes("seed_that_is_not"),
    )).toBe(true);
  });

  it('catches a signing bias on Eldritch Power', () => {
    const b = withSigning((q) => {
      q.answers[0]!.terms.given = [SigningTermS.parse({
        kind: 'bias', who: ['founder'], attr: 'eldritch_power', amount: 0.15,
      })];
    });
    expect(runRule('signing/refs', b).some((i) =>
      i.level === 'error' && i.message.includes("eldritch_power"),
    )).toBe(true);
  });

  it('catches a gain authored on the owed side of the signing', () => {
    const b = withSigning((q) => {
      q.answers[0]!.terms.owed = [SigningTermS.parse({ kind: 'treasury', amount: 60 })];
    });
    expect(runRule('signing/direction', b).some((i) =>
      i.level === 'error' && /owed.*loss/.test(i.message),
    )).toBe(true);
  });

  it('catches an answer whose static price is plainly one-sided', () => {
    const b = withSigning((q) => {
      q.answers[0]!.terms.given = [SigningTermS.parse({ kind: 'treasury', amount: 100 })];
      q.answers[0]!.terms.owed = [SigningTermS.parse({ kind: 'treasury', amount: -20 })];
    });
    expect(runRule('signing/priced', b).some((i) =>
      i.level === 'error' && /within one point/.test(i.message),
    )).toBe(true);
  });

  /**
   * THE GUARANTEE, NOT THE ROLE (issue #43).
   *
   * A rite deals Madness into whoever it names, so its ascendant must come
   * from a pool that can express. `foremost` promises that by construction;
   * the unmaking cannot use it, because §22 raises THE YOUNGER and the
   * youngest man in a house is never the one standing highest. So the rule
   * takes an explicit `canExpress` filter as the same promise — and still
   * fails a slot that makes no promise at all.
   */
  it('catches a rite whose ascendant could cast somebody who cannot express', () => {
    const b = withEvents((x) => {
      const e = x.events.find((q) => q.id === 'the_unmaking')!;
      e.slots.ASCENDANT!.filters = (e.slots.ASCENDANT!.filters ?? [])
        .filter((f) => !('canExpress' in f));
    });
    const issues = runRule('rites/wiring', b);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.level).toBe('error');
    expect(issues[0]!.message).toMatch(/no expression gate/);
  });

  it('accepts a rite whose ascendant is gated by filter rather than by role', () => {
    expect(runRule('rites/wiring', content.bundle)).toHaveLength(0);
  });

  /**
   * COUNTED SLOTS (issue #90). Five bundles the rule must reject and one it
   * must not — because `SlotSpec.count` spent its whole existence declared and
   * unread, and a rule guarding a field nobody has seen misused is exactly the
   * kind of thing that turns out not to work the first time it matters.
   *
   * The event mutated is a real one out of the shipped content, so what is
   * being rejected is something an author could actually have written.
   */
  const counted = (mutate: (e: ContentBundle['events'][number]) => void): ContentBundle =>
    withEvents((x) => {
      const e = x.events.find((q) => Object.keys(q.slots).length > 0)!;
      const sid = Object.keys(e.slots)[0]!;
      e.slots[sid]!.count = { min: 2, max: 4 };
      mutate(e);
    });

  it('catches a counted slot named as one person by an effect target', () => {
    const b = counted((e) => {
      const sid = Object.keys(e.slots)[0]!;
      const o = e.interaction.kind === 'narration'
        ? e.interaction.outcomes[0]! : e.interaction.choices[0]!.outcomes[0]!;
      o.effects.push({ kind: 'attribute', target: { slot: sid }, attr: 'strength', delta: 1 });
    });
    const issues = runRule('slots/counted', b);
    expect(issues.some((i) => i.level === 'error' && /names counted slot/.test(i.message))).toBe(true);
  });

  it('accepts the same effect once it names the whole party', () => {
    const b = counted((e) => {
      const sid = Object.keys(e.slots)[0]!;
      const o = e.interaction.kind === 'narration'
        ? e.interaction.outcomes[0]! : e.interaction.choices[0]!.outcomes[0]!;
      o.effects.push({ kind: 'attribute', target: { all: sid }, attr: 'strength', delta: 1 });
    });
    expect(runRule('slots/counted', b)).toHaveLength(0);
  });

  it('catches a counted slot scored by a `slot` pool instead of a party_sum', () => {
    const b = counted((e) => {
      const sid = Object.keys(e.slots)[0]!;
      e.checks = [{
        id: 'c', pool: { kind: 'slot', slot: sid, attrs: [{ attr: 'strength', weight: 1 }] },
        difficulty: 10, bands: [],
      } as never];
    });
    expect(runRule('slots/counted', b).some((i) => /slot pool/.test(i.message))).toBe(true);
  });

  it('catches a counted slot bound to an arc, where four of five would fall out', () => {
    const b = counted((e) => { e.slots[Object.keys(e.slots)[0]!]!.bind = 'arc'; });
    expect(runRule('slots/counted', b).some((i) => /cannot bind to an arc/.test(i.message))).toBe(true);
  });

  it('catches max below min, which is a slot that can never be cast', () => {
    const b = counted((e) => { e.slots[Object.keys(e.slots)[0]!]!.count = { min: 4, max: 2 }; });
    expect(runRule('slots/counted', b).some((i) => /below count.min/.test(i.message))).toBe(true);
  });

  it('catches a count of one, and a count of zero that means `optional`', () => {
    const one = counted((e) => { e.slots[Object.keys(e.slots)[0]!]!.count = { min: 1, max: 1 }; });
    expect(runRule('slots/counted', one).some((i) => /drop the count/.test(i.message))).toBe(true);

    const zero = counted((e) => { e.slots[Object.keys(e.slots)[0]!]!.count = { min: 0, max: 3 }; });
    expect(runRule('slots/counted', zero).some((i) => /a party of nobody/.test(i.message))).toBe(true);
  });

  it('catches a duplicated event id', () => {
    const b = withEvents((x) => { x.events.push(structuredClone(x.events[0]!)); });
    const issues = runRule('ids/unique', b);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.level).toBe('error');
  });

  /**
   * §29 rule 1: bearing must never read as a stat, and a choice label is the
   * nearest thing content has to one. The rule is deliberately blind to
   * PROSE — see its comment for the four good sentences a flat word match
   * fired on — so both halves are asserted here.
   */
  it('catches a choice label that names bearing', () => {
    const b = withEvents((x) => {
      const e = x.events.find((v) => v.interaction.kind === 'choice')!;
      if (e.interaction.kind !== 'choice') return;
      e.interaction.choices[0]!.label = 'Refuse them, out of pride.';
    });
    expect(runRule('prose/bearing', b).some((i) => i.level === 'error' && i.message.includes('pride')))
      .toBe(true);
  });

  it('leaves the prose alone, because other people are allowed to say it', () => {
    // §29 rule 4 names a rival's chronicle and a circulating tale as the
    // channel this is SUPPOSED to arrive through, and the shipped content
    // already does it: "the village decides the house is either very poor or
    // very proud, and settles, after some discussion, on proud."
    const b = withEvents((x) => {
      x.events[0]!.body += ' The village settles, after some discussion, on proud.';
    });
    expect(runRule('prose/bearing', b)).toHaveLength(0);
  });

  it('catches a body naming a slot that does not exist', () => {
    const b = withEvents((x) => { x.events[0]!.body += ' And then {NOBODY} spoke.'; });
    const issues = runRule('slots/references', b);
    expect(issues.some((i) => i.message.includes('{NOBODY}'))).toBe(true);
  });

  it('catches an arc pointing at a node that is not there', () => {
    const b = withEvents((x) => { x.arcs[0]!.entry = 'no_such_node'; });
    expect(runRule('arcs/wiring', b).some((i) => i.message.includes('no_such_node'))).toBe(true);
  });

  it('catches an effect naming content that does not exist', () => {
    const b = withEvents((x) => {
      const e = x.events.find((ev) => ev.interaction.kind === 'narration')!;
      if (e.interaction.kind !== 'narration') throw new Error('unreachable');
      e.interaction.outcomes[0]!.effects.push({ kind: 'clause', reveal: 'clause_that_is_not' });
    });
    expect(runRule('refs/known', b).some((i) => i.message.includes('clause_that_is_not'))).toBe(true);
  });

  it('catches a tale concern naming a house that does not exist', () => {
    const b = withEvents((x) => {
      x.tales[0]!.houses = ['house_that_is_not'];
    });
    expect(runRule('refs/known', b).some((i) =>
      i.level === 'error' && i.message.includes('house_that_is_not'),
    )).toBe(true);
  });

  /** Issue #14: the ballad content already names thirteen dangling tale ids before this file exists. */
  it('catches an event accounting for a tale that does not exist', () => {
    const b = withEvents((x) => { x.events[0]!.accounts = ['no_such_tale']; });
    expect(runRule('refs/known', b).some((i) => i.level === 'error' && i.message.includes('no_such_tale'))).toBe(true);
  });

  /**
   * A career or a book named by a typo fails silently in three different ways
   * downstream — the placement is declined, the volume resolves to nothing, the
   * slot matches nobody — and all three look like content that was authored and
   * simply never came up.
   */
  it('catches an outcome assigning a career that does not exist', () => {
    const b = withEvents((x) => {
      const e = x.events.find((ev) => ev.interaction.kind === 'narration')!;
      if (e.interaction.kind !== 'narration') throw new Error('unreachable');
      e.interaction.outcomes[0]!.effects.push({
        kind: 'career', target: { slot: 'NOBODY' }, op: 'assign', career: 'no_such_career',
      });
    });
    expect(runRule('refs/known', b).some((i) => i.message.includes('no_such_career'))).toBe(true);
  });

  /** Issue #128: the same silent failure — the fee is charged, the outcome fires, nobody is taught. */
  it('catches a tutor effect naming an attribute that does not exist', () => {
    const b = withEvents((x) => {
      const e = x.events.find((ev) => ev.interaction.kind === 'narration')!;
      if (e.interaction.kind !== 'narration') throw new Error('unreachable');
      e.interaction.outcomes[0]!.effects.push({
        kind: 'tutor', target: { slot: 'NOBODY' }, op: 'begin', attr: 'no_such_attribute',
      });
    });
    expect(runRule('refs/known', b).some((i) => i.message.includes('no_such_attribute'))).toBe(true);
  });

  it('catches a tutor effect naming an attribute no tutor can teach', () => {
    const b = withEvents((x) => {
      const e = x.events.find((ev) => ev.interaction.kind === 'narration')!;
      if (e.interaction.kind !== 'narration') throw new Error('unreachable');
      e.interaction.outcomes[0]!.effects.push({
        kind: 'tutor', target: { slot: 'NOBODY' }, op: 'begin', attr: 'madness',
      });
    });
    expect(runRule('refs/known', b).some((i) => i.message.includes('madness'))).toBe(true);
  });

  /**
   * THE GATE IS ON THE SLOT (careers/gate).
   *
   * The engine refuses to place a woman, so the failure this rule exists to
   * catch is silent by construction: the outcome fires, the Respect is paid,
   * the chronicle line is written, and the placement never happened. Three
   * bundles — a slot that promises nothing, a target that is not a slot at
   * all, and the shipped content, which must stay clean.
   */
  describe('careers/gate', () => {
    const placing = (mutate: (slot: { filters: unknown[] }) => void) => withEvents((x) => {
      const e = x.events.find((ev) => ev.interaction.kind === 'narration' && Object.keys(ev.slots).length > 0)!;
      if (e.interaction.kind !== 'narration') throw new Error('unreachable');
      const name = Object.keys(e.slots)[0]!;
      const slot = e.slots[name]!;
      slot.filters = slot.filters.filter((f) => !('sex' in f));
      mutate(slot as unknown as { filters: unknown[] });
      e.interaction.outcomes[0]!.effects.push({
        kind: 'career', target: { slot: name }, op: 'assign', career: 'clergy',
      });
      return name;
    });

    it('refuses a placement into a slot that can cast a woman', () => {
      const b = placing(() => {});
      const issues = runRule('careers/gate', b);
      expect(issues.some((i) => i.level === 'error' && i.message.includes('can cast a woman'))).toBe(true);
    });

    it('accepts the same placement once the slot is filtered to men', () => {
      const b = placing((slot) => { slot.filters.push({ sex: 'male' }); });
      expect(runRule('careers/gate', b)).toHaveLength(0);
    });

    it('accepts a slot gated by canExpress, which is male by invariant 1', () => {
      const b = placing((slot) => { slot.filters.push({ canExpress: true }); });
      expect(runRule('careers/gate', b)).toHaveLength(0);
    });

    it('refuses a placement onto the head, who may be a woman in a Regency', () => {
      const b = withEvents((x) => {
        const e = x.events.find((ev) => ev.interaction.kind === 'narration')!;
        if (e.interaction.kind !== 'narration') throw new Error('unreachable');
        e.interaction.outcomes[0]!.effects.push({ kind: 'career', target: 'head', op: 'assign', career: 'clergy' });
      });
      expect(runRule('careers/gate', b).some((i) => i.message.includes('not a slot'))).toBe(true);
    });

    it('passes the shipped content', () => {
      expect(runRule('careers/gate', content)).toHaveLength(0);
    });
  });

  it('catches an outcome studying a spellbook that does not exist', () => {
    const b = withEvents((x) => {
      const e = x.events.find((ev) => ev.interaction.kind === 'narration')!;
      if (e.interaction.kind !== 'narration') throw new Error('unreachable');
      e.interaction.outcomes[0]!.effects.push({
        kind: 'spellbook', op: 'study', target: { slot: 'NOBODY' }, book: 'no_such_book',
      });
    });
    expect(runRule('refs/known', b).some((i) => i.message.includes('no_such_book'))).toBe(true);
  });

  it('catches a slot filtering on a career that does not exist', () => {
    const b = withEvents((x) => {
      const e = x.events.find((ev) => Object.keys(ev.slots).length > 0)!;
      const slot = Object.keys(e.slots)[0]!;
      e.slots[slot]!.filters.push({ career: ['no_such_post'] });
    });
    expect(runRule('refs/known', b).some((i) => i.message.includes('no_such_post'))).toBe(true);
  });

  it('catches a tale whose about names an event that does not exist', () => {
    const b = withEvents((x) => { x.tales[0]!.about = 'no_such_event'; });
    expect(runRule('refs/known', b).some((i) => i.level === 'error' && i.message.includes('no_such_event'))).toBe(true);
  });

  // ── Who decides, and trees of events ─────────────────────────────────

  /** The first choice event in the shipped content, whatever it happens to be. */
  const aChoiceEvent = (b: ContentBundle) => b.events.find((e) => e.interaction.kind === 'choice')!;

  it('catches a state ladder taking a branch the event does not have', () => {
    const b = withEvents((x) => {
      const e = aChoiceEvent(x);
      if (e.interaction.kind === 'narration') throw new Error('unreachable');
      e.interaction.decidedBy = { state: [{ take: 'a_branch_that_is_not_here' }] };
    });
    expect(runRule('decider/wiring', b).some((i) => i.level === 'error' && i.message.includes('a_branch_that_is_not_here'))).toBe(true);
  });

  it('warns about a ladder with no unguarded rung, because it silently falls through to weight', () => {
    const b = withEvents((x) => {
      const e = aChoiceEvent(x);
      if (e.interaction.kind === 'narration') throw new Error('unreachable');
      e.interaction.decidedBy = {
        state: [{ when: { treasury: { op: 'lt', value: 1 } }, take: e.interaction.choices[0]!.id }],
      };
    });
    expect(runRule('decider/wiring', b).some((i) => i.level === 'warning' && i.message.includes('else'))).toBe(true);
  });

  it('catches a party decider with nobody for the player to send', () => {
    // The point of delegating is that the player picks who goes. Without a
    // player-cast slot it is a check wearing a decision's clothes.
    const b = withEvents((x) => {
      const e = aChoiceEvent(x);
      if (e.interaction.kind === 'narration') throw new Error('unreachable');
      e.interaction.decidedBy = { party: { check: 'never_declared' } };
    });
    const issues = runRule('decider/wiring', b);
    expect(issues.some((i) => i.message.includes('never_declared'))).toBe(true);
    expect(issues.some((i) => i.message.includes('castBy: player'))).toBe(true);
  });

  it('catches a checked outcome that no band can ever resolve', () => {
    const b = withEvents((x) => {
      const e = aChoiceEvent(x);
      if (e.interaction.kind === 'narration') throw new Error('unreachable');
      const branch = e.interaction.choices[0]!;
      const original = branch.outcomes[0]!;
      branch.outcomes.push({ ...structuredClone(original), id: 'outcome_no_band_names' });
      e.checks.push({
        id: 'outcome_coverage',
        pool: { kind: 'family_max', attr: 'strength' },
        difficulty: 10,
        variance: 'narrow',
        bands: [{ atLeast: 0, outcome: original.id }],
      });
      branch.check = 'outcome_coverage';
    });
    expect(runRule('checks/wiring', b).some((i) =>
      i.message.includes("outcome 'outcome_no_band_names' is unreachable"),
    )).toBe(true);
  });

  it('catches a party-decided branch that no check band can ever select', () => {
    const b = withEvents((x) => {
      const e = aChoiceEvent(x);
      if (e.interaction.kind === 'narration') throw new Error('unreachable');
      const first = e.interaction.choices[0]!;
      const omitted = e.interaction.choices[1]!;
      e.checks.push({
        id: 'branch_coverage',
        pool: { kind: 'family_max', attr: 'strength' },
        difficulty: 10,
        variance: 'narrow',
        bands: [{ atLeast: 0, outcome: first.id }],
      });
      e.interaction.decidedBy = { party: { check: 'branch_coverage' } };
      omitted.label = 'This branch is structurally present but no band names it';
    });
    expect(runRule('checks/wiring', b).some((i) =>
      i.message.includes('is unreachable through this party check'),
    )).toBe(true);
  });

  it('catches a check asked to name both a branch and an outcome', () => {
    const b = withEvents((x) => {
      const e = aChoiceEvent(x);
      if (e.interaction.kind === 'narration') throw new Error('unreachable');
      const branch = e.interaction.choices[0]!;
      e.checks = [{
        id: 'double_duty',
        pool: { kind: 'family_max', attr: 'strength' },
        difficulty: 10,
        variance: 'narrow',
        bands: [{ atLeast: 0, outcome: branch.outcomes[0]!.id }],
      }];
      branch.check = 'double_duty';
      e.interaction.decidedBy = { party: { check: 'double_duty' } };
    });
    expect(runRule('checks/wiring', b).some((i) => i.message.includes('cannot name choices and outcomes at once'))).toBe(true);
  });

  it('catches an event claiming to be a node of an arc that does not know it', () => {
    // The reverse of the check that already existed, and the worse direction:
    // an event with an `arc` block leaves the ambient pool, so if the arc never
    // calls it, it is authored, validated and unreachable in every run.
    const b = withEvents((x) => {
      x.events[0]!.arc = { of: x.arcs[0]!.id, node: 'a_node_that_is_not_there' };
    });
    expect(runRule('arcs/wiring', b).some((i) => i.message.includes('a_node_that_is_not_there'))).toBe(true);
  });

  it('catches an inline follow-up keeping a slot the follow-up does not declare', () => {
    // `keep` is the only thing that carries the cast forward. A slot the
    // follow-up never declares is a person the author thinks is still in the
    // room and who is silently recast.
    const b = withEvents((x) => {
      const e = x.events.find((ev) => ev.interaction.kind === 'narration' && Object.keys(ev.slots).length)!;
      if (e.interaction.kind !== 'narration') throw new Error('unreachable');
      const slot = Object.keys(e.slots)[0]!;
      const target = x.events.find((ev) => ev.id !== e.id && !ev.slots[slot])!;
      e.interaction.outcomes[0]!.next = { event: target.id, after: 'immediate', keep: [slot] };
    });
    expect(runRule('arcs/wiring', b).some((i) => i.message.includes('does not declare'))).toBe(true);
  });

  it('catches an inline follow-up naming an event that does not exist', () => {
    const b = withEvents((x) => {
      const e = x.events.find((ev) => ev.interaction.kind === 'narration')!;
      if (e.interaction.kind !== 'narration') throw new Error('unreachable');
      e.interaction.outcomes[0]!.next = { event: 'no_such_followup', after: 'immediate', keep: [] };
    });
    expect(runRule('arcs/wiring', b).some((i) => i.message.includes('no_such_followup'))).toBe(true);
  });

  it('catches two inline chains leading to the same follow-up', () => {
    // An event carries one `arc` block, so it can be a node of one chain. Two
    // means one chain quietly ends there and the other does not.
    const b = withEvents((x) => {
      const [a, c] = x.events.filter((ev) => ev.interaction.kind === 'narration').slice(0, 2);
      const target = x.events.find((ev) => ev.id !== a!.id && ev.id !== c!.id)!;
      for (const e of [a!, c!]) {
        if (e.interaction.kind !== 'narration') throw new Error('unreachable');
        e.interaction.outcomes[0]!.next = { event: target.id, after: 'immediate', keep: [] };
      }
    });
    expect(runRule('arcs/inline', b).some((i) => i.message.includes('only be a node of one chain'))).toBe(true);
  });

  it('catches an arc_flag written by an event that is in no substory', () => {
    const b = withEvents((x) => {
      const e = x.events.find((ev) => ev.interaction.kind === 'narration' && !ev.arc)!;
      if (e.interaction.kind !== 'narration') throw new Error('unreachable');
      e.interaction.outcomes[0]!.effects.push({ kind: 'arc_flag', flag: 'nobody_will_read_this', set: true });
    });
    expect(runRule('arcs/flags', b).some((i) => i.level === 'error' && i.message.includes('nothing can read it'))).toBe(true);
  });

  it('catches a successor guarding on an outcome its parent cannot produce', () => {
    const b = withEvents((x) => {
      const node = x.arcs[0]!.nodes.find((n) => n.successors.length)!;
      node.successors[0]!.fromOutcome = 'an_ending_that_never_happens';
    });
    expect(runRule('arcs/wiring', b).some((i) => i.message.includes('an_ending_that_never_happens'))).toBe(true);
  });

  /** CI gate 8 (issue #14): two accounts that agree are one account written twice. */
  it('catches two accounts on one event sharing the same bias', () => {
    const b = withEvents((x) => {
      const t = x.tales[0]!;
      x.tales.push({ ...t, id: 'a_second_tale_with_the_same_bias' });
      x.events[0]!.accounts = [t.id, 'a_second_tale_with_the_same_bias'];
    });
    const issues = runRule('tales/accounts', b);
    expect(issues.some((i) => i.level === 'error' && i.where === `event:${b.events[0]!.id}`)).toBe(true);
  });

  it('does not complain when an event\'s two accounts already contradict', () => {
    const b = withEvents((x) => {
      const t = x.tales[0]!;
      x.tales.push({ ...t, id: 'a_second_tale_with_a_different_bias', bias: `not_${t.bias}` });
      x.events[0]!.accounts = [t.id, 'a_second_tale_with_a_different_bias'];
    });
    const issues = runRule('tales/accounts', b).filter((i) => i.where === `event:${b.events[0]!.id}`);
    expect(issues).toHaveLength(0);
  });

  it('passes the shipped content with no account-gate errors', () => {
    expect(runRule('tales/accounts', content).filter((i) => i.level === 'error')).toHaveLength(0);
  });

  /**
   * Invariant 1, checked at authoring time. An effect that would deal Madness
   * to a target nothing has gated is an error, not a silent no-op at runtime.
   */
  it('catches Madness dealt to an ungated target', () => {
    const b = withEvents((x) => {
      const e = x.events.find((ev) => ev.interaction.kind === 'narration')!;
      if (e.interaction.kind !== 'narration') throw new Error('unreachable');
      e.slots.ANYONE = {
        role: 'family_member', castBy: 'engine', optional: false,
        filters: [], bind: 'event',
      };
      e.interaction.outcomes[0]!.effects.push({ kind: 'madness', target: { slot: 'ANYONE' }, delta: 10 });
    });
    const issues = runRule('madness/gate', b);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.level).toBe('error');
  });

  it('catches forced Awakening aimed at a slot that can already be awake', () => {
    const b = withEvents((x) => {
      const e = x.events.find((ev) => ev.interaction.kind === 'narration')!;
      if (e.interaction.kind !== 'narration') throw new Error('unreachable');
      e.slots.ANYONE = {
        role: 'family_member', castBy: 'engine', optional: false,
        filters: [], bind: 'event',
      };
      e.interaction.outcomes[0]!.effects.push({ kind: 'awakening', target: { slot: 'ANYONE' } });
    });
    const issues = runRule('awakening/gate', b);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.level).toBe('error');
    expect(issues[0]!.message).toMatch(/role 'unwoken'/);
  });

  it('accepts forced Awakening on an explicit unwoken slot', () => {
    const b = withEvents((x) => {
      const e = x.events.find((ev) => ev.interaction.kind === 'narration')!;
      if (e.interaction.kind !== 'narration') throw new Error('unreachable');
      e.slots.CHILD = {
        role: 'unwoken', castBy: 'engine', optional: false,
        filters: [{ canExpress: true }], bind: 'event',
      };
      e.interaction.outcomes[0]!.effects.push({ kind: 'awakening', target: { slot: 'CHILD' } });
    });
    expect(runRule('awakening/gate', b)).toHaveLength(0);
  });

  it('rejects an unwoken slot that does not prove the target carries a font', () => {
    const b = withEvents((x) => {
      const e = x.events.find((ev) => ev.interaction.kind === 'narration')!;
      if (e.interaction.kind !== 'narration') throw new Error('unreachable');
      e.slots.CHILD = {
        role: 'unwoken', castBy: 'engine', optional: false,
        filters: [], bind: 'event',
      };
      e.interaction.outcomes[0]!.effects.push({ kind: 'awakening', target: { slot: 'CHILD' } });
    });
    const issues = runRule('awakening/gate', b);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toMatch(/does not prove a carried font/);
  });

  it('rejects broad forced-Awakening targets that have no authored unwoken cast', () => {
    const b = withEvents((x) => {
      const e = x.events.find((ev) => ev.interaction.kind === 'narration')!;
      if (e.interaction.kind !== 'narration') throw new Error('unreachable');
      e.interaction.outcomes[0]!.effects.push({ kind: 'awakening', target: 'household' });
    });
    const issues = runRule('awakening/gate', b);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toMatch(/explicit slot/);
  });

  it('catches outcome weights that can never resolve', () => {
    const b = withEvents((x) => {
      const e = x.events.find((ev) => ev.interaction.kind === 'narration')!;
      if (e.interaction.kind !== 'narration') throw new Error('unreachable');
      for (const o of e.interaction.outcomes) o.weight = 0;
    });
    expect(runRule('outcomes/weights', b).some((i) => i.level === 'error')).toBe(true);
  });

  /** CI gate 6: a cluster of three or more identical purpose-triples is an error, not advice. */
  it('catches a triple carrying far more than its share of the library', () => {
    // The allowance is proportional now, not a flat three. A fixed cap of
    // three walled the library at 168 templates — the nine-purpose vocabulary
    // forms 84 triples — against §25's own budget of 300-500, and what that
    // produces is not fewer duplicate scenes but authors picking whichever
    // triple the validator will still accept, which inverts the rule.
    const b = withEvents((x) => {
      const shared = ['change_relationship', 'change_standing', 'worldbuild_through_action'] as const;
      for (const e of x.events) e.purposes = [...shared];
    });
    const issues = runRule('event/purpose-overlap', b);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.level).toBe('error');
    expect(issues[0]!.message).toContain('against an allowance of');
  });

  it('leaves a triple used a handful of times alone', () => {
    // Three templates about the same three things is a subject revisited. The
    // failure §25 names is "the event whose only job is *the family is
    // formidable*", and that is a triple carrying many times its share.
    const b = withEvents((x) => {
      const shared = ['change_relationship', 'change_standing', 'worldbuild_through_action'] as const;
      for (let i = 0; i < 3; i++) x.events[i]!.purposes = [...shared];
    });
    expect(runRule('event/purpose-overlap', b)).toHaveLength(0);
  });

  // ── The attention floor ─────────────────────────────────────────────────

  /**
   * The rule that guards what the player is actually asked. Handed a bundle
   * where every template resolves itself, it must object; handed the shipped
   * one, it must not — and the second half matters as much, because a floor
   * set where the content already sits is a floor that fails the next author
   * for no reason.
   */
  it('catches a library that has stopped asking the player anything', () => {
    const b = withEvents((x) => {
      for (const e of x.events) {
        delete e.record;
        for (const spec of Object.values(e.slots)) spec.castBy = 'engine';
        if (e.interaction.kind !== 'narration') e.interaction.decidedBy = 'chance';
      }
    });
    const issues = runRule('events/player-share', b);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.level).toBe('error');
    expect(issues[0]!.message).toContain('against a floor of 25%');
  });

  it('counts each of the four shapes that ask, on its own', () => {
    // Start from a library that has gone entirely silent, then give back one
    // shape at a time. Each has to clear the floor by itself, which is what
    // says the rule counts four things rather than one thing four ways.
    const silent = () => withEvents((x) => {
      for (const e of x.events) {
        delete e.record;
        for (const spec of Object.values(e.slots)) spec.castBy = 'engine';
        if (e.interaction.kind !== 'narration') e.interaction.decidedBy = 'chance';
      }
    });
    expect(runRule('events/player-share', silent())).toHaveLength(1);

    const docket = silent();
    for (const e of docket.events) {
      if (e.interaction.kind !== 'narration') e.interaction.decidedBy = 'player';
    }
    expect(runRule('events/player-share', docket), 'a docketed choice asks').toHaveLength(0);

    const party = silent();
    for (const e of party.events) {
      if (e.interaction.kind !== 'narration') e.interaction.decidedBy = { party: { check: 'x' } };
    }
    expect(runRule('events/player-share', party), 'a party cast asks — WHO GOES is the decision')
      .toHaveLength(0);

    const cast = silent();
    for (const e of cast.events) {
      const first = Object.values(e.slots)[0];
      if (first) first.castBy = 'player';
    }
    expect(runRule('events/player-share', cast), 'a player-cast slot asks').toHaveLength(0);

    // And the Record block on its own carries a third of the shipped library
    // without any other shape in the game — which is the thesis stated as a
    // number rather than as a claim (concept §6).
    const records = withEvents((x) => {
      for (const e of x.events) {
        for (const spec of Object.values(e.slots)) spec.castBy = 'engine';
        if (e.interaction.kind !== 'narration') e.interaction.decidedBy = 'chance';
      }
    });
    expect(runRule('events/player-share', records), 'Record / Omit / Embellish asks')
      .toHaveLength(0);
  });

  it('leaves the shipped library alone, and by a wide margin', () => {
    expect(runRule('events/player-share', content)).toHaveLength(0);
  });

  /** CI gate 7 (issue #4): a clause pinned to fewer than two Ages is one some runs never see. */
  it('catches a clause assigned to fewer than two Ages', () => {
    const b = withEvents((x) => { x.clauses[0]!.ages = [x.clauses[0]!.ages[0]!]; });
    const issues = runRule('clause/ages', b);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.level).toBe('error');
  });

  /**
   * THE TWO ENDS OF THE RUN (issues #38, #39). Both are authored, both are
   * read exactly once in a playthrough, and a mistake in either is found by a
   * player at the only two moments in the game that cannot be replayed.
   */
  it('catches a prologue that offers a gift or a grudge that does not exist', () => {
    const missingObject = withEvents((x) => { x.prologue[0]!.heirlooms[0]!.heirloom = asId('no_such_thing'); });
    expect(runRule('prologue/shape', missingObject).some((i) => i.level === 'error')).toBe(true);

    const missingHouse = withEvents((x) => { x.prologue[0]!.grudges[0]!.house = asId('no_such_house'); });
    expect(runRule('prologue/shape', missingHouse).some((i) => i.level === 'error')).toBe(true);

    // The house cannot hold the first grudge against itself.
    const ourselves = withEvents((x) => {
      const home = x.houses.find((h) => h.isPlayerHouse)!;
      x.prologue[0]!.grudges[0]!.house = asId(String(home.id));
    });
    expect(runRule('prologue/shape', ourselves).some((i) => i.level === 'error')).toBe(true);
  });

  it('catches a run with no prologue, or with two', () => {
    const none = withEvents((x) => { x.prologue = []; });
    expect(runRule('prologue/shape', none)).toHaveLength(1);

    const twice = withEvents((x) => { x.prologue = [x.prologue[0]!, x.prologue[0]!]; });
    expect(runRule('prologue/shape', twice)).toHaveLength(1);
  });

  it('catches a missing ending, and one authored twice', () => {
    const missing = withEvents((x) => { x.endings = x.endings.filter((e) => e.id !== 'devoured'); });
    const issues = runRule('ending/complete', missing);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.where).toBe('ending:devoured');

    const doubled = withEvents((x) => { x.endings.push(structuredClone(x.endings[0]!)); });
    expect(runRule('ending/complete', doubled)).toHaveLength(1);
  });

  /**
   * §23's ring: same cadence, same three parts, ONE substitution. Two is a
   * rewrite and none is not a ring, and neither would look wrong on the page
   * — which is why it is a rule rather than a review note.
   */
  it('catches an ending that changes two elements of the prologue, or none', () => {
    const both = withEvents((x) => {
      x.endings[0]!.ring.given = 'a second substitution';
      x.endings[0]!.ring.owed = 'and a first';
    });
    expect(runRule('ending/ring', both).some((i) => i.level === 'error')).toBe(true);

    const neither = withEvents((x) => {
      delete x.endings[0]!.ring.given;
      delete x.endings[0]!.ring.owed;
    });
    expect(runRule('ending/ring', neither).some((i) => i.level === 'error')).toBe(true);
  });

  it('catches an ending ringing a beat the prologue does not have', () => {
    const past = withEvents((x) => { x.endings[0]!.ring.beat = 3; x.prologue[0]!.triad.pop(); });
    expect(runRule('ending/ring', past).some((i) => i.message.includes('beat 3'))).toBe(true);
  });

  /** Issue #9: this is exactly the bug `the_thin_papers` shipped with. */
  it('catches a Discrepancy proved or buried without ever being created', () => {
    const b = withEvents((x) => {
      const e = x.events.find((ev) => ev.interaction.kind === 'narration')!;
      if (e.interaction.kind !== 'narration') throw new Error('unreachable');
      e.interaction.outcomes[0]!.effects.push({ kind: 'discrepancy', op: 'prove', id: 'never_created_xyz' });
    });
    const issues = runRule('discrepancy/wiring', b);
    expect(issues.some((i) => i.level === 'error' && i.message.includes('never_created_xyz'))).toBe(true);
  });

  it('catches provableBy naming a house that does not exist', () => {
    const b = withEvents((x) => {
      const e = x.events.find((ev) => ev.interaction.kind === 'narration')!;
      if (e.interaction.kind !== 'narration') throw new Error('unreachable');
      e.interaction.outcomes[0]!.effects.push({
        kind: 'discrepancy', op: 'create', id: 'a_fresh_lie', severity: 'minor', provableBy: ['house_that_is_not_real'],
      });
    });
    const issues = runRule('discrepancy/wiring', b);
    expect(issues.some((i) => i.level === 'error' && i.message.includes('house_that_is_not_real'))).toBe(true);
  });

  /**
   * `id` went optional so that a BURY can go without one and reach whatever
   * open lie the house is actually carrying (issue #71). A `create` without
   * one names nothing, so nothing can ever prove or bury it — a lie the world
   * cannot be told about, which is invariant 11 in content.
   */
  it('catches a create that names no Discrepancy at all', () => {
    const b = withEvents((x) => {
      const e = x.events.find((ev) => ev.interaction.kind === 'narration')!;
      if (e.interaction.kind !== 'narration') throw new Error('unreachable');
      e.interaction.outcomes[0]!.effects.push({ kind: 'discrepancy', op: 'create', severity: 'minor' });
    });
    const issues = runRule('discrepancy/wiring', b);
    expect(issues.some((i) => i.level === 'error' && i.message.includes('no id'))).toBe(true);
  });

  /** And a bury without one is the point of the change, so it must pass. */
  it('allows a bury that names nothing, and still checks who it says can prove it', () => {
    const clean = withEvents((x) => {
      const e = x.events.find((ev) => ev.interaction.kind === 'narration')!;
      if (e.interaction.kind !== 'narration') throw new Error('unreachable');
      e.interaction.outcomes[0]!.effects.push({ kind: 'discrepancy', op: 'bury', provableBy: ['the_church'] });
    });
    expect(runRule('discrepancy/wiring', clean).filter((i) => i.level === 'error')).toHaveLength(0);

    const bad = withEvents((x) => {
      const e = x.events.find((ev) => ev.interaction.kind === 'narration')!;
      if (e.interaction.kind !== 'narration') throw new Error('unreachable');
      e.interaction.outcomes[0]!.effects.push({ kind: 'discrepancy', op: 'bury', provableBy: ['house_of_nowhere'] });
    });
    expect(runRule('discrepancy/wiring', bad).some((i) => i.message.includes('house_of_nowhere'))).toBe(true);
  });

  it('passes the shipped content with no wiring errors', () => {
    expect(runRule('discrepancy/wiring', content).filter((i) => i.level === 'error')).toHaveLength(0);
  });

  /**
   * A secret on a contract becomes a Discrepancy under its own id the year it
   * is told, so an id with a second owner has two origins and one state.
   */
  it('catches a secret that content also creates as a Discrepancy', () => {
    const b = withEvents((x) => {
      const e = x.events.find((ev) => ev.interaction.kind === 'narration')!;
      if (e.interaction.kind !== 'narration') throw new Error('unreachable');
      e.interaction.outcomes[0]!.effects.push({
        kind: 'discrepancy', op: 'create', id: 'what_the_archive_holds', severity: 'minor', provableBy: ['commons'],
      });
    });
    const issues = runRule('secrets/wiring', b);
    expect(issues.some((i) => i.level === 'error' && i.message.includes('what_the_archive_holds'))).toBe(true);
  });

  it('catches a secret that is also granted as knowledge', () => {
    const b = withEvents((x) => {
      const e = x.events.find((ev) => ev.interaction.kind === 'narration')!;
      if (e.interaction.kind !== 'narration') throw new Error('unreachable');
      e.interaction.outcomes[0]!.effects.push({
        kind: 'knowledge', op: 'grant', flag: 'what_the_archive_holds',
      });
    });
    const issues = runRule('secrets/wiring', b);
    expect(issues.some((i) => i.level === 'error' && i.message.includes('granted as knowledge'))).toBe(true);
  });

  it('passes the shipped contracts, which name secrets nothing else owns', () => {
    expect(runRule('secrets/wiring', content).filter((i) => i.level === 'error')).toHaveLength(0);
  });
});

/**
 * THE RULES THAT HAD NEVER CAUGHT ANYTHING.
 *
 * Twenty-two rules raise issues from seventy-two call sites, and thirty-five of
 * those had never executed. The rule ran, found the shipped content clean, and
 * returned — which is what a rule that cannot fire looks like from outside, and
 * indistinguishable from one that works.
 *
 * That matters more here than in most codebases. `npm run validate` is the
 * whole of what stands between an author and a broken build, and a validator
 * nothing has ever been rejected by is a validator nobody has any reason to
 * trust. `frame/shape` was the sharpest case: AGENTS.md says a frame event
 * "carries no effects, Record block or rumour by construction (`frame/shape`
 * fails the build otherwise)", and nothing had ever demonstrated that it does.
 *
 * Every fixture below mutates the REAL bundle, for the reason the file already
 * gives: a rule that only fires against a toy bundle has not been tested
 * against anything the game would load.
 */
describe('the rules that had never caught anything', () => {
  const withEvents = (mutate: (b: ContentBundle) => void): ContentBundle => {
    const b = structuredClone(content.bundle);
    mutate(b);
    return b;
  };

  const anEvent = (b: ContentBundle, freq?: string) =>
    b.events.find((e) => e.tier !== 'frame' && (freq === undefined || e.frequency === freq))!;

  /** The first choice event in the shipped content, whatever it happens to be. */
  const aChoiceEvent = (b: ContentBundle) => b.events.find((e) => e.interaction.kind === 'choice')!;

  const messages = (rule: string, b: ContentBundle) => runRule(rule, b).map((i) => i.message).join('\n');

  // ── frequency/obligations: a tier is a set of duties ───────────────────

  describe('frequency/obligations', () => {
    it('catches a rare event with no Record block, because the tier requires one', () => {
      const b = withEvents((x) => {
        const e = anEvent(x, 'rare');
        e.record = undefined;
      });
      expect(messages('frequency/obligations', b)).toMatch(/must carry a record block/);
    });

    it('catches a common event that carries one, because a routine Record choice means nothing', () => {
      const b = withEvents((x) => {
        const donor = x.events.find((e) => e.record)!;
        const e = anEvent(x, 'common');
        e.record = structuredClone(donor.record);
      });
      expect(messages('frequency/obligations', b)).toMatch(/must not carry a record block/);
    });

    it('warns when a rare event seeds no rumour, and when a common one does', () => {
      const noRumour = withEvents((x) => { anEvent(x, 'rare').rumour = undefined; });
      expect(messages('frequency/obligations', noRumour)).toMatch(/should seed a rumour/);

      const tooTalkative = withEvents((x) => {
        anEvent(x, 'common').rumour = { id: 'rumour_of_nothing', accuracy: 0.5, spread: 1 };
      });
      expect(messages('frequency/obligations', tooTalkative)).toMatch(/do not enter folklore/);
    });

    it('catches a mythic event that can repeat, which is a contradiction in terms', () => {
      const b = withEvents((x) => { anEvent(x, 'mythic').repeatable = true; });
      const issues = runRule('frequency/obligations', b);
      expect(issues.some((i) => i.level === 'error' && /not mythic/.test(i.message))).toBe(true);
    });

    it('warns when a named tier carries fewer than two contradicting accounts', () => {
      const b = withEvents((x) => { anEvent(x, 'rare').accounts = []; });
      expect(messages('frequency/obligations', b)).toMatch(/fewer than two contradicting accounts/);
    });
  });

  // ── record/claims: both written answers have to name what they assert ────

  describe('record/claims', () => {
    const paired = (b: ContentBundle) => b.events.find((e) =>
      e.record && e.record.options.record.claims.length > 0 && e.record.options.embellish.claims.length > 0)!;

    it('catches either direction of claim asymmetry', () => {
      const missingRecord = withEvents((x) => { paired(x).record!.options.record.claims = []; });
      expect(messages('record/claims', missingRecord)).toMatch(/asymmetric.*Record 0, Embellish [1-9]/);

      const missingEmbellish = withEvents((x) => { paired(x).record!.options.embellish.claims = []; });
      expect(messages('record/claims', missingEmbellish)).toMatch(/asymmetric.*Record [1-9], Embellish 0/);
    });

    it('leaves the shipped Record/Embellish pairs alone', () => {
      expect(runRule('record/claims', content)).toHaveLength(0);
    });
  });

  // ── slots/arc-bound ────────────────────────────────────────────────────

  describe('slots/arc-bound', () => {
    it('warns about an arc-bound slot on an event that belongs to no arc', () => {
      const b = withEvents((x) => {
        const e = x.events.find((ev) => !ev.arc && Object.keys(ev.slots).length)!;
        Object.values(e.slots)[0]!.bind = 'arc';
      });
      expect(messages('slots/arc-bound', b)).toMatch(/belongs to no arc/);
    });

    /** A token for a man forty years in the ground, which is the message's own phrase. */
    it('catches continue_absent with no absentBody to render instead', () => {
      const b = withEvents((x) => {
        const e = x.events.find((ev) => ev.arc && Object.keys(ev.slots).length)
          ?? x.events.find((ev) => Object.keys(ev.slots).length)!;
        const spec = Object.values(e.slots)[0]!;
        spec.bind = 'arc';
        spec.onMissing = 'continue_absent';
        e.absentBody = undefined;
      });
      const issues = runRule('slots/arc-bound', b);
      expect(issues.some((i) => i.level === 'error' && /continue_absent requires absentBody/.test(i.message))).toBe(true);
    });
  });

  // ── event/shape ────────────────────────────────────────────────────────

  describe('event/shape', () => {
    it('catches a choice event with only one option, which is narration wearing a hat', () => {
      const b = withEvents((x) => {
        const e = aChoiceEvent(x);
        if (e.interaction.kind === 'narration') throw new Error('unreachable');
        e.interaction.choices = [e.interaction.choices[0]!];
      });
      const issues = runRule('event/shape', b);
      expect(issues.some((i) => i.level === 'error' && /at least two options/.test(i.message))).toBe(true);
    });

    it('warns about a body short enough to be a stub', () => {
      const b = withEvents((x) => { x.events[0]!.body = 'Something happened.'; });
      expect(messages('event/shape', b)).toMatch(/body under 25 words/);
    });
  });

  // ── frame/shape: the rule AGENTS.md promises and nothing had proved ────

  describe('frame/shape', () => {
    const aFrameEvent = (b: ContentBundle) => b.events.find((e) => e.tier === 'frame')!;

    it('the shipped content has frame events to hold to this', () => {
      expect(content.bundle.events.some((e) => e.tier === 'frame')).toBe(true);
    });

    it("catches 'reads' on an event that is not the frame", () => {
      const b = withEvents((x) => { anEvent(x).reads = aFrameEvent(x).reads; });
      const issues = runRule('frame/shape', b);
      expect(issues.some((i) => i.level === 'error' && /frame-only/.test(i.message))).toBe(true);
    });

    it('catches a frame event with nothing to react to', () => {
      const b = withEvents((x) => { aFrameEvent(x).reads = []; });
      expect(messages('frame/shape', b)).toMatch(/declares no reads/);
    });

    it('catches a frame event gating on live household state', () => {
      const b = withEvents((x) => { aFrameEvent(x).conditions = { year: { op: 'gte', value: 1200 } }; });
      expect(messages('frame/shape', b)).toMatch(/gates on reads, not conditions/);
    });

    it('catches a frame event carrying a Record block or a rumour', () => {
      const withRecord = withEvents((x) => {
        aFrameEvent(x).record = structuredClone(x.events.find((e) => e.record)!.record);
      });
      expect(messages('frame/shape', withRecord)).toMatch(/never dispenses systems information/);

      const withRumour = withEvents((x) => {
        aFrameEvent(x).rumour = { id: 'rumour_of_nothing', accuracy: 0.5, spread: 1 };
      });
      expect(messages('frame/shape', withRumour)).toMatch(/does not enter folklore/);
    });

    it('catches a frame event that asks the player anything', () => {
      const b = withEvents((x) => {
        const donor = aChoiceEvent(x);
        if (donor.interaction.kind === 'narration') throw new Error('unreachable');
        aFrameEvent(x).interaction = structuredClone(donor.interaction);
      });
      expect(messages('frame/shape', b)).toMatch(/narration only/);
    });

    it('catches a frame event casting anyone but the two listeners', () => {
      const b = withEvents((x) => {
        const e = aFrameEvent(x);
        const spec = Object.values(e.slots)[0];
        if (!spec) throw new Error('the frame event under test casts nobody');
        spec.role = 'head';
      });
      expect(messages('frame/shape', b)).toMatch(/casts only the two listener roles/);
    });

    /**
     * A `chronicled` read waits on a page one named event leaves behind, so a
     * name that matches no event is an interlude that is never once eligible,
     * in any run, with nothing anywhere reporting it.
     */
    it('catches a chronicled read naming an event that does not exist', () => {
      const b = withEvents((x) => { aFrameEvent(x).reads = [{ chronicled: 'no_such_event' }]; });
      expect(messages('frame/shape', b)).toMatch(/names no event/);
    });

    it('catches a chronicled read pointed at the frame, which writes no chronicle', () => {
      const b = withEvents((x) => {
        aFrameEvent(x).reads = [{ chronicled: aFrameEvent(x).id }];
      });
      expect(messages('frame/shape', b)).toMatch(/writes no chronicle/);
    });

    /** The frame reacts. An effect on it would make the interlude change the game. */
    it('catches an effect on a frame outcome', () => {
      const b = withEvents((x) => {
        const e = aFrameEvent(x);
        if (e.interaction.kind !== 'narration') throw new Error('a frame event is narration');
        e.interaction.outcomes[0]!.effects.push({ kind: 'treasury', delta: 50 });
      });
      expect(messages('frame/shape', b)).toMatch(/it does not change anything/);
    });
  });

  // ── traits/mystic-restriction (invariant 4) ────────────────────────────

  describe('traits/mystic-restriction', () => {
    it('catches a female-tagged trait keyed to an affinity women cannot learn', () => {
      const b = withEvents((x) => {
        const t = x.traits.find((tr) => tr.acquisition.kind === 'threshold')!;
        t.acquisition = { kind: 'threshold', attr: asId('fluid'), atLeast: 40 };
        t.tags = [...t.tags, 'female'] as typeof t.tags;
      });
      expect(messages('traits/mystic-restriction', b)).toMatch(/female-tagged trait keyed to an elemental affinity/);
    });

    it('says nothing about the same trait keyed to a Threshold affinity, which women do practise', () => {
      const b = withEvents((x) => {
        const t = x.traits.find((tr) => tr.acquisition.kind === 'threshold')!;
        t.acquisition = { kind: 'threshold', attr: asId('life'), atLeast: 40 };
        t.tags = [...t.tags, 'female'] as typeof t.tags;
      });
      expect(runRule('traits/mystic-restriction', b)).toHaveLength(0);
    });
  });

  // ── houses/alleles ─────────────────────────────────────────────────────

  describe('houses/alleles', () => {
    /**
     * The failure it exists for: a gene pool override naming an allele that is
     * not in the locus is DROPPED. The house then rolls the world baseline,
     * which is a perfectly good genome, so nothing anywhere reports that the
     * house's whole characterisation — "soldiers", "they can count" — never
     * reached a single person. Two houses shipped that way in one afternoon.
     */
    it('catches a gene pool naming an allele the locus does not have', () => {
      const b = withEvents((x) => {
        const h = x.houses.find((house) => Object.keys(house.genePool.frequencies).length)!;
        const locus = Object.keys(h.genePool.frequencies)[0]!;
        h.genePool.frequencies[locus] = [{ allele: 'no_such_allele', p: 0.3 }];
      });
      expect(messages('houses/alleles', b)).toMatch(/unknown allele 'no_such_allele'/);
    });

    it('catches a gene pool overriding a locus that does not exist', () => {
      const b = withEvents((x) => {
        const h = x.houses.find((house) => Object.keys(house.genePool.frequencies).length)!;
        h.genePool.frequencies['no_such_locus'] = [{ allele: 'whatever', p: 0.3 }];
      });
      expect(messages('houses/alleles', b)).toMatch(/unknown locus 'no_such_locus'/);
    });

    it('says nothing about the shipped houses', () => {
      expect(runRule('houses/alleles', content)).toHaveLength(0);
    });
  });

  // ── parcels/wiring ───────────────────────────────────────────────────────

  /**
   * The dispatch site issue #93 asks for: `ParcelKind` is closed, and this is
   * where every value of it is actually handled. `mill`/`woodland`/`common`/
   * `demesne` are singular the way the world doc names them — "the mill," not
   * "a mill" — so a second one is the bug this rule exists to catch.
   * `tenant_farm` is not: §5 and §12 describe eleven of them.
   */
  describe('parcels/wiring', () => {
    it('catches a second parcel of a kind the house has exactly one of', () => {
      const b = withEvents((x) => {
        const mill = x.parcels.find((p) => p.kind === 'mill')!;
        x.parcels.push({ ...mill, id: asId('a_second_mill'), name: 'A Second Mill' });
      });
      expect(messages('parcels/wiring', b)).toMatch(/a second 'mill' parcel/);
    });

    it('does not flag a second tenant_farm — the house has eleven, by design', () => {
      const b = withEvents((x) => {
        const farm = x.parcels.find((p) => p.kind === 'tenant_farm')!;
        x.parcels.push({ ...farm, id: asId('a_second_farm'), name: 'A Second Farm' });
      });
      expect(runRule('parcels/wiring', b)).toHaveLength(0);
    });

    it('says nothing about the shipped parcels', () => {
      expect(runRule('parcels/wiring', content)).toHaveLength(0);
    });
  });

  // ── war/wiring ───────────────────────────────────────────────────────────

  /**
   * `PositionDefS` leaves all four of these unenforced at the schema level —
   * `slots/counted`'s reasoning applies here too: a schema failure aborts the
   * whole parse and never names the position. One rejecting bundle per
   * clause, per issue #97's own acceptance line.
   */
  describe('war/wiring', () => {
    const narrationEvent = (b: ContentBundle) => {
      const e = b.events.find((ev) => ev.interaction.kind === 'narration' && ev.tier !== 'frame')!;
      if (e.interaction.kind !== 'narration') throw new Error('unreachable');
      return e.interaction.outcomes[0]!;
    };

    it('catches a position naming a Respect tier that does not exist', () => {
      const b = withEvents((x) => {
        x.positions.push({ id: asId('a_test_position'), name: 'Test', perYear: 0, minRespect: 'legendary' });
      });
      expect(messages('war/wiring', b)).toMatch(/minRespect 'legendary' is not a real Respect tier/);
    });

    it('catches a position discounting a career that does not exist', () => {
      const b = withEvents((x) => {
        x.positions.push({ id: asId('a_test_position'), name: 'Test', perYear: 0, discountWithCareer: 'no_such_career' });
      });
      expect(messages('war/wiring', b)).toMatch(/discountWithCareer names unknown career 'no_such_career'/);
    });

    it('catches a priced position with no multiplier — an error, not a default', () => {
      const b = withEvents((x) => {
        x.positions.push({ id: asId('a_test_position'), name: 'Test', perYear: 0, price: 50 });
      });
      expect(messages('war/wiring', b)).toMatch(/has a price and no multiplier/);
    });

    it('catches an outcome setting a position that does not exist', () => {
      const b = withEvents((x) => {
        narrationEvent(x).effects.push({ kind: 'muster', op: 'set_position', position: 'position_that_is_not' });
      });
      expect(messages('war/wiring', b)).toMatch(/sets unknown position 'position_that_is_not'/);
    });

    it('says nothing about the shipped positions', () => {
      expect(runRule('war/wiring', content)).toHaveLength(0);
    });
  });

  // ── ages/coverage ──────────────────────────────────────────────────────

  it('ages/coverage warns about a clause-bearing Age too short to carry one', () => {
    const b = withEvents((x) => {
      const age = x.ages.find((a) => a.clauseBearing)!;
      age.duration.medianYears = 10;
    });
    expect(messages('ages/coverage', b)).toMatch(/clause-bearing Age with a short median span/);
  });

  // ── The partially-covered rules, on the halves nothing reached ─────────

  describe('slots/references', () => {
    it('catches a relation filter naming a slot the event does not declare', () => {
      const b = withEvents((x) => {
        const e = x.events.find((ev) => Object.keys(ev.slots).length)!;
        Object.values(e.slots)[0]!.filters.push({ relation: 'not', of: 'NO_SUCH_SLOT' });
      });
      expect(messages('slots/references', b)).toMatch(/NO_SUCH_SLOT/);
    });
  });

  /**
   * Issue #114: `not` inverts a `relation` filter's own "unanswerable" pass
   * into a rejection of every candidate, and the only way to get a
   * counterpart that is never cast when the filter runs is `castBy: player`.
   */
  describe('slots/negated-relation', () => {
    const withNegatedRelation = (officerCastBy: 'engine' | 'player') => withEvents((x) => {
      const e = x.events.find((ev) => Object.keys(ev.slots).length > 0)!;
      e.slots = {
        OFFICER: { role: 'family_member', castBy: officerCastBy, optional: false, bind: 'event', filters: [] },
        SENT: {
          role: 'family_member', castBy: 'engine', optional: false, bind: 'event',
          filters: [{ not: { relation: 'sibling_of', of: 'OFFICER' } }],
        },
      };
    });

    it('catches a negated relation filter naming a castBy: player counterpart', () => {
      const b = withNegatedRelation('player');
      expect(messages('slots/negated-relation', b)).toMatch(/OFFICER.*castBy: player/);
    });

    /** The working shape must not be refused — a rule that rejects it too is worse than no rule. */
    it('passes the identical filter when the counterpart is cast by the engine', () => {
      const b = withNegatedRelation('engine');
      expect(runRule('slots/negated-relation', b)).toEqual([]);
    });

    it('catches the trap nested through `all`/`any`, not only at the top level', () => {
      const b = withEvents((x) => {
        const e = x.events.find((ev) => Object.keys(ev.slots).length > 0)!;
        e.slots = {
          OFFICER: { role: 'family_member', castBy: 'player', optional: false, bind: 'event', filters: [] },
          SENT: {
            role: 'family_member', castBy: 'engine', optional: false, bind: 'event',
            filters: [{ not: { any: [{ relation: 'sibling_of', of: 'OFFICER' }] } }],
          },
        };
      });
      expect(messages('slots/negated-relation', b)).toMatch(/OFFICER/);
    });

    /**
     * `relation: 'not'` is a VALUE of the relation kind ("a different person
     * than"), not the `not` combinator — no `not` key on the filter object at
     * all, so this is not the trap and must not be flagged.
     */
    it('does not catch `relation: not`, self-exclusion within a party', () => {
      const b = withEvents((x) => {
        const e = x.events.find((ev) => Object.keys(ev.slots).length > 0)!;
        e.slots = {
          SENT: {
            role: 'family_member', castBy: 'engine', optional: false, bind: 'event',
            filters: [{ relation: 'not', of: 'SENT' }],
          },
        };
      });
      expect(runRule('slots/negated-relation', b)).toEqual([]);
    });
  });

  describe('refs/known', () => {
    const narrationEvent = (b: ContentBundle) => {
      const e = b.events.find((ev) => ev.interaction.kind === 'narration' && ev.tier !== 'frame')!;
      if (e.interaction.kind !== 'narration') throw new Error('unreachable');
      return e.interaction.outcomes[0]!;
    };

    it('catches an outcome starting an arc that does not exist', () => {
      const b = withEvents((x) => {
        narrationEvent(x).effects.push({ kind: 'arc', op: 'start', arc: 'arc_that_is_not' });
      });
      expect(messages('refs/known', b)).toMatch(/arc_that_is_not/);
    });

    it('catches an outcome scheduling an event that does not exist', () => {
      const b = withEvents((x) => {
        narrationEvent(x).effects.push({ kind: 'schedule', event: 'event_that_is_not', inYears: 5 });
      });
      expect(messages('refs/known', b)).toMatch(/schedules unknown event 'event_that_is_not'/);
    });

    it('catches an outcome granting an heirloom that does not exist', () => {
      const b = withEvents((x) => {
        narrationEvent(x).effects.push({ kind: 'heirloom', op: 'grant', heirloom: 'heirloom_that_is_not' });
      });
      expect(messages('refs/known', b)).toMatch(/heirloom_that_is_not/);
    });

    /** A knowledge gate nothing grants is an event that can never fire, silently. */
    it('catches a knowledge condition no event grants', () => {
      const b = withEvents((x) => {
        anEvent(x).conditions = { knowledge: 'knows_a_thing_nobody_teaches', has: true };
      });
      expect(messages('refs/known', b)).toMatch(/knows_a_thing_nobody_teaches/);
    });

    /** Issue #126: a `posts` condition naming a career by typo matches nobody, ever, silently. */
    it('catches a posts condition naming a career that does not exist', () => {
      const b = withEvents((x) => {
        anEvent(x).conditions = { posts: { op: 'gte', value: 1, career: ['no_such_post'] } };
      });
      expect(messages('refs/known', b)).toMatch(/no_such_post/);
    });

    it('catches a postHeldFor condition naming a career that does not exist', () => {
      const b = withEvents((x) => {
        anEvent(x).conditions = { postHeldFor: { career: 'no_such_post', op: 'gte', years: 1 } };
      });
      expect(messages('refs/known', b)).toMatch(/no_such_post/);
    });

    /** Issue #98: a `land` effect naming a parcel by typo mints or seizes nothing, silently. */
    it('catches an outcome naming a parcel that does not exist', () => {
      const b = withEvents((x) => {
        narrationEvent(x).effects.push({ kind: 'land', op: 'grant', parcel: 'parcel_that_is_not' });
      });
      expect(messages('refs/known', b)).toMatch(/unknown parcel 'parcel_that_is_not'/);
    });

    it('catches a holdsParcel condition naming a parcel that does not exist', () => {
      const b = withEvents((x) => {
        anEvent(x).conditions = { holdsParcel: 'parcel_that_is_not' };
      });
      expect(messages('refs/known', b)).toMatch(/unknown parcel 'parcel_that_is_not'/);
    });
  });

  describe('arcs/wiring', () => {
    it('catches a node running an event that does not exist', () => {
      const b = withEvents((x) => { x.arcs[0]!.nodes[0]!.event = 'event_that_is_not'; });
      expect(messages('arcs/wiring', b)).toMatch(/unknown event 'event_that_is_not'/);
    });

    it('catches a successor pointing at a node that is not in the arc', () => {
      const b = withEvents((x) => {
        const node = x.arcs[0]!.nodes.find((n) => n.successors?.length)!;
        node.successors![0]!.to = 'node_that_is_not';
      });
      expect(messages('arcs/wiring', b)).toMatch(/node_that_is_not/);
    });

    it('catches a valid node stranded when its only incoming successor is severed', () => {
      let stranded = '';
      let entry = '';
      const b = withEvents((x) => {
        const arc = x.arcs.find((candidate) => {
          const incoming = new Map<string, number>();
          for (const node of candidate.nodes) {
            for (const successor of node.successors) {
              if (successor.to === 'end') continue;
              incoming.set(successor.to, (incoming.get(successor.to) ?? 0) + 1);
            }
          }
          return candidate.nodes.some((node) => node.successors.some((successor) =>
            successor.to !== 'end'
            && successor.to !== candidate.entry
            && incoming.get(successor.to) === 1));
        });
        if (!arc) throw new Error('fixture has no arc edge with one incoming path');

        const incoming = new Map<string, number>();
        for (const node of arc.nodes) {
          for (const successor of node.successors) {
            if (successor.to === 'end') continue;
            incoming.set(successor.to, (incoming.get(successor.to) ?? 0) + 1);
          }
        }
        const predecessor = arc.nodes.find((node) => node.successors.some((successor) =>
          successor.to !== 'end'
          && successor.to !== arc.entry
          && incoming.get(successor.to) === 1))!;
        const edge = predecessor.successors.find((successor) =>
          successor.to !== 'end'
          && successor.to !== arc.entry
          && incoming.get(successor.to) === 1)!;
        stranded = edge.to;
        entry = arc.entry;
        edge.to = 'end';
      });

      expect(messages('arcs/wiring', b))
        .toContain(`node '${stranded}' is unreachable from entry '${entry}'`);
    });

    it('catches a successor guarding on a choice the node event does not have', () => {
      const b = withEvents((x) => {
        const node = x.arcs[0]!.nodes.find((n) => n.successors?.length)!;
        node.successors![0]!.fromChoice = 'a_choice_that_is_not';
      });
      expect(messages('arcs/wiring', b)).toMatch(/a_choice_that_is_not/);
    });

    it('catches a successor guarding on a tag no outcome carries', () => {
      const b = withEvents((x) => {
        const node = x.arcs[0]!.nodes.find((n) => n.successors?.length)!;
        node.successors![0]!.fromTag = 'a_tag_that_is_not';
      });
      expect(messages('arcs/wiring', b)).toMatch(/a_tag_that_is_not/);
    });

    it('catches an event claiming to be a node of an arc that does not exist', () => {
      const b = withEvents((x) => {
        const e = x.events.find((ev) => ev.arc)!;
        e.arc = { of: 'arc_that_is_not', node: e.arc!.node };
      });
      expect(messages('arcs/wiring', b)).toMatch(/unknown arc 'arc_that_is_not'/);
    });

    /** The two-way binding, disagreeing. The node says one event, the event says another. */
    it('catches a node and an event that disagree about which is which', () => {
      const b = withEvents((x) => {
        const e = x.events.find((ev) => ev.arc)!;
        const arc = x.arcs.find((a) => a.id === e.arc!.of)!;
        const node = arc.nodes.find((n) => n.id === e.arc!.node)!;
        const other = x.events.find((ev) => ev.id !== e.id && !ev.arc)!;
        node.event = String(other.id);
      });
      expect(messages('arcs/wiring', b)).toMatch(/not this event/);
    });
  });

  describe('arcs/expiry', () => {
    /** The seal arc's own four nodes: aftermath (0), presses, counted, our_letter. */
    const sealArc = (b: ContentBundle) => b.arcs.find((a) => a.id === 'arc_the_given_seal')!;

    it('catches the seal arc back at its old expiry — the bug this rule exists for (issue #131)', () => {
      const b = withEvents((x) => { sealArc(x).expiresAfterYears = 400; });
      expect(messages('arcs/expiry', b)).toMatch(/460 years.*exceeds its own expiresAfterYears \(400\)/s);
    });

    it('passes the seal arc at its shipped expiry, which covers the full 195-460 year span', () => {
      expect(messages('arcs/expiry', content.bundle)).toBe('');
    });

    it('does not choke on a self-looping arc — a war that can wait another season is not a wiring bug', () => {
      // arc_the_muster's `word` node names itself as a successor, on purpose
      // (muster.yaml): the middle of a war repeats until it ends. That makes
      // the longest path unbounded, and this rule has nothing to say about an
      // arc whose own `expiresAfterYears` is a timeout on the loop rather
      // than a bound on a route through a DAG.
      const muster = content.bundle.arcs.find((a) => a.id === 'arc_the_muster')!;
      expect(muster.nodes.some((n) => n.successors.some((s) => s.to === n.id)), 'no self-loop found — is this still the shape the test is about?').toBe(true);
      expect(messages('arcs/expiry', content.bundle)).not.toMatch(/arc_the_muster/);
    });

    it('leaves an arc with no declared expiry alone', () => {
      const b = withEvents((x) => {
        const arc = sealArc(x);
        arc.expiresAfterYears = undefined;
        // Shorten a node's own schedule so, if the rule mistakenly still
        // judged it, it would have nothing to complain about either — this
        // test is only honest if removing the expiry is what silences it.
        arc.nodes.find((n) => n.id === 'our_letter')!.schedule = { minYears: 1, maxYears: 1 };
      });
      expect(messages('arcs/expiry', b)).toBe('');
    });

    it('reads `next_generation` at its own worst case, 31 years — matching `scheduleNext` in core/src/events/arcs.ts', () => {
      const b = withEvents((x) => {
        const arc = sealArc(x);
        arc.expiresAfterYears = 30;
        arc.nodes = [
          { id: 'a', event: arc.nodes[0]!.event, selection: 'first_match', schedule: 'next_generation', successors: [{ to: 'end', weight: 100 }] },
        ];
        arc.entry = 'a';
      });
      expect(messages('arcs/expiry', b)).toMatch(/31 years.*exceeds its own expiresAfterYears \(30\)/s);

      const b2 = withEvents((x) => {
        const arc = sealArc(x);
        arc.expiresAfterYears = 31;
        arc.nodes = [
          { id: 'a', event: arc.nodes[0]!.event, selection: 'first_match', schedule: 'next_generation', successors: [{ to: 'end', weight: 100 }] },
        ];
        arc.entry = 'a';
      });
      expect(messages('arcs/expiry', b2)).toBe('');
    });

    it('catches a shorter, entirely synthetic cousin of the same bug', () => {
      const b = withEvents((x) => {
        const arc = sealArc(x);
        arc.expiresAfterYears = 10;
        arc.nodes = [
          { id: 'a', event: arc.nodes[0]!.event, selection: 'first_match', schedule: 'immediate', successors: [{ to: 'b', weight: 100 }] },
          { id: 'b', event: arc.nodes[0]!.event, selection: 'first_match', schedule: { minYears: 5, maxYears: 20 }, successors: [{ to: 'end', weight: 100 }] },
        ];
        arc.entry = 'a';
      });
      expect(messages('arcs/expiry', b)).toMatch(/20 years.*exceeds its own expiresAfterYears \(10\)/s);
    });
  });

  describe('arcs/inline', () => {
    const withNext = (b: ContentBundle) => {
      for (const e of b.events) {
        const outcomes = e.interaction.kind === 'narration'
          ? e.interaction.outcomes
          : e.interaction.choices.flatMap((c) => c.outcomes);
        const o = outcomes.find((x) => x.next);
        if (o) return { event: e, outcome: o };
      }
      throw new Error('the shipped content authors no inline follow-up');
    };

    /**
     * `next` compiles into `triggers`, and desugar leaves an authored
     * `triggers` alone — so an outcome carrying both silently drops the
     * follow-up. Saying so beats picking a winner nobody asked for.
     */
    it('catches an outcome declaring both a next and its own triggers', () => {
      const b = withEvents((x) => {
        const { outcome } = withNext(x);
        outcome.triggers = { arc: String(x.arcs[0]!.id), op: 'start' };
      });
      expect(messages('arcs/inline', b)).toMatch(/the follow-up would be discarded/);
    });

    /** A chain nothing leads into can never start, and sits there looking authored. */
    it('catches a chain of follow-ups with no beat that can start it', () => {
      const b = withEvents((x) => {
        const { event, outcome } = withNext(x);
        // Point the chain back at the event that starts it: now every event
        // carrying a `next` is itself somebody's follow-up.
        const target = x.events.find((e) => String(e.id) === outcome.next!.event);
        if (!target) throw new Error('the follow-up names an event that is not there');
        const targetOutcomes = target.interaction.kind === 'narration'
          ? target.interaction.outcomes
          : target.interaction.choices.flatMap((c) => c.outcomes);
        targetOutcomes[0]!.next = { event: String(event.id), after: 'next_generation', keep: [] };
      });
      expect(messages('arcs/inline', b)).toMatch(/a cycle with no beat that can start it/);
    });
  });

  describe('arcs/flags', () => {
    /** Ambient selection has no arc in scope, so the condition is always false. */
    it('warns about an arcFlag condition on an event, which can never be true there', () => {
      const b = withEvents((x) => {
        anEvent(x).conditions = { arcFlag: 'paid', is: true };
      });
      expect(messages('arcs/flags', b)).toMatch(/always false/);
    });

    it('catches a successor asking whether a node of some OTHER arc was visited', () => {
      const b = withEvents((x) => {
        const arc = x.arcs.find((a) => a.nodes.some((n) => n.successors?.length))!;
        const node = arc.nodes.find((n) => n.successors?.length)!;
        node.successors![0]!.when = { arcVisited: 'a_node_of_no_arc' };
      });
      expect(messages('arcs/flags', b)).toMatch(/a_node_of_no_arc/);
    });
  });

  describe('checks/wiring', () => {
    const eventWithCheck = (b: ContentBundle) => b.events.find((e) => e.checks.length)!;

    it('catches bands that are not strictly descending, which makes one unreachable', () => {
      const b = withEvents((x) => {
        const c = eventWithCheck(x).checks[0]!;
        c.bands = [...c.bands].sort((p, q) => p.atLeast - q.atLeast);
        if (c.bands.length < 2) throw new Error('need a check with two bands to scramble');
      });
      expect(messages('checks/wiring', b)).toMatch(/strictly descending/);
    });

    it('catches a choice naming a check its event does not declare', () => {
      const b = withEvents((x) => {
        const e = aChoiceEvent(x);
        if (e.interaction.kind === 'narration') throw new Error('unreachable');
        e.interaction.choices[0]!.check = 'check_that_is_not';
      });
      expect(messages('checks/wiring', b)).toMatch(/check_that_is_not/);
    });

    /**
     * A band naming an outcome the branch does not have resolves to nothing.
     * `evalCheck` falls back to the last band, so the check silently produces
     * the wrong ending rather than failing.
     */
    it('catches a band naming an outcome the choice does not have', () => {
      const b = withEvents((x) => {
        const e = x.events.find((ev) => {
          if (ev.interaction.kind === 'narration') return false;
          return ev.interaction.choices.some((c) => c.check && ev.checks.some((k) => k.id === c.check));
        })!;
        if (e.interaction.kind === 'narration') throw new Error('unreachable');
        const choice = e.interaction.choices.find((c) => c.check)!;
        const check = e.checks.find((k) => k.id === choice.check)!;
        check.bands[0]!.outcome = 'an_outcome_this_branch_does_not_have';
      });
      expect(messages('checks/wiring', b)).toMatch(/an_outcome_this_branch_does_not_have/);
    });
  });

  describe('slots/references, on the cycle nothing had built', () => {
    /**
     * Two slots whose relation filters point at each other: whichever fills
     * first compares against nobody, so one of them narrows nothing. The rule
     * is a topological sort, and this is the input it exists to reject.
     */
    it('catches relation filters that form a cycle', () => {
      const b = withEvents((x) => {
        const e = x.events.find((ev) => Object.keys(ev.slots).length >= 2)!;
        const [a, c] = Object.keys(e.slots);
        e.slots[a!]!.filters.push({ relation: 'not', of: c! });
        e.slots[c!]!.filters.push({ relation: 'not', of: a! });
      });
      expect(messages('slots/references', b)).toMatch(/form a cycle/);
    });
  });

  describe('arcs/wiring, on the inline-link halves nothing reached', () => {
    it('catches a next that keeps a slot the event it leaves does not cast', () => {
      const b = withEvents((x) => {
        for (const e of x.events) {
          const outcomes = e.interaction.kind === 'narration'
            ? e.interaction.outcomes
            : e.interaction.choices.flatMap((c) => c.outcomes);
          const o = outcomes.find((y) => y.next);
          if (!o) continue;
          o.next!.keep = ['A_SLOT_NOBODY_CASTS'];
          return;
        }
        throw new Error('the shipped content authors no inline follow-up');
      });
      expect(messages('arcs/wiring', b)).toMatch(/A_SLOT_NOBODY_CASTS/);
    });

    it('catches a next pointing at its own event', () => {
      const b = withEvents((x) => {
        for (const e of x.events) {
          const outcomes = e.interaction.kind === 'narration'
            ? e.interaction.outcomes
            : e.interaction.choices.flatMap((c) => c.outcomes);
          const o = outcomes.find((y) => y.next);
          if (!o) continue;
          o.next!.event = String(e.id);
          return;
        }
        throw new Error('the shipped content authors no inline follow-up');
      });
      expect(messages('arcs/wiring', b)).toMatch(/next points at its own event/);
    });
  });
});

/**
 * ISSUE #266: A CHOICE THAT CHANGES NOTHING.
 *
 * Each case clones the real bundle and breaks ONE event, so the rule is shown
 * firing against content the game would load rather than against a toy. The
 * event is chosen by shape, not by id, so these survive Phase B rewriting the
 * content they happen to land on.
 */
describe('choices/consequence', () => {
  const withEvents = (mutate: (b: ContentBundle) => void): ContentBundle => {
    const b = structuredClone(content.bundle);
    mutate(b);
    return b;
  };

  type Ev = ContentBundle['events'][number];
  const choicesOf = (e: Ev) => (e.interaction.kind === 'narration' ? [] : e.interaction.choices);
  const inAnyArc = new Set(content.arcs.flatMap((a) => a.nodes.map((n) => String(n.event))));

  /**
   * A plain player choice: two or more options, no arc anywhere near it, no
   * inline follow-up, and a first option that does something that lasts.
   */
  const plain = (b: ContentBundle): Ev => {
    const e = b.events.find((x) => x.tier !== 'frame'
      && x.interaction.kind === 'choice'
      && x.interaction.decidedBy === 'player'
      && !x.arc
      && !inAnyArc.has(String(x.id))
      && choicesOf(x).every((c) => c.outcomes.every((o) => !o.next && !o.triggers))
      && choicesOf(x)[0]!.outcomes.some((o) => o.effects.some((f) => f.kind === 'treasury' || f.kind === 'respect')));
    if (!e) throw new Error('the shipped content has no plain player choice to break');
    return e;
  };

  const issuesAt = (b: ContentBundle, where: string) =>
    runRule('choices/consequence', b).filter((i) => i.where === where);

  it('raises no error on the shipped content', () => {
    expect(runRule('choices/consequence', content).filter((i) => i.level === 'error')).toHaveLength(0);
  });

  it('errors on two options with identical effects', () => {
    let id = '';
    const b = withEvents((x) => {
      const e = plain(x);
      id = String(e.id);
      const [first, second] = choicesOf(e);
      second!.outcomes = structuredClone(first!.outcomes).map((o) => ({ ...o, id: `${o.id}_twin`, text: 'Different words.' }));
    });
    const errors = issuesAt(b, `event:${id}`).filter((i) => i.level === 'error');
    expect(errors, 'converging options must be an error').toHaveLength(1);
    expect(errors[0]!.message).toMatch(/identical effects/);
  });

  it('warns on an untagged no-effect option, and self_expression clears it', () => {
    let at = '';
    const strip = (tag: boolean) => withEvents((x) => {
      const e = plain(x);
      const c = choicesOf(e)[1]!;
      at = `event:${e.id}/${c.id}`;
      for (const o of c.outcomes) {
        o.effects = [];
        o.tags = tag ? [...o.tags, 'self_expression'] : o.tags.filter((t) => t !== 'self_expression');
      }
    });
    expect(issuesAt(strip(false), at).some((i) => i.level === 'warning' && /changes nothing/.test(i.message))).toBe(true);
    expect(issuesAt(strip(true), at)).toHaveLength(0);
  });

  it('warns on a flag nothing reads, and a reader anywhere clears it', () => {
    const FLAG = 'issue_266_unread_probe';
    const write = (x: ContentBundle) => {
      const e = plain(x);
      const o = choicesOf(e)[0]!.outcomes[0]!;
      o.effects.push({ kind: 'flag', flag: FLAG, set: true });
      return e;
    };
    const unread = withEvents((x) => { write(x); });
    const probe = (b: ContentBundle) =>
      runRule('choices/consequence', b).filter((i) => i.message.includes(`'${FLAG}'`));
    expect(probe(unread)).toHaveLength(1);
    expect(probe(unread)[0]!.level).toBe('warning');

    const read = withEvents((x) => {
      const writer = write(x);
      const other = x.events.find((e) => e.id !== writer.id && e.tier !== 'frame')!;
      const reader = { flag: FLAG };
      other.conditions = other.conditions ? { all: [other.conditions, reader] } : reader;
    });
    expect(probe(read)).toHaveLength(0);
  });

  it('counts a successor with fromChoice as a callback on that choice', () => {
    const b = withEvents((x) => {
      const e = plain(x);
      x.arcs.push({
        id: 'issue_266_probe_arc',
        title: 'Probe',
        entry: 'start',
        nodes: [{
          id: 'start',
          event: e.id,
          selection: 'first_match',
          schedule: 'next_generation',
          successors: [{ to: 'end', fromChoice: choicesOf(e)[0]!.id, weight: 100 }],
        }],
        bindings: [],
        maxConcurrentInstances: 1,
        inline: false,
      } as ContentBundle['arcs'][number]);
    });
    const target = plain(b);
    const [first, second] = choicesOf(target);
    const rows = auditChoices(indexContent(b)).rows.filter((r) => r.event === target.id);
    expect(rows.find((r) => r.choice === first!.id)!.categories).toContain('callback');
    expect(rows.find((r) => r.choice === second!.id)!.categories).not.toContain('callback');
  });
});

/**
 * #281 REVIEW: THE SIGNATURE IS MECHANICAL, NOT NOMINAL.
 *
 * Convergence is an error, so the signature has to say "the same" only when
 * the engine would do the same thing, and "different" whenever it would not.
 * Each case below was wrong in the first cut.
 */
describe('the consequence signature', () => {
  type O = Parameters<typeof outcomeSignature>[0];
  const outcome = (id: string, extra: Partial<O> = {}): O =>
    ({ id, weight: 100, text: `t ${id}`, tags: [], effects: [], ...extra }) as O;
  const treasury = (delta: number) => ({ kind: 'treasury', delta }) as O['effects'][number];
  const flag = (set: boolean) => ({ kind: 'flag', flag: 'x', set }) as O['effects'][number];

  it('ignores the generated inline-arc id, so identical inline callbacks converge', () => {
    const next = { event: 'the_follow_up', after: 'next_generation', keep: ['HEAD'] } as O['next'];
    const a = outcome('a', { next, triggers: { arc: inlineArcId('ev', 'a'), op: 'start' } });
    const b = outcome('b', { next, triggers: { arc: inlineArcId('ev', 'b'), op: 'start' } });
    expect(effectSignature([a])).toBe(effectSignature([b]));
  });

  it('tells inline callbacks apart by schedule and kept slots', () => {
    const base = { event: 'the_follow_up', after: 'next_generation', keep: ['HEAD'] } as NonNullable<O['next']>;
    const a = outcome('a', { next: base });
    expect(effectSignature([a])).not.toBe(effectSignature([outcome('b', { next: { ...base, after: 'immediate' } })]));
    expect(effectSignature([a])).not.toBe(effectSignature([outcome('b', { next: { ...base, keep: [] } })]));
    // An AUTHORED trigger is mechanics, not identity.
    expect(effectSignature([outcome('a', { triggers: { arc: 'seal_feud', op: 'start' } })]))
      .not.toBe(effectSignature([outcome('b', { triggers: { arc: 'seal_feud', op: 'advance' } })]));
  });

  it('keeps effects in the order the engine applies them', () => {
    expect(effectSignature([outcome('a', { effects: [flag(true), flag(false)] })]))
      .not.toBe(effectSignature([outcome('b', { effects: [flag(false), flag(true)] })]));
  });

  it('counts odds and tags, since the draw and the successors read them', () => {
    const pair = (wa: number, wb: number) => [
      outcome('win', { weight: wa, effects: [treasury(10)] }),
      outcome('lose', { weight: wb, effects: [treasury(-10)] }),
    ];
    expect(effectSignature(pair(50, 50))).toBe(effectSignature(pair(50, 50)));
    expect(effectSignature(pair(90, 10))).not.toBe(effectSignature(pair(10, 90)));
    expect(effectSignature([outcome('a', { tags: ['kept'] })])).not.toBe(effectSignature([outcome('b')]));
  });

  it('tells a guarded route from an unguarded one to the same node, and keeps multiplicity', () => {
    const o = outcome('a');
    const sig = (routes: { to: string; when?: unknown; weight: number }[]) => effectSignature([o], () => routes);
    expect(sig([{ to: 'x', weight: 100 }])).toBe(sig([{ to: 'x', weight: 100 }]));
    expect(sig([{ to: 'x', when: { flag: 'f' }, weight: 100 }])).not.toBe(sig([{ to: 'x', weight: 100 }]));
    expect(sig([{ to: 'x', weight: 30 }])).not.toBe(sig([{ to: 'x', weight: 70 }]));
    expect(sig([{ to: 'x', weight: 100 }, { to: 'x', weight: 100 }])).not.toBe(sig([{ to: 'x', weight: 100 }]));
  });

  it('does not converge two identical options whose successors differ only by guard', () => {
    const b = structuredClone(content.bundle);
    const e = b.events.find((x) => x.tier !== 'frame' && x.interaction.kind === 'choice'
      && x.interaction.decidedBy === 'player' && !x.arc && x.interaction.choices.length >= 2
      && x.interaction.choices.every((c) => c.outcomes.every((o) => !o.next && !o.triggers)))!;
    if (e.interaction.kind === 'narration') throw new Error('unreachable');
    const [first, second] = e.interaction.choices;
    second!.outcomes = structuredClone(first!.outcomes).map((o) => ({ ...o, id: `${o.id}_twin` }));
    const arcWith = (secondWhen?: unknown) => {
      const x = structuredClone(b);
      x.arcs.push({
        id: 'review_probe_arc', title: 'Probe', entry: 'start', bindings: [], maxConcurrentInstances: 1, inline: false,
        nodes: [{
          id: 'start', event: e.id, selection: 'first_match', schedule: 'next_generation',
          successors: [
            { to: 'end', fromChoice: first!.id, weight: 100 },
            { to: 'end', fromChoice: second!.id, weight: 100, ...(secondWhen ? { when: secondWhen } : {}) },
          ],
        }],
      } as ContentBundle['arcs'][number]);
      return auditChoices(indexContent(x)).converging.filter((c) => c.event === e.id);
    };
    expect(arcWith(), 'same effects, same unguarded route: one decision wearing two labels').toHaveLength(1);
    expect(arcWith({ flag: 'the_chair_is_kept' }), 'a guarded route is a different decision').toHaveLength(0);
  });
});
