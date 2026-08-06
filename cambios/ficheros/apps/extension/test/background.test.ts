import { describe, expect, it } from 'vitest';
import { ErrorCode, RpcClient } from '@xpx/ipc';
import type { Transport } from '@xpx/ipc';
import { Band, NEVER_ABORTED } from '@xpx/kernel';
import type { Detector, Evidence, NormalizedInput } from '@xpx/kernel';
import { Analyzer, summarize } from '../src/background/analyzer.js';
import { VerdictCache } from '../src/background/verdict-cache.js';
import { RemoteSlopDetector } from '../src/background/remote-detector.js';
import { createBackgroundService } from '../src/background/service.js';
import { isAnalyzeResponse } from '../src/shared/messages.js';
import type { AnalyzeResponse, BlockVerdict, TextBlock } from '../src/shared/messages.js';
import type { RuntimeHost } from '../src/platform/runtime-host.js';

function connectedPair(): { a: Transport; b: Transport } {
  const listeners: { a: ((m: unknown) => void)[]; b: ((m: unknown) => void)[] } = { a: [], b: [] };
  const make = (self: 'a' | 'b', other: 'a' | 'b'): Transport => ({
    post: (m) => {
      queueMicrotask(() => {
        for (const l of [...listeners[other]]) l(m);
      });
    },
    subscribe: (l) => {
      listeners[self].push(l);
      return () => {
        listeners[self] = listeners[self].filter((x) => x !== l);
      };
    },
  });
  return { a: make('a', 'b'), b: make('b', 'a') };
}

const block = (over: Partial<TextBlock> = {}): TextBlock => ({
  hash: 'h1',
  text: 'a piece of text that is long enough to be worth analyzing by the model',
  lang: 'en',
  tokenCount: 100,
  ...over,
});

/** Detector de mentira que devuelve el llr que se le pida. */
function stubDetector(llr: number, tier: 0 | 1 | 2 = 2): Detector & { calls: number } {
  const d = {
    calls: 0,
    id: 'stub',
    version: '1.0.0',
    capabilities: { modalities: ['text'] as const, tier, languages: ['en'] },
    canHandle: (i: NormalizedInput) => i.modality === 'text',
    async score(): Promise<readonly Evidence[]> {
      d.calls += 1;
      return [
        {
          detectorId: 'stub',
          detectorVersion: '1.0.0',
          kind: 'statistical',
          modality: 'text',
          llr,
          reliability: 1,
          calibrationId: 'stub-v1',
          rationale: [{ code: 'STUB_SAYS', contribution: llr }],
          costMs: 1,
        },
      ];
    },
  };
  return d;
}

describe('VerdictCache', () => {
  const v = (hash: string): BlockVerdict => ({
    hash,
    band: Band.WeakSignal,
    llrTotal: 1,
    rationaleCodes: [],
    elapsedMs: 1,
  });

  it('guarda y recupera por hash', () => {
    const c = new VerdictCache();
    c.set('a', v('a'));
    expect(c.get('a')?.hash).toBe('a');
    expect(c.get('inexistente')).toBeUndefined();
  });

  /** Una caché sin techo en el service worker de MV3 es una fuga con otro nombre. */
  it('expulsa lo más antiguo al llegar al techo', () => {
    const c = new VerdictCache(3);
    for (const h of ['a', 'b', 'c', 'd']) c.set(h, v(h));
    expect(c.size).toBe(3);
    expect(c.get('a')).toBeUndefined();
    expect(c.get('d')?.hash).toBe('d');
  });

  it('leer una entrada la rejuvenece: es un LRU, no un FIFO', () => {
    const c = new VerdictCache(3);
    for (const h of ['a', 'b', 'c']) c.set(h, v(h));
    c.get('a'); // 'a' pasa a ser la más reciente
    c.set('d', v('d'));
    expect(c.get('a')?.hash).toBe('a');
    expect(c.get('b')).toBeUndefined();
  });

  it('reescribir no duplica ni altera el techo', () => {
    const c = new VerdictCache(2);
    c.set('a', v('a'));
    c.set('a', v('a'));
    expect(c.size).toBe(1);
  });
});

describe('summarize', () => {
  /**
   * La página del usuario recibe banda y códigos, no el llr de cada detector ni
   * el texto. Los códigos son claves de i18n, nunca texto crudo del detector.
   */
  it('no deja escapar el texto ni la evidencia cruda', () => {
    const resumen = summarize({
      hash: 'h',
      band: Band.StrongSignal,
      llrTotal: 2.5,
      interval: { lower: 1, upper: 4 },
      evidence: [
        {
          detectorId: 'slop-text',
          detectorVersion: '0.1.0',
          kind: 'statistical',
          modality: 'text',
          llr: 2.5,
          reliability: 1,
          calibrationId: 'c',
          rationale: [{ code: 'SLOP_MODEL_SAYS_AI', contribution: 2.5 }],
          costMs: 500,
        },
      ],
      validations: [],
      elapsedMs: 510,
    });
    expect(resumen.rationaleCodes).toEqual(['SLOP_MODEL_SAYS_AI']);
    expect(JSON.stringify(resumen)).not.toContain('reliability');
    expect(Object.keys(resumen)).not.toContain('evidence');
  });
});

