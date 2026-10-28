/// <reference types="vite/client" />

// The only module that reads import.meta. Vite replaces import.meta.env.* with literals
// at build time (per build mode, like Angular's fileReplacements), so these values work
// the same in the SPA, the prerendered pages and the worker bundle.
export const environment = {
  production: import.meta.env.PROD,
  /** App base path: '/' locally, '/<repo>/' on GitHub Pages. */
  baseUrl: import.meta.env.BASE_URL,
  /** Worker -> UI snapshot rate. Pre-configured, not a user setting. */
  uiRefreshMs: 1000,
  /** Served as-is from public/, so it needs the base path. */
  wasmUrl: `${import.meta.env.BASE_URL}producer.wasm`,
  /** Instrument list, a static resource in public/resources/. */
  symbolsUrl: `${import.meta.env.BASE_URL}resources/sp500.json`,
} as const;
