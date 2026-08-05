import { describe, expect, it } from 'vitest';
import { ExtinctionValidator } from '../src/index.js';
import { analyze, typeTokenRatio, burstiness } from '../src/heuristics.js';
import { Pipeline, DetectorRegistry, Band } from '../../../kernel/src/index.js';
import type { Detector, NormalizedInput, Evidence } from '../../../kernel/src/index.js';

const SLOP = `
In conclusion, it is important to note that artificial intelligence plays a crucial role in the
ever-evolving landscape of modern business. Furthermore, organizations must delve into the rich
tapestry of data available to them. Moreover, this is a testament to the transformative power of
technology. Additionally, companies that navigate the complex landscape of digital transformation
will unlock the full potential of their operations. In conclusion, it is important to remember
that the ever-changing nature of technology plays a pivotal role in shaping outcomes.
`.repeat(3);

const HUMAN = `
I spent about three weeks trying to get the thing to compile. Turns out the problem was a stale
lockfile — kinda embarrassing, honestly. My colleague found it in about four minutes after I'd
given up and gone to lunch. She just ran a clean install. That was it.

Anyway. The build works now. Mostly. There's still a flaky test that fails maybe one run in
twenty, and nobody has figured out why. I suspect it's a race in the fixture setup, but I haven't
had time to dig in properly. We shipped anyway. Sometimes you just ship.

Later I went back and read the git log. The lockfile had been committed by someone who left the
company in March. No note, no PR description, nothing. Classic.
`.repeat(3);

function input(text: string, partial: Partial<NormalizedInput> = {}): NormalizedInput {
  return {
    hash: 'h',
    modality: 'text',
    lang: 'en',
    text,
    tokenCount: text.split(/\s+/).length,
    ...partial,
  };
}

function ctx(band: Band, text: string) {
  return {
    input: input(text),
    band,
    llrTotal: 3,
    evidence: [] as readonly Evidence[],
    signal: { aborted: false },
  };
}

