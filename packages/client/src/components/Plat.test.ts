// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LandView } from '@ed/core';
import Plat from './Plat.vue';
import type { GameActions } from '../lib/game';

/**
 * THE PLAT RENDERS WHAT `LandView` HANDS IT (issue #96, Phase C).
 *
 * `land()` already has full coverage in `core/src/land.test.ts` — this file
 * is only about whether the component draws the four states correctly, and
 * in particular whether `contested` draws BOTH claims without adjudicating
 * between them, which is #96's own amended acceptance clause.
 */

function baseHeld(over: Partial<LandView['held'][number]> = {}): LandView['held'][number] {
  return {
    parcel: 'longmere', name: 'Longmere', place: 'below the mill', acres: 96,
    provenance: 'bought 1204 from Aldous Renn', heldSince: 1204,
    baseYield: 6, yieldBonus: 0, yieldFactor: 1, sellable: true, sellPrice: 72,
    improveCost: 72, canImprove: true, titleProved: true, caput: false,
    ...over,
  };
}

function mockLand(over: Partial<LandView> = {}): LandView {
  return {
    treasury: 500, rentsPolicy: 'customary', held: [baseHeld()], market: [], lost: [],
    ...over,
  };
}

function spyActions() {
  const actions = {} as Record<string, ReturnType<typeof vi.fn>>;
  for (const n of ['nameParcel']) actions[n] = vi.fn().mockReturnValue(true);
  return actions as unknown as GameActions;
}

