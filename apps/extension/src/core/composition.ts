import { DetectorRegistry, Pipeline, applySensitivity, defaultPolicy } from '@xpx/kernel';
import type { ScoringPolicy, Sensitivity } from '@xpx/kernel';
import { ProvenanceDetector } from '@xpx/provenance';
import type { CryptoProvider } from '@xpx/provenance';
import { ExtinctionValidator } from '@xpx/extinction-validator';

/**
 * Raíz de composición: el único sitio donde se decide QUÉ detectores existen.
 *
 * El kernel no conoce a ninguno (ADR-001) y ningún detector conoce a otro. Que
 * el cableado viva en un solo fichero es lo que hace cierta esa afirmación:
 * añadir capacidad de detección es registrar aquí un paquete más.
 *
 * ## Estado real de la cobertura, a día de hoy
 *
 * | Modalidad | Detectores | Consecuencia |
 * |---|---|---|
 * | imagen | `provenance` (Tier 0) | veredicto real: C2PA, IPTC, EXIF, PNG |
 * | texto  | **ninguno** | el kernel se abstiene siempre, con `NO_EVIDENCE` |
 *
 * Esa abstención no es un fallo ni un hueco que tapar con una heurística: es la
 * respuesta correcta mientras no exista un detector de texto calibrado. Un llr
 * sin su conjunto de calibración no significa nada (ADR-006), así que inventar
 * uno para que «salga algo» sería peor que abstenerse.
 *
 * `ExtinctionValidator` NO cubre ese hueco, y conviene entender por qué: es una
 * etapa de validación, no un detector. Solo interviene sobre una acusación ya
 * formada y solo puede bajarla. Sin detector de texto no hay acusación que
 * revisar, así que hoy nunca llega a ejecutarse sobre texto.
 *
 * El detector estilométrico de Tier 0 y el clasificador ONNX de Tier 1 son los
 * hitos S4 y S6 del MVP.
 */

export interface CompositionOptions {
  /**
   * WebCrypto para verificar firmas C2PA. Sin él los manifiestos se detectan
   * pero no se verifican, y nunca alcanzan la banda de procedencia confirmada.
   */
  readonly crypto?: CryptoProvider;
  readonly sensitivity?: Sensitivity;
  readonly policy?: ScoringPolicy;
  readonly maxTier?: 0 | 1 | 2;
  readonly budgetMs?: number;
}

export function createRegistry(opts: CompositionOptions = {}): DetectorRegistry {
  const registry = new DetectorRegistry();

  registry.register(
    new ProvenanceDetector(opts.crypto !== undefined ? { crypto: opts.crypto } : {}),
  );

  // Etapas de validación: corren tras la fusión y solo hacia la cautela.
  registry.registerValidator(new ExtinctionValidator());

  return registry;
}

export function createPipeline(opts: CompositionOptions = {}): Pipeline {
  const base = opts.policy ?? defaultPolicy;
  const policy =
    opts.sensitivity !== undefined ? applySensitivity(base, opts.sensitivity) : base;

  return new Pipeline({
    registry: createRegistry(opts),
    policy,
    ...(opts.maxTier !== undefined ? { maxTier: opts.maxTier } : {}),
    ...(opts.budgetMs !== undefined ? { budgetMs: opts.budgetMs } : {}),
  });
}
