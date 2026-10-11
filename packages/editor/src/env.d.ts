/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>;
  export default component;
}

/** Generated at build time from actual core msg() call sites; no TS parser ships. */
declare module 'virtual:ed-core-prose' {
  const entries: {
    address: string;
    file: string;
    text: string;
    interpolations: string[];
  }[];
  export default entries;
}