describe('the plat draws each state', () => {
  it('a held parcel: solid, and its provenance is in the table', () => {
    const w = mount(Plat, { props: {
      land: mockLand(), houseName: 'The House of Gearithy', actions: spyActions(), close: () => {},
    } });
    expect(w.text()).toContain('Longmere');
    expect(w.text()).toContain('bought 1204 from Aldous Renn');
    expect(w.find('.plot').exists(), 'no cell drawn for the held parcel').toBe(true);
    expect(w.find('.plot.title_not_proved').exists()).toBe(false);
  });

  it('title not proved: dotted, and says so in words, not only in the stroke', () => {
    const w = mount(Plat, { props: {
      land: mockLand({ held: [baseHeld({ titleProved: false })] }),
      houseName: 'House', actions: spyActions(), close: () => {},
    } });
    expect(w.find('.plot.title_not_proved').exists()).toBe(true);
    expect(w.text()).toContain('title not proved');
    expect(w.text()).toMatch(/no notary's book behind it/);
  });

  /**
   * THE ONE THE RULING ADDED. Held AND claimed, at once, and the component
   * must not pick a side — no "the house is right" or "the claim is false"
   * anywhere in what it draws.
   */
  it('contested: drawn as held and as claimed by somebody else, and adjudicates neither', () => {
    const w = mount(Plat, { props: {
      land: mockLand({ held: [baseHeld({ contestedBy: 'the man from Bramme' })] }),
      houseName: 'House', actions: spyActions(), close: () => {},
    } });
    expect(w.find('.plot.contested').exists(), 'the house\'s own held cell').toBe(true);
    expect(w.find('.contested-overlay').exists(), 'the second, contesting claim').toBe(true);
    expect(w.text()).toContain('the man from Bramme');
    // The house's own facts are still shown — a contested parcel is not a hidden one.
    expect(w.text()).toContain('Longmere');
    const adjudicating = /\b(false|wrong|lying|the truth is|actually belongs)\b/i;
    expect(w.text()).not.toMatch(adjudicating);
  });

  it('lost: struck through, keeping its year and who let it go', () => {
    const w = mount(Plat, { props: {
      land: mockLand({
        held: [],
        lost: [{ defId: 'longmere', name: 'Longmere', place: 'below the mill', year: 1310, by: 'Aldous the Younger' }],
      }),
      houseName: 'House', actions: spyActions(), close: () => {},
    } });
    expect(w.find('.plot.lost').exists()).toBe(true);
    expect(w.find('.strike').exists(), 'no strikethrough drawn for a lost parcel').toBe(true);
    expect(w.text()).toContain('1310');
    expect(w.text()).toContain('Aldous the Younger');
  });

  it('nothing held or lost: says so, and draws no cell', () => {
    const w = mount(Plat, { props: {
      land: mockLand({ held: [], lost: [] }), houseName: 'House', actions: spyActions(), close: () => {},
    } });
    expect(w.find('svg').exists()).toBe(false);
    expect(w.text()).toContain('holds no ground at all');
  });
});

describe('naming a parcel from the plat', () => {
  it('renaming calls actions.nameParcel with the parcel and the new word', async () => {
    const actions = spyActions();
    const w = mount(Plat, { props: {
      land: mockLand(), houseName: 'House', actions, close: () => {},
    } });

    await w.find('button.rename').trigger('click');
    const input = w.find('input');
    expect(input.exists(), 'no input appeared to rename with').toBe(true);
    await input.setValue('Aldous’s Strip');
    await input.trigger('keyup.enter');

    expect(actions.nameParcel).toHaveBeenCalledWith('longmere', 'Aldous’s Strip');
  });

  it('does not call nameParcel when the name is unchanged', async () => {
    const actions = spyActions();
    const w = mount(Plat, { props: {
      land: mockLand(), houseName: 'House', actions, close: () => {},
    } });
    await w.find('button.rename').trigger('click');
    await w.find('input').trigger('keyup.enter');
    expect(actions.nameParcel).not.toHaveBeenCalled();
  });

  it('keeps a refused name visible, explains the refusal, and lets the player retry', async () => {
    const actions = spyActions();
    const nameParcel = vi.mocked(actions.nameParcel);
    nameParcel.mockReturnValue(false);
    const w = mount(Plat, { props: {
      land: mockLand(), houseName: 'House', actions, close: () => {},
    } });

    await w.find('button.rename').trigger('click');
    await w.find('input').setValue('The New Clearing');
    await w.find('input').trigger('keyup.enter');

    expect(nameParcel).toHaveBeenCalledWith('longmere', 'The New Clearing');
    expect(w.find('input').exists()).toBe(true);
    expect((w.find('input').element as HTMLInputElement).value).toBe('The New Clearing');
    expect(w.find('[role="alert"]').text()).toContain('could not be renamed');
    expect(w.find('input').attributes('aria-describedby')).toBe(w.find('[role="alert"]').attributes('id'));

    nameParcel.mockReturnValue(true);
    await w.find('input').setValue('The Old Clearing');
    await w.find('input').trigger('keyup.enter');

    expect(nameParcel).toHaveBeenCalledTimes(2);
    expect(nameParcel).toHaveBeenLastCalledWith('longmere', 'The Old Clearing');
    expect(w.find('input').exists()).toBe(false);
    expect(w.find('[role="alert"]').exists()).toBe(false);
  });

  it('keeps a blank draft visible with an accessible refusal on Enter and blur, then allows retry (#1079)', async () => {
    const actions = spyActions();
    const nameParcel = vi.mocked(actions.nameParcel);
    const w = mount(Plat, { props: {
      land: mockLand(), houseName: 'House', actions, close: () => {},
    } });

    await w.get('button.rename').trigger('click');
    const input = w.get('input');
    await input.setValue('   ');
    await input.trigger('keyup.enter');
    expect(nameParcel).not.toHaveBeenCalled();
    expect(w.find('input').exists()).toBe(true);
    expect((w.get('input').element as HTMLInputElement).value).toBe('   ');
    expect(w.get('[role="alert"]').text()).toContain('Enter a parcel name');
    expect(w.get('input').attributes('aria-invalid')).toBe('true');
    expect(w.get('input').attributes('aria-describedby')).toBe(w.get('[role="alert"]').attributes('id'));

    await input.trigger('blur');
    expect(nameParcel).not.toHaveBeenCalled();
    expect(w.find('input').exists()).toBe(true);
    expect(w.get('[role="alert"]').text()).toContain('Enter a parcel name');

    await input.setValue('  The New Meadow  ');
    expect(w.find('[role="alert"]').exists()).toBe(false);
    await input.trigger('keyup.enter');
    expect(nameParcel).toHaveBeenCalledTimes(1);
    expect(nameParcel).toHaveBeenCalledWith('longmere', 'The New Meadow');
    expect(w.find('input').exists()).toBe(false);
    w.unmount();
  });

  it('does not dispatch the same successful rename again when Enter and blur both fire', async () => {
    const actions = spyActions();
    const nameParcel = vi.mocked(actions.nameParcel);
    const w = mount(Plat, { props: {
      land: mockLand(), houseName: 'House', actions, close: () => {},
    } });

    await w.find('button.rename').trigger('click');
    const input = w.find('input');
    await input.setValue('A New Name');
    // Dispatch both before the Vue render removes the edit field.
    await Promise.all([input.trigger('keyup.enter'), input.trigger('blur')]);

    expect(nameParcel).toHaveBeenCalledTimes(1);
    expect(nameParcel).toHaveBeenCalledWith('longmere', 'A New Name');
    expect(w.find('input').exists()).toBe(false);
  });
});

/**
 * NEVER A FIFTH PANE (issue #96's own acceptance, per the ruling on #91/#102):
 * "a plat with its own tab has been promoted to scoreboard by the navigation
 * ... and never the scoreboard." `App.vue`'s `pane` stays the four-way union
 * it always was; this reads the SOURCE, the same way `verbs.test.ts` already
 * proves a verb reaches a template, because a type union is not a guard
 * against a literal string typed into a `v-if` three years from now.
 */
describe('the plat is reachable only from the Table pane', () => {
  const appSource = readFileSync(join(import.meta.dirname, '../App.vue'), 'utf8');

  it('App.vue never gates on a fifth pane value', () => {
    expect(appSource).toMatch(/'house' \| 'table' \| 'abroad' \| 'chronicle'/);
    expect(appSource).not.toMatch(/pane\s*(===|=)\s*['"]plat['"]/);
  });

  it('Plat is opened by its own flag, never by the pane switcher', () => {
    expect(appSource).toMatch(/platOpen/);
    expect(appSource).not.toMatch(/<Plat[^>]*v-if="[^"]*pane\s*===\s*['"]plat['"]/);
  });
});
