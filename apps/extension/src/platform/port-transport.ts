import type { Transport } from '@xpx/ipc';
import type { PortLike } from './extension-api.js';

/**
 * Adapta un puerto del navegador al `Transport` de `@xpx/ipc`.
 *
 * Es deliberadamente la única traducción entre ambos mundos: a un lado la API
 * del navegador, al otro un RPC que no sabe qué es una extensión. Todo lo que
 * el protocolo necesita saber del puerto cabe en estas dos operaciones.
 *
 * Sobre los errores de `postMessage`: se absorbe **solo** lo que se reconoce
 * como puerto caído, y todo lo demás se propaga.
 *
 * El orden importa y la primera versión lo tenía al revés —reconocía lo que
 * debía propagar y se tragaba el resto—, con el efecto de que una carga no
 * serializable se convertía en una petición que jamás volvía. Reconocer lo
 * benigno y dejar salir lo desconocido es la única forma de que un fallo nuevo
 * se manifieste como error y no como silencio.
 *
 * Un puerto caído sí puede ignorarse: el cliente RPC tiene su tiempo de espera
 * y su manejador de desconexión, y quien cerró el puerto fue el navegador, no
 * el llamante.
 */
export function portTransport(port: PortLike): Transport {
  return {
    post: (message) => {
      try {
        port.postMessage(message);
      } catch (err) {
        if (!isPortClosed(err)) throw err;
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
 * Los tres textos con los que los navegadores señalan «este puerto ya no
 * existe». No hay código de error para esto: solo el mensaje.
 */
const PUERTO_CAIDO =
  /disconnected port|port (is )?closed|receiving end does not exist|extension context invalidated/i;

function isPortClosed(err: unknown): boolean {
  const mensaje = err instanceof Error ? err.message : String(err);
  return PUERTO_CAIDO.test(mensaje);
}
