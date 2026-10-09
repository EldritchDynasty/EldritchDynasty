import type { CharacterTemplate } from '@ed/schema';
import { contentProseAddress, renderProse } from '../prose.js';
import type { SimCtx } from '../world.js';

export function characterProse(ctx: SimCtx, template: CharacterTemplate, field: 'title'): string;
export function characterProse(ctx: SimCtx, template: CharacterTemplate, field: 'blurb'): string | undefined;
/** Called only when a card or page commits this field's words for the player. */
export function characterProse(
  ctx: SimCtx,
  template: CharacterTemplate,
  field: 'title' | 'blurb',
): string | undefined {
  const original = template[field];
  if (original === undefined) return undefined;
  const file = ctx.content.sourceOf(String(template.id));
  const address = file === undefined ? undefined : contentProseAddress(
    file, `characterTemplates[id=${encodeURIComponent(template.id)}].${field}`,
  );
  return renderProse(ctx, address, original);
}
