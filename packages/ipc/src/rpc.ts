import { systemTimers } from './env.js';
import type { AbortLike, TimerApi } from './env.js';
import {
  ErrorCode,
  IpcError,
  PROTOCOL_VERSION,
  isEnvelope,
  isErrorPayload,
  sanitizeError,
} from './protocol.js';
import type { Channel, Envelope, Validator } from './protocol.js';

/**
 * El canal físico por el que viajan los mensajes. Un puerto de `runtime.connect`,
 * un `MessagePort` o un par de funciones en un test lo satisfacen igual.
 *
 * Que sea esta interfaz y no el puerto del navegador lo que consume el RPC es
 * lo que permite probar el protocolo entero —correlación, tiempos de espera,
 * cancelación— sin navegador.
 */
export interface Transport {
  post(message: unknown): void;
  /** Registra un oyente y devuelve la función que lo da de baja. */
  subscribe(listener: (message: unknown) => void): () => void;
}

/**
 * Techo por defecto de una petición. Generoso a propósito: la primera llamada
 * tras despertar el service worker puede incluir arrancar el host de
 * inferencia y cargar un modelo. El presupuesto de 800 ms del primer veredicto
 * se controla arriba, en el planificador, no aquí.
 */
const DEFAULT_TIMEOUT_MS = 15_000;

let idCounter = 0;

/**
 * Identificador de correlación. No es un valor de seguridad —solo distingue
 * peticiones dentro de un mismo par de transportes— así que no necesita
 * entropía criptográfica, pero sí ser único frente a reinicios del contador.
 */
