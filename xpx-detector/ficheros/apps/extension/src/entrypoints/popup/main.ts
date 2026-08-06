import './style.css';
import { DEEP_FLAG } from '../../shared/deep-flag.js';

/**
 * Popup: el gesto que concede el permiso.
 *
 * Pulsar el icono es lo que activa `activeTab` para la pestaña actual. Sin ese
 * gesto la extensión no puede tocar la página, y por eso los botones no son
 * cosméticos: son el nivel 1 completo de ADR-009.
 *
 * La lógica de análisis vive en el script inyectado. Aquí solo se inyecta y se
 * informa, para que el popup pueda cerrarse sin interrumpir nada.
 */

interface ScriptingApi {
  executeScript(opts: { target: { tabId: number }; files: string[] }): Promise<unknown>;
  executeScript(opts: {
    target: { tabId: number };
    func: (deep: boolean) => void;
    args: [boolean];
  }): Promise<unknown>;
}

interface TabsApi {
  query(q: { active: true; currentWindow: true }): Promise<{ id?: number; url?: string }[]>;
}

const chromeApi = globalThis as unknown as {
  chrome: { scripting: ScriptingApi; tabs: TabsApi };
};

/**
 * Marca donde el popup deja la profundidad para el script inyectado.
 *
 * `executeScript` con `files` no admite argumentos —solo la variante `func` los
 * pasa—, así que se hacen dos inyecciones: una función diminuta que deja el
 * valor, y después el fichero que lo lee. Ambas caen en el **mundo aislado** de
 * la misma pestaña, que es lo que hace que se vean entre sí y que la página no
 * pueda leerlo ni falsearlo.
 *
 * La alternativa evidente era `chrome.storage.session`, y está descartada por
 * una razón concreta: su nivel de acceso por defecto es `TRUSTED_CONTEXTS`, y
 * un content script no lo es. Habría devuelto vacío siempre, en silencio, y el
 * botón no habría funcionado nunca. Abrirlo con `setAccessLevel` lo dejaría
 * legible desde cualquier página, que es peor negocio por un booleano.
 *
 * Además muere con la pestaña: la profundidad vale para este análisis y no se
 * hereda. Un Tier 2 encendido que nadie recuerda es lo que ADR-005 evita.
 */
/**
 * La función inyectada se serializa, así que el literal va escrito a mano. Esta
 * comprobación es lo que impide que los dos lados se desincronicen sin ruido:
 * un botón que no hace nada y ningún error en consola.
 */
if (DEEP_FLAG !== '__xpxDeep') {
  throw new Error(`la marca inyectada no coincide con DEEP_FLAG (${DEEP_FLAG})`);
}

const estado = document.getElementById('estado');
const decir = (texto: string): void => {
  if (estado !== null) estado.textContent = texto;
};

function conectar(id: string, deep: boolean): void {
  const boton = document.getElementById(id);
  boton?.addEventListener('click', () => {
    void analizar(boton, deep);
  });
}

async function analizar(boton: HTMLElement, deep: boolean): Promise<void> {
  const botones = [...document.querySelectorAll('button')];
  for (const b of botones) b.disabled = true;
  decir(
    deep
      ? 'Analizando en profundidad. La primera vez descarga el modelo y puede tardar varios minutos.'
      : 'Analizando…',
  );

  try {
    const [pestana] = await chromeApi.chrome.tabs.query({ active: true, currentWindow: true });
    if (pestana?.id === undefined) {
      decir('No hay una pestaña donde analizar.');
      return;
    }
    // Las páginas internas del navegador no admiten inyección. Decirlo es más
    // útil que dejar que falle con un error del propio Chrome.
    if (pestana.url !== undefined && !/^https?:/.test(pestana.url)) {
      decir('Esta página del navegador no se puede analizar.');
      return;
    }

    // Primero la marca, después el analizador. El orden importa: el fichero la
    // lee nada más arrancar.
    await chromeApi.chrome.scripting.executeScript({
      target: { tabId: pestana.id },
      func: (d: boolean) => {
        (globalThis as unknown as Record<string, unknown>)['__xpxDeep'] = d;
      },
      args: [deep],
    });

    await chromeApi.chrome.scripting.executeScript({
      target: { tabId: pestana.id },
      files: ['analyze-page.js'],
    });
    decir('Listo. El resumen aparece abajo a la derecha de la página.');
  } catch (err) {
    decir(err instanceof Error ? `No se pudo analizar: ${err.message}` : 'No se pudo analizar.');
  } finally {
    for (const b of botones) b.disabled = false;
    void boton;
  }
}

conectar('analizar', false);
conectar('profundo', true);
