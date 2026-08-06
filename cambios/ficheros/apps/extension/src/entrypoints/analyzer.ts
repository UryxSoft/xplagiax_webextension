import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
import { Scanner } from '../content/scanner.js';
import { CONTENT_PORT } from '../background/service.js';
import { portTransport } from '../platform/port-transport.js';
import type { PortLike } from '../platform/extension-api.js';

/**
 * El analizador que corre dentro de la página del usuario.
 *
 * **No es un content script declarado en el manifiesto**, y esa es la decisión
 * de diseño más importante de este fichero. Declararlo con `matches:
 * ['<all_urls>']` sería más simple y funcionaría desde el primer segundo, pero
 * produciría el aviso *"Leer y cambiar todos tus datos en todos los sitios
 * web"* en la instalación de un producto cuyo argumento central es la
 * privacidad (ADR-009).
 *
 * En su lugar se inyecta con `scripting.executeScript` cuando el usuario pulsa
 * el icono, bajo `activeTab`: esta pestaña, esta vez. El análisis automático
 * llega después, cuando el usuario concede el permiso para un dominio o para
 * toda la web, y ya sabe para qué sirve.
 *
 * Contexto no privilegiado: extrae contenido normalizado del documento en el
 * que vive, pide veredictos y los pinta en una capa aislada. No infiere, no
 * persiste y no puede preguntar por otra página.
 */
export default defineUnlistedScript(() => {
  // Inyectar dos veces la misma pestaña duplicaría marcas y puertos.
  const marker = '__xpxAnalyzerActive';
  const w = globalThis as unknown as Record<string, unknown>;
  if (w[marker] === true) return;
  w[marker] = true;

  const runtime = (
    globalThis as unknown as { chrome: { runtime: { connect(i: { name: string }): PortLike } } }
  ).chrome.runtime;

  const port = runtime.connect({ name: CONTENT_PORT });
  const scanner = new Scanner({ transport: portTransport(port), subtle: crypto.subtle });

  // Un fallo de análisis nunca puede romper la navegación del usuario.
  const scan = (): void => {
    void scanner.scan().catch(() => {});
  };

  const onViewportChange = debounce(() => {
    scanner.reposition();
    scan();
  }, 250);

  scan();
  window.addEventListener('scroll', onViewportChange, { passive: true });
  window.addEventListener('resize', onViewportChange, { passive: true });

  port.onDisconnect.addListener(() => {
    window.removeEventListener('scroll', onViewportChange);
    window.removeEventListener('resize', onViewportChange);
    scanner.dispose();
    w[marker] = false;
  });
});

/** Agrupa ráfagas de scroll en una sola pasada. */
function debounce(fn: () => void, ms: number): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(fn, ms);
  };
}
