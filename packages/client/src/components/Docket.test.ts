// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadContent } from '@ed/content';
import { PendingDecisionS } from '@ed/schema';
import type { LandView, PendingDecision, PendingDecisionView, RiteAssembly, TableView } from '@ed/core';
import Docket from './Docket.vue';
import Table from './Table.vue';
import type { GameActions } from '../lib/game';

const content = loadContent();

/**
 * ── THE FIRST TEST THAT RENDERS ANYTHING ──────────────────────────────────
 *
 * `packages/client` is 3,350 lines of Vue and every guard over it was a
 * text-level one. `verbs.test.ts` greps the templates to prove each verb on
 * `GameSession` reaches something a player can click — a real and valuable
 * check, and one that cannot tell whether the click does the right thing,
 * because nothing had ever been rendered.
 *
 * `Docket.vue` is where that matters most. It draws THREE SHAPES — choice,
 * match, record — and `run.slow.test.ts` says why in its own comment: "a kind
 * that never fires is a branch of that template nobody has ever rendered —
 * the failure this repository has shipped four times, one layer up". That
 * suite drives a whole run and checks each kind is RAISED. Whether the
 * template then draws it has been nobody's assertion.
 *
 * ── THE FIXTURES GO THROUGH THE REAL SCHEMA ───────────────────────────────
 *
 * Every decision below is built with real content and parsed by
 * `PendingDecisionS` before it reaches the component. A hand-written fixture
 * that the schema would reject is a test asserting against a shape the game
 * cannot produce, which is worse than no test: it passes forever while the
 * thing it claims to cover changes underneath it.
 */

/**
 * A real authored choice event with at least two branches.
 *
 * The first cut of this also demanded a SLOTLESS event and found none — every
 * one of the 324 choice events in the game casts at least one role. It does
 * not matter: what the panel draws a cast control for is `decision.cast`, the
 * roles the PLAYER is asked to fill, and that is empty here on purpose so
 * these tests are about branches rather than about casting.
 */
function anyChoiceEvent() {
  const e = content.bundle.events.find((x) => x.interaction.kind === 'choice'
    && x.interaction.choices.length >= 2);
  if (!e) throw new Error('no choice event with two branches in the content');
  return e;
}

/**
 * THE SAVE SCHEMA VALIDATES THE PERSISTED HALF; THE VIEW ADDS THE REST.
 *
 * `decidedBy` and `choicesAreOpen` live on the VIEW type in `decisions.ts`,
 * not on `PendingDecisionS` — the save carries what a run needs to resume,
 * and "is the branch yours to take" is recomputed. So the fixture is parsed
 * by the real schema (which is what stops it drifting into a shape the game
 * cannot produce) and then given the view-only fields explicitly.
 *
 * Finding that out is itself the test doing its job: the first cut set
 * neither, the branch buttons did not render, and the reason is a field a
 * grep-level guard has no way to know about.
 */
function choiceDecision(open = true): PendingDecision {
  const event = anyChoiceEvent();
  if (event.interaction.kind !== 'choice') throw new Error('picked the wrong event');
  const persisted = PendingDecisionS.parse({
    kind: 'choice',
    id: 'dec_1',
    year: 1100,
    event,
    body: 'The body of the thing, as the player reads it.',
    fill: {},
    cast: [],
    choices: event.interaction.choices.map((c) => ({
      id: c.id,
      label: c.label,
      available: true,
    })),
  });
  return {
    ...persisted,
    decidedBy: open ? 'player' : 'party',
    choicesAreOpen: open,
  } as unknown as PendingDecision;
}

/**
 * A choice decision with one player-cast slot carrying an observed-line read
 * (issue #28 item 2) on its one candidate — the Vessel's shape, without
 * needing the real `the_vessel_rite` event to be the one under test.
 */
function decisionWithObservedLine(): PendingDecision {
  const event = anyChoiceEvent();
  if (event.interaction.kind !== 'choice') throw new Error('picked the wrong event');
  const persisted = PendingDecisionS.parse({
    kind: 'choice',
    id: 'dec_line',
    year: 1100,
    event,
    body: 'The body of the thing, as the player reads it.',
    fill: {},
    cast: [{
      slot: 'WHO',
      optional: false,
      candidates: [{
        id: 'p_1',
        name: 'Dala',
        age: 20,
        issue: [{ name: 'Cesse', relation: 'her mother', borne: 2, grown: 1 }],
      }],
    }],
    choices: event.interaction.choices.map((c) => ({
      id: c.id,
      label: c.label,
      available: true,
    })),
  });
  return { ...persisted, decidedBy: 'player', choicesAreOpen: true } as unknown as PendingDecision;
}

