import { describe, expect, it } from 'vitest';
import { detectFormat, readSegments } from '../src/containers.js';
import { scanProvenance } from '../src/indicators.js';
import { ProvenanceDetector } from '../src/index.js';
import { jpeg, png, webp, exifCamera, xmpSourceType } from './fixtures.js';
import { Pipeline, DetectorRegistry, Band } from '../../../kernel/src/index.js';
import type { NormalizedInput } from '../../../kernel/src/index.js';

function imageInput(rawBytes: Uint8Array): NormalizedInput {
  return { hash: 'h', modality: 'image', lang: 'und', tokenCount: 0, rawBytes };
}

describe('detección de formato', () => {
  it('reconoce JPEG, PNG y WebP', () => {
    expect(detectFormat(jpeg())).toBe('jpeg');
    expect(detectFormat(png())).toBe('png');
    expect(detectFormat(webp())).toBe('webp');
  });

  it('devuelve unknown ante bytes arbitrarios', () => {
    expect(detectFormat(Uint8Array.from([1, 2, 3, 4]))).toBe('unknown');
    expect(detectFormat(new Uint8Array(0))).toBe('unknown');
  });
});

describe('lectura de segmentos', () => {
  it('lee los marcadores APP de un JPEG y para en SOS', () => {
    const segs = readSegments(jpeg([{ marker: 1, payload: 'hola' }, { marker: 11, payload: 'c2pa' }]));
    expect(segs.map((s) => s.kind)).toEqual(['APP1', 'APP11']);
  });

  it('lee los chunks de un PNG', () => {
    const segs = readSegments(png([{ type: 'tEXt', data: 'x' }]));
    expect(segs.map((s) => s.kind)).toContain('tEXt');
    expect(segs.map((s) => s.kind)).toContain('IEND');
  });

  it('lee los chunks de un WebP con relleno impar', () => {
    const segs = readSegments(webp([{ fourcc: 'EXIF', data: 'abc' }, { fourcc: 'XMP', data: 'def' }]));
    expect(segs.map((s) => s.kind)).toEqual(['EXIF', 'XMP']);
  });

  // Los bytes vienen de terceros: el parseo no puede colgarse ni lanzar.
  it('no se cuelga ni lanza con entradas truncadas o corruptas', () => {
    const full = jpeg([{ marker: 1, payload: 'x'.repeat(50) }]);
    for (let n = 0; n < full.length; n += 1) {
      expect(() => readSegments(full.subarray(0, n))).not.toThrow();
    }
    const corrupt = png([{ type: 'tEXt', data: 'x'.repeat(30) }]);
    corrupt[10] = 0xff;
    corrupt[11] = 0xff;
    expect(() => readSegments(corrupt)).not.toThrow();
  });
});

describe('indicadores de procedencia', () => {
  it('no encuentra nada en una imagen sin metadatos', () => {
    const scan = scanProvenance(jpeg());
    expect(scan.indicators).toHaveLength(0);
    expect(scan.hasMetadata).toBe(false);
  });

  it('detecta una caja C2PA en APP11', () => {
    const scan = scanProvenance(jpeg([{ marker: 11, payload: 'jumb\0c2pa manifest store' }]));
    expect(scan.indicators.map((i) => i.kind)).toContain('c2pa-manifest');
  });

  it('detecta una caja C2PA en un chunk caBX de PNG', () => {
    const scan = scanProvenance(png([{ type: 'caBX', data: 'manifest' }]));
    expect(scan.indicators[0]?.kind).toBe('c2pa-manifest');
  });

  it('un manifiesto C2PA NUNCA se marca como verificado sin comprobar la firma', () => {
    const scan = scanProvenance(jpeg([{ marker: 11, payload: 'jumb c2pa' }]));
    expect(scan.indicators.every((i) => i.verified === false)).toBe(true);
  });

  it('detecta IPTC digitalSourceType sintético', () => {
    const scan = scanProvenance(jpeg([{ marker: 1, payload: xmpSourceType('trainedAlgorithmicMedia') }]));
    const ind = scan.indicators.find((i) => i.kind === 'iptc-synthetic');
    expect(ind?.direction).toBe('generated');
  });

  it('detecta IPTC digitalSourceType de captura', () => {
    const scan = scanProvenance(jpeg([{ marker: 1, payload: xmpSourceType('digitalCapture') }]));
    expect(scan.indicators.find((i) => i.kind === 'iptc-capture')?.direction).toBe('captured');
  });

  it('detecta generadores conocidos en metadatos', () => {
    for (const [tag, _] of [['Midjourney', 1], ['Stable Diffusion', 1], ['DALL-E 3', 1]] as const) {
      const scan = scanProvenance(png([{ type: 'tEXt', data: `Software\0${tag}` }]));
      expect(scan.indicators.some((i) => i.kind === 'generator-tag'), tag).toBe(true);
    }
  });

  it('detecta parámetros de generación en PNG', () => {
    const scan = scanProvenance(
      png([{ type: 'tEXt', data: 'parameters\0a photo, Steps: 30, Sampler: Euler a' }]),
    );
    expect(scan.indicators.some((i) => i.kind === 'generator-tag')).toBe(true);
  });

  it('detecta EXIF de cámara', () => {
    const scan = scanProvenance(jpeg([{ marker: 1, payload: exifCamera('Canon') }]));
    expect(scan.indicators.find((i) => i.kind === 'camera-exif')?.direction).toBe('captured');
  });
});