describe('Analyzer', () => {
  it('devuelve un veredicto por bloque', async () => {
    const a = new Analyzer({ detectors: [stubDetector(3)] });
    const res = await a.analyze({ blocks: [block({ hash: 'h1' }), block({ hash: 'h2' })] });
    expect(res.verdicts.map((v) => v.hash)).toEqual(['h1', 'h2']);
  });

  /** ADR-005: Tier 2 no corre salvo que se pida explícitamente. */
  it('sin "deep" el detector Tier 2 no se ejecuta', async () => {
    const d = stubDetector(3, 2);
    await new Analyzer({ detectors: [d] }).analyze({ blocks: [block()] });
    expect(d.calls).toBe(0);
  });

  it('con "deep" sí se ejecuta', async () => {
    const d = stubDetector(3, 2);
    await new Analyzer({ detectors: [d] }).analyze({ blocks: [block()], deep: true });
    expect(d.calls).toBe(1);
  });

  it('un detector Tier 1 corre siempre', async () => {
    const d = stubDetector(3, 1);
    await new Analyzer({ detectors: [d] }).analyze({ blocks: [block()] });
    expect(d.calls).toBe(1);
  });

  it('el segundo análisis del mismo hash sale de la caché', async () => {
    const d = stubDetector(3, 1);
    const a = new Analyzer({ detectors: [d] });
    await a.analyze({ blocks: [block({ hash: 'x' })] });
    await a.analyze({ blocks: [block({ hash: 'x' })] });
    expect(d.calls).toBe(1);
  });

  /** Un análisis profundo es lo que se pide cuando el superficial no bastó. */
  it('el modo profundo ignora la caché', async () => {
    const d = stubDetector(3, 2);
    const a = new Analyzer({ detectors: [d] });
    await a.analyze({ blocks: [block({ hash: 'x' })], deep: true });
    await a.analyze({ blocks: [block({ hash: 'x' })], deep: true });
    expect(d.calls).toBe(2);
  });
});

describe('RemoteSlopDetector', () => {
  function fakeHost(run: RuntimeHost['run']): RuntimeHost {
    return { platform: 'chromium', ensure: async () => {}, run, teardown: async () => {} };
  }

  it('cruza el puerto y devuelve la evidencia del otro lado', async () => {
    const evidencia: Evidence = {
      detectorId: 'slop-text',
      detectorVersion: '0.1.0',
      kind: 'statistical',
      modality: 'text',
      llr: 2,
      reliability: 1,
      calibrationId: 'c',
      rationale: [],
      costMs: 900,
    };
    const host = fakeHost((async () => ({ evidence: [evidencia] })) as RuntimeHost['run']);
    const d = new RemoteSlopDetector(host);
    const [ev] = await d.score(
      { hash: 'h', modality: 'text', text: 'hola', lang: 'en', tokenCount: 100 },
      { signal: NEVER_ABORTED, budgetMs: 10_000, now: () => Date.now() },
    );
    expect(ev?.llr).toBe(2);
  });

  it('se declara Tier 2, que es lo que lo mantiene fuera del camino rápido', () => {
    const d = new RemoteSlopDetector(fakeHost((async () => ({ evidence: [] })) as RuntimeHost['run']));
    expect(d.capabilities.tier).toBe(2);
  });
});

describe('servicio de background sobre RPC', () => {
  const host: RuntimeHost = {
    platform: 'chromium',
    ensure: async () => {},
    run: (async () => ({ evidence: [] })) as RuntimeHost['run'],
    teardown: async () => {},
  };

  it('responde a una petición válida', async () => {
    const { a, b } = connectedPair();
    createBackgroundService(host).serve(b);
    const res = await new RpcClient({ transport: a }).request<unknown, AnalyzeResponse>(
      'analyze',
      { blocks: [block()] },
      isAnalyzeResponse,
    );
    expect(res.verdicts).toHaveLength(1);
  });

  /**
   * El content script vive en la página del usuario. Una petición con forma
   * inesperada se rechaza en la frontera, antes de tocar el analizador.
   */
  it('rechaza una petición malformada', async () => {
    const { a, b } = connectedPair();
    createBackgroundService(host).serve(b);
    const client = new RpcClient({ transport: a });
    for (const malo of [
      {},
      { blocks: [] },
      { blocks: 'no soy una lista' },
      { blocks: [{ hash: 'h' }] },
      { blocks: [{ ...block(), text: '' }] },
      { blocks: [block()], deep: 'sí' },
    ]) {
      await expect(client.request('analyze', malo, isAnalyzeResponse)).rejects.toMatchObject({
        code: ErrorCode.BadRequest,
      });
    }
  });

  it('rechaza una avalancha de bloques', async () => {
    const { a, b } = connectedPair();
    createBackgroundService(host).serve(b);
    const demasiados = Array.from({ length: 51 }, (_, i) => block({ hash: `h${i}` }));
    await expect(
      new RpcClient({ transport: a }).request('analyze', { blocks: demasiados }, isAnalyzeResponse),
    ).rejects.toMatchObject({ code: ErrorCode.BadRequest });
  });

  it('rechaza un bloque desmesurado', async () => {
    const { a, b } = connectedPair();
    createBackgroundService(host).serve(b);
    await expect(
      new RpcClient({ transport: a }).request(
        'analyze',
        { blocks: [block({ text: 'x'.repeat(200_001) })] },
        isAnalyzeResponse,
      ),
    ).rejects.toMatchObject({ code: ErrorCode.BadRequest });
  });
});
