import { parseCoseSign1, sigStructure, algorithmFor } from './cose.js';
import { parseCertificate } from './x509.js';
import { parseJumbf, findByLabel, findByType } from './jumbf.js';
import { decodeCbor } from './cbor.js';

/**
 * Verificación de manifiestos C2PA.
 *
 * El resultado distingue tres estados, y la distinción es el punto entero de
 * este módulo:
 *
 *   'unsigned'   no hay firma que comprobar
 *   'invalid'    hay firma y NO cuadra. Señal de manipulación
 *   'valid'      la firma es criptográficamente correcta
 *
 * `valid` NO significa "de confianza". Significa que quien firmó posee la clave
 * del certificado incrustado. Ese certificado puede ser autofirmado por
 * cualquiera. La confianza requiere validar la cadena contra la lista de
 * confianza de C2PA, que es un problema aparte y todavía no está implementado:
 * `trusted` es siempre false hasta que exista.
 *
 * Mientras `trusted` sea false, el detector no emite PROVENANCE_CONFIRMED. Se
 * prefiere quedarse corto a anunciar una certeza que no tenemos.
 */

export type SignatureStatus = 'unsigned' | 'invalid' | 'valid';

export interface VerificationResult {
  readonly status: SignatureStatus;
  /** Cadena validada contra un ancla de confianza. Hoy siempre false. */
  readonly trusted: boolean;
  readonly algorithm: string | undefined;
  /** El certificado estaba dentro de su periodo de validez al verificar. */
  readonly certificateInDate: boolean | undefined;
  readonly reason: string;
}

/** WebCrypto inyectado: el paquete no asume navegador ni Node (ADR-001). */
export interface CryptoProvider {
  importKey(
    format: 'spki',
    keyData: Uint8Array,
    algorithm: Record<string, unknown>,
    extractable: boolean,
    usages: readonly string[],
  ): Promise<unknown>;
  verify(
    algorithm: Record<string, unknown>,
    key: unknown,
    signature: Uint8Array,
    data: Uint8Array,
  ): Promise<boolean>;
}

export interface VerifyOptions {
  readonly crypto: CryptoProvider;
  readonly now?: Date;
}

const UNSIGNED = (reason: string): VerificationResult => ({
  status: 'unsigned',
  trusted: false,
  algorithm: undefined,
  certificateInDate: undefined,
  reason,
});

const INVALID = (reason: string, algorithm?: string): VerificationResult => ({
  status: 'invalid',
  trusted: false,
  ...(algorithm !== undefined ? { algorithm } : { algorithm: undefined }),
  certificateInDate: undefined,
  reason,
});

/**
 * Verifica el manifiesto C2PA de un bloque JUMBF.
 *
 * Nunca lanza: procesa bytes de terceros y un fallo de parseo es un resultado
 * ('unsigned'), no una excepción que derribe el análisis.
 */
export async function verifyC2paManifest(
  jumbfBytes: Uint8Array,
  opts: VerifyOptions,
): Promise<VerificationResult> {
  try {
    return await verifyInner(jumbfBytes, opts);
  } catch (err) {
    return UNSIGNED(`no verificable: ${err instanceof Error ? err.message : 'error'}`);
  }
}

async function verifyInner(
  jumbfBytes: Uint8Array,
  opts: VerifyOptions,
): Promise<VerificationResult> {
  const boxes = parseJumbf(jumbfBytes);
  if (boxes.length === 0) return UNSIGNED('sin cajas JUMBF');

  // La firma vive en una caja etiquetada c2pa.signature; su contenido es un
  // COSE_Sign1 dentro de una caja 'cbor'.
  const sigBox = findByLabel(boxes, 'c2pa.signature');
  if (sigBox === undefined) return UNSIGNED('sin caja c2pa.signature');

  const coseBytes = findByType(sigBox.children, 'cbor')[0]?.payload;
  if (coseBytes === undefined) return UNSIGNED('caja de firma sin contenido CBOR');

  const cose = parseCoseSign1(coseBytes);

  const spec = algorithmFor(cose.alg);
  if (spec === undefined) {
    return INVALID(`algoritmo no admitido: ${String(cose.alg)}`);
  }

  const certDer = cose.x5chain[0];
  if (certDer === undefined) return INVALID('sin certificado en x5chain', spec.name);

  const cert = parseCertificate(certDer);

  // El claim es el payload firmado; en C2PA va desacoplado de la estructura COSE.
  const claimBox = findByLabel(boxes, 'c2pa.claim');
  const claimBytes = claimBox && findByType(claimBox.children, 'cbor')[0]?.payload;
  const payload = cose.payload ?? claimBytes;
  if (payload === undefined || payload === null) {
    return INVALID('sin payload que verificar', spec.name);
  }

  const toVerify = sigStructure(cose, payload);

  let ok: boolean;
  try {
    const key = await opts.crypto.importKey('spki', cert.spki, spec.importParams, false, [
      'verify',
    ]);
    ok = await opts.crypto.verify(spec.verifyParams, key, cose.signature, toVerify);
  } catch (err) {
    return INVALID(
      `fallo al verificar: ${err instanceof Error ? err.message : 'error'}`,
      spec.name,
    );
  }

  if (!ok) return INVALID('la firma no corresponde al contenido', spec.name);

  const now = opts.now ?? new Date();
  const inDate =
    cert.notBefore !== undefined && cert.notAfter !== undefined
      ? now >= cert.notBefore && now <= cert.notAfter
      : undefined;

  return {
    status: 'valid',
    // Pendiente: validación de cadena contra la lista de confianza de C2PA.
    // Hasta entonces, una firma válida solo prueba posesión de la clave.
    trusted: false,
    algorithm: spec.name,
    certificateInDate: inDate,
    reason:
      inDate === false
        ? 'firma válida pero el certificado está fuera de fecha'
        : 'firma válida; cadena de confianza sin validar',
  };
}

/** Extrae del claim los datos declarativos que la UI puede mostrar. */
export function readClaimAssertions(jumbfBytes: Uint8Array): readonly string[] {
  try {
    const boxes = parseJumbf(jumbfBytes);
    const claimBox = findByLabel(boxes, 'c2pa.claim');
    const cbor = claimBox && findByType(claimBox.children, 'cbor')[0]?.payload;
    if (cbor === undefined) return [];

    const claim = decodeCbor(cbor);
    if (!(claim instanceof Map)) return [];

    const out: string[] = [];
    const generator = claim.get('claim_generator');
    if (typeof generator === 'string') out.push(`generador: ${generator}`);

    const assertions = claim.get('assertions');
    if (Array.isArray(assertions)) {
      for (const a of assertions) {
        if (a instanceof Map) {
          const url = a.get('url');
          if (typeof url === 'string') out.push(url);
        }
      }
    }
    return out;
  } catch {
    return [];
  }
}
