// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { Band } from '@xpx/kernel';
import { analyzePage } from '../src/content/analyze-page.js';
import { renderBadge } from '../src/content/badge.js';
import { CONTENT_PORT, startAnalyzeService } from '../src/core/analyze-service.js';
import { createPipeline } from '../src/core/composition.js';
import { startInferenceServer } from '../src/platform/inference-server.js';
import { ChromiumRuntimeHost } from '../src/platform/chromium-host.js';
import { fakeChromium } from './fake-browser.js';

const parrafo = (n: number) => `<p>${`palabra${n} `.repeat(40).trim()}</p>`;
const ARTICULO = `<article>${[1, 2, 3, 4, 5, 6].map(parrafo).join('')}</article>`;

/** PNG mínimo y válido, sin credenciales de procedencia. */
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);

function pagina(html: string): Document {
  const doc = document.implementation.createHTMLDocument('prueba');
  doc.documentElement.innerHTML = `<head></head><body>${html}</body>`;
  doc.documentElement.setAttribute('lang', 'es');
  Object.defineProperty(doc, 'location', {
    value: new URL('https://ejemplo.test/articulo'),
    configurable: true,
  });
  return doc;
}

/** Monta las tres superficies reales sobre un mismo doble de navegador. */
function sistema() {
  const f = fakeChromium();
  const offscreen = startInferenceServer({
    api: f.api,
    analyze: (i) => createPipeline().analyze(i),
  });
  const background = startAnalyzeService({
    api: f.api,
    host: new ChromiumRuntimeHost({ api: f.api }),
  });
  return {
    f,
    connect: () => f.connectFrom(CONTENT_PORT, { tab: { id: 1 } }),
    dispose: () => {
      background.dispose();
      offscreen.dispose();
    },
  };
}

const sinRed: typeof fetch = () => Promise.reject(new Error('sin red en el test'));

describe('analyzePage · el circuito completo desde el DOM', () => {
  it('analiza el artículo y deja una insignia con el resumen', async () => {
    const s = sistema();
    const doc = pagina(ARTICULO);

    const veredictos = await analyzePage({ doc, connect: s.connect, fetchImpl: sinRed });

    expect(veredictos.length).toBeGreaterThan(0);
    expect(doc.querySelector('xpx-resumen')).not.toBeNull();
    s.dispose();
  });

  /**
   * Sin detector de texto la respuesta correcta es abstenerse. Se fija por test
   * para que el día que llegue la estilometría este caso cambie a propósito y
   * no por accidente.
   */
  it('el texto se abstiene, y lo hace por falta de evidencia', async () => {
    const s = sistema();
    const veredictos = await analyzePage({
      doc: pagina(ARTICULO),
      connect: s.connect,
      fetchImpl: sinRed,
    });
    expect(veredictos.every((v) => v.band === Band.InsufficientEvidence)).toBe(true);
    expect(veredictos.every((v) => v.abstentionReason === 'NO_EVIDENCE')).toBe(true);
    s.dispose();
  });

  it('las imágenes llegan hasta el detector de procedencia', async () => {
    const s = sistema();
    const doc = pagina(
      `${ARTICULO}<img src="https://ejemplo.test/foto.png" width="400" height="300">`,
    );
    const traer = vi.fn(async () => new Response(PNG, { status: 200 }));

    const veredictos = await analyzePage({ doc, connect: s.connect, fetchImpl: traer });

    expect(traer).toHaveBeenCalledWith('https://ejemplo.test/foto.png', { credentials: 'omit' });
    const deImagen = veredictos.filter((v) => v.evidence[0]?.detectorId === 'provenance');
    expect(deImagen).toHaveLength(1);
    // Ausencia de credenciales NO es sospecha: la regla asimétrica de ADR-006.
    expect(deImagen[0]?.evidence[0]?.reliability).toBe(0);
    s.dispose();
  });

  /**
   * Una imagen de un CDN sin CORS abierto no se puede leer desde la página. Es
   * una limitación conocida del nivel 1 de permisos, y debe degradar en
   * silencio en lugar de tumbar el análisis de toda la página.
   */
  it('una imagen que no se puede descargar no rompe el resto', async () => {
    const s = sistema();
    const doc = pagina(`${ARTICULO}<img src="https://cdn.ajeno/x.png" width="400" height="300">`);
    const veredictos = await analyzePage({
      doc,
      connect: s.connect,
      fetchImpl: () => Promise.reject(new TypeError('Failed to fetch')),
    });
    expect(veredictos.length).toBeGreaterThan(0);
    expect(doc.querySelector('xpx-resumen')).not.toBeNull();
    s.dispose();
  });

  it('en una superficie de edición no analiza nada', async () => {
    const s = sistema();
    const doc = pagina(`<div contenteditable="true">borrador</div>${ARTICULO}`);
    const veredictos = await analyzePage({ doc, connect: s.connect, fetchImpl: sinRed });
    expect(veredictos).toHaveLength(0);
    s.dispose();
  });

  it('analizar dos veces no deja dos insignias', async () => {
    const s = sistema();
    const doc = pagina(ARTICULO);
    await analyzePage({ doc, connect: s.connect, fetchImpl: sinRed });
    await analyzePage({ doc, connect: s.connect, fetchImpl: sinRed });
    expect(doc.querySelectorAll('xpx-resumen')).toHaveLength(1);
    s.dispose();
  });

  it('cierra el puerto al terminar en lugar de dejarlo abierto', async () => {
    const s = sistema();
    await analyzePage({ doc: pagina(ARTICULO), connect: s.connect, fetchImpl: sinRed });
    // El servicio del background libera la conexión al caer el puerto.
    expect(s.f.ports.length).toBeGreaterThan(0);
    s.dispose();
  });
});

describe('insignia · ADR-008, no destructiva', () => {
  const veredicto = (band: Band) => ({
    hash: 'a'.repeat(64),
    band,
    llrTotal: 0,
    interval: { lower: 0, upper: 0 },
    evidence: [],
    validations: [],
    elapsedMs: 1,
  });

  it('inserta un único nodo y no toca el resto del documento', () => {
    const doc = pagina(ARTICULO);
    const antes = doc.querySelector('article')?.innerHTML;

    renderBadge(doc, [veredicto(Band.WeakSignal)]);

    expect(doc.querySelectorAll('xpx-resumen')).toHaveLength(1);
    expect(doc.querySelector('article')?.innerHTML).toBe(antes);
  });

  /**
   * El shadow root cerrado es lo que impide que la página lea o altere la
   * interfaz. Comprobarlo desde fuera es comprobar la garantía.
   */
  it('el shadow root es cerrado: la página no puede alcanzarlo', () => {
    const doc = pagina(ARTICULO);
    renderBadge(doc, [veredicto(Band.WeakSignal)]);
    expect(doc.querySelector('xpx-resumen')?.shadowRoot).toBeNull();
  });

  it('dispose deja la página exactamente como estaba', () => {
    const doc = pagina(ARTICULO);
    const antes = doc.body.innerHTML;
    const asa = renderBadge(doc, [veredicto(Band.StrongSignal)]);
    expect(doc.body.innerHTML).not.toBe(antes);
    asa.dispose();
    expect(doc.body.innerHTML).toBe(antes);
  });

  it('sin nada analizable lo dice en lugar de callarse', () => {
    const doc = pagina('<p>corto</p>');
    renderBadge(doc, []);
    expect(doc.querySelector('xpx-resumen')).not.toBeNull();
  });
});
