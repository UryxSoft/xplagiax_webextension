import { describe, expect, it, vi } from 'vitest';
import { ErrorCode } from '@xpx/ipc';
import { Band, DetectorRegistry, Pipeline } from '@xpx/kernel';
import type { Detector, Evidence, NormalizedInput, Verdict } from '@xpx/kernel';
import { ChromiumRuntimeHost, OFFSCREEN_PORT } from '../src/platform/chromium-host.js';
import { startInferenceServer } from '../src/platform/inference-server.js';
import type { RejectionReason } from '../src/platform/inference-server.js';
import { isNormalizedInput, isVerdict } from '../src/messaging/wire.js';
import { fakeChromium, flush } from './fake-browser.js';
import type { PortLike } from '../src/platform/extension-api.js';

const HASH = 'a'.repeat(64);

/**
 * `llrTotal = llr × reliability`, y sobre él se aplica un intervalo conforme de
 * ±0.7 que debe quedar entero por encima del umbral (2.0) para afirmar. De ahí
 * los valores: 4 da señal fuerte, 1 da señal débil, 0 no da nada.
 */
const LLR_FUERTE = 4;
const LLR_DEBIL = 1;

function entrada(over: Partial<NormalizedInput> = {}): NormalizedInput {
  return {
    hash: HASH,
    modality: 'text',
    text: 'Un texto cualquiera lo bastante largo para pasar por el registro.',
    lang: 'es',
    // Por encima de policy.minTokens (150); por debajo, el kernel se abstiene
    // por TOO_SHORT y estos tests medirían otra cosa.
    tokenCount: 200,
    ...over,
  };
}

function evidencia(llr: number): Evidence {
  return {
    detectorId: 'prueba',
    detectorVersion: '1.0.0',
    kind: 'heuristic',
    modality: 'text',
    llr,
    reliability: 0.8,
    calibrationId: 'prueba-v1',
    rationale: [],
    costMs: 1,
  };
}

function detector(llr: number): Detector {
  return {
    id: 'prueba',
    version: '1.0.0',
    capabilities: { modalities: ['text'], tier: 0, languages: 'any' },
    canHandle: () => true,
    score: async () => [evidencia(llr)],
  };
}

function pipelineCon(llr: number): Pipeline {
  return new Pipeline({ registry: new DetectorRegistry().register(detector(llr)) });
}

// ---------------------------------------------------------------------------

describe('contrato de cable · isNormalizedInput', () => {
  it('acepta una entrada bien formada', () => {
    expect(isNormalizedInput(entrada())).toBe(true);
  });

  /** El hash es la clave de caché y lo único que se persiste. */
  it('exige un sha256 hexadecimal, no una cadena cualquiera', () => {
    expect(isNormalizedInput(entrada({ hash: 'no-soy-un-hash' }))).toBe(false);
    expect(isNormalizedInput(entrada({ hash: 'A'.repeat(64) }))).toBe(false);
    expect(isNormalizedInput(entrada({ hash: 'a'.repeat(63) }))).toBe(false);
    expect(isNormalizedInput(entrada({ hash: '../../etc/passwd' }))).toBe(false);
  });

  it('rechaza modalidades e idiomas inventados', () => {
    expect(isNormalizedInput({ ...entrada(), modality: 'telepatía' })).toBe(false);
    expect(isNormalizedInput(entrada({ lang: '' }))).toBe(false);
    expect(isNormalizedInput(entrada({ lang: 'x'.repeat(40) }))).toBe(false);
  });

  it('rechaza tokenCount negativo o no finito', () => {
    expect(isNormalizedInput(entrada({ tokenCount: -1 }))).toBe(false);
    expect(isNormalizedInput(entrada({ tokenCount: Number.NaN }))).toBe(false);
    expect(isNormalizedInput(entrada({ tokenCount: Number.POSITIVE_INFINITY }))).toBe(false);
  });

  /** Sin cota, un content script comprometido tumba el documento offscreen. */
  it('pone techo al texto', () => {
    expect(isNormalizedInput(entrada({ text: 'x'.repeat(200_000) }))).toBe(true);
    expect(isNormalizedInput(entrada({ text: 'x'.repeat(200_001) }))).toBe(false);
  });

  it('acepta píxeles coherentes y rechaza los que no cuadran', () => {
    const ok = { width: 2, height: 2, data: new Uint8ClampedArray(2 * 2 * 4) };
    expect(isNormalizedInput(entrada({ modality: 'image', pixels: ok }))).toBe(true);

    // Un búfer que no encaja con las dimensiones haría que un detector leyera
    // fuera de rango. Es el invariante que no se ve a simple vista.
    const corto = { width: 4, height: 4, data: new Uint8ClampedArray(8) };
    expect(isNormalizedInput(entrada({ modality: 'image', pixels: corto }))).toBe(false);

    const enorme = { width: 100_000, height: 1, data: new Uint8ClampedArray(400_000) };
    expect(isNormalizedInput(entrada({ modality: 'image', pixels: enorme }))).toBe(false);
  });

  it('rechaza bytes crudos que no son un Uint8Array', () => {
    expect(isNormalizedInput({ ...entrada(), rawBytes: [1, 2, 3] })).toBe(false);
    expect(isNormalizedInput(entrada({ rawBytes: new Uint8Array([1, 2]) }))).toBe(true);
  });

  it('valida domHints si viene', () => {
    expect(
      isNormalizedInput(entrada({ domHints: { isArticle: true, isUserGenerated: false } })),
    ).toBe(true);
    expect(isNormalizedInput({ ...entrada(), domHints: { isArticle: 'sí' } })).toBe(false);
  });

  it('rechaza lo que ni siquiera es un objeto', () => {
    for (const v of [null, undefined, 42, 'texto', [], true]) {
      expect(isNormalizedInput(v)).toBe(false);
    }
  });
});

