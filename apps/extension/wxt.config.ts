import { defineConfig } from 'wxt';

/**
 * Un solo código fuente, cinco artefactos.
 *
 * El repositorio ya tenía un directorio por navegador. No se desarrolla una
 * extensión distinta en cada uno: son DESTINOS DE BUILD. Mantener cinco copias
 * del código sería el error que toda la arquitectura evita — cinco bases que
 * divergen y, lo que es peor, cinco calibraciones distintas.
 *
 *   apps/extension/  ──build --browser chrome ──▶  chrome_extension/
 *                    ──build --browser firefox──▶  firefox_extension/
 *                    ──build --browser edge   ──▶  edge_extesion/
 *                    ──build --browser opera  ──▶  opera_extension/
 *                    ──build --browser safari ──▶  Safari_extension/
 *
 * Lo único específico de cada navegador vive en src/platform/, detrás de la
 * interfaz RuntimeHost. Ver 03-arquitectura.md §5 y §8.
 */

const OUTPUT_DIRS: Record<string, string> = {
  chrome: '../../chrome_extension',
  firefox: '../../firefox_extension',
  edge: '../../edge_extesion',
  opera: '../../opera_extension',
  safari: '../../Safari_extension',
};

export default defineConfig({
  srcDir: 'src',
  outDirTemplate: '{{browser}}',
  outDir: '.output',

  hooks: {
    'build:done': (wxt) => {
      const target = OUTPUT_DIRS[wxt.config.browser];
      if (target === undefined) {
        wxt.logger.warn(`Sin directorio de salida definido para "${wxt.config.browser}"`);
      }
    },
  },

  manifest: ({ browser, manifestVersion }) => ({
    name: 'XplagiaX',
    description:
      'Evalúa la procedencia y el origen del contenido de la web. Procesamiento local.',
    default_locale: 'es',

    // ADR-009: cero host_permissions en la instalación.
    permissions: [
      'storage',
      'activeTab',
      'scripting',
      // El documento offscreen solo existe en Chromium.
      ...(browser === 'firefox' || browser === 'safari' ? [] : ['offscreen']),
    ],
    optional_permissions: ['tabs'],
    host_permissions: [],
    optional_host_permissions: ['http://*/*', 'https://*/*'],

    // Sin código remoto, sin eval. Los pesos son datos (ADR-003); wasm-unsafe-eval
    // es para el runtime WebAssembly, que sí va empaquetado.
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },

    ...(manifestVersion === 3 && browser === 'firefox'
      ? { browser_specific_settings: { gecko: { id: 'extension@xplagiax.ca' } } }
      : {}),
  }),
});
