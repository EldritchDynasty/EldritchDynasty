import { describe, expect, it } from 'vitest';
import { loadBundle, loadContent } from '@ed/content';
import { applyOutcome, phase, place, testWorld, viewOf } from '@ed/core';

import { contentProseEntries, proseOriginalHash } from '@ed/schema';
import type { ProseVariant } from '@ed/schema';
import { missingPlainEnglish } from './prose.js';
import { newGame, resumeGame } from './session.js';
import { queueMatch } from './events/decisions.js';
import { emptyPanel, readPanel } from './people/panel.js';
import type { MatchCard } from './people/match.js';

const content = loadContent();

/**
 * Nested tales (issue #14). `applyOutcome` births a tale's circulation state
 * the year the event it is `about` actually fires — not merely the year some
 * OTHER event cites it in `accounts` — and the `generation` phase ticks
 * whether it has started circulating and how many times it has mutated.
 */
describe('nested tale circulation', () => {
  it('is born, unstarted, the year its about-event fires — and only that event', () => {
    const ctx = testWorld(content, 1042, 1400);
    const event = ctx.content.mustEvent('the_burning_of_the_nine_libraries');
    if (event.interaction.kind !== 'narration') throw new Error('unreachable');
    const head = place(ctx, { sex: 'male', age: 40, castSlots: ['head'] });

    expect(ctx.world.tales.size).toBe(0);
    applyOutcome(event, event.interaction.outcomes[0]!, ctx, { HEAD: head.id });

    expect(ctx.content.tale('ballad_of_the_nine_days')!.about).toBe('the_burning_of_the_nine_libraries');

    for (const id of ['ballad_of_the_nine_days', 'ilm_lament_for_the_burned']) {
      const state = ctx.world.tales.get(id);
      expect(state, id).toBeDefined();
      expect(state!.bornYear).toBe(1400);
      expect(state!.circulating).toBe(false);
      expect(state!.mutations).toBe(0);
    }

    // Not born: a tale merely cited in some OTHER event's accounts.
    expect(ctx.world.tales.has('church_inquest_minute_1604')).toBe(false);
  });

  it('does not re-birth, or reset, a tale that already has a circulation record', () => {
    const ctx = testWorld(content, 1042, 1400);
    const event = ctx.content.mustEvent('the_burning_of_the_nine_libraries');
    if (event.interaction.kind !== 'narration') throw new Error('unreachable');
    const head = place(ctx, { sex: 'male', age: 40, castSlots: ['head'] });

    applyOutcome(event, event.interaction.outcomes[0]!, ctx, { HEAD: head.id });
    const before = { ...ctx.world.tales.get('ballad_of_the_nine_days')! };

    ctx.world.year = 1500;
    applyOutcome(event, event.interaction.outcomes[0]!, ctx, { HEAD: head.id });
    expect(ctx.world.tales.get('ballad_of_the_nine_days')).toEqual(before);
  });

  it('starts circulating exactly when the generation phase crosses circulatesFrom', () => {
    const ctx = testWorld(content, 1042, 1400);
    const event = ctx.content.mustEvent('the_burning_of_the_nine_libraries');
    if (event.interaction.kind !== 'narration') throw new Error('unreachable');
    const head = place(ctx, { sex: 'male', age: 40, castSlots: ['head'] });
    applyOutcome(event, event.interaction.outcomes[0]!, ctx, { HEAD: head.id });

    const def = ctx.content.tale('ballad_of_the_nine_days')!;
    const circulatesFrom = 1400 + def.circulatesFrom.yearsAfterEvent;

    ctx.world.year = circulatesFrom - 1;
    phase('generation', ctx);
    expect(ctx.world.tales.get('ballad_of_the_nine_days')!.circulating).toBe(false);

    ctx.world.year = circulatesFrom;
    phase('generation', ctx);
    expect(ctx.world.tales.get('ballad_of_the_nine_days')!.circulating).toBe(true);
  });

  it('mutates only once mutatesEveryYears has passed since circulation began', () => {
    const ctx = testWorld(content, 1042, 1400);
    const event = ctx.content.mustEvent('the_burning_of_the_nine_libraries');
    if (event.interaction.kind !== 'narration') throw new Error('unreachable');
    const head = place(ctx, { sex: 'male', age: 40, castSlots: ['head'] });
    applyOutcome(event, event.interaction.outcomes[0]!, ctx, { HEAD: head.id });

    const def = ctx.content.tale('ballad_of_the_nine_days')!;
    const circulatesFrom = 1400 + def.circulatesFrom.yearsAfterEvent;

    ctx.world.year = circulatesFrom;
    phase('generation', ctx);
    expect(ctx.world.tales.get('ballad_of_the_nine_days')!.mutations).toBe(0);

    ctx.world.year = circulatesFrom + def.mutatesEveryYears - 1;
    phase('generation', ctx);
    expect(ctx.world.tales.get('ballad_of_the_nine_days')!.mutations).toBe(0);

    ctx.world.year = circulatesFrom + def.mutatesEveryYears;
    phase('generation', ctx);
    expect(ctx.world.tales.get('ballad_of_the_nine_days')!.mutations).toBe(1);
  });
});

