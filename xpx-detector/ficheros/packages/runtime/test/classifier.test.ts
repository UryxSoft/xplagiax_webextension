import { describe, expect, it, vi } from 'vitest';
import {
  MAX_CHARS,
  buildPrompt,
  parseLabel,
  probabilityFromLogprobs,
} from '../src/prompt.js';
import { WllamaTextClassifier } from '../src/text-classifier.js';
import type { CompletionParams, CompletionResponse, WllamaLike } from '../src/text-classifier.js';
import { SLOP_MODEL } from '../src/model.js';

/** Doble de wllama. Registra lo que se le pide y devuelve lo que se le diga. */
function fakeWllama(
  reply: (p: CompletionParams) => CompletionResponse | Promise<CompletionResponse> = () => ({
    choices: [{ text: 'ai_generated' }],
  }),
) {
  const calls: { load: number; completions: CompletionParams[]; exit: number } = {
    load: 0,
    completions: [],
    exit: 0,
  };
  let loadParams: unknown;
  const wllama: WllamaLike = {
    loadModelFromUrl: async (url, params) => {
      calls.load += 1;
      loadParams = { url, params };
      await Promise.resolve();
      params.progressCallback?.({ loaded: 50, total: 100 });
    },
    createCompletion: async (p) => {
      calls.completions.push(p);
      return reply(p);
    },
    exit: async () => {
      calls.exit += 1;
    },
  };
  return {
    wllama,
    calls,
    get loadParams() {
      return loadParams;
    },
  };
}

describe('prompt', () => {
  /**
   * Este test no comprueba una preferencia de estilo: el modelo está destilado
   * contra este formato exacto. Si alguien lo "mejora", la exactitud cae sin
   * que ningún otro test se entere.
   */
  it('reproduce el formato de turnos de Gemma del proyecto original', () => {
    const p = buildPrompt('hola');
    expect(p).toContain('<start_of_turn>user');
    expect(p).toContain("Classify this text as exactly 'ai_generated' or 'human_written':");
    expect(p).toContain('Respond with ONLY one of these two words: ai_generated or human_written');
    expect(p).toContain('<end_of_turn>');
    expect(p.endsWith('<start_of_turn>model\n')).toBe(true);
    expect(p).toContain('"hola"');
  });

  it('trunca a 1500 caracteres, que es el límite del original', () => {
    const largo = 'x'.repeat(5000);
    expect(buildPrompt(largo)).toContain('x'.repeat(MAX_CHARS));
    expect(buildPrompt(largo)).not.toContain('x'.repeat(MAX_CHARS + 1));
  });
});

describe('lectura de la etiqueta', () => {
  it('reconoce las dos etiquetas y sus variantes', () => {
    expect(parseLabel('ai_generated')).toBe('ai_generated');
    expect(parseLabel('  AI_GENERATED  ')).toBe('ai_generated');
    expect(parseLabel('ai')).toBe('ai_generated');
    expect(parseLabel('human_written')).toBe('human_written');
    expect(parseLabel('Human')).toBe('human_written');
  });

  /** Inventar una etiqueta por defecto sería fabricar evidencia. */
  it('lo que no reconoce es "uncertain", no un valor por defecto', () => {
    expect(parseLabel('')).toBe('uncertain');
    expect(parseLabel('no lo sé')).toBe('uncertain');
    expect(parseLabel('42')).toBe('uncertain');
  });
});

describe('probabilidad desde log-probabilidades', () => {
  it('normaliza sobre los dos candidatos', () => {
    // ln(0,8) y ln(0,2) → 0,8 tras normalizar.
    const p = probabilityFromLogprobs({ ai: Math.log(0.8), human: Math.log(0.2) });
    expect(p).toBeCloseTo(0.8, 5);
  });

  it('ignora tokens que no son ninguna de las dos etiquetas', () => {
    const p = probabilityFromLogprobs({
      ai: Math.log(0.5),
      human: Math.log(0.5),
      '\n': Math.log(0.9),
      the: Math.log(0.4),
    });
    expect(p).toBeCloseTo(0.5, 5);
  });

  it('acepta las variantes troceadas del tokenizador', () => {
    const p = probabilityFromLogprobs({ _ai: Math.log(0.9), _human: Math.log(0.1) });
    expect(p).toBeCloseTo(0.9, 5);
  });

  /** Sin señal utilizable devuelve undefined: es información, no un fallo. */
  it('devuelve undefined cuando no hay nada que interpretar', () => {
    expect(probabilityFromLogprobs(undefined)).toBeUndefined();
    expect(probabilityFromLogprobs({})).toBeUndefined();
    expect(probabilityFromLogprobs({ the: Math.log(0.9), and: Math.log(0.1) })).toBeUndefined();
  });
});

