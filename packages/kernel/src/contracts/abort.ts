/**
 * TypeScript declara AbortSignal en lib.dom.d.ts, y el kernel compila sin DOM
 * (ADR-001). En lugar de relajar esa restricción, el kernel declara la forma
 * mínima que necesita. Un AbortSignal real la satisface estructuralmente, así
 * que los llamantes pasan el suyo sin adaptadores.
 */
export interface AbortSignalLike {
  readonly aborted: boolean;
}

/** Señal que nunca se dispara. Evita construir un AbortController en el kernel. */
export const NEVER_ABORTED: AbortSignalLike = { aborted: false };
