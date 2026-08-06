import { RpcServer } from '@xpx/ipc';
import type { Transport } from '@xpx/ipc';
import { Analyzer } from './analyzer.js';
import { RemoteSlopDetector } from './remote-detector.js';
import { isAnalyzeRequest } from '../shared/messages.js';
import type { AnalyzeResponse } from '../shared/messages.js';
import type { RuntimeHost } from '../platform/runtime-host.js';

/** Nombre del puerto que abre el content script. */
export const CONTENT_PORT = 'xpx-content';

export interface BackgroundService {
  /** Atiende un puerto recién conectado. */
  serve(transport: Transport): RpcServer;
  readonly analyzer: Analyzer;
}

/**
 * Núcleo del service worker, sin depender de `chrome.*`.
 *
 * Separado del entrypoint para poder probar el enrutado completo —validación
 * incluida— sin navegador. El entrypoint solo traduce puertos a transportes.
 */
export function createBackgroundService(host: RuntimeHost): BackgroundService {
  const analyzer = new Analyzer({ detectors: [new RemoteSlopDetector(host)] });

  return {
    analyzer,
    serve(transport) {
      return new RpcServer(transport).on(
        'analyze',
        isAnalyzeRequest,
        async (req): Promise<AnalyzeResponse> => analyzer.analyze(req),
      );
    },
  };
}
