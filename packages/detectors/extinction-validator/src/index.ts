import type {
  ValidationStage,
  ValidationInput,
  ValidationOutcome,
  NormalizedInput,
  Band,
} from '@xpx/kernel';
import { analyze, defaultConfig } from './heuristics.js';
import type { HeuristicConfig } from './heuristics.js';

export * from './heuristics.js';

export interface ExtinctionValidatorOptions {
  readonly config?: HeuristicConfig;
  /** Por encima de esto la heurística considera el texto generado. */
  readonly suspicionThreshold?: number;
  /** Por debajo de esto la heurística lo considera claramente humano. */
  readonly clearanceThreshold?: number;
  /** Mínimo de tokens para que la heurística tenga algo que decir. */
  readonly minTokens?: number;
}

/**
 * Umbrales de la biblioteca de patrones v0.1.
 *
 * Extinction documenta 0,65 como umbral de sospecha. Ese valor está calibrado
 * para *su* biblioteca de patrones, que es mucho mayor que la nuestra. Copiarlo
 * sería el error que ADR-006 previene: un umbral sin la calibración que le
 * corresponde no significa nada.
 *
 * Estos valores salen de la separación medida con nuestra biblioteca actual y
 * se revisan con cada cambio de patrones, junto al `calibrationId`.
 */
export const CALIBRATION_ID = 'ext-heur-v0.1';
const SUSPICION_V0_1 = 0.55;
const CLEARANCE_V0_1 = 0.4;

/**
 * Segunda opinión heurística sobre un veredicto ya formado.
 *
 * Solo interviene cuando el pipeline ha llegado a una conclusión acusatoria
 * (STRONG_SIGNAL o WEAK_SIGNAL) y la heurística **no la respalda**. En ese caso
 * baja la confianza.
 *
 * Lo que no hace, por diseño del pipeline (ADR-010): confirmar. Si la
 * heurística coincide en que el texto parece generado, el veredicto se queda
 * como estaba. Un método con ~80 % de precisión no tiene derecho a subir la
 * confianza de una acusación; solo a sembrar duda sobre ella.
 */
export class ExtinctionValidator implements ValidationStage {
  readonly id = 'extinction-heuristic';
  readonly version = '0.1.0';

  readonly #config: HeuristicConfig;
  readonly #suspicion: number;
  readonly #clearance: number;
  readonly #minTokens: number;

  constructor(opts: ExtinctionValidatorOptions = {}) {
    this.#config = opts.config ?? defaultConfig;
    this.#suspicion = opts.suspicionThreshold ?? SUSPICION_V0_1;
    this.#clearance = opts.clearanceThreshold ?? CLEARANCE_V0_1;
    this.#minTokens = opts.minTokens ?? 150;
  }

  appliesTo(input: NormalizedInput, band: Band): boolean {
    if (input.modality !== 'text') return false;
    if (input.text === undefined) return false;
    if (input.tokenCount < this.#minTokens) return false;
    // Nada que revisar si el sistema ya se abstuvo, y la procedencia
    // criptográfica no se discute con heurísticas.
    return band === 'STRONG_SIGNAL' || band === 'WEAK_SIGNAL';
  }

  validate(ctx: ValidationInput): ValidationOutcome {
    const text = ctx.input.text;
    if (text === undefined) {
      return { agreement: 'inconclusive', action: 'pass', reasonCode: 'NO_TEXT' };
    }

    const result = analyze(text, this.#config);

    // La heurística también sospecha: no aporta nada nuevo, pero tampoco
    // contradice. El veredicto sigue igual.
    if (result.probability >= this.#suspicion) {
      return {
        agreement: 'agree',
        action: 'pass',
        reasonCode: 'HEURISTIC_CONCURS',
      };
    }

    // La heurística ve un texto claramente humano frente a una acusación
    // fuerte. Contradicción seria: se fuerza la abstención.
    if (result.probability <= this.#clearance && ctx.band === 'STRONG_SIGNAL') {
      return {
        agreement: 'disagree',
        action: 'abstain',
        reasonCode: 'HEURISTIC_CONTRADICTS_STRONG',
      };
    }

    // La heurística no respalda la acusación. Se baja la confianza.
    if (result.probability < this.#suspicion) {
      return {
        agreement: 'disagree',
        action: 'downgrade',
        reasonCode: 'HEURISTIC_DOES_NOT_SUPPORT',
      };
    }

    return { agreement: 'inconclusive', action: 'pass', reasonCode: 'HEURISTIC_NEUTRAL' };
  }
}