describe('heurísticas', () => {
  it('el TTR de un texto repetitivo es menor que el de uno variado', () => {
    const repetitive = typeTokenRatio(['a', 'a', 'a', 'a', 'b'], 100);
    const varied = typeTokenRatio(['a', 'b', 'c', 'd', 'e'], 100);
    expect(repetitive).toBeLessThan(varied);
    expect(varied).toBe(1);
  });

  it('la burstiness es 0 con frases de longitud idéntica', () => {
    expect(burstiness(['one two three.', 'four five six.'])).toBe(0);
  });

  it('la burstiness es alta con longitudes muy dispares', () => {
    expect(
      burstiness(['Yes.', 'This particular sentence goes on considerably longer than the previous one did.']),
    ).toBeGreaterThan(0.4);
  });

  it('detecta más patrones en texto con muletillas de IA', () => {
    expect(analyze(SLOP).rawAlpha).toBeGreaterThan(analyze(HUMAN).rawAlpha);
  });

  it('asigna mayor probabilidad al texto con muletillas', () => {
    expect(analyze(SLOP).probability).toBeGreaterThan(analyze(HUMAN).probability);
  });

  it('la probabilidad siempre cae en [0,1]', () => {
    for (const t of [SLOP, HUMAN, '', 'a', 'delve into '.repeat(200)]) {
      const p = analyze(t).probability;
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });

  it('no se rompe con entrada vacía', () => {
    expect(() => analyze('')).not.toThrow();
  });

  // Este es el test que importa: los umbrales absolutos dependen de la
  // biblioteca de patrones, pero la separación entre clases es lo que hace
  // útil al método. Si la separación cae por debajo del margen, la biblioteca
  // se ha degradado y los umbrales hay que recalibrarlos.
  it('mantiene un margen de separación entre slop y texto humano', () => {
    const margin = analyze(SLOP).probability - analyze(HUMAN).probability;
    expect(margin).toBeGreaterThan(0.2);
  });
});

describe('ExtinctionValidator — aplicabilidad', () => {
  const v = new ExtinctionValidator();

  it('no se aplica a una abstención: no hay nada que moderar', () => {
    expect(v.appliesTo(input(HUMAN), Band.InsufficientEvidence)).toBe(false);
  });

  it('no se aplica a la procedencia criptográfica', () => {
    expect(v.appliesTo(input(HUMAN), Band.ProvenanceConfirmed)).toBe(false);
  });

  it('no se aplica a texto corto', () => {
    expect(v.appliesTo(input('corto', { tokenCount: 5 }), Band.StrongSignal)).toBe(false);
  });

  it('no se aplica a imagen', () => {
    expect(v.appliesTo(input(HUMAN, { modality: 'image' }), Band.StrongSignal)).toBe(false);
  });

  it('se aplica a un veredicto acusatorio sobre texto suficiente', () => {
    expect(v.appliesTo(input(HUMAN), Band.StrongSignal)).toBe(true);
  });
});

describe('ExtinctionValidator — resultados', () => {
  const v = new ExtinctionValidator();

  it('coincide y no toca el veredicto cuando el texto es claramente slop', () => {
    const out = v.validate(ctx(Band.StrongSignal, SLOP));
    expect(out.agreement).toBe('agree');
    expect(out.action).toBe('pass');
  });

  it('contradice una acusación fuerte sobre texto humano y fuerza la abstención', () => {
    const out = v.validate(ctx(Band.StrongSignal, HUMAN));
    expect(out.agreement).toBe('disagree');
    expect(out.action).toBe('abstain');
  });

  it('nunca devuelve una acción que eleve la banda', () => {
    for (const text of [SLOP, HUMAN]) {
      for (const band of [Band.StrongSignal, Band.WeakSignal]) {
        const out = v.validate(ctx(band, text));
        expect(['pass', 'downgrade', 'abstain']).toContain(out.action);
      }
    }
  });
});

describe('integración con el pipeline', () => {
  function detectorSaying(llr: number): Detector {
    return {
      id: 'ml',
      version: '1.0.0',
      capabilities: { modalities: ['text'], tier: 1, languages: ['en'] },
      canHandle: () => true,
      async score() {
        return [
          {
            detectorId: 'ml',
            detectorVersion: '1.0.0',
            kind: 'statistical' as const,
            modality: 'text' as const,
            llr,
            reliability: 1,
            calibrationId: 'cal-test',
            rationale: [],
            costMs: 1,
          },
        ];
      },
    };
  }

  it('el validador rescata un falso positivo del clasificador', async () => {
    const registry = new DetectorRegistry()
      .register(detectorSaying(5))
      .registerValidator(new ExtinctionValidator());

    const sinValidador = await new Pipeline({
      registry: new DetectorRegistry().register(detectorSaying(5)),
    }).analyze(input(HUMAN));

    const conValidador = await new Pipeline({ registry }).analyze(input(HUMAN));

    expect(sinValidador.band).toBe(Band.StrongSignal);
    expect(conValidador.band).toBe(Band.InsufficientEvidence);
    expect(conValidador.validations[0]?.reasonCode).toBe('HEURISTIC_CONTRADICTS_STRONG');
  });

  it('no interfiere cuando ambos coinciden', async () => {
    const registry = new DetectorRegistry()
      .register(detectorSaying(5))
      .registerValidator(new ExtinctionValidator());
    const v = await new Pipeline({ registry }).analyze(input(SLOP));
    expect(v.band).toBe(Band.StrongSignal);
    expect(v.validations[0]?.agreement).toBe('agree');
  });

  it('el validador no puede crear una acusación donde no la había', async () => {
    // El clasificador no ve nada; el texto es slop evidente para la heurística.
    const registry = new DetectorRegistry()
      .register(detectorSaying(0))
      .registerValidator(new ExtinctionValidator());
    const v = await new Pipeline({ registry }).analyze(input(SLOP));
    expect(v.band).toBe(Band.InsufficientEvidence);
  });
});
