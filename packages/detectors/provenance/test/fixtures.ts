/**
 * Constructores de ficheros sintéticos. Un fichero mínimo pero estructuralmente
 * válido prueba el parseo mejor que un binario opaco descargado de algún sitio,
 * y no mete datos de terceros en el repositorio.
 */

function bytes(...parts: (number[] | Uint8Array | string)[]): Uint8Array {
  const chunks = parts.map((p) =>
    typeof p === 'string'
      ? Uint8Array.from([...p].map((c) => c.charCodeAt(0)))
      : p instanceof Uint8Array
        ? p
        : Uint8Array.from(p),
  );
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

function u16be(n: number): number[] {
  return [(n >> 8) & 0xff, n & 0xff];
}

function u32be(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

function u32le(n: number): number[] {
  return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
}

/** JPEG con los segmentos APP indicados, terminado en SOS. */
export function jpeg(apps: { marker: number; payload: string }[] = []): Uint8Array {
  const parts: (number[] | string)[] = [[0xff, 0xd8]]; // SOI
  for (const { marker, payload } of apps) {
    parts.push([0xff, 0xe0 + marker], u16be(payload.length + 2), payload);
  }
  parts.push([0xff, 0xda, 0x00, 0x02]); // SOS
  return bytes(...parts);
}

/** PNG con los chunks indicados. El CRC es relleno: no se verifica al leer. */
export function png(chunks: { type: string; data: string }[] = []): Uint8Array {
  const parts: (number[] | string)[] = [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]];
  for (const { type, data } of chunks) {
    parts.push(u32be(data.length), type, data, [0, 0, 0, 0]);
  }
  parts.push(u32be(0), 'IEND', [0, 0, 0, 0]);
  return bytes(...parts);
}

export function webp(chunks: { fourcc: string; data: string }[] = []): Uint8Array {
  const body: (number[] | string)[] = ['WEBP'];
  for (const { fourcc, data } of chunks) {
    body.push(fourcc.padEnd(4, ' '), u32le(data.length), data);
    if (data.length % 2 === 1) body.push([0]);
  }
  const inner = bytes(...body);
  return bytes('RIFF', u32le(inner.length), inner);
}

/** Payload EXIF con marca de cámara. */
export function exifCamera(make = 'Canon'): string {
  return `Exif\0\0MM\0*\0\0\0${make}\0EOS R5\0`;
}

/** XMP con IPTC digitalSourceType. */
export function xmpSourceType(type: string): string {
  return `http://ns.adobe.com/xap/1.0/\0<x:xmpmeta><rdf:RDF><rdf:Description Iptc4xmpExt:digitalSourceType="http://cv.iptc.org/newscodes/digitalsourcetype/${type}"/></rdf:RDF></x:xmpmeta>`;
}
