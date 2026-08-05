import type {
  Detector,
  DetectorCapabilities,
  Evidence,
  NormalizedInput,
  Rationale,
} from '@xpx/kernel';
import { scanProvenance } from './indicators.js';
import type { Indicator } from './indicators.js';

export * from './containers.js';
export * from './indicators.js';

export const CALIBRATION_ID = 'provenance-v0.1';

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
export class ProvenanceDetector implements Detector {
  readonly id = 'provenance';
  readonly version = '0.1.0';

  readonly capabilities: DetectorCapabilities = {
    modalities: ['image'],
    tier: 0,
    languages: 'any',
  };

  canHandle(input: NormalizedInput): boolean {
    return input.modality === 'image' && input.rawBytes !== undefined;
  }

  async score(input: NormalizedInput): Promise<readonly Evidence[]> {
    const started = Date.now();
    const bytes = input.rawBytes;

    if (bytes === undefined) return [this.#nothing(started)];

    const scan = scanProvenance(bytes);
    if (scan.indicators.length === 0) return [this.#nothing(started)];

    let llr = 0;
    let reliability = 0;
    const rationale: Rationale[] = [];

    for (const ind of scan.indicators) {
      const w = weightOf(ind);
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
 * Ningún indicador alcanza hoy `reliability: 1`, que es lo que activaría la
 * banda PROVENANCE_CONFIRMED. Esa banda significa certeza criptográfica, y la
 * verificación de la firma COSE no está implementada todavía. Anunciar certeza
 * sobre un manifiesto que no hemos comprobado sería exactamente la clase de
 * afirmación que este producto existe para no hacer.
 */
function weightOf(ind: Indicator): { llr: number; reliability: number } {
  switch (ind.kind) {
    case 'c2pa-manifest':
      // Con firma verificada: llr 8, reliability 1 → PROVENANCE_CONFIRMED.
      return ind.verified ? { llr: 8, reliability: 1 } : { llr: 3, reliability: 0.7 };
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
