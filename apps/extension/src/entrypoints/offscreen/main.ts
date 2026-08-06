import { createPipeline } from '../../core/composition.js';
import { systemExtensionApi } from '../../platform/extension-api.js';
import { startInferenceServer } from '../../platform/inference-server.js';
import { webCryptoProvider } from '../../platform/webcrypto.js';
import { createWllamaClassifier } from '../../platform/wllama-classifier.js';

/**
 * Punto de entrada del documento offscreen.
 *
 * Todo lo que hace es cablear: la lógica vive en `createPipeline` y en
 * `startInferenceServer`, ambos probados sin navegador. Un entrypoint con
 * lógica propia es lógica que no se puede probar.
 */

const api = systemExtensionApi();

// WebCrypto para verificar firmas C2PA. Sin él los manifiestos se detectan
// pero no se verifican, y nunca alcanzan la banda de procedencia confirmada.
const crypto = webCryptoProvider();

// Construir el clasificador NO descarga nada: wllama solo trae el modelo cuando
// alguien llama a `load()`, y eso ocurre en el primer análisis profundo.
const textClassifier = createWllamaClassifier(api);

/**
 * Dos pipelines, no uno con el tier variable.
 *
 * Comparten registro y política; lo único que cambia es hasta dónde llegan. Que
 * sean objetos distintos hace imposible que un análisis normal acabe en Tier 2
 * por un parámetro mal propagado: el camino rápido no tiene forma de llegar al
 * modelo de 253 MB ni equivocándose.
 */
const superficial = createPipeline({ crypto, textClassifier, maxTier: 1 });

const profundo = createPipeline({
  crypto,
  textClassifier,
  maxTier: 2,
  // Tier 2 cuesta 0,5–2 s por bloque, y la primera vez incluye la descarga del
  // modelo. El presupuesto de 800 ms del camino rápido lo abortaría siempre.
  budgetMs: 120_000,
});

startInferenceServer({
  api,
  analyze: (input, deep) => (deep ? profundo : superficial).analyze(input),
});
