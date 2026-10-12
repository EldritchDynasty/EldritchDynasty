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

describe('the plat draws each state', () => {
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
