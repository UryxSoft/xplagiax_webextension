import { chromium } from 'playwright';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Prueba de humo real: carga la extensión empaquetada en Chromium.
 *
 * Verifica lo que ningún test unitario puede:
 *   1. El manifiesto es válido y Chrome acepta la extensión.
 *   2. El service worker arranca sin excepciones.
 *   3. El documento offscreen se crea y su módulo se ejecuta.
 *   4. La CSP permite el WebAssembly de wllama y el .wasm se sirve.
 *   5. El RPC entre background y offscreen responde de extremo a extremo.
 *
 * Fuera de alcance aquí: la descarga del modelo (253 MB) y la inyección en la
 * página, que por diseño (ADR-009) exige un clic real en el icono de la barra.
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const EXT = resolve(here, '..', '..', '..', 'chrome_extension');
const CHROME =
  process.env.XPX_CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const profile = await mkdtemp(join(tmpdir(), 'xpx-'));
const problemas = [];
let ctx;

const ok = (n, msg) => console.log(`OK ${n} · ${msg}`);
const fallo = (n, msg) => {
  console.log(`FALLO ${n} · ${msg}`);
  problemas.push(`${n}: ${msg}`);
};

try {
  ctx = await chromium.launchPersistentContext(profile, {
    executablePath: CHROME,
    headless: true,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--no-sandbox'],
  });

  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15_000 });
  const id = new URL(sw.url()).host;
  ok('1-2', `manifiesto aceptado y service worker vivo · id=${id}`);

  sw.on('console', (m) => {
    if (m.type() === 'error') problemas.push(`[sw] ${m.text()}`);
  });

  // 3. Documento offscreen. Es la pieza que el host de inferencia gestiona.
  const creado = await sw.evaluate(async () => {
    try {
      await chrome.offscreen.createDocument({
        url: chrome.runtime.getURL('offscreen.html'),
        reasons: ['WORKERS'],
        justification: 'prueba de humo',
      });
      return 'creado';
    } catch (e) {
      return `error: ${e.message}`;
    }
  });
  creado === 'creado' ? ok('3', 'documento offscreen creado') : fallo('3', creado);

  await new Promise((r) => setTimeout(r, 2500));

  const contextos = await sw.evaluate(async () =>
    (await chrome.runtime.getContexts({})).map((c) => c.contextType),
  );
  contextos.includes('OFFSCREEN_DOCUMENT')
    ? ok('3b', `contextos vivos: ${JSON.stringify(contextos)}`)
    : fallo('3b', `sin documento offscreen: ${JSON.stringify(contextos)}`);

  // 4. ¿Se sirve el .wasm y lo acepta la CSP? Se compila de verdad.
  const wasm = await sw.evaluate(async () => {
    try {
      const url = chrome.runtime.getURL('wllama/wllama.wasm');
      const res = await fetch(url);
      if (!res.ok) return `HTTP ${res.status}`;
      const bytes = await res.arrayBuffer();
      await WebAssembly.compile(bytes);
      return `compilado (${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB)`;
    } catch (e) {
      return `error: ${e.message}`;
    }
  });
  wasm.startsWith('compilado') ? ok('4', `WebAssembly ${wasm}`) : fallo('4', wasm);

  // 5. RPC de extremo a extremo contra el documento offscreen.
  const rpc = await sw.evaluate(async () => {
    return await new Promise((resolve) => {
      const port = chrome.runtime.connect({ name: 'xpx-inference' });
      const t = setTimeout(() => resolve('sin respuesta en 8 s'), 8000);
      port.onMessage.addListener((m) => {
        clearTimeout(t);
        resolve(`respuesta: kind=${m?.kind} code=${m?.payload?.code ?? '-'}`);
      });
      port.onDisconnect.addListener(() => {
        clearTimeout(t);
        resolve('puerto rechazado: nadie escucha en xpx-inference');
      });
      // Carga deliberadamente inválida: interesa que el servidor CONTESTE,
      // no que infiera. Una respuesta de error prueba que el RPC está vivo
      // sin arrastrar 253 MB de modelo.
      port.postMessage({ v: 1, id: 'humo', channel: 'infer', kind: 'request', payload: { malo: true } });
    });
  });
  rpc.startsWith('respuesta:') ? ok('5', `RPC vivo · ${rpc}`) : fallo('5', rpc);

  console.log(
    problemas.length === 0
      ? '\nTodo en verde. Sin errores en consola.'
      : `\n${problemas.length} problema(s):\n  ${problemas.slice(0, 10).join('\n  ')}`,
  );
} finally {
  await ctx?.close();
  await rm(profile, { recursive: true, force: true });
}

if (problemas.length > 0) process.exitCode = 1;
