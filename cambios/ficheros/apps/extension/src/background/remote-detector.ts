import type {
  Detector,
  DetectorCapabilities,
  DetectorContext,
  Evidence,
  NormalizedInput,
} from '@xpx/kernel';
import { nullEvidence } from '@xpx/kernel';
import { CALIBRATION_ID, MIN_TOKENS } from '@xpx/slop-detector';
import { SLOP_MODEL } from '@xpx/runtime';
import type { RuntimeHost } from '../platform/runtime-host.js';
import { isInferResponse } from '../shared/messages.js';
import type { InferRequest } from '../shared/messages.js';

/**
 * El detector de slop, visto desde el service worker.
 *
 * Implementa `Detector` como cualquier otro, pero su `score` no calcula nada:
 * cruza el puerto hasta el documento offscreen, donde vive el modelo. El
 * `Pipeline` no distingue entre este detector y uno local, que es justo lo que
 * permite que el kernel no sepa nada de puertos ni de navegadores.
 */
export class RemoteSlopDetector implements Detector {
  readonly id = 'slop-text';
  readonly version = '0.1.0';

  readonly capabilities: DetectorCapabilities = {
    modalities: ['text'],
    tier: 2,
    languages: SLOP_MODEL.languages,
    minInputTokens: MIN_TOKENS,
    requiresModel: { id: SLOP_MODEL.id, version: SLOP_MODEL.version },
  };

  readonly #host: RuntimeHost;

  constructor(host: RuntimeHost) {
    this.#host = host;
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
    await this.#host.ensure();
  }

  async score(input: NormalizedInput, ctx: DetectorContext): Promise<readonly Evidence[]> {
    const started = ctx.now();
    const text = input.text;
    if (text === undefined) return [this.#nothing(0)];

    const request: InferRequest = {
      hash: input.hash,
      text,
      lang: input.lang,
      tokenCount: input.tokenCount,
    };

    const response = await this.#host.run('infer', request, isInferResponse, ctx.signal);

    // El coste medido aquí incluye el viaje de ida y vuelta, que es el que de
    // verdad paga el usuario; el que reporta el detector remoto solo cuenta la
    // inferencia.
    const roundTrip = ctx.now() - started;
    return response.evidence.map((e) => ({ ...e, costMs: roundTrip }));
  }

  #nothing(costMs: number): Evidence {
    return nullEvidence(this.id, this.version, 'statistical', 'text', CALIBRATION_ID, costMs);
  }
}
