// Se importa el ESM construido y no la raíz del paquete: su `package.json` no
// declara `types` y apunta a `index.ts`, así que la raíz arrastra las fuentes
// de wllama a nuestro programa y las somete a nuestras reglas estrictas, que no
// son las suyas. `esm/` trae declaraciones ya compiladas.
import { Wllama } from '@wllama/wllama/esm/index.js';
import { RpcServer, IpcError, ErrorCode } from '@xpx/ipc';
import type { Transport } from '@xpx/ipc';
import { NEVER_ABORTED } from '@xpx/kernel';
import { WllamaTextClassifier } from '@xpx/runtime';
import type { WllamaLike } from '@xpx/runtime';
import { SlopDetector } from '@xpx/slop-detector';
import { OFFSCREEN_PORT } from '../../platform/chromium-host.js';
import { portTransport } from '../../platform/port-transport.js';
import type { PortLike } from '../../platform/extension-api.js';
import { isInferRequest, toNormalizedInput } from '../../shared/messages.js';
import type { InferResponse } from '../../shared/messages.js';

/**
 * El otro extremo del puerto que abre `ChromiumRuntimeHost`.
 *
 * Aquí es donde vive el modelo, y es el único sitio del sistema donde se
 * ejecuta inferencia: ni en el content script (es la página del usuario) ni en
 * el service worker (se duerme y perdería los 253 MB cargados en cada siesta).
 */

/**
 * Directorio base del WebAssembly, empaquetado con la extensión.
 *
 * Nunca un CDN: ADR-003 permite descargar **pesos** —que son datos— pero no
 * código ejecutable. Un `.wasm` remoto es código remoto, y además lo prohíbe la
 * política de las tiendas para MV3.
 */
const WASM_PATHS = { default: browserRuntime().getURL('wllama/') };

const classifier = new WllamaTextClassifier({
  wllama: new Wllama(WASM_PATHS) as unknown as WllamaLike,
  threads: navigator.hardwareConcurrency ?? 4,
});

// `loadOnDemand` en true: si una petición llega hasta aquí es porque el usuario
// ya activó Tier 2. La decisión de no descargar sin permiso se toma antes, en
// el background, que es quien conoce los ajustes.
const detector = new SlopDetector({ classifier, loadOnDemand: true });

browserRuntime().onConnect.addListener((port: PortLike & { name: string }) => {
  if (port.name !== OFFSCREEN_PORT) return;
  serve(portTransport(port));
});

function serve(transport: Transport): void {
  new RpcServer(transport).on('infer', isInferRequest, async (req): Promise<InferResponse> => {
    const input = toNormalizedInput(req);

    if (!detector.canHandle(input)) {
      throw new IpcError(ErrorCode.BadRequest, 'entrada fuera del dominio del detector');
    }

    const evidence = await detector.score(input, {
      signal: NEVER_ABORTED,
      // El presupuesto real lo impone el cliente por tiempo de espera del RPC.
      // Aquí no se recorta: 0,5–2 s por bloque es el coste conocido de Tier 2.
      budgetMs: Number.POSITIVE_INFINITY,
      now: () => Date.now(),
    });

    return { evidence };
  });
}

interface RuntimeWithConnect {
  getURL(path: string): string;
  onConnect: { addListener(cb: (port: PortLike & { name: string }) => void): void };
}

function browserRuntime(): RuntimeWithConnect {
  const g = globalThis as unknown as {
    chrome?: { runtime: RuntimeWithConnect };
    browser?: { runtime: RuntimeWithConnect };
  };
  const runtime = (g.chrome ?? g.browser)?.runtime;
  if (runtime === undefined) throw new Error('sin API de extensión en el documento offscreen');
  return runtime;
}
