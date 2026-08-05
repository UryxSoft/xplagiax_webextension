import { describe, expect, it } from 'vitest';
import { decodeCbor, CborError } from '../src/cbor.js';
import { parseJumbf, findByLabel } from '../src/jumbf.js';
import { parseCoseSign1, algorithmFor } from '../src/cose.js';
import { parseCertificate } from '../src/x509.js';
import { verifyC2paManifest, readClaimAssertions } from '../src/verify.js';
import { ProvenanceDetector } from '../src/index.js';
import { buildSignedManifest, jpegWithManifest, nodeCrypto, jumb, box } from './c2pa-builder.js';
import { Pipeline, DetectorRegistry, Band } from '../../../kernel/src/index.js';
import type { NormalizedInput } from '../../../kernel/src/index.js';

const bytes = (...n: number[]): Uint8Array => Uint8Array.from(n);

function imageInput(rawBytes: Uint8Array): NormalizedInput {
  return { hash: 'h', modality: 'image', lang: 'und', tokenCount: 0, rawBytes };
}

describe('CBOR', () => {
  it('decodifica los tipos que usa C2PA', () => {
    expect(decodeCbor(bytes(0x0a))).toBe(10);
    expect(decodeCbor(bytes(0x26))).toBe(-7);
    expect(decodeCbor(bytes(0x18, 0x21))).toBe(33);
    expect(decodeCbor(bytes(0x43, 1, 2, 3))).toEqual(bytes(1, 2, 3));
    expect(decodeCbor(bytes(0x63, 0x61, 0x62, 0x63))).toBe('abc');
    expect(decodeCbor(bytes(0x82, 0x01, 0x02))).toEqual([1, 2]);
    expect(decodeCbor(bytes(0xf5))).toBe(true);
    expect(decodeCbor(bytes(0xf6))).toBe(null);
  });

  it('decodifica mapas y tags', () => {
    const m = decodeCbor(bytes(0xa1, 0x01, 0x26));
    expect(m).toBeInstanceOf(Map);
    expect((m as Map<unknown, unknown>).get(1)).toBe(-7);
    expect(decodeCbor(bytes(0xd2, 0x01))).toEqual({ tag: 18, value: 1 });
  });

  // Parsea bytes de terceros: cada fallo debe ser un error, nunca un cuelgue.
  it('rechaza entradas malformadas sin colgarse', () => {
    expect(() => decodeCbor(bytes(0x43, 1))).toThrow(CborError); // bstr truncado
    expect(() => decodeCbor(new Uint8Array(0))).toThrow(CborError);
    expect(() => decodeCbor(bytes(0x5f))).toThrow(/indefinida/); // longitud indefinida
    // Un array que declara 4 mil millones de elementos no debe intentar reservarlos.
    expect(() => decodeCbor(bytes(0x9a, 0xff, 0xff, 0xff, 0xff))).toThrow(CborError);
  });

  it('rechaza anidamiento excesivo', () => {
    const deep = new Uint8Array(200).fill(0x81); // 200 arrays anidados
    expect(() => decodeCbor(deep)).toThrow(/profundidad/);
  });
});

describe('JUMBF', () => {
  it('lee superboxes y extrae la etiqueta del descriptor', () => {
    const boxes = parseJumbf(jumb('c2pa.claim', box('cbor', bytes(1, 2, 3))));
    expect(boxes[0]?.type).toBe('jumb');
    expect(boxes[0]?.label).toBe('c2pa.claim');
  });

  it('encuentra cajas anidadas por etiqueta', () => {
    const tree = parseJumbf(jumb('c2pa', jumb('c2pa.signature', box('cbor', bytes(9)))));
    expect(findByLabel(tree, 'c2pa.signature')).toBeDefined();
    expect(findByLabel(tree, 'c2pa.inexistente')).toBeUndefined();
  });

  it('no se cuelga con cajas truncadas o de longitud cero', () => {
    const full = jumb('c2pa', box('cbor', new Uint8Array(40)));
    for (let n = 0; n < full.length; n += 1) {
      expect(() => parseJumbf(full.subarray(0, n))).not.toThrow();
    }
    // Longitud declarada menor que la cabecera: no debe retroceder ni iterar.
    expect(() => parseJumbf(bytes(0, 0, 0, 2, 0x6a, 0x75, 0x6d, 0x62))).not.toThrow();
  });
});

describe('COSE', () => {
  it('mapea los algoritmos del perfil C2PA', () => {
    expect(algorithmFor(-7)?.name).toBe('ES256');
    expect(algorithmFor(-37)?.name).toBe('PS256');
  });

  it('rechaza RS256, que no está en el perfil', () => {
    expect(algorithmFor(-257)).toBeUndefined();
  });

  it('rechaza estructuras que no son COSE_Sign1', () => {
    expect(() => parseCoseSign1(bytes(0x82, 0x01, 0x02))).toThrow(/4 elementos/);
  });
});

