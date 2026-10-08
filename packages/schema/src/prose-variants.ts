import type { Content } from './content-index.js';
import { contentInterpolationTokens, isContentProseField } from './prose.js';
import type { Issue, ValidationRule } from './validate.js';

/**
 * PLAIN ENGLISH MUST NAME THE ORIGINAL IT WAS REVIEWED AGAINST (#415).
 *
 * `address` is stable across rewording by design, which is exactly why it
 * cannot also tell us whether a counterpart is still current. `of` is a short,
 * deterministic fingerprint of the Original text. It is optional at the wire
 * boundary so old/editor-staged rows can still load; `prose/variants` reports a
 * missing value as stale until the author reviews and saves the counterpart.
 */

/**
 * A small non-cryptographic 64-bit fingerprint made from two independent
 * FNV-1a streams. This is a staleness detector, not an authority or signature:
 * it only needs to change reliably when an author changes the Original.
 */
function fnv32(text: string, seed: number): string {
  let hash = seed >>> 0;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function proseOriginalHash(text: string): string {
  return fnv32(text, 0x811c9dc5) + fnv32(text, 0x9e3779b9);
}

const ADDRESS = /^content:([^#]+)#(.+)$/;
const SEGMENT = /^([A-Za-z0-9_-]+)(?:\[(?:(id|key)=([^\]]+)|(\d+))\])?$/;

/**
 * Resolve a stable #411 content address against the actual bundle.
 *
 * The first authored identity also checks assembly provenance when it exists.
 * Without that check, `content:events/a.yaml#events[id=x].body` could resolve
 * event x even if x actually lives in b.yaml, which would make a misplaced
 * variant look valid merely because the id exists somewhere in the bundle.
 */
export function proseOriginalAt(content: Content, address: string): string | undefined {
  const parsed = ADDRESS.exec(address);
  if (!parsed) return undefined;
  const file = parsed[1]!;
  const parts = parsed[2]!.split('.');
  let current: unknown = content.bundle;
  let finalKey = '';

  for (let i = 0; i < parts.length; i++) {
    const segment = SEGMENT.exec(parts[i]!);
    if (!segment || !current || typeof current !== 'object' || Array.isArray(current)) return undefined;

    finalKey = segment[1]!;
    current = (current as Record<string, unknown>)[finalKey];
    const identityField = segment[2] as 'id' | 'key' | undefined;
    const identityValue = segment[3];
    const indexText = segment[4];

    if (identityField !== undefined && identityValue !== undefined) {
      if (!Array.isArray(current)) return undefined;
      // An author can type an invalid percent escape; a validator must report
      // a bad address rather than aborting the whole content validation pass.
      let wanted: string;
      try { wanted = decodeURIComponent(identityValue); }
      catch (error) {
        if (error instanceof URIError) return undefined;
        throw error;
      }
      current = current.find((item) => (
        item !== null
        && typeof item === 'object'
        && !Array.isArray(item)
        && (item as Record<string, unknown>)[identityField] === wanted
      ));
      if (current === undefined) return undefined;

      // Only the first identity is a top-level authored collection item.
      // Nested choice/outcome ids are intentionally not global content ids.
      if (i === 0) {
        const actualFile = content.sourceOf(wanted);
        if (actualFile !== undefined && actualFile !== file) return undefined;
      }
    } else if (indexText !== undefined) {
      if (!Array.isArray(current)) return undefined;
      current = current[Number(indexText)];
    }
  }

  // Resolving an arbitrary string (e.g. event.id) is not enough: it must
  // be a narrative prose field the shared #411 worklist can actually author.
  return typeof current === 'string' && isContentProseField(finalKey, current)
    ? current : undefined;
}

function sameTokens(a: string, b: string): boolean {
  const left = [...contentInterpolationTokens(a)].sort();
  const right = [...contentInterpolationTokens(b)].sort();
  return left.length === right.length && left.every((token, i) => token === right[i]);
}

const issue = (
  level: Issue['level'], rule: string, address: string, message: string,
): Issue => ({ level, rule, where: `prose:${address}`, message });

/**
 * The migration guardrail for #415.
 *
 * It deliberately does NOT call `proseIssues` on Plain English. The alternate
 * register is meant to be direct; Rothfuss/Dunsany voice checks apply only to
 * the Original fields that already own those contracts.
 */
export const proseVariantsRule: ValidationRule = {
  id: 'prose/variants',
  about: 'Plain English variants must resolve an Original, preserve interpolation tokens, and say which Original wording they were reviewed against.',
  check(content) {
    const issues: Issue[] = [];
    for (const variant of content.proseVariants) {
      const original = proseOriginalAt(content, variant.address);
      if (original === undefined) {
        issues.push(issue('error', this.id, variant.address,
          'variant address does not resolve to an authored Original in its named file'));
        continue;
      }

      if (!sameTokens(original, variant.plainenglish)) {
        issues.push(issue('error', this.id, variant.address,
          `Plain English interpolation tokens differ from Original: `
          + `Original [${contentInterpolationTokens(original).join(', ')}], `
          + `Plain English [${contentInterpolationTokens(variant.plainenglish).join(', ')}]`));
      }

      const expected = proseOriginalHash(original);
      if (variant.of !== expected) {
        issues.push(issue('warning', this.id, variant.address,
          variant.of === undefined
            ? `variant has no Original fingerprint; review it and set of: ${expected}`
            : `variant is stale: of is ${variant.of}, current Original is ${expected}`));
      }

      if (variant.plainenglish === original) {
        issues.push(issue('warning', this.id, variant.address,
          'Plain English is identical to Original — either simplify it or remove the redundant variant'));
      }
    }
    return issues;
  },
};
