import type { Evidence } from '../contracts/evidence.js';
import type { NormalizedInput } from '../contracts/input.js';
import { Band, AbstentionReason } from '../contracts/verdict.js';
import type { FusionResult } from '../evidence/fusion.js';

/**
 * Bandas y abstención. Ver ADR-007.
 *
 * La abstención es el estado por defecto del que hay que salir con evidencia.
 * Sus condiciones no son configurables: `sensitivity` mueve el umbral entre
 * WEAK y STRONG, y nada más. No existe configuración que permita al producto
 * ser injusto.
 */

export interface ScoringPolicy {
  /** Umbral de llr para STRONG_SIGNAL. Lo mueve la sensibilidad del usuario. */
  readonly strongThreshold: number;
  /** Umbral de llr para WEAK_SIGNAL. */
  readonly weakThreshold: number;
  /** Mínimo de tokens validado por debajo del cual se abstiene siempre. */
  readonly minTokens: number;
  /** Idiomas en los que el sistema está validado. Fuera de aquí, abstención. */
  readonly validatedLanguages: readonly string[];
  /** Desacuerdo por encima del cual se abstiene. */
  readonly maxDisagreement: number;
  /** Semiancho del intervalo conforme, del conjunto de calibración. */
  readonly intervalHalfWidth: number;
}

export const defaultPolicy: ScoringPolicy = {
  strongThreshold: 2.0,
  weakThreshold: 0.8,
  minTokens: 150,
  validatedLanguages: ['en', 'es'],
  maxDisagreement: 0.5,
  intervalHalfWidth: 0.7,
};

/** Sensibilidad del usuario: solo desplaza los umbrales. Nunca toca la abstención. */
export type Sensitivity = 'relaxed' | 'balanced' | 'strict';

export function applySensitivity(
  policy: ScoringPolicy,
  sensitivity: Sensitivity,
): ScoringPolicy {
  const shift = sensitivity === 'strict' ? -0.5 : sensitivity === 'relaxed' ? 0.5 : 0;
  return {
    ...policy,
    strongThreshold: policy.strongThreshold + shift,
    weakThreshold: policy.weakThreshold + shift,
  };
}

export interface BandDecision {
  readonly band: Band;
  readonly abstentionReason?: AbstentionReason;
  readonly interval: { readonly lower: number; readonly upper: number };
}

/** Procedencia verificada: evidencia dura que domina cualquier clasificador. */
function hasConfirmedProvenance(evidence: readonly Evidence[]): boolean {
  return evidence.some(
    (e) => e.kind === 'provenance' && e.reliability >= 1 && Math.abs(e.llr) >= 4,
  );
}

export function decideBand(
  input: NormalizedInput,
  fusion: FusionResult,
  evidence: readonly Evidence[],
  policy: ScoringPolicy = defaultPolicy,
): BandDecision {
  const interval = {
    lower: fusion.llrTotal - policy.intervalHalfWidth,
    upper: fusion.llrTotal + policy.intervalHalfWidth,
  };

  // La procedencia criptográfica se evalúa antes que cualquier umbral y no
  // está sujeta a las reglas de abstención: no es una estimación.
  if (hasConfirmedProvenance(evidence)) {
    return { band: Band.ProvenanceConfirmed, interval };
  }

  const abstain = (reason: AbstentionReason): BandDecision => ({
    band: Band.InsufficientEvidence,
    abstentionReason: reason,
    interval,
  });

  if (fusion.totalWeight <= 0) return abstain(AbstentionReason.NoEvidence);

  if (input.modality === 'text' && input.tokenCount < policy.minTokens) {
    return abstain(AbstentionReason.TooShort);
  }

  if (
    input.modality === 'text' &&
    !policy.validatedLanguages.includes(input.lang)
  ) {
    return abstain(AbstentionReason.UnvalidatedLanguage);
  }

  if (fusion.disagreement > policy.maxDisagreement) {
    return abstain(AbstentionReason.DetectorDisagreement);
  }

  // Si el intervalo cruza el umbral de decisión, no hay base para afirmar.
  if (
    interval.lower < policy.strongThreshold &&
    interval.upper > policy.strongThreshold
  ) {
    return abstain(AbstentionReason.IntervalCrossesThreshold);
  }

  if (fusion.llrTotal >= policy.strongThreshold) {
    return { band: Band.StrongSignal, interval };
  }
  if (fusion.llrTotal >= policy.weakThreshold) {
    return { band: Band.WeakSignal, interval };
  }

  // llr por debajo del umbral débil: no hay señal. Eso NO es "probablemente
  // humano" — es ausencia de evidencia, y así se comunica.
  return abstain(AbstentionReason.NoEvidence);
}

/** Orden de cautela. Índice mayor = más cauto. */
const CAUTION_ORDER: readonly Band[] = [
  Band.ProvenanceConfirmed,
  Band.StrongSignal,
  Band.WeakSignal,
  Band.InsufficientEvidence,
];

export function cautionRank(band: Band): number {
  return CAUTION_ORDER.indexOf(band);
}

/** Baja una banda hacia la cautela. Nunca la eleva. */
export function downgrade(band: Band): Band {
  if (band === Band.ProvenanceConfirmed) return Band.ProvenanceConfirmed;
  const next = CAUTION_ORDER[cautionRank(band) + 1];
  return next ?? Band.InsufficientEvidence;
}
