import './style.css';

/**
 * Popup: el gesto que concede el permiso.
 *
 * Pulsar el icono es lo que activa `activeTab` para la pestaña actual. Sin ese
 * gesto la extensión no puede tocar la página, y por eso el botón no es
 * cosmético: es el nivel 1 completo de ADR-009.
 *
 * La lógica de análisis vive en el script inyectado. Aquí solo se inyecta y se
 * informa, para que el popup pueda cerrarse sin interrumpir nada.
 */

interface ScriptingApi {
  executeScript(opts: {
    target: { tabId: number };
    files: string[];
  }): Promise<unknown>;
}

interface TabsApi {
  query(q: { active: true; currentWindow: true }): Promise<{ id?: number; url?: string }[]>;
}

const chromeApi = globalThis as unknown as {
  chrome: { scripting: ScriptingApi; tabs: TabsApi };
};

const boton = document.getElementById('analizar');
const estado = document.getElementById('estado');

const decir = (texto: string): void => {
  if (estado !== null) estado.textContent = texto;
};

boton?.addEventListener('click', () => {
  void (async () => {
    if (boton instanceof HTMLButtonElement) boton.disabled = true;
    decir('Analizando…');
    try {
      const [pestana] = await chromeApi.chrome.tabs.query({ active: true, currentWindow: true });
      if (pestana?.id === undefined) {
        decir('No hay una pestaña donde analizar.');
        return;
      }
      // Las páginas internas del navegador no admiten inyección. Decirlo es
      // más útil que dejar que falle con un error del propio Chrome.
      if (pestana.url !== undefined && !/^https?:/.test(pestana.url)) {
        decir('Esta página del navegador no se puede analizar.');
        return;
      }

      await chromeApi.chrome.scripting.executeScript({
        target: { tabId: pestana.id },
        files: ['analyze-page.js'],
      });
      decir('Listo. El resumen aparece abajo a la derecha de la página.');
    } catch (err) {
      decir(err instanceof Error ? `No se pudo analizar: ${err.message}` : 'No se pudo analizar.');
    } finally {
      if (boton instanceof HTMLButtonElement) boton.disabled = false;
    }
  })();
});
