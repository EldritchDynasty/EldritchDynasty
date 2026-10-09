import { contentInterpolationTokens } from '@ed/schema';
import { renderProse } from './prose.js';
import type { SimCtx } from './world.js';

/** Authored keys survive source-file moves and unrelated literal insertions. */
export function coreMessageAddress(key: string): string {
  return `core:messages#${encodeURIComponent(key)}`;
}

/** Select a template before inserting names or other already-visible values. */
export function msg(
  ctx: SimCtx,
  key: string,
  original: string,
  values: Readonly<Record<string, string>> = {},
): string {
  const address = coreMessageAddress(key);
  let template = renderProse(ctx, address, original);
  // Host-supplied core variants have no YAML validation boundary. An invalid
  // token set must not erase a name or add information the caller never gave.
  const tokens = (text: string) => contentInterpolationTokens(text).sort().join('\n');
  if (tokens(template) !== tokens(original)) {
    ctx.prose.missing.add(address);
    template = original;
  }
  return template.replace(/\{([A-Z_][A-Z0-9_]*)\}/g, (token, name: string) => {
    const value = values[name];
    if (value === undefined) throw new Error(`Missing ${token} in core message ${key}`);
    return value;
  });
}
