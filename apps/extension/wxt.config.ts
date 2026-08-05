import { cp, readdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
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

  /**
   * MV3 en los cinco destinos, explícito.
   *
   * wxt aún usa MV2 por defecto en Firefox y Safari, y aceptarlo produciría
   * artefactos que contradicen la matriz de compatibilidad (§8) y el propio
   * requisito del producto. Firefox admite MV3 desde la 109 y Safari desde la
   * 16.4; ambos usan event page en lugar de service worker, que es exactamente
   * lo que `RuntimeHost` ya contempla para esas plataformas.
   */
  manifestVersion: 3,

  /**
   * Publica el artefacto en el directorio por navegador que ya existía en el
   * repositorio.
   *
   * Se hace en un hook y no con `--outDir` porque wxt no tiene esa opción de
   * línea de órdenes: los scripts que la pasaban fallaban antes de construir
   * nada. Copiar aquí mantiene la tabla de destinos en un solo sitio.
   */
  hooks: {
    'build:done': async (wxt) => {
      const target = OUTPUT_DIRS[wxt.config.browser];
      if (target === undefined) {
        wxt.logger.warn(`Sin directorio de salida definido para "${wxt.config.browser}"`);
        return;
      }
      const destino = resolve(wxt.config.root, target);
      await vaciarSalvoDocumentacion(destino);
      await cp(wxt.config.outDir, destino, { recursive: true });
      wxt.logger.success(`Artefacto publicado en ${target}`);
    },
  },

  manifest: ({ browser, manifestVersion }) => ({
    // Los textos viven en src/public/_locales. Declarar `default_locale` sin
    // ese árbol hace que el navegador se niegue a cargar la extensión, así que
    // nombre y descripción se referencian por clave y no en crudo.
    name: '__MSG_extName__',
    description: '__MSG_extDescription__',
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

/**
 * Deja el destino limpio antes de copiar, pero conserva el README versionado.
 *
 * Un `rm -rf` sin más borraría documentación que sí está en git; no limpiar
 * dejaría ficheros de builds anteriores mezclados con los nuevos, que es la
 * forma más silenciosa de publicar un artefacto con restos.
 */
async function vaciarSalvoDocumentacion(destino: string): Promise<void> {
  let entradas: string[];
  try {
    entradas = await readdir(destino);
  } catch {
    return; // Todavía no existe; `cp` lo creará.
  }
  await Promise.all(
    entradas
      .filter((e) => e !== 'README.md')
      .map((e) => rm(resolve(destino, e), { recursive: true, force: true })),
  );
}
