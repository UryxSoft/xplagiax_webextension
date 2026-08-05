import { webcrypto } from 'node:crypto';
import { concat, encodeCborArray, encodeCborBytes, encodeCborText } from '../src/cbor.js';

/**
 * Construye manifiestos C2PA reales: JUMBF válido, COSE_Sign1 válido y firma
 * ECDSA de verdad sobre la Sig_structure correcta.
 *
 * Simular la verificación con un doble de crypto probaría que el código llama
 * a una función. Firmar de verdad prueba que la Sig_structure se reconstruye
 * byte a byte como manda RFC 9052, que es donde está el error fácil de cometer
 * y difícil de detectar.
 */

const enc = (s: string): Uint8Array => Uint8Array.from([...s].map((c) => c.charCodeAt(0)));

function u32be(n: number): Uint8Array {
  return Uint8Array.from([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
}

/** Caja ISO BMFF: longitud + tipo + carga. */
export function box(type: string, payload: Uint8Array): Uint8Array {
  return concat(u32be(payload.length + 8), enc(type), payload);
}

/** Caja descriptora 'jumd': UUID + toggles con el bit de etiqueta + etiqueta NUL. */
function jumd(label: string): Uint8Array {
  return box('jumd', concat(new Uint8Array(16), Uint8Array.from([0x03]), enc(label), Uint8Array.from([0])));
}

/** Superbox 'jumb' etiquetada, con las cajas de contenido dentro. */
export function jumb(label: string, ...children: Uint8Array[]): Uint8Array {
  return box('jumb', concat(jumd(label), ...children));
}

export interface SignedManifest {
  readonly jumbf: Uint8Array;
  readonly claim: Uint8Array;
}

/**
 * Genera un par de claves P-256, construye un certificado X.509 mínimo pero
 * estructuralmente válido que contiene su SubjectPublicKeyInfo, y firma un
 * claim con ECDSA/SHA-256.
 */
export async function buildSignedManifest(
  opts: { tamperClaim?: boolean; notBefore?: Date; notAfter?: Date } = {},
): Promise<SignedManifest> {
  const keys = await webcrypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  );
  const spki = new Uint8Array(await webcrypto.subtle.exportKey('spki', keys.publicKey));
  const cert = makeCertificate(spki, opts.notBefore, opts.notAfter);

  const claim = enc('{"claim_generator":"TestCam 1.0","assertions":[]}');

  // protected = { 1: -7 (ES256), 33: [cert] }
  const protectedMap = concat(
    Uint8Array.from([0xa2]), // map(2)
    Uint8Array.from([0x01, 0x26]), // 1: -7
    Uint8Array.from([0x18, 0x21]), // 33
    Uint8Array.from([0x81]), // array(1)
    encodeCborBytes(cert),
  );

  const sigStructure = encodeCborArray([
    encodeCborText('Signature1'),
    encodeCborBytes(protectedMap),
    encodeCborBytes(new Uint8Array(0)),
    encodeCborBytes(claim),
  ]);

  const signature = new Uint8Array(
    await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, sigStructure),
  );

  // COSE_Sign1 = [protected, {}, nil, signature]. El payload va desacoplado:
  // el claim vive en su propia caja JUMBF, como en C2PA real.
  const cose = concat(
    Uint8Array.from([0x84]), // array(4)
    encodeCborBytes(protectedMap),
    Uint8Array.from([0xa0]), // {}
    Uint8Array.from([0xf6]), // nil
    encodeCborBytes(signature),
  );

  // Si se pide, se altera el claim DESPUÉS de firmar: la firma deja de cuadrar.
  const storedClaim = opts.tamperClaim ? enc('{"claim_generator":"Falsificado","assertions":[]}') : claim;

  const jumbf = jumb(
    'c2pa',
    jumb('c2pa.assertions'),
    jumb('c2pa.claim', box('cbor', storedClaim)),
    jumb('c2pa.signature', box('cbor', cose)),
  );

  return { jumbf, claim: storedClaim };
}

/**
 * Certificado X.509 mínimo. Solo necesita ser estructuralmente correcto hasta
 * la SubjectPublicKeyInfo y el periodo de validez: nada más se lee.
 */
function makeCertificate(spki: Uint8Array, notBefore?: Date, notAfter?: Date): Uint8Array {
  const nb = notBefore ?? new Date(Date.now() - 86_400_000);
  const na = notAfter ?? new Date(Date.now() + 86_400_000);

  const tbs = derSeq(
    concat(
      der(0xa0, Uint8Array.from([0x02, 0x01, 0x02])), // [0] version v3
      der(0x02, Uint8Array.from([0x01])), // serialNumber
      derSeq(Uint8Array.from([0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02])), // ecdsa-with-SHA256
      derSeq(new Uint8Array(0)), // issuer
      derSeq(concat(utcTime(nb), utcTime(na))), // validity
      derSeq(new Uint8Array(0)), // subject
      spki,
    ),
  );

  return derSeq(
    concat(
      tbs,
      derSeq(Uint8Array.from([0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02])),
      der(0x03, concat(Uint8Array.from([0x00]), new Uint8Array(64))), // firma de relleno
    ),
  );
}

function utcTime(d: Date): Uint8Array {
  const p = (n: number): string => String(n).padStart(2, '0');
  const s =
    p(d.getUTCFullYear() % 100) +
    p(d.getUTCMonth() + 1) +
    p(d.getUTCDate()) +
    p(d.getUTCHours()) +
    p(d.getUTCMinutes()) +
    p(d.getUTCSeconds()) +
    'Z';
  return der(0x17, enc(s));
}

function der(tag: number, content: Uint8Array): Uint8Array {
  return concat(Uint8Array.from([tag]), derLength(content.length), content);
}

function derSeq(content: Uint8Array): Uint8Array {
  return der(0x30, content);
}

function derLength(n: number): Uint8Array {
  if (n < 0x80) return Uint8Array.from([n]);
  if (n < 0x100) return Uint8Array.from([0x81, n]);
  return Uint8Array.from([0x82, (n >> 8) & 0xff, n & 0xff]);
}

/** Empaqueta un JUMBF en un JPEG con la cabecera APP11 correcta. */
export function jpegWithManifest(jumbf: Uint8Array): Uint8Array {
  const app11 = concat(enc('JP'), new Uint8Array(8), jumbf);
  const len = app11.length + 2;
  return concat(
    Uint8Array.from([0xff, 0xd8]),
    Uint8Array.from([0xff, 0xeb, (len >> 8) & 0xff, len & 0xff]),
    app11,
    Uint8Array.from([0xff, 0xda, 0x00, 0x02]),
  );
}

export const nodeCrypto = {
  importKey: (
    format: 'spki',
    keyData: Uint8Array,
    algorithm: Record<string, unknown>,
    extractable: boolean,
    usages: readonly string[],
  ) =>
    webcrypto.subtle.importKey(
      format,
      keyData as unknown as ArrayBuffer,
      algorithm as unknown as AlgorithmIdentifier,
      extractable,
      usages as unknown as KeyUsage[],
    ),
  verify: (
    algorithm: Record<string, unknown>,
    key: unknown,
    signature: Uint8Array,
    data: Uint8Array,
  ) =>
    webcrypto.subtle.verify(
      algorithm as unknown as AlgorithmIdentifier,
      key as CryptoKey,
      signature as unknown as ArrayBuffer,
      data as unknown as ArrayBuffer,
    ),
};
