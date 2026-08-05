import { RpcServer } from '@xpx/ipc';
import type { Verdict } from '@xpx/kernel';
import { isVerdict, isWireInput } from '../messaging/wire.js';
import type { WireInput } from '../messaging/wire.js';
import type { ExtensionApi, PortLike } from '../platform/extension-api.js';
import { portTransport } from '../platform/port-transport.js';
import type { RuntimeHost } from '../platform/runtime-host.js';

/**
 * El canal que el background ofrece a los content scripts.
 *
 * Es la imagen especular de `startInferenceServer`, y la simetría es
 * deliberada: aquel **rechaza** a quien tenga `sender.tab`, este lo **exige**.
 * Entre los dos definen la frontera de privilegio de 03-arquitectura.md §11 sin
 * dejar un tercer camino: nadie que viva en una página llega al motor de
 * inferencia salvo pasando por aquí, y aquí solo se puede pedir una cosa.
 */

export const CONTENT_PORT = 'xpx-content';

export interface VerdictCache {
  get(hash: string): Verdict | undefined;
  set(hash: string, verdict: Verdict): void;
}

export interface AnalyzeServiceOptions {
  readonly api: ExtensionApi;
  readonly host: RuntimeHost;
  readonly cache?: VerdictCache;
  readonly onRejected?: (reason: 'wrong-port' | 'not-a-tab', port: PortLike) => void;
}

export interface AnalyzeService {
  readonly connectionCount: number;
  dispose(): void;
}

export function startAnalyzeService(opts: AnalyzeServiceOptions): AnalyzeService {
  const servers = new Map<PortLike, RpcServer>();
  const cache = opts.cache ?? new LruVerdictCache();
  // Peticiones en vuelo por hash: dos bloques idénticos en la misma página no
  // deben producir dos inferencias. Es el caso normal, no el raro — pies de
  // foto, cabeceras y avisos de cookies se repiten.
  const enVuelo = new Map<string, Promise<Verdict>>();

  const onConnect = (port: PortLike): void => {
    if (port.name !== CONTENT_PORT) {
      opts.onRejected?.('wrong-port', port);
      return;
    }

    // Solo un content script puede usar este canal. Otra superficie de la
    // extensión (popup, opciones) tiene rutas propias y más privilegio; que
    // entrara por aquí escondería un error de cableado.
    if (port.sender?.tab === undefined) {
      opts.onRejected?.('not-a-tab', port);
      port.disconnect();
      return;
    }

    // Se reenvía la forma de cable sin tocarla: decodificar aquí para volver a
    // codificar en el siguiente salto sería trabajo puro de ida y vuelta.
    const server = new RpcServer(portTransport(port)).on('analyze', isWireInput, (wire) =>
      analyzeOnce(wire),
    );
    servers.set(port, server);

    port.onDisconnect.addListener(() => {
      servers.get(port)?.dispose();
      servers.delete(port);
    });
  };

  async function analyzeOnce(wire: WireInput): Promise<Verdict> {
    const hit = cache.get(wire.hash);
    if (hit !== undefined) return hit;

    const yaPedido = enVuelo.get(wire.hash);
    if (yaPedido !== undefined) return yaPedido;

    const trabajo = opts.host
      .run<WireInput, Verdict>('infer', wire, isVerdict)
      .then((verdict) => {
        cache.set(wire.hash, verdict);
        return verdict;
      })
      .finally(() => {
        enVuelo.delete(wire.hash);
      });

    enVuelo.set(wire.hash, trabajo);
    return trabajo;
  }

  opts.api.runtime.onConnect.addListener(onConnect);

  return {
    get connectionCount() {
      return servers.size;
    },
    dispose() {
      opts.api.runtime.onConnect.removeListener(onConnect);
      for (const [port, server] of servers) {
        server.dispose();
        try {
          port.disconnect();
        } catch {
          // Ya estaba caído.
        }
      }
      servers.clear();
    },
  };
}

/**
 * Caché acotada, con desalojo del menos usado recientemente.
 *
 * El límite existe porque el service worker de MV3 puede vivir horas entre
 * siestas y una caché sin tope crecería con cada pestaña. Guarda veredictos
 * indexados por hash: nunca el texto, nunca la URL (05-flujo-de-datos.md §3).
 */
export class LruVerdictCache implements VerdictCache {
  readonly #map = new Map<string, Verdict>();
  readonly #max: number;

  constructor(max = 500) {
    this.#max = max;
  }

  get(hash: string): Verdict | undefined {
    const v = this.#map.get(hash);
    if (v === undefined) return undefined;
    // Releer lo mueve al final, que es donde vive lo reciente.
    this.#map.delete(hash);
    this.#map.set(hash, v);
    return v;
  }

  set(hash: string, verdict: Verdict): void {
    this.#map.delete(hash);
    this.#map.set(hash, verdict);
    if (this.#map.size <= this.#max) return;
    const masViejo = this.#map.keys().next();
    if (!masViejo.done) this.#map.delete(masViejo.value);
  }

  get size(): number {
    return this.#map.size;
  }
}
