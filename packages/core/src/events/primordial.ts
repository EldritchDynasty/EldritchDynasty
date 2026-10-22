import { primordialChance, type EventTemplate, type Outcome, type PrimordialRecord, type PrimordialResponse } from '@ed/schema';
import type { SimCtx } from '../world.js';
import type { SlotFill } from './slots.js';
import { renderBody } from './slots.js';
import { isCurrentFamily, resolvePresence } from '../presence.js';
import { phenotypeOf } from '../people/factory.js';
import { eldritchPower } from '../ascension.js';
import { streamFor, type Rng } from '../rng.js';
import { assessHarm, mitigates, type HarmAssessment } from './harm.js';
import { msg } from '../messages.js';
import { outcomeTextAddress, renderProse } from '../prose.js';

export const PRIMORDIAL_ACTOR = 'PRIMORDIAL_ACTOR';
export interface PrimordialCandidate { id: string; ep: number; chance: number }
export interface PrimordialPreview {
  normal: HarmAssessment;
  final?: HarmAssessment;
  attendance?: ReturnType<typeof resolvePresence>;
  candidates: PrimordialCandidate[];
  probability: number;
}

export interface PrimordialObservation extends PrimordialPreview {
  event: string;
  choiceId?: string;
  selectedOutcome: string;
  occurrence: string;
  actor?: string;
}

/** Read-only calculation. Editor callers supply a private preview world. */
export function previewPrimordial(ctx: SimCtx, e: EventTemplate, outcome: Outcome, fill: SlotFill): PrimordialPreview {
  const normal = assessHarm(ctx, outcome, fill);
  const site = outcome.site ?? e.site;
  if (!normal.categories.length || !site) return { normal, candidates: [], probability: 0 };
  const attendance = resolvePresence(ctx, site, fill);
  const candidates = attendance.people.flatMap(id => {
    const p = ctx.world.people.get(id)!;
    if (!isCurrentFamily(ctx, p) || p.status !== 'alive' || !p.awakening.awakened
      || !phenotypeOf(p, ctx.genetics, ctx.world.year).eldritch.canExpress) return [];
    const ep = eldritchPower(ctx, p);
    return [{ id, ep, chance: primordialChance(ep) }];
  });
  const final = outcome.primordial ? assessHarm(ctx, outcome.primordial, fill) : undefined;
  return { normal, final, attendance, candidates,
    // An authored reduction can be erased by the current world's clamps (for
    // example, both losses reaching the lowest Respect tier). Never roll or
    // claim an intervention that cannot improve this particular incident.
    probability: final && mitigates(normal, final)
      ? 1 - candidates.reduce((miss, candidate) => miss * (1 - candidate.chance), 1) : 0 };
}

/** Fisher-Yates over sorted unique ids, then independent trials; stop on success. */
export function rollPrimordial(candidates: readonly PrimordialCandidate[], rng: Rng): PrimordialCandidate | undefined {
  const unique = new Map(candidates.map(candidate => [candidate.id, candidate]));
  const pool = [...unique.values()].sort((a, b) => a.id.localeCompare(b.id));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  for (const candidate of pool) if (rng.bool(candidate.chance)) return candidate;
  return undefined;
}

const number = (value: number) => String(Math.round(value * 100) / 100);

