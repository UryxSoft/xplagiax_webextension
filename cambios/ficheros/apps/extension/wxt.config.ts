import { fileURLToPath } from 'node:url';
import { defineConfig } from 'wxt';

/**
 * Un solo código fuente, cinco artefactos.
 *
 * El repositorio ya tenía un directorio por navegador. No se desarrolla una
 * extensión distinta en cada uno: son DESTINOS DE BUILD. Mantener cinco copias
 * del código sería el error que toda la arquitectura evita — cinco bases que
 * divergen y, lo que es peor, cinco calibraciones distintas.
 *
 *   apps/extension/  ──build -b chrome ──▶ .output/chrome ──▶ chrome_extension/
 *
 * El segundo tramo lo hace scripts/publish-artifact.mjs, porque `wxt build` no
 * acepta un directorio de salida por CLI.
 *
 * Lo único específico de cada navegador vive en src/platform/, detrás de la
 * interfaz RuntimeHost. Ver 03-arquitectura.md §5 y §8.
 */

/**
 * Los paquetes del workspace se consumen desde su fuente, no desde `dist`.
 *
 * Evita un orden de build implícito —construir la extensión no exige haber
 * construido antes cinco paquetes— y garantiza que en el bundle haya una sola
 * copia del kernel. Es el mismo criterio que ya siguen tsconfig y vitest; las
 * tres listas describen el mismo grafo.
 */
const workspaceAliases = {
  '@xpx/ipc': fileURLToPath(new URL('../../packages/ipc/src/index.ts', import.meta.url)),
  '@xpx/kernel': fileURLToPath(new URL('../../packages/kernel/src/index.ts', import.meta.url)),
  '@xpx/runtime': fileURLToPath(new URL('../../packages/runtime/src/index.ts', import.meta.url)),
  '@xpx/slop-detector': fileURLToPath(
    new URL('../../packages/detectors/slop/src/index.ts', import.meta.url),
  ),
};

export default defineConfig({
  srcDir: 'src',
  outDirTemplate: '{{browser}}',
  outDir: '.output',

  vite: () => ({ resolve: { alias: workspaceAliases } }),

  manifest: ({ browser, manifestVersion }) => ({
    name: 'XplagiaX',
    description:
      'Evalúa la procedencia y el origen del contenido de la web. Procesamiento local.',
    default_locale: 'es',

    // El icono de la barra es el gesto del nivel 1 de ADR-009. Sin popup: el
    // clic dispara onClicked, que inyecta el analizador bajo activeTab.
    action: { default_title: 'Analizar esta página' },

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
    // ADR-009 sigue en pie: cero en la instalación. HuggingFace entra aquí
    // porque de ahí salen los pesos de Tier 2 (253 MB), y esa descarga solo
    // ocurre si el usuario activa el análisis profundo. Pedirlo al instalar
    // sería pedir permiso para algo que la mayoría nunca usará.
    optional_host_permissions: ['http://*/*', 'https://*/*', 'https://huggingface.co/*'],

    // El WebAssembly de wllama lo carga el documento offscreen. Va empaquetado:
    // ADR-003 permite descargar pesos, que son datos, nunca código.
    web_accessible_resources: [{ resources: ['wllama/*'], matches: ['<all_urls>'] }],

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
