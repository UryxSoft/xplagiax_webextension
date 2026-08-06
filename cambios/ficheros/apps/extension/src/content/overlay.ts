import type { BlockVerdict } from '../shared/messages.js';

/**
 * Capa visual sobre la página. ADR-008: **no destructiva**.
 *
 * No se toca el DOM del sitio. Ni una clase, ni un atributo, ni un `<span>`
 * envolviendo texto. Todo vive en un único host con `shadow root` cerrado,
 * anclado al final del `body`, con marcas posicionadas en coordenadas
 * absolutas. Quitar la extensión debe dejar la página exactamente como estaba,
 * y eso solo se garantiza si nunca se entró a modificarla.
 *
 * El shadow root además aísla los estilos en ambas direcciones: la página no
 * puede deformar nuestras marcas, y nuestras marcas no pueden romper la página.
 */

const HOST_ID = 'xpx-overlay-root';

const STYLES = `
  :host { all: initial; }
  .layer {
    position: absolute; inset: 0; pointer-events: none;
    z-index: 2147483000;
  }
  .mark {
    position: absolute; pointer-events: auto;
    border-left: 3px solid var(--c);
    background: color-mix(in srgb, var(--c) 7%, transparent);
    border-radius: 2px;
    transition: background 120ms ease;
  }
  .mark:hover { background: color-mix(in srgb, var(--c) 14%, transparent); }
  .tag {
    position: absolute; top: 0; right: 0;
    transform: translate(0, -100%);
    font: 500 11px/1.5 ui-sans-serif, system-ui, sans-serif;
    color: var(--c);
    background: Canvas;
    border: 1px solid color-mix(in srgb, var(--c) 35%, transparent);
    border-radius: 4px; padding: 1px 6px;
    opacity: 0; transition: opacity 120ms ease;
    white-space: nowrap;
  }
  .mark:hover .tag { opacity: 1; }
`;

/** Un color por banda. Nunca un porcentaje: ADR-007. */
const BAND_COLOR: Record<string, string> = {
  STRONG_SIGNAL: '#c2410c',
  WEAK_SIGNAL: '#a16207',
  PROVENANCE_CONFIRMED: '#0369a1',
};

const BAND_LABEL: Record<string, string> = {
  STRONG_SIGNAL: 'Señal fuerte de texto generado',
  WEAK_SIGNAL: 'Señal débil',
  PROVENANCE_CONFIRMED: 'Procedencia confirmada',
};

export class Overlay {
  #host: HTMLElement | undefined;
  #layer: HTMLElement | undefined;
  readonly #marks = new Map<string, { el: HTMLElement; target: Element }>();

  /** Marca un bloque. Bandas sin señal no pintan nada: el silencio es la norma. */
  show(target: Element, verdict: BlockVerdict): void {
    const color = BAND_COLOR[verdict.band];
    if (color === undefined) {
      this.#remove(verdict.hash);
      return;
    }

    const layer = this.#ensureLayer();
    let entry = this.#marks.get(verdict.hash);
    if (entry === undefined) {
      const el = document.createElement('div');
      el.className = 'mark';
      const tag = document.createElement('span');
      tag.className = 'tag';
      el.append(tag);
      layer.append(el);
      entry = { el, target };
      this.#marks.set(verdict.hash, entry);
    }

    entry.el.style.setProperty('--c', color);
    const tag = entry.el.firstElementChild;
    if (tag !== null) tag.textContent = BAND_LABEL[verdict.band] ?? verdict.band;
    this.#position(entry.el, target);
  }

  /** Recoloca todas las marcas. Se llama al hacer scroll o al cambiar el tamaño. */
  reposition(): void {
    for (const { el, target } of this.#marks.values()) this.#position(el, target);
  }

  /** Deja la página como estaba. Debe bastar con esto. */
  destroy(): void {
    this.#host?.remove();
    this.#host = undefined;
    this.#layer = undefined;
    this.#marks.clear();
  }

  #position(el: HTMLElement, target: Element): void {
    const rect = target.getBoundingClientRect();
    // Coordenadas de documento, no de viewport: así el scroll no las desplaza.
    el.style.left = `${rect.left + window.scrollX}px`;
    el.style.top = `${rect.top + window.scrollY}px`;
    el.style.width = `${rect.width}px`;
    el.style.height = `${rect.height}px`;
  }

  #remove(hash: string): void {
    const entry = this.#marks.get(hash);
    if (entry === undefined) return;
    entry.el.remove();
    this.#marks.delete(hash);
  }

  #ensureLayer(): HTMLElement {
    if (this.#layer !== undefined) return this.#layer;

    const host = document.createElement('div');
    host.id = HOST_ID;
    // El host no ocupa espacio ni intercepta nada: el layout de la página no
    // cambia por instalar la extensión.
    host.style.cssText = 'all:initial;position:absolute;top:0;left:0;width:0;height:0';

    const shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = STYLES;
    const layer = document.createElement('div');
    layer.className = 'layer';
    shadow.append(style, layer);
    document.body.append(host);

    this.#host = host;
    this.#layer = layer;
    return layer;
  }
}
