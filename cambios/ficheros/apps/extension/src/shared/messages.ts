import type { Evidence, NormalizedInput } from '@xpx/kernel';
import type { Validator } from '@xpx/ipc';

/**
 * Cargas de los canales, con su validador al lado.
 *
 * Están juntas a propósito: un tipo sin validador es una promesa que nadie
 * comprueba, y estos mensajes cruzan desde el content script, que vive en la
 * página del usuario y no es de fiar.
 */

// --- canal 'infer': background → documento offscreen -----------------------

/** Lo mínimo que el detector necesita. Nunca la URL ni el DOM. */
export interface InferRequest {
  readonly hash: string;
  readonly text: string;
  readonly lang: string;
  readonly tokenCount: number;
}

export interface InferResponse {
  readonly evidence: readonly Evidence[];
}

export const isInferRequest: Validator<InferRequest> = (v): v is InferRequest =>
  isObject(v) &&
  isNonEmptyString(v['hash']) &&
  typeof v['text'] === 'string' &&
  v['text'].length > 0 &&
  // Techo de 200 KB por bloque. Sin límite, una página hostil puede pedir que
  // tokenicemos un megabyte y bloquear el host de inferencia.
  v['text'].length <= 200_000 &&
  isNonEmptyString(v['lang']) &&
  isFiniteNumber(v['tokenCount']);

export const isInferResponse: Validator<InferResponse> = (v): v is InferResponse =>
  isObject(v) && Array.isArray(v['evidence']);

// --- canal 'analyze': content script → background ---------------------------

export interface TextBlock {
  readonly hash: string;
  readonly text: string;
  readonly lang: string;
  readonly tokenCount: number;
}

export interface AnalyzeRequest {
  readonly blocks: readonly TextBlock[];
  /** Tier 2 solo si el usuario lo pidió para esta página (ADR-005). */
  readonly deep?: boolean;
}

export interface BlockVerdict {
  readonly hash: string;
  readonly band: string;
  readonly llrTotal: number;
  readonly abstentionReason?: string;
  readonly rationaleCodes: readonly string[];
  readonly elapsedMs: number;
}

export interface AnalyzeResponse {
  readonly verdicts: readonly BlockVerdict[];
}

/** Techo de bloques por petición: una página no dicta cuánto trabajo pedimos. */
export const MAX_BLOCKS_PER_REQUEST = 50;

export const isAnalyzeRequest: Validator<AnalyzeRequest> = (v): v is AnalyzeRequest => {
  if (!isObject(v)) return false;
  const blocks = v['blocks'];
  if (!Array.isArray(blocks) || blocks.length === 0) return false;
  if (blocks.length > MAX_BLOCKS_PER_REQUEST) return false;
  if (v['deep'] !== undefined && typeof v['deep'] !== 'boolean') return false;
  return blocks.every(isTextBlock);
};

export const isAnalyzeResponse: Validator<AnalyzeResponse> = (v): v is AnalyzeResponse =>
  isObject(v) && Array.isArray(v['verdicts']);

function isTextBlock(v: unknown): v is TextBlock {
  return (
    isObject(v) &&
    isNonEmptyString(v['hash']) &&
    typeof v['text'] === 'string' &&
    v['text'].length > 0 &&
    v['text'].length <= 200_000 &&
    isNonEmptyString(v['lang']) &&
    isFiniteNumber(v['tokenCount'])
  );
}

/** Adapta un bloque al contrato del kernel. */
export function toNormalizedInput(block: TextBlock): NormalizedInput {
  return {
    hash: block.hash,
    modality: 'text',
    text: block.text,
    lang: block.lang,
    tokenCount: block.tokenCount,
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}
