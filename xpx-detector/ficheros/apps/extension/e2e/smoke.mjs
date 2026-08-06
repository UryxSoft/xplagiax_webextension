/**
 * Prueba de humo sobre un Chromium real, con la extensión cargada.
 *
 * Existe por una razón concreta: los tests unitarios usan un doble de puerto, y
 * un doble siempre es una hipótesis sobre el navegador. La primera versión del
 * doble serializaba con `structuredClone` y daba por buenas cargas con
 * `Uint8Array`, que `chrome.runtime` destruye porque serializa como JSON. El
 * fallo solo apareció aquí, y rompía justo la única modalidad que hoy produce
 * evidencia real.
 *
 * Requisitos: `pnpm build:chrome` y Playwright disponible.
 *   node e2e/smoke.mjs
 */
import { chromium } from 'playwright';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const EXT = resolve(AQUI, '../../../chrome_extension');

const comprobaciones = [];
const comprobar = (nombre, ok, detalle = '') => {
  comprobaciones.push({ nombre, ok, detalle });
  console.log(`${ok ? '✓' : '✗'} ${nombre}${detalle ? ` — ${detalle}` : ''}`);
};

const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'xpx-e2e-')), {
  headless: true,
  ...(process.env['CHROMIUM_PATH'] ? { executablePath: process.env['CHROMIUM_PATH'] } : {}),
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});

try {
  const sw =
    ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker', { timeout: 20_000 }));
  comprobar('el service worker se registra', Boolean(sw), sw?.url());

  const resultado = await sw.evaluate(async () => {
    const manifest = chrome.runtime.getManifest();

    await chrome.offscreen.createDocument({
      url: chrome.runtime.getURL('offscreen.html'),
      reasons: ['WORKERS'],
      justification: 'prueba de humo',
    });
    const contextos = (await chrome.runtime.getContexts({})).map((c) => c.contextType);

    const hashDe = async (bytes) => {
      const d = await crypto.subtle.digest('SHA-256', bytes);
      return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
    };
    const pedir = (payload, id) =>
      new Promise((res, rej) => {
        const port = chrome.runtime.connect({ name: 'xpx-inference' });
        const t = setTimeout(() => rej(new Error('sin respuesta en 10 s')), 10_000);
        port.onMessage.addListener((m) => {
          clearTimeout(t);
          res(m);
        });
        port.postMessage({ v: 1, id, channel: 'infer', kind: 'request', payload });
      });

    const texto = 'palabra '.repeat(300).trim();
    const hashTexto = await hashDe(new TextEncoder().encode(texto));
    const resTexto = await pedir(
      { hash: hashTexto, modality: 'text', text: texto, lang: 'es', tokenCount: 300 },
      'e2e-texto',
    );

    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
    const resImagen = await pedir(
      {
        hash: await hashDe(png),
        modality: 'image',
        rawBytesB64: btoa(String.fromCharCode(...png)),
        lang: 'und',
        tokenCount: 0,
      },
      'e2e-imagen',
    );

    // El WebAssembly de wllama, que es lo que hace posible Tier 2. Se compila
    // de verdad: es la única forma de saber que viaja en el artefacto, que se
    // sirve, y que la CSP de la extensión lo acepta. Ninguna de las tres cosas
    // se puede comprobar sin un navegador.
    let wasm;
    try {
      const res = await fetch(chrome.runtime.getURL('wllama/wllama.wasm'));
      if (!res.ok) {
        wasm = `HTTP ${res.status}`;
      } else {
        const bytes = await res.arrayBuffer();
        await WebAssembly.compile(bytes);
        wasm = `compilado, ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB`;
      }
    } catch (e) {
      wasm = `error: ${e.message}`;
    }

    return { manifest, contextos, hashTexto, resTexto, resImagen, wasm };
  });

  const { manifest, contextos, hashTexto, resTexto, resImagen, wasm } = resultado;

  comprobar('el manifiesto es MV3', manifest.manifest_version === 3);
  // Si `_locales` faltara, el navegador ni habría cargado la extensión; que el
  // nombre esté resuelto y no como `__MSG_extName__` lo confirma.
  comprobar('los textos se resuelven desde _locales', manifest.name === 'XplagiaX', manifest.name);
  comprobar('sin host_permissions en la instalación', (manifest.host_permissions ?? []).length === 0);
  comprobar('el documento offscreen arranca', contextos.includes('OFFSCREEN_DOCUMENT'));

  comprobar(
    'el texto recorre service worker → offscreen → kernel',
    resTexto.kind === 'response' && resTexto.payload?.hash === hashTexto,
    resTexto.payload?.band,
  );
  // El detector de texto existe y está registrado, pero es Tier 2 y el análisis
  // por defecto llega hasta Tier 1: ni se planifica, así que no hay evidencia y
  // el kernel se abstiene. Es la garantía de ADR-005 comprobada en el navegador
  // de verdad — si esto dejara de cumplirse, cada bloque de cada página
  // dispararía la descarga de 253 MB.
  comprobar(
    'Tier 2 no corre solo: sin análisis profundo el kernel se abstiene',
    resTexto.payload?.abstentionReason === 'NO_EVIDENCE',
  );

  comprobar('el WebAssembly de wllama viaja y compila bajo la CSP', wasm.startsWith('compilado'), wasm);

  const evidencia = resImagen.payload?.evidence?.[0];
  comprobar(
    'los bytes crudos sobreviven al puerto (regresión base64)',
    resImagen.kind === 'response' && evidencia?.detectorId === 'provenance',
    resImagen.kind === 'error' ? JSON.stringify(resImagen.payload) : 'detector de procedencia',
  );
  comprobar(
    'una imagen sin credenciales no se vuelve sospechosa',
    evidencia?.llr === 0 && evidencia?.reliability === 0,
  );

  // --- Superficie de usuario -----------------------------------------------
  comprobar(
    'hay un icono que pulsar, con su popup',
    manifest.action?.default_popup === 'popup.html',
    manifest.action?.default_popup,
  );
  comprobar(
    'no se declara ningún content_script',
    manifest.content_scripts === undefined,
    'inyección bajo demanda, sin permiso de host en la instalación',
  );

  const extId = new URL(sw.url()).host;
  const popup = await ctx.newPage();
  await popup.goto(`chrome-extension://${extId}/popup.html`);
  const boton = await popup.textContent('#analizar');
  comprobar('el popup se abre y ofrece la acción', boton?.includes('Analizar') === true, boton);

  // Sin este botón, el detector de texto está registrado pero es inalcanzable:
  // el análisis por defecto corta en Tier 1 y nunca lo planifica.
  const profundo = await popup.textContent('#profundo');
  comprobar('hay forma de pedir Tier 2', profundo?.includes('profundo') === true, profundo);
  await popup.close();

  /*
   * Lo que NO se prueba aquí, y conviene saber por qué: la inyección en una
   * página real exige `activeTab`, que solo concede un clic humano sobre el
   * icono de la barra. Playwright no puede pulsar la barra del navegador, y
   * concederle permiso de host a la extensión para sortearlo probaría una
   * configuración que no es la que se publica.
   *
   * Ese recorrido está cubierto en test/analyze-page.test.ts, que ejercita
   * extracción, análisis e insignia sobre un DOM real con las tres superficies
   * montadas. Aquí se comprueba lo que solo el navegador puede confirmar.
   */
} finally {
  await ctx.close();
}

const fallos = comprobaciones.filter((c) => !c.ok);
console.log(`\n${comprobaciones.length - fallos.length}/${comprobaciones.length} comprobaciones`);
process.exit(fallos.length === 0 ? 0 : 1);
