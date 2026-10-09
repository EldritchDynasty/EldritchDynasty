import type { HeirloomDef, HeirloomState, Person } from '@ed/schema';
import type { SimCtx } from '../world.js';
import { evalFilter } from '../events/conditions.js';
import { applyEffect } from '../events/effects.js';
import { renderContentProse } from '../prose.js';

/**
 * APPLYING AN HEIRLOOM TO A PERSON — one mechanism, for every heirloom there
 * will ever be.
 *
 * An heirloom declares who it may be used on (the `Filter` vocabulary slots
 * use) and what it does (the closed `Effect` union events use). Nothing here
 * knows what any particular heirloom IS. Adding one is a YAML edit, which is
 * the same bargain the rest of the pipeline makes: content open, verbs closed.
 *
 * The bearer is bound to the token `BEARER`, so an heirloom addresses its
 * target exactly the way an event addresses a cast member — which means the
 * same effect list works in both places and there is one targeting model to
 * learn rather than two.
 *
 * What differs between heirlooms is what using one COSTS it, and that is the
 * `spends` flag: consumed, cooldown, or reusable. See `schema/heirloom.ts`.
 */

export const BEARER = 'BEARER';

export interface UseCheck {
  ok: boolean;
  reason?: string;
  /** Set when the only problem is the calendar, so a UI can say when. */
  readyIn?: number;
}

export function heldHeirlooms(ctx: SimCtx): HeirloomState[] {
  return [...ctx.world.heirlooms.values()];
}

export function heirloomDef(ctx: SimCtx, id: string): HeirloomDef | undefined {
  return ctx.content.heirloom(id);
}

/** Put one in the house's hands. Idempotent — a house owns a thing once. */
export function grantHeirloom(ctx: SimCtx, id: string): HeirloomState | undefined {
  const def = heirloomDef(ctx, id);
  if (!def) return undefined;

  const existing = ctx.world.heirlooms.get(id);
  if (existing) return existing;

  const state: HeirloomState = {
    id,
    acquiredYear: ctx.world.year,
    usesLeft: def.use.charges,
    spent: false,
    usedOn: [],
  };
  ctx.world.heirlooms.set(id, state);
  return state;
}

/**
 * The house no longer holds it — sold, given away, taken. `HeirloomState` has
 * no per-person owner (a house owns a thing or it does not), so `transfer`'s
 * whole effect is that the entry stops existing; whoever it went to is the
 * calling event's own chronicle text to tell, not state this engine tracks.
 * Idempotent the other way from `grantHeirloom`: transferring nothing away is
 * not an error, it is a no-op.
 */
export function transferHeirloom(ctx: SimCtx, id: string): boolean {
  return ctx.world.heirlooms.delete(id);
}

/**
 * Whether it can be used on this person right now, and if not, why not.
 *
 * Separated from `useHeirloom` because the reason is content: an option the
 * player cannot take is shown anyway, greyed, with the reason beside it. A
 * silently missing button teaches nothing.
 */
export function canUseHeirloom(ctx: SimCtx, id: string, bearer: Person): UseCheck {
  const def = heirloomDef(ctx, id);
  if (!def) return { ok: false, reason: 'no such heirloom' };

  const state = ctx.world.heirlooms.get(id);
  if (!state) return { ok: false, reason: 'the house does not hold it' };
  if (state.spent) return { ok: false, reason: 'it is spent' };
  if (state.usesLeft !== undefined && state.usesLeft <= 0) return { ok: false, reason: 'it is spent' };

  if (bearer.status !== 'alive') return { ok: false, reason: 'it is no use to the dead' };

  if (def.use.spends === 'cooldown' && state.lastUsedYear !== undefined) {
    const ready = state.lastUsedYear + def.use.cooldownYears;
    if (ctx.world.year < ready) {
      return { ok: false, reason: 'it is not ready', readyIn: ready - ctx.world.year };
    }
  }

  for (const f of def.target) {
    if (!evalFilter(f, bearer, ctx, {})) return { ok: false, reason: 'they are not who it is for' };
  }

  return { ok: true };
}

export interface UseResult {
  ok: boolean;
  reason?: string;
  spent?: boolean;
}

/**
 * Use it. Applies the effects to the bearer, then charges the heirloom for
 * having been used — and the charging is the whole reason this is one function
 * rather than a line in each event that grants one.
 */
export function useHeirloom(ctx: SimCtx, id: string, bearer: Person): UseResult {
  const check = canUseHeirloom(ctx, id, bearer);
  if (!check.ok) return { ok: false, reason: check.reason };

  const def = heirloomDef(ctx, id)!;
  const state = ctx.world.heirlooms.get(id)!;
  const w = ctx.world;

  const fill = { [BEARER]: bearer.id };
  for (const eff of def.effects) applyEffect(eff, ctx, fill);

  // Then what it cost the thing itself.
  state.lastUsedYear = w.year;
  state.usedOn.push({ person: bearer.id, year: w.year });
  if (state.usesLeft !== undefined) state.usesLeft -= 1;

  const outOfCharges = state.usesLeft !== undefined && state.usesLeft <= 0;
  if (def.use.spends === 'consumed' || outOfCharges) state.spent = true;

  if (def.chronicle) {
    // Select the authored words before interpolating the bearer, then freeze
    // them in the Chronicle. A later reading-mode change must not rewrite it.
    const file = ctx.content.sourceOf(id);
    const address = `heirlooms[id=${encodeURIComponent(id)}]`;
    const title = file === undefined
      ? def.name
      : renderContentProse(ctx, file, `${address}.name`, def.name);
    const chronicle = file === undefined
      ? def.chronicle
      : renderContentProse(ctx, file, `${address}.chronicle`, def.chronicle);
    w.chronicle.push({
      year: w.year,
      weight: 'paragraph',
      title,
      text: chronicle.replace(/\{BEARER\}/g, () => bearer.name),
      named: false,
    });
  }

  return { ok: true, spent: state.spent };
}

/** Everyone in the house it could be used on this year. For the UI and tests. */
export function eligibleBearers(ctx: SimCtx, id: string): Person[] {
  return ctx.world.people
    .household(ctx.world.playerHouse, ctx.world.year)
    .filter((p) => canUseHeirloom(ctx, id, p).ok);
}
