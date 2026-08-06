import { Band } from '@xpx/kernel';
import type { Evidence, NormalizedInput, Verdict } from '@xpx/kernel';

/**
 * El contrato que cruza el puerto, y su traducción desde y hacia el kernel.
 *
 * El kernel define las formas; aquí se comprueban y se adaptan al transporte.
 * La separación es deliberada: el kernel no sabe que existe un navegador ni una
 * frontera de proceso, y no debe cargar con el coste de desconfiar de sus
 * propios tipos ni de acomodarse a un canal concreto.
 *
 * ## Por qué el binario viaja en base64
 *
 * `chrome.runtime` **serializa los mensajes como JSON**, no con structured
 * clone. Un `Uint8Array` no sobrevive: llega al otro extremo como un objeto
 * plano `{"0":137,"1":80,…}`. Esto no se ve en los tests si el doble de puerto
 * usa `structuredClone` —que sí preserva los tipados— y solo aparece al cargar
 * la extensión en un navegador real, donde rompe precisamente la modalidad que
 * depende de los bytes crudos: la procedencia.
 *
 * De ahí que exista un tipo de cable distinto del tipo del kernel. El coste es
 * un tercio más de tamaño, que para imágenes de página es asumible. La
 * alternativa —enviar la URL y que el documento offscreen la descargue— exige
 * `host_permissions` en la instalación, que ADR-009 descarta.
 *
 * La validación tampoco es cortesía: un input mal formado llega hasta un
 * detector, y su `hash` es la clave de caché que sí se persiste. Aceptar
 * cualquier cadena ahí es envenenar el almacenamiento.
 */

/** sha256 en hexadecimal. Es lo único que se guarda del contenido. */
const HASH = /^[0-9a-f]{64}$/;

/**
 * Techo de texto por bloque. Un bloque real de una página no se acerca; el
 * límite existe porque quien envía puede ser un content script comprometido,
 * y un texto sin cota es una denegación de servicio contra nuestro propio
 * documento offscreen.
 */
const MAX_TEXT_CHARS = 200_000;

/** Techo de píxeles: 8K por lado cubre cualquier imagen web con holgura. */
const MAX_PIXEL_SIDE = 8192;

/**
 * Techo de binario por mensaje, ya decodificado. Generoso para una imagen de
 * página y muy por debajo del límite práctico de `chrome.runtime`, que degrada
 * mucho antes de rechazar.
 */
const MAX_BINARY_BYTES = 16 * 1024 * 1024;

