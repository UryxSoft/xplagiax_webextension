import type { Evidence } from './evidence.js';

/**
 * Cuatro bandas, nunca un porcentaje desnudo. Ver ADR-007.
 *
 * INSUFFICIENT_EVIDENCE es el estado por defecto del que hay que salir con
 * evidencia, no un caso de error.
 */
export const Band = {
  ProvenanceConfirmed: 'PROVENANCE_CONFIRMED',
  StrongSignal: 'STRONG_SIGNAL',
  WeakSignal: 'WEAK_SIGNAL',
  InsufficientEvidence: 'INSUFFICIENT_EVIDENCE',
} as const;

export type Band = (typeof Band)[keyof typeof Band];

/** Por qué el sistema se abstuvo. Se muestra al usuario; nunca un genérico. */
export const AbstentionReason = {
  TooShort: 'TOO_SHORT',
  UnvalidatedLanguage: 'UNVALIDATED_LANGUAGE',
  IntervalCrossesThreshold: 'INTERVAL_CROSSES_THRESHOLD',
  DetectorDisagreement: 'DETECTOR_DISAGREEMENT',
  NoEvidence: 'NO_EVIDENCE',
  ValidationVeto: 'VALIDATION_VETO',
} as const;

export type AbstentionReason =
  (typeof AbstentionReason)[keyof typeof AbstentionReason];

export interface Verdict {
  readonly hash: string;
  readonly band: Band;

  /** Log-odds fusionadas. Uso interno y modo desarrollador; nunca se muestra crudo. */
  readonly llrTotal: number;

  /** Intervalo de predicción conforme sobre llrTotal. */
  readonly interval: { readonly lower: number; readonly upper: number };

  /** Presente si y solo si band === INSUFFICIENT_EVIDENCE. */
  readonly abstentionReason?: AbstentionReason;

  readonly evidence: readonly Evidence[];

  /** Trazas de las etapas de validación que se ejecutaron tras la fusión. */
  readonly validations: readonly ValidationTrace[];

  readonly elapsedMs: number;
}

export interface ValidationTrace {
  readonly stageId: string;
  readonly agreement: 'agree' | 'disagree' | 'inconclusive';
  readonly action: 'pass' | 'downgrade' | 'abstain';
  readonly reasonCode: string;
}

export function isAbstention(v: Verdict): boolean {
  return v.band === Band.InsufficientEvidence;
}
