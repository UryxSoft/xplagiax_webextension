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
  /** Envía trabajo al host y espera el resultado. */
  run<TReq, TRes>(channel: string, payload: TReq): Promise<TRes>;
  teardown(): Promise<void>;
}

export function detectPlatform(): Platform {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  if (ua.includes('Firefox')) return 'firefox';
  // Safari sin Chrome en el UA. Chromium (Chrome, Edge, Opera) comparte camino.
  if (ua.includes('Safari') && !ua.includes('Chrome')) return 'safari';
  return 'chromium';
}

/**
 * Chromium (Chrome, Edge, Opera): documento offscreen, que es el único contexto
 * con vida larga, sin DOM visible y con aislamiento adecuado para WASM.
 */
export class ChromiumRuntimeHost implements RuntimeHost {
  readonly platform = 'chromium' as const;

  async ensure(): Promise<void> {
    throw new Error('Pendiente: chrome.offscreen.createDocument');
  }

  async run<TReq, TRes>(_channel: string, _payload: TReq): Promise<TRes> {
    throw new Error('Pendiente');
  }

  async teardown(): Promise<void> {
    throw new Error('Pendiente: chrome.offscreen.closeDocument');
  }
}

/** Firefox: no tiene chrome.offscreen. Los Workers cuelgan de la event page. */
export class FirefoxRuntimeHost implements RuntimeHost {
  readonly platform = 'firefox' as const;
  async ensure(): Promise<void> {
    throw new Error('Pendiente: Worker desde la event page');
  }
  async run<TReq, TRes>(_channel: string, _payload: TReq): Promise<TRes> {
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
  async run<TReq, TRes>(_channel: string, _payload: TReq): Promise<TRes> {
    throw new Error('Pendiente');
  }
  async teardown(): Promise<void> {
    throw new Error('Pendiente');
  }
}

export function createRuntimeHost(platform = detectPlatform()): RuntimeHost {
  switch (platform) {
    case 'firefox':
      return new FirefoxRuntimeHost();
    case 'safari':
      return new SafariRuntimeHost();
    case 'chromium':
      return new ChromiumRuntimeHost();
  }
}