describe('WllamaTextClassifier', () => {
  it('no clasifica sin haber cargado el modelo', async () => {
    const f = fakeWllama();
    const c = new WllamaTextClassifier({ wllama: f.wllama });
    expect(c.isReady()).toBe(false);
    await expect(c.classify('texto')).rejects.toThrow(/no cargado/);
  });

  it('carga desde la URL del modelo con el contexto declarado', async () => {
    const f = fakeWllama();
    const c = new WllamaTextClassifier({ wllama: f.wllama, threads: 4 });
    await c.load();
    expect(c.isReady()).toBe(true);
    expect(f.loadParams).toMatchObject({
      url: SLOP_MODEL.url,
      params: { n_ctx: SLOP_MODEL.contextTokens, n_threads: 4 },
    });
  });

  /** 253 MB: dos descargas simultáneas no solo gastan red, agotan memoria. */
  it('cargas concurrentes comparten una sola descarga', async () => {
    const f = fakeWllama();
    const c = new WllamaTextClassifier({ wllama: f.wllama });
    await Promise.all([c.load(), c.load(), c.load()]);
    expect(f.calls.load).toBe(1);
  });

  it('no recarga si ya está listo', async () => {
    const f = fakeWllama();
    const c = new WllamaTextClassifier({ wllama: f.wllama });
    await c.load();
    await c.load();
    expect(f.calls.load).toBe(1);
  });

  it('informa del progreso en porcentaje', async () => {
    const f = fakeWllama();
    const c = new WllamaTextClassifier({ wllama: f.wllama });
    const progreso = vi.fn();
    await c.load(progreso);
    expect(progreso).toHaveBeenCalledWith(50);
  });

  it('tras un fallo de carga, un intento posterior vuelve a probar', async () => {
    const f = fakeWllama();
    let falla = true;
    f.wllama.loadModelFromUrl = async () => {
      f.calls.load += 1;
      if (falla) {
        falla = false;
        throw new Error('red caída');
      }
    };
    const c = new WllamaTextClassifier({ wllama: f.wllama });
    await expect(c.load()).rejects.toThrow(/red caída/);
    expect(c.isReady()).toBe(false);
    await expect(c.load()).resolves.toBeUndefined();
    expect(c.isReady()).toBe(true);
  });

  it('pide muestreo determinista y logprobs', async () => {
    const f = fakeWllama();
    const c = new WllamaTextClassifier({ wllama: f.wllama, topLogprobs: 5 });
    await c.load();
    await c.classify('un texto cualquiera');
    const params = f.calls.completions[0];
    expect(params?.temperature).toBe(0);
    expect(params?.logprobs).toBe(5);
    expect(params?.max_tokens).toBe(10);
    expect(params?.stop).toContain('<end_of_turn>');
  });

  it('extrae la probabilidad del PRIMER token generado', async () => {
    const f = fakeWllama(() => ({
      choices: [
        {
          text: 'ai_generated',
          logprobs: {
            top_logprobs: [
              { ai: Math.log(0.9), human: Math.log(0.1) },
              // El segundo token ya está condicionado: no debe influir.
              { _generated: Math.log(0.99) },
            ],
          },
        },
      ],
    }));
    const c = new WllamaTextClassifier({ wllama: f.wllama });
    await c.load();
    const r = await c.classify('texto');
    expect(r.label).toBe('ai_generated');
    expect(r.pAiGenerated).toBeCloseTo(0.9, 5);
  });

  it('sin logprobs devuelve la etiqueta y pAiGenerated undefined', async () => {
    const f = fakeWllama(() => ({ choices: [{ text: 'human_written', logprobs: null }] }));
    const c = new WllamaTextClassifier({ wllama: f.wllama });
    await c.load();
    const r = await c.classify('texto');
    expect(r.label).toBe('human_written');
    expect(r.pAiGenerated).toBeUndefined();
  });

  it('marca el truncado para que el detector ajuste la fiabilidad', async () => {
    const f = fakeWllama();
    const c = new WllamaTextClassifier({ wllama: f.wllama });
    await c.load();
    expect((await c.classify('x'.repeat(100))).truncated).toBe(false);
    expect((await c.classify('x'.repeat(MAX_CHARS + 1))).truncated).toBe(true);
  });

  it('una respuesta vacía no revienta: se lee como uncertain', async () => {
    const f = fakeWllama(() => ({ choices: [] }));
    const c = new WllamaTextClassifier({ wllama: f.wllama });
    await c.load();
    const r = await c.classify('texto');
    expect(r.label).toBe('uncertain');
    expect(r.rawOutput).toBe('');
  });

  it('dispose libera el modelo y deja de estar listo', async () => {
    const f = fakeWllama();
    const c = new WllamaTextClassifier({ wllama: f.wllama });
    await c.load();
    await c.dispose();
    expect(f.calls.exit).toBe(1);
    expect(c.isReady()).toBe(false);
  });
});
