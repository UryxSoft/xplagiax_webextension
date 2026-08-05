/**
 * Heurísticas estilométricas siguiendo el método publicado por
 * v81d/extinction (GPL-3.0-or-later). Ver NOTICE.md.
 *
 * Tres etapas: coincidencia de patrones ponderada, análisis del corpus
 * (diversidad léxica y burstiness) y normalización sigmoide.
 */

export interface Pattern {
  readonly id: string;
  readonly re: RegExp;
  /** Puntos que aporta el patrón. Positivo apunta a texto generado. */
  readonly score: number;
}

export interface HeuristicConfig {
  readonly patterns: readonly Pattern[];
  readonly alphaScale: number;
  readonly adjustmentThreshold: number;
  /** Peso de la diversidad léxica frente a la burstiness en la fluidez. */
  readonly lexicalWeight: number;
  /** Tamaño de ventana en palabras para el TTR deslizante. */
  readonly windowSize: number;
}

export interface HeuristicResult {
  /** Probabilidad en [0,1] de que el texto sea generado. */
  readonly probability: number;
  readonly rawAlpha: number;
  readonly typeTokenRatio: number;
  readonly burstiness: number;
  readonly fluency: number;
  readonly matches: readonly { id: string; count: number; points: number }[];
}

export const defaultConfig: HeuristicConfig = {
  patterns: defaultPatterns(),
  alphaScale: 1,
  adjustmentThreshold: 0.5,
  lexicalWeight: 0.5,
  windowSize: 100,
};

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/\p{L}[\p{L}\p{M}'-]*/gu) ?? [];
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?…])\s+/u)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Type-Token Ratio con ventana deslizante. El TTR global penaliza los textos
 * largos por construcción (a más palabras, más repetición inevitable), así que
 * se promedia por ventanas de tamaño fijo.
 */
export function typeTokenRatio(tokens: readonly string[], windowSize: number): number {
  if (tokens.length === 0) return 0;
  if (tokens.length <= windowSize) {
    return new Set(tokens).size / tokens.length;
  }

  let sum = 0;
  let windows = 0;
  for (let i = 0; i + windowSize <= tokens.length; i += windowSize) {
    const slice = tokens.slice(i, i + windowSize);
    sum += new Set(slice).size / slice.length;
    windows += 1;
  }
  return windows === 0 ? 0 : sum / windows;
}

/**
 * Burstiness: coeficiente de variación de la longitud de frase, acotado a
 * [0,1]. La escritura humana alterna frases largas y cortas; la generada
 * tiende a una longitud más uniforme.
 */
export function burstiness(sentences: readonly string[]): number {
  if (sentences.length < 2) return 0;

  const lengths = sentences.map((s) => tokenize(s).length).filter((n) => n > 0);
  if (lengths.length < 2) return 0;

  const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  if (mean === 0) return 0;

  const variance =
    lengths.reduce((acc, n) => acc + (n - mean) ** 2, 0) / lengths.length;
  const cv = Math.sqrt(variance) / mean;

  return Math.min(1, cv);
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

export function analyze(text: string, config: HeuristicConfig = defaultConfig): HeuristicResult {
  const tokens = tokenize(text);
  const sentences = splitSentences(text);

  let alpha = 0;
  const matches: { id: string; count: number; points: number }[] = [];

  for (const pattern of config.patterns) {
    const found = text.match(new RegExp(pattern.re.source, pattern.re.flags.includes('g') ? pattern.re.flags : `${pattern.re.flags}g`));
    const count = found?.length ?? 0;
    if (count === 0) continue;

    // Frecuencia con rendimiento decreciente: repetir un patrón diez veces no
    // vale diez veces más que una.
    const points = pattern.score * Math.min(2, Math.sqrt(count)) ** config.alphaScale;
    alpha += points;
    matches.push({ id: pattern.id, count, points });
  }

  const ttr = typeTokenRatio(tokens, config.windowSize);
  const burst = burstiness(sentences);

  // Fluidez alta = escritura variada = más probablemente humana.
  const fluency = config.lexicalWeight * ttr + (1 - config.lexicalWeight) * burst;

  const corpusLength = Math.max(1, tokens.length);
  const normalizedAlpha = alpha / Math.sqrt(corpusLength);
  const adjusted = normalizedAlpha - config.adjustmentThreshold - 0.5 * fluency;

  return {
    probability: sigmoid(adjusted),
    rawAlpha: alpha,
    typeTokenRatio: ttr,
    burstiness: burst,
    fluency,
    matches,
  };
}

/**
 * Patrones de partida. Es un conjunto propio y deliberadamente pequeño: una
 * lista de regex es un instrumento contundente y cada entrada debe ganarse su
 * sitio contra el corpus de equidad antes de subir de peso.
 *
 * Advertencia de sesgo: penalizar conectores formales castiga la prosa
 * académica y la de hablantes no nativos, que es exactamente el fallo
 * documentado del sector. Por eso las puntuaciones son bajas y el resultado
 * solo puede restar confianza, nunca acusar.
 */
function defaultPatterns(): readonly Pattern[] {
  return [
    { id: 'delve', re: /\bdelv(e|es|ing|ed)\s+into\b/giu, score: 1.2 },
    { id: 'tapestry', re: /\b(rich|vibrant|intricate)\s+tapestry\b/giu, score: 1.5 },
    { id: 'testament', re: /\bis\s+a\s+testament\s+to\b/giu, score: 1.0 },
    { id: 'navigate-landscape', re: /\bnavigat\w+\s+the\s+(complex\s+)?landscape\b/giu, score: 1.2 },
    { id: 'crucial-role', re: /\bplays?\s+a\s+(crucial|pivotal|vital)\s+role\b/giu, score: 0.8 },
    { id: 'in-conclusion', re: /\bin\s+conclusion\s*,/giu, score: 0.5 },
    { id: 'it-is-important', re: /\bit(?:'s|\s+is)\s+important\s+to\s+(note|remember)\b/giu, score: 0.6 },
    { id: 'not-only-but', re: /\bnot\s+only\b[^.!?]{0,80}\bbut\s+also\b/giu, score: 0.5 },
    { id: 'ever-evolving', re: /\bever[-\s]?(evolving|changing|growing)\b/giu, score: 0.9 },
    { id: 'unlock-potential', re: /\bunlock(ing)?\s+(the\s+)?(full\s+)?potential\b/giu, score: 0.9 },
    { id: 'dive-deep', re: /\b(let'?s\s+)?dive\s+(deep\s+)?into\b/giu, score: 0.7 },
    { id: 'furthermore-chain', re: /\b(furthermore|moreover|additionally)\s*,/giu, score: 0.3 },
    // Señal negativa: las erratas y las contracciones informales apuntan a humano.
    { id: 'informal-contraction', re: /\b(gonna|wanna|kinda|dunno|y'?all)\b/giu, score: -1.0 },
    { id: 'ellipsis-informal', re: /\.{3,}/gu, score: -0.4 },
  ];
}
