import { RpcServer, IpcError, ErrorCode } from '@xpx/ipc';
import type { NormalizedInput, Verdict } from '@xpx/kernel';
import { fromWire, isWireInput } from '../messaging/wire.js';
import { OFFSCREEN_PORT } from './chromium-host.js';
import type { ExtensionApi, PortLike } from './extension-api.js';
import { portTransport } from './port-transport.js';

/**
 * El otro extremo del puerto: lo que corre DENTRO del documento offscreen.
 *
 * `ChromiumRuntimeHost` abre la conexión desde el service worker; esto la
 * atiende. Sin esta pieza, `run('infer', …)` habla con un puerto que nadie
 * escucha.
 *
 * Aquí se aplica, por primera vez en código, la regla de 03-arquitectura.md
 * §11: **el content script es no privilegiado y no puede pedir inferencia
 * arbitraria**. `runtime.onConnect` no distingue por sí solo quién llama —un
 * content script puede invocar `runtime.connect` igual que el background— así
 * que la separación tiene que imponerse aquí o no existe.
 */

export interface InferenceServerOptions {
  readonly api: ExtensionApi;
  /** Lo que de verdad analiza. Normalmente un `Pipeline` del kernel. */
  readonly analyze: (input: NormalizedInput) => Promise<Verdict>;
  /** Conexiones descartadas. Alimenta el modo desarrollador, no la telemetría. */
  readonly onRejected?: (reason: RejectionReason, port: PortLike) => void;
}

export type RejectionReason = 'wrong-port' | 'untrusted-sender';

export interface InferenceServer {
  /** Conexiones vivas. Expuesto para detectar fugas en los tests. */
  readonly connectionCount: number;
  dispose(): void;
}

export function startInferenceServer(opts: InferenceServerOptions): InferenceServer {
  const servers = new Map<PortLike, RpcServer>();

  const onConnect = (port: PortLike): void => {
    // Otro puerto de la extensión, para otra cosa. No es nuestro.
    if (port.name !== OFFSCREEN_PORT) {
      opts.onRejected?.('wrong-port', port);
      return;
    }

    // `sender.tab` presente significa que quien llama vive dentro de una
    // página. Ese contexto no puede pedir inferencia: solo puede enviar el
    // contenido del documento en el que vive y recibir veredictos para él, y
    // eso ocurre por el canal 'analyze' del background, no por aquí.
    if (port.sender?.tab !== undefined) {
      opts.onRejected?.('untrusted-sender', port);
      port.disconnect();
      return;
    }

    const server = new RpcServer(portTransport(port)).on('infer', isWireInput, (wire) =>
      run(opts.analyze, fromWire(wire)),
    );
    servers.set(port, server);

    port.onDisconnect.addListener(() => {
      servers.get(port)?.dispose();
      servers.delete(port);
    });
  };

  opts.api.runtime.onConnect.addListener(onConnect);

  return {
    get connectionCount() {
      return servers.size;
    },
    dispose() {
      opts.api.runtime.onConnect.removeListener(onConnect);
      for (const [port, server] of servers) {
        server.dispose();
        try {
          port.disconnect();
        } catch {
          // Ya estaba caído.
        }
      }
      servers.clear();
    },
  };
}

/**
 * El veredicto se devuelve tal cual; un fallo del análisis se convierte en un
 * error interno saneado. Que el `hash` de salida coincida con el de entrada se
 * comprueba aquí porque es barato y porque un desajuste corrompería la caché
 * del llamante bajo una clave que no le corresponde.
 */
async function run(
  analyze: (input: NormalizedInput) => Promise<Verdict>,
  input: NormalizedInput,
): Promise<Verdict> {
  const verdict = await analyze(input);
  if (verdict.hash !== input.hash) {
    throw new IpcError(ErrorCode.Internal, 'el veredicto no corresponde a la entrada');
  }
  return verdict;
}
