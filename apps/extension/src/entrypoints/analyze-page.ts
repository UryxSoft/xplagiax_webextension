import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
import { analyzePage } from '../content/analyze-page.js';

/**
 * Script inyectado bajo demanda, NO declarado en el manifiesto.
 *
 * La diferencia importa: un `content_scripts` con `matches` concede permiso de
 * host en la instalación y muestra el aviso de «leer y cambiar todos tus datos
 * en todos los sitios web». Inyectarlo con `chrome.scripting` tras pulsar el
 * icono usa `activeTab`, que es esta pestaña y esta vez (ADR-009, nivel 1).
 */
export default defineUnlistedScript(() => {
  void analyzePage();
});
