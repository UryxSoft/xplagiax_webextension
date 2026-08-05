import { describe, expect, it, vi } from 'vitest';
import { RpcServer, ErrorCode } from '@xpx/ipc';
import {
  ChromiumRuntimeHost,
  OFFSCREEN_PATH,
  OFFSCREEN_PORT,
} from '../src/platform/chromium-host.js';
import { portTransport } from '../src/platform/port-transport.js';
import type { ExtensionApi, PortLike } from '../src/platform/extension-api.js';
import { createRuntimeHost, detectPlatform } from '../src/platform/runtime-host.js';
import { fakeChromium, flush } from './fake-browser.js';
import type { FakeChromiumOptions } from './fake-browser.js';

interface InferReq {
  readonly texto: string;
}
const isInferReq = (v: unknown): v is InferReq =>
  typeof v === 'object' && v !== null && typeof (v as InferReq).texto === 'string';

interface InferRes {
  readonly eco: string;
  readonly puerto: string;
}
const isInferRes = (v: unknown): v is InferRes =>
  typeof v === 'object' && v !== null && typeof (v as InferRes).eco === 'string';

/** Al otro lado del puerto, un servidor que devuelve lo que recibe. */
function eco(port: PortLike): void {
  new RpcServer(portTransport(port)).on('infer', isInferReq, (p) => ({
    eco: p.texto,
    puerto: port.name,
  }));
}

const conEco = (opts: FakeChromiumOptions = {}) => fakeChromium({ serve: eco, ...opts });

describe('ChromiumRuntimeHost · ciclo de vida del documento offscreen', () => {
  it('crea el documento en la primera llamada', async () => {
    const f = conEco();
    const host = new ChromiumRuntimeHost({ api: f.api });
    await host.ensure();
    expect(f.calls.create).toBe(1);
    expect(f.documentExists).toBe(true);
    expect(host.isReady).toBe(true);
  });

  it('no vuelve a crearlo si ya está listo', async () => {
    const f = conEco();
    const host = new ChromiumRuntimeHost({ api: f.api });
    await host.ensure();
    await host.ensure();
    await host.ensure();
    expect(f.calls.create).toBe(1);
  });

  it('reutiliza un documento que ya existía al arrancar', async () => {
    const f = conEco({ startsWithDocument: true });
    const host = new ChromiumRuntimeHost({ api: f.api });
    await host.ensure();
    expect(f.calls.create).toBe(0);
    expect(host.isReady).toBe(true);
  });

  /**
   * El caso que rompe una implementación ingenua. El service worker de MV3 se
   * duerme y revive; al despertar, varias peticiones pueden pedir el host a la
   * vez y provocar dos `createDocument` concurrentes.
   */
  it('llamadas concurrentes comparten un solo arranque', async () => {
    const f = conEco();
    const host = new ChromiumRuntimeHost({ api: f.api });
    await Promise.all([host.ensure(), host.ensure(), host.ensure(), host.ensure()]);
    expect(f.calls.create).toBe(1);
  });

  it('si otra invocación gana la carrera, el "ya existe" se trata como éxito', async () => {
    const f = conEco();
    const host = new ChromiumRuntimeHost({ api: f.api });
    // Alguien externo crea el documento entre la comprobación y la creación.
    await f.offscreen().createDocument({ url: 'x', reasons: [], justification: '' });

    await expect(host.ensure()).resolves.toBeUndefined();
    expect(host.isReady).toBe(true);
  });

  it('un error real de creación sí se propaga', async () => {
    const f = conEco();
    f.replaceCreate(async () => {
      throw new Error('cuota de almacenamiento agotada');
    });
    const host = new ChromiumRuntimeHost({ api: f.api });
    await expect(host.ensure()).rejects.toThrow(/cuota/);
    expect(host.isReady).toBe(false);
  });

  it('tras un fallo, un intento posterior vuelve a probar', async () => {
    const f = conEco();
    const crear = f.offscreen().createDocument.bind(f.offscreen());
    let falla = true;
    f.replaceCreate(async (o) => {
      if (falla) {
        falla = false;
        throw new Error('fallo transitorio');
      }
      return crear(o);
    });
    const host = new ChromiumRuntimeHost({ api: f.api });
    await expect(host.ensure()).rejects.toThrow(/transitorio/);
    await expect(host.ensure()).resolves.toBeUndefined();
    expect(host.isReady).toBe(true);
  });

  it('usa el URL de la extensión, no una ruta relativa', async () => {
    const f = conEco();
    const spy = vi.spyOn(f.offscreen(), 'createDocument');
    await new ChromiumRuntimeHost({ api: f.api }).ensure();
    expect(spy.mock.calls[0]?.[0]?.url).toBe(`chrome-extension://fake/${OFFSCREEN_PATH}`);
  });

  it('cae a hasDocument cuando el navegador no tiene getContexts', async () => {
    const f = conEco({ supportsGetContexts: false, startsWithDocument: true });
    const host = new ChromiumRuntimeHost({ api: f.api });
    await host.ensure();
    expect(f.calls.create).toBe(0);
    expect(host.isReady).toBe(true);
  });

  it('falla con claridad si la plataforma no tiene offscreen', async () => {
    const f = conEco();
    const sinOffscreen: ExtensionApi = { runtime: f.api.runtime };
    await expect(new ChromiumRuntimeHost({ api: sinOffscreen }).ensure()).rejects.toThrow(
      /offscreen no disponible/,
    );
  });

  it('teardown cierra el documento y permite volver a arrancar', async () => {
    const f = conEco();
    const host = new ChromiumRuntimeHost({ api: f.api });
    await host.ensure();
    await host.teardown();
    expect(f.documentExists).toBe(false);
    expect(host.isReady).toBe(false);
    await host.ensure();
    expect(f.calls.create).toBe(2);
  });

  it('teardown sin documento no lanza', async () => {
    const f = conEco();
    await expect(new ChromiumRuntimeHost({ api: f.api }).teardown()).resolves.toBeUndefined();
    expect(f.calls.close).toBe(0);
  });
});

