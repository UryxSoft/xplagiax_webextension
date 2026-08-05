/**
 * Modelo de evidencia. Ver ADR-006.
 *
 * Ningún detector devuelve una probabilidad. Devuelve un log-likelihood ratio
 * calibrado, para que la fusión pueda sumar en lugar de promediar y para que
 * "no lo sé" sea representable (llr = 0).
 */

export type Modality = 'text' | 'image' | 'video' | 'audio' | 'document';

export type EvidenceKind =
  | 'provenance'
  | 'watermark'
  | 'statistical'
  | 'heuristic'
  | 'user';

/** Qué llevó a un detector a opinar lo que opinó. Base del botón "¿Por qué?". */
export interface Rationale {
  /** Clave estable para i18n; la UI nunca muestra texto crudo del detector. */
  code: string;
  /** Contribución de este factor al llr del detector. */
  contribution: number;
  /** Offsets en el texto normalizado, si el factor es localizable. */
  span?: { start: number; end: number };
  /** Datos para interpolar en el mensaje traducido. */
  params?: Readonly<Record<string, string | number>>;
}

export interface Evidence {
  readonly detectorId: string;
  readonly detectorVersion: string;
  readonly kind: EvidenceKind;
  readonly modality: Modality;

  /**
   * log( P(evidencia | generado) / P(evidencia | humano) ).
   * Positivo apunta a generado, negativo a humano, 0 es no informativo.
   */
  readonly llr: number;

  /**
   * Fiabilidad en el contexto actual, en [0,1]. Cae a 0 cuando el detector
   * está fuera de su dominio de validación (idioma, longitud, modalidad).
   */
  readonly reliability: number;

  /** Conjunto de calibración que produjo este llr. Un llr sin él no significa nada. */
  readonly calibrationId: string;

  readonly rationale: readonly Rationale[];
  readonly costMs: number;
}

/** Evidencia nula: el detector se ejecutó y no tiene nada que aportar. */
export function nullEvidence(
  detectorId: string,
  detectorVersion: string,
  kind: EvidenceKind,
  modality: Modality,
  calibrationId: string,
  costMs = 0,
): Evidence {
  return {
    detectorId,
    detectorVersion,
    kind,
    modality,
    llr: 0,
    reliability: 0,
    calibrationId,
    rationale: [],
    costMs,
  };
}
