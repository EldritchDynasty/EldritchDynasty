/** Callable rites. Table supplies the existing engine operations once; no run state lives here. */
import type { EventTemplate, Person, TableOrder, Year } from '@ed/schema';
import { assertNever } from '@ed/schema';
import type { SimCtx } from './world.js';
import type { spellbookDef } from './people/library.js';
import type { ofTheLine } from './people/succession.js';
import type { evalCondition } from './events/conditions.js';
import type { queueChoice } from './events/decisions.js';
import type { candidatesFor, resolveSlots, SlotResolution } from './events/slots.js';
import { castIn } from './events/fill.js';
import { streamFor } from './rng.js';
import { msg } from './messages.js';
import { proseForContentField, proseForEventTitle } from './prose.js';
import { ours } from './table-helpers.js';

/**
 * A FORCING RITE'S AGE WINDOW, read off its own slot (§11, #1817). The slot is
 * the one rule — the Table's list, its refusals and the ambient cast all ask
 * it — so a window edited in the content is a window edited everywhere.
 */
export function forcingWindow(e: EventTemplate): { from?: number; to?: number } {
  const spec = e.forcing ? e.slots[e.forcing.slot] : undefined;
  const out: { from?: number; to?: number } = {};
  for (const f of spec?.filters ?? []) {
    if (!('age' in f)) continue;
    const { op, value } = f.age;
    if (op === 'gte') out.from = Math.max(out.from ?? value, value);
    if (op === 'gt') out.from = Math.max(out.from ?? value + 1, value + 1);
    if (op === 'lte') out.to = Math.min(out.to ?? value, value);
    if (op === 'lt') out.to = Math.min(out.to ?? value - 1, value - 1);
  }
  return out;
}

export interface RiteAssembly {
  /** The authored rite this assembly belongs to. */
  rite: 'vessel' | 'great_rite' | 'unmaking';
  title: string;
  /** People already fixed by the engine's slot resolution. */
  actors: { slot: string; person: string; name: string }[];
  /**
   * Player-cast slots, with the exact candidates the resolver will accept.
   * Each carries the life the house has on record (#1867 §6): a Vessel is a
   * decision about a named relative with a remembered life, not a name.
   */
  atRisk: { slot: string; candidates: { person: string; name: string; remembered: string }[] }[];
  /** Visible preparation already carried by the fixed actors. Never probabilities. */
  preparations: string[];
  /** Costs the player cannot undo once the taking branch resolves. */
  irreversible: string[];
}

export interface RiteOrdersView {
  unmaking: { ready: boolean; reason?: string; assembly?: RiteAssembly };
  vesselRite: { ready: boolean; reason?: string; assembly?: RiteAssembly };
  greatRite: { ready: boolean; reason?: string; assembly?: RiteAssembly };
  /**
   * THE FORCING RITES (§11, #1817), one row per rite the house can call. Each
   * lists every boy of the line it could be tried on today — the same boys
   * whether or not the blood is in them, because the house does not know and
   * the list is what the house can see. `forcingRite` takes one.
   */
  forcing: { rite: string; title: string; from?: number; to?: number; ready: boolean; reason?: string;
    boys: { person: string; name: string; age: Year }[] }[];
}

/** Engine operations already owned by Table; types follow their sole implementations. */
interface RiteOrderEngine {
  spellbookDef: typeof spellbookDef;
  ofTheLine: typeof ofTheLine;
  evalCondition: typeof evalCondition;
  queueChoice: typeof queueChoice;
  candidatesFor: typeof candidatesFor;
  resolveSlots: typeof resolveSlots;
}

/**
 * Bind existing function declarations once, without capturing a world or RNG.
 * Their modules already reach Table through effects and marriage policy; a
 * type-only boundary keeps this module out of those pre-existing cycles.
 */
