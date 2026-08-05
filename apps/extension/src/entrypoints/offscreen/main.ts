import { createPipeline } from '../../core/composition.js';
import { systemExtensionApi } from '../../platform/extension-api.js';
import { startInferenceServer } from '../../platform/inference-server.js';
import { webCryptoProvider } from '../../platform/webcrypto.js';

/**
 * Punto de entrada del documento offscreen.
 *
 * Todo lo que hace es cablear: la lógica vive en `createPipeline` y en
 * `startInferenceServer`, ambos probados sin navegador. Un entrypoint con
 * lógica propia es lógica que no se puede probar.
 */

const pipeline = createPipeline({
  // WebCrypto para verificar firmas C2PA. Sin él los manifiestos se detectan
  // pero no se verifican, y nunca alcanzan la banda de procedencia confirmada.
  crypto: webCryptoProvider(),
});

startInferenceServer({
  api: systemExtensionApi(),
  analyze: (input) => pipeline.analyze(input),
});
