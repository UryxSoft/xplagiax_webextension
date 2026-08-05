import { describe, expect, it, vi } from 'vitest';
import { RpcClient, RpcServer } from '../src/rpc.js';
import type { Transport } from '../src/rpc.js';
import { ErrorCode, IpcError, PROTOCOL_VERSION, isEnvelope } from '../src/protocol.js';
import type { TimerApi } from '../src/env.js';

/** Par de transportes conectados, como dos extremos de un puerto. */
function connectedPair(): { a: Transport; b: Transport } {
  const listeners: { a: ((m: unknown) => void)[]; b: ((m: unknown) => void)[] } = { a: [], b: [] };
  const make = (self: 'a' | 'b', other: 'a' | 'b'): Transport => ({
    post: (m) => {
      // Entrega asíncrona, como un puerto real.
      queueMicrotask(() => {
        for (const l of [...listeners[other]]) l(m);
      });
    },
    subscribe: (l) => {
      listeners[self].push(l);
      return () => {
        listeners[self] = listeners[self].filter((x) => x !== l);
      };
    },
  });
  return { a: make('a', 'b'), b: make('b', 'a') };
}

/** Temporizador manual: el tiempo avanza cuando el test lo dice. */
function manualTimers(): TimerApi & { fire: () => void; readonly count: number } {
  let pending: (() => void)[] = [];
  return {
    setTimeout(fn) {
      pending.push(fn);
      return fn;
    },
    clearTimeout(h) {
      pending = pending.filter((f) => f !== h);
    },
    fire() {
      const now = pending;
      pending = [];
      for (const f of now) f();
    },
    get count() {
      return pending.length;
    },
  };
}

const isNumber = (v: unknown): v is number => typeof v === 'number';
const isString = (v: unknown): v is string => typeof v === 'string';

describe('RPC básico', () => {
  it('entrega petición y respuesta', async () => {
    const { a, b } = connectedPair();
    new RpcServer(b).on('analyze', isNumber, (n) => n * 2);
    const client = new RpcClient({ transport: a });
    await expect(client.request('analyze', 21, isNumber)).resolves.toBe(42);
  });

  it('soporta manejadores asíncronos', async () => {
    const { a, b } = connectedPair();
    new RpcServer(b).on('analyze', isNumber, async (n) => {
      await Promise.resolve();
      return n + 1;
    });
    await expect(new RpcClient({ transport: a }).request('analyze', 1, isNumber)).resolves.toBe(2);
  });

  it('correlaciona peticiones concurrentes por id', async () => {
    const { a, b } = connectedPair();
    new RpcServer(b).on('analyze', isNumber, async (n) => {
      // La primera tarda más: las respuestas llegan en orden inverso.
      await new Promise((r) => setTimeout(r, n === 1 ? 20 : 0));
      return n * 10;
    });
    const client = new RpcClient({ transport: a });
    const [x, y] = await Promise.all([
      client.request('analyze', 1, isNumber),
      client.request('analyze', 2, isNumber),
    ]);
    expect([x, y]).toEqual([10, 20]);
  });

  it('canales distintos no se pisan', async () => {
    const { a, b } = connectedPair();
    new RpcServer(b)
      .on('analyze', isNumber, (n) => n + 1)
      .on('settings', isString, (s) => s.toUpperCase());
    const client = new RpcClient({ transport: a });
    await expect(client.request('analyze', 1, isNumber)).resolves.toBe(2);
    await expect(client.request('settings', 'tema', isString)).resolves.toBe('TEMA');
  });
});

