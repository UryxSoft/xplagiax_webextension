import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const fuente = (paquete: string): string =>
  fileURLToPath(new URL(`./${paquete}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    // Los paquetes del workspace se resuelven a su fuente, no a `dist`: así los
    // tests no dependen de haber compilado antes.
    alias: {
      '@xpx/kernel': fuente('packages/kernel'),
      '@xpx/ipc': fuente('packages/ipc'),
      '@xpx/runtime': fuente('packages/runtime'),
      '@xpx/provenance': fuente('packages/detectors/provenance'),
      '@xpx/extinction-validator': fuente('packages/detectors/extinction-validator'),
      '@xpx/slop-detector': fuente('packages/detectors/slop'),
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