function defaultId(): string {
  idCounter = (idCounter + 1) >>> 0;
  return `${idCounter.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ---------------------------------------------------------------------------
// Servidor
// ---------------------------------------------------------------------------

interface Route {
  readonly validate: Validator<unknown>;
  readonly handle: (payload: never) => unknown;
}

/**
 * Extremo que atiende peticiones. Cada canal declara su validador junto al
 * manejador: no hay forma de registrar una ruta sin decir qué acepta.
 */
export class RpcServer {
  readonly #transport: Transport;
  readonly #routes = new Map<Channel, Route>();
  #unsubscribe: (() => void) | undefined;

  constructor(transport: Transport) {
    this.#transport = transport;
    this.#unsubscribe = transport.subscribe((m) => {
      void this.#receive(m);
    });
  }

  on<T, R>(
    channel: Channel,
    validate: Validator<T>,
    handle: (payload: T) => R | Promise<R>,
  ): this {
    this.#routes.set(channel, {
      validate: validate as Validator<unknown>,
      handle: handle as (payload: never) => unknown,
    });
    return this;
  }

  dispose(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    this.#routes.clear();
  }

  async #receive(message: unknown): Promise<void> {
    // Ruido del canal o de la página: se descarta en silencio. Responder a algo
    // que no es nuestro solo confirmaría a un tercero que estamos escuchando.
    if (!isEnvelope(message) || message.kind !== 'request') return;

    if (message.v !== PROTOCOL_VERSION) {
      this.#fail(message, ErrorCode.VersionMismatch, `versión de protocolo ${message.v} no soportada`);
      return;
    }

    const route = this.#routes.get(message.channel);
    if (route === undefined) {
      this.#fail(message, ErrorCode.Unavailable, `canal "${message.channel}" no atendido`);
      return;
    }

    if (!route.validate(message.payload)) {
      this.#fail(message, ErrorCode.BadRequest, 'carga con forma inesperada');
      return;
    }

    try {
      const result: unknown = await (route.handle as (p: unknown) => unknown)(message.payload);
      this.#reply(message, result);
    } catch (err) {
      const { code, message: text } = sanitizeError(err);
      this.#fail(message, code, text);
    }
  }

  #reply(request: Envelope, payload: unknown): void {
    this.#transport.post({
      v: PROTOCOL_VERSION,
      id: request.id,
      channel: request.channel,
      kind: 'response',
      payload,
    } satisfies Envelope);
  }

  #fail(request: Envelope, code: ErrorCode, message: string): void {
    this.#transport.post({
      v: PROTOCOL_VERSION,
      id: request.id,
      channel: request.channel,
      kind: 'error',
      payload: { code, message },
    } satisfies Envelope);
  }
}

// ---------------------------------------------------------------------------
// Cliente
// ---------------------------------------------------------------------------

interface Pending {
  readonly resolve: (value: never) => void;
  readonly reject: (err: unknown) => void;
  readonly validate: Validator<unknown>;
  readonly timer: unknown;
  readonly onAbort: (() => void) | undefined;
  readonly signal: AbortLike | undefined;
}

export interface RpcClientOptions {
  readonly transport: Transport;
  readonly timeoutMs?: number;
  readonly newId?: () => string;
  readonly timers?: TimerApi;
}

/**
 * Extremo que emite peticiones y correlaciona respuestas por id.
 *
 * Toda salida —respuesta, error, tiempo agotado, cancelación o cierre— pasa
 * por `#take`, que es el único punto donde se retira una petición pendiente.
 * Esa unicidad es lo que garantiza que un temporizador nunca sobrevive a su
 * petición y que una respuesta tardía no revive una promesa ya resuelta.
 */
export class RpcClient {
  readonly #transport: Transport;
  readonly #pending = new Map<string, Pending>();
  readonly #timeoutMs: number;
  readonly #newId: () => string;
  readonly #timers: TimerApi;
  #unsubscribe: (() => void) | undefined;

  constructor(opts: RpcClientOptions) {
    this.#transport = opts.transport;
    this.#timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#newId = opts.newId ?? defaultId;
    this.#timers = opts.timers ?? systemTimers;
    this.#unsubscribe = opts.transport.subscribe((m) => {
      this.#receive(m);
    });
  }

  /** Peticiones en vuelo. Expuesto para que los tests detecten fugas. */
  get pendingCount(): number {
    return this.#pending.size;
  }

  request<TReq, TRes>(
    channel: Channel,
    payload: TReq,
    validate: Validator<TRes>,
    signal?: AbortLike,
  ): Promise<TRes> {
    return new Promise<TRes>((resolve, reject) => {
      if (signal?.aborted === true) {
        reject(new IpcError(ErrorCode.Aborted, 'cancelado antes de enviar'));
        return;
      }
      if (this.#unsubscribe === undefined) {
        reject(new IpcError(ErrorCode.Unavailable, 'cliente cerrado'));
        return;
      }

      const id = this.#newId();

      const timer = this.#timers.setTimeout(() => {
        this.#take(id)?.reject(
          new IpcError(ErrorCode.Timeout, `sin respuesta en ${this.#timeoutMs} ms`),
        );
      }, this.#timeoutMs);

      const onAbort =
        signal === undefined
          ? undefined
          : () => {
              this.#take(id)?.reject(new IpcError(ErrorCode.Aborted, 'petición cancelada'));
            };
      if (signal !== undefined && onAbort !== undefined) {
        signal.addEventListener?.('abort', onAbort, { once: true });
      }

      this.#pending.set(id, {
        resolve: resolve as (value: never) => void,
        reject,
        validate: validate as Validator<unknown>,
        timer,
        onAbort,
        signal,
      });

      this.#transport.post({
        v: PROTOCOL_VERSION,
        id,
        channel,
        kind: 'request',
        payload,
      } satisfies Envelope);
    });
  }

  /** Cierra el cliente y rechaza lo que quedara en vuelo. */
  dispose(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    for (const id of [...this.#pending.keys()]) {
      this.#take(id)?.reject(new IpcError(ErrorCode.Unavailable, 'cliente cerrado'));
    }
  }

  #receive(message: unknown): void {
    if (!isEnvelope(message) || message.kind === 'request') return;

    // Una respuesta huérfana o duplicada no tiene destinatario. No es un error:
    // pasa siempre que una petición ya se canceló o agotó su tiempo.
    const pending = this.#take(message.id);
    if (pending === undefined) return;

    if (message.kind === 'error') {
      const payload = isErrorPayload(message.payload)
        ? message.payload
        : { code: ErrorCode.Internal, message: 'error interno' };
      pending.reject(new IpcError(payload.code, payload.message));
      return;
    }

    if (!pending.validate(message.payload)) {
      pending.reject(new IpcError(ErrorCode.BadRequest, 'respuesta con forma inesperada'));
      return;
    }
    pending.resolve(message.payload as never);
  }

  /**
   * Retira una petición y libera todo lo que colgaba de ella. Devuelve
   * `undefined` si ya se había retirado, que es la señal de "llegaste tarde".
   */
  #take(id: string): Pending | undefined {
    const pending = this.#pending.get(id);
    if (pending === undefined) return undefined;
    this.#pending.delete(id);
    this.#timers.clearTimeout(pending.timer);
    if (pending.onAbort !== undefined) {
      pending.signal?.removeEventListener?.('abort', pending.onAbort);
    }
    return pending;
  }
}
