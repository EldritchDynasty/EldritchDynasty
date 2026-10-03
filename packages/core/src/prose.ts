import type { EventTemplate, Outcome, ProseMode, ProseVariant } from '@ed/schema';
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
  return { mode, variants: new Map(variants.map((variant) => [variant.address, variant])), missing: new Set() };
}

export function setProseVariants(ctx: SimCtx, variants: readonly ProseVariant[]): void {
  ctx.prose.variants = new Map(variants.map((variant) => [variant.address, variant]));
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

function eventBaseAddress(ctx: SimCtx, event: EventTemplate): string | undefined {
  const file = ctx.content.sourceOf(String(event.id));
  return file === undefined
    ? undefined
    : `content:${file}#events[id=${encodeURIComponent(String(event.id))}]`;
}

export function eventBodyAddress(ctx: SimCtx, event: EventTemplate, absent = false): string | undefined {
  const base = eventBaseAddress(ctx, event);
  return base === undefined ? undefined : `${base}.${absent ? 'absentBody' : 'body'}`;
}

export function outcomeTextAddress(
  ctx: SimCtx,
  event: EventTemplate,
  outcome: Outcome,
): string | undefined {
  const base = eventBaseAddress(ctx, event);
  if (base === undefined) return undefined;

  if (event.interaction.kind === 'narration') {
    return `${base}.interaction.outcomes[id=${encodeURIComponent(outcome.id)}].text`;
  }

  const choice = event.interaction.choices.find((candidate) =>
    candidate.outcomes.some((item) => item === outcome || item.id === outcome.id));
  if (!choice) return undefined;
  return `${base}.interaction.choices[id=${encodeURIComponent(choice.id)}].outcomes[id=${encodeURIComponent(outcome.id)}].text`;
}

/** Choose the authored variant before slot interpolation freezes the words. */
export function proseForOutcome(ctx: SimCtx, event: EventTemplate, outcome: Outcome): string {
  if (outcome.text) return renderProse(ctx, outcomeTextAddress(ctx, event, outcome), outcome.text);
  return renderProse(ctx, eventBodyAddress(ctx, event), event.body);
}

export function proseForEventBody(ctx: SimCtx, event: EventTemplate, body: string): string {
  if (body === event.body) return renderProse(ctx, eventBodyAddress(ctx, event), body);
  if (event.absentBody !== undefined && body === event.absentBody) {
    return renderProse(ctx, eventBodyAddress(ctx, event, true), body);
  }
  return body;
}