describe('validación', () => {
  it('rechaza una carga con forma inesperada antes de invocar el manejador', async () => {
    const { a, b } = connectedPair();
    const handler = vi.fn(() => 1);
    new RpcServer(b).on('analyze', isNumber, handler);
    await expect(
      new RpcClient({ transport: a }).request('analyze', 'no soy un número', isNumber),
    ).rejects.toMatchObject({ code: ErrorCode.BadRequest });
    expect(handler).not.toHaveBeenCalled();
  });

  it('el cliente también valida la respuesta', async () => {
    const { a, b } = connectedPair();
    new RpcServer(b).on('analyze', isNumber, () => 'texto inesperado');
    await expect(
      new RpcClient({ transport: a }).request('analyze', 1, isNumber),
    ).rejects.toMatchObject({ code: ErrorCode.BadRequest });
  });

  it('ignora mensajes que no son envelopes', () => {
    expect(isEnvelope(null)).toBe(false);
    expect(isEnvelope({ v: 1 })).toBe(false);
    expect(isEnvelope({ v: 1, id: '', channel: 'analyze', kind: 'request', payload: 1 })).toBe(false);
    expect(isEnvelope({ v: 1, id: 'x', channel: 'inventado', kind: 'request', payload: 1 })).toBe(false);
    expect(isEnvelope({ v: 1, id: 'x', channel: 'analyze', kind: 'saludo', payload: 1 })).toBe(false);
    expect(isEnvelope({ v: 1, id: 'x', channel: 'analyze', kind: 'request' })).toBe(false);
    expect(isEnvelope({ v: 1, id: 'x', channel: 'analyze', kind: 'request', payload: 1 })).toBe(true);
  });

  it('un id desmesurado se rechaza', () => {
    expect(
      isEnvelope({ v: 1, id: 'x'.repeat(500), channel: 'analyze', kind: 'request', payload: 1 }),
    ).toBe(false);
  });

  it('rechaza una versión de protocolo distinta', async () => {
    const { a, b } = connectedPair();
    new RpcServer(b).on('analyze', isNumber, () => 1);
    const client = new RpcClient({ transport: a });

    // Se envía a mano un envelope con versión futura.
    const respuesta = new Promise<unknown>((resolve) => {
      a.subscribe((m) => {
        if (isEnvelope(m) && m.kind === 'error') resolve(m.payload);
      });
    });
    a.post({ v: 99, id: 'z', channel: 'analyze', kind: 'request', payload: 1 });

    await expect(respuesta).resolves.toMatchObject({ code: ErrorCode.VersionMismatch });
    client.dispose();
  });

  /** Un mensaje cualquiera de la página no debe provocar respuesta alguna. */
  it('el servidor no contesta a ruido', async () => {
    const { a, b } = connectedPair();
    new RpcServer(b).on('analyze', isNumber, () => 1);
    const visto: unknown[] = [];
    a.subscribe((m) => visto.push(m));
    a.post({ hola: 'soy la página' });
    a.post('texto suelto');
    a.post(null);
    await new Promise((r) => setTimeout(r, 5));
    expect(visto).toHaveLength(0);
  });
});

describe('errores', () => {
  it('un canal sin manejador devuelve Unavailable', async () => {
    const { a, b } = connectedPair();
    new RpcServer(b);
    await expect(
      new RpcClient({ transport: a }).request('analyze', 1, isNumber),
    ).rejects.toMatchObject({ code: ErrorCode.Unavailable });
  });

  /**
   * El content script vive en la página del usuario. Un mensaje de error con
   * la traza interna sería una fuga hacia un contexto no privilegiado.
   */
  it('un fallo interno no filtra el mensaje original', async () => {
    const { a, b } = connectedPair();
    new RpcServer(b).on('analyze', isNumber, () => {
      throw new Error('/home/usuario/secreto.ts:42 falló la conexión a postgres');
    });
    await expect(
      new RpcClient({ transport: a }).request('analyze', 1, isNumber),
    ).rejects.toMatchObject({ code: ErrorCode.Internal, message: 'error interno' });
  });

  it('un rechazo asíncrono se sanea igual que un throw', async () => {
    const { a, b } = connectedPair();
    new RpcServer(b).on('analyze', isNumber, async () => {
      await Promise.resolve();
      throw new Error('ruta/interna/filtrable');
    });
    await expect(
      new RpcClient({ transport: a }).request('analyze', 1, isNumber),
    ).rejects.toMatchObject({ code: ErrorCode.Internal, message: 'error interno' });
  });

  it('un IpcError explícito sí conserva su código y mensaje', async () => {
    const { a, b } = connectedPair();
    new RpcServer(b).on('analyze', isNumber, () => {
      throw new IpcError(ErrorCode.BadRequest, 'texto demasiado corto');
    });
    await expect(
      new RpcClient({ transport: a }).request('analyze', 1, isNumber),
    ).rejects.toMatchObject({ code: ErrorCode.BadRequest, message: 'texto demasiado corto' });
  });
});

