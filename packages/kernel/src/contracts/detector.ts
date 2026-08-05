import type { AbortSignalLike } from './abort.js';
import type { Evidence, Modality } from './evidence.js';
import type { NormalizedInput } from './input.js';

export interface DetectorCapabilities {
  readonly modalities: readonly Modality[];
  readonly tier: 0 | 1 | 2;
  /** Idiomas validados, o 'any' si el método es agnóstico (procedencia, marca de agua). */
  readonly languages: readonly string[] | 'any';
  readonly minInputTokens?: number;
  readonly requiresModel?: { readonly id: string; readonly version: string };
}

export interface DetectorContext {
  readonly signal: AbortSignalLike;
  /** Presupuesto restante para esta página, en milisegundos. */
  readonly budgetMs: number;
  readonly now: () => number;
}

/**
 * La única forma de añadir capacidad de detección. Ver 03-arquitectura.md §4.
 * Un detector detecta: no renderiza, no persiste, no decide política.
 */
export interface Detector {
  readonly id: string;
  readonly version: string;
  readonly capabilities: DetectorCapabilities;

  /** Rechazo barato antes de gastar recursos. Debe ser síncrono y sin efectos. */
  canHandle(input: NormalizedInput): boolean;

  warmup?(ctx: DetectorContext): Promise<void>;

  score(input: NormalizedInput, ctx: DetectorContext): Promise<readonly Evidence[]>;

  dispose?(): Promise<void>;
}
