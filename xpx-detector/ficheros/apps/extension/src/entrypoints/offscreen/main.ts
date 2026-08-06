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

const pipeline = createPipeline({
  // WebCrypto para verificar firmas C2PA. Sin él los manifiestos se detectan
  // pero no se verifican, y nunca alcanzan la banda de procedencia confirmada.
  crypto: webCryptoProvider(),

  // Construir el clasificador NO descarga nada: wllama solo trae el modelo
  // cuando alguien llama a `load()`, y eso ocurre en el primer análisis de
  // Tier 2. Aquí solo se deja preparado el cableado.
  textClassifier: createWllamaClassifier(api),
});

startInferenceServer({
  api,
  analyze: (input) => pipeline.analyze(input),
});
