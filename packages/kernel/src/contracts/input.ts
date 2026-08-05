import type { Modality } from './evidence.js';

/**
 * Lo único que cruza la frontera hacia el kernel. Nunca el DOM, nunca la URL.
 * Ver 05-flujo-de-datos.md §3.
 */
export interface NormalizedInput {
  /** sha256 del contenido normalizado. Clave de caché y lo único que se persiste. */
  readonly hash: string;
  readonly modality: Modality;

  /** Texto sin boilerplate. Vive en memoria durante la petición y se descarta. */
  readonly text?: string;

  /** Píxeles ya decodificados fuera del kernel; el kernel no sabe de canvas. */
  readonly pixels?: {
    readonly width: number;
    readonly height: number;
    /** RGBA, 4 bytes por píxel. */
    readonly data: Uint8ClampedArray;
  };

  /** Bytes crudos del fichero, para leer metadatos de procedencia. */
  readonly rawBytes?: Uint8Array;

  /** Código ISO 639-1 detectado localmente. */
  readonly lang: string;
  readonly tokenCount: number;

  readonly domHints?: {
    readonly isArticle: boolean;
    readonly isUserGenerated: boolean;
    /** Etiqueta de IA que la propia plataforma declara en el marcado. */
    readonly platformLabel?: string;
  };
}
