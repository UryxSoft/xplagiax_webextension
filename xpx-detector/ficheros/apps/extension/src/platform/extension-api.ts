/**
 * La superficie EXACTA del navegador de la que depende la extensión.
 *
 * Declararla como interfaz en lugar de tocar `chrome.*` directamente tiene tres
 * efectos que valen su coste: documenta la dependencia completa en un fichero,
 * permite probar el ciclo de vida sin navegador, y obliga a que cualquier API
 * nueva pase por una decisión consciente en vez de aparecer por conveniencia en
 * mitad de un módulo.
 *
 * Si algo no está aquí, no se usa. Ver 03-arquitectura.md §5.
 */

/**
 * Quién abrió un puerto.
 *
 * Solo interesa `tab`, y por una razón concreta: su presencia significa que
 * quien llama vive dentro de una página. Ese contexto es no privilegiado y no
 * puede pedir inferencia, así que `inference-server` lo rechaza. Sin este dato
 * la separación de privilegios de §11 no sería comprobable.
 */
export interface MessageSender {
  readonly tab?: { readonly id?: number };
  readonly id?: string;
  readonly url?: string;
}

/** Un puerto de `runtime.connect`. Es el canal duplex sobre el que va el RPC. */
export interface PortLike {
  /** El nombre con el que se conectó. Distingue un puerto nuestro de otro. */
  readonly name: string;
  postMessage(message: unknown): void;
  disconnect(): void;
  /** Ausente en el extremo que inicia la conexión; presente en el receptor. */
  readonly sender?: MessageSender;
  readonly onMessage: {
    addListener(cb: (message: unknown) => void): void;
    removeListener(cb: (message: unknown) => void): void;
  };
  readonly onDisconnect: {
    addListener(cb: () => void): void;
    removeListener(cb: () => void): void;
  };
}

export interface OffscreenApi {
  createDocument(opts: {
    url: string;
    reasons: readonly string[];
    justification: string;
  }): Promise<void>;
  closeDocument(): Promise<void>;
  /** Chrome < 116, antes de que existiera `runtime.getContexts`. */
  hasDocument?(): Promise<boolean>;
}

export interface RuntimeApi {
  getURL(path: string): string;
  connect(info: { name: string }): PortLike;
  /** Conexiones entrantes. Es por donde llegan content scripts y background. */
  readonly onConnect: {
    addListener(cb: (port: PortLike) => void): void;
    removeListener(cb: (port: PortLike) => void): void;
  };
  /**
   * Contextos vivos de la extensión. Es la forma fiable de saber si el
   * documento offscreen sigue en pie tras haberse dormido el service worker.
   */
  getContexts?(filter: { contextTypes: readonly string[] }): Promise<readonly unknown[]>;
}

export interface ExtensionApi {
  readonly runtime: RuntimeApi;
  /** Solo en Chromium. Firefox y Safari no lo tienen: ver ADR-004 y §8. */
  readonly offscreen?: OffscreenApi;
}

/** Lee la API global del navegador. Único punto donde se toca `chrome`. */
export function systemExtensionApi(): ExtensionApi {
  const g = globalThis as unknown as { chrome?: ExtensionApi; browser?: ExtensionApi };
  const api = g.chrome ?? g.browser;
  if (api === undefined) {
    throw new Error('sin API de extensión disponible en este contexto');
  }
  return api;
}
