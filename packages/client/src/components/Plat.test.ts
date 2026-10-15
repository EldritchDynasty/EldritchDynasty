// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { loadContent } from '@ed/content';
import { landView, tableView, testWorld } from '@ed/core';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LandView, SessionView } from '@ed/core';
import Plat from './Plat.vue';
import Table from './Table.vue';
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
  actions.order = vi.fn().mockReturnValue({ ok: true });
  return actions as unknown as GameActions;
}

describe('land holder and gift reader vocabulary (#1660)', () => {
  it('switches the holder description without turning a loan to a hall into ownership', async () => {
    const land = mockLand({ held: [baseHeld({
      holder: 'cadet_a', holderName: 'Younger Hall', sellable: false,
    })] });
    const snapshot = structuredClone(land);
    const w = mount(Plat, { props: {
      land, houseName: 'House', halls: [], actions: spyActions(), close: () => {},
      proseMode: 'original',
    } });
    try {
      expect(w.text()).toContain('Held by Younger Hall.');
      await w.setProps({ proseMode: 'plainenglish' });
      expect(w.text()).toContain('Currently held by Younger Hall.');
      expect(land).toEqual(snapshot);
      await w.setProps({ proseMode: 'original' });
      expect(w.text()).toContain('Held by Younger Hall.');
    } finally {
      w.unmount();
    }
  });

  it('names the receiving family household without losing a selected gift target or changing the order', async () => {
    const land = mockLand();
    const snapshot = structuredClone(land);
    const halls = [
      { id: 'main', name: 'Main Hall', isSeat: true, grievance: 0, members: [] },
      { id: 'cadet_a', name: 'Younger Hall', isSeat: false, grievance: 0, members: [{}] },
    ] as unknown as SessionView['halls'];
    const actions = spyActions();
    const w = mount(Plat, { props: {
      land, houseName: 'House', halls, actions, close: () => {}, proseMode: 'original',
    } });
    try {
      expect(w.get('select').attributes('aria-label')).toBe('Hall to receive Longmere');
      await w.get('select').setValue('cadet_a');
      await w.setProps({ proseMode: 'plainenglish' });
      expect(w.get('select').attributes('aria-label')).toBe('Family household to receive Longmere');
      expect((w.get('select').element as HTMLSelectElement).value).toBe('cadet_a');
      expect(w.get('button.endow').text()).toBe('Give land');
      await w.get('button.endow').trigger('click');
      expect(actions.order).toHaveBeenCalledWith({
        kind: 'endow', parcel: 'longmere', branch: 'cadet_a',
      });
      expect(land).toEqual(snapshot);
      await w.setProps({ proseMode: 'original' });
      expect(w.get('select').attributes('aria-label')).toBe('Hall to receive Longmere');
    } finally {
      w.unmount();
    }
  });
});