function matchDecision(): PendingDecisionView {
  return PendingDecisionS.parse({
    kind: 'match',
    id: 'dec_match',
    year: 1160,
    subject: { id: 'subject', name: 'Ysolde', sex: 'female', age: 20 },
    cards: [
      {
        id: 'blood',
        kind: 'household',
        name: 'Corin',
        sex: 'male',
        age: 22,
        house: 'house_test',
        houseName: 'House Test',
        blurb: 'Already at this table.',
        dowry: 0,
        kinship: 0.0625,
        line: 'ordinary',
        lineSeen: 3,
        words: 'close kin · deep blood · an ordinary line',
        panel: { issue: [], woken: [], said: [], ourBook: [] },
        person: 'corin',
        available: true,
      },
      {
        id: 'continuity',
        kind: 'outsider',
        name: 'Aldren',
        sex: 'male',
        age: 23,
        house: 'house_full',
        houseName: 'House Full',
        blurb: 'A watched family.',
        dowry: 70,
        kinship: 0,
        line: 'fertile',
        lineSeen: 3,
        words: 'a full line',
        panel: {
          issue: [{ name: 'Cesse', relation: 'of his house', borne: 5, grown: 4 }],
          woken: [], said: [], ourBook: [],
        },
        available: true,
      },
      {
        id: 'mystery',
        kind: 'outsider',
        name: 'Beren',
        sex: 'male',
        age: 21,
        house: 'house_unknown',
        houseName: 'House Unknown',
        blurb: 'Nobody here knows much of them.',
        dowry: 20,
        kinship: 0,
        line: 'unknown',
        lineSeen: 0,
        words: 'no line anybody here has watched',
        panel: { issue: [], woken: [], said: [], ourBook: [] },
        available: true,
      },
    ],
  }) as PendingDecision;
}

function recordDecision(): PendingDecision {
  const event = anyChoiceEvent();
  return PendingDecisionS.parse({
    kind: 'record',
    id: 'dec_2',
    year: 1200,
    event,
    subject: 'p_1',
    entryId: 'chr_1',
    fill: {},
    options: [
      { option: 'record', chronicle: 'It happened, and it is written down.' },
      { option: 'omit', chronicle: null },
      { option: 'embellish', chronicle: 'It happened rather better than that.' },
    ],
  }) as PendingDecision;
}

/** Every action stubbed, so a click can be caught wherever it lands. */
function spyActions() {
  const names = [
    'begin', 'found', 'enter', 'resume', 'restart', 'advance', 'choose', 'send',
    'match', 'declineHand', 'record', 'dismissOutcome', 'dismissInterlude',
    'letHimDecide', 'name', 'order', 'view', 'epilogue', 'save',
  ] as const;
  const actions = {} as Record<string, ReturnType<typeof vi.fn>>;
  for (const n of names) actions[n] = vi.fn();
  return actions as unknown as Record<keyof GameActions, ReturnType<typeof vi.fn>>
    & { readonly __brand?: GameActions };
}

