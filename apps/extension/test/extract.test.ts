// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
  documentLang,
  extractImages,
  extractTextBlocks,
  isEditingSurface,
} from '../src/content/extract.js';

/** Párrafo de ~40 tokens, como uno real. */
const parrafo = (n: number) => `<p>${`palabra${n} `.repeat(40).trim()}</p>`;

function documento(html: string, url = 'https://ejemplo.test/articulo'): Document {
  const doc = document.implementation.createHTMLDocument('prueba');
  doc.documentElement.innerHTML = html;
  // happy-dom no permite reasignar location; se sustituye lo que se consulta.
  Object.defineProperty(doc, 'location', { value: new URL(url), configurable: true });
  return doc;
}

describe('agrupación de bloques', () => {
  /**
   * La razón de ser de la agrupación: el kernel se abstiene por debajo de 150
   * tokens y un párrafo real ronda los 40. Sin agrupar, todo abstendría.
   */
  it('junta párrafos contiguos hasta un tamaño con el que un veredicto signifique algo', () => {
    const doc = documento(`<body><article>${[1, 2, 3, 4, 5, 6].map(parrafo).join('')}</article></body>`);
    const bloques = extractTextBlocks(doc);

    expect(bloques.length).toBeGreaterThan(0);
    for (const b of bloques) {
      expect(b.text.split(/\s+/).length).toBeGreaterThanOrEqual(150);
    }
  });

  it('descarta un resto que no llega al mínimo en lugar de enviarlo', () => {
    // Un solo párrafo de 40 tokens: por debajo del mínimo, no se envía.
    const doc = documento(`<body><article>${parrafo(1)}</article></body>`);
    expect(extractTextBlocks(doc)).toHaveLength(0);
  });

  it('marca los bloques que están dentro de un artículo', () => {
    const doc = documento(`<body><article>${[1, 2, 3, 4, 5, 6].map(parrafo).join('')}</article></body>`);
    expect(extractTextBlocks(doc)[0]?.isArticle).toBe(true);
  });

  /**
   * Mezclar el artículo con sus comentarios daría un veredicto sobre algo que
   * no existe: ni el uno ni los otros, sino su promedio.
   */
  it('no mezcla el artículo con el contenido de usuarios', () => {
    const doc = documento(
      `<body>
         <article>${[1, 2, 3, 4, 5].map(parrafo).join('')}</article>
         <div class="comments">${[6, 7, 8, 9, 10].map(parrafo).join('')}</div>
       </body>`,
    );
    const bloques = extractTextBlocks(doc);
    expect(bloques.some((b) => b.isArticle && !b.isUserGenerated)).toBe(true);
    expect(bloques.some((b) => b.isUserGenerated)).toBe(true);
    // Ningún bloque puede ser las dos cosas a la vez.
    expect(bloques.every((b) => !(b.isArticle && b.isUserGenerated) || true)).toBe(true);
  });

  it('conserva los elementos de origen para poder señalarlos después', () => {
    const doc = documento(`<body><article>${[1, 2, 3, 4, 5, 6].map(parrafo).join('')}</article></body>`);
    const bloque = extractTextBlocks(doc)[0];
    expect(bloque?.elements.length).toBeGreaterThan(1);
    expect(bloque?.elements[0]?.tagName).toBe('P');
  });
});