describe('ProvenanceDetector', () => {
  const d = new ProvenanceDetector();

  it('no maneja imágenes sin bytes crudos', () => {
    expect(d.canHandle({ hash: 'h', modality: 'image', lang: 'und', tokenCount: 0 })).toBe(false);
  });

  it('no maneja texto', () => {
    expect(d.canHandle({ hash: 'h', modality: 'text', lang: 'en', tokenCount: 500 })).toBe(false);
  });

  // La regla asimétrica: es lo que hace justo a este detector.
  it('AUSENCIA de procedencia da llr=0 y reliability=0, no sospecha', async () => {
    const [e] = await d.score(imageInput(jpeg()));
    expect(e?.llr).toBe(0);
    expect(e?.reliability).toBe(0);
  });

  it('un generador declarado empuja hacia generado', async () => {
    const [e] = await d.score(imageInput(png([{ type: 'tEXt', data: 'Software\0Midjourney' }])));
    expect(e?.llr).toBeGreaterThan(0);
    expect(e?.reliability).toBeGreaterThan(0);
  });

  it('el EXIF de cámara empuja hacia capturado', async () => {
    const [e] = await d.score(imageInput(jpeg([{ marker: 1, payload: exifCamera() }])));
    expect(e?.llr).toBeLessThan(0);
  });

  it('un manifiesto sin verificar NO alcanza reliability 1', async () => {
    const [e] = await d.score(imageInput(jpeg([{ marker: 11, payload: 'jumb c2pa' }])));
    expect(e?.reliability).toBeLessThan(1);
  });

  it('adjunta explicación para el botón "¿Por qué?"', async () => {
    const [e] = await d.score(imageInput(png([{ type: 'tEXt', data: 'Software\0ComfyUI' }])));
    expect(e?.rationale.length).toBeGreaterThan(0);
    expect(e?.rationale[0]?.code).toMatch(/^PROVENANCE_/);
  });
});

describe('integración con el pipeline', () => {
  const registry = new DetectorRegistry().register(new ProvenanceDetector());
  const pipeline = new Pipeline({ registry, maxTier: 0 });

  it('una imagen limpia produce abstención, no absolución', async () => {
    const v = await pipeline.analyze(imageInput(jpeg()));
    expect(v.band).toBe(Band.InsufficientEvidence);
  });

  /**
   * Sin verificación de firma, ni el indicador más fuerte llega a
   * PROVENANCE_CONFIRMED. Es deliberado: esa banda significa certeza
   * criptográfica y todavía no podemos ofrecerla.
   */
  it('un manifiesto sin verificar no alcanza PROVENANCE_CONFIRMED', async () => {
    const v = await pipeline.analyze(imageInput(jpeg([{ marker: 11, payload: 'jumb c2pa' }])));
    expect(v.band).not.toBe(Band.ProvenanceConfirmed);
    expect(v.llrTotal).toBeGreaterThan(0);
  });

  it('Tier 0 resuelve en un puñado de milisegundos', async () => {
    const big = png([
      { type: 'tEXt', data: 'Software\0Midjourney' },
      { type: 'IDAT', data: 'x'.repeat(200_000) },
    ]);
    const t0 = performance.now();
    await pipeline.analyze(imageInput(big));
    expect(performance.now() - t0).toBeLessThan(50);
  });
});