describe('the docket draws what it is handed', () => {
  it('announces the decision and moves focus to its heading', async () => {
    const w = mount(Docket, {
      attachTo: document.body,
      props: { decision: choiceDecision(), actions: spyActions() as unknown as GameActions },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(w.get('section.docket').attributes('aria-live')).toBe('polite');
    expect(w.get('section.docket').attributes('aria-labelledby')).toBe('docket-heading');
    expect(document.activeElement).toBe(w.get('#docket-heading').element);
    w.unmount();
  });

  it('renders a choice, with a control per branch', () => {
    const decision = choiceDecision();
    const actions = spyActions();
    const w = mount(Docket, { props: { decision, actions: actions as unknown as GameActions } });

    expect(w.text()).toContain('The body of the thing');
    const buttons = w.findAll('button');
    expect(
      buttons.length,
      'a choice with branches drew no controls at all — the player cannot answer',
    ).toBeGreaterThanOrEqual(2);
  });

  /**
   * THE CLICK HAS TO REACH THE VERB. This is the half `verbs.test.ts` cannot
   * do: it proves `choose` is MENTIONED in the store and in a template, not
   * that pressing the branch calls it with the branch that was pressed.
   */
  it('and pressing a branch calls choose with that branch', async () => {
    const decision = choiceDecision();
    if (decision.kind !== 'choice') throw new Error('fixture is the wrong kind');
    const actions = spyActions();
    const w = mount(Docket, { props: { decision, actions: actions as unknown as GameActions } });

    const buttons = w.findAll('button');
    await buttons[0]!.trigger('click');

    expect(actions.choose, 'the first branch was pressed and choose was never called').toHaveBeenCalled();
    const [id, choiceId] = actions.choose.mock.calls[0]!;
    expect(id).toBe(decision.id);
    expect(decision.choices.map((c) => c.id)).toContain(choiceId);
  });

  /**
   * ── AND THE BRANCH THAT IS NOT THE PLAYER'S TO TAKE ──────────────────────
   *
   * `decidedBy: party` means the docket stopped the clock to collect a CAST,
   * and what those people are between them decides the branch. A panel that
   * drew the choice list anyway would be offering an answer the engine will
   * refuse — `session.ts` says so in as many words. So the same decision with
   * `choicesAreOpen: false` must draw no branches at all, and one send.
   */
  it('offers no branches when the branch is not the player\'s to take', async () => {
    const decision = choiceDecision(false);
    if (decision.kind !== 'choice') throw new Error('fixture is the wrong kind');
    const actions = spyActions();
    const w = mount(Docket, { props: { decision, actions: actions as unknown as GameActions } });

    const labels = decision.choices.map((c) => c.label);
    for (const label of labels) {
      expect(
        w.text().includes(label),
        `the panel offered "${label}" on a decision whose branch the player does not take`,
      ).toBe(false);
    }

    const send = w.findAll('button').find((b) => b.text().includes('Send them'));
    expect(send, 'a party decision drew no way to send anybody').toBeTruthy();
    await send!.trigger('click');
    expect(actions.send).toHaveBeenCalled();
    expect(actions.choose, 'a party decision must never call choose').not.toHaveBeenCalled();
  });

  /**
   * ── WHAT IS OBSERVED OF A CANDIDATE'S LINE (issue #28 item 2) ────────────
   * The row does not appear until somebody is actually named — the docket is
   * not a stat screen you browse before deciding — and once named, it reads
   * her mother by name with what the record credits to her, never a number
   * off a genome.
   */
  it('shows nothing of the line before a candidate is named, and the read afterward', async () => {
    const decision = decisionWithObservedLine();
    const actions = spyActions();
    const w = mount(Docket, { props: { decision, actions: actions as unknown as GameActions } });

    expect(w.text()).not.toContain('Cesse');

    await w.get('select').setValue('p_1');
    expect(w.text()).toContain('Cesse');
    expect(w.text()).toContain('her mother');
    expect(w.text()).toContain('2 children');
    expect(w.text()).toContain('1 grown');
  });

  it('keeps adviser logic outside hidden genetics, Bearing and future RNG', () => {
    const source = readFileSync(join(import.meta.dirname, '../../../core/src/advisers.ts'), 'utf8');
    for (const forbidden of ['phenotypeOf', '.genome', 'bearing', 'streamFor', 'Math.random', 'overflowMadness']) {
      expect(source, `adviser code must not read ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('can show two advisers disagreeing without presenting either as the engine answer', () => {
    const decision = matchDecision();
    decision.advice = [
      {
        adviser: { id: 'priest', name: 'Father Orin' },
        lens: 'priest',
        cares: 'the Church is the institution he serves',
        position: 'I would take Aldren. The papers put the greatest distance between the lines there.',
      },
      {
        adviser: { id: 'reader', name: 'Tomas' },
        lens: 'reader',
        cares: 'he lives by what can be read, remembered and proved',
        position: 'I would take Corin. There is more written and witnessed around that line.',
      },
    ];
    const w = mount(Docket, {
      props: { decision, actions: spyActions() as unknown as GameActions },
    });

    const counsel = w.get('[aria-label="Counsel from the household"]').text();
    expect(counsel).toContain('Father Orin');
    expect(counsel).toContain('I would take Aldren');
    expect(counsel).toContain('Tomas');
    expect(counsel).toContain('I would take Corin');
  });

  it('renders named, attributed counsel and the adviser\'s reason for caring', () => {
    const decision = matchDecision();
    decision.advice = [{
      adviser: { id: 'reader', name: 'Tomas' },
      lens: 'reader',
      cares: 'he lives by what can be read, remembered and proved',
      position: 'I would take Corin. There is more written around that line.',
    }];
    const w = mount(Docket, {
      props: { decision, actions: spyActions() as unknown as GameActions },
    });

    const counsel = w.get('[aria-label="Counsel from the household"]');
    expect(counsel.text()).toContain('Tomas');
    expect(counsel.text()).toContain('I would take Corin');
    expect(counsel.text()).toContain('read, remembered and proved');
  });

  it('puts the strategic future on the face of every Match card', () => {
    const decision = matchDecision();
    const actions = spyActions();
    const w = mount(Docket, { props: { decision, actions: actions as unknown as GameActions } });

    const futures = w.findAll('[data-future]');
    expect(futures.map((f) => f.attributes('data-future'))).toEqual([
      'blood', 'continuity', 'mystery',
    ]);
    expect(futures[0]!.text()).toContain('Blood');
    expect(futures[0]!.text()).toMatch(/close kin|deep blood/);
    expect(futures[1]!.text()).toContain('Continuity');
    expect(futures[1]!.text()).toContain('4 of 5 children');
    expect(futures[2]!.text()).toContain('Mystery');
    expect(futures[2]!.text()).toContain('thin evidence');
  });

  it('still takes the Match card whose future the player pressed', async () => {
    const decision = matchDecision();
    if (decision.kind !== 'match') throw new Error('fixture is the wrong kind');
    const actions = spyActions();
    const w = mount(Docket, { props: { decision, actions: actions as unknown as GameActions } });

    const take = w.findAll('button').find((b) => b.text().includes('Take this one'));
    expect(take).toBeDefined();
    await take!.trigger('click');

    expect(actions.match).toHaveBeenCalledWith(
      decision.id,
      decision.cards[0]!.id,
      decision.cards[0]!.name,
    );
  });

  it('renders a Record block, with its three options', () => {
    const decision = recordDecision();
    const actions = spyActions();
    const w = mount(Docket, { props: { decision, actions: actions as unknown as GameActions } });

    const text = w.text();
    // The three options are the client's own words, so this asserts that
    // something for each was drawn rather than pinning the wording.
    expect(w.findAll('button').length, 'the Record block drew no options').toBeGreaterThanOrEqual(3);
    expect(text.length, 'the Record block rendered empty').toBeGreaterThan(20);
  });

  it('and pressing a Record option calls record', async () => {
    const decision = recordDecision();
    const actions = spyActions();
    const w = mount(Docket, { props: { decision, actions: actions as unknown as GameActions } });

    await w.findAll('button')[0]!.trigger('click');
    expect(actions.record, 'a Record option was pressed and record was never called').toHaveBeenCalled();
    expect(actions.record.mock.calls[0]![0]).toBe(decision.id);
  });
});

/**
 * ── THE CLOSED UNION, ONE LAYER OUT ───────────────────────────────────────
 *
 * Invariant 5 says the verbs are enumerated and every site handling one ends
 * in `assertNever`. The compiler enforces that in `core`. A Vue template has
 * no such thing: a `v-if` chain over `decision.kind` that is missing a branch
 * renders NOTHING, silently, which is this repository's whole thesis wearing
 * a stylesheet.
 *
 * So the kinds are read off the schema — never a list in this file — and the
 * template has to name each one.
 */
describe('every docket kind has a shape in the template', () => {
  const kinds = PendingDecisionS.options.map((o) => o.shape.kind.value as string);
  const template = readFileSync(join(import.meta.dirname, 'Docket.vue'), 'utf8');

  it('finds the kinds at all', () => {
    // A reflection that returns nothing would make the loop below vacuous.
    expect(kinds.length).toBeGreaterThanOrEqual(3);
    expect(kinds).toContain('choice');
  });

  for (const kind of PendingDecisionS.options.map((o) => o.shape.kind.value as string)) {
    it(`dispatches on '${kind}' by name`, () => {
      /**
       * BY NAME, not merely mentioned. The Record block used to be a bare
       * `<template v-else>` — a catch-all, which is invariant 5's permissive
       * default wearing a stylesheet. A fourth kind would have rendered as a
       * Record block: the wrong panel, drawn confidently, with `subject`
       * undefined and three buttons calling `record` on a decision that is
       * not one. Checking only that the name appears somewhere in the file
       * would have passed against exactly that.
       */
      const dispatch = new RegExp(`v-(?:else-)?if="decision\\.kind === '${kind}'"`);
      expect(
        dispatch.test(template),
        `Docket.vue does not branch on decision.kind === '${kind}'. A template has no `
        + 'assertNever, so a kind that is not named here either renders blank or — worse — '
        + 'falls into somebody else\'s branch and draws the wrong panel as though it were '
        + 'right.',
      ).toBe(true);
    });
  }

  /**
   * And the last branch is a stated fallback rather than a silent one, so the
   * day a fourth kind arrives the player is told, instead of being shown a
   * Record block for a decision that is not a Record block.
   */
  it('and its final v-else says it does not know, rather than guessing', () => {
    const tail = template.slice(template.lastIndexOf('v-else'));
    expect(tail).toMatch(/unhandled|does not know how to draw/);
  });
});


/**
 * THE GREAT WORK CONFIRMATION (#218).
 *
 * This lives in the existing component suite instead of opening another jsdom
 * file. Vitest intentionally runs this repository with `isolate: false`;
 * sharing Vue's DOM runtime across separately-created jsdom environments makes
 * an extra component file order-dependent. The behavior belongs here beside
 * the docket it ultimately opens.
 */
function riteTable(assembly: RiteAssembly): TableView {
  return {
    treasury: 500,
    bidCeiling: 0,
    marriagePolicy: 'as_it_falls',
    programmeCandidates: [],
    shelf: [],
    missingPrimers: [],
    ledgerSearch: { ready: false, reason: 'not yet', fee: 40 },
    vesselRite: { ready: true, assembly },
    greatRite: { ready: false, reason: 'not yet' },
    unmaking: { ready: false, reason: 'not yet' },
    tutoring: [],
    studying: [],
    market: [],
    tutorFee: 40,
    canTutor: true,
    teachable: [],
    servants: [],
    maxBond: 100,
    papers: [],
    pedigreePrices: [],
    posts: [],
    pupils: [],
  };
}

const riteLand: LandView = {
  treasury: 500,
  rentsPolicy: 'customary',
  held: [],
  market: [],
  lost: [],
};

const vesselAssembly: RiteAssembly = {
  rite: 'vessel',
  title: 'The Vessel',
  actors: [{ slot: 'ASCENDANT', person: 'p_1', name: 'Aldren' }],
  atRisk: [{
    slot: 'VESSEL',
    candidates: [
      { person: 'p_2', name: 'Mara' },
      { person: 'p_3', name: 'Cesse' },
    ],
  }],
  preparations: ['Aldren has read The Red Primer.'],
  irreversible: ['The named Vessel is consumed. Their place in the living house cannot be restored.'],
};

function buttonContaining(wrapper: VueWrapper, text: string) {
  const found = wrapper.findAll('button').find((candidate) => candidate.text().includes(text));
  if (!found) throw new Error(`no button containing "${text}"`);
  return found;
}

describe('major rite confirmation (#218)', () => {
  it('shows the engine assembly before doing anything, and cancellation mutates nothing', async () => {
    const actions = spyActions();
    const wrapper = mount(Table, {
      props: {
        table: riteTable(vesselAssembly),
        land: riteLand,
        actions: actions as unknown as GameActions,
        refusal: null,
        receipt: null,
      },
    });

    await buttonContaining(wrapper, 'Call the Vessel').trigger('click');

    expect(actions.order).not.toHaveBeenCalled();
    expect(wrapper.get('[aria-label="Rite assembly"]').text()).toContain('Aldren');
    expect(wrapper.get('[aria-label="Rite assembly"]').text()).toContain('Mara');
    expect(wrapper.get('[aria-label="Rite assembly"]').text()).toContain('The Red Primer');
    expect(wrapper.get('[aria-label="Rite assembly"]').text()).toContain('consumed');

    await buttonContaining(wrapper, 'Not yet').trigger('click');

    expect(actions.order).not.toHaveBeenCalled();
    expect(wrapper.find('[aria-label="Rite assembly"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('confirmation invokes the existing rite order exactly once', async () => {
    const actions = spyActions();
    const wrapper = mount(Table, {
      props: {
        table: riteTable(vesselAssembly),
        land: riteLand,
        actions: actions as unknown as GameActions,
        refusal: null,
        receipt: null,
      },
    });

    await buttonContaining(wrapper, 'Call the Vessel').trigger('click');
    await buttonContaining(wrapper, 'Put this rite before the house').trigger('click');

    expect(actions.order).toHaveBeenCalledTimes(1);
    expect(actions.order).toHaveBeenCalledWith({ kind: 'vesselRite' });
    expect(wrapper.find('[aria-label="Rite assembly"]').exists()).toBe(false);
    wrapper.unmount();
  });
});
