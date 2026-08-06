/**
 * Protocolo de mensajes entre superficies de la extensión.
 *
 * Todo mensaje se valida en ambos extremos antes de tocar lógica de negocio.
 * No es ceremonia: el content script vive dentro de la página del usuario y
 * una página hostil puede intentar hablar con él. Un mensaje sin validar es
 * una vía directa hacia el contexto privilegiado. Ver 03-arquitectura.md §11.
 */

export const PROTOCOL_VERSION = 1;

export type Channel =
  | 'analyze' // content script → background: analiza este contenido
  | 'explain' // content script → background: dame el detalle de un veredicto
  | 'settings' // UI → background
  | 'infer'; // background → host de inferencia

export interface Envelope<T = unknown> {
  readonly v: number;
  readonly id: string;
  readonly channel: Channel;
  readonly kind: 'request' | 'response' | 'error';
  readonly payload: T;
}

export interface ErrorPayload {
  readonly code: ErrorCode;
  readonly message: string;
}

export const ErrorCode = {
  BadRequest: 'BAD_REQUEST',
  VersionMismatch: 'VERSION_MISMATCH',
  Timeout: 'TIMEOUT',
  Aborted: 'ABORTED',
  Internal: 'INTERNAL',
  Unavailable: 'UNAVAILABLE',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/**
 * Validador mínimo. Se prefiere a Zod o Valibot aquí porque este código corre
 * también en el content script, donde el presupuesto es de 15 KB gzip y una
 * librería de esquemas se lleva una fracción notable de él.
 */
export type Validator<T> = (value: unknown) => value is T;

/** Techo del identificador de correlación. Un id sin límite es memoria ajena. */
const MAX_ID_LENGTH = 64;

export function isEnvelope(v: unknown): v is Envelope {
  if (typeof v !== 'object' || v === null) return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e['v'] === 'number' &&
    typeof e['id'] === 'string' &&
    e['id'].length > 0 &&
    e['id'].length <= MAX_ID_LENGTH &&
    isChannel(e['channel']) &&
    (e['kind'] === 'request' || e['kind'] === 'response' || e['kind'] === 'error') &&
    'payload' in e
  );
}

const CHANNELS: readonly string[] = ['analyze', 'explain', 'settings', 'infer'];

export function isChannel(v: unknown): v is Channel {
  return typeof v === 'string' && CHANNELS.includes(v);
}

export function isErrorPayload(v: unknown): v is ErrorPayload {
  if (typeof v !== 'object' || v === null) return false;
  const e = v as Record<string, unknown>;
  return typeof e['code'] === 'string' && typeof e['message'] === 'string';
}

export class IpcError extends Error {
  override readonly name = 'IpcError';

  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Los errores internos no se propagan al llamante tal cual: el mensaje puede
 * contener rutas, contenido o detalles de implementación, y el content script
 * es un contexto no privilegiado dentro de una página ajena. Un `IpcError`
 * explícito sí viaja, porque quien lo lanzó decidió que fuera visible.
 */
export function sanitizeError(err: unknown): ErrorPayload {
  if (err instanceof IpcError) return { code: err.code, message: err.message };
  return { code: ErrorCode.Internal, message: 'error interno' };
}
