/// <reference types="vitest" />

import { defineConfig } from 'vite';
import analog from '@analogjs/platform';
import tailwindcss from '@tailwindcss/vite';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  build: {
    target: ['es2020'],
  },
  resolve: {
    mainFields: ['module'],
  },
  worker: {
    // The producer worker uses ES imports and is loaded via `?worker`.
    format: 'es',
  },
  plugins: [
    analog({
      ssr: true,
      static: true,
      prerender: {
        routes: async () => ['/', '/settings'],
      },
      inlineStylesExtension: 'scss',
    }),
    tailwindcss(),
  ],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['src/test-setup.ts'],
    include: ['src/**/*.spec.ts'],
    reporters: ['default'],
  },
}));
