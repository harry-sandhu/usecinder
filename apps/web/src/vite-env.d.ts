/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SITE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module '*.mdx' {
  import type { ComponentType } from 'react';

  const MDXComponent: ComponentType<Record<string, unknown>>;
  export default MDXComponent;
  export const meta: Record<string, unknown>;
}
