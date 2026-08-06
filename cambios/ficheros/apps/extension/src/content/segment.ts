/**
 * Normalización y segmentación de texto. Lógica pura: sin DOM.
 *
 * Se separa de la extracción para poder probarla, que es lo que importa aquí —
 * de estas decisiones depende qué llega al modelo, y un cambio silencioso en la
 * segmentación desplaza los veredictos de toda la página.
 */

/** Bloques por debajo de esto no se analizan: no hay señal, solo ruido. */
export const MIN_CHARS = 120;

/**
 * Normaliza para deduplicar y cachear.
 *
 * Colapsa espacios y unifica comillas y guiones tipográficos, que las CMS
 * sustituyen de formas distintas: el mismo párrafo con comillas curvas o rectas
 * debe producir el mismo hash y analizarse una sola vez.
 */
export function normalizeText(raw: string): string {
  return raw
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Cuenta tokens de forma aproximada.
 *
 * No es el tokenizador del modelo y no pretende serlo: solo se usa para decidir
 * si un bloque merece análisis y para ajustar la fiabilidad. Cargar el
 * tokenizador real en el content script costaría más de lo que aporta.
 */
export function approximateTokenCount(text: string): number {
  const words = text.split(/\s+/).filter((w) => w.length > 0).length;
  // ~1,3 tokens por palabra es la relación habitual en inglés con BPE.
  return Math.round(words * 1.3);
}

/** ¿Merece la pena analizar este bloque? */
export function isAnalyzable(text: string): boolean {
  if (text.length < MIN_CHARS) return false;
  // Bloques sin apenas letras —tablas de cifras, código, menús— no son prosa.
  const letters = text.replace(/[^\p{L}]/gu, '').length;
  return letters / text.length > 0.5;
}

/**
 * Detección de idioma por palabras funcionales.
 *
 * Deliberadamente mínima. El detector solo está validado en inglés, así que lo
 * único que hace falta decidir es "inglés o no". Un identificador completo
 * pesaría más que todo el content script para responder la misma pregunta.
 *
 * Ante la duda devuelve `und`, que aguas arriba se traduce en abstención: es
 * preferible no opinar a opinar sobre un idioma que no se reconoció.
 */
const ENGLISH_MARKERS = [
  'the', 'and', 'of', 'to', 'in', 'is', 'that', 'it', 'for', 'with',
  'as', 'was', 'on', 'are', 'this', 'be', 'have', 'from', 'or', 'by',
];

export function detectLanguage(text: string): string {
  const words = text.toLowerCase().match(/[a-z']+/g);
  if (words === null || words.length < 20) return 'und';

  let hits = 0;
  for (const w of words) {
    if (ENGLISH_MARKERS.includes(w)) hits += 1;
  }
  // En prosa inglesa estas veinte palabras rondan el 25 % del texto. El umbral
  // se pone bajo porque el coste de un falso "und" (abstención) es menor que el
  // de analizar texto de otro idioma como si fuera inglés.
  return hits / words.length >= 0.08 ? 'en' : 'und';
}

/**
 * sha256 en hexadecimal. Es la clave de caché y lo único que se persiste del
 * contenido: del hash no se puede reconstruir lo que el usuario leyó.
 */
export async function hashText(
  text: string,
  subtle: { digest(alg: string, data: BufferSource): Promise<ArrayBuffer> },
): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
