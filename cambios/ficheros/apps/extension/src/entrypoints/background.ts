import { defineBackground } from 'wxt/utils/define-background';
import { CONTENT_PORT, createBackgroundService } from '../background/service.js';
import { createRuntimeHost } from '../platform/runtime-host.js';
import { portTransport } from '../platform/port-transport.js';
import type { PortLike } from '../platform/extension-api.js';

/**
 * Service worker. Orquesta; no infiere.
 *
 * MV3 lo duerme sin avisar, así que nada aquí asume continuidad: el
 * `RuntimeHost` sabe recrear el documento offscreen cuando haga falta y la
 * caché se reconstruye sola. Lo único que no sobrevive a una siesta es lo que
 * no importa.
 *
 * Deliberadamente delgado: traduce puertos del navegador a transportes y
 * responde al gesto del usuario. La lógica vive en `background/`, donde se
 * puede probar sin navegador.
 */

/** El analizador que se inyecta en la pestaña. Ver ADR-009. */
const ANALYZER_FILE = 'analyzer.js';

interface ActionApi {
  onClicked: { addListener(cb: (tab: { id?: number }) => void): void };
}

interface ScriptingApi {
  executeScript(injection: {
    target: { tabId: number };
    files: readonly string[];
  }): Promise<unknown>;
}

interface RuntimeApi {
  onConnect: { addListener(cb: (port: PortLike & { name: string }) => void): void };
}

export default defineBackground(() => {
  const service = createBackgroundService(createRuntimeHost());
  const api = (
    globalThis as unknown as {
      chrome: { runtime: RuntimeApi; action: ActionApi; scripting: ScriptingApi };
    }
  ).chrome;

  api.runtime.onConnect.addListener((port) => {
    if (port.name !== CONTENT_PORT) return;
    service.serve(portTransport(port));
  });

  /**
   * Nivel 1 de ADR-009: pulsar el icono concede `activeTab` sobre esta pestaña
   * y solo esta vez. Es el estado inicial y un producto completo por sí mismo;
   * el análisis automático llega cuando el usuario autoriza un dominio.
   */
  api.action.onClicked.addListener((tab) => {
    const tabId = tab.id;
    if (tabId === undefined) return;
    void api.scripting
      .executeScript({ target: { tabId }, files: [ANALYZER_FILE] })
      .catch(() => {
        // Páginas internas del navegador y la Chrome Web Store rechazan la
        // inyección. No es un fallo del que haya que informar al usuario.
      });
  });
});