describe('the plat draws each state', () => {
  it.each([0, 0.5, 1, 2])('makes %s acres available outside the SVG without inventing lost acreage (#1726)', async (acres) => {
    const land = mockLand({
      held: [baseHeld({ acres, contestedBy: 'House Rival' })],
      lost: [{ defId: 'oldfield', name: 'Oldfield', place: 'below the gate', year: 1310, by: 'Mara' }],
    });
    const snapshot = structuredClone(land);
    const w = mount(Plat, { props: {
      land, houseName: 'House', halls: [], actions: spyActions(), close: () => {}, proseMode: 'original',
    } });
    try {
      const expected = `${acres} ${acres === 1 ? 'acre' : 'acres'}`;
      const acreage = () => w.findAll('tbody tr').map((row) => row.get('[data-acreage]').text());
      expect(w.get('th[data-acreage]').text()).toBe('Acreage');
      expect(acreage()).toEqual([expected, 'Not recorded']);
      expect(w.get('.cell-acres').text()).toBe(expected);
      await w.get('button.rename').trigger('click');
      await w.get('input').setValue('My draft name');
      await w.setProps({ proseMode: 'plainenglish' });
      expect(w.get('th[data-acreage]').text()).toBe('Area');
      expect(acreage()).toEqual([expected, 'Not recorded']);
      expect((w.get('input').element as HTMLInputElement).value).toBe('My draft name');
      expect(w.text()).toContain('House Rival');
      expect(w.text()).toContain('Lost in 1310. Mara gave it up.');
      await w.setProps({ proseMode: 'original' });
      expect(acreage()).toEqual([expected, 'Not recorded']);
      expect((w.get('input').element as HTMLInputElement).value).toBe('My draft name');
      expect(land).toEqual(snapshot);
    } finally { w.unmount(); }
  });

  it('uses a singular parcel in the accessible drawing summary (#1726)', async () => {
    const w = mount(Plat, { props: {
      land: mockLand(), houseName: 'House', halls: [], actions: spyActions(), close: () => {},
    } });
    try {
      expect(w.get('svg').attributes('aria-label')).toMatch(/^1 parcel drawn:/);
      await w.setProps({ proseMode: 'plainenglish' });
      expect(w.get('svg').attributes('aria-label')).toMatch(/^1 parcel:/);
    } finally { w.unmount(); }
  });

  it('shows Plain English descriptions without changing land facts or recorded provenance (#410)', async () => {
    const land = mockLand({
      held: [
        baseHeld({ titleProved: false }),
        baseHeld({ parcel: 'westmere', name: 'Westmere', contestedBy: 'the man from Bramme' }),
        baseHeld({ parcel: 'southfield', name: 'Southfield' }),
      ],
      lost: [{ defId: 'oldfield', name: 'Oldfield', place: 'below the gate', year: 1310, by: 'Mara' }],
    });
    const saved = structuredClone(land);
    const w = mount(Plat, { props: {
      land, houseName: 'The House of Gearithy', halls: [], actions: spyActions(), close: () => {},
      proseMode: 'original',
    } });
    try {
      expect(w.get('[role="dialog"]').attributes('aria-label')).toBe("the plat of the house's ground");
      expect(w.text()).toContain('The plat');
      expect(w.text()).toContain('title not proved');
      expect(w.text()).toContain("no notary's book behind it");
      expect(w.text()).toContain('and claimed at the same time by the man from Bramme');
      expect(w.text()).toContain('Lost in 1310, let go by Mara');
      expect(w.text()).toContain('bought 1204 from Aldous Renn');

      await w.setProps({ proseMode: 'plainenglish' });
      expect(w.get('[role="dialog"]').attributes('aria-label')).toBe('Land held or lost by the house');
      expect(w.text()).toContain('Land records');
      expect(w.text()).toContain('Each box represents one parcel, not its actual size.');
      expect(w.text()).toContain('ownership not proved');
      expect(w.text()).toContain('claimed by two sides');
      expect(w.text()).toContain('no official record proving the title');
      expect(w.text()).toContain('but the man from Bramme also claims it');
      expect(w.text()).toContain('Lost in 1310. Mara gave it up.');
      expect(w.text()).toContain('bought 1204 from Aldous Renn');
      expect(w.get('th:nth-child(4)').text()).toBe('Details');
      expect(land).toEqual(saved);

      await w.setProps({ proseMode: 'original' });
      expect(w.text()).toContain('A record, drawn to scale of nothing but itself.');
      expect(w.text()).toContain('title not proved');
      expect(w.text()).toContain('Lost in 1310, let go by Mara');
      expect(land).toEqual(saved);
    } finally {
      w.unmount();
    }
  });

  it('switches land-transfer controls without altering their order or selected hall (#410)', async () => {
    const actions = spyActions();
    const halls = [
      { id: 'main', name: 'Main Hall', isSeat: true, grievance: 0, members: [] },
      { id: 'cadet_a', name: 'Younger Hall', isSeat: false, grievance: 0, members: [{}] },
    ] as unknown as SessionView['halls'];
    const w = mount(Plat, { props: {
      land: mockLand(), houseName: 'House', halls, actions, close: () => {},
      proseMode: 'plainenglish',
    } });
    try {
      expect(w.get('button.endow').text()).toBe('Give land');
      expect(w.get('select option').text()).toBe('Choose a family hall');
      await w.get('select').setValue('cadet_a');
      await w.setProps({ proseMode: 'original' });
      expect(w.get('button.endow').text()).toBe('Endow');
      expect((w.get('select').element as HTMLSelectElement).value).toBe('cadet_a');
      await w.get('button.endow').trigger('click');
      expect(actions.order).toHaveBeenCalledTimes(1);
      expect(actions.order).toHaveBeenCalledWith({
        kind: 'endow', parcel: 'longmere', branch: 'cadet_a',
      });
    } finally {
      w.unmount();
    }
  });

  it('a held parcel: solid, and its provenance is in the table', () => {
    const w = mount(Plat, { props: {
      land: mockLand(), houseName: 'The House of Gearithy', halls: [], actions: spyActions(), close: () => {},
    } });
    expect(w.text()).toContain('Longmere');
    expect(w.text()).toContain('bought 1204 from Aldous Renn');
    expect(w.find('.plot').exists(), 'no cell drawn for the held parcel').toBe(true);
    expect(w.find('.plot.title_not_proved').exists()).toBe(false);
  });

  it('title not proved: dotted, and says so in words, not only in the stroke', () => {
    const w = mount(Plat, { props: {
      land: mockLand({ held: [baseHeld({ titleProved: false })] }),
      houseName: 'House', halls: [], actions: spyActions(), close: () => {},
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
      houseName: 'House', halls: [], actions: spyActions(), close: () => {},
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
      houseName: 'House', halls: [], actions: spyActions(), close: () => {},
    } });
    expect(w.find('.plot.lost').exists()).toBe(true);
    expect(w.find('.strike').exists(), 'no strikethrough drawn for a lost parcel').toBe(true);
    expect(w.text()).toContain('1310');
    expect(w.text()).toContain('Aldous the Younger');
  });

  it('nothing held or lost: says so, and draws no cell', () => {
    const w = mount(Plat, { props: {
      land: mockLand({ held: [], lost: [] }), houseName: 'House', halls: [], actions: spyActions(), close: () => {},
    } });
    expect(w.find('svg').exists()).toBe(false);
    expect(w.text()).toContain('holds no ground at all');
  });
});

