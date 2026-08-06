import { describe, expect, it } from 'vitest';
import type { DetectorContext, NormalizedInput } from '@xpx/kernel';
import { NEVER_ABORTED } from '@xpx/kernel';
import type { Classification, ModelDescriptor, TextClassifier } from '@xpx/runtime';
import { SLOP_MODEL } from '@xpx/runtime';
import { SlopDetector } from '../src/index.js';
import {
  CALIBRATION_ID,
  LABEL_ONLY_LLR,
  MAX_LLR,
  MIN_TOKENS,
  llrFromProbability,
  reliabilityFor,
} from '../src/calibration.js';

function fakeClassifier(
  result: Partial<Classification> = {},
  opts: { ready?: boolean; model?: ModelDescriptor } = {},
) {
  const calls = { load: 0, classify: 0, dispose: 0 };
  let ready = opts.ready ?? true;
  const classifier: TextClassifier = {
    model: opts.model ?? SLOP_MODEL,
    isReady: () => ready,
    load: async () => {
      calls.load += 1;
      ready = true;
    },
    classify: async () => {
      calls.classify += 1;
      return {
        label: 'ai_generated',
        pAiGenerated: 0.9,
        rawOutput: 'ai_generated',
        costMs: 1,
        truncated: false,
        ...result,
      };
    },
    dispose: async () => {
      calls.dispose += 1;
      ready = false;
    },
  };
  return { classifier, calls };
}

const ctx: DetectorContext = { signal: NEVER_ABORTED, budgetMs: 10_000, now: () => Date.now() };

function input(over: Partial<NormalizedInput> = {}): NormalizedInput {
  return {
    hash: 'abc',
    modality: 'text',
    text: 'a text long enough to be classified by the model',
    lang: 'en',
    tokenCount: 100,
    ...over,
  };
}

describe('calibración', () => {
  /**
   * El techo es la pieza que impide fabricar certeza. Un modelo con 95 % de
   * exactitud no puede aportar evidencia de nivel criptográfico por muy segura
   * que parezca una respuesta concreta.
   */
  it('el llr está acotado por la exactitud publicada del modelo', () => {
    expect(MAX_LLR).toBeCloseTo(Math.log(0.95 / 0.05), 6);
    expect(llrFromProbability(0.99999)).toBeCloseTo(MAX_LLR, 6);
    expect(llrFromProbability(0.00001)).toBeCloseTo(-MAX_LLR, 6);
  });

  it('una probabilidad de 0,5 no aporta evidencia', () => {
    expect(llrFromProbability(0.5)).toBeCloseTo(0, 6);
  });

  it('el signo apunta en la dirección correcta', () => {
    expect(llrFromProbability(0.8)).toBeGreaterThan(0);
    expect(llrFromProbability(0.2)).toBeLessThan(0);
  });

  it('llr y probabilidad son monótonos', () => {
    const ps = [0.1, 0.3, 0.5, 0.7, 0.9];
    const llrs = ps.map(llrFromProbability);
    for (let i = 1; i < llrs.length; i += 1) {
      expect(llrs[i]!).toBeGreaterThan(llrs[i - 1]!);
    }
  });

  /** El dataset de entrenamiento es en inglés. Fuera de ahí no hay cobertura. */
  it('fuera del idioma validado la fiabilidad es cero', () => {
    const base = { tokenCount: 100, truncated: false, supportedLanguages: ['en'] };
    expect(reliabilityFor({ ...base, lang: 'en' })).toBeGreaterThan(0);
    expect(reliabilityFor({ ...base, lang: 'en-US' })).toBeGreaterThan(0);
    expect(reliabilityFor({ ...base, lang: 'es' })).toBe(0);
    expect(reliabilityFor({ ...base, lang: 'zh' })).toBe(0);
  });

  it('por debajo del mínimo de tokens la fiabilidad es cero', () => {
    const base = { lang: 'en', truncated: false, supportedLanguages: ['en'] };
    expect(reliabilityFor({ ...base, tokenCount: MIN_TOKENS - 1 })).toBe(0);
    expect(reliabilityFor({ ...base, tokenCount: 200 })).toBe(1);
  });

  it('la fiabilidad crece de forma continua, sin saltos', () => {
    const base = { lang: 'en', truncated: false, supportedLanguages: ['en'] };
    const a = reliabilityFor({ ...base, tokenCount: 30 });
    const b = reliabilityFor({ ...base, tokenCount: 45 });
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(b).toBeLessThan(1);
  });

  it('el truncado penaliza pero no anula', () => {
    const base = { lang: 'en', tokenCount: 500, supportedLanguages: ['en'] };
    const entero = reliabilityFor({ ...base, truncated: false });
    const cortado = reliabilityFor({ ...base, truncated: true });
    expect(cortado).toBeLessThan(entero);
    expect(cortado).toBeGreaterThan(0);
  });
});

