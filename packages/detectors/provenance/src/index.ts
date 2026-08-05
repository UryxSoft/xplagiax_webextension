import type {
  Detector,
  DetectorCapabilities,
  Evidence,
  NormalizedInput,
  Rationale,
} from '@xpx/kernel';
import { scanProvenance } from './indicators.js';
import type { Indicator } from './indicators.js';
import { verifyC2paManifest } from './verify.js';
import type { CryptoProvider, VerificationResult } from './verify.js';

export * from './containers.js';
export * from './indicators.js';
export * from './jumbf.js';
export * from './cbor.js';
export * from './cose.js';
export * from './x509.js';
export * from './verify.js';

export const CALIBRATION_ID = 'provenance-v0.2';

/**
 * Detector de procedencia. Tier 0: sin modelos, sin descargas, microsegundos.
 *
 * Regla asimétrica, que es lo que distingue a este detector de todo lo demás
 * del sector (ADR-006 §3.2):
 *
 *   procedencia presente  → evidencia fuerte, en la dirección que declare
 *   procedencia ausente   → llr = 0, reliability = 0. NO es sospechoso
 *
 * La mayor parte de la web legítima no tiene credenciales, y las plataformas
 * destruyen los metadatos al recodificar. Tratar la ausencia como señal sería
 * injusto con casi todo internet.
 */
export interface ProvenanceDetectorOptions {
  /**
   * WebCrypto. Sin él, los manifiestos C2PA se detectan pero no se verifican, y
   * en consecuencia nunca alcanzan la banda de certeza.
   */
  readonly crypto?: CryptoProvider;
  readonly now?: () => Date;
}

export class ProvenanceDetector implements Detector {
  readonly id = 'provenance';
  readonly version = '0.2.0';

  readonly capabilities: DetectorCapabilities = {
    modalities: ['image'],
    tier: 0,
    languages: 'any',
  };

  readonly #crypto: CryptoProvider | undefined;
  readonly #now: () => Date;

  constructor(opts: ProvenanceDetectorOptions = {}) {
    this.#crypto = opts.crypto;
    this.#now = opts.now ?? (() => new Date());
  }

  canHandle(input: NormalizedInput): boolean {
    return input.modality === 'image' && input.rawBytes !== undefined;
  }

  async score(input: NormalizedInput): Promise<readonly Evidence[]> {
    const started = Date.now();
    const bytes = input.rawBytes;

    if (bytes === undefined) return [this.#nothing(started)];

    const scan = scanProvenance(bytes);
    if (scan.indicators.length === 0) return [this.#nothing(started)];

    const verification = await this.#verify(scan.manifestBytes);

    // Una firma que no cuadra es la señal más fuerte del sistema, y no sobre
    // el origen del contenido sino sobre su manipulación. No se promedia con
    // el resto: lo sustituye.
    if (verification?.status === 'invalid') {
      return [
        {
          detectorId: this.id,
          detectorVersion: this.version,
          kind: 'provenance',
          modality: 'image',
          llr: 5,
          reliability: 0.9,
          calibrationId: CALIBRATION_ID,
          rationale: [
            {
              code: 'PROVENANCE_SIGNATURE_INVALID',
              contribution: 5,
              params: { reason: verification.reason },
            },
          ],
          costMs: Date.now() - started,
        },
      ];
    }

    let llr = 0;
    let reliability = 0;
    const rationale: Rationale[] = [];

    for (const ind of scan.indicators) {
      const w = weightOf(ind, verification);
      const signed = ind.direction === 'generated' ? w.llr : -w.llr;
      llr += signed;
      reliability = Math.max(reliability, w.reliability);
      rationale.push({
        code: `PROVENANCE_${ind.kind.toUpperCase().replace(/-/g, '_')}`,
        contribution: signed,
        params: { detail: ind.detail, verified: String(ind.verified) },
      });
    }

    return [
      {
        detectorId: this.id,
        detectorVersion: this.version,
        kind: 'provenance',
        modality: 'image',
        llr,
        reliability: Math.min(1, reliability),
        calibrationId: CALIBRATION_ID,
        rationale,
        costMs: Date.now() - started,
      },
    ];
  }

  async #verify(manifestBytes: Uint8Array | undefined): Promise<VerificationResult | undefined> {
    if (manifestBytes === undefined || this.#crypto === undefined) return undefined;
    return verifyC2paManifest(manifestBytes, { crypto: this.#crypto, now: this.#now() });
  }

  #nothing(started: number): Evidence {
    return {
      detectorId: this.id,
      detectorVersion: this.version,
      kind: 'provenance',
      modality: 'image',
      llr: 0,
      reliability: 0,
      calibrationId: CALIBRATION_ID,
      rationale: [],
      costMs: Date.now() - started,
    };
  }
}

/**
 * Peso de cada indicador.
 *
 * `reliability: 1` —lo único que activa la banda PROVENANCE_CONFIRMED— exige
 * firma válida Y cadena de confianza validada. La validación de cadena contra
 * la lista de confianza de C2PA no está implementada, así que hoy el techo es
 * 0,9: una firma correcta prueba posesión de la clave, no que el firmante sea
 * quien dice ser. Anunciar certeza sobre un certificado que nadie ha
 * comprobado sería justo la clase de afirmación que este producto evita.
 */
function weightOf(
  ind: Indicator,
  verification: VerificationResult | undefined,
): { llr: number; reliability: number } {
  switch (ind.kind) {
    case 'c2pa-manifest': {
      if (verification?.status !== 'valid') {
        // Presencia sin verificar: indicio, no certeza.
        return { llr: 3, reliability: 0.7 };
      }
      if (verification.certificateInDate === false) {
        return { llr: 4, reliability: 0.75 };
      }
      // Firma criptográficamente válida. reliability 1 —y con ella la banda
      // PROVENANCE_CONFIRMED— exige además cadena de confianza validada.
      return verification.trusted
        ? { llr: 8, reliability: 1 }
        : { llr: 6, reliability: 0.9 };
    }
    case 'iptc-synthetic':
      return { llr: 2.5, reliability: 0.7 };
    case 'iptc-capture':
      return { llr: 1.5, reliability: 0.5 };
    case 'generator-tag':
      return { llr: 2.5, reliability: 0.65 };
    case 'camera-exif':
      // Señal débil: el EXIF se falsifica trivialmente y su presencia solo
      // indica que el fichero pasó por un flujo que lo conservó.
      return { llr: 0.8, reliability: 0.35 };
  }
}
