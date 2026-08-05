/**
 * Temporizadores y señales de cancelación como interfaces inyectables.
 *
 * TypeScript declara `setTimeout` y `AbortSignal` en lib.dom.d.ts, y este
 * paquete compila sin DOM para poder correr también en el servicio de API
 * sobre Node. En lugar de relajar la restricción, se declara la forma mínima
 * necesaria: un `setTimeout` real y un `AbortSignal` real las satisfacen
 * estructuralmente.
 *
 * Efecto secundario útil: los tests controlan el tiempo sin trucos del
 * framework, simplemente pasando otro temporizador.
 */

export interface TimerApi {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface AbortLike {
  readonly aborted: boolean;
  addEventListener?(type: 'abort', listener: () => void, options?: { once?: boolean }): void;
  removeEventListener?(type: 'abort', listener: () => void): void;
}

interface GlobalTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** Temporizador del entorno. Existe en navegador, worker y Node por igual. */
export const systemTimers: TimerApi = {
  setTimeout: (fn, ms) => (globalThis as unknown as GlobalTimers).setTimeout(fn, ms),
  clearTimeout: (h) => (globalThis as unknown as GlobalTimers).clearTimeout(h),
};
