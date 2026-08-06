import { DetectorRegistry, Pipeline, applySensitivity, defaultPolicy } from '@xpx/kernel';
import type { ScoringPolicy, Sensitivity } from '@xpx/kernel';
import { ProvenanceDetector } from '@xpx/provenance';
import type { CryptoProvider } from '@xpx/provenance';
import { ExtinctionValidator } from '@xpx/extinction-validator';
import { SlopDetector } from '@xpx/slop-detector';
import type { TextClassifier } from '@xpx/runtime';

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
 * | texto  | `slop-text` (Tier 2) | veredicto real, **solo en inglés y opt-in** |
 *
 * El detector de texto llegó con `@xpx/slop-detector` y hay que entender sus
 * límites antes de confiar en él:
 *
 * - **Tier 2 significa que no corre solo.** 253 MB de modelo y 0,5–2 s por
 *   bloque; con `maxTier` en 1, que es el valor por defecto, ni se planifica.
 *   Es la segunda opinión sobre algo concreto, no el análisis de cada párrafo
 *   que aparece al hacer scroll (ADR-005).
 * - **Solo inglés.** El modelo se entrenó y evaluó en ese idioma. Fuera de él
 *   su fiabilidad es cero y el veredicto vuelve a ser abstención.
 * - **Sin clasificador inyectado no se registra.** Construir wllama exige
 *   navegador, y esta raíz de composición se prueba sin él.
 *
 * Sigue sin haber Tier 1, que es el que haría viable el análisis automático
 * dentro del presupuesto de 800 ms. Mientras no exista, el texto sin análisis
 * profundo se abstiene con `NO_EVIDENCE`, y eso es lo correcto: un llr sin su
 * conjunto de calibración no significa nada (ADR-006), así que inventar uno
 * para que «salga algo» sería peor que abstenerse.
 *
 * `ExtinctionValidator` no es un detector sino una etapa de validación: solo
 * interviene sobre una acusación ya formada y solo puede bajarla. Ahora que hay
 * detector de texto, por fin tiene sobre qué actuar.
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

  /**
   * Clasificador de texto para el detector Tier 2.
   *
   * Se inyecta en lugar de construirse aquí porque montar wllama exige un
   * navegador —WebAssembly, hilos, un contexto de vida larga— y esta raíz de
   * composición tiene que poder ejecutarse en un test de Node. Quien la llama
   * desde el documento offscreen sí tiene ese contexto.
   *
   * Sin clasificador no se registra el detector: el sistema se abstiene sobre
   * texto, que es exactamente lo que hacía antes de que existiera.
   */
  readonly textClassifier?: TextClassifier;
}

export function createRegistry(opts: CompositionOptions = {}): DetectorRegistry {
  const registry = new DetectorRegistry();

  registry.register(
    new ProvenanceDetector(opts.crypto !== undefined ? { crypto: opts.crypto } : {}),
  );

  if (opts.textClassifier !== undefined) {
    // `loadOnDemand` en true: si el planificador llega hasta este detector es
    // porque alguien pidió Tier 2 explícitamente, y esa petición ya es el
    // consentimiento para descargar el modelo.
    registry.register(new SlopDetector({ classifier: opts.textClassifier, loadOnDemand: true }));
  }

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
