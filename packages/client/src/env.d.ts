/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>;
  export default component;
}

/**
 * The content, parsed on the build machine (issue #109). Path relative to
 * `packages/content` → the document's JSON, which `lib/content.ts` hands to
 * `assembleBundle` with `JSON.parse` for a parser.
 */
declare module 'virtual:ed-content' {
  const docs: Record<string, string>;
  export default docs;
}

/** Reviewed counterparts live in a separate chunk, loaded only on demand. */
declare module 'virtual:ed-prose-variants' {
  const packed: Record<string, unknown[]>;
  export default packed;
}
