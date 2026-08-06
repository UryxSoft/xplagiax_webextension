import { DetectorRegistry, Pipeline } from '@xpx/kernel';
import type { Detector, Verdict } from '@xpx/kernel';
import { VerdictCache } from './verdict-cache.js';
import { toNormalizedInput } from '../shared/messages.js';
import type { AnalyzeRequest, AnalyzeResponse, BlockVerdict, TextBlock } from '../shared/messages.js';

export interface AnalyzerOptions {
  readonly detectors: readonly Detector[];
  readonly cache?: VerdictCache;
  /** Presupuesto por bloque. Tier 2 necesita mucho más que los 800 ms de Tier 1. */
  readonly budgetMs?: number;
  readonly deepBudgetMs?: number;
}

/**
 * Orquesta el análisis de una página: caché, pipeline y forma de la respuesta.
 *
 * Vive en el service worker y no en el content script porque es donde están la
 * caché y la política. El content script es no privilegiado: manda contenido
 * normalizado y recibe veredictos, nada más.
 */
export class Analyzer {
  readonly #pipeline: Pipeline;
  readonly #deepPipeline: Pipeline;
  readonly #cache: VerdictCache;

  constructor(opts: AnalyzerOptions) {
    const registry = new DetectorRegistry();
    for (const d of opts.detectors) registry.register(d);

    this.#cache = opts.cache ?? new VerdictCache();
    this.#pipeline = new Pipeline({
      registry,
      maxTier: 1,
      budgetMs: opts.budgetMs ?? 800,
    });
    // ADR-005: Tier 2 es opt-in. Vive en un pipeline aparte, con su propio
    // presupuesto, para que activarlo sea una decisión explícita y no el efecto
    // colateral de subir un número.
    this.#deepPipeline = new Pipeline({
      registry,
      maxTier: 2,
      budgetMs: opts.deepBudgetMs ?? 30_000,
    });
  }

  async analyze(request: AnalyzeRequest): Promise<AnalyzeResponse> {
    const deep = request.deep ?? false;
    const verdicts: BlockVerdict[] = [];

    for (const block of request.blocks) {
      // La caché solo sirve para el modo superficial: un análisis profundo es
      // precisamente lo que el usuario pide cuando el superficial no le bastó.
      if (!deep) {
        const hit = this.#cache.get(block.hash);
        if (hit !== undefined) {
          verdicts.push(hit);
          continue;
        }
      }

      const verdict = await this.#analyzeBlock(block, deep);
      this.#cache.set(block.hash, verdict);
      verdicts.push(verdict);
    }

    return { verdicts };
  }

  async #analyzeBlock(block: TextBlock, deep: boolean): Promise<BlockVerdict> {
    const pipeline = deep ? this.#deepPipeline : this.#pipeline;
    const verdict = await pipeline.analyze(toNormalizedInput(block));
    return summarize(verdict);
  }
}

/**
 * Reduce el veredicto a lo que el content script necesita.
 *
 * No cruza la frontera el `llr` de cada detector ni el texto: la página del
 * usuario recibe la banda, los códigos de explicación y poco más. Los códigos
 * son claves de i18n, nunca texto crudo de un detector.
 */
export function summarize(verdict: Verdict): BlockVerdict {
  return {
    hash: verdict.hash,
    band: verdict.band,
    llrTotal: verdict.llrTotal,
    ...(verdict.abstentionReason !== undefined
      ? { abstentionReason: verdict.abstentionReason }
      : {}),
    rationaleCodes: verdict.evidence.flatMap((e) => e.rationale.map((r) => r.code)),
    elapsedMs: verdict.elapsedMs,
  };
}
