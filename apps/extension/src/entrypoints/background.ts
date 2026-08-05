import { defineBackground } from 'wxt/utils/define-background';
import { startAnalyzeService } from '../core/analyze-service.js';
import { systemExtensionApi } from '../platform/extension-api.js';
import { createRuntimeHost } from '../platform/runtime-host.js';

/**
 * Service worker de MV3.
 *
 * Dueño del `RuntimeHost` y única puerta entre los content scripts y el motor
 * de inferencia. Se limita a cablear, por el mismo motivo que el offscreen:
 * la lógica probable vive en módulos, no aquí.
 *
 * Registrar el servicio en el ámbito superior —y no dentro de `onInstalled`—
 * es deliberado. El service worker se duerme y revive constantemente; los
 * oyentes tienen que quedar registrados en cada arranque o la primera conexión
 * tras despertar se pierde.
 */
export default defineBackground(() => {
  const api = systemExtensionApi();

  startAnalyzeService({
    api,
    host: createRuntimeHost(undefined, api),
  });
});
