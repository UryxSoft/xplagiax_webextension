import { RpcClient } from '@xpx/ipc';
import type { NormalizedInput, Verdict } from '@xpx/kernel';
import { CONTENT_PORT } from '../core/analyze-service.js';
import { isVerdict, toWire } from '../messaging/wire.js';
import { systemExtensionApi } from '../platform/extension-api.js';
import type { PortLike } from '../platform/extension-api.js';
import { portTransport } from '../platform/port-transport.js';
import { renderBadge } from './badge.js';
import { documentLang, extractImages, extractTextBlocks } from './extract.js';
import { prepareImage, prepareText } from './normalize.js';

/**
 * El trabajo completo dentro de la página: extraer, analizar y mostrar.
 *
 * Vive separado del entrypoint para poder probarlo; el entrypoint no es más
 * que la línea que llama aquí.
 *
 * Nada de esto corre solo. La inyección la dispara un gesto del usuario sobre
 * el icono, que es lo que concede `activeTab` (ADR-009, nivel 1). No hay
 * `content_scripts` declarados en el manifiesto a propósito: declararlos
 * dispararía en la instalación el aviso de «leer y cambiar todos tus datos»
 * que toda la arquitectura está construida para evitar.
 */

export interface AnalyzePageOptions {
  readonly doc?: Document;
  readonly connect?: () => PortLike;
  readonly fetchImpl?: typeof fetch;
  /** Techo de bloques por página. Protege el presupuesto, no la corrección. */
  readonly maxBlocks?: number;
  readonly maxImages?: number;
}

const MAX_BLOCKS = 20;
const MAX_IMAGES = 12;

export async function analyzePage(opts: AnalyzePageOptions = {}): Promise<readonly Verdict[]> {
  const doc = opts.doc ?? document;
  const traer = opts.fetchImpl ?? fetch;
  const lang = documentLang(doc);

  const bloques = extractTextBlocks(doc).slice(0, opts.maxBlocks ?? MAX_BLOCKS);
  const imagenes = extractImages(doc).slice(0, opts.maxImages ?? MAX_IMAGES);

  const entradas: NormalizedInput[] = [
    ...(await Promise.all(
      bloques.map((b) =>
        prepareText(b.text, lang, {
          domHints: { isArticle: b.isArticle, isUserGenerated: b.isUserGenerated },
        }),
      ),
    )),
    ...(await imagenesComoEntradas(imagenes, traer)),
  ];

  const puerto = (opts.connect ?? abrirPuerto)();
  const cliente = new RpcClient({ transport: portTransport(puerto) });

  const resultados = await Promise.allSettled(
    entradas.map((e) => cliente.request('analyze', toWire(e), isVerdict)),
  );
  cliente.dispose();
  puerto.disconnect();

  // Un bloque que falla no invalida la página: se muestra lo que sí se pudo
  // analizar. Descartar el resumen entero por una parte sería peor.
  const veredictos = resultados
    .filter((r): r is PromiseFulfilledResult<Verdict> => r.status === 'fulfilled')
    .map((r) => r.value);

  renderBadge(doc, veredictos);
  return veredictos;
}

function abrirPuerto(): PortLike {
  return systemExtensionApi().runtime.connect({ name: CONTENT_PORT });
}

/**
 * Descarga los bytes de cada imagen desde la propia página.
 *
 * Se hace aquí y no en el background porque el content script comparte el
 * origen del documento: una imagen del mismo sitio se obtiene sin permisos
 * adicionales. Las de un CDN sin CORS abierto fallarán, y eso es una
 * limitación conocida del nivel 1 de permisos, no un error a ocultar: la
 * imagen simplemente queda fuera del análisis.
 */
async function imagenesComoEntradas(
  imagenes: readonly { readonly src: string }[],
  traer: typeof fetch,
): Promise<NormalizedInput[]> {
  const salida: NormalizedInput[] = [];
  await Promise.all(
    imagenes.map(async ({ src }) => {
      try {
        const respuesta = await traer(src, { credentials: 'omit' });
        if (!respuesta.ok) return;
        const bytes = new Uint8Array(await respuesta.arrayBuffer());
        salida.push(await prepareImage(bytes));
      } catch {
        // CORS, red o formato: la imagen no se analiza.
      }
    }),
  );
  return salida;
}
