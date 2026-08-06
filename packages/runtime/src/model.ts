/**
 * Descriptores de modelo. Los pesos son **datos**, no código (ADR-003): se
 * descargan tras la instalación y nunca viajan en el paquete de la extensión.
 */

export interface ModelDescriptor {
  readonly id: string;
  readonly version: string;
  readonly url: string;
  /** Tamaño aproximado, para avisar al usuario antes de gastarle los datos. */
  readonly approxBytes: number;
  /** Idiomas en los que el modelo fue entrenado y evaluado. */
  readonly languages: readonly string[];
  /** Contexto máximo del modelo, en tokens. */
  readonly contextTokens: number;
}

/**
 * distil-labs/ai-slop-detector — Gemma 3 270M destilado de GPT-OSS 120B,
 * cuantizado a Q4_K_M. Apache-2.0.
 *
 * Los datos publicados por sus autores, que son los que gobiernan la
 * calibración del detector:
 *
 *   ~95 % de exactitud tras cuantizar (100 % en precisión completa)
 *   ~0,5–2 s por consulta en CPU de consumo
 *   entrenado y evaluado **en inglés**
 *
 * Ese último punto es el que más restringe el producto y el que más fácil sería
 * pasar por alto: el conjunto de entrenamiento es un dataset en inglés. Fuera
 * de ese idioma el modelo no está validado, y el detector lo refleja bajando la
 * fiabilidad a cero en vez de opinar igualmente.
 */
export const SLOP_MODEL: ModelDescriptor = {
  id: 'distil-slop-detector',
  version: 'v4-q4_k_m',
  url: 'https://huggingface.co/distil-labs/ai-slop-detector-v1-gguf/resolve/main/ai-slop-v4-q4_k_m.gguf',
  approxBytes: 253 * 1024 * 1024,
  languages: ['en'],
  contextTokens: 2048,
};