describe('SlopDetector', () => {
  it('se declara Tier 2 y solo texto', () => {
    const d = new SlopDetector({ classifier: fakeClassifier().classifier });
    expect(d.capabilities.tier).toBe(2);
    expect(d.capabilities.modalities).toEqual(['text']);
    expect(d.capabilities.requiresModel?.id).toBe(SLOP_MODEL.id);
  });

  it('rechaza barato lo que no puede procesar', () => {
    const d = new SlopDetector({ classifier: fakeClassifier().classifier });
    expect(d.canHandle(input())).toBe(true);
    expect(d.canHandle(input({ modality: 'image' }))).toBe(false);
    expect(d.canHandle(input({ text: undefined }))).toBe(false);
    expect(d.canHandle(input({ tokenCount: 3 }))).toBe(false);
  });

  it('convierte la probabilidad en evidencia calibrada', async () => {
    const f = fakeClassifier({ label: 'ai_generated', pAiGenerated: 0.9 });
    const d = new SlopDetector({ classifier: f.classifier });
    const [ev] = await d.score(input(), ctx);
    expect(ev?.llr).toBeCloseTo(llrFromProbability(0.9), 6);
    expect(ev?.llr).toBeGreaterThan(0);
    expect(ev?.reliability).toBe(1);
    expect(ev?.calibrationId).toBe(CALIBRATION_ID);
    expect(ev?.kind).toBe('statistical');
    expect(ev?.rationale[0]?.code).toBe('SLOP_MODEL_SAYS_AI');
  });

  it('un veredicto humano produce llr negativo', async () => {
    const f = fakeClassifier({ label: 'human_written', pAiGenerated: 0.05 });
    const d = new SlopDetector({ classifier: f.classifier });
    const [ev] = await d.score(input(), ctx);
    expect(ev?.llr).toBeLessThan(0);
    expect(ev?.rationale[0]?.code).toBe('SLOP_MODEL_SAYS_HUMAN');
  });

  it('sin logprobs degrada a evidencia media, no al techo', async () => {
    const f = fakeClassifier({ label: 'ai_generated', pAiGenerated: undefined });
    const d = new SlopDetector({ classifier: f.classifier });
    const [ev] = await d.score(input(), ctx);
    expect(ev?.llr).toBeCloseTo(LABEL_ONLY_LLR, 6);
    expect(ev?.llr).toBeLessThan(MAX_LLR);
    expect(ev?.rationale.map((r) => r.code)).toContain('SLOP_NO_LOGPROBS');
  });

  it('una salida ininteligible produce abstención', async () => {
    const f = fakeClassifier({ label: 'uncertain' });
    const d = new SlopDetector({ classifier: f.classifier });
    const [ev] = await d.score(input(), ctx);
    expect(ev?.llr).toBe(0);
    expect(ev?.reliability).toBe(0);
    expect(ev?.rationale[0]?.code).toBe('SLOP_UNPARSEABLE_OUTPUT');
  });

  /**
   * El modelo responderá con seguridad en cualquier idioma. Que responda no
   * significa que esté validado ahí.
   */
  it('fuera del idioma validado se abstiene aunque el modelo opine', async () => {
    const f = fakeClassifier({ label: 'ai_generated', pAiGenerated: 0.99 });
    const d = new SlopDetector({ classifier: f.classifier });
    const [ev] = await d.score(input({ lang: 'es' }), ctx);
    expect(ev?.llr).toBe(0);
    expect(ev?.reliability).toBe(0);
    expect(ev?.rationale[0]?.code).toBe('SLOP_OUT_OF_DOMAIN');
  });

  /** ADR-005: Tier 2 es opt-in. 253 MB no se descargan sin permiso. */
  it('sin modelo cargado se abstiene en vez de disparar la descarga', async () => {
    const f = fakeClassifier({}, { ready: false });
    const d = new SlopDetector({ classifier: f.classifier });
    const [ev] = await d.score(input(), ctx);
    expect(f.calls.load).toBe(0);
    expect(f.calls.classify).toBe(0);
    expect(ev?.reliability).toBe(0);
  });

  it('con loadOnDemand sí carga, porque el usuario ya lo pidió', async () => {
    const f = fakeClassifier({}, { ready: false });
    const d = new SlopDetector({ classifier: f.classifier, loadOnDemand: true });
    await d.score(input(), ctx);
    expect(f.calls.load).toBe(1);
    expect(f.calls.classify).toBe(1);
  });

  it('warmup carga el modelo', async () => {
    const f = fakeClassifier({}, { ready: false });
    await new SlopDetector({ classifier: f.classifier }).warmup();
    expect(f.calls.load).toBe(1);
  });

  it('el truncado se refleja en la fiabilidad', async () => {
    const entero = fakeClassifier({ truncated: false });
    const cortado = fakeClassifier({ truncated: true });
    const [a] = await new SlopDetector({ classifier: entero.classifier }).score(input(), ctx);
    const [b] = await new SlopDetector({ classifier: cortado.classifier }).score(input(), ctx);
    expect(b!.reliability).toBeLessThan(a!.reliability);
  });

  it('dispose libera el clasificador', async () => {
    const f = fakeClassifier();
    await new SlopDetector({ classifier: f.classifier }).dispose();
    expect(f.calls.dispose).toBe(1);
  });
});