describe('ChromiumRuntimeHost · trabajo sobre el puerto', () => {
  it('run garantiza el host antes de enviar y devuelve el resultado', async () => {
    const f = conEco();
    const host = new ChromiumRuntimeHost({ api: f.api });
    const res = await host.run('infer', { texto: 'hola' }, isInferRes);
    expect(f.calls.create).toBe(1);
    expect(res).toEqual({ eco: 'hola', puerto: OFFSCREEN_PORT });
  });

  it('reutiliza el mismo puerto entre llamadas', async () => {
    const f = conEco();
    const host = new ChromiumRuntimeHost({ api: f.api });
    await host.run('infer', { texto: 'a' }, isInferRes);
    await host.run('infer', { texto: 'b' }, isInferRes);
    expect(f.calls.connect).toBe(1);
  });

  it('valida lo que vuelve del otro lado de la frontera', async () => {
    const f = conEco();
    const host = new ChromiumRuntimeHost({ api: f.api });
    const esperaOtraCosa = (v: unknown): v is { total: number } =>
      typeof v === 'object' && v !== null && typeof (v as { total: unknown }).total === 'number';
    await expect(host.run('infer', { texto: 'hola' }, esperaOtraCosa)).rejects.toMatchObject({
      code: ErrorCode.BadRequest,
    });
  });

  it('una carga que el host offscreen no acepta se rechaza allí, no aquí', async () => {
    const f = conEco();
    const host = new ChromiumRuntimeHost({ api: f.api });
    await expect(host.run('infer', { texto: 42 }, isInferRes)).rejects.toMatchObject({
      code: ErrorCode.BadRequest,
    });
  });

  it('un canal que el host no atiende devuelve Unavailable', async () => {
    const f = conEco();
    const host = new ChromiumRuntimeHost({ api: f.api });
    await expect(host.run('analyze', { texto: 'hola' }, isInferRes)).rejects.toMatchObject({
      code: ErrorCode.Unavailable,
    });
  });

  /**
   * El navegador puede reclamar el documento offscreen en cualquier momento.
   * Escribir sobre el puerto muerto sería el fallo silencioso más caro posible:
   * peticiones que nunca vuelven.
   */
  it('si el puerto cae, el host se marca no listo y la siguiente llamada reconecta', async () => {
    const f = conEco();
    const host = new ChromiumRuntimeHost({ api: f.api });
    await host.run('infer', { texto: 'a' }, isInferRes);
    expect(host.isReady).toBe(true);

    f.ports[0]?.drop();
    expect(host.isReady).toBe(false);

    const res = await host.run('infer', { texto: 'b' }, isInferRes);
    expect(res.eco).toBe('b');
    expect(f.calls.connect).toBe(2);
  });

  it('una petición en vuelo cuando cae el puerto se rechaza en vez de colgarse', async () => {
    // El host offscreen deja de contestar: la respuesta nunca llegaría.
    const f = fakeChromium({
      serve: (port) => {
        new RpcServer(portTransport(port)).on('infer', isInferReq, () => new Promise(() => {}));
      },
    });

    const host = new ChromiumRuntimeHost({ api: f.api });
    const p = host.run('infer', { texto: 'a' }, isInferRes);
    await flush();
    // Si esto falla, el drop llegaría antes de conectar y el test expiraría sin
    // decir por qué. Mejor romper aquí.
    expect(f.ports).toHaveLength(1);
    f.ports[0]?.drop();
    await expect(p).rejects.toMatchObject({ code: ErrorCode.Unavailable });
  });

  it('teardown desconecta el puerto además de cerrar el documento', async () => {
    const f = conEco();
    const host = new ChromiumRuntimeHost({ api: f.api });
    await host.run('infer', { texto: 'a' }, isInferRes);
    await host.teardown();
    expect(f.documentExists).toBe(false);

    await host.run('infer', { texto: 'b' }, isInferRes);
    expect(f.calls.connect).toBe(2);
    expect(f.calls.create).toBe(2);
  });
});

describe('selección de plataforma', () => {
  it('reconoce Firefox', () => {
    expect(detectPlatform('Mozilla/5.0 (X11; Linux) Gecko/20100101 Firefox/130.0')).toBe('firefox');
  });

  it('reconoce Safari y no lo confunde con Chrome', () => {
    expect(detectPlatform('Mozilla/5.0 (Macintosh) Version/17.0 Safari/605.1.15')).toBe('safari');
    expect(detectPlatform('Mozilla/5.0 (Macintosh) Chrome/120.0.0.0 Safari/537.36')).toBe(
      'chromium',
    );
  });

  it('Edge y Opera comparten camino con Chromium', () => {
    expect(detectPlatform('Mozilla/5.0 Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0')).toBe(
      'chromium',
    );
    expect(detectPlatform('Mozilla/5.0 Chrome/120.0.0.0 Safari/537.36 OPR/106.0.0.0')).toBe(
      'chromium',
    );
  });

  it('sin user-agent asume Chromium en lugar de fallar', () => {
    expect(detectPlatform('')).toBe('chromium');
  });

  it('devuelve el host correspondiente a cada plataforma', () => {
    expect(createRuntimeHost('firefox').platform).toBe('firefox');
    expect(createRuntimeHost('safari').platform).toBe('safari');
    expect(createRuntimeHost('chromium', fakeChromium().api).platform).toBe('chromium');
  });
});
