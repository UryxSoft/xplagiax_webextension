import type { NormalizedInput } from '@xpx/kernel';

/**
 * Normalización y hash del contenido antes de que cruce hacia el kernel.
 *
 * Dos responsabilidades que conviene no separar, porque el hash solo significa
 * algo sobre el texto **ya** normalizado:
 *
 * 1. Que dos textos visualmente idénticos produzcan el mismo hash. Es lo que
 *    hace útil la caché y lo que permite deduplicar sin guardar lo que el
 *    usuario leyó (05-flujo-de-datos.md §3).
 * 2. Que el detector reciba texto y no maquetación.
 *
 * Aquí no hay DOM. La extracción de bloques vive en el content script; esto es
 * TypeScript puro para poder probarlo sin navegador y reutilizarlo en el
 * servicio de API sin cambios.
 */

/** Solo la parte de WebCrypto que se usa. Inyectable para los tests. */
export interface SubtleLike {
  digest(algorithm: 'SHA-256', data: BufferSource): Promise<ArrayBuffer>;
}

export interface NormalizeOptions {
  readonly subtle?: SubtleLike;
  readonly domHints?: NormalizedInput['domHints'];
}

/**
 * Caracteres de ancho cero y marcas de dirección.
 *
 * Se eliminan por dos motivos distintos que apuntan al mismo sitio. Uno: dos
 * textos que se leen igual deben hashear igual, y un ZWSP invisible los
 * separaría. Dos: insertar caracteres invisibles entre letras es la evasión
 * más barata que existe contra un detector, porque rompe la tokenización sin
 * que el lector note nada.
 *
 * No se eliminan aquí los homoglifos (una "а" cirílica por una "a" latina):
 * esos sí cambian el significado para un hablante y su tratamiento pertenece a
 * un detector, no al normalizador.
 */
const INVISIBLES = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/gu;

/** Espacios «raros» que deben contar como espacio normal. */
const ESPACIOS = /[\t\n\r\f\v\u0020\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+/gu;

export function normalizeText(raw: string): string {
  return (
    raw
      // NFC primero: la misma letra acentuada puede venir compuesta o
      // descompuesta, y son secuencias de bytes distintas para el hash.
      .normalize('NFC')
      // Primero los invisibles: si no, un ZWSP entre dos espacios impediría
      // que la siguiente regla los viera como una sola tirada.
      .replace(INVISIBLES, '')
      .replace(ESPACIOS, ' ')
      .trim()
  );
}

/**
 * Recuento de tokens aproximado, por separación en espacios.
 *
 * Es una aproximación consciente y tiene consecuencias: el umbral
 * `policy.minTokens` (150) se compara contra este número, así que sobrestimar
 * haría analizar textos demasiado cortos y subestimar haría abstenerse de más.
 * Frente a un tokenizador BPE, esto sobrestima en lenguas aglutinantes y
 * subestima en las que no separan por espacios (japonés, chino, tailandés).
 *
 * Cuando llegue Tier 1 con su tokenizador real, este recuento debe sustituirse
 * por el suyo: dos definiciones distintas de «token» harían que el umbral
 * signifique cosas diferentes en cada tier.
 */
export function countTokens(normalized: string): number {
  if (normalized.length === 0) return 0;
  const porEspacios = normalized.split(' ').filter((t) => t.length > 0).length;
  // Las escrituras sin espacios darían 1 para un párrafo entero. Se aproxima
  // por caracteres, que es lo menos malo sin un tokenizador.
  if (porEspacios <= 1 && normalized.length > 20) return Math.ceil(normalized.length / 2);
  return porEspacios;
}

export async function sha256Hex(data: string | Uint8Array, subtle?: SubtleLike): Promise<string> {
  const impl = subtle ?? systemSubtle();
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  // Se copia a un ArrayBuffer propio: una vista sobre un búfer compartido haría
  // que el digest incluyera bytes ajenos.
  const digest = await impl.digest('SHA-256', bytes.slice());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function systemSubtle(): SubtleLike {
  const c = (globalThis as { crypto?: { subtle?: SubtleLike } }).crypto;
  if (c?.subtle === undefined) {
    throw new Error('WebCrypto no disponible en este contexto');
  }
  return c.subtle;
}

/** Prepara un bloque de texto para el kernel. */
export async function prepareText(
  raw: string,
  lang: string,
  opts: NormalizeOptions = {},
): Promise<NormalizedInput> {
  const text = normalizeText(raw);
  return {
    hash: await sha256Hex(text, opts.subtle),
    modality: 'text',
    text,
    lang: normalizeLang(lang),
    tokenCount: countTokens(text),
    ...(opts.domHints !== undefined ? { domHints: opts.domHints } : {}),
  };
}

/** Prepara una imagen. El hash es de los bytes, no de los píxeles decodificados. */
export async function prepareImage(
  rawBytes: Uint8Array,
  opts: NormalizeOptions = {},
): Promise<NormalizedInput> {
  return {
    hash: await sha256Hex(rawBytes, opts.subtle),
    modality: 'image',
    rawBytes,
    lang: 'und',
    tokenCount: 0,
    ...(opts.domHints !== undefined ? { domHints: opts.domHints } : {}),
  };
}

/**
 * `lang` viene del atributo del documento y puede traer cualquier cosa. El
 * kernel compara contra una lista de códigos ISO 639-1 en minúscula, así que
 * "ES", "es-419" y "es" deben acabar siendo lo mismo o la política de idiomas
 * validados fallaría por un detalle de mayúsculas.
 */
export function normalizeLang(lang: string): string {
  const base = lang.trim().toLowerCase().split(/[-_]/)[0] ?? '';
  return /^[a-z]{2,3}$/.test(base) ? base : 'und';
}
