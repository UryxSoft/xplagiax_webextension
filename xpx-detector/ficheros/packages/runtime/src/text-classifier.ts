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

/**
 * La respuesta de wllama, con las formas que puede tomar.
 *
 * wllama no construye este objeto en JavaScript: devuelve tal cual el JSON que
 * emite llama.cpp dentro del WebAssembly. Eso significa que la forma exacta
 * depende del build del WASM y no se puede comprobar leyendo el paquete npm.
 * Por eso se aceptan las tres variantes conocidas del formato OAI y, si no
 * llega ninguna, se falla en voz alta en lugar de devolver texto vacío.
 */
export interface CompletionChoice {
  readonly text?: string;
  readonly message?: { readonly content?: string };
  readonly logprobs?: {
    readonly top_logprobs?: readonly Readonly<Record<string, number>>[];
  } | null;
}

export interface CompletionResponse {
  readonly choices?: readonly CompletionChoice[];
  /** Forma cruda de llama.cpp, sin envoltorio OAI. */
  readonly content?: string;
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

    const choice = response.choices?.[0];
    const rawOutput = extractText(response, choice);

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

/**
 * Saca el texto generado, sea cual sea la envoltura.
 *
 * Un formato inesperado NO se convierte en cadena vacía. Hacerlo produciría el
 * fallo más caro posible: la etiqueta se leería como `uncertain`, el detector
 * se abstendría, y todo el sistema parecería funcionar mientras nunca detecta
 * nada. Se prefiere un error con las claves reales, que se diagnostica en un
 * minuto.
 */
function extractText(response: CompletionResponse, choice: CompletionChoice | undefined): string {
  if (typeof choice?.text === 'string') return choice.text;
  if (typeof choice?.message?.content === 'string') return choice.message.content;
  if (typeof response.content === 'string') return response.content;

  const claves = Object.keys(response as Record<string, unknown>).join(', ');
  throw new Error(
    `respuesta de wllama con forma inesperada; claves: [${claves}]. ` +
      'Se esperaba choices[0].text, choices[0].message.content o content.',
  );
}