export function riteOrderHandlers({ spellbookDef, ofTheLine, evalCondition, queueChoice,
  candidatesFor, resolveSlots }: RiteOrderEngine) {
  function riteOffer(ctx: SimCtx, eventId: string, rite: 'vessel' | 'great_rite' | 'unmaking'):
    { ok: boolean; reason?: string; event?: EventTemplate; slots?: SlotResolution } {
    const w = ctx.world;
    if (w.ending) return { ok: false, reason: msg(ctx, 'table.rite.closed', 'the Ledger has closed') };
    if (w.pendingDecisions.some((d) => d.kind === 'choice' && d.event.id === eventId)) {
      return { ok: false, reason: msg(ctx, 'table.rite.pending', 'this rite is already before the house') };
    }
    const event = ctx.content.events.find((e) => e.id === eventId);
    if (!event || !evalCondition(event.conditions, ctx)) {
      return { ok: false, reason: msg(ctx, 'table.rite.standing', 'the house has not reached the standing this rite demands') };
    }
    const slots = resolveSlots(event, ctx, streamFor(w, 'rite-order', eventId));
    if (!slots.ok) {
      return {
        ok: false,
        reason: slots.missing != null
          ? msg(ctx, 'table.rite.unfielded_slot', 'the house cannot field {SLOT}', { SLOT: slots.missing })
          : msg(ctx, 'table.rite.unfielded', 'the house cannot field the rite'),
      };
    }
    for (const slot of slots.playerCast) {
      const spec = event.slots[slot];
      if (!spec || !candidatesFor(spec, ctx, slots.fill).length) {
        return { ok: false, reason: msg(ctx, 'table.rite.no_candidate', 'nobody can stand as {SLOT}', { SLOT: slot }) };
      }
    }
    const ascendant = slots.fill.ASCENDANT;
    if (typeof ascendant === 'string' && w.people.get(ascendant)?.rites.includes(rite)) {
      return { ok: false, reason: msg(ctx, 'table.rite.repeat', 'he has already taken this rite') };
    }
    return { ok: true, event, slots };
  }

  /** The forcing rites the house knows it can call: `forcing.called`, in content order. */
  function calledForcingRites(ctx: SimCtx): EventTemplate[] {
    return ctx.content.events.filter((e) => e.forcing?.called === true);
  }

  /**
   * Why this rite cannot be tried on this boy now, in the house's own terms, or
   * nothing if it can (§11, #1817).
   *
   * OWNER RULING 2026-10-18: any unwoken boy of the blood in the window, and the
   * list never consults whether he can express. Every refusal here is something
   * the house can see for itself — his age, that he has woken, that it gave up
   * on him, that he has been tried. The last check asks his rite's own slot,
   * which `rites/forcing` forbids to ask `canExpress`, so even the catch-all
   * cannot say more than the house knows.
   */
  function forcingRefusal(ctx: SimCtx, e: EventTemplate, p: Person): string | undefined {
    const w = ctx.world;
    if (p.status !== 'alive' || p.sex !== 'male' || !ofTheLine(ctx, p)) {
      return msg(ctx, 'table.forcing.not_a_son', 'the rite is for a boy of the line');
    }
    if (p.awakening.awakened) return msg(ctx, 'table.forcing.woken', 'he has already woken');
    if (p.awakening.declaredMundane) return msg(ctx, 'table.forcing.declared', 'the house has stopped waiting for him');
    if (p.awakening.forcingTried) return msg(ctx, 'table.forcing.tried', 'he has been put through a forcing rite already');
    const age = w.year - p.born;
    const window = forcingWindow(e);
    if (window.from !== undefined && age < window.from) {
      return msg(ctx, 'table.forcing.young', 'he is too young for the rite');
    }
    if (window.to !== undefined && age > window.to) {
      return msg(ctx, 'table.forcing.old', 'he is past the age the rite asks for');
    }
    if (w.pendingDecisions.some((d) => d.kind === 'choice' && d.event.forcing
      && castIn(d.fill, d.event.forcing.slot).includes(p.id))) {
      return msg(ctx, 'table.forcing.pending', 'a rite for him is already before the house');
    }
    const spec = e.forcing ? e.slots[e.forcing.slot] : undefined;
    if (!spec || !candidatesFor(spec, ctx, {}).some((c) => c.id === p.id)) {
      return msg(ctx, 'table.forcing.fallback', 'the rite cannot be tried on him');
    }
    return undefined;
  }

  /** Why this rite cannot be called at all this year, or nothing. */
  function forcingRiteRefusal(ctx: SimCtx, e: EventTemplate | undefined): string | undefined {
    const w = ctx.world;
    if (w.ending) return msg(ctx, 'table.forcing.closed', 'the Ledger has closed');
    if (!e?.forcing?.called) return msg(ctx, 'table.forcing.unknown', 'the house has no such rite');
    if (w.pendingDecisions.some((d) => d.kind === 'choice' && d.event.id === e.id)) {
      return msg(ctx, 'table.forcing.rite_pending', 'this rite is already before the house');
    }
    if (!evalCondition(e.conditions, ctx)) {
      return msg(ctx, 'table.forcing.conditions', 'the book cannot be followed this year');
    }
    return undefined;
  }

  function forcingOffer(ctx: SimCtx, eventId: string, personId: string):
    { ok: boolean; reason?: string; event?: EventTemplate; slots?: SlotResolution } {
    const w = ctx.world;
    const event = ctx.content.events.find((e) => e.id === eventId);
    const closed = forcingRiteRefusal(ctx, event);
    if (closed || !event?.forcing) return { ok: false, reason: closed };
    const p = ours(ctx, personId);
    if (!p) return { ok: false, reason: msg(ctx, 'table.forcing.unknown_person', 'nobody of this house by that name') };
    const refused = forcingRefusal(ctx, event, p);
    if (refused) return { ok: false, reason: refused };
    // The boy is the preset; everybody else in the scene is cast as the
    // ambient draw would cast them, on a stream of the order's own.
    const slots = resolveSlots(event, ctx, streamFor(w, 'forcing-order', eventId), { [event.forcing.slot]: p.id });
    if (!slots.ok) {
      return {
        ok: false,
        reason: slots.missing != null
          ? msg(ctx, 'table.forcing.unfielded_slot', 'the house cannot field {SLOT}', { SLOT: slots.missing })
          : msg(ctx, 'table.forcing.unfielded', 'the house cannot field the rite'),
      };
    }
    return { ok: true, event, slots };
  }

  function preparationRiteName(ctx: SimCtx, rite: Person['rites'][number]): string {
    switch (rite) {
      case 'vessel': return msg(ctx, 'table.assembly.known_vessel', 'vessel');
      case 'great_rite': return msg(ctx, 'table.assembly.known_great_rite', 'the Great Rite');
      case 'unmaking': return msg(ctx, 'table.assembly.known_unmaking', 'unmaking');
      default: return assertNever(rite);
    }
  }

  /**
   * WHAT THE HOUSE REMEMBERS OF SOMEONE IT MAY SPEND (#1867 §6).
   *
   * Their age, the parents the family's own papers name (never the genome's),
   * and the last page of the book that named them — or the plain fact that it
   * never has. Only what is already on record; nothing about the rite's odds.
   */
  function rememberedLife(ctx: SimCtx, p: Person): string {
    const w = ctx.world;
    const age = String(w.year - p.born);
    const nameOf = (id: string | undefined) => (id ? w.people.get(id)?.name : undefined);
    const mother = nameOf(p.claimedParents.mother);
    const father = nameOf(p.claimedParents.father);
    const parent = mother ?? father;
    const who = mother && father
      ? msg(ctx, 'table.assembly.remembered_parents', '{NAME}, {AGE}, child of {MOTHER} and {FATHER}.',
        { NAME: p.name, AGE: age, MOTHER: mother, FATHER: father })
      : parent
        ? msg(ctx, 'table.assembly.remembered_parent', '{NAME}, {AGE}, child of {PARENT}.',
          { NAME: p.name, AGE: age, PARENT: parent })
        : msg(ctx, 'table.assembly.remembered', '{NAME}, {AGE}.', { NAME: p.name, AGE: age });
    let page: (typeof w.chronicle)[number] | undefined;
    for (let i = w.chronicle.length - 1; i >= 0 && !page; i--) {
      const entry = w.chronicle[i]!;
      if (entry.text !== null && entry.people?.includes(p.id)) page = entry;
    }
    if (!page) return `${who} ${msg(ctx, 'table.assembly.never_written', 'The book has never written of them.')}`;
    return `${who} ${page.title
      ? msg(ctx, 'table.assembly.last_page_title', 'The book last named them in {YEAR}, under “{TITLE}”.',
        { YEAR: String(page.year), TITLE: page.title })
      : msg(ctx, 'table.assembly.last_page', 'The book last named them in {YEAR}.', { YEAR: String(page.year) })}`;
  }

  function assemblyFor(
    ctx: SimCtx,
    event: EventTemplate,
    slots: SlotResolution,
    rite: RiteAssembly['rite'],
    title: string,
  ): RiteAssembly {
    // Build from the exact resolution the offer just produced. Re-resolving here
    // would make the confirmation a second photograph of the room rather than
    // the photograph the ready-state was actually based on.
    const actors = Object.entries(slots.fill)
      .flatMap(([slot, id]) => typeof id === 'string'
        ? [{ slot, person: id, name: ctx.world.people.get(id)?.name ?? id }]
        : []);

    const atRisk = slots.playerCast.map((slot) => {
      const spec = event.slots[slot];
      const people = spec ? candidatesFor(spec, ctx, slots.fill) : [];
      return {
        slot,
        candidates: people.map((p) => ({ person: p.id, name: p.name, remembered: rememberedLife(ctx, p) })),
      };
    });

    const preparations: string[] = [];
    for (const actor of actors) {
      const person = ctx.world.people.get(actor.person);
      if (!person) continue;
      if (person.spellsKnown.length) {
        const books = person.spellsKnown.map((id) => {
          const book = spellbookDef(ctx, String(id));
          return book ? proseForContentField(ctx, 'spellbooks', book.id, 'name', book.name) : String(id);
        });
        preparations.push(msg(ctx, 'table.assembly.books', '{PERSON} has read {BOOKS}.',
          { PERSON: person.name, BOOKS: books.join(', ') }));
      }
      if (person.rites.length) {
        const rites = person.rites.map((taken) => preparationRiteName(ctx, taken))
          .reduce((before, taken) => msg(ctx, 'table.assembly.rite_list', '{BEFORE} and {RITE}',
            { BEFORE: before, RITE: taken }));
        preparations.push(msg(ctx, 'table.assembly.rites', '{PERSON} has already taken {RITES}.',
          { PERSON: person.name, RITES: rites }));
      }
    }

    const irreversible = rite === 'vessel'
      ? [msg(ctx, 'table.assembly.cost_vessel', 'The named Vessel is consumed. Their place in the living house cannot be restored.')]
      : rite === 'great_rite'
        ? [msg(ctx, 'table.assembly.cost_great_rite', 'The ascendant is widened once only, and the Madness charged by the rite remains his.')]
        : [msg(ctx, 'table.assembly.cost_unmaking', 'The elder is spent whether the final transfer succeeds or fails; the last step can cost the run.')];

    return { rite, title, actors, atRisk, preparations, irreversible };
  }

  function carryOutRite(
    ctx: SimCtx,
    o: Extract<TableOrder, { kind: 'vesselRite' | 'greatRite' | 'unmaking' }>,
  ): { ok: boolean; reason?: string } {
    const eventId = o.kind === 'vesselRite' ? 'the_vessel_rite'
      : o.kind === 'greatRite' ? 'the_great_rite' : 'the_unmaking';
    const rite = o.kind === 'vesselRite' ? 'vessel'
      : o.kind === 'greatRite' ? 'great_rite' : 'unmaking';
    const prepared = riteOffer(ctx, eventId, rite);
    if (!prepared.ok || !prepared.event || !prepared.slots) {
      return { ok: false, reason: prepared.reason ?? msg(ctx, 'table.rite.fallback', 'the family cannot field the rite') };
    }
    queueChoice(ctx, prepared.event, prepared.event.body, prepared.slots.fill, prepared.slots.playerCast);
    return { ok: true };
  }

  function carryOutForcingRite(
    ctx: SimCtx,
    o: Extract<TableOrder, { kind: 'forcingRite' }>,
  ): { ok: boolean; reason?: string } {
    const prepared = forcingOffer(ctx, o.rite, o.person);
    if (!prepared.ok || !prepared.event || !prepared.slots) {
      return { ok: false, reason: prepared.reason ?? msg(ctx, 'table.forcing.order_fallback', 'the rite cannot be tried on him') };
    }
    queueChoice(ctx, prepared.event, prepared.event.body, prepared.slots.fill, prepared.slots.playerCast,
      undefined, [prepared.event.forcing!.slot]);
    return { ok: true };
  }

  function riteOrdersView(ctx: SimCtx, household: readonly Person[]): RiteOrdersView {
    const w = ctx.world;
    return {
      unmaking: (() => {
        const offer = riteOffer(ctx, 'the_unmaking', 'unmaking');
        return offer.ok && offer.event && offer.slots
          ? { ready: true, assembly: assemblyFor(ctx, offer.event, offer.slots, 'unmaking',
            msg(ctx, 'table.assembly.title_unmaking', 'The Unmaking')) }
          : { ready: false, reason: offer.reason };
      })(),
      vesselRite: (() => {
        const offer = riteOffer(ctx, 'the_vessel_rite', 'vessel');
        return offer.ok && offer.event && offer.slots
          ? { ready: true, assembly: assemblyFor(ctx, offer.event, offer.slots, 'vessel',
            msg(ctx, 'table.assembly.title_vessel', 'The Vessel')) }
          : { ready: false, reason: offer.reason };
      })(),
      greatRite: (() => {
        const offer = riteOffer(ctx, 'the_great_rite', 'great_rite');
        return offer.ok && offer.event && offer.slots
          ? { ready: true, assembly: assemblyFor(ctx, offer.event, offer.slots, 'great_rite',
            msg(ctx, 'table.assembly.title_great_rite', 'The Great Rite')) }
          : { ready: false, reason: offer.reason };
      })(),
      forcing: calledForcingRites(ctx).map((e) => {
        const closed = forcingRiteRefusal(ctx, e);
        const boys = closed ? [] : household
          .filter((p) => forcingRefusal(ctx, e, p) === undefined)
          .map((p) => ({ person: p.id, name: p.name, age: w.year - p.born }))
          .sort((a, b) => b.age - a.age);
        return {
          rite: String(e.id), title: proseForEventTitle(ctx, e), ...forcingWindow(e),
          ready: !closed && boys.length > 0,
          ...(closed ? { reason: closed }
            : !boys.length ? { reason: msg(ctx, 'table.forcing.nobody', 'no boy of the line is of the age the book asks') } : {}),
          boys,
        };
      }),
    };
  }

  return { carryOutRite, carryOutForcingRite, riteOrdersView };
}
