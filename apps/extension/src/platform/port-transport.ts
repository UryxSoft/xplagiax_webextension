import type { Transport } from '@xpx/ipc';
import type { PortLike } from './extension-api.js';

/**
 * Adapta un puerto del navegador al `Transport` de `@xpx/ipc`.
 *
 * Es deliberadamente la única traducción entre ambos mundos: a un lado la API
 * del navegador, al otro un RPC que no sabe qué es una extensión. Todo lo que
 * el protocolo necesita saber del puerto cabe en estas dos operaciones.
 *
 * `postMessage` sobre un puerto ya desconectado lanza en Chrome. Ese caso se
 * absorbe: el cliente RPC ya tiene su propio mecanismo para peticiones sin
 * respuesta —el tiempo de espera— y quien cierra el puerto es el navegador, no
 * el llamante.
 *
 * Un fallo de clonado, en cambio, sí se propaga. Significa que la carga lleva
 * algo que no cruza la frontera (una función, una instancia de clase), y eso es
 * un error de programación que un `catch` amplio convertiría en una petición
 * que jamás vuelve.
 */
export function portTransport(port: PortLike): Transport {
  return {
    post: (message) => {
      try {
        port.postMessage(message);
      } catch (err) {
        if (isDataCloneError(err)) throw err;
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

/** Chrome lo señala con `DOMException.name`; Node solo con el mensaje. */
function isDataCloneError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return err.name === 'DataCloneError' || /could not be cloned/i.test(err.message);
}