/** Every claim in this receipt comes from the assessed material difference. */
export function interventionReceipt(ctx: SimCtx, actorName: string, normal: HarmAssessment, final: HarmAssessment): string {
  const lines = [msg(ctx, 'primordial.receipt.actor', 'Primordial intervention — {ACTOR}.', { ACTOR: actorName })];
  for (const id of normal.deaths.filter(id => !final.deaths.includes(id))) {
    lines.push(msg(ctx, 'primordial.receipt.life', '{PERSON} did not die.', { PERSON: ctx.world.people.get(id)?.name ?? id }));
  }
  for (const id of normal.missing.filter(id => !final.missing.includes(id))) {
    lines.push(msg(ctx, 'primordial.receipt.liberty', '{PERSON} was not lost to the house.', { PERSON: ctx.world.people.get(id)?.name ?? id }));
  }
  if (final.cashLoss < normal.cashLoss) lines.push(msg(ctx, 'primordial.receipt.cash',
    'The threatened loss of {NORMAL} crowns was reduced to {FINAL}; {SAVED} crowns were preserved.',
    { NORMAL: number(normal.cashLoss), FINAL: number(final.cashLoss), SAVED: number(normal.cashLoss - final.cashLoss) }));
  for (const id of normal.seatLost.filter(id => !final.seatLost.includes(id))) lines.push(msg(ctx, 'primordial.receipt.seat',
    '{PARCEL} was preserved.', { PARCEL: ctx.content.parcel(id)?.name ?? id }));
  if (final.estateLoss < normal.estateLoss) lines.push(msg(ctx, 'primordial.receipt.estate',
    'The threatened loss of estate income fell from {NORMAL}% to {FINAL}%.',
    { NORMAL: number(100 * normal.estateShare), FINAL: number(100 * final.estateShare) }));
  for (const id of normal.titlesLost.filter(id => !final.titlesLost.includes(id))) lines.push(msg(ctx, 'primordial.receipt.book',
    '{BOOK} stayed in the library.', { BOOK: ctx.content.spellbook(id)?.name ?? id }));
  for (const key of normal.knowledgeLost.filter(id => !final.knowledgeLost.includes(id))) {
    const [person, book] = key.split(':');
    lines.push(msg(ctx, 'primordial.receipt.knowledge', '{PERSON} kept the knowledge of {BOOK}.',
      { PERSON: ctx.world.people.get(person!)?.name ?? person!, BOOK: ctx.content.spellbook(book!)?.name ?? book! }));
  }
  for (const id of normal.regaliaLost.filter(id => !final.regaliaLost.includes(id))) lines.push(msg(ctx, 'primordial.receipt.regalia',
    '{ITEM} remained with the house.', { ITEM: ctx.content.heirloom(id)?.name ?? id }));
  if (final.respectDrop < normal.respectDrop) lines.push(msg(ctx, 'primordial.receipt.respect',
    'The threatened fall of {NORMAL} Respect tiers was reduced to {FINAL}.',
    { NORMAL: number(normal.respectDrop), FINAL: number(final.respectDrop) }));
  if (final.cashLoss > 0) lines.push(msg(ctx, 'primordial.receipt.remaining_cash',
    '{CROWNS} crowns were still lost.', { CROWNS: number(final.cashLoss) }));
  if (final.estateLoss > 0) lines.push(msg(ctx, 'primordial.receipt.remaining_estate',
    '{SHARE}% of the estate income was still lost.', { SHARE: number(100 * final.estateShare) }));
  for (const id of final.deaths) lines.push(msg(ctx, 'primordial.receipt.remaining_life',
    '{PERSON} still died.', { PERSON: ctx.world.people.get(id)?.name ?? id }));
  return lines.join(' ');
}

export interface PrimordialResolution {
  event: EventTemplate;
  outcome: Outcome;
  fill: SlotFill;
  record?: Omit<PrimordialRecord, 'page'>;
}

/** Called once, before applyOutcome. Its stream never consumes the caller's RNG. */
export function resolvePrimordial(ctx: SimCtx, e: EventTemplate, normal: Outcome, fill: SlotFill, occurrence: string, choiceId?: string): PrimordialResolution {
  const unchanged = { event: e, outcome: normal, fill };
  if (!normal.primordial) return unchanged;
  const preview = previewPrimordial(ctx, e, normal, fill);
  const observe = (actor?: string) => ctx.observePrimordial?.(structuredClone({ ...preview,
    event: e.id, choiceId, selectedOutcome: normal.id, occurrence, ...(actor ? { actor } : {}) }));
  if (!preview.normal.categories.length || !preview.attendance || !preview.probability) { observe(); return unchanged; }
  const response = normal.primordial;
  const actor = rollPrimordial(preview.candidates, streamFor(ctx.world, `primordial:${occurrence}`));
  observe(actor?.id);
  if (!actor) return unchanged;
  const actorName = ctx.world.people.get(actor.id)!.name;
  const cast = { ...fill, [PRIMORDIAL_ACTOR]: actor.id };
  const final: Outcome = { id: response.id, weight: normal.weight, text: renderProse(ctx, outcomeTextAddress(ctx, e, normal, choiceId)?.replace(/\.text$/, '.primordial.text'), response.text),
    effects: response.effects.map((effect, i) => {
      const base = outcomeTextAddress(ctx, e, normal, choiceId)?.replace(/\.text$/, '.primordial');
      if (effect.kind === 'chronicle') return { ...effect, text: renderProse(ctx, base ? `${base}.effects[${i}].text` : undefined, effect.text) };
      if (effect.kind === 'status' && effect.cause) return { ...effect, cause: renderProse(ctx, base ? `${base}.effects[${i}].cause` : undefined, effect.cause) };
      return effect;
    }), tags: response.tags, agreedPrices: response.agreedPrices, triggers: response.triggers, next: response.next };
  const actualNormal = assessHarm(ctx, normal, fill, true);
  const actualFinal = assessHarm(ctx, final, cast, true);
  const receipt = interventionReceipt(ctx, actorName, actualNormal, actualFinal);
  // Freeze both selected wording and the arithmetic before any effects run.
  const manifestation = renderBody(final.text, cast, ctx);
  final.text = `${manifestation}\n\n${receipt}`;
  return {
    event: { ...e, record: response.record ? structuredClone(response.record) : undefined, recordByChoice: undefined, recordByOutcome: undefined,
      rumour: undefined, accounts: [] },
    outcome: final, fill: cast,
    record: { occurrence, actor: actor.id, actorName, site: preview.attendance.site, hall: preview.attendance.hall,
      normalOutcome: normal.id, finalOutcome: final.id, normal: actualNormal, committed: actualFinal, manifestation, receipt },
  };
}
