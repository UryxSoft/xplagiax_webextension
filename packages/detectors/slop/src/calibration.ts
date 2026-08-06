/**
 * Calibración del detector de slop.
 *
 * Aquí está la decisión que separa este detector de una integración ingenua del
 * modelo. El kernel no acepta probabilidades ni etiquetas: exige un
 * log-likelihood ratio con su `calibrationId` (ADR-006). Convertir una cosa en
 * la otra sin cuidado es la forma más fácil de fabricar certeza.
 */

export const CALIBRATION_ID = 'slop-gemma270m-q4-v0.1';

/**
 * Techo del |llr| que una sola llamada al modelo puede aportar.
 *
 * Los autores publican ~95 % de exactitud tras cuantizar. Un clasificador con
 * ese acierto no puede aportar más evidencia que ln(0,95/0,05) ≈ 2,94, por
 * seguro que "parezca" en una respuesta concreta. Sin este techo, una
 * probabilidad de 0,999 produciría llr ≈ 6,9 —evidencia de nivel criptográfico—
 * a partir de un modelo que se equivoca una vez de cada veinte.
 *
 * Es el error que ADR-006 previene y el mismo que ya evita el validador de
 * Extinction al no copiar el umbral 0,65 del proyecto original.
 */
export const QUANTIZED_ACCURACY = 0.95;
export const MAX_LLR = Math.log(QUANTIZED_ACCURACY / (1 - QUANTIZED_ACCURACY));

/**
 * Cuando no hay log-probabilidades solo queda la etiqueta, y una etiqueta sin
 * margen no distingue "clarísimo" de "por los pelos". Se le asigna la evidencia
 * media que corresponde a la exactitud publicada, no el techo.
 */
export const LABEL_ONLY_LLR = MAX_LLR * 0.6;

/**
 * Longitud por debajo de la cual el modelo no tiene material suficiente.
 *
 * El conjunto de entrenamiento son fragmentos tipo comentario o párrafo. Con
 * menos de esto la respuesta es ruido, y el detector prefiere abstenerse.
 */
export const MIN_TOKENS = 20;

/** Longitud a partir de la cual la fiabilidad es plena. */
const FULL_RELIABILITY_TOKENS = 60;

/**
 * Probabilidad → log-likelihood ratio, acotado por lo que el modelo puede
 * sostener.
 *
 * Con un clasificador entrenado sobre clases equilibradas, el logit de la
 * probabilidad es directamente el LLR: no hace falta corregir por prior.
 */
export function llrFromProbability(pAiGenerated: number): number {
  const p = clamp(pAiGenerated, 1e-6, 1 - 1e-6);
  const raw = Math.log(p / (1 - p));
  return clamp(raw, -MAX_LLR, MAX_LLR);
}

/**
 * Fiabilidad en [0,1] según lo lejos que esté la entrada del dominio en que el
 * modelo fue validado.
 *
 * Tres factores, todos documentados por sus autores:
 *
 * - **Idioma.** El dataset de entrenamiento es en inglés. Fuera de él el modelo
 *   no está validado, y opinar igualmente sería inventar cobertura. Cero.
 * - **Longitud.** Por debajo del mínimo no hay señal; entre el mínimo y el
 *   umbral pleno, la fiabilidad crece de forma continua en vez de saltar.
 * - **Truncado.** Si el texto se cortó en 1500 caracteres, el veredicto habla
 *   del fragmento, no del bloque completo.
 */
export function reliabilityFor(opts: {
  readonly lang: string;
  readonly tokenCount: number;
  readonly truncated: boolean;
  readonly supportedLanguages: readonly string[];
}): number {
  if (!opts.supportedLanguages.includes(normalizeLang(opts.lang))) return 0;
  if (opts.tokenCount < MIN_TOKENS) return 0;

  const span = FULL_RELIABILITY_TOKENS - MIN_TOKENS;
  const byLength = clamp((opts.tokenCount - MIN_TOKENS) / span, 0, 1);
  // El veredicto sigue siendo válido sobre lo que sí leyó, solo que parcial.
  const truncationPenalty = opts.truncated ? 0.85 : 1;

  return clamp(byLength * truncationPenalty, 0, 1);
}

function normalizeLang(lang: string): string {
  return lang.toLowerCase().split('-')[0] ?? '';
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}
