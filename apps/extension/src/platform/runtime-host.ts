import type { AbortLike, Channel, Validator } from '@xpx/ipc';
import { ChromiumRuntimeHost } from './chromium-host.js';
import { systemExtensionApi } from './extension-api.js';
import type { ExtensionApi } from './extension-api.js';

/**
 * El único lugar del sistema donde se permite código específico de navegador.
 * Ver 03-arquitectura.md §5 y la matriz de compatibilidad en §8.
 *
 * Regla absoluta: la inferencia jamás corre en el content script. No se puede
 * garantizar aislamiento cross-origin en una página de terceros, el hilo
 * principal pertenece al usuario, y una fuga del runtime rompería el sitio del
 * usuario en lugar del nuestro.
 */

export type Platform = 'chromium' | 'firefox' | 'safari';

export interface RuntimeHost {
  readonly platform: Platform;
  /** Prepara el contexto de larga vida donde viven los Workers de inferencia. */
  ensure(): Promise<void>;
  /**
   * Envía trabajo al host y espera el resultado.
   *
   * El validador no es opcional a propósito: el resultado cruza una frontera de
   * proceso, y aceptarlo sin comprobar convertiría `TRes` en una promesa que
   * nadie cumple.
   */
  run<TReq, TRes>(
    channel: Channel,
    payload: TReq,
    validate: Validator<TRes>,
    signal?: AbortLike,
  ): Promise<TRes>;
  teardown(): Promise<void>;
}

/**
 * Identifica la plataforma a partir del user-agent.
 *
 * Se recibe por parámetro en lugar de leerlo del global: `navigator` es una
 * propiedad de solo lectura en varios entornos, y una función que depende de un
 * global inmutable no se puede probar sin trucos.
 */
export function detectPlatform(userAgent: string = readUserAgent()): Platform {
  if (userAgent.includes('Firefox')) return 'firefox';
  // Safari sin Chrome en el UA. Chromium (Chrome, Edge, Opera) comparte camino.
  if (userAgent.includes('Safari') && !userAgent.includes('Chrome')) return 'safari';
  return 'chromium';
}

function readUserAgent(): string {
  const nav = (globalThis as { navigator?: { userAgent?: string } }).navigator;
  return nav?.userAgent ?? '';
}

/** Firefox: no tiene chrome.offscreen. Los Workers cuelgan de la event page. */
export class FirefoxRuntimeHost implements RuntimeHost {
  readonly platform = 'firefox' as const;
  async ensure(): Promise<void> {
    throw new Error('Pendiente: Worker desde la event page');
  }
  async run<TReq, TRes>(
    _channel: Channel,
    _payload: TReq,
    _validate: Validator<TRes>,
    _signal?: AbortLike,
  ): Promise<TRes> {
    throw new Error('Pendiente');
  }
  async teardown(): Promise<void> {
    throw new Error('Pendiente');
  }
}

/** Safari: sin offscreen y con cuotas de almacenamiento más agresivas. */
export class SafariRuntimeHost implements RuntimeHost {
  readonly platform = 'safari' as const;
  async ensure(): Promise<void> {
    throw new Error('Pendiente: página de extensión oculta');
  }
  async run<TReq, TRes>(
    _channel: Channel,
    _payload: TReq,
    _validate: Validator<TRes>,
    _signal?: AbortLike,
  ): Promise<TRes> {
    throw new Error('Pendiente');
  }
  async teardown(): Promise<void> {
    throw new Error('Pendiente');
  }
}

export function createRuntimeHost(
  platform: Platform = detectPlatform(),
  api?: ExtensionApi,
): RuntimeHost {
  switch (platform) {
    case 'firefox':
      return new FirefoxRuntimeHost();
    case 'safari':
      return new SafariRuntimeHost();
    case 'chromium':
      return new ChromiumRuntimeHost({ api: api ?? systemExtensionApi() });
  }
}
