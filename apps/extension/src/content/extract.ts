/**
 * Extracción de contenido analizable desde el DOM de la página.
 *
 * Es la pieza con más criterio de todo el content script, porque decide qué
 * llega al kernel y qué no. Tres reglas la gobiernan:
 *
 * 1. **Agrupar, no trocear.** El kernel se abstiene por debajo de 150 tokens.
 *    Un `<p>` típico ronda los 40. Enviar párrafo a párrafo produciría
 *    abstención en el 100 % de los casos, así que se agrupan los hermanos
 *    contiguos hasta alcanzar un tamaño con el que un veredicto signifique
 *    algo.
 *
 * 2. **Nunca leer lo que el usuario está escribiendo.** Campos de formulario,
 *    `contenteditable` y editores como Google Docs se saltan enteros. No es
 *    una optimización: analizar el borrador de alguien mientras lo teclea es
 *    exactamente el comportamiento que este producto no debe tener.
 *
 * 3. **Solo lo visible.** Lo oculto no lo ha leído nadie, y suele ser
 *    plantilla, menú desplegado o contenido de pestañas inactivas.
 */

/** Bloque de texto listo para normalizar. */
export interface TextBlock {
  readonly text: string;
  /** Elementos de los que salió, para poder señalarlos después. */
  readonly elements: readonly Element[];
  readonly isArticle: boolean;
  readonly isUserGenerated: boolean;
}

export interface ImageCandidate {
  readonly element: HTMLImageElement;
  readonly src: string;
  readonly width: number;
  readonly height: number;
}

export interface ExtractOptions {
  /** Tamaño al que se deja de agrupar. Por encima del mínimo del kernel. */
  readonly targetTokens?: number;
  /** Por debajo de esto un grupo se descarta en lugar de enviarse. */
  readonly minTokens?: number;
  /** Lado mínimo de una imagen para tomarla en serio. */
  readonly minImageSide?: number;
}

const TARGET_TOKENS = 220;
const MIN_TOKENS = 150;
const MIN_IMAGE_SIDE = 128;

/** Nada de esto es contenido: no se mira su interior. */
const IGNORADOS = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'TEMPLATE',
  'SVG',
  'CANVAS',
  'IFRAME',
  'OBJECT',
  'EMBED',
  'HEAD',
  'NAV',
  'FOOTER',
  'FORM',
  'INPUT',
  'TEXTAREA',
  'SELECT',
  'BUTTON',
  'CODE',
  'PRE',
]);

/** Elementos cuyo texto se considera una unidad. */
const BLOQUES = new Set(['P', 'LI', 'BLOCKQUOTE', 'DD', 'FIGCAPTION', 'TD', 'H1', 'H2', 'H3']);

/** Contenedores que marcan contenido escrito por usuarios, no por la web. */
const SELECTOR_UGC =
  '[itemprop="comment"], [data-testid*="comment" i], .comment, .comments, #comments, article[role="article"]';

/**
 * Superficies de edición. Si la página es una de estas, no se analiza nada.
 *
 * Google Docs no expone un `contenteditable` convencional —dibuja el texto en
 * capas propias— así que se reconoce por host. Es frágil por definición, y por
 * eso se combina con la comprobación genérica en lugar de sustituirla.
 */
const EDITORES = [
  'docs.google.com',
  'mail.google.com',
  'outlook.live.com',
  'outlook.office.com',
  'www.overleaf.com',
  'notion.so',
];

export function isEditingSurface(doc: Document): boolean {
  const host = doc.location?.hostname ?? '';
  if (EDITORES.some((h) => host === h || host.endsWith(`.${h}`))) return true;
  // Un editor genérico: hay una zona editable grande y con foco posible.
  const editables = doc.querySelectorAll('[contenteditable="true"], [contenteditable=""]');
  return editables.length > 0;
}

function esVisible(el: Element): boolean {
  if (el.hasAttribute('hidden')) return false;
  if (el.getAttribute('aria-hidden') === 'true') return false;

  const vista = el.ownerDocument.defaultView;
  // Sin vista no hay estilo calculado; se asume visible en lugar de descartar
  // todo el documento, que sería peor.
  if (vista === null) return true;

  const estilo = vista.getComputedStyle(el);
  if (estilo.display === 'none' || estilo.visibility === 'hidden') return false;
  return estilo.opacity !== '0';
}

