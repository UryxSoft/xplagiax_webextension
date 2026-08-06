import { Band } from '@xpx/kernel';
import type { Verdict } from '@xpx/kernel';

/**
 * Insignia mínima con el resumen de la página.
 *
 * **No es el motor de overlay** (hito S7). Es el mínimo que permite comprobar
 * en un navegador real que el circuito completo funciona, y se ciñe a las
 * reglas de ADR-008 que ya son irrenunciables:
 *
 * - Una única inserción en el DOM del host: un elemento raíz propio.
 * - Shadow root **cerrado**, para que la página no pueda leer ni alterar la
 *   interfaz —ni que un `MutationObserver` del sitio se vuelva loco con ella—.
 * - `dispose()` deja la página exactamente como estaba, sin residuos.
 *
 * Lo que todavía no hace, y hará S7: resaltar los pasajes, superponer capas
 * sobre las imágenes y reposicionarse al hacer scroll.
 */

const RAIZ = 'xpx-resumen';

const ETIQUETAS: Record<Band, string> = {
  [Band.ProvenanceConfirmed]: 'Procedencia verificada',
  [Band.StrongSignal]: 'Señal fuerte',
  [Band.WeakSignal]: 'Señal débil',
  [Band.InsufficientEvidence]: 'Evidencia insuficiente',
};

const COLORES: Record<Band, string> = {
  [Band.ProvenanceConfirmed]: '#0f766e',
  [Band.StrongSignal]: '#b45309',
  [Band.WeakSignal]: '#a16207',
  [Band.InsufficientEvidence]: '#52525b',
};

export interface BadgeHandle {
  dispose(): void;
}

export interface BadgeOptions {
  /** Si el análisis llegó a Tier 2. Cambia lo que se le puede decir al usuario. */
  readonly deep?: boolean;
}

export function renderBadge(
  doc: Document,
  verdicts: readonly Verdict[],
  opts: BadgeOptions = {},
): BadgeHandle {
  dispose(doc);

  const raiz = doc.createElement(RAIZ);
  // La página puede tener CSS agresivo con selectores de etiqueta desconocida.
  // `all: initial` corta la herencia antes de que empiece.
  raiz.setAttribute('style', 'all: initial; position: fixed; z-index: 2147483647;');
  const shadow = raiz.attachShadow({ mode: 'closed' });
  shadow.append(estilos(doc), panel(doc, verdicts, opts.deep ?? false));
  doc.body.append(raiz);

  return {
    dispose: () => {
      dispose(doc);
    },
  };
}

function dispose(doc: Document): void {
  for (const previo of doc.getElementsByTagName(RAIZ)) previo.remove();
}

function estilos(doc: Document): HTMLStyleElement {
  const style = doc.createElement('style');
  style.textContent = `
    :host { all: initial; }
    .panel {
      position: fixed; right: 16px; bottom: 16px; width: 264px;
      font: 13px/1.45 system-ui, -apple-system, sans-serif;
      background: #fff; color: #18181b;
      border: 1px solid #e4e4e7; border-radius: 12px;
      box-shadow: 0 8px 24px rgb(0 0 0 / 12%);
      padding: 14px 16px;
    }
    @media (prefers-color-scheme: dark) {
      .panel { background: #18181b; color: #fafafa; border-color: #3f3f46; }
    }
    .titulo { font-weight: 600; margin: 0 0 2px; }
    .sub { margin: 0 0 10px; opacity: .65; font-size: 12px; }
    ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
    li { display: flex; align-items: center; gap: 8px; }
    .punto { width: 8px; height: 8px; border-radius: 50%; flex: none; }
    .n { margin-left: auto; font-variant-numeric: tabular-nums; opacity: .75; }
    .nota { margin: 10px 0 0; font-size: 11px; opacity: .6; }
  `;
  return style;
}

function panel(doc: Document, verdicts: readonly Verdict[], deep: boolean): HTMLElement {
  const panel = doc.createElement('div');
  panel.className = 'panel';

  const titulo = doc.createElement('p');
  titulo.className = 'titulo';
  titulo.textContent = 'XplagiaX';

  const sub = doc.createElement('p');
  sub.className = 'sub';
  sub.textContent =
    verdicts.length === 0
      ? 'Nada analizable en esta página'
      : `${verdicts.length} ${verdicts.length === 1 ? 'bloque analizado' : 'bloques analizados'}`;

  panel.append(titulo, sub);

  const cuenta = new Map<Band, number>();
  for (const v of verdicts) cuenta.set(v.band, (cuenta.get(v.band) ?? 0) + 1);

  if (cuenta.size > 0) {
    const lista = doc.createElement('ul');
    // Orden fijo, de mayor a menor cautela, para que la lista no baile entre
    // análisis de la misma página.
    for (const band of [
      Band.ProvenanceConfirmed,
      Band.StrongSignal,
      Band.WeakSignal,
      Band.InsufficientEvidence,
    ]) {
      const n = cuenta.get(band);
      if (n === undefined) continue;
      const li = doc.createElement('li');
      const punto = doc.createElement('span');
      punto.className = 'punto';
      punto.style.background = COLORES[band];
      const texto = doc.createElement('span');
      texto.textContent = ETIQUETAS[band];
      const num = doc.createElement('span');
      num.className = 'n';
      num.textContent = String(n);
      li.append(punto, texto, num);
      lista.append(li);
    }
    panel.append(lista);
  }

  // Se dice explícitamente porque callarlo haría pensar que el texto salió
  // limpio, cuando lo que ocurre es que no se llegó a examinarlo.
  const nota = doc.createElement('p');
  nota.className = 'nota';
  nota.textContent = deep
    ? 'Análisis profundo. El detector de texto solo está validado en inglés; ' +
      'en otros idiomas se abstiene.'
    : 'Análisis rápido: el texto no se ha examinado. Usa «Análisis profundo» ' +
      'para activar el detector.';
  panel.append(nota);

  return panel;
}