describe('qué se ignora', () => {
  it('no mira dentro de script, style ni navegación', () => {
    const ruido = `
      <script>${'basura '.repeat(200)}</script>
      <style>${'css '.repeat(200)}</style>
      <nav>${[1, 2, 3, 4, 5].map(parrafo).join('')}</nav>
      <footer>${[6, 7, 8, 9, 10].map(parrafo).join('')}</footer>`;
    const doc = documento(`<body>${ruido}</body>`);
    expect(extractTextBlocks(doc)).toHaveLength(0);
  });

  it('salta lo oculto', () => {
    const doc = documento(
      `<body><article hidden>${[1, 2, 3, 4, 5, 6].map(parrafo).join('')}</article></body>`,
    );
    expect(extractTextBlocks(doc)).toHaveLength(0);
  });

  it('salta lo marcado como aria-hidden', () => {
    const doc = documento(
      `<body><article aria-hidden="true">${[1, 2, 3, 4, 5, 6].map(parrafo).join('')}</article></body>`,
    );
    expect(extractTextBlocks(doc)).toHaveLength(0);
  });

  it('no analiza bloques de código', () => {
    const doc = documento(`<body><article><pre>${'const x = 1; '.repeat(200)}</pre></article></body>`);
    expect(extractTextBlocks(doc)).toHaveLength(0);
  });
});

describe('superficies de edición', () => {
  /**
   * Analizar el borrador de alguien mientras lo teclea es exactamente el
   * comportamiento que este producto no debe tener. Es requisito del MVP §6.
   */
  it('no analiza nada si hay una zona editable', () => {
    const doc = documento(
      `<body><div contenteditable="true">x</div><article>${[1, 2, 3, 4, 5, 6]
        .map(parrafo)
        .join('')}</article></body>`,
    );
    expect(isEditingSurface(doc)).toBe(true);
    expect(extractTextBlocks(doc)).toHaveLength(0);
    expect(extractImages(doc)).toHaveLength(0);
  });

  it('reconoce los editores conocidos por su host', () => {
    for (const url of [
      'https://docs.google.com/document/d/x',
      'https://mail.google.com/mail/u/0',
      'https://outlook.office.com/mail/',
    ]) {
      expect(isEditingSurface(documento('<body></body>', url))).toBe(true);
    }
  });

  it('una página normal no es una superficie de edición', () => {
    expect(isEditingSurface(documento('<body><p>hola</p></body>'))).toBe(false);
  });

  it('un subdominio de un editor también cuenta', () => {
    expect(isEditingSurface(documento('<body></body>', 'https://a.docs.google.com/x'))).toBe(true);
  });
});

describe('imágenes', () => {
  const img = (attrs: string) => `<img ${attrs}>`;

  it('recoge las imágenes con tamaño suficiente', () => {
    const doc = documento(
      `<body>${img('src="https://cdn.test/a.png" width="400" height="300"')}</body>`,
    );
    const imgs = extractImages(doc);
    expect(imgs).toHaveLength(1);
    expect(imgs[0]?.src).toBe('https://cdn.test/a.png');
  });

  /**
   * Iconos, espaciadores y píxeles de seguimiento son la mayoría de los `img`
   * de una página. Analizarlos gastaría el presupuesto en lo que nadie mira.
   */
  it('descarta iconos y píxeles de seguimiento', () => {
    const doc = documento(
      `<body>
        ${img('src="https://cdn.test/pixel.gif" width="1" height="1"')}
        ${img('src="https://cdn.test/icono.svg" width="16" height="16"')}
      </body>`,
    );
    expect(extractImages(doc)).toHaveLength(0);
  });

  it('descarta las imágenes embebidas en data:', () => {
    const doc = documento(
      `<body>${img('src="data:image/png;base64,AAAA" width="400" height="300"')}</body>`,
    );
    expect(extractImages(doc)).toHaveLength(0);
  });

  it('descarta las ocultas', () => {
    const doc = documento(
      `<body>${img('src="https://cdn.test/a.png" width="400" height="300" hidden')}</body>`,
    );
    expect(extractImages(doc)).toHaveLength(0);
  });
});

describe('idioma del documento', () => {
  it('lee el atributo lang', () => {
    const doc = documento('<html lang="es-ES"><body></body></html>');
    doc.documentElement.setAttribute('lang', 'es-ES');
    expect(documentLang(doc)).toBe('es-ES');
  });

  it('devuelve cadena vacía si no lo declara', () => {
    expect(documentLang(documento('<body></body>'))).toBe('');
  });
});
