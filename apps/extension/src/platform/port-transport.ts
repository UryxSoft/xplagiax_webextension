import type { Transport } from '@xpx/ipc';
import type { PortLike } from './extension-api.js';

/**
 * Adapta un puerto del navegador al `Transport` de `@xpx/ipc`.
 *
 * Es deliberadamente la única traducción entre ambos mundos: a un lado la API
 * del navegador, al otro un RPC que no sabe qué es una extensión. Todo lo que
 * el protocolo necesita saber del puerto cabe en estas dos operaciones.
 *
 * `postMessage` sobre un puerto ya desconectado lanza en Chrome. Se traga aquí
 * porque el cliente RPC ya tiene su propio mecanismo para peticiones sin
 * respuesta —el tiempo de espera— y porque quien cierra el puerto es el
 * navegador, no el llamante: no es un fallo del que informar hacia arriba.
 */
export function portTransport(port: PortLike): Transport {
  return {
    post: (message) => {
      try {
        port.postMessage(message);
      } catch {
        // Puerto caído. El cliente lo resolverá por tiempo de espera o por el
        // manejador de desconexión, que es quien tiene el contexto para actuar.
      }
    },
    subscribe: (listener) => {
      const onMessage = (message: unknown): void => {
        listener(message);
      };
      port.onMessage.addListener(onMessage);
      return () => {
        port.onMessage.removeListener(onMessage);
      };
    },
  };
}
