// Se importa el ESM construido y no la raíz del paquete: el `package.json` de
// wllama no declara `types` y apunta a `index.ts`, así que la raíz arrastra sus
// fuentes a nuestro programa y las somete a nuestras reglas estrictas, que no
// son las suyas. `esm/` trae declaraciones ya compiladas.
import { Wllama } from '@wllama/wllama/esm/index.js';
import { WllamaTextClassifier } from '@xpx/runtime';
import type { TextClassifier, WllamaLike } from '@xpx/runtime';
import type { ExtensionApi } from './extension-api.js';

/**
 * Construye el clasificador de texto sobre wllama.
 *
 * Vive en `platform/` porque es lo único de la cadena de detección de texto que
 * necesita saber que existe un navegador: dónde está el WebAssembly y cuántos
 * hilos hay. `@xpx/runtime` declara la forma de wllama como interfaz y no lo
 * importa, así que esta función es la única costura entre ambos mundos — y el
 * único punto donde TypeScript comprueba que la API real encaja.
 */

/**
 * Directorio base del WebAssembly, empaquetado con la extensión.
 *
 * Nunca un CDN: ADR-003 permite descargar **pesos**, que son datos, pero no
 * código ejecutable. Un `.wasm` remoto es código remoto, y además lo prohíbe la
 * política de las tiendas para MV3.
 */
const WASM_DIR = 'wllama/';

export function createWllamaClassifier(api: ExtensionApi): TextClassifier {
  const wllama = new Wllama({ default: api.runtime.getURL(WASM_DIR) });

  return new WllamaTextClassifier({
    wllama: wllama as unknown as WllamaLike,
    threads: hardwareThreads(),
  });
}

/**
 * Hilos disponibles. Se deja uno libre: apropiarse de todos los núcleos haría
 * que la inferencia compitiera con el renderizado de la propia página que el
 * usuario está leyendo.
 */
function hardwareThreads(): number {
  const nav = (globalThis as { navigator?: { hardwareConcurrency?: number } }).navigator;
  const cores = nav?.hardwareConcurrency ?? 4;
  return Math.max(1, cores - 1);
}
