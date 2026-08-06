import type {
  AbortSignalLike,
  Detector,
  DetectorCapabilities,
  DetectorContext,
  Evidence,
  NormalizedInput,
  Rationale,
} from '@xpx/kernel';
import { nullEvidence } from '@xpx/kernel';
import type { Classification, TextClassifier } from '@xpx/runtime';
import {
  CALIBRATION_ID,
  LABEL_ONLY_LLR,
  MIN_TOKENS,
  llrFromProbability,
  reliabilityFor,
} from './calibration.js';

export * from './calibration.js';

export interface SlopDetectorOptions {
  readonly classifier: TextClassifier;
  /**
   * Cargar el modelo bajo demanda al primer `score`.
   *
   * Por defecto **no**: son 253 MB, y ADR-005 obliga a que Tier 2 sea opt-in y
   * nunca automático. Con esto en `false`, un detector sin modelo cargado se
   * abstiene en lugar de disparar una descarga que el usuario no pidió.
   */
  readonly loadOnDemand?: boolean;
}

/**
 * Detector de texto generado por IA (Tier 2).
 *
 * Envuelve `distil-ai-slop-detector` —Gemma 3 270M destilado, Q4_K_M, wllama—
 * y traduce su salida a evidencia calibrada.
 *
 * Tier 2 y no Tier 1 por lo que cuesta: 253 MB de descarga y 0,5–2 s por
 * bloque. Con eso no se puede cumplir el presupuesto de primer veredicto por
 * debajo de 1 s en una página con decenas de bloques (ADR-005). Es el motor
 * para cuando el usuario pide una segunda opinión sobre algo concreto, no para
 * cada párrafo que aparece al hacer scroll.
 */
export class SlopDetector implements Detector {
  readonly id = 'slop-text';
  readonly version = '0.1.0';

  readonly capabilities: DetectorCapabilities;

  readonly #classifier: TextClassifier;
  readonly #loadOnDemand: boolean;

  constructor(opts: SlopDetectorOptions) {
    this.#classifier = opts.classifier;
    this.#loadOnDemand = opts.loadOnDemand ?? false;
    this.capabilities = {
      modalities: ['text'],
      tier: 2,
      languages: this.#classifier.model.languages,
      minInputTokens: MIN_TOKENS,
      requiresModel: {
        id: this.#classifier.model.id,
        version: this.#classifier.model.version,
      },
    };
  }

  canHandle(input: NormalizedInput): boolean {
    return (
      input.modality === 'text' &&
      input.text !== undefined &&
      input.text.length > 0 &&
      input.tokenCount >= MIN_TOKENS
    );
  }

  async warmup(): Promise<void> {
    await this.#classifier.load();
  }

  async score(input: NormalizedInput, ctx: DetectorContext): Promise<readonly Evidence[]> {
    const started = ctx.now();
    const text = input.text;
    if (text === undefined) return [this.#abstain(ctx.now() - started)];

    if (!this.#classifier.isReady()) {
      if (!this.#loadOnDemand) return [this.#abstain(ctx.now() - started)];
      await this.#classifier.load();
    }

    const result = await this.#classifier.classify(text, toAbortSignal(ctx.signal));

    // El modelo no reconoció ninguna de las dos etiquetas. Abstenerse es la
    // respuesta correcta; elegir una por defecto sería fabricar evidencia.
    if (result.label === 'uncertain') {
      return [this.#abstain(ctx.now() - started, 'SLOP_UNPARSEABLE_OUTPUT')];
    }

    const reliability = reliabilityFor({
      lang: input.lang,
      tokenCount: input.tokenCount,
      truncated: result.truncated,
      supportedLanguages: this.#classifier.model.languages,
    });

    // Fuera del dominio de validación no se emite opinión, aunque el modelo
    // haya respondido con seguridad. Un llr con reliability 0 no mueve la
    // fusión, pero dejar el llr a la vista invitaría a usarlo por error.
    if (reliability === 0) {
      return [this.#abstain(ctx.now() - started, 'SLOP_OUT_OF_DOMAIN')];
    }

    const { llr, rationale } = this.#interpret(result);

    return [
      {
        detectorId: this.id,
        detectorVersion: this.version,
        kind: 'statistical',
        modality: 'text',
        llr,
        reliability,
        calibrationId: CALIBRATION_ID,
        rationale,
        costMs: ctx.now() - started,
      },
    ];
  }

  async dispose(): Promise<void> {
    await this.#classifier.dispose();
  }

  #interpret(result: Classification): { llr: number; rationale: Rationale[] } {
    const towardsAi = result.label === 'ai_generated';

    if (result.pAiGenerated !== undefined) {
      const llr = llrFromProbability(result.pAiGenerated);
      return {
        llr,
        rationale: [
          {
            code: towardsAi ? 'SLOP_MODEL_SAYS_AI' : 'SLOP_MODEL_SAYS_HUMAN',
            contribution: llr,
            params: { p: round3(result.pAiGenerated) },
          },
        ],
      };
    }

    // Sin log-probabilidades: solo la etiqueta, con evidencia media.
    const llr = towardsAi ? LABEL_ONLY_LLR : -LABEL_ONLY_LLR;
    return {
      llr,
      rationale: [
        {
          code: towardsAi ? 'SLOP_MODEL_SAYS_AI' : 'SLOP_MODEL_SAYS_HUMAN',
          contribution: llr,
        },
        { code: 'SLOP_NO_LOGPROBS', contribution: 0 },
      ],
    };
  }

  #abstain(costMs: number, code?: string): Evidence {
    const base = nullEvidence(this.id, this.version, 'statistical', 'text', CALIBRATION_ID, costMs);
    if (code === undefined) return base;
    return { ...base, rationale: [{ code, contribution: 0 }] };
  }
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/**
 * El kernel usa `AbortSignalLike` —solo `{ aborted }`— para no depender del
 * DOM; wllama quiere un `AbortSignal` real. La conversión vive aquí, en el
 * borde.
 *
 * Un `AbortSignalLike` que no sea un `AbortSignal` de verdad no notifica
 * cambios: solo se puede leer su estado ahora. Envolverlo en un controlador que
 * nunca se dispara daría la falsa impresión de que la cancelación funciona, así
 * que se propaga el estado actual y nada más.
 */
function toAbortSignal(signal: AbortSignalLike): AbortSignal | undefined {
  if (typeof AbortSignal === 'undefined') return undefined;
  if (signal instanceof AbortSignal) return signal;
  return signal.aborted ? AbortSignal.abort() : undefined;
}
