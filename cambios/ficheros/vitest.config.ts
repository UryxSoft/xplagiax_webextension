import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@xpx/kernel': fileURLToPath(new URL('./packages/kernel/src/index.ts', import.meta.url)),
      '@xpx/ipc': fileURLToPath(new URL('./packages/ipc/src/index.ts', import.meta.url)),
      '@xpx/runtime': fileURLToPath(new URL('./packages/runtime/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['packages/**/test/**/*.test.ts', 'apps/**/test/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**', 'packages/detectors/*/src/**'],
      thresholds: {
        // El kernel es la pieza que no puede fallar.
        'packages/kernel/src/**': { statements: 90, branches: 85, functions: 90, lines: 90 },
      },
    },
  },
});