/**
 * AND THEN IT REACHED SOMEBODY.
 *
 * Everything above this line was true before a client could see a word of it.
 * `world.tales` was born, circulated, mutated and saved, and `SessionView`
 * carried no field for any of it — while `chronicle`, `frame` and
 * `looseSecrets` all surfaced. So `teller` and `bias`, which `schema/tale.ts`
 * calls "required, not optional colour", reached nobody: the layer was built
 * and it was invisible, which in this codebase is the same as not built.
 */
describe('tales reaching the player', () => {
  const BURNING = 'the_burning_of_the_nine_libraries';
  /** The two accounts of that one event. They disagree, on purpose. */
  const LAMENT = 'ilm_lament_for_the_burned';
  const BALLAD = 'ballad_of_the_nine_days';

  /** Fire the burning, then stand `years` later with the generation phase run. */
  function afterBurning(years: number) {
    const ctx = testWorld(content, 1042, 1400);
    const event = ctx.content.mustEvent(BURNING);
    if (event.interaction.kind !== 'narration') throw new Error('unreachable');
    const head = place(ctx, { sex: 'male', age: 40, castSlots: ['head'] });
    applyOutcome(event, event.interaction.outcomes[0]!, ctx, { HEAD: head.id });

    ctx.world.year = 1400 + years;
    phase('generation', ctx);
    return ctx;
  }

  it('says nothing about a tale whose event fired but which nobody tells yet', () => {
    // Born the year the burning fired; the earliest circulates 3 years later.
    const ctx = afterBurning(0);
    expect(ctx.world.tales.size, 'the tales were never born').toBeGreaterThan(0);
    expect(viewOf(ctx).tales).toEqual([]);
  });

  it('carries the tale, its teller and its bias, once it circulates', () => {
    const view = viewOf(afterBurning(3));
    const lament = view.tales.find((t) => t.id === LAMENT);

    expect(lament, 'the lament is circulating and the view does not have it').toBeDefined();
    expect(lament!.teller).toBe('the scholars of House Ilm');
    expect(lament!.bias).toBe('grieving');
    expect(lament!.form).toBe('rhyme');
    expect(lament!.about).toBe(BURNING);
    expect(lament!.since).toBe(1403);
    expect(lament!.text.length, 'a tale nobody can read is not a tale').toBeGreaterThan(40);
  });

  it('still says nothing about the account that has not started yet', () => {
    // The ballad waits twenty years. One event, two accounts, two clocks.
    const view = viewOf(afterBurning(3));
    expect(view.tales.map((t) => t.id)).toContain(LAMENT);
    expect(view.tales.map((t) => t.id)).not.toContain(BALLAD);
  });

  /**
   * The point of the whole layer. Both accounts of one event stand in the
   * view at once, contradicting each other, and the view does not rank them.
   */
  it('lets two accounts of one event stand together, disagreeing', () => {
    const view = viewOf(afterBurning(20));
    const accounts = view.tales.filter((t) => t.about === BURNING);

    expect(accounts.map((t) => t.id).sort()).toEqual([BALLAD, LAMENT].sort());
    expect(new Set(accounts.map((t) => t.bias)).size, 'two accounts that agree are one account')
      .toBe(accounts.length);
  });

  /**
   * `accuracy` is the authored answer to "how much of this is true". The game
   * never adjudicates between two contradicting accounts in its own voice, so
   * a client must not be handed the answer key — it could sort the accounts by
   * truth, which is the one reading this layer exists to refuse.
   */
  it('never hands the client the answer key', () => {
    const view = viewOf(afterBurning(20));
    expect(view.tales.length).toBeGreaterThan(0);
    for (const tale of view.tales) {
      expect(Object.keys(tale), `${tale.id} carries the authored truth into the view`)
        .not.toContain('accuracy');
    }
    // And the numbers themselves are nowhere in the serialised view.
    const wire = JSON.stringify(view.tales);
    expect(wire).not.toContain('0.55');
    expect(wire).not.toContain('0.3');
  });

  it('reports how far the telling has drifted', () => {
    const def = content.tale(LAMENT)!;
    expect(viewOf(afterBurning(3)).tales.find((t) => t.id === LAMENT)!.mutations).toBe(0);

    const later = afterBurning(3 + def.mutatesEveryYears);
    expect(viewOf(later).tales.find((t) => t.id === LAMENT)!.mutations).toBe(1);
  });

  /**
   * The scar the `frame` array already carries on this object: a view handed
   * out a live reference grows new entries when the world moves, and a view
   * that changes under the caller is not a picture of anything.
   */
  it('is a picture, not a window', () => {
    const ctx = afterBurning(3);
    const early = viewOf(ctx);
    expect(early.tales.map((t) => t.id)).toEqual([LAMENT]);

    ctx.world.year = 1400 + 20;
    phase('generation', ctx);

    expect(early.tales.map((t) => t.id), 'the old view grew a tale when the world moved')
      .toEqual([LAMENT]);
    expect(viewOf(ctx).tales.map((t) => t.id)).toContain(BALLAD);
  });

  it('orders itself the same way twice, oldest telling first', () => {
    const ctx = afterBurning(20);
    const once = viewOf(ctx).tales.map((t) => t.id);
    expect(viewOf(ctx).tales.map((t) => t.id)).toEqual(once);

    const sinces = viewOf(ctx).tales.map((t) => t.since);
    expect(sinces).toEqual([...sinces].sort((a, b) => a - b));
  });

  it('drops a tale the content no longer declares, rather than throwing', () => {
    const ctx = afterBurning(20);
    ctx.world.tales.set('a_tale_edited_out_of_the_content', {
      bornYear: 1400, circulatesFrom: 1401, circulating: true, mutations: 0,
    });
    expect(() => viewOf(ctx)).not.toThrow();
    expect(viewOf(ctx).tales.map((t) => t.id)).not.toContain('a_tale_edited_out_of_the_content');
  });
});