describe('contrato de cable · isVerdict', () => {
  const veredicto: Verdict = {
    hash: HASH,
    band: Band.WeakSignal,
    llrTotal: 1.2,
    interval: { lower: 0.4, upper: 2.0 },
    evidence: [evidencia(1.2)],
    validations: [],
    elapsedMs: 12,
  };

  it('acepta un veredicto bien formado', () => {
    expect(isVerdict(veredicto)).toBe(true);
  });

  it('rechaza una banda inventada', () => {
    expect(isVerdict({ ...veredicto, band: 'CASI_SEGURO' })).toBe(false);
  });

  it('rechaza llr o intervalo no finitos', () => {
    expect(isVerdict({ ...veredicto, llrTotal: Number.NaN })).toBe(false);
    expect(isVerdict({ ...veredicto, interval: { lower: 0, upper: Number.NaN } })).toBe(false);
  });

  /** Fuera de [0,1] la fusión daría un peso sin sentido. */
  it('rechaza una fiabilidad fuera de rango', () => {
    expect(isVerdict({ ...veredicto, evidence: [{ ...evidencia(1), reliability: 1.5 }] })).toBe(
      false,
    );
    expect(isVerdict({ ...veredicto, evidence: [{ ...evidencia(1), reliability: -0.1 }] })).toBe(
      false,
    );
  });

  it('acepta un veredicto real salido del pipeline', async () => {
    expect(isVerdict(await pipelineCon(LLR_FUERTE).analyze(entrada()))).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('startInferenceServer · quién puede pedir inferencia', () => {
  it('atiende una conexión del propio contexto privilegiado', async () => {
    const f = fakeChromium();
    const servidor = startInferenceServer({
      api: f.api,
      analyze: (i) => pipelineCon(LLR_FUERTE).analyze(i),
    });
    f.connectFrom(OFFSCREEN_PORT);
    expect(servidor.connectionCount).toBe(1);
    servidor.dispose();
  });

  /**
   * La regla de 03-arquitectura.md §11 hecha código. `runtime.onConnect` no
   * distingue por sí solo quién llama: un content script puede invocar
   * `runtime.connect` igual que el background. Si la separación no se impone
   * aquí, no existe.
   */
  it('rechaza y desconecta a un content script', async () => {
    const f = fakeChromium();
    const rechazos: RejectionReason[] = [];
    const analyze = vi.fn(async () => pipelineCon(LLR_FUERTE).analyze(entrada()));
    const servidor = startInferenceServer({
      api: f.api,
      analyze,
      onRejected: (r) => rechazos.push(r),
    });

    // Un content script: el navegador rellena sender.tab.
    f.connectFrom(OFFSCREEN_PORT, { tab: { id: 7 }, url: 'https://sitio-hostil.example/' });

    expect(rechazos).toEqual(['untrusted-sender']);
    expect(servidor.connectionCount).toBe(0);
    expect(analyze).not.toHaveBeenCalled();
    servidor.dispose();
  });

  it('un content script rechazado ni siquiera puede enviar por el puerto', async () => {
    const f = fakeChromium();
    const analyze = vi.fn(async () => pipelineCon(LLR_FUERTE).analyze(entrada()));
    const servidor = startInferenceServer({ api: f.api, analyze });

    const puerto = f.connectFrom(OFFSCREEN_PORT, { tab: { id: 7 } });
    expect(() =>
      puerto.postMessage({
        v: 1,
        id: 'x',
        channel: 'infer',
        kind: 'request',
        payload: entrada(),
      }),
    ).toThrow(/disconnected/);
    await flush();
    expect(analyze).not.toHaveBeenCalled();
    servidor.dispose();
  });

  it('ignora puertos de otra funcionalidad sin desconectarlos', () => {
    const f = fakeChromium();
    const rechazos: RejectionReason[] = [];
    const servidor = startInferenceServer({
      api: f.api,
      analyze: (i) => pipelineCon(LLR_FUERTE).analyze(i),
      onRejected: (r) => rechazos.push(r),
    });

    f.connectFrom('otra-cosa');
    expect(rechazos).toEqual(['wrong-port']);
    expect(servidor.connectionCount).toBe(0);
    servidor.dispose();
  });

  it('libera la conexión cuando el puerto se cae', () => {
    const f = fakeChromium();
    const servidor = startInferenceServer({
      api: f.api,
      analyze: (i) => pipelineCon(LLR_FUERTE).analyze(i),
    });
    f.connectFrom(OFFSCREEN_PORT);
    expect(servidor.connectionCount).toBe(1);

    f.ports[0]?.drop();
    expect(servidor.connectionCount).toBe(0);
    servidor.dispose();
  });

  it('dispose deja de atender conexiones nuevas', () => {
    const f = fakeChromium();
    const servidor = startInferenceServer({
      api: f.api,
      analyze: (i) => pipelineCon(LLR_FUERTE).analyze(i),
    });
    servidor.dispose();
    f.connectFrom(OFFSCREEN_PORT);
    expect(servidor.connectionCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe('extremo a extremo · service worker ↔ documento offscreen', () => {
  /** Monta los dos lados reales sobre el mismo doble de navegador. */
  function montar(llr = LLR_FUERTE) {
    const f = fakeChromium();
    const servidor = startInferenceServer({
      api: f.api,
      analyze: (i) => pipelineCon(llr).analyze(i),
    });
    const host = new ChromiumRuntimeHost({ api: f.api });
    return { f, servidor, host };
  }

  it('un análisis completo va y vuelve por el puerto', async () => {
    const { host, servidor, f } = montar(LLR_FUERTE);
    const veredicto = await host.run('infer', entrada(), isVerdict);

    expect(veredicto.hash).toBe(HASH);
    expect(veredicto.band).toBe(Band.StrongSignal);
    expect(veredicto.evidence).toHaveLength(1);
    expect(f.calls.create).toBe(1);
    servidor.dispose();
  });

  it('una señal más floja llega como banda débil, no como fuerte', async () => {
    const { host, servidor } = montar(LLR_DEBIL);
    const veredicto = await host.run('infer', entrada(), isVerdict);
    expect(veredicto.band).toBe(Band.WeakSignal);
    servidor.dispose();
  });

  it('sin evidencia se abstiene en lugar de inventarse una banda', async () => {
    const { host, servidor } = montar(0);
    const veredicto = await host.run('infer', entrada(), isVerdict);
    expect(veredicto.band).toBe(Band.InsufficientEvidence);
    expect(veredicto.abstentionReason).toBeDefined();
    servidor.dispose();
  });

  /**
   * El texto corto no es "poco probable que sea IA": es una entrada sobre la
   * que el sistema no está validado. La distinción viaja intacta por el puerto.
   */
  it('un texto por debajo del mínimo se abstiene con su motivo', async () => {
    const { host, servidor } = montar(LLR_FUERTE);
    const veredicto = await host.run('infer', entrada({ tokenCount: 20 }), isVerdict);
    expect(veredicto.band).toBe(Band.InsufficientEvidence);
    expect(veredicto.abstentionReason).toBe('TOO_SHORT');
    servidor.dispose();
  });

  it('una entrada mal formada la rechaza el servidor, no el kernel', async () => {
    const { host, servidor } = montar();
    await expect(
      host.run('infer', { ...entrada(), hash: 'basura' }, isVerdict),
    ).rejects.toMatchObject({ code: ErrorCode.BadRequest });
    servidor.dispose();
  });

  it('varias peticiones concurrentes se correlacionan bien', async () => {
    const { host, servidor } = montar(LLR_FUERTE);
    const hashes = ['b', 'c', 'd'].map((c) => c.repeat(64));
    const veredictos = await Promise.all(
      hashes.map((hash) => host.run('infer', entrada({ hash }), isVerdict)),
    );
    expect(veredictos.map((v) => v.hash)).toEqual(hashes);
    servidor.dispose();
  });

  /**
   * Un veredicto bajo una clave que no es la suya corrompería la caché del
   * llamante. Es barato de comprobar y caro de descubrir después.
   */
  it('un veredicto cuyo hash no corresponde a la entrada no se entrega', async () => {
    const f = fakeChromium();
    const servidor = startInferenceServer({
      api: f.api,
      analyze: async (i) => ({ ...(await pipelineCon(LLR_FUERTE).analyze(i)), hash: 'e'.repeat(64) }),
    });
    const host = new ChromiumRuntimeHost({ api: f.api });

    await expect(host.run('infer', entrada(), isVerdict)).rejects.toMatchObject({
      code: ErrorCode.Internal,
    });
    servidor.dispose();
  });

  it('un fallo del análisis no filtra su mensaje al llamante', async () => {
    const f = fakeChromium();
    const servidor = startInferenceServer({
      api: f.api,
      analyze: async () => {
        throw new Error('/ruta/interna/modelo.onnx no encontrado');
      },
    });
    const host = new ChromiumRuntimeHost({ api: f.api });

    await expect(host.run('infer', entrada(), isVerdict)).rejects.toMatchObject({
      code: ErrorCode.Internal,
      message: 'error interno',
    });
    servidor.dispose();
  });

  it('las imágenes cruzan la frontera con sus píxeles intactos', async () => {
    const f = fakeChromium();
    let recibido: NormalizedInput | undefined;
    const servidor = startInferenceServer({
      api: f.api,
      analyze: async (i) => {
        recibido = i;
        return pipelineCon(0).analyze(entrada());
      },
    });
    const host = new ChromiumRuntimeHost({ api: f.api });

    const data = new Uint8ClampedArray(2 * 2 * 4).fill(7);
    await host.run(
      'infer',
      entrada({ modality: 'image', pixels: { width: 2, height: 2, data } }),
      isVerdict,
    );

    expect(recibido?.pixels?.data).toBeInstanceOf(Uint8ClampedArray);
    expect(recibido?.pixels?.data?.[0]).toBe(7);
    servidor.dispose();
  });

  /**
   * Una carga no clonable es un error de programación. Si el transporte lo
   * absorbiera, se convertiría en una petición que jamás vuelve.
   */
  it('una carga que no cruza la frontera falla en voz alta', async () => {
    const { host, servidor } = montar();
    const noClonable = { ...entrada(), domHints: { isArticle: () => true } };
    await expect(host.run('infer', noClonable, isVerdict)).rejects.toThrow(/clon|cloned/i);
    servidor.dispose();
  });

  it('tras teardown, la siguiente llamada reconstruye el canal y sigue funcionando', async () => {
    const { host, servidor, f } = montar(LLR_FUERTE);
    await host.run('infer', entrada(), isVerdict);
    await host.teardown();

    const veredicto = await host.run('infer', entrada(), isVerdict);
    expect(veredicto.band).toBe(Band.StrongSignal);
    expect(f.calls.connect).toBe(2);
    servidor.dispose();
  });

  it('el servidor no atiende conexiones de un puerto ajeno aunque el host exista', async () => {
    const { host, servidor, f } = montar();
    await host.ensure();
    const ajeno: PortLike = f.connectFrom('puerto-de-otro');
    expect(ajeno.name).toBe('puerto-de-otro');
    expect(servidor.connectionCount).toBe(0);
    servidor.dispose();
  });
});
