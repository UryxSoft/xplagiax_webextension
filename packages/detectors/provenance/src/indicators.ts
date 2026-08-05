import { readSegments, toLatin1, detectFormat } from './containers.js';
import type { ContainerFormat } from './containers.js';

/**
 * Extracción de indicadores de procedencia.
 *
 * Distinción central: **presencia no es verificación.** Un manifiesto C2PA sin
 * firma comprobada no vale lo mismo que uno verificado; cualquiera puede
 * incrustar una caja JUMBF con el contenido que quiera. La verificación
 * criptográfica es un paso aparte, y hasta que exista ningún indicador puede
 * reclamar fiabilidad plena.
 */

export type IndicatorKind =
  | 'c2pa-manifest' // caja C2PA presente. Sin verificar la firma
  | 'iptc-synthetic' // IPTC digitalSourceType declara medio generado
  | 'iptc-capture' // IPTC declara captura de cámara
  | 'generator-tag' // EXIF/PNG con software generador conocido
  | 'camera-exif'; // EXIF con marca y modelo de cámara

export interface Indicator {
  readonly kind: IndicatorKind;
  /** Hacia dónde apunta: 'generated' | 'captured'. */
  readonly direction: 'generated' | 'captured';
  /** Firma criptográfica comprobada. Hoy siempre false: pendiente. */
  readonly verified: boolean;
  /** Fragmento que lo motivó, para el modo desarrollador y el "¿Por qué?". */
  readonly detail: string;
}

export interface ProvenanceScan {
  readonly format: ContainerFormat;
  readonly indicators: readonly Indicator[];
  /** El contenedor traía metadatos, aunque no fueran concluyentes. */
  readonly hasMetadata: boolean;
}

/**
 * IPTC digitalSourceType, el vocabulario que usan las plataformas para
 * declarar contenido generado. Es la señal declarativa más fiable que existe
 * hoy fuera de C2PA firmado.
 */
const SYNTHETIC_SOURCE_TYPES = [
  'trainedAlgorithmicMedia',
  'compositeSynthetic',
  'algorithmicMedia',
  'syntheticMedia',
] as const;

const CAPTURE_SOURCE_TYPES = ['digitalCapture', 'negativeFilm', 'positiveFilm'] as const;

/** Generadores que dejan rastro en EXIF Software o en chunks tEXt de PNG. */
const GENERATOR_SIGNATURES: readonly { re: RegExp; name: string }[] = [
  { re: /\bdall[\s·-]?e\b/i, name: 'DALL-E' },
  { re: /\bmidjourney\b/i, name: 'Midjourney' },
  { re: /\bstable[\s-]?diffusion\b/i, name: 'Stable Diffusion' },
  { re: /\bautomatic1111\b/i, name: 'AUTOMATIC1111' },
  { re: /\bcomfyui\b/i, name: 'ComfyUI' },
  { re: /\bfirefly\b/i, name: 'Adobe Firefly' },
  { re: /\bimagen\b/i, name: 'Google Imagen' },
  { re: /\bflux\b/i, name: 'FLUX' },
  { re: /\binvokeai\b/i, name: 'InvokeAI' },
];

/** Los parámetros de generación que muchas herramientas dejan intactos en PNG. */
const SD_PARAMETER_KEYS = ['parameters', 'prompt', 'negative_prompt', 'Steps:', 'Sampler:'];

export function scanProvenance(bytes: Uint8Array): ProvenanceScan {
  const format = detectFormat(bytes);
  if (format === 'unknown') {
    return { format, indicators: [], hasMetadata: false };
  }

  const segments = readSegments(bytes);
  const indicators: Indicator[] = [];
  let hasMetadata = false;

  for (const seg of segments) {
    const isMetadataSegment =
      // JPEG: APP1 = EXIF/XMP, APP11 = JUMBF (contenedor de C2PA)
      seg.kind === 'APP1' ||
      seg.kind === 'APP11' ||
      // PNG
      seg.kind === 'tEXt' ||
      seg.kind === 'iTXt' ||
      seg.kind === 'zTXt' ||
      seg.kind === 'eXIf' ||
      seg.kind === 'caBX' ||
      // WebP
      seg.kind === 'EXIF' ||
      seg.kind === 'XMP' ||
      seg.kind === 'C2PA';

    if (!isMetadataSegment) continue;
    hasMetadata = true;

    const text = toLatin1(seg.data);

    if (isC2paBox(seg.kind, text)) {
      indicators.push({
        kind: 'c2pa-manifest',
        direction: 'generated',
        verified: false, // pendiente: verificación de la firma COSE
        detail: `caja C2PA en ${seg.kind}`,
      });
    }

    for (const t of SYNTHETIC_SOURCE_TYPES) {
      if (text.includes(t)) {
        indicators.push({
          kind: 'iptc-synthetic',
          direction: 'generated',
          verified: false,
          detail: `digitalSourceType: ${t}`,
        });
        break;
      }
    }

    for (const t of CAPTURE_SOURCE_TYPES) {
      if (text.includes(t)) {
        indicators.push({
          kind: 'iptc-capture',
          direction: 'captured',
          verified: false,
          detail: `digitalSourceType: ${t}`,
        });
        break;
      }
    }

    for (const g of GENERATOR_SIGNATURES) {
      if (g.re.test(text)) {
        indicators.push({
          kind: 'generator-tag',
          direction: 'generated',
          verified: false,
          detail: `generador: ${g.name}`,
        });
        break;
      }
    }

    if (SD_PARAMETER_KEYS.filter((k) => text.includes(k)).length >= 2) {
      indicators.push({
        kind: 'generator-tag',
        direction: 'generated',
        verified: false,
        detail: 'parámetros de generación en metadatos',
      });
    }

    if (hasCameraExif(text)) {
      indicators.push({
        kind: 'camera-exif',
        direction: 'captured',
        verified: false,
        detail: 'EXIF de cámara',
      });
    }
  }

  return { format, indicators: dedupe(indicators), hasMetadata };
}

function isC2paBox(kind: string, text: string): boolean {
  if (kind === 'caBX' || kind === 'C2PA') return true;
  // JUMBF en APP11 lleva la etiqueta del espacio de nombres C2PA.
  return text.includes('c2pa') || text.includes('jumb');
}

function hasCameraExif(text: string): boolean {
  if (!text.startsWith('Exif\0') && !text.includes('Exif\0')) return false;
  // Marcas frecuentes. No es exhaustivo y no pretende serlo: es una señal
  // débil que solo suma cuando no hay nada mejor.
  return /\b(Canon|NIKON|SONY|FUJIFILM|Panasonic|OLYMPUS|Leica|Hasselblad|Apple|samsung|Google)\b/i.test(
    text,
  );
}

function dedupe(indicators: readonly Indicator[]): Indicator[] {
  const seen = new Set<string>();
  const out: Indicator[] = [];
  for (const i of indicators) {
    const key = `${i.kind}|${i.direction}|${i.detail}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(i);
  }
  return out;
}
