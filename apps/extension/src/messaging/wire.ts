import { Band } from '@xpx/kernel';
import type { Evidence, NormalizedInput, Verdict } from '@xpx/kernel';

/**
 * Validadores del contrato que cruza el puerto.
 *
 * El kernel define las formas; aquí se comprueban. La separación es
 * deliberada: el kernel no sabe que existe un navegador ni una frontera de
 * proceso, y no debe cargar con el coste de desconfiar de sus propios tipos.
 *
 * Esto no es una comprobación de cortesía. Un `NormalizedInput` mal formado
 * llega hasta un detector, y su `hash` es la clave de caché que sí se
 * persiste: aceptar cualquier cadena ahí es envenenar el almacenamiento.
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

export function isNormalizedInput(v: unknown): v is NormalizedInput {
  if (!isRecord(v)) return false;

  if (typeof v['hash'] !== 'string' || !HASH.test(v['hash'])) return false;
  if (typeof v['modality'] !== 'string' || !MODALITIES.includes(v['modality'])) return false;
  // ISO 639-1, con margen para etiquetas regionales tipo "pt-BR".
  if (typeof v['lang'] !== 'string' || v['lang'].length === 0 || v['lang'].length > 16) return false;
  if (!isFinite_(v['tokenCount']) || v['tokenCount'] < 0) return false;

  const text = v['text'];
  if (text !== undefined && (typeof text !== 'string' || text.length > MAX_TEXT_CHARS)) return false;

  const rawBytes = v['rawBytes'];
  if (rawBytes !== undefined && !(rawBytes instanceof Uint8Array)) return false;

  const pixels = v['pixels'];
  if (pixels !== undefined && !isPixels(pixels)) return false;

  const hints = v['domHints'];
  if (hints !== undefined && !isDomHints(hints)) return false;

  return true;
}

function isPixels(v: unknown): boolean {
  if (!isRecord(v)) return false;
  const { width, height, data } = v;
  if (!isFinite_(width) || !Number.isInteger(width) || width <= 0 || width > MAX_PIXEL_SIDE) {
    return false;
  }
  if (!isFinite_(height) || !Number.isInteger(height) || height <= 0 || height > MAX_PIXEL_SIDE) {
    return false;
  }
  if (!(data instanceof Uint8ClampedArray)) return false;
  // Si las dimensiones no cuadran con el búfer, un detector leería fuera de
  // rango. Es el único invariante de este objeto que no se ve a simple vista.
  return data.length === width * height * 4;
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
