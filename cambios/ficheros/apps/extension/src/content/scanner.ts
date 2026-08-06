import { RpcClient } from '@xpx/ipc';
import type { Transport } from '@xpx/ipc';
import { extractBlocks } from './extract.js';
import type { ExtractedBlock } from './extract.js';
import { Overlay } from './overlay.js';
import { MAX_BLOCKS_PER_REQUEST, isAnalyzeResponse } from '../shared/messages.js';

/**
 * Recorre lo visible, pide veredictos y los pinta.
 *
 * Toda la lógica del content script vive aquí, con el transporte y el reloj
 * inyectados, para poder probarla sin navegador. El entrypoint solo la arranca.
 */

export interface ScannerOptions {
  readonly transport: Transport;
  readonly subtle: { digest(alg: string, data: BufferSource): Promise<ArrayBuffer> };
  readonly overlay?: Overlay;
  readonly maxBlocks?: number;
  readonly root?: ParentNode;
  readonly isVisible?: (el: Element) => boolean;
}

export class Scanner {
  readonly #client: RpcClient;
  readonly #overlay: Overlay;
  readonly #opts: ScannerOptions;
  /** Hashes ya enviados. Evita repetir trabajo en cada scroll. */
  readonly #seen = new Set<string>();

  constructor(opts: ScannerOptions) {
    this.#opts = opts;
    this.#client = new RpcClient({ transport: opts.transport });
    this.#overlay = opts.overlay ?? new Overlay();
  }

  get analyzedCount(): number {
    return this.#seen.size;
  }

  /**
   * Analiza los bloques visibles que aún no se han visto.
   *
   * Los errores no se propagan: un fallo de análisis no puede romper la
   * navegación del usuario. La página es suya, no nuestra.
   */
  async scan(): Promise<void> {
    const blocks = await extractBlocks({
      subtle: this.#opts.subtle,
      maxBlocks: this.#opts.maxBlocks ?? MAX_BLOCKS_PER_REQUEST,
      ...(this.#opts.root !== undefined ? { root: this.#opts.root } : {}),
      ...(this.#opts.isVisible !== undefined ? { isVisible: this.#opts.isVisible } : {}),
    });

    const pending = blocks.filter((b) => !this.#seen.has(b.hash));
    if (pending.length === 0) return;
    for (const b of pending) this.#seen.add(b.hash);

    const byHash = new Map<string, ExtractedBlock>(pending.map((b) => [b.hash, b]));
    const response = await this.#client.request(
      'analyze',
      { blocks: pending.map(stripElement) },
      isAnalyzeResponse,
    );

    for (const verdict of response.verdicts) {
      const block = byHash.get(verdict.hash);
      if (block !== undefined) this.#overlay.show(block.element, verdict);
    }
  }

  reposition(): void {
    this.#overlay.reposition();
  }

  dispose(): void {
    this.#client.dispose();
    this.#overlay.destroy();
    this.#seen.clear();
  }
}

/**
 * Quita la referencia al elemento antes de cruzar la frontera. El background no
 * necesita el DOM y no debe recibirlo: no es serializable y, sobre todo, no es
 * asunto suyo.
 */
function stripElement(block: ExtractedBlock): {
  hash: string;
  text: string;
  lang: string;
  tokenCount: number;
} {
  return {
    hash: block.hash,
    text: block.text,
    lang: block.lang,
    tokenCount: block.tokenCount,
  };
}
