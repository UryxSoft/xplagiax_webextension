import {
  approximateTokenCount,
  detectLanguage,
  hashText,
  isAnalyzable,
  normalizeText,
} from './segment.js';
import type { TextBlock } from '../shared/messages.js';

/**
 * Extracción de bloques de texto del documento.
 *
 * Reglas que no son negociables:
 * - Solo lo **visible**. Analizar texto oculto gastaría presupuesto en algo que
 *   el usuario no está leyendo.
 * - Se excluyen campos de entrada. Lo que la persona está escribiendo es suyo y
 *   no se toca, ni siquiera localmente.
 * - No se modifica el DOM. Esto solo lee.
 */

/** Elementos que contienen prosa. No se recorre el documento entero. */
const BLOCK_SELECTOR = 'p, article, section > div, li, blockquote, td';

/** Nada de lo que haya aquí dentro se lee. */
const EXCLUDED = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'CODE', 'PRE', 'KBD', 'SAMP',
  'INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'NAV', 'FOOTER',
]);

export interface ExtractedBlock extends TextBlock {
  /** El elemento del que salió, para poder pintar el overlay encima. */
  readonly element: Element;
}

export interface ExtractOptions {
  readonly root?: ParentNode;
  readonly maxBlocks?: number;
  readonly subtle: { digest(alg: string, data: BufferSource): Promise<ArrayBuffer> };
  readonly isVisible?: (el: Element) => boolean;
}

export async function extractBlocks(opts: ExtractOptions): Promise<ExtractedBlock[]> {
  const root = opts.root ?? document;
  const maxBlocks = opts.maxBlocks ?? 50;
  const visible = opts.isVisible ?? isVisibleInViewport;

  const blocks: ExtractedBlock[] = [];
  const seen = new Set<string>();

  for (const element of root.querySelectorAll(BLOCK_SELECTOR)) {
    if (blocks.length >= maxBlocks) break;
    if (isExcluded(element) || !visible(element)) continue;

    const text = normalizeText(element.textContent ?? '');
    if (!isAnalyzable(text)) continue;

    const hash = await hashText(text, opts.subtle);
    // Un contenedor y su párrafo producen el mismo texto: se analiza una vez.
    if (seen.has(hash)) continue;
    seen.add(hash);

    blocks.push({
      hash,
      text,
      lang: detectLanguage(text),
      tokenCount: approximateTokenCount(text),
      element,
    });
  }

  return blocks;
}

function isExcluded(el: Element): boolean {
  for (let node: Element | null = el; node !== null; node = node.parentElement) {
    if (EXCLUDED.has(node.tagName)) return true;
    if (node.getAttribute('contenteditable') === 'true') return true;
    if (node.getAttribute('aria-hidden') === 'true') return true;
  }
  return false;
}

/**
 * Visible de verdad: con caja, dentro del viewport ampliado y sin estar
 * transparente. El margen de una pantalla por arriba y por abajo hace que el
 * veredicto ya esté listo cuando el usuario llega al bloque.
 */
function isVisibleInViewport(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;

  const margin = window.innerHeight;
  if (rect.bottom < -margin || rect.top > window.innerHeight + margin) return false;

  const style = window.getComputedStyle(el);
  return style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
}
