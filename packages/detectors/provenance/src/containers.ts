/**
 * Lectura de contenedores de imagen para localizar metadatos.
 *
 * Sin dependencias: son tres formatos con estructuras simples y bien
 * documentadas, y una librería de parseo de imágenes es superficie de ataque
 * en un contexto que procesa bytes de terceros.
 */

export interface Segment {
  /** Identificador del segmento: marcador APP en JPEG, tipo de chunk en PNG/WebP. */
  readonly kind: string;
  readonly data: Uint8Array;
}

export type ContainerFormat = 'jpeg' | 'png' | 'webp' | 'unknown';

export function detectFormat(bytes: Uint8Array): ContainerFormat {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpeg';
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return 'png';
  }
  if (
    bytes.length >= 12 &&
    ascii(bytes, 0, 4) === 'RIFF' &&
    ascii(bytes, 8, 4) === 'WEBP'
  ) {
    return 'webp';
  }
  return 'unknown';
}

export function readSegments(bytes: Uint8Array): readonly Segment[] {
  switch (detectFormat(bytes)) {
    case 'jpeg':
      return readJpeg(bytes);
    case 'png':
      return readPng(bytes);
    case 'webp':
      return readWebp(bytes);
    case 'unknown':
      return [];
  }
}

/** Marcadores APPn (FFE0–FFEF), hasta el inicio de los datos comprimidos. */
function readJpeg(bytes: Uint8Array): Segment[] {
  const out: Segment[] = [];
  let i = 2; // saltar SOI

  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) break;

    const marker = bytes[i + 1];
    if (marker === undefined) break;

    // SOS: a partir de aquí vienen los datos de imagen. No hay más metadatos.
    if (marker === 0xda) break;
    // Marcadores sin payload.
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }

    const length = readU16BE(bytes, i + 2);
    if (length === undefined || length < 2) break;

    const start = i + 4;
    const end = Math.min(start + length - 2, bytes.length);
    if (marker >= 0xe0 && marker <= 0xef) {
      out.push({ kind: `APP${marker - 0xe0}`, data: bytes.subarray(start, end) });
    }
    i = start + length - 2;
  }
  return out;
}

/** Chunks PNG: longitud BE de 4 bytes, tipo de 4 bytes, datos, CRC de 4 bytes. */
function readPng(bytes: Uint8Array): Segment[] {
  const out: Segment[] = [];
  let i = 8; // saltar la firma

  while (i + 8 <= bytes.length) {
    const length = readU32BE(bytes, i);
    if (length === undefined) break;

    const type = ascii(bytes, i + 4, 4);
    const start = i + 8;
    const end = start + length;
    if (end > bytes.length) break;

    out.push({ kind: type, data: bytes.subarray(start, end) });
    if (type === 'IEND') break;

    i = end + 4; // saltar el CRC
  }
  return out;
}

/** Chunks RIFF: FourCC, tamaño LE de 4 bytes, datos con relleno a byte par. */
function readWebp(bytes: Uint8Array): Segment[] {
  const out: Segment[] = [];
  let i = 12; // saltar RIFF + tamaño + WEBP

  while (i + 8 <= bytes.length) {
    const fourcc = ascii(bytes, i, 4);
    const size = readU32LE(bytes, i + 4);
    if (size === undefined) break;

    const start = i + 8;
    const end = start + size;
    if (end > bytes.length) break;

    out.push({ kind: fourcc.trim(), data: bytes.subarray(start, end) });
    i = end + (size % 2); // relleno
  }
  return out;
}

export function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let s = '';
  for (let i = offset; i < offset + length && i < bytes.length; i += 1) {
    s += String.fromCharCode(bytes[i] ?? 0);
  }
  return s;
}

/** Decodifica como texto latin-1: suficiente para localizar marcadores ASCII. */
export function toLatin1(bytes: Uint8Array): string {
  let s = '';
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, Math.min(i + CHUNK, bytes.length)));
  }
  return s;
}

function readU16BE(b: Uint8Array, o: number): number | undefined {
  const a = b[o];
  const c = b[o + 1];
  return a === undefined || c === undefined ? undefined : (a << 8) | c;
}

function readU32BE(b: Uint8Array, o: number): number | undefined {
  const p = [b[o], b[o + 1], b[o + 2], b[o + 3]];
  if (p.some((x) => x === undefined)) return undefined;
  return (((p[0] as number) << 24) >>> 0) + ((p[1] as number) << 16) + ((p[2] as number) << 8) + (p[3] as number);
}

function readU32LE(b: Uint8Array, o: number): number | undefined {
  const p = [b[o], b[o + 1], b[o + 2], b[o + 3]];
  if (p.some((x) => x === undefined)) return undefined;
  return (p[0] as number) + ((p[1] as number) << 8) + ((p[2] as number) << 16) + (((p[3] as number) << 24) >>> 0);
}
