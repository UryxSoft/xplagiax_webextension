import type { Evidence } from '../contracts/evidence.js';
import type { DetectorContext } from '../contracts/detector.js';
import type { NormalizedInput } from '../contracts/input.js';
import type { AbortSignalLike } from '../contracts/abort.js';
import { NEVER_ABORTED } from '../contracts/abort.js';
import { Band, AbstentionReason } from '../contracts/verdict.js';
import type { Verdict, ValidationTrace } from '../contracts/verdict.js';
import { fuse, emptyCorrelationModel } from '../evidence/fusion.js';
import type { CorrelationModel } from '../evidence/fusion.js';
import { decideBand, defaultPolicy, downgrade, cautionRank } from '../scoring/bands.js';
import type { ScoringPolicy } from '../scoring/bands.js';
import type { DetectorRegistry } from '../registry/registry.js';

export interface PipelineOptions {
  readonly registry: DetectorRegistry;
  readonly policy?: ScoringPolicy;
  readonly correlation?: CorrelationModel;
  readonly maxTier?: 0 | 1 | 2;
  readonly budgetMs?: number;
  readonly now?: () => number;
}

export interface AnalyzeOptions {
  readonly signal?: AbortSignalLike;
  readonly maxTier?: 0 | 1 | 2;
}

/**
 * Orquesta: detectores → fusión → banda → etapas de validación.
 *
 * Las etapas de validación corren al final y son monótonas hacia la cautela
 * (ADR-010): pueden degradar el veredicto o forzar la abstención, nunca
 * elevarlo. El pipeline impone esa garantía; no depende de que la etapa se
 * comporte bien.
 */
export class Pipeline {
  readonly #registry: DetectorRegistry;
  readonly #policy: ScoringPolicy;
  readonly #correlation: CorrelationModel;
  readonly #maxTier: 0 | 1 | 2;
  readonly #budgetMs: number;
  readonly #now: () => number;

  constructor(opts: PipelineOptions) {
    this.#registry = opts.registry;
    this.#policy = opts.policy ?? defaultPolicy;
    this.#correlation = opts.correlation ?? emptyCorrelationModel;
    this.#maxTier = opts.maxTier ?? 1;
    this.#budgetMs = opts.budgetMs ?? 800;
    this.#now = opts.now ?? (() => Date.now());
  }

  async analyze(input: NormalizedInput, opts: AnalyzeOptions = {}): Promise<Verdict> {
    const started = this.#now();
    const signal = opts.signal ?? NEVER_ABORTED;
    const maxTier = opts.maxTier ?? this.#maxTier;

    const detectors = this.#registry.plan(input, maxTier);
    const evidence: Evidence[] = [];

    for (const detector of detectors) {
      if (signal.aborted) break;

      const elapsed = this.#now() - started;
      const remaining = this.#budgetMs - elapsed;
      // Un análisis parcial es preferible a una página lenta.
      if (remaining <= 0) break;

      const ctx: DetectorContext = {
        signal,
        budgetMs: remaining,
        now: this.#now,
      };

      try {
        evidence.push(...(await detector.score(input, ctx)));
      } catch (err) {
        // Un detector que falla no derriba el análisis: aporta cero evidencia.
        // Se registra para el modo desarrollador, no se propaga.
        if (isAbortError(err)) break;
      }
    }

    const fusion = fuse(evidence, this.#correlation);
    const decision = decideBand(input, fusion, evidence, this.#policy);

    const { band, abstentionReason, validations } = await this.#runValidations(
      input,
      decision.band,
      decision.abstentionReason,
      fusion.llrTotal,
      evidence,
      signal,
    );

    return {
      hash: input.hash,
      band,
      llrTotal: fusion.llrTotal,
      interval: decision.interval,
      ...(abstentionReason !== undefined ? { abstentionReason } : {}),
      evidence,
      validations,
      elapsedMs: this.#now() - started,
    };
  }

  async #runValidations(
    input: NormalizedInput,
    initialBand: Band,
    initialReason: AbstentionReason | undefined,
    llrTotal: number,
    evidence: readonly Evidence[],
    signal: AbortSignalLike,
  ): Promise<{
    band: Band;
    abstentionReason: AbstentionReason | undefined;
    validations: readonly ValidationTrace[];
  }> {
    let band = initialBand;
    let abstentionReason = initialReason;
    const traces: ValidationTrace[] = [];

    for (const stage of this.#registry.validators) {
      if (signal.aborted) break;
      if (!stage.appliesTo(input, band)) continue;

      let outcome;
      try {
        outcome = await stage.validate({
          input,
          band,
          llrTotal,
          evidence,
          signal,
        });
      } catch {
        // Un validador que falla no puede alterar el veredicto en ningún sentido.
        continue;
      }

      const nextBand = applyValidationAction(band, outcome.action);

      // Garantía de monotonía, impuesta aquí y no confiada a la etapa:
      // el resultado nunca puede ser menos cauto que el de entrada.
      const safeBand =
        cautionRank(nextBand) >= cautionRank(band) ? nextBand : band;

      if (safeBand !== band) {
        band = safeBand;
        abstentionReason =
          band === Band.InsufficientEvidence
            ? AbstentionReason.ValidationVeto
            : undefined;
      }

      traces.push({
        stageId: stage.id,
        agreement: outcome.agreement,
        action: outcome.action,
        reasonCode: outcome.reasonCode,
      });
    }

    return { band, abstentionReason, validations: traces };
  }
}

function applyValidationAction(
  band: Band,
  action: 'pass' | 'downgrade' | 'abstain',
): Band {
  switch (action) {
    case 'pass':
      return band;
    case 'downgrade':
      return downgrade(band);
    case 'abstain':
      // La procedencia criptográfica no la veta una heurística.
      return band === Band.ProvenanceConfirmed ? band : Band.InsufficientEvidence;
  }
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}
