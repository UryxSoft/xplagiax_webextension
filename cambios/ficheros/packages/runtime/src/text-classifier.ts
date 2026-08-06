import { SLOP_MODEL } from './model.js';
import type { ModelDescriptor } from './model.js';
import {
  MAX_CHARS,
  SAMPLING,
  STOP_SEQUENCES,
  buildPrompt,
  parseLabel,
  probabilityFromLogprobs,
} from './prompt.js';
import type { Label } from './prompt.js';

/**
 * La superficie EXACTA de wllama que se usa, declarada estructuralmente.
 *
 * El paquete no importa `@wllama/wllama`: así compila y se prueba sin WASM ni
 * navegador, y la instancia real la inyecta la extensión, donde TypeScript
 * comprueba la compatibilidad en la costura. Mismo criterio que `ExtensionApi`
 * para las APIs del navegador.
 */
export interface WllamaLike {
  loadModelFromUrl(url: string, params: LoadParams): Promise<void>;
  createCompletion(options: CompletionParams): Promise<CompletionResponse>;
  exit(): Promise<void>;
}

export interface LoadParams {
  readonly n_ctx: number;
  readonly n_threads?: number;
  readonly progressCallback?: (p: { loaded: number; total: number }) => void;
}

export interface CompletionParams {
  readonly prompt: string;
  readonly max_tokens: number;
  readonly temperature: number;
  readonly top_p: number;
  readonly stop: readonly string[];
  readonly logprobs?: number;
  readonly abortSignal?: AbortSignal;
}

export interface CompletionResponse {
  readonly choices: readonly {
    readonly text: string;
    readonly logprobs?: {
      readonly top_logprobs?: readonly Readonly<Record<string, number>>[];
    } | null;
  }[];
}

export interface Classification {
  readonly label: Label;
  /**
   * P(generado por IA) en [0,1], o `undefined` si el backend no aportó
   * log-probabilidades. Nunca se rellena con un valor inventado.
   */
  readonly pAiGenerated: number | undefined;
  readonly rawOutput: string;
  readonly costMs: number;
  /** Si el texto se truncó, el detector debe saberlo para ajustar fiabilidad. */
  readonly truncated: boolean;
}

export interface TextClassifier {
  readonly model: ModelDescriptor;
  isReady(): boolean;
  load(onProgress?: (percent: number) => void): Promise<void>;
  classify(text: string, signal?: AbortSignal): Promise<Classification>;
  dispose(): Promise<void>;
}

export interface WllamaClassifierOptions {
  readonly wllama: WllamaLike;
  readonly model?: ModelDescriptor;
  readonly threads?: number;
  readonly now?: () => number;
  /** Cuántos candidatos pedir del primer token. 0 desactiva las logprobs. */
  readonly topLogprobs?: number;
}

/**
 * Clasificador de texto sobre wllama.
 *
 * Como el `ChromiumRuntimeHost`, comparte la promesa de carga entre llamadas
 * concurrentes. Aquí importa más: son 253 MB, y dos descargas simultáneas no
 * solo desperdician la red del usuario, sino que pueden agotarle la memoria.
 */
export class WllamaTextClassifier implements TextClassifier {
  readonly model: ModelDescriptor;

  readonly #wllama: WllamaLike;
  readonly #threads: number | undefined;
  readonly #now: () => number;
  readonly #topLogprobs: number;
  #loading: Promise<void> | undefined;
  #ready = false;

  constructor(opts: WllamaClassifierOptions) {
    this.#wllama = opts.wllama;
    this.model = opts.model ?? SLOP_MODEL;
    this.#threads = opts.threads;
    this.#now = opts.now ?? (() => Date.now());
    this.#topLogprobs = opts.topLogprobs ?? 10;
  }

  isReady(): boolean {
    return this.#ready;
  }

  async load(onProgress?: (percent: number) => void): Promise<void> {
    if (this.#ready) return;
    this.#loading ??= this.#doLoad(onProgress).finally(() => {
      this.#loading = undefined;
    });
    await this.#loading;
  }

  async #doLoad(onProgress?: (percent: number) => void): Promise<void> {
    await this.#wllama.loadModelFromUrl(this.model.url, {
      n_ctx: this.model.contextTokens,
      ...(this.#threads !== undefined ? { n_threads: this.#threads } : {}),
      ...(onProgress !== undefined
        ? {
            progressCallback: ({ loaded, total }) => {
              if (total > 0) onProgress(Math.min(Math.round((loaded / total) * 100), 99));
            },
          }
        : {}),
    });
    this.#ready = true;
  }

  async classify(text: string, signal?: AbortSignal): Promise<Classification> {
    if (!this.#ready) throw new Error('modelo no cargado: llama a load() primero');

    const started = this.#now();
    const response = await this.#wllama.createCompletion({
      prompt: buildPrompt(text),
      max_tokens: 10,
      temperature: SAMPLING.temperature,
      top_p: SAMPLING.top_p,
      stop: STOP_SEQUENCES,
      ...(this.#topLogprobs > 0 ? { logprobs: this.#topLogprobs } : {}),
      ...(signal !== undefined ? { abortSignal: signal } : {}),
    });

    const choice = response.choices[0];
    const rawOutput = choice?.text ?? '';

    return {
      label: parseLabel(rawOutput),
      // Solo el PRIMER token decide entre las dos etiquetas; los siguientes ya
      // están condicionados por él y no aportan a la decisión binaria.
      pAiGenerated: probabilityFromLogprobs(choice?.logprobs?.top_logprobs?.[0]),
      rawOutput,
      costMs: this.#now() - started,
      truncated: text.length > MAX_CHARS,
    };
  }

  async dispose(): Promise<void> {
    this.#ready = false;
    this.#loading = undefined;
    await this.#wllama.exit();
  }
}
