import { RpcClient } from '@xpx/ipc';
import type { AbortLike, Channel, Validator } from '@xpx/ipc';
import type { ExtensionApi, PortLike } from './extension-api.js';
import { portTransport } from './port-transport.js';
import type { RuntimeHost } from './runtime-host.js';

/**
 * Host de inferencia en Chromium (Chrome, Edge, Opera).
 *
 * Usa un documento offscreen porque es el único contexto de la extensión que
 * cumple las tres condiciones a la vez: vida larga, sin DOM visible y
 * aislamiento adecuado para WebAssembly con hilos. El service worker de MV3 no
 * sirve —se duerme, y perdería el modelo cargado en cada siesta— y el content
 * script está descartado por arquitectura: la inferencia jamás corre en la
 * página del usuario.
 *
 * Los dos problemas reales que resuelve esta clase son de ciclo de vida:
 *
 * 1. **La carrera de arranque.** El service worker muere y revive
 *    constantemente, así que varias llamadas concurrentes pueden intentar crear
 *    el documento a la vez. `createDocument` falla si ya existe, y ese fallo es
 *    indistinguible de uno real si no se gestiona. La promesa de arranque se
 *    comparte para que solo haya un intento en vuelo.
 *
 * 2. **La caída del puerto.** Cuando el documento se cierra —por `teardown`, o
 *    porque el navegador lo reclama— el puerto muere con él. El host lo detecta
 *    y se marca como no listo, de modo que la siguiente llamada reconstruye
 *    documento y puerto en lugar de escribir sobre un canal muerto.
 */

export const OFFSCREEN_PATH = 'offscreen.html';
export const OFFSCREEN_PORT = 'xpx-inference';

export interface ChromiumHostOptions {
  readonly api: ExtensionApi;
}

export class ChromiumRuntimeHost implements RuntimeHost {
  readonly platform = 'chromium' as const;

  readonly #api: ExtensionApi;
  #starting: Promise<void> | undefined;
  #ready = false;
  #port: PortLike | undefined;
  #client: RpcClient | undefined;

  constructor(opts: ChromiumHostOptions) {
    this.#api = opts.api;
  }

  get isReady(): boolean {
    return this.#ready;
  }

  async ensure(): Promise<void> {
    if (this.#ready) return;
    // Varias llamadas concurrentes comparten el mismo arranque. Sin esto, dos
    // peticiones simultáneas tras despertar el service worker producirían dos
    // `createDocument` y la segunda fallaría.
    this.#starting ??= this.#start().finally(() => {
      this.#starting = undefined;
    });
    await this.#starting;
  }

  async run<TReq, TRes>(
    channel: Channel,
    payload: TReq,
    validate: Validator<TRes>,
    signal?: AbortLike,
  ): Promise<TRes> {
    await this.ensure();
    return this.#connection().request(channel, payload, validate, signal);
  }

  async teardown(): Promise<void> {
    this.#reset();

    const offscreen = this.#api.offscreen;
    if (offscreen === undefined) return;
    if (!(await this.#documentExists())) return;
    try {
      await offscreen.closeDocument();
    } catch {
      // Cerrar algo que ya no está no es un error que deba propagarse.
    }
  }

  async #start(): Promise<void> {
    const offscreen = this.#api.offscreen;
    if (offscreen === undefined) {
      throw new Error('chrome.offscreen no disponible: plataforma incorrecta');
    }

    if (await this.#documentExists()) {
      this.#ready = true;
      return;
    }

    try {
      await offscreen.createDocument({
        url: this.#api.runtime.getURL(OFFSCREEN_PATH),
        reasons: ['WORKERS'],
        justification:
          'Ejecutar los modelos de detección en un contexto aislado, fuera de la página del usuario.',
      });
    } catch (err) {
      // Otra invocación ganó la carrera: el documento ya existe, y eso es éxito,
      // no fallo. Cualquier otro error sí se propaga.
      if (!isAlreadyExistsError(err) && !(await this.#documentExists())) throw err;
    }

    this.#ready = true;
  }

  async #documentExists(): Promise<boolean> {
    const { runtime, offscreen } = this.#api;
    if (runtime.getContexts !== undefined) {
      const contexts = await runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
      return contexts.length > 0;
    }
    if (offscreen?.hasDocument !== undefined) return offscreen.hasDocument();
    return false;
  }

  /** Puerto y cliente RPC, creados a demanda y reconstruidos si se caen. */
  #connection(): RpcClient {
    const existing = this.#client;
    if (existing !== undefined) return existing;

    const port = this.#api.runtime.connect({ name: OFFSCREEN_PORT });
    const client = new RpcClient({ transport: portTransport(port) });

    port.onDisconnect.addListener(() => {
      // Solo si sigue siendo la conexión vigente: una desconexión tardía de un
      // puerto ya reemplazado no debe tumbar el actual.
      if (this.#client !== client) return;
      this.#reset();
    });

    this.#port = port;
    this.#client = client;
    return client;
  }

  /**
   * Deja el host como recién construido. `dispose` rechaza lo que quedara en
   * vuelo, que es lo correcto: esas peticiones ya no tienen quien las conteste.
   */
  #reset(): void {
    this.#ready = false;
    this.#starting = undefined;
    this.#client?.dispose();
    this.#client = undefined;
    try {
      this.#port?.disconnect();
    } catch {
      // Ya estaba desconectado.
    }
    this.#port = undefined;
  }
}

/**
 * Chrome no expone un código de error para esto: solo el mensaje. Se reconoce
 * por texto, y por eso el llamante vuelve a comprobar la existencia del
 * documento en lugar de fiarse únicamente de esta heurística.
 */
function isAlreadyExistsError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /only a single offscreen|already (exists|created)/i.test(message);
}
