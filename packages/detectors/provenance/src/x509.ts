/**
 * Extracción mínima de campos DER de un certificado X.509.
 *
 * Solo lo imprescindible para verificar una firma: la SubjectPublicKeyInfo
 * (que WebCrypto importa tal cual en formato 'spki') y el periodo de validez.
 *
 * Esto NO es una implementación de X.509 ni valida cadenas. Deliberadamente:
 * validar una cadena de confianza es un problema aparte y hacerlo a medias
 * sería peor que no hacerlo, porque invitaría a confiar en el resultado.
 */

export interface DerNode {
  readonly tag: number;
  readonly header: number;
  readonly content: Uint8Array;
  /** Nodo completo, cabecera incluida. Es lo que WebCrypto necesita para SPKI. */
  readonly full: Uint8Array;
}

export class DerError extends Error {
  override readonly name = 'DerError';
}

export function readDer(bytes: Uint8Array, offset = 0): DerNode {
  const tag = bytes[offset];
  if (tag === undefined) throw new DerError('fin de entrada');

  const first = bytes[offset + 1];
  if (first === undefined) throw new DerError('fin de entrada');

  let length: number;
  let header: number;

  if (first < 0x80) {
    length = first;
    header = 2;
  } else {
    const n = first & 0x7f;
    if (n === 0 || n > 4) throw new DerError('longitud DER no soportada');
    length = 0;
    for (let i = 0; i < n; i += 1) {
      const b = bytes[offset + 2 + i];
      if (b === undefined) throw new DerError('fin de entrada');
      length = length * 256 + b;
    }
    header = 2 + n;
  }

  const start = offset + header;
  const end = start + length;
  if (end > bytes.length) throw new DerError('longitud mayor que la entrada');

  return {
    tag,
    header,
    content: bytes.subarray(start, end),
    full: bytes.subarray(offset, end),
  };
}

/** Hijos directos de un nodo constructed. */
export function derChildren(node: DerNode): DerNode[] {
  const out: DerNode[] = [];
  let i = 0;
  while (i < node.content.length) {
    const child = readDer(node.content, i);
    out.push(child);
    const consumed = child.header + child.content.length;
    if (consumed <= 0) break;
    i += consumed;
  }
  return out;
}

export interface CertificateInfo {
  /** SubjectPublicKeyInfo en DER, listo para crypto.subtle.importKey('spki'). */
  readonly spki: Uint8Array;
  readonly notBefore: Date | undefined;
  readonly notAfter: Date | undefined;
}

export function parseCertificate(der: Uint8Array): CertificateInfo {
  const cert = readDer(der);
  const [tbs] = derChildren(cert);
  if (tbs === undefined) throw new DerError('certificado sin tbsCertificate');

  const fields = derChildren(tbs);
  // [0] EXPLICIT version es opcional y viene con tag de contexto 0xA0.
  const base = fields[0]?.tag === 0xa0 ? 1 : 0;

  // serial, signature, issuer, validity, subject, subjectPublicKeyInfo
  const validity = fields[base + 3];
  const spkiNode = fields[base + 5];
  if (spkiNode === undefined) throw new DerError('certificado sin SubjectPublicKeyInfo');

  let notBefore: Date | undefined;
  let notAfter: Date | undefined;
  if (validity !== undefined) {
    const [nb, na] = derChildren(validity);
    notBefore = nb === undefined ? undefined : parseTime(nb);
    notAfter = na === undefined ? undefined : parseTime(na);
  }

  return { spki: spkiNode.full, notBefore, notAfter };
}

/** UTCTime (tag 0x17, año de 2 dígitos) y GeneralizedTime (0x18, 4 dígitos). */
function parseTime(node: DerNode): Date | undefined {
  let s = '';
  for (const b of node.content) s += String.fromCharCode(b);

  const m =
    node.tag === 0x17
      ? /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?Z$/.exec(s)
      : /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?Z$/.exec(s);
  if (m === null) return undefined;

  const yRaw = Number(m[1]);
  // RFC 5280: en UTCTime, 00–49 es 20xx y 50–99 es 19xx.
  const year = node.tag === 0x17 ? (yRaw < 50 ? 2000 + yRaw : 1900 + yRaw) : yRaw;

  return new Date(
    Date.UTC(year, Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? '0')),
  );
}