const TALE = 'marrow_chronicle_fragment_1188';
const BASE = `content:tales.yaml#tales[id=${TALE}]`;
const PLAIN = {
  teller: 'The clerks who keep the rival book',
  bias: 'They want their house to seem stronger.',
  text: 'Their account describes the dispute in simple words.',
};

function fixture(variants?: ProseVariant[], provenance = true) {
  const bundle = loadBundle();
  const tale = bundle.tales.find((item) => item.id === TALE)!;
  const authored = Object.entries(PLAIN).map(([field, plainenglish]) => ({
    address: `${BASE}.${field}`,
    plainenglish,
    of: proseOriginalHash(tale[field as keyof typeof PLAIN]),
  }));
  bundle.proseVariants = [
    ...bundle.proseVariants.filter((item) => !item.address.startsWith(`${BASE}.`)),
    ...(variants ?? authored),
  ];
  const game = newGame(provenance ? bundle : structuredClone(bundle), { seed: 1042, startYear: 1200 });
  game.ctx.world.tales.set(TALE, {
    bornYear: 1188, circulatesFrom: 1193, circulating: true, mutations: 2, lastMutated: 1199,
  });
  return { game, tale };
}

describe('Plain English tales reaching the player', () => {
  it('uses worklist identities and switches live wording without changing circulation or exposing accuracy', () => {
    const { game, tale } = fixture();
    const entries = contentProseEntries('tales.yaml', { tales: [tale] });
    expect(entries.map((entry) => entry.address)).toEqual(expect.arrayContaining([
      `${BASE}.teller`, `${BASE}.text`,
    ]));
    const unheard = game.ctx.content.tale('ballad_of_the_nine_days')!;
    game.ctx.world.tales.set(unheard.id, {
      bornYear: 1200, circulatesFrom: 1220, circulating: false, mutations: 0,
    });
    game.ctx.world.tales.set('removed_tale', {
      bornYear: 1188, circulatesFrom: 1193, circulating: true, mutations: 0,
    });
    const original = game.view().tales;
    expect(original).toEqual([{
      id: TALE, form: tale.form, teller: tale.teller, bias: tale.bias, text: tale.text,
      about: tale.about, since: 1193, mutations: 2,
    }]);

    game.setProseMode('plainenglish');
    expect(game.view().tales).toEqual([{ ...original[0], ...PLAIN }]);
    expect(game.view().tales[0]).not.toHaveProperty('accuracy');
    expect(missingPlainEnglish(game.ctx)).not.toContain(`content:tales.yaml#tales[id=${unheard.id}].text`);
    expect(original[0]?.text).toBe(tale.text);

    game.setProseMode('original');
    expect(game.view().tales).toEqual(original);
  });

  it('falls back field by field and reports unmigrated visible addresses', () => {
    const originalText = loadBundle().tales.find((item) => item.id === TALE)!.text;
    const { game, tale } = fixture([{ address: `${BASE}.text`, of: proseOriginalHash(originalText), plainenglish: PLAIN.text }]);
    game.setProseMode('plainenglish');
    expect(game.view().tales[0]).toMatchObject({
      teller: tale.teller, bias: tale.bias, text: PLAIN.text,
    });
    // The full view also renders unrelated prose, including uncertain succession.
    expect(missingPlainEnglish(game.ctx).filter((address) => address.startsWith(`${BASE}.`)))
      .toEqual([`${BASE}.bias`, `${BASE}.teller`]);
  });

  it('keeps Original when an untracked bundle cannot identify the source file', () => {
    const { game, tale } = fixture(undefined, false);
    expect(game.ctx.content.sourceOf(TALE)).toBeUndefined();
    game.setProseMode('plainenglish');
    expect(game.view().tales[0]).toMatchObject({
      teller: tale.teller, bias: tale.bias, text: tale.text,
    });
    expect(missingPlainEnglish(game.ctx).filter((address) => address.startsWith(`${BASE}.`))).toEqual([]);
  });

  it('leaves saved Chronicle, frame and inherited Library wording intact across switching and reload', () => {
    const { game } = fixture();
    const w = game.ctx.world;
    w.chronicle.push({ year: 1199, weight: 'line', text: 'The words already written.', named: false });
    const frame = game.ctx.content.bundle.events.find((event) => event.tier === 'frame')!;
    if (frame.interaction.kind !== 'narration') throw new Error('fixture frame is no longer narration');
    w.frame.entries.push({
      year: 1199, eventId: frame.id, outcomeId: frame.interaction.outcomes[0]!.id,
      text: 'The frame words already heard.',
    });
    w.libraryMemories.push({
      id: 'library_fixture', sourceRun: 'earlier_run', sourceHouse: 'Earlier House',
      sourceYear: 1100, sourceText: 'The old book said this.', form: 'footnote',
      teller: 'The earlier chronicler', bias: 'protective', text: 'The inherited account.',
      about: 'library_fixture', since: 1200, mutations: 0, people: {}, sourceClaims: [], claims: [],
    });
    const original = game.view();
    const saved = JSON.parse(JSON.stringify(game.save()));

    game.setProseMode('plainenglish');
    const plain = game.view();
    expect(plain.tales.find((item) => item.id === TALE)?.text).toBe(PLAIN.text);
    expect(plain.tales.find((item) => item.id === 'library_fixture'))
      .toEqual(original.tales.find((item) => item.id === 'library_fixture'));
    expect(plain.chronicle).toEqual(original.chronicle);
    expect(plain.frame).toEqual(original.frame);
    expect(JSON.parse(JSON.stringify(game.save()))).toEqual({ ...saved, savedAt: expect.any(String) });

    const resumed = resumeGame(JSON.parse(JSON.stringify(saved)), game.ctx.content, { proseMode: 'plainenglish' });
    expect(resumed.view().tales).toEqual(plain.tales);
    expect(JSON.parse(JSON.stringify(resumed.save()))).toEqual({ ...saved, savedAt: expect.any(String) });
  });

  it('renders new Match panels and freezes the wording on a dealt hand across switching and reload', () => {
    const { game, tale } = fixture();
    const card = (): MatchCard => ({
      id: 'card_1', kind: 'outsider', name: 'Marra', sex: 'female', age: 20,
      house: 'house_marrow', houseName: 'Marrow', blurb: '', dowry: 0, kinship: 0,
      line: 'unknown', lineSeen: 0, words: '', papersAsked: 0, papersShown: 0,
      available: true, panel: emptyPanel(),
    });
    const census = { borne: new Map(), counted: new Set<string>(), byHouse: new Map(), mean: 0 };
    const before = card();
    readPanel(game.ctx, before, census);
    expect(before.panel.said).toEqual([{ tale: TALE, teller: tale.teller, bias: tale.bias, text: tale.text }]);

    game.setProseMode('plainenglish');
    const dealt = card();
    readPanel(game.ctx, dealt, census);
    expect(dealt.panel.said).toEqual([{ tale: TALE, ...PLAIN }]);
    const head = game.ctx.world.people.household(game.ctx.world.playerHouse, game.year)
      .find((person) => person.castSlots.includes('head'))!;
    queueMatch(game.ctx, { subject: { id: head.id, name: head.name, sex: head.sex, age: 40 }, cards: [dealt] });
    const promised = game.view().docket;
    game.setProseMode('original');
    expect(game.view().docket).toEqual(promised);
    const resumed = resumeGame(JSON.parse(JSON.stringify(game.save())), game.ctx.content);
    expect(resumed.view().docket).toEqual(promised);
    expect(dealt.panel.said[0]).not.toHaveProperty('accuracy');
  });
});
