import { describe, expect, it, vi } from 'vitest';
import { ErrorCode, RpcClient } from '@xpx/ipc';
import { Band } from '@xpx/kernel';
import type { NormalizedInput, Verdict } from '@xpx/kernel';
import {
  CONTENT_PORT,
  LruVerdictCache,
  startAnalyzeService,
} from '../src/core/analyze-service.js';
import { startInferenceServer } from '../src/platform/inference-server.js';
import { ChromiumRuntimeHost } from '../src/platform/chromium-host.js';
import { createPipeline } from '../src/core/composition.js';
import { prepareText } from '../src/content/normalize.js';
import { isVerdict } from '../src/messaging/wire.js';
import { portTransport } from '../src/platform/port-transport.js';
import { fakeChromium } from './fake-browser.js';
import type { RuntimeHost } from '../src/platform/runtime-host.js';

const TEXTO = 'palabra '.repeat(300).trim();

/** Un host falso que cuenta llamadas, para observar la deduplicación. */
function hostFalso(respuesta: (i: NormalizedInput) => Promise<Verdict>) {
  const llamadas: NormalizedInput[] = [];
  const host: RuntimeHost = {
    platform: 'chromium',
    ensure: async () => {},
    run: async (_c, payload) => {
      llamadas.push(payload as NormalizedInput);
      return (await respuesta(payload as NormalizedInput)) as never;
    },
    teardown: async () => {},
  };
  return { host, llamadas };
}

function veredictoDe(input: NormalizedInput): Verdict {
  return {
    hash: input.hash,
    band: Band.WeakSignal,
    llrTotal: 1,
    interval: { lower: 0.3, upper: 1.7 },
    evidence: [],
    validations: [],
    elapsedMs: 1,
  };
}

/** Cliente que habla por el puerto como lo haría un content script. */
function clienteDeContenido(f: ReturnType<typeof fakeChromium>, tabId = 3) {
  const puerto = f.connectFrom(CONTENT_PORT, { tab: { id: tabId } });
  return new RpcClient({ transport: portTransport(puerto) });
}

describe('startAnalyzeService · quién puede usar el canal', () => {
  it('atiende a un content script', async () => {
    const f = fakeChromium();
    const { host } = hostFalso(async (i) => veredictoDe(i));
    const servicio = startAnalyzeService({ api: f.api, host });

    f.connectFrom(CONTENT_PORT, { tab: { id: 1 } });
    expect(servicio.connectionCount).toBe(1);
    servicio.dispose();
  });

  /**
   * Imagen especular de `startInferenceServer`: aquel rechaza a quien tenga
   * `sender.tab`, este lo exige. Entre los dos no queda un tercer camino hacia
   * el motor de inferencia.
   */
  it('rechaza a quien no venga de una pestaña', async () => {
    const f = fakeChromium();
    const { host } = hostFalso(async (i) => veredictoDe(i));
    const rechazos: string[] = [];
    const servicio = startAnalyzeService({
      api: f.api,
      host,
      onRejected: (r) => rechazos.push(r),
    });

    f.connectFrom(CONTENT_PORT); // sin sender.tab
    expect(rechazos).toEqual(['not-a-tab']);
    expect(servicio.connectionCount).toBe(0);
    servicio.dispose();
  });

  it('ignora puertos de otra funcionalidad', () => {
    const f = fakeChromium();
    const { host } = hostFalso(async (i) => veredictoDe(i));
    const rechazos: string[] = [];
    const servicio = startAnalyzeService({ api: f.api, host, onRejected: (r) => rechazos.push(r) });

    f.connectFrom('otra-cosa', { tab: { id: 1 } });
    expect(rechazos).toEqual(['wrong-port']);
    servicio.dispose();
  });

  it('libera la conexión cuando la pestaña se cierra', () => {
    const f = fakeChromium();
    const { host } = hostFalso(async (i) => veredictoDe(i));
    const servicio = startAnalyzeService({ api: f.api, host });
    f.connectFrom(CONTENT_PORT, { tab: { id: 1 } });
    expect(servicio.connectionCount).toBe(1);

    f.ports[0]?.drop();
    expect(servicio.connectionCount).toBe(0);
    servicio.dispose();
  });
});