describe('tiempo y cancelación', () => {
  it('agota el tiempo si no hay respuesta', async () => {
    const timers = manualTimers();
    const { a } = connectedPair(); // sin servidor al otro lado
    const client = new RpcClient({ transport: a, timers });
    const p = client.request('analyze', 1, isNumber);
    timers.fire();
    await expect(p).rejects.toMatchObject({ code: ErrorCode.Timeout });
    expect(client.pendingCount).toBe(0);
  });

  it('una respuesta correcta cancela el temporizador: no quedan fugas', async () => {
    const timers = manualTimers();
    const { a, b } = connectedPair();
    new RpcServer(b).on('analyze', isNumber, (n) => n);
    const client = new RpcClient({ transport: a, timers });
    await client.request('analyze', 7, isNumber);
    expect(timers.count).toBe(0);
    expect(client.pendingCount).toBe(0);
  });

  it('rechaza de inmediato si la señal ya venía cancelada', async () => {
    const { a } = connectedPair();
    const client = new RpcClient({ transport: a });
    await expect(client.request('analyze', 1, isNumber, { aborted: true })).rejects.toMatchObject({
      code: ErrorCode.Aborted,
    });
    expect(client.pendingCount).toBe(0);
  });

  it('cancela una petición en vuelo', async () => {
    const { a } = connectedPair();
    const client = new RpcClient({ transport: a, timers: manualTimers() });
    const ctrl = new AbortController();
    const p = client.request('analyze', 1, isNumber, ctrl.signal);
    ctrl.abort();
    await expect(p).rejects.toMatchObject({ code: ErrorCode.Aborted });
    expect(client.pendingCount).toBe(0);
  });

  it('una respuesta tardía tras cancelar no revive la promesa', async () => {
    const { a, b } = connectedPair();
    let responder: ((v: number) => void) | undefined;
    new RpcServer(b).on('analyze', isNumber, () => new Promise<number>((r) => (responder = r)));
    const client = new RpcClient({ transport: a, timers: manualTimers() });
    const ctrl = new AbortController();
    const p = client.request('analyze', 1, isNumber, ctrl.signal);
    await Promise.resolve();
    ctrl.abort();
    await expect(p).rejects.toMatchObject({ code: ErrorCode.Aborted });
    responder?.(99);
    await new Promise((r) => setTimeout(r, 5));
    expect(client.pendingCount).toBe(0);
  });

  it('dispose rechaza todo lo pendiente y deja de escuchar', async () => {
    const { a } = connectedPair();
    const client = new RpcClient({ transport: a, timers: manualTimers() });
    const p = client.request('analyze', 1, isNumber);
    client.dispose();
    await expect(p).rejects.toMatchObject({ code: ErrorCode.Unavailable });
    expect(client.pendingCount).toBe(0);
  });

  it('pedir sobre un cliente cerrado falla en vez de colgarse', async () => {
    const { a, b } = connectedPair();
    new RpcServer(b).on('analyze', isNumber, (n) => n);
    const client = new RpcClient({ transport: a });
    client.dispose();
    await expect(client.request('analyze', 1, isNumber)).rejects.toMatchObject({
      code: ErrorCode.Unavailable,
    });
  });

  it('una respuesta huérfana o duplicada no rompe nada', async () => {
    const { a, b } = connectedPair();
    new RpcServer(b).on('analyze', isString, (s) => s);
    const client = new RpcClient({ transport: a });
    b.post({
      v: PROTOCOL_VERSION,
      id: 'inexistente',
      channel: 'analyze',
      kind: 'response',
      payload: 1,
    });
    await expect(client.request('analyze', 'ok', isString)).resolves.toBe('ok');
  });
});
