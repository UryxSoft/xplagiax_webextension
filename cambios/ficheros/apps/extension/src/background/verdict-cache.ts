import type { BlockVerdict } from '../shared/messages.js';

/**
 * Caché de veredictos por hash de contenido.
 *
 * La clave es el sha256 del texto normalizado, no la URL: el mismo párrafo en
 * dos sitios distintos se analiza una vez. Y solo se guarda el veredicto —banda
 * y agregados—, nunca el texto. Eso es lo que permite tener caché sin conservar
 * lo que el usuario leyó (05-flujo-de-datos.md §3).
 *
 * LRU con techo duro: el service worker de MV3 tiene memoria limitada y una
 * caché sin límite es una fuga con otro nombre.
 */
export class VerdictCache {
  readonly #entries = new Map<string, BlockVerdict>();
  readonly #maxEntries: number;

  constructor(maxEntries = 500) {
    this.#maxEntries = maxEntries;
  }

  get size(): number {
    return this.#entries.size;
  }

  get(hash: string): BlockVerdict | undefined {
    const hit = this.#entries.get(hash);
    if (hit === undefined) return undefined;
    // Reinsertar lo mueve al final: Map conserva el orden de inserción, que es
    // lo que hace de esto un LRU sin estructuras adicionales.
    this.#entries.delete(hash);
    this.#entries.set(hash, hit);
    return hit;
  }

  set(hash: string, verdict: BlockVerdict): void {
    if (this.#entries.has(hash)) this.#entries.delete(hash);
    this.#entries.set(hash, verdict);

    while (this.#entries.size > this.#maxEntries) {
      const oldest = this.#entries.keys().next();
      if (oldest.done === true) break;
      this.#entries.delete(oldest.value);
    }
  }

  clear(): void {
    this.#entries.clear();
  }
}
