import type { AbortSignalLike } from './abort.js';
import type { Evidence } from './evidence.js';
import type { NormalizedInput } from './input.js';
import type { Band } from './verdict.js';

/**
 * Etapa de validación: se ejecuta DESPUÉS de la fusión y revisa el veredicto
 * ya formado. Ver ADR-010.
 *
 * Garantía de monotonía, impuesta por el pipeline y no por convención: una
 * etapa de validación solo puede volver el veredicto MÁS cauto. Puede degradar
 * una banda o forzar la abstención; no puede elevarla ni convertir una
 * abstención en acusación.
 *
 * Esa restricción es la que permite incorporar un validador de precisión
 * moderada sin que pueda causar un falso positivo: en el peor caso pierde una
 * detección; nunca acusa a nadie.
 */
export interface ValidationStage {
  readonly id: string;
  readonly version: string;

  /** Si devuelve false, la etapa se omite sin coste. */
  appliesTo(input: NormalizedInput, band: Band): boolean;

  validate(
    ctx: ValidationInput,
  ): Promise<ValidationOutcome> | ValidationOutcome;
}

export interface ValidationInput {
  readonly input: NormalizedInput;
  readonly band: Band;
  readonly llrTotal: number;
  readonly evidence: readonly Evidence[];
  readonly signal: AbortSignalLike;
}

export interface ValidationOutcome {
  /** Si la etapa coincide con el veredicto fusionado. */
  readonly agreement: 'agree' | 'disagree' | 'inconclusive';

  /**
   * pass      → el veredicto sigue igual
   * downgrade → baja una banda (STRONG → WEAK → INSUFFICIENT)
   * abstain   → fuerza INSUFFICIENT_EVIDENCE
   */
  readonly action: 'pass' | 'downgrade' | 'abstain';

  /** Clave estable para i18n y para el modo desarrollador. */
  readonly reasonCode: string;
}