describe('startAnalyzeService · análisis', () => {
  it('devuelve el veredicto al content script', async () => {
    const f = fakeChromium();
    const { host } = hostFalso(async (i) => veredictoDe(i));
    const servicio = startAnalyzeService({ api: f.api, host });

    const cliente = clienteDeContenido(f);
    const entrada = await prepareText(TEXTO, 'es');
    const v = await cliente.request('analyze', entrada, isVerdict);

    expect(v.hash).toBe(entrada.hash);
    expect(v.band).toBe(Band.WeakSignal);
    servicio.dispose();
  });

  it('una entrada mal formada se rechaza sin llegar al host', async () => {
    const f = fakeChromium();
    const { host, llamadas } = hostFalso(async (i) => veredictoDe(i));
    const servicio = startAnalyzeService({ api: f.api, host });

    const cliente = clienteDeContenido(f);
    await expect(
      cliente.request('analyze', { hash: 'basura', modality: 'text' }, isVerdict),
    ).rejects.toMatchObject({ code: ErrorCode.BadRequest });
    expect(llamadas).toHaveLength(0);
    servicio.dispose();
  });

  it('cachea por hash: el mismo bloque no se analiza dos veces', async () => {
    const f = fakeChromium();
    const { host, llamadas } = hostFalso(async (i) => veredictoDe(i));
    const servicio = startAnalyzeService({ api: f.api, host });

    const cliente = clienteDeContenido(f);
    const entrada = await prepareText(TEXTO, 'es');
    await cliente.request('analyze', entrada, isVerdict);
    await cliente.request('analyze', entrada, isVerdict);

    expect(llamadas).toHaveLength(1);
    servicio.dispose();
  });

  /**
   * Pies de foto, cabeceras y avisos de cookies se repiten dentro de la misma
   * página y llegan a la vez. Sin colapsar las peticiones en vuelo, cada
   * repetición pagaría su propia inferencia.
   */
  it('colapsa peticiones concurrentes del mismo hash en una sola inferencia', async () => {
    const f = fakeChromium();
    let resolver: ((v: Verdict) => void) | undefined;
    const { host, llamadas } = hostFalso(
      (i) =>
        new Promise<Verdict>((r) => {
          resolver = () => r(veredictoDe(i));
        }),
    );
    const servicio = startAnalyzeService({ api: f.api, host });

    const cliente = clienteDeContenido(f);
    const entrada = await prepareText(TEXTO, 'es');
    const peticiones = [
      cliente.request('analyze', entrada, isVerdict),
      cliente.request('analyze', entrada, isVerdict),
      cliente.request('analyze', entrada, isVerdict),
    ];
    await new Promise((r) => setTimeout(r, 0));
    resolver?.(veredictoDe(entrada));

    const veredictos = await Promise.all(peticiones);
    expect(llamadas).toHaveLength(1);
    expect(veredictos.every((v) => v.hash === entrada.hash)).toBe(true);
    servicio.dispose();
  });

  it('hashes distintos sí producen análisis distintos', async () => {
    const f = fakeChromium();
    const { host, llamadas } = hostFalso(async (i) => veredictoDe(i));
    const servicio = startAnalyzeService({ api: f.api, host });

    const cliente = clienteDeContenido(f);
    await cliente.request('analyze', await prepareText(TEXTO, 'es'), isVerdict);
    await cliente.request('analyze', await prepareText(`${TEXTO} extra`, 'es'), isVerdict);

    expect(llamadas).toHaveLength(2);
    servicio.dispose();
  });

  it('un fallo del host no filtra su mensaje a la página', async () => {
    const f = fakeChromium();
    const host: RuntimeHost = {
      platform: 'chromium',
      ensure: async () => {},
      run: async () => {
        throw new Error('/ruta/interna/modelo.onnx');
      },
      teardown: async () => {},
    };
    const servicio = startAnalyzeService({ api: f.api, host });

    const cliente = clienteDeContenido(f);
    await expect(
      cliente.request('analyze', await prepareText(TEXTO, 'es'), isVerdict),
    ).rejects.toMatchObject({ code: ErrorCode.Internal, message: 'error interno' });
    servicio.dispose();
  });

  it('un fallo no se queda cacheado: el siguiente intento vuelve a probar', async () => {
    const f = fakeChromium();
    let falla = true;
    const llamadas: number[] = [];
    const host: RuntimeHost = {
      platform: 'chromium',
      ensure: async () => {},
      run: async (_c, payload) => {
        llamadas.push(1);
        if (falla) {
          falla = false;
          throw new Error('transitorio');
        }
        return veredictoDe(payload as NormalizedInput) as never;
      },
      teardown: async () => {},
    };
    const servicio = startAnalyzeService({ api: f.api, host });

    const cliente = clienteDeContenido(f);
    const entrada = await prepareText(TEXTO, 'es');
    await expect(cliente.request('analyze', entrada, isVerdict)).rejects.toBeDefined();
    await expect(cliente.request('analyze', entrada, isVerdict)).resolves.toBeDefined();
    expect(llamadas).toHaveLength(2);
    servicio.dispose();
  });
});