const MODALITIES: readonly string[] = ['text', 'image', 'video', 'audio', 'document'];
const KINDS: readonly string[] = ['provenance', 'watermark', 'statistical', 'heuristic', 'user'];
const BANDS: readonly string[] = Object.values(Band);
const AGREEMENTS: readonly string[] = ['agree', 'disagree', 'inconclusive'];
const ACTIONS: readonly string[] = ['pass', 'downgrade', 'abstain'];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isFinite_(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** La forma JSON del `NormalizedInput`: lo único que cruza el puerto. */
export interface WireInput {
  readonly hash: string;
  readonly modality: string;
  readonly text?: string;
  /** Bytes crudos del fichero, en base64. */
  readonly rawBytesB64?: string;
  readonly pixels?: {
    readonly width: number;
    readonly height: number;
    /** RGBA, 4 bytes por píxel, en base64. */
    readonly dataB64: string;
  };
  readonly lang: string;
  readonly tokenCount: number;
  readonly domHints?: NormalizedInput['domHints'];
}

export function isWireInput(v: unknown): v is WireInput {
  if (!isRecord(v)) return false;

  if (typeof v['hash'] !== 'string' || !HASH.test(v['hash'])) return false;
  if (typeof v['modality'] !== 'string' || !MODALITIES.includes(v['modality'])) return false;
  // ISO 639-1, con margen para etiquetas regionales tipo "pt-BR".
  if (typeof v['lang'] !== 'string' || v['lang'].length === 0 || v['lang'].length > 16) return false;
  if (!isFinite_(v['tokenCount']) || v['tokenCount'] < 0) return false;

  const text = v['text'];
  if (text !== undefined && (typeof text !== 'string' || text.length > MAX_TEXT_CHARS)) return false;

  const rawBytes = v['rawBytesB64'];
  if (rawBytes !== undefined && !isB64(rawBytes, MAX_BINARY_BYTES)) return false;

  const pixels = v['pixels'];
  if (pixels !== undefined && !isWirePixels(pixels)) return false;

  const hints = v['domHints'];
  if (hints !== undefined && !isDomHints(hints)) return false;

  return true;
}

function isWirePixels(v: unknown): boolean {
  if (!isRecord(v)) return false;
  const { width, height, dataB64 } = v;
  if (!isFinite_(width) || !Number.isInteger(width) || width <= 0 || width > MAX_PIXEL_SIDE) {
    return false;
  }
  if (!isFinite_(height) || !Number.isInteger(height) || height <= 0 || height > MAX_PIXEL_SIDE) {
    return false;
  }
  if (!isB64(dataB64, MAX_BINARY_BYTES)) return false;
  // Si las dimensiones no cuadran con el búfer, un detector leería fuera de
  // rango. Es el único invariante de este objeto que no se ve a simple vista,
  // y se comprueba sobre el tamaño declarado por el base64 para no tener que
  // decodificar antes de saber si merece la pena.
  return b64ByteLength(dataB64 as string) === width * height * 4;
}

/** Convierte lo que produce el content script en lo que viaja por el puerto. */
export function toWire(input: NormalizedInput): WireInput {
  return {
    hash: input.hash,
    modality: input.modality,
    lang: input.lang,
    tokenCount: input.tokenCount,
    ...(input.text !== undefined ? { text: input.text } : {}),
    ...(input.rawBytes !== undefined ? { rawBytesB64: toB64(input.rawBytes) } : {}),
    ...(input.pixels !== undefined
      ? {
          pixels: {
            width: input.pixels.width,
            height: input.pixels.height,
            dataB64: toB64(input.pixels.data),
          },
        }
      : {}),
    ...(input.domHints !== undefined ? { domHints: input.domHints } : {}),
  };
}

/** Reconstruye la entrada del kernel. Solo debe llamarse tras `isWireInput`. */
export function fromWire(w: WireInput): NormalizedInput {
  return {
    hash: w.hash,
    modality: w.modality as NormalizedInput['modality'],
    lang: w.lang,
    tokenCount: w.tokenCount,
    ...(w.text !== undefined ? { text: w.text } : {}),
    ...(w.rawBytesB64 !== undefined ? { rawBytes: fromB64(w.rawBytesB64) } : {}),
    ...(w.pixels !== undefined
      ? {
          pixels: {
            width: w.pixels.width,
            height: w.pixels.height,
            data: new Uint8ClampedArray(fromB64(w.pixels.dataB64).buffer),
          },
        }
      : {}),
    ...(w.domHints !== undefined ? { domHints: w.domHints } : {}),
  };
}

const B64 = /^[A-Za-z0-9+/]*={0,2}$/;

function isB64(v: unknown, maxBytes: number): boolean {
  if (typeof v !== 'string') return false;
  if (v.length % 4 !== 0) return false;
  if (!B64.test(v)) return false;
  return b64ByteLength(v) <= maxBytes;
}

/** Tamaño decodificado, sin decodificar. */
function b64ByteLength(b64: string): number {
  if (b64.length === 0) return 0;
  const relleno = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return (b64.length / 4) * 3 - relleno;
}

/**
 * `String.fromCharCode(...bytes)` desborda la pila con cualquier imagen de
 * tamaño real. Se trocea, que es la razón de que esto no sea una línea.
 */
function toB64(bytes: Uint8Array | Uint8ClampedArray): string {
  const TROZO = 0x8000;
  let binario = '';
  for (let i = 0; i < bytes.length; i += TROZO) {
    binario += String.fromCharCode(...bytes.subarray(i, i + TROZO));
  }
  return btoa(binario);
}

function fromB64(b64: string): Uint8Array {
  const binario = atob(b64);
  const out = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i += 1) out[i] = binario.charCodeAt(i);
  return out;
}

function isDomHints(v: unknown): boolean {
  if (!isRecord(v)) return false;
  if (typeof v['isArticle'] !== 'boolean') return false;
  if (typeof v['isUserGenerated'] !== 'boolean') return false;
  const label = v['platformLabel'];
  return label === undefined || (typeof label === 'string' && label.length <= 200);
}

export function isVerdict(v: unknown): v is Verdict {
  if (!isRecord(v)) return false;

  if (typeof v['hash'] !== 'string' || !HASH.test(v['hash'])) return false;
  if (typeof v['band'] !== 'string' || !BANDS.includes(v['band'])) return false;
  if (!isFinite_(v['llrTotal'])) return false;
  if (!isFinite_(v['elapsedMs'])) return false;

  const interval = v['interval'];
  if (!isRecord(interval) || !isFinite_(interval['lower']) || !isFinite_(interval['upper'])) {
    return false;
  }

  const reason = v['abstentionReason'];
  if (reason !== undefined && typeof reason !== 'string') return false;

  const evidence = v['evidence'];
  if (!Array.isArray(evidence) || !evidence.every(isEvidence)) return false;

  const validations = v['validations'];
  if (!Array.isArray(validations) || !validations.every(isValidationTrace)) return false;

  return true;
}

function isEvidence(v: unknown): v is Evidence {
  if (!isRecord(v)) return false;
  if (typeof v['detectorId'] !== 'string' || typeof v['detectorVersion'] !== 'string') return false;
  if (typeof v['kind'] !== 'string' || !KINDS.includes(v['kind'])) return false;
  if (typeof v['modality'] !== 'string' || !MODALITIES.includes(v['modality'])) return false;
  if (typeof v['calibrationId'] !== 'string') return false;
  if (!isFinite_(v['llr'])) return false;
  if (!isFinite_(v['costMs'])) return false;

  // Fuera de [0,1] la fusión daría un peso sin sentido.
  const reliability = v['reliability'];
  if (!isFinite_(reliability) || reliability < 0 || reliability > 1) return false;

  return Array.isArray(v['rationale']);
}

function isValidationTrace(v: unknown): boolean {
  if (!isRecord(v)) return false;
  if (typeof v['stageId'] !== 'string' || typeof v['reasonCode'] !== 'string') return false;
  if (typeof v['agreement'] !== 'string' || !AGREEMENTS.includes(v['agreement'])) return false;
  return typeof v['action'] === 'string' && ACTIONS.includes(v['action']);
}
