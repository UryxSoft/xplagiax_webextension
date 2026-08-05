import type { Evidence } from '../contracts/evidence.js';

/**
 * Fusión log-lineal de evidencia. Ver ADR-006.
 *
 * Los llr se suman, ponderados por fiabilidad y por un peso de decorrelación.
 * Promediar probabilidades sería más simple y produciría el fallo clásico del
 * sector: dos detectores con el mismo sesgo se refuerzan y generan un falso
 * positivo con alta confianza aparente.
 */

export interface CorrelationModel {
  /**
   * Correlación de errores estimada offline entre pares de detectores, en [0,1].
   * La clave es `${idA}|${idB}` con idA < idB lexicográficamente.
   */
  readonly pairwise: ReadonlyMap<string, number>;
}

export const emptyCorrelationModel: CorrelationModel = {
  pairwise: new Map(),
};

export interface FusionResult {
  readonly llrTotal: number;
  /** Peso efectivo total aplicado. 0 significa que no había evidencia utilizable. */
  readonly totalWeight: number;
  /** Desacuerdo entre fuentes informativas, en [0,1]. Alimenta la abstención. */
  readonly disagreement: number;
  readonly contributions: readonly EvidenceContribution[];
}

export interface EvidenceContribution {
  readonly detectorId: string;
  readonly llr: number;
  readonly reliability: number;
  readonly decorrelationWeight: number;
  readonly effective: number;
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Peso de decorrelación de un detector: se penaliza por lo correlacionado que
 * esté con el resto de detectores informativos presentes. Un detector que se
 * equivoca igual que otro aporta menos que uno que se equivoca distinto.
 */
function decorrelationWeight(
  target: Evidence,
  all: readonly Evidence[],
  model: CorrelationModel,
): number {
  let penalty = 0;
  for (const other of all) {
    if (other.detectorId === target.detectorId) continue;
    if (other.reliability <= 0 || other.llr === 0) continue;
    const rho = model.pairwise.get(pairKey(target.detectorId, other.detectorId)) ?? 0;
    penalty += rho * other.reliability;
  }
  return 1 / (1 + penalty);
}

export function fuse(
  evidence: readonly Evidence[],
  model: CorrelationModel = emptyCorrelationModel,
): FusionResult {
  const contributions: EvidenceContribution[] = [];
  let llrTotal = 0;
  let totalWeight = 0;

  for (const e of evidence) {
    // llr = 0 o reliability = 0 significan "no informativo": no participan.
    if (e.reliability <= 0 || e.llr === 0) {
      contributions.push({
        detectorId: e.detectorId,
        llr: e.llr,
        reliability: e.reliability,
        decorrelationWeight: 0,
        effective: 0,
      });
      continue;
    }

    const w = decorrelationWeight(e, evidence, model);
    const effective = e.llr * e.reliability * w;

    llrTotal += effective;
    totalWeight += e.reliability * w;
    contributions.push({
      detectorId: e.detectorId,
      llr: e.llr,
      reliability: e.reliability,
      decorrelationWeight: w,
      effective,
    });
  }

  return {
    llrTotal,
    totalWeight,
    disagreement: computeDisagreement(evidence),
    contributions,
  };
}

/**
 * Desacuerdo entre fuentes informativas: proporción del peso que apunta en la
 * dirección minoritaria. 0 = unanimidad, 1 = empate perfecto.
 */
export function computeDisagreement(evidence: readonly Evidence[]): number {
  let towardsGenerated = 0;
  let towardsHuman = 0;

  for (const e of evidence) {
    if (e.reliability <= 0 || e.llr === 0) continue;
    const weight = Math.abs(e.llr) * e.reliability;
    if (e.llr > 0) towardsGenerated += weight;
    else towardsHuman += weight;
  }

  const total = towardsGenerated + towardsHuman;
  if (total === 0) return 0;

  return (2 * Math.min(towardsGenerated, towardsHuman)) / total;
}