describe('LruVerdictCache', () => {
  const v = (hash: string): Verdict => ({
    hash,
    band: Band.InsufficientEvidence,
    llrTotal: 0,
    interval: { lower: 0, upper: 0 },
    evidence: [],
    validations: [],
    elapsedMs: 0,
  });

  it('guarda y devuelve', () => {
    const c = new LruVerdictCache();
    c.set('a', v('a'));
    expect(c.get('a')?.hash).toBe('a');
    expect(c.get('inexistente')).toBeUndefined();
  });

  it('desaloja lo más viejo al pasar del tope', () => {
    const c = new LruVerdictCache(2);
    c.set('a', v('a'));
    c.set('b', v('b'));
    c.set('c', v('c'));
    expect(c.get('a')).toBeUndefined();
    expect(c.get('b')?.hash).toBe('b');
    expect(c.get('c')?.hash).toBe('c');
    expect(c.size).toBe(2);
  });

  it('releer rescata una entrada del desalojo', () => {
    const c = new LruVerdictCache(2);
    c.set('a', v('a'));
    c.set('b', v('b'));
    c.get('a'); // 'a' pasa a ser lo más reciente
    c.set('c', v('c'));
    expect(c.get('a')?.hash).toBe('a');
    expect(c.get('b')).toBeUndefined();
  });
});

describe('extremo a extremo · content script → background → offscreen → kernel', () => {
  /**
   * Las tres superficies reales sobre el mismo doble de navegador. Es el
   * camino completo del producto, sin ningún doble intermedio.
   */
  it('un bloque de texto recorre el sistema entero y vuelve con veredicto', async () => {
    const f = fakeChromium();

    const offscreen = startInferenceServer({
      api: f.api,
      analyze: (i) => createPipeline().analyze(i),
    });
    const background = startAnalyzeService({
      api: f.api,
      host: new ChromiumRuntimeHost({ api: f.api }),
    });

    const cliente = clienteDeContenido(f);
    const entrada = await prepareText(TEXTO, 'es');
    const veredicto = await cliente.request('analyze', entrada, isVerdict);

    expect(veredicto.hash).toBe(entrada.hash);
    // Sin detector de texto todavía, la respuesta correcta es abstenerse.
    expect(veredicto.band).toBe(Band.InsufficientEvidence);
    expect(veredicto.abstentionReason).toBe('NO_EVIDENCE');

    background.dispose();
    offscreen.dispose();
  });

  it('una imagen sin credenciales recorre el mismo camino sin volverse sospechosa', async () => {
    const f = fakeChromium();
    const offscreen = startInferenceServer({
      api: f.api,
      analyze: (i) => createPipeline().analyze(i),
    });
    const background = startAnalyzeService({
      api: f.api,
      host: new ChromiumRuntimeHost({ api: f.api }),
    });

    const cliente = clienteDeContenido(f);
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const { prepareImage } = await import('../src/content/normalize.js');
    const veredicto = await cliente.request('analyze', await prepareImage(png), isVerdict);

    expect(veredicto.llrTotal).toBe(0);
    expect(veredicto.evidence).toHaveLength(1);
    expect(veredicto.evidence[0]?.detectorId).toBe('provenance');

    background.dispose();
    offscreen.dispose();
  });

  it('el content script no puede saltarse el background y hablar con el offscreen', async () => {
    const f = fakeChromium();
    const analyze = vi.fn(async (i: NormalizedInput) => createPipeline().analyze(i));
    const offscreen = startInferenceServer({ api: f.api, analyze });

    // Un content script intenta conectar directamente al puerto de inferencia.
    const puerto = f.connectFrom('xpx-inference', { tab: { id: 9 } });
    expect(offscreen.connectionCount).toBe(0);
    expect(() => puerto.postMessage({ cualquier: 'cosa' })).toThrow(/disconnected/);
    expect(analyze).not.toHaveBeenCalled();

    offscreen.dispose();
  });
});
