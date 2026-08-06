import type {
  ExtensionApi,
  MessageSender,
  OffscreenApi,
  PortLike,
} from '../src/platform/extension-api.js';

/**
 * Doble del navegador para los tests de plataforma.
 *
 * Reproduce los dos comportamientos de Chrome que importan y que una
 * implementación ingenua no anticipa:
 *
 * - `createDocument` falla si ya existe un documento offscreen. Es la fuente de
 *   la carrera de arranque en MV3.
 * - Un puerto encola los mensajes enviados antes de que el receptor haya
 *   registrado su oyente. Sin esta cola, el primer mensaje de cada conexión se
 *   perdería y los tests pasarían o fallarían según el orden de microtareas.
 */

export interface FakePortPair {
  readonly near: PortLike;
  readonly far: PortLike;
  readonly drop: () => void;
}

interface Side {
  listeners: ((m: unknown) => void)[];
  buffer: unknown[];
  disconnects: (() => void)[];
}

export function portPair(name: string, farSender?: MessageSender): FakePortPair {
  const state: Record<'near' | 'far', Side> = {
    near: { listeners: [], buffer: [], disconnects: [] },
    far: { listeners: [], buffer: [], disconnects: [] },
  };
  let alive = true;

  const drop = (): void => {
    if (!alive) return;
    alive = false;
    for (const cb of [...state.near.disconnects, ...state.far.disconnects]) cb();
  };

  const deliver = (to: 'near' | 'far', message: unknown): void => {
    const side = state[to];
    if (side.listeners.length === 0) {
      side.buffer.push(message);
      return;
    }
    for (const l of [...side.listeners]) l(message);
  };

  const make = (self: 'near' | 'far', other: 'near' | 'far'): PortLike => {
    const side = state[self];
    return {
      name,
      ...(self === 'far' && farSender !== undefined ? { sender: farSender } : {}),
      postMessage: (m) => {
        // Chrome lanza al escribir en un puerto muerto. El transporte lo absorbe.
        if (!alive) throw new Error('Attempting to use a disconnected port object');
        // Serialización JSON, síncrona y antes de entregar, porque es lo que
        // hace `chrome.runtime` de verdad. Usar `structuredClone` aquí sería
        // más permisivo que el navegador: preserva `Uint8Array` y `Map`, que
        // JSON destruye, y escondería fallos que solo aparecerían al cargar la
        // extensión en un navegador real. Ya pasó una vez.
        const copia: unknown = JSON.parse(JSON.stringify(m));
        queueMicrotask(() => {
          deliver(other, copia);
        });
      },
      disconnect: drop,
      onMessage: {
        addListener: (cb) => {
          side.listeners.push(cb);
          if (side.buffer.length === 0) return;
          const pendientes = side.buffer;
          side.buffer = [];
          queueMicrotask(() => {
            for (const m of pendientes) cb(m);
          });
        },
        removeListener: (cb) => {
          side.listeners = side.listeners.filter((x) => x !== cb);
        },
      },
      onDisconnect: {
        addListener: (cb) => {
          side.disconnects.push(cb);
        },
        removeListener: (cb) => {
          side.disconnects = side.disconnects.filter((x) => x !== cb);
        },
      },
    };
  };

  return { near: make('near', 'far'), far: make('far', 'near'), drop };
}

export interface FakeChromiumOptions {
  readonly supportsGetContexts?: boolean;
  readonly startsWithDocument?: boolean;
  /** Se invoca con el extremo receptor de cada conexión, antes que `onConnect`. */
  readonly serve?: (port: PortLike) => void;
}

export interface FakeChromium {
  readonly api: ExtensionApi;
  readonly calls: { create: number; close: number; getContexts: number; connect: number };
  readonly ports: FakePortPair[];
  readonly documentExists: boolean;
  /** Conecta simulando un origen concreto; con `sender.tab`, un content script. */
  connectFrom(name: string, sender?: MessageSender): PortLike;
  offscreen(): OffscreenApi;
  replaceCreate(fn: OffscreenApi['createDocument']): void;
}

export function fakeChromium(opts: FakeChromiumOptions = {}): FakeChromium {
  let exists = opts.startsWithDocument ?? false;
  const calls = { create: 0, close: 0, getContexts: 0, connect: 0 };
  const ports: FakePortPair[] = [];
  let connectListeners: ((port: PortLike) => void)[] = [];

  const connectFrom = (name: string, sender?: MessageSender): PortLike => {
    const pair = portPair(name, sender);
    ports.push(pair);
    opts.serve?.(pair.far);
    for (const l of [...connectListeners]) l(pair.far);
    return pair.near;
  };

  const api: ExtensionApi = {
    runtime: {
      getURL: (p) => `chrome-extension://fake/${p}`,
      connect: (info) => {
        calls.connect += 1;
        return connectFrom(info.name);
      },
      onConnect: {
        addListener: (cb) => {
          connectListeners.push(cb);
        },
        removeListener: (cb) => {
          connectListeners = connectListeners.filter((x) => x !== cb);
        },
      },
      ...(opts.supportsGetContexts !== false
        ? {
            getContexts: async () => {
              calls.getContexts += 1;
              return exists ? [{}] : [];
            },
          }
        : {}),
    },
    offscreen: {
      createDocument: async () => {
        calls.create += 1;
        // Un microtick antes de comprobar: así dos llamadas concurrentes se
        // solapan de verdad, como en el navegador.
        await Promise.resolve();
        if (exists) throw new Error('Only a single offscreen document may be created.');
        exists = true;
      },
      closeDocument: async () => {
        calls.close += 1;
        if (!exists) throw new Error('No offscreen document to close.');
        exists = false;
      },
      ...(opts.supportsGetContexts === false ? { hasDocument: async () => exists } : {}),
    },
  };

  const offscreen = (): OffscreenApi => {
    if (api.offscreen === undefined) throw new Error('el doble debe exponer offscreen');
    return api.offscreen;
  };

  return {
    api,
    calls,
    ports,
    connectFrom,
    offscreen,
    replaceCreate: (fn) => {
      (offscreen() as { createDocument: OffscreenApi['createDocument'] }).createDocument = fn;
    },
    get documentExists() {
      return exists;
    },
  };
}

/** Vacía la cola de microtareas, no solo un tick. */
export const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
