import { ProseCatalogueS } from '@ed/schema';
import type { Choice, EventTemplate, Outcome, ProseMode, ProseVariant, TaleDef } from '@ed/schema';
import type { SimCtx } from './world.js';

/**
 * Runtime prose preference. It deliberately lives beside the world rather than
 * inside it: switching wording is presentation state and must not change a save,
 * a replay decision, or any simulation branch.
 */
export interface ProseRuntime {
  mode: ProseMode;
  /** Runtime catalogue supplied by the host/editor; not part of the simulation bundle or save. */
  variants: Map<string, ProseVariant>;
  /** Stable addresses requested in plain-English mode that are not migrated yet. */
  missing: Set<string>;
}

export function createProseRuntime(
  mode: ProseMode = 'original',
  variants: readonly ProseVariant[] = [],
): ProseRuntime {
  const parsed = ProseCatalogueS.parse(variants);
  return { mode, variants: new Map(parsed.map((variant) => [variant.address, variant])), missing: new Set() };
}

export function setProseVariants(ctx: SimCtx, variants: readonly ProseVariant[]): void {
  const parsed = ProseCatalogueS.parse(variants);
  ctx.prose.variants = new Map(parsed.map((variant) => [variant.address, variant]));
  ctx.prose.missing.clear();
}

export function setProseMode(ctx: SimCtx, mode: ProseMode): void {
  ctx.prose.mode = mode;
}

export function missingPlainEnglish(ctx: SimCtx): string[] {
  return [...ctx.prose.missing].sort();
}

/**
 * Select wording prospectively. Missing migration rows fall back to the
 * original so a partially migrated build stays playable, but the miss is
 * explicit and queryable rather than silently counted as complete.
 */
export function renderProse(ctx: SimCtx, address: string | undefined, original: string): string {
  if (ctx.prose.mode === 'original' || address === undefined) return original;
  const variant = ctx.prose.variants.get(address);
  if (variant) return variant.plainenglish;
  ctx.prose.missing.add(address);
  return original;
}

/**
 * The content worklist and runtime must spell authored prose identity exactly
 * the same way. Callers own the structural path because they own the schema
 * that produced it; this helper owns only the stable `content:<file>#<path>`
 * envelope shared with `contentProseEntries`.
 */
export function contentProseAddress(file: string, path: string): string {
  return `content:${file}#${path}`;
}

export function renderContentProse(
  ctx: SimCtx,
  file: string,
  path: string,
  original: string,
): string {
  return renderProse(ctx, contentProseAddress(file, path), original);
}

/** Live tale views render now; Match panels freeze these words when dealt. */
export function proseForTale(
  ctx: SimCtx,
  tale: Pick<TaleDef, 'id' | 'teller' | 'bias' | 'text'>,
): Pick<TaleDef, 'teller' | 'bias' | 'text'> {
  const file = ctx.content.sourceOf(tale.id);
  const base = file === undefined
    ? undefined
    : contentProseAddress(file, `tales[id=${encodeURIComponent(tale.id)}]`);
  return {
    teller: renderProse(ctx, base === undefined ? undefined : `${base}.teller`, tale.teller),
    bias: renderProse(ctx, base === undefined ? undefined : `${base}.bias`, tale.bias),
    text: renderProse(ctx, base === undefined ? undefined : `${base}.text`, tale.text),
  };
}

function eventBaseAddress(ctx: SimCtx, event: EventTemplate): string | undefined {
  const file = ctx.content.sourceOf(String(event.id));
  return file === undefined
    ? undefined
    : `content:${file}#events[id=${encodeURIComponent(String(event.id))}]`;
}

export function eventTitleAddress(ctx: SimCtx, event: EventTemplate): string | undefined {
  const base = eventBaseAddress(ctx, event);
  return base === undefined ? undefined : `${base}.title`;
}

export function proseForEventTitle(ctx: SimCtx, event: EventTemplate): string {
  return renderProse(ctx, eventTitleAddress(ctx, event), event.title);
}

export function eventBodyAddress(ctx: SimCtx, event: EventTemplate, absent = false): string | undefined {
  const base = eventBaseAddress(ctx, event);
  return base === undefined ? undefined : `${base}.${absent ? 'absentBody' : 'body'}`;
}

export function recordChronicleAddress(
  ctx: SimCtx,
  event: EventTemplate,
  option: 'record' | 'embellish',
): string | undefined {
  const base = eventBaseAddress(ctx, event);
  return base === undefined ? undefined : `${base}.record.options.${option}.chronicle`;
}

export function proseForRecordChronicle(
  ctx: SimCtx,
  event: EventTemplate,
  option: 'record' | 'embellish',
  original: string,
): string {
  return renderProse(ctx, recordChronicleAddress(ctx, event, option), original);
}

export function recordSubjectAddress(ctx: SimCtx, event: EventTemplate): string | undefined {
  const base = eventBaseAddress(ctx, event);
  return base === undefined ? undefined : `${base}.record.subject`;
}

export function proseForRecordSubject(ctx: SimCtx, event: EventTemplate, original: string): string {
  return renderProse(ctx, recordSubjectAddress(ctx, event), original);
}

export function choiceLabelAddress(ctx: SimCtx, event: EventTemplate, choice: Choice): string | undefined {
  const base = eventBaseAddress(ctx, event);
  return base === undefined
    ? undefined
    : `${base}.interaction.choices[id=${encodeURIComponent(choice.id)}].label`;
}

export function proseForChoiceLabel(ctx: SimCtx, event: EventTemplate, choice: Choice): string {
  return renderProse(ctx, choiceLabelAddress(ctx, event, choice), choice.label);
}

export function outcomeTextAddress(
  ctx: SimCtx,
  event: EventTemplate,
  outcome: Outcome,
  choiceId?: string,
): string | undefined {
  const base = eventBaseAddress(ctx, event);
  if (base === undefined) return undefined;

  if (event.interaction.kind === 'narration') {
    return `${base}.interaction.outcomes[id=${encodeURIComponent(outcome.id)}].text`;
  }

  // Outcome ids are not guaranteed unique across branches. The commit path
  // already carries the exact choice id for the decision log; use that same
  // identity for prose rather than reverse-searching by outcome id.
  const choice = choiceId === undefined
    ? event.interaction.choices.find((candidate) => candidate.outcomes.some((item) => item === outcome))
    : event.interaction.choices.find((candidate) => candidate.id === choiceId);
  if (!choice || !choice.outcomes.some((item) => item === outcome || item.id === outcome.id)) return undefined;
  return `${base}.interaction.choices[id=${encodeURIComponent(choice.id)}].outcomes[id=${encodeURIComponent(outcome.id)}].text`;
}

/** Choose the authored variant before slot interpolation freezes the words. */
export function proseForOutcome(
  ctx: SimCtx,
  event: EventTemplate,
  outcome: Outcome,
  choiceId?: string,
): string {
  if (outcome.text) return renderProse(ctx, outcomeTextAddress(ctx, event, outcome, choiceId), outcome.text);
  return renderProse(ctx, eventBodyAddress(ctx, event), event.body);
}

export function proseForEventBody(ctx: SimCtx, event: EventTemplate, body: string): string {
  if (body === event.body) return renderProse(ctx, eventBodyAddress(ctx, event), body);
  if (event.absentBody !== undefined && body === event.absentBody) {
    return renderProse(ctx, eventBodyAddress(ctx, event, true), body);
  }
  return body;
}
