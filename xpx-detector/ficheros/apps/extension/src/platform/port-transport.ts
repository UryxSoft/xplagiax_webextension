import type { Transport } from '@xpx/ipc';
import type { PortLike } from './extension-api.js';

/**
 * Adapta un puerto del navegador al `Transport` de `@xpx/ipc`.
 *
 * Es deliberadamente la única traducción entre ambos mundos: a un lado la API
 * del navegador, al otro un RPC que no sabe qué es una extensión. Todo lo que
 * el protocolo necesita saber del puerto cabe en estas dos operaciones.
 */
export function portTransport(port: PortLike): Transport {
  return {
    post: (message) => {
      try {
        port.postMessage(message);
      } catch (err) {
        // Un puerto caído sí se traga: el cliente RPC ya tiene tiempo de espera
        // y manejador de desconexión, y quien lo cerró fue el navegador, no
        // quien llama. No es un fallo del que informar hacia arriba.
        if (isDisconnectedPort(err)) return;

        // Todo lo demás se propaga. Lo habitual aquí es una carga que no se
        // puede serializar —una referencia circular, una función—, y eso es un
        // error de programación: tragárselo convierte un fallo inmediato y
        // legible en una petición que se cuelga hasta agotar el tiempo, que es
        // la forma más cara de depurar el mismo problema.
        throw err;
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

/**
 * Chrome no expone un código para esto, solo el mensaje, y el texto varía según
 * cómo muriera el puerto: cerrado por el otro extremo, extensión recargada, o
 * service worker dormido a mitad de envío.
 */
function isDisconnectedPort(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /disconnected port|message port closed|context invalidated|receiving end does not exist/i.test(
    message,
  );
}
