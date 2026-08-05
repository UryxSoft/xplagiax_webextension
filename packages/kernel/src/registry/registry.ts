import type { Detector } from '../contracts/detector.js';
import type { NormalizedInput } from '../contracts/input.js';
import type { ValidationStage } from '../contracts/validation.js';

/**
 * Registro de detectores y etapas de validación. Ver 03-arquitectura.md §4.
 * Añadir capacidad de detección es registrar un paquete; el núcleo no cambia.
 */
export class DetectorRegistry {
  readonly #detectors = new Map<string, Detector>();
  readonly #validators = new Map<string, ValidationStage>();

  register(detector: Detector): this {
    if (this.#detectors.has(detector.id)) {
      throw new Error(`Detector duplicado: ${detector.id}`);
    }
    this.#detectors.set(detector.id, detector);
    return this;
  }

  registerValidator(stage: ValidationStage): this {
    if (this.#validators.has(stage.id)) {
      throw new Error(`Etapa de validación duplicada: ${stage.id}`);
    }
    this.#validators.set(stage.id, stage);
    return this;
  }

  get detectors(): readonly Detector[] {
    return [...this.#detectors.values()];
  }

  get validators(): readonly ValidationStage[] {
    return [...this.#validators.values()];
  }

  /**
   * Detectores aplicables a esta entrada, ordenados por tier ascendente para
   * que lo barato corra primero y pueda cortocircuitar lo caro.
   */
  plan(input: NormalizedInput, maxTier: 0 | 1 | 2): readonly Detector[] {
    return this.detectors
      .filter((d) => d.capabilities.tier <= maxTier)
      .filter((d) => d.capabilities.modalities.includes(input.modality))
      .filter((d) => languageSupported(d, input.lang))
      .filter((d) => meetsMinTokens(d, input))
      .filter((d) => d.canHandle(input))
      .sort((a, b) => a.capabilities.tier - b.capabilities.tier);
  }
}

function languageSupported(d: Detector, lang: string): boolean {
  const langs = d.capabilities.languages;
  return langs === 'any' || langs.includes(lang);
}

function meetsMinTokens(d: Detector, input: NormalizedInput): boolean {
  const min = d.capabilities.minInputTokens;
  return min === undefined || input.tokenCount >= min;
}