describe('X.509', () => {
  it('extrae la SubjectPublicKeyInfo y las fechas', async () => {
    const { jumbf } = await buildSignedManifest();
    const sig = findByLabel(parseJumbf(jumbf), 'c2pa.signature');
    const cose = parseCoseSign1(sig!.children.find((c) => c.type === 'cbor')!.payload);
    const cert = parseCertificate(cose.x5chain[0]!);

    expect(cert.spki.length).toBeGreaterThan(50);
    expect(cert.notBefore).toBeInstanceOf(Date);
    expect(cert.notAfter!.getTime()).toBeGreaterThan(cert.notBefore!.getTime());
  });
});

describe('verificación de firma C2PA', () => {
  it('acepta una firma auténtica', async () => {
    const { jumbf } = await buildSignedManifest();
    const r = await verifyC2paManifest(jumbf, { crypto: nodeCrypto });
    expect(r.status).toBe('valid');
    expect(r.algorithm).toBe('ES256');
    expect(r.certificateInDate).toBe(true);
  });

  /**
   * El test que justifica todo este módulo: si el claim cambia después de
   * firmar, la firma tiene que dejar de cuadrar. Es la diferencia entre
   * comprobar que existe una firma y comprobar que la firma dice la verdad.
   */
  it('rechaza un claim alterado tras la firma', async () => {
    const { jumbf } = await buildSignedManifest({ tamperClaim: true });
    const r = await verifyC2paManifest(jumbf, { crypto: nodeCrypto });
    expect(r.status).toBe('invalid');
  });

  it('una firma válida NO implica confianza', async () => {
    const { jumbf } = await buildSignedManifest();
    const r = await verifyC2paManifest(jumbf, { crypto: nodeCrypto });
    expect(r.status).toBe('valid');
    // El certificado es autofirmado por el propio test. Sin validación de
    // cadena, trusted debe seguir siendo false.
    expect(r.trusted).toBe(false);
    expect(r.reason).toMatch(/cadena de confianza sin validar/);
  });

  it('detecta un certificado caducado', async () => {
    const { jumbf } = await buildSignedManifest({
      notBefore: new Date('2020-01-01'),
      notAfter: new Date('2021-01-01'),
    });
    const r = await verifyC2paManifest(jumbf, { crypto: nodeCrypto });
    expect(r.status).toBe('valid');
    expect(r.certificateInDate).toBe(false);
  });

  it('sin caja de firma, el resultado es unsigned, no un error', async () => {
    const r = await verifyC2paManifest(jumb('c2pa'), { crypto: nodeCrypto });
    expect(r.status).toBe('unsigned');
  });

  it('nunca lanza, sean cuales sean los bytes', async () => {
    for (const b of [new Uint8Array(0), bytes(1, 2, 3), new Uint8Array(100).fill(0xff)]) {
      await expect(verifyC2paManifest(b, { crypto: nodeCrypto })).resolves.toBeDefined();
    }
  });

  it('lee las aserciones declarativas del claim', async () => {
    const { jumbf } = await buildSignedManifest();
    expect(readClaimAssertions(jumbf)).toBeInstanceOf(Array);
  });
});

describe('detector con verificación', () => {
  it('sin crypto inyectado no verifica y se queda en indicio', async () => {
    const { jumbf } = await buildSignedManifest();
    const [e] = await new ProvenanceDetector().score(imageInput(jpegWithManifest(jumbf)));
    expect(e?.reliability).toBeLessThanOrEqual(0.7);
  });

  it('con crypto, una firma válida sube la fiabilidad', async () => {
    const { jumbf } = await buildSignedManifest();
    const d = new ProvenanceDetector({ crypto: nodeCrypto });
    const [e] = await d.score(imageInput(jpegWithManifest(jumbf)));
    expect(e?.reliability).toBeGreaterThan(0.7);
  });

  it('sigue sin alcanzar reliability 1 sin cadena de confianza', async () => {
    const { jumbf } = await buildSignedManifest();
    const d = new ProvenanceDetector({ crypto: nodeCrypto });
    const [e] = await d.score(imageInput(jpegWithManifest(jumbf)));
    expect(e?.reliability).toBeLessThan(1);
  });

  it('una firma que no cuadra se reporta como manipulación', async () => {
    const { jumbf } = await buildSignedManifest({ tamperClaim: true });
    const d = new ProvenanceDetector({ crypto: nodeCrypto });
    const [e] = await d.score(imageInput(jpegWithManifest(jumbf)));
    expect(e?.rationale[0]?.code).toBe('PROVENANCE_SIGNATURE_INVALID');
    expect(e?.llr).toBeGreaterThan(0);
  });

  it('el pipeline no emite PROVENANCE_CONFIRMED sin cadena validada', async () => {
    const { jumbf } = await buildSignedManifest();
    const registry = new DetectorRegistry().register(
      new ProvenanceDetector({ crypto: nodeCrypto }),
    );
    const v = await new Pipeline({ registry, maxTier: 0 }).analyze(
      imageInput(jpegWithManifest(jumbf)),
    );
    expect(v.band).not.toBe(Band.ProvenanceConfirmed);
    expect(v.band).toBe(Band.StrongSignal);
  });
});
