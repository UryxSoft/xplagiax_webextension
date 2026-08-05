import { decodeCbor, encodeCborArray, encodeCborBytes, encodeCborText } from './cbor.js';
import type { CborValue } from './cbor.js';

/**
 * COSE_Sign1 (RFC 9052), la envoltura de firma que usa C2PA.
 *
 *   COSE_Sign1 = [ protected: bstr, unprotected: map, payload: bstr / nil,
 *                  signature: bstr ]
 *
 * Lo que se firma no es el payload sino la Sig_structure:
 *
 *   Sig_structure = [ "Signature1", protected, external_aad, payload ]
 *
 * Reconstruirla bien es lo que hace que la verificación signifique algo. Si se
 * verificara la firma contra el payload directamente, cualquiera podría mover
 * una firma válida a otra cabecera protegida.
 */

export interface CoseSign1 {
  readonly protectedRaw: Uint8Array;
  readonly protectedMap: Map<CborValue, CborValue>;
  readonly unprotected: Map<CborValue, CborValue>;
  readonly payload: Uint8Array | null;
  readonly signature: Uint8Array;
  /** Algoritmo declarado en la cabecera protegida (etiqueta 1). */
  readonly alg: number | undefined;
  /** Cadena de certificados x5chain (etiqueta 33), en DER. */
  readonly x5chain: readonly Uint8Array[];
}

export class CoseError extends Error {
  override readonly name = 'CoseError';
}

export function parseCoseSign1(bytes: Uint8Array): CoseSign1 {
  let v = decodeCbor(bytes);

  // COSE_Sign1 puede venir etiquetado con la tag 18.
  if (typeof v === 'object' && v !== null && !Array.isArray(v) && 'tag' in v) {
    if (v.tag !== 18) throw new CoseError(`tag COSE inesperada: ${v.tag}`);
    v = v.value;
  }

  if (!Array.isArray(v) || v.length !== 4) {
    throw new CoseError('COSE_Sign1 debe ser un array de 4 elementos');
  }

  const [p, u, pl, sig] = v;
  if (!(p instanceof Uint8Array)) throw new CoseError('cabecera protegida inválida');
  if (!(sig instanceof Uint8Array)) throw new CoseError('firma inválida');

  const protectedMap =
    p.length === 0 ? new Map<CborValue, CborValue>() : asMap(decodeCbor(p), 'cabecera protegida');
  const unprotected = u instanceof Map ? u : new Map<CborValue, CborValue>();

  const alg = protectedMap.get(1);
  const x5 = protectedMap.get(33) ?? unprotected.get(33);

  return {
    protectedRaw: p,
    protectedMap,
    unprotected,
    payload: pl instanceof Uint8Array ? pl : null,
    signature: sig,
    alg: typeof alg === 'number' ? alg : undefined,
    x5chain: normalizeX5Chain(x5),
  };
}

/**
 * Sig_structure canónica. `detachedPayload` cubre el caso de C2PA, donde el
 * payload va fuera de la estructura COSE.
 */
export function sigStructure(
  cose: CoseSign1,
  detachedPayload?: Uint8Array,
): Uint8Array {
  const payload = detachedPayload ?? cose.payload;
  if (payload === null || payload === undefined) {
    throw new CoseError('no hay payload que verificar');
  }
  return encodeCborArray([
    encodeCborText('Signature1'),
    encodeCborBytes(cose.protectedRaw),
    encodeCborBytes(new Uint8Array(0)), // external_aad vacío
    encodeCborBytes(payload),
  ]);
}

/** Algoritmos COSE que aceptamos, y su equivalente en WebCrypto. */
export interface AlgorithmSpec {
  readonly name: string;
  readonly importParams: Record<string, unknown>;
  readonly verifyParams: Record<string, unknown>;
}

export function algorithmFor(alg: number | undefined): AlgorithmSpec | undefined {
  switch (alg) {
    case -7: // ES256
      return {
        name: 'ES256',
        importParams: { name: 'ECDSA', namedCurve: 'P-256' },
        verifyParams: { name: 'ECDSA', hash: 'SHA-256' },
      };
    case -35: // ES384
      return {
        name: 'ES384',
        importParams: { name: 'ECDSA', namedCurve: 'P-384' },
        verifyParams: { name: 'ECDSA', hash: 'SHA-384' },
      };
    case -36: // ES512
      return {
        name: 'ES512',
        importParams: { name: 'ECDSA', namedCurve: 'P-521' },
        verifyParams: { name: 'ECDSA', hash: 'SHA-512' },
      };
    case -37: // PS256
      return {
        name: 'PS256',
        importParams: { name: 'RSA-PSS', hash: 'SHA-256' },
        verifyParams: { name: 'RSA-PSS', saltLength: 32 },
      };
    case -38: // PS384
      return {
        name: 'PS384',
        importParams: { name: 'RSA-PSS', hash: 'SHA-384' },
        verifyParams: { name: 'RSA-PSS', saltLength: 48 },
      };
    case -39: // PS512
      return {
        name: 'PS512',
        importParams: { name: 'RSA-PSS', hash: 'SHA-512' },
        verifyParams: { name: 'RSA-PSS', saltLength: 64 },
      };
    // Deliberadamente sin RS256 (-257): PKCS#1 v1.5 no está en el perfil de
    // C2PA y aceptarlo ampliaría la superficie sin necesidad.
    default:
      return undefined;
  }
}

function asMap(v: CborValue, what: string): Map<CborValue, CborValue> {
  if (!(v instanceof Map)) throw new CoseError(`${what} debe ser un mapa`);
  return v;
}

function normalizeX5Chain(v: CborValue): readonly Uint8Array[] {
  if (v instanceof Uint8Array) return [v];
  if (Array.isArray(v)) return v.filter((x): x is Uint8Array => x instanceof Uint8Array);
  return [];
}