describe('naming a parcel from the plat', () => {
  it('does not rename while an IME candidate is confirmed with Enter (#1294)', async () => {
    const actions = spyActions();
    const nameParcel = vi.mocked(actions.nameParcel);
    const w = mount(Plat, { props: {
      land: mockLand(), houseName: 'House', halls: [], actions, close: () => {},
    } });

    try {
      await w.get('button.rename').trigger('click');
      const input = w.get('input');
      await input.setValue('林地');
      await input.trigger('compositionstart');
      await input.trigger('keydown', { key: 'Enter', isComposing: true });
      await input.trigger('compositionend');
      // The key release happens after composition ends, and cannot submit.
      await input.trigger('keyup', { key: 'Enter' });

      expect(nameParcel).not.toHaveBeenCalled();
      expect(w.find('input').exists()).toBe(true);
      expect((w.get('input').element as HTMLInputElement).value).toBe('林地');

      // Legacy IME process key, even if isComposing was already reset.
      await input.trigger('keydown', { key: 'Enter', isComposing: false, keyCode: 229 });
      expect(nameParcel).not.toHaveBeenCalled();

      await input.trigger('keydown', { key: 'Enter', isComposing: false });
      expect(nameParcel).toHaveBeenCalledTimes(1);
      expect(nameParcel).toHaveBeenCalledWith('longmere', '林地');
      expect(w.find('input').exists()).toBe(false);
    } finally {
      w.unmount();
    }
  });

  it('renaming calls actions.nameParcel with the parcel and the new word', async () => {
    const actions = spyActions();
    const w = mount(Plat, { props: {
      land: mockLand(), houseName: 'House', halls: [], actions, close: () => {},
    } });

    await w.find('button.rename').trigger('click');
    const input = w.find('input');
    expect(input.exists(), 'no input appeared to rename with').toBe(true);
    await input.setValue('Aldous’s Strip');
    await input.trigger('keydown.enter');

    expect(actions.nameParcel).toHaveBeenCalledWith('longmere', 'Aldous’s Strip');
  });

  it('does not call nameParcel when the name is unchanged', async () => {
    const actions = spyActions();
    const w = mount(Plat, { props: {
      land: mockLand(), houseName: 'House', halls: [], actions, close: () => {},
    } });
    await w.find('button.rename').trigger('click');
    await w.find('input').trigger('keydown.enter');
    expect(actions.nameParcel).not.toHaveBeenCalled();
  });

  it('keeps a refused name visible, explains the refusal, and lets the player retry', async () => {
    const actions = spyActions();
    const nameParcel = vi.mocked(actions.nameParcel);
    nameParcel.mockReturnValue(false);
    const w = mount(Plat, { props: {
      land: mockLand(), houseName: 'House', halls: [], actions, close: () => {},
    } });

    await w.find('button.rename').trigger('click');
    await w.find('input').setValue('The New Clearing');
    await w.find('input').trigger('keydown.enter');

    expect(nameParcel).toHaveBeenCalledWith('longmere', 'The New Clearing');
    expect(w.find('input').exists()).toBe(true);
    expect((w.find('input').element as HTMLInputElement).value).toBe('The New Clearing');
    expect(w.find('[role="alert"]').text()).toContain('could not be renamed');
    expect(w.find('input').attributes('aria-describedby')).toBe(w.find('[role="alert"]').attributes('id'));

    nameParcel.mockReturnValue(true);
    await w.find('input').setValue('The Old Clearing');
    await w.find('input').trigger('keydown.enter');

    expect(nameParcel).toHaveBeenCalledTimes(2);
    expect(nameParcel).toHaveBeenLastCalledWith('longmere', 'The Old Clearing');
    expect(w.find('input').exists()).toBe(false);
    expect(w.find('[role="alert"]').exists()).toBe(false);
  });

  it('keeps a blank draft visible with an accessible refusal on Enter and blur, then allows retry (#1079)', async () => {
    const actions = spyActions();
    const nameParcel = vi.mocked(actions.nameParcel);
    const w = mount(Plat, { props: {
      land: mockLand(), houseName: 'House', halls: [], actions, close: () => {},
    } });

    await w.get('button.rename').trigger('click');
    const input = w.get('input');
    await input.setValue('   ');
    await input.trigger('keydown.enter');
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
    await input.trigger('keydown.enter');
    expect(nameParcel).toHaveBeenCalledTimes(1);
    expect(nameParcel).toHaveBeenCalledWith('longmere', 'The New Meadow');
    expect(w.find('input').exists()).toBe(false);
    w.unmount();
  });

  it('does not dispatch the same successful rename again when Enter and blur both fire', async () => {
    const actions = spyActions();
    const nameParcel = vi.mocked(actions.nameParcel);
    const w = mount(Plat, { props: {
      land: mockLand(), houseName: 'House', halls: [], actions, close: () => {},
    } });

    await w.find('button.rename').trigger('click');
    const input = w.find('input');
    await input.setValue('A New Name');
    // Dispatch both before the Vue render removes the edit field.
    await Promise.all([input.trigger('keydown.enter'), input.trigger('blur')]);

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

  it('passes the active reading preference to the Plat modal (#410)', () => {
    expect(appSource).toMatch(/<Plat\b[^>]*:prose-mode="accessibility.proseMode"/);
  });

  it('Plat is opened by its own flag, never by the pane switcher', () => {
    expect(appSource).toMatch(/platOpen/);
    expect(appSource).not.toMatch(/<Plat[^>]*v-if="[^"]*pane\s*===\s*['"]plat['"]/);
  });
});

describe('deferred modal focus restoration (#1323)', () => {
  it('does not steal focus back when a second dialog remains open', () => {
    const previous = document.createElement('button');
    previous.textContent = 'The preceding board control';
    document.body.appendChild(previous);
    previous.focus();

    const callbacks: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      callbacks.push(cb);
      return callbacks.length;
    });

    const props = () => ({
      land: mockLand(), houseName: 'House', halls: [], actions: spyActions(), close: () => {},
    });
    const first = mount(Plat, { attachTo: document.body, props: props() });
    const second = mount(Plat, { attachTo: document.body, props: props() });
    let firstUnmounted = false;

    try {
      const successorFocus = document.activeElement;
      expect(second.element.contains(successorFocus)).toBe(true);

      first.unmount();
      firstUnmounted = true;
      expect(callbacks).toHaveLength(1);
      callbacks.shift()!(0);

      // The old dialog's remembered control was outside the successor.
      // Its delayed restore must not override the new dialog's Tab target.
      expect(document.activeElement).toBe(successorFocus);
      expect(second.element.contains(document.activeElement)).toBe(true);
    } finally {
      if (!firstUnmounted) first.unmount();
      second.unmount();
      while (callbacks.length) callbacks.shift()!(0);
      previous.remove();
      vi.unstubAllGlobals();
    }
  });
});

describe('land gifts are playable from the Plat (#1219)', () => {
  function halls(): SessionView['halls'] {
    return [
      { id: 'main', name: 'Main Hall', isSeat: true, grievance: 0, members: [] },
      { id: 'cadet_a', name: 'Younger Hall', isSeat: false, grievance: 21, members: [{} as SessionView['halls'][number]['members'][number]] },
    ];
  }

  function open(over: Partial<LandView['held'][number]> = {}) {
    const actions = spyActions();
    const w = mount(Plat, { props: {
      land: mockLand({ held: [baseHeld(over)] }), halls: halls(),
      houseName: 'House', actions, close: () => {},
    } });
    return { w, actions };
  }

  it('lets two independent parcels be given in one render, while guarding each duplicate (#1611)', async () => {
    const actions = spyActions();
    const land = mockLand({ held: [
      baseHeld({ parcel: 'longmere', name: 'Longmere' }),
      baseHeld({ parcel: 'westmere', name: 'Westmere' }),
    ] });
    const w = mount(Plat, { props: {
      land, halls: halls(), houseName: 'House', actions, close: () => {},
    } });
    try {
      const selects = w.findAll('select');
      expect(selects).toHaveLength(2);
      await selects[0]!.setValue('cadet_a');
      await selects[1]!.setValue('cadet_a');
      const buttons = w.findAll('button.endow');
      expect(buttons).toHaveLength(2);
      const first = buttons[0]!.element as HTMLButtonElement;
      const second = buttons[1]!.element as HTMLButtonElement;
      first.click();
      first.click(); // Same parcel, same render: never send a duplicate.
      second.click(); // Another parcel is independent, not silently dropped.
      second.click();
      const order = vi.mocked(actions.order);
      expect(order).toHaveBeenCalledTimes(2);
      expect(order).toHaveBeenNthCalledWith(1, {
        kind: 'endow', parcel: 'longmere', branch: 'cadet_a',
      });
      expect(order).toHaveBeenNthCalledWith(2, {
        kind: 'endow', parcel: 'westmere', branch: 'cadet_a',
      });
      await w.vm.$nextTick();
      first.click(); // Both latches release at the render boundary.
      expect(order).toHaveBeenCalledTimes(3);
      expect(order).toHaveBeenLastCalledWith({
        kind: 'endow', parcel: 'longmere', branch: 'cadet_a',
      });
    } finally {
      w.unmount();
    }
  });

  it('a refusal for one parcel does not block another parcel or its own later retry (#1611)', async () => {
    const actions = spyActions();
    const order = vi.mocked(actions.order);
    order.mockReturnValueOnce({ ok: false, reason: 'The household refused' })
      .mockReturnValue({ ok: true });
    const w = mount(Plat, { props: {
      land: mockLand({ held: [
        baseHeld({ parcel: 'longmere' }),
        baseHeld({ parcel: 'westmere', name: 'Westmere' }),
      ] }),
      halls: halls(), houseName: 'House', actions, close: () => {},
    } });
    try {
      const selects = w.findAll('select');
      await selects[0]!.setValue('cadet_a');
      await selects[1]!.setValue('cadet_a');
      const buttons = w.findAll('button.endow');
      const first = buttons[0]!.element as HTMLButtonElement;
      const second = buttons[1]!.element as HTMLButtonElement;
      first.click(); // Refused by the simulation.
      second.click(); // A different parcel must still be submitted.
      expect(order).toHaveBeenCalledTimes(2);
      expect(order).toHaveBeenNthCalledWith(2, {
        kind: 'endow', parcel: 'westmere', branch: 'cadet_a',
      });
      await w.vm.$nextTick();
      first.click(); // The rejected parcel is retryable after repaint.
      expect(order).toHaveBeenCalledTimes(3);
      expect(order).toHaveBeenLastCalledWith({
        kind: 'endow', parcel: 'longmere', branch: 'cadet_a',
      });
    } finally {
      w.unmount();
    }
  });

  it('offers a living cadet rather than the seat and requires a selected hall', async () => {
    const { w, actions } = open();
    expect(w.get('button.endow').attributes('disabled')).toBeDefined();
    expect(w.findAll('option').map((o) => o.text())).toEqual(['Choose a hall', 'Younger Hall']);
    await w.get('select').setValue('cadet_a');
    await w.get('button.endow').trigger('click');
    expect(actions.order).toHaveBeenCalledTimes(1);
    expect(actions.order).toHaveBeenCalledWith({ kind: 'endow', parcel: 'longmere', branch: 'cadet_a' });
    w.unmount();
  });

  it('shows the recipient and recalls a gift before another hall can receive it', async () => {
    const { w, actions } = open({ holder: 'cadet_a', holderName: 'Younger Hall', sellable: false });
    expect(w.text()).toContain('Held by Younger Hall');
    expect(w.find('select').exists()).toBe(false);
    expect(w.find('button.endow').exists()).toBe(false);
    await w.get('button.recall-land').trigger('click');
    expect(actions.order).toHaveBeenCalledWith({ kind: 'endow', parcel: 'longmere', branch: null });
    w.unmount();
  });

  it('blocks a duplicate Endow click against the same visible land state (#1557)', async () => {
    const { w, actions } = open();
    const order = vi.mocked(actions.order);
    // Without the guard, the duplicate rejection would overwrite a successful gift.
    order.mockReturnValueOnce({ ok: true })
      .mockReturnValueOnce({ ok: false, reason: 'The land has already been given' });
    try {
      await w.get('select').setValue('cadet_a');
      const button = w.get('button.endow').element as HTMLButtonElement;
      button.click();
      button.click();
      expect(order.mock.calls).toEqual([[{ kind: 'endow', parcel: 'longmere', branch: 'cadet_a' }]]);
      await w.vm.$nextTick();
      expect(w.find('[role="alert"]').exists()).toBe(false);
    } finally {
      w.unmount();
    }
  });

  it('blocks duplicate Recall until the next render, then permits another deliberate action (#1557)', async () => {
    const { w, actions } = open({ holder: 'cadet_a', holderName: 'Younger Hall', sellable: false });
    const order = vi.mocked(actions.order);
    try {
      const button = w.get('button.recall-land').element as HTMLButtonElement;
      button.click();
      button.click();
      expect(order.mock.calls).toEqual([[{ kind: 'endow', parcel: 'longmere', branch: null }]]);

      await w.vm.$nextTick();
      button.click();
      expect(order.mock.calls).toEqual([
        [{ kind: 'endow', parcel: 'longmere', branch: null }],
        [{ kind: 'endow', parcel: 'longmere', branch: null }],
      ]);
    } finally {
      w.unmount();
    }
  });

  it('offers neither the caput nor a parcel with no living cadet halls', () => {
    const { w } = open({ caput: true });
    expect(w.find('button.endow').exists()).toBe(false);
    w.unmount();
    const empty = mount(Plat, { props: {
      land: mockLand(), halls: [], houseName: 'House', actions: spyActions(), close: () => {},
    } });
    expect(empty.find('button.endow').exists()).toBe(false);
    empty.unmount();
  });

  it('preserves the chosen hall and an order refusal until retry succeeds', async () => {
    const { w, actions } = open();
    const order = vi.mocked(actions.order);
    order.mockReturnValueOnce({ ok: false, reason: 'The hall refused this gift' }).mockReturnValue({ ok: true });
    await w.get('select').setValue('cadet_a');
    await w.get('button.endow').trigger('click');
    expect(w.get('[role="alert"]').text()).toContain('The hall refused this gift');
    expect((w.get('select').element as HTMLSelectElement).value).toBe('cadet_a');
    await w.get('button.endow').trigger('click');
    expect(order).toHaveBeenCalledTimes(2);
    expect(w.find('[role="alert"]').exists()).toBe(false);
    w.unmount();
  });
});

describe('stacked modal keyboard handling (#1346)', () => {
  function open(close: () => void) {
    return mount(Plat, {
      attachTo: document.body,
      props: { land: mockLand(), houseName: 'House', halls: [], actions: spyActions(), close },
    });
  }

  it('Escape closes only the top dialog, then the uncovered dialog', () => {
    const closeFirst = vi.fn();
    const closeSecond = vi.fn();
    const first = open(closeFirst);
    const second = open(closeSecond);
    let secondMounted = true;
    try {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(closeSecond).toHaveBeenCalledTimes(1);
      expect(closeFirst).not.toHaveBeenCalled();

      second.unmount();
      secondMounted = false;
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(closeFirst).toHaveBeenCalledTimes(1);
      expect(closeSecond).toHaveBeenCalledTimes(1);
    } finally {
      if (secondMounted) second.unmount();
      first.unmount();
    }
  });

  it('Tab does not move focus into a covered dialog', () => {
    const first = open(vi.fn());
    const second = open(vi.fn());
    try {
      const background = first.get('button').element as HTMLButtonElement;
      const foreground = second.get('button').element as HTMLButtonElement;
      const focusBehind = vi.spyOn(background, 'focus');
      foreground.focus();

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
      expect(focusBehind).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(foreground);
    } finally {
      second.unmount();
      first.unmount();
      vi.restoreAllMocks();
    }
  });
});

/** The Table contains this Plat; put the mounted shelf integration cases
 * beside its other real-Table UI witnesses to preserve the measured fast lane. */
const content = loadContent();
const bookId = 'lesser_workings_of_fluid';

function mountedShelf(condition: number, options: { treasury?: number; restoresAt?: number } = {}) {
  const ctx = testWorld(content, 1293);
  const copy = { id: bookId, acquiredYear: ctx.world.year, condition, ...options.restoresAt === undefined
    ? {} : { restoresAt: options.restoresAt } };
  ctx.world.library.set(bookId, copy);
  ctx.world.treasury = options.treasury ?? 500;
  const action = vi.fn().mockReturnValue({ ok: true });
  const wrapper = mount(Table, {
    props: {
      table: tableView(ctx),
      land: landView(ctx),
      actions: { order: action } as unknown as GameActions,
      refusal: null,
      receipt: null,
    },
  });
  const shelf = wrapper.findAll('.panel').find((p) => p.find('h3 .fold').exists() && p.find('h3 .fold').text() === 'The shelf');
  if (!shelf) throw new Error('Shelf panel not rendered');
  return { wrapper, shelf, action, ctx };
}

describe('mounted shelf binder controls (#1293)', () => {
  it('shows the selected reader duration without calculating study rules in the client', async () => {
    const { wrapper, shelf, ctx } = mountedShelf(40);
    try {
      const table = tableView(ctx);
      const book = table.shelf.find((book) => book.book === bookId)!;
      book.years = 4;
      book.readers = [{ person: 'reader', name: 'Ada', years: 1 }];
      await wrapper.setProps({ table });
      const row = shelf.findAll('.line').find((row) => row.find('strong').text() === book.name)!;
      expect(row.find('.small').text()).toContain('4 years');
      await row.get('select').setValue('reader');
      expect(row.find('.small').text()).toContain('1 year ·');
      book.readers = [];
      book.restoringUntil = ctx.world.year + 2;
      delete book.restore;
      await wrapper.setProps({ table: { ...table, shelf: [...table.shelf] } });
      expect((row.get('select').element as HTMLSelectElement).value).toBe('');
      expect(row.get('select').text()).toContain('with the binder');
      expect(row.findAll('button').find((button) => button.text() === 'Set them reading')!.attributes('disabled')).toBeDefined();
    } finally { wrapper.unmount(); }
  });

  it('displays damaged condition, the real quote, and sends the restore order', async () => {
    const { shelf, action, ctx } = mountedShelf(40);
    const quote = tableView(ctx).shelf.find((b) => b.book === bookId)!.restore!;
    expect(shelf.text()).toContain('40%');
    expect(shelf.text()).toContain('frayed');
    const restore = shelf.findAll('button').find((b) => b.text().startsWith('Restore'));
    expect(restore).toBeDefined();
    expect(restore!.text()).toContain(`${quote.fee} crowns, ${quote.years} years`);
    expect(restore!.attributes('disabled')).toBeUndefined();
    await restore!.trigger('click');
    expect(action).toHaveBeenCalledWith({ kind: 'restore', book: bookId });
  });

  it('disables unaffordable work and shows a reason at the control', () => {
    const { shelf, action } = mountedShelf(40, { treasury: -100000 });
    const restore = shelf.findAll('button').find((b) => b.text().startsWith('Restore'));
    expect(restore).toBeDefined();
    expect(restore!.attributes('disabled')).toBeDefined();
    expect(shelf.text()).toContain('cannot raise');
    expect(action).not.toHaveBeenCalled();
  });

  it('shows the binder return year and does not offer another order', () => {
    const { shelf } = mountedShelf(40, { restoresAt: 1250 });
    expect(shelf.text()).toContain('With the binder until 1250');
    expect(shelf.findAll('button').some((b) => b.text().startsWith('Restore'))).toBe(false);
  });
});

describe('same-render auction order guard (#1551)', () => {
  it('does not submit a conflicting coin bid and heirloom trade before the lot view updates', async () => {
    const { wrapper, action, ctx } = mountedShelf(40);
    try {
      const table = tableView(ctx);
      table.auction = {
        year: 1299, lots: 1, lowestReserve: 70,
        heirlooms: [{ id: 'ring', name: 'The Family Ring' }],
        items: [{
          id: 'lot-a', kind: 'spellbook', name: 'The Codex',
          seller: 'House Marrow', saleYear: 1299, reserve: 70,
        }],
      };
      await wrapper.setProps({ table });
      await wrapper.get('input[aria-label="Bid in crowns for The Codex"]').setValue('120');
      await wrapper.get('select[aria-label="Heirloom to trade for The Codex"]').setValue('ring');
      const coin = wrapper.findAll('button').find((b) => b.text() === 'Bid crowns')!;
      const trade = wrapper.findAll('button').find((b) => b.text() === 'Trade it')!;
      await Promise.all([coin.trigger('click'), trade.trigger('click')]);
      expect(action).toHaveBeenCalledTimes(1);
      expect(action).toHaveBeenCalledWith({
        kind: 'lotBid', lot: 'lot-a', bid: { currency: 'coin', amount: 120 },
      });

      // A fresh render restores controls even if the previous order was refused.
      await trade.trigger('click');
      expect(action).toHaveBeenCalledTimes(2);
      expect(action).toHaveBeenLastCalledWith({
        kind: 'lotBid', lot: 'lot-a', bid: { currency: 'heirloom', heirloom: 'ring' },
      });
    } finally { wrapper.unmount(); }
  });

  it('does not race a standing bid withdrawal against a ceiling change', async () => {
    const { wrapper, action, ctx } = mountedShelf(40);
    try {
      const table = tableView(ctx);
      table.auction = {
        year: 1299, lots: 1, lowestReserve: 70, heirlooms: [],
        items: [{
          id: 'lot-b', kind: 'chronicle_page', name: 'The Witness Page',
          seller: 'House Marrow', saleYear: 1299, reserve: 70,
          bid: { currency: 'coin', amount: 75 },
        }],
      };
      await wrapper.setProps({ table });
      await wrapper.get('input[aria-label="Maximum auction bid in crowns"]').setValue('110');
      const withdraw = wrapper.findAll('button').find((b) => b.text() === 'Withdraw')!;
      const ceiling = wrapper.findAll('button').find((b) => b.text() === 'Set the ceiling')!;
      await Promise.all([withdraw.trigger('click'), ceiling.trigger('click')]);
      expect(action).toHaveBeenCalledTimes(1);
      expect(action).toHaveBeenCalledWith({ kind: 'lotBid', lot: 'lot-b', bid: null });
      await ceiling.trigger('click');
      expect(action).toHaveBeenCalledTimes(2);
      expect(action).toHaveBeenLastCalledWith({ kind: 'bid', ceiling: 110 });
    } finally { wrapper.unmount(); }
  });
});

describe('reader-local Table guidance (#1441)', () => {
  it('switches Original → Plain English → Original without changing data, enabled states or orders', async () => {
    const { wrapper, action, ctx } = mountedShelf(40);
    try {
      // Make the baseline independent of seeded auction and broker availability.
      const table = tableView(ctx);
      table.bidCeiling = 0;
      delete table.auction;
      table.missingPrimers = [{
        book: 'unowned-primer', name: 'The Missing Primer', affinity: 'life',
        fee: 25, reserve: 42, saleYear: 1299, queued: false, canPay: true,
      }];
      await wrapper.setProps({ table });
      const original = wrapper.text();
      const disabled = wrapper.findAll('button').map((b) => b.attributes('disabled') !== undefined);
      expect(original).toContain('A two-rite elder can be unmade');
      expect(original).toContain('Three generations of maternal record, notarised.');
      expect(original).toContain('When nobody asks you.');
      expect(original).toContain('The house has not said what it will spend');
      expect(original).toContain(String(tableView(ctx).tutorFee));

      await wrapper.setProps({ proseMode: 'plainenglish' });
      const translated = wrapper.text();
      expect(translated).toContain('An elder who has completed two rites can be sacrificed');
      expect(translated).toContain('all eight affinities');
      expect(translated).toContain('notarised records for three generations through the mother');
      expect(translated).toContain('Marrying outside the family loses the bloodline');
      expect(translated).toContain('No maximum bid has been set.');
      expect(translated).toContain('25 crowns now');
      expect(translated).toContain('No auction has been announced yet.');
      expect(translated).toContain(String(tableView(ctx).tutorFee));
      expect(translated).not.toContain('When nobody asks you.');
      expect(wrapper.findAll('button').map((b) => b.attributes('disabled') !== undefined)).toEqual(disabled);

      const marryPlain = wrapper.findAll('button').find((b) => b.text() === 'Marry outside the family');
      expect(marryPlain).toBeDefined();
      await marryPlain!.trigger('click');
      expect(action).toHaveBeenLastCalledWith({ kind: 'marriages', policy: 'out' });

      await wrapper.setProps({ proseMode: 'original' });
      expect(wrapper.text()).toBe(original);
      expect(wrapper.findAll('button').map((b) => b.attributes('disabled') !== undefined)).toEqual(disabled);
      const marryOriginal = wrapper.findAll('button').find((b) => b.text() === 'Marry outward');
      expect(marryOriginal).toBeDefined();
      await marryOriginal!.trigger('click');
      expect(action).toHaveBeenLastCalledWith({ kind: 'marriages', policy: 'out' });
      expect(action).toHaveBeenCalledTimes(2);
    } finally {
      wrapper.unmount();
    }
  });

  it('retains wardship dates and auction page disclosures, and submits the same buyback order', async () => {
    const { wrapper, ctx, action } = mountedShelf(40);
    try {
      const table = tableView(ctx);
      table.wardship = { ward: 'ward-1', wardName: 'Mara', since: 1222, boughtBack: false, buyBackCost: 63 };
      table.bidCeiling = 110;
      table.auction = {
        year: 1299, lots: 1, lowestReserve: 70, heirlooms: [],
        items: [{
          id: 'page-1', kind: 'chronicle_page', name: 'The Witness Page',
          seller: 'A Bramme seller', saleYear: 1299, reserve: 70,
          bid: { currency: 'coin', amount: 75 },
        }],
      };
      await wrapper.setProps({ table });
      expect(wrapper.text()).toContain('Mara is under age, and since 1222 the Warden has taken the harvest.');
      expect(wrapper.text()).toContain('Whoever buys this page reads it.');
      expect(wrapper.text()).toContain('The house will go to 110 at the next sale.');
      const original = wrapper.findAll('button').find((b) => b.text().includes('Buy the wardship back'))!;
      expect(original.text()).toContain('63 crowns');
      await wrapper.setProps({ proseMode: 'plainenglish' });
      const plain = wrapper.text();
      expect(plain).toContain('Mara is a minor. Since 1222 the Warden has received the harvest income.');
      expect(plain).toContain('The buyer can read this Chronicle page.');
      expect(plain).toContain('The house will bid up to 110 crowns at the next auction.');
      expect(plain).toContain('1299');
      expect(plain).toContain('70');
      expect(plain).toContain('75 crowns');
      expect(plain).not.toContain('Whoever buys this page reads it.');
      const translated = wrapper.findAll('button').find((b) => b.text().includes('Pay to end wardship'))!;
      expect(translated.attributes('disabled')).toBe(original.attributes('disabled'));
      await translated.trigger('click');
      expect(action).toHaveBeenLastCalledWith({ kind: 'buyBackWardship' });
      await wrapper.setProps({ proseMode: 'original' });
      expect(wrapper.text()).toContain('Mara is under age, and since 1222 the Warden has taken the harvest.');
      await original.trigger('click');
      expect(action).toHaveBeenLastCalledWith({ kind: 'buyBackWardship' });
      expect(action).toHaveBeenCalledTimes(2);
    } finally {
      wrapper.unmount();
    }
  });

  it('keeps engine refusals untouched while translating rent consequences and financial guidance', async () => {
    const { wrapper, ctx } = mountedShelf(40);
    try {
      const land = { ...landView(ctx), rentsPolicy: 'rack' as const };
      const refusal = { kind: 'rents', reason: 'The tenants have refused these terms.' };
      await wrapper.setProps({ land, refusal, proseMode: 'original' });
      expect(wrapper.text()).toContain('Most now, and longest remembered.');
      expect(wrapper.text()).toContain(refusal.reason);
      expect(wrapper.findAll('button').some((b) => b.attributes('aria-pressed') === 'true' && b.text() === 'Rack')).toBe(true);
      await wrapper.setProps({ proseMode: 'plainenglish' });
      expect(wrapper.text()).toContain('Highest rent now, with lasting resentment.');
      expect(wrapper.text()).toContain('A tutoring term costs');
      expect(wrapper.text()).toContain(refusal.reason);
      expect(wrapper.text()).not.toContain('Most now, and longest remembered.');
      expect(wrapper.findAll('button').some((b) => b.attributes('aria-pressed') === 'true' && b.text() === 'Highest rent')).toBe(true);
    } finally {
      wrapper.unmount();
    }
  });
});

describe('debt-bond controls stay tied to bonded status (#1446)', () => {
  it('never offers release to an unbonded servant, even when the advance input is blank, valid or invalid', async () => {
    const { wrapper, action, ctx } = mountedShelf(40);
    try {
      const table = tableView(ctx);
      table.servants = [
        { person: 'free', name: 'Mara the Cook', role: 'cook', term: 'yearly', wage: 2, debt: 0, bonded: false, loyalty: 0 },
        { person: 'bound', name: 'Orin the Porter', role: 'porter', term: 'yearly', wage: 0, debt: 5, bonded: true, loyalty: -1 },
      ];
      await wrapper.setProps({ table });
      const rowFor = (name: string) => wrapper.findAll('.line').find((row) =>
        row.find('strong').exists() && row.find('strong').text() === name)!;
      const free = rowFor('Mara the Cook');
      const bound = rowFor('Orin the Porter');
      const releaseVisible = () => free.findAll('button').some((b) => b.text() === 'Tear it up');

      // The formerly misplaced v-else drew release in this default state.
      expect(releaseVisible()).toBe(false);
      expect(free.findAll('button').some((b) => b.text() === 'Advance it against the years')).toBe(true);
      expect(bound.findAll('button').map((b) => b.text())).toEqual(['Tear it up']);
      expect(bound.find('input').exists()).toBe(false);

      await free.get('input').setValue('0');
      expect(free.find('[role="alert"]').exists()).toBe(true);
      expect(releaseVisible()).toBe(false);
      await free.get('input').setValue('1');
      expect(free.find('[role="alert"]').exists()).toBe(false);
      expect(releaseVisible()).toBe(false);

      await free.findAll('button').find((b) => b.text() === 'Advance it against the years')!.trigger('click');
      expect(action).toHaveBeenLastCalledWith({ kind: 'bond', person: 'free', op: 'bind', marks: 1 });
      await bound.get('button').trigger('click');
      expect(action).toHaveBeenLastCalledWith({ kind: 'bond', person: 'bound', op: 'free' });
      expect(action).toHaveBeenCalledTimes(2);
    } finally {
      wrapper.unmount();
    }
  });
});


describe('parcel-specific rename accessibility (#1694)', () => {
  it('names distinct parcels in both reading modes and renames only the selected parcel', async () => {
    const land = mockLand({ held: [
      baseHeld(), baseHeld({ parcel: 'westmere', name: 'Westmere' }),
    ] });
    const original = structuredClone(land);
    const actions = spyActions();
    const w = mount(Plat, { props: {
      land, houseName: 'House', halls: [], actions, close: () => {}, proseMode: 'original',
    } });
    try {
      const renames = () => w.findAll('button.rename');
      expect(renames().map((b) => b.text())).toEqual(['rename', 'rename']);
      expect(renames().map((b) => b.attributes('aria-label'))).toEqual(['Rename Longmere', 'Rename Westmere']);
      await w.setProps({ proseMode: 'plainenglish' });
      expect(renames().map((b) => b.text())).toEqual(['change name', 'change name']);
      expect(renames().map((b) => b.attributes('aria-label'))).toEqual(['Change name of Longmere', 'Change name of Westmere']);
      await renames()[1]!.trigger('click');
      expect(w.get('input').attributes('aria-label')).toBe('Change name of Westmere');
      await w.get('input').setValue('Green Meadow');
      await w.get('input').trigger('keydown', { key: 'Enter', isComposing: false });
      expect(actions.nameParcel).toHaveBeenCalledOnce();
      expect(actions.nameParcel).toHaveBeenCalledWith('westmere', 'Green Meadow');
      await w.setProps({ proseMode: 'original' });
      expect(renames().map((b) => b.attributes('aria-label'))).toEqual(['Rename Longmere', 'Rename Westmere']);
      expect(land).toEqual(original);
    } finally { w.unmount(); }
  });
});


describe('Plat failure feedback changes with reading mode (#1698)', () => {
  it('keeps blank and rejected rename drafts while changing local error wording both ways', async () => {
    const actions = spyActions();
    vi.mocked(actions.nameParcel).mockReturnValue(false);
    const land = mockLand();
    const snapshot = structuredClone(land);
    const w = mount(Plat, { props: {
      land, houseName: 'House', halls: [], actions, close: () => {}, proseMode: 'original',
    } });
    try {
      await w.get('button.rename').trigger('click');
      await w.get('input').setValue('   ');
      await w.get('input').trigger('keydown.enter');
      expect(w.get('[role="alert"]').text()).toContain('Enter a parcel name');
      expect(w.get('input').attributes('aria-invalid')).toBe('true');
      expect(w.get('input').attributes('aria-describedby')).toBe(w.get('[role="alert"]').attributes('id'));

      await w.setProps({ proseMode: 'plainenglish' });
      expect(w.get('[role="alert"]').text()).toBe('Enter a name, or use the previous name.');
      expect((w.get('input').element as HTMLInputElement).value).toBe('   ');
      await w.setProps({ proseMode: 'original' });
      expect(w.get('[role="alert"]').text()).toContain('Enter a parcel name');
      expect(actions.nameParcel).not.toHaveBeenCalled();

      await w.get('input').setValue('Cinder Field');
      await w.get('input').trigger('keydown.enter');
      expect(actions.nameParcel).toHaveBeenCalledTimes(1);
      expect(actions.nameParcel).toHaveBeenCalledWith('longmere', 'Cinder Field');
      expect(w.get('[role="alert"]').text()).toContain('That parcel could not be renamed.');
      await w.setProps({ proseMode: 'plainenglish' });
      expect(w.get('[role="alert"]').text()).toContain('Could not change this name.');
      expect((w.get('input').element as HTMLInputElement).value).toBe('Cinder Field');
      await w.setProps({ proseMode: 'original' });
      expect(w.get('[role="alert"]').text()).toContain('That parcel could not be renamed.');
      expect(w.get('input').attributes('aria-describedby')).toBe(w.get('[role="alert"]').attributes('id'));

      vi.mocked(actions.nameParcel).mockReturnValue(true);
      await w.get('input').setValue('Cinder Field Two');
      await w.get('input').trigger('keydown.enter');
      expect(actions.nameParcel).toHaveBeenCalledTimes(2);
      expect(w.find('input').exists()).toBe(false);
      expect(w.find('[role="alert"]').exists()).toBe(false);
      expect(land).toEqual(snapshot);
    } finally { w.unmount(); }
  });

  it('rewords a local gift failure without resending the order or losing the selected hall', async () => {
    const actions = spyActions();
    vi.mocked(actions.order).mockReturnValue({ ok: false });
    const land = mockLand();
    const snapshot = structuredClone(land);
    const halls = [
      { id: 'main', name: 'Main Hall', isSeat: true, grievance: 0, members: [] },
      { id: 'cadet_a', name: 'Younger Hall', isSeat: false, grievance: 0, members: [{}] },
    ] as unknown as SessionView['halls'];
    const w = mount(Plat, { props: {
      land, houseName: 'House', halls, actions, close: () => {}, proseMode: 'original',
    } });
    try {
      await w.get('select').setValue('cadet_a');
      await w.get('button.endow').trigger('click');
      expect(w.get('[role="alert"]').text()).toBe('The land could not be endowed.');
      expect(actions.order).toHaveBeenCalledTimes(1);
      expect(actions.order).toHaveBeenCalledWith({
        kind: 'endow', parcel: 'longmere', branch: 'cadet_a',
      });
      await w.setProps({ proseMode: 'plainenglish' });
      expect(w.get('[role="alert"]').text()).toBe('Could not give this land to the hall.');
      expect((w.get('select').element as HTMLSelectElement).value).toBe('cadet_a');
      await w.setProps({ proseMode: 'original' });
      expect(w.get('[role="alert"]').text()).toBe('The land could not be endowed.');
      expect(actions.order).toHaveBeenCalledTimes(1);

      vi.mocked(actions.order).mockReturnValue({ ok: false, reason: 'The household refused' });
      await w.get('button.endow').trigger('click');
      expect(w.get('[role="alert"]').text()).toBe('The household refused');
      await w.setProps({ proseMode: 'plainenglish' });
      expect(w.get('[role="alert"]').text()).toBe('The household refused');
      expect(actions.order).toHaveBeenCalledTimes(2);

      vi.mocked(actions.order).mockReturnValue({ ok: true });
      await w.get('button.endow').trigger('click');
      expect(w.find('[role="alert"]').exists()).toBe(false);
      expect(actions.order).toHaveBeenCalledTimes(3);
      expect(land).toEqual(snapshot);
    } finally { w.unmount(); }
  });

  it('rewords a recall fallback but preserves the actual recall order', async () => {
    const actions = spyActions();
    vi.mocked(actions.order).mockReturnValue({ ok: false });
    const w = mount(Plat, { props: {
      land: mockLand({ held: [baseHeld({ holder: 'cadet_a', holderName: 'Younger Hall' })] }),
      houseName: 'House', halls: [], actions, close: () => {}, proseMode: 'original',
    } });
    try {
      await w.get('button.recall-land').trigger('click');
      expect(w.get('[role="alert"]').text()).toBe('The land could not be recalled.');
      expect(actions.order).toHaveBeenCalledExactlyOnceWith({
        kind: 'endow', parcel: 'longmere', branch: null,
      });
      await w.setProps({ proseMode: 'plainenglish' });
      expect(w.get('[role="alert"]').text()).toBe('Could not take this land back.');
      await w.setProps({ proseMode: 'original' });
      expect(w.get('[role="alert"]').text()).toBe('The land could not be recalled.');
      expect(actions.order).toHaveBeenCalledTimes(1);
    } finally { w.unmount(); }
  });
});


describe('reader-local land captions (#1705)', () => {
  it('rewords counts, contested map caption and table headings without changing parcels or actions', async () => {
    const land = mockLand({ held: [
      baseHeld({ contestedBy: 'Elm Hall' }),
      baseHeld({ parcel: 'westmere', name: 'Westmere' }),
    ], lost: [{ defId: 'old', name: 'Old Field', place: 'south', year: 1220, by: 'Mara' }] });
    const before = structuredClone(land);
    const actions = spyActions();
    const wrapper = mount(Plat, { props: {
      land, halls: [], houseName: 'House Ash', actions, close: () => {}, proseMode: 'original',
    } });
    try {
      const caption = () => wrapper.get('.plat > p.dim.small').text();
      const columnLabels = () => wrapper.findAll('.terrier thead th').map((th) => th.text());
      expect(caption()).toContain('House Ash — 2 held, 1 lost.');
      expect(wrapper.get('.cell-claim').text()).toBe('claimed by Elm Hall');
      expect(columnLabels()).toEqual(['Name', 'State', 'Place', 'Particulars', 'Acreage']);

      await wrapper.setProps({ proseMode: 'plainenglish' });
      expect(caption()).toContain('House Ash — 2 parcels held, 1 parcel lost.');
      expect(wrapper.get('.cell-claim').text()).toBe('Also claimed by Elm Hall');
      expect(columnLabels()).toEqual(['Parcel name', 'Status', 'Location', 'Details', 'Area']);
      expect(wrapper.text()).toContain('Westmere');
      expect(wrapper.text()).toContain('Old Field');
      expect(wrapper.text()).toContain('Elm Hall');
      expect(land).toEqual(before);
      expect(actions.order).not.toHaveBeenCalled();
      expect(actions.nameParcel).not.toHaveBeenCalled();

      await wrapper.setProps({ proseMode: 'original' });
      expect(caption()).toContain('House Ash — 2 held, 1 lost.');
      expect(wrapper.get('.cell-claim').text()).toBe('claimed by Elm Hall');
      expect(columnLabels()).toEqual(['Name', 'State', 'Place', 'Particulars', 'Acreage']);
      expect(land).toEqual(before);
    } finally { wrapper.unmount(); }
  });
});
