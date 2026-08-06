import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
import { analyzePage } from '../content/analyze-page.js';
import { readDeepFlag } from '../shared/deep-flag.js';

/**
 * Script inyectado bajo demanda, NO declarado en el manifiesto.
 *
 * La diferencia importa: un `content_scripts` con `matches` concede permiso de
 * host en la instalación y muestra el aviso de «leer y cambiar todos tus datos
 * en todos los sitios web». Inyectarlo con `chrome.scripting` tras pulsar el
 * icono usa `activeTab`, que es esta pestaña y esta vez (ADR-009, nivel 1).
 *
 * La profundidad llega en una marca del mundo aislado que el popup deja justo
 * antes. Si no está —porque se inyectó por otra vía—, se analiza en superficie:
 * equivocarse hacia el lado que no descarga 253 MB es recuperable, hacia el
 * otro no.
 */
export default defineUnlistedScript(() => {
  void analyzePage({ deep: readDeepFlag() });
});