function esIgnorado(el: Element): boolean {
  if (IGNORADOS.has(el.tagName.toUpperCase())) return true;
  const editable = el.getAttribute('contenteditable');
  return editable === '' || editable === 'true';
}

/** Aproximación por espacios, la misma que usa `countTokens`. */
function tokens(texto: string): number {
  return texto.split(/\s+/).filter((t) => t.length > 0).length;
}

/**
 * Recorre el documento y devuelve los elementos de bloque con texto propio,
 * en orden de aparición.
 */
function bloquesCandidatos(raiz: Element): Element[] {
  const salida: Element[] = [];

  const visitar = (el: Element): void => {
    if (esIgnorado(el) || !esVisible(el)) return;

    if (BLOQUES.has(el.tagName.toUpperCase())) {
      // Un bloque anidado dentro de otro (una lista dentro de un párrafo) se
      // deja al padre: partirlo daría dos fragmentos peores que uno.
      salida.push(el);
      return;
    }
    for (const hijo of el.children) visitar(hijo);
  };

  visitar(raiz);
  return salida;
}

function dentroDe(el: Element, selector: string): boolean {
  return el.closest(selector) !== null;
}

/**
 * Agrupa bloques contiguos hasta alcanzar `targetTokens`.
 *
 * Se corta el grupo cuando cambia la naturaleza del contenido —de artículo a
 * comentarios, por ejemplo— porque mezclar los dos daría un veredicto sobre
 * algo que no existe: ni el artículo ni el comentario, sino su promedio.
 */
export function extractTextBlocks(doc: Document, opts: ExtractOptions = {}): TextBlock[] {
  if (isEditingSurface(doc)) return [];

  const objetivo = opts.targetTokens ?? TARGET_TOKENS;
  const minimo = opts.minTokens ?? MIN_TOKENS;
  const cuerpo = doc.body;
  if (cuerpo === null) return [];

  const candidatos = bloquesCandidatos(cuerpo);
  const salida: TextBlock[] = [];

  let acumulado: Element[] = [];
  let texto = '';
  let esArticulo = false;
  let esUgc = false;

  const cerrar = (): void => {
    if (acumulado.length === 0) return;
    if (tokens(texto) >= minimo) {
      salida.push({
        text: texto.trim(),
        elements: acumulado,
        isArticle: esArticulo,
        isUserGenerated: esUgc,
      });
    }
    acumulado = [];
    texto = '';
  };

  for (const el of candidatos) {
    const propio = (el.textContent ?? '').trim();
    if (propio.length === 0) continue;

    const articulo = dentroDe(el, 'article, main, [role="main"]');
    const ugc = dentroDe(el, SELECTOR_UGC);

    // Cambio de naturaleza: se cierra el grupo antes de mezclar.
    if (acumulado.length > 0 && (articulo !== esArticulo || ugc !== esUgc)) cerrar();

    if (acumulado.length === 0) {
      esArticulo = articulo;
      esUgc = ugc;
    }

    acumulado.push(el);
    texto = texto.length === 0 ? propio : `${texto} ${propio}`;

    if (tokens(texto) >= objetivo) cerrar();
  }
  cerrar();

  return salida;
}

/**
 * Imágenes que merecen análisis.
 *
 * El filtro por tamaño no es cosmético: iconos, espaciadores y píxeles de
 * seguimiento son la mayoría de los `<img>` de una página, y analizarlos
 * gastaría el presupuesto en cosas que ningún usuario mira.
 */
export function extractImages(doc: Document, opts: ExtractOptions = {}): ImageCandidate[] {
  if (isEditingSurface(doc)) return [];
  const lado = opts.minImageSide ?? MIN_IMAGE_SIDE;

  const salida: ImageCandidate[] = [];
  for (const img of doc.querySelectorAll('img')) {
    if (!esVisible(img)) continue;
    const src = img.currentSrc || img.src;
    if (src.length === 0 || src.startsWith('data:')) continue;

    // `naturalWidth` es 0 si aún no ha cargado; se cae al atributo.
    const ancho = img.naturalWidth || img.width;
    const alto = img.naturalHeight || img.height;
    if (ancho < lado || alto < lado) continue;

    salida.push({ element: img, src, width: ancho, height: alto });
  }
  return salida;
}

/** Idioma declarado por el documento, sin normalizar. */
export function documentLang(doc: Document): string {
  return (
    doc.documentElement.getAttribute('lang') ??
    doc.querySelector('meta[http-equiv="content-language"]')?.getAttribute('content') ??
    ''
  );
}
