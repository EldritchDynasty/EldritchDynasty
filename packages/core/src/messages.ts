import { CORE_MESSAGE_ADDRESS_PREFIX, contentInterpolationTokens } from '@ed/schema';
import { renderProse } from './prose.js';
import type { SimCtx } from './world.js';

/** Authored keys survive source-file moves and unrelated literal insertions. */
export function coreMessageAddress(key: string): string {
  return `${CORE_MESSAGE_ADDRESS_PREFIX}${encodeURIComponent(key)}`;
}

/** Select a template before inserting names or other already-visible values. */
export function msg(
  ctx: SimCtx,
  key: string,
  original: string,
  values: Readonly<Record<string, string>> = {},
): string {
  // Original is the common hot path in unattended long-play simulations.
  // There is no variant address to resolve or validate in this mode; per-year
  // passages can therefore avoid key encoding and both token scans (#1641).
  let template = original;
  if (ctx.prose.mode !== 'original') {
    const address = coreMessageAddress(key);
    template = renderProse(ctx, address, original);
    // Host-supplied core variants have no YAML validation boundary. An invalid
    // token set must not erase a name or add information the caller never gave.
    if (template !== original) {
      const tokens = (text: string) => contentInterpolationTokens(text).sort().join('\n');
      if (tokens(template) !== tokens(original)) {
        ctx.prose.missing.add(address);
        template = original;
      }
    }
  }
  // Match the lower/mixed-case placeholders recognised by contentInterpolationTokens
  // as well as legacy leading-underscore uppercase names. Otherwise {years}
  // would pass validation but reach the player literally, without substitution.
  if (!template.includes('{')) return template;
  return template.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (token, name: string) => {
    // Values must be supplied by the caller, not inherited from Object.prototype.
    // Otherwise {constructor} and {toString} silently render function source.
    const value = Object.prototype.hasOwnProperty.call(values, name) ? values[name] : undefined;
    if (value === undefined) throw new Error(`Missing ${token} in core message ${key}`);
    return value;
  });
}
