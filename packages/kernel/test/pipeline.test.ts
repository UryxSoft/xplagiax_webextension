import { describe, expect, it } from 'vitest';
import { Pipeline } from '../src/pipeline/pipeline.js';
import { DetectorRegistry } from '../src/registry/registry.js';
import { Band, AbstentionReason } from '../src/contracts/verdict.js';
import type { Detector } from '../src/contracts/detector.js';
import type { ValidationStage, ValidationOutcome } from '../src/contracts/validation.js';
import type { Evidence } from '../src/contracts/evidence.js';
import type { NormalizedInput } from '../src/contracts/input.js';

function input(partial: Partial<NormalizedInput> = {}): NormalizedInput {
  return { hash: 'h', modality: 'text', lang: 'en', tokenCount: 500, ...partial };
}

function stubDetector(
  id: string,
  llr: number,
  opts: { tier?: 0 | 1 | 2; throws?: boolean; delayMs?: number } = {},
): Detector {
  return {
    id,
    version: '1.0.0',
    capabilities: {
      modalities: ['text'],
      tier: opts.tier ?? 0,
      languages: 'any',
    },
    canHandle: () => true,
    async score(): Promise<readonly Evidence[]> {
      if (opts.throws) throw new Error('fallo del detector');
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
      return [
        {
          detectorId: id,
          detectorVersion: '1.0.0',
          kind: 'statistical',
          modality: 'text',
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

function stubValidator(
  id: string,
  outcome: ValidationOutcome,
  opts: { throws?: boolean } = {},
): ValidationStage {
  return {
    id,
    version: '1.0.0',
    appliesTo: () => true,
    validate() {
      if (opts.throws) throw new Error('fallo del validador');
      return outcome;
    },
  };
}

describe('Pipeline', () => {
  it('produce un veredicto a partir de los detectores registrados', async () => {
    const registry = new DetectorRegistry().register(stubDetector('a', 4));
    const v = await new Pipeline({ registry }).analyze(input());
    expect(v.band).toBe(Band.StrongSignal);
    expect(v.evidence).toHaveLength(1);
  });

  it('un detector que lanza no derriba el análisis', async () => {
    const registry = new DetectorRegistry()
      .register(stubDetector('roto', 0, { throws: true }))
      .register(stubDetector('bueno', 4));
    const v = await new Pipeline({ registry }).analyze(input());
    expect(v.band).toBe(Band.StrongSignal);
    expect(v.evidence).toHaveLength(1);
  });

  it('respeta maxTier: no ejecuta Tier 2 si no se pide', async () => {
    const registry = new DetectorRegistry()
      .register(stubDetector('t0', 1, { tier: 0 }))
      .register(stubDetector('t2', 9, { tier: 2 }));
    const v = await new Pipeline({ registry, maxTier: 0 }).analyze(input());
    expect(v.evidence.map((e) => e.detectorId)).toEqual(['t0']);
  });

  it('para de analizar cuando se agota el presupuesto', async () => {
    let clock = 0;
    const registry = new DetectorRegistry()
      .register(stubDetector('a', 1))
      .register(stubDetector('b', 1));
    const pipeline = new Pipeline({
      registry,
      budgetMs: 10,
      now: () => (clock += 20), // cada consulta al reloj avanza 20 ms
    });
    const v = await pipeline.analyze(input());
    expect(v.evidence.length).toBeLessThan(2);
  });

  it('respeta un AbortSignal ya disparado', async () => {
    const registry = new DetectorRegistry().register(stubDetector('a', 4));
    const v = await new Pipeline({ registry }).analyze(input(), {
      signal: AbortSignal.abort(),
    });
    expect(v.evidence).toHaveLength(0);
    expect(v.band).toBe(Band.InsufficientEvidence);
  });
});

describe('Pipeline — etapas de validación (ADR-010)', () => {
  it('una etapa que pasa deja el veredicto intacto', async () => {
    const registry = new DetectorRegistry()
      .register(stubDetector('a', 4))
      .registerValidator(
        stubValidator('v', { agreement: 'agree', action: 'pass', reasonCode: 'OK' }),
      );
    const v = await new Pipeline({ registry }).analyze(input());
    expect(v.band).toBe(Band.StrongSignal);
    expect(v.validations[0]?.agreement).toBe('agree');
  });

  it('una etapa que discrepa degrada la banda', async () => {
    const registry = new DetectorRegistry()
      .register(stubDetector('a', 4))
      .registerValidator(
        stubValidator('v', {
          agreement: 'disagree',
          action: 'downgrade',
          reasonCode: 'HEURISTICA_NO_CONFIRMA',
        }),
      );
    const v = await new Pipeline({ registry }).analyze(input());
    expect(v.band).toBe(Band.WeakSignal);
  });

  it('una etapa puede forzar la abstención', async () => {
    const registry = new DetectorRegistry()
      .register(stubDetector('a', 4))
      .registerValidator(
        stubValidator('v', { agreement: 'disagree', action: 'abstain', reasonCode: 'VETO' }),
      );
    const v = await new Pipeline({ registry }).analyze(input());
    expect(v.band).toBe(Band.InsufficientEvidence);
    expect(v.abstentionReason).toBe(AbstentionReason.ValidationVeto);
  });

  it('GARANTÍA DE MONOTONÍA: una etapa nunca puede elevar el veredicto', async () => {
    // Detector con señal débil → WEAK. El validador intenta "confirmar" con
    // pass; el pipeline no ofrece ninguna acción que suba la banda.
    const registry = new DetectorRegistry()
      .register(stubDetector('a', 1.0))
      .registerValidator(
        stubValidator('optimista', {
          agreement: 'agree',
          action: 'pass',
          reasonCode: 'CONFIRMA',
        }),
      );
    const v = await new Pipeline({ registry }).analyze(input());
    expect(v.band).toBe(Band.WeakSignal);
    expect(v.band).not.toBe(Band.StrongSignal);
  });

  it('una etapa no puede sacar al sistema de la abstención', async () => {
    const registry = new DetectorRegistry()
      .register(stubDetector('a', 0.1))
      .registerValidator(
        stubValidator('v', { agreement: 'disagree', action: 'pass', reasonCode: 'X' }),
      );
    const v = await new Pipeline({ registry }).analyze(input());
    expect(v.band).toBe(Band.InsufficientEvidence);
  });

  it('una heurística no puede vetar la procedencia criptográfica', async () => {
    const provenance: Detector = {
      id: 'c2pa',
      version: '1.0.0',
      capabilities: { modalities: ['text'], tier: 0, languages: 'any' },
      canHandle: () => true,
      async score() {
        return [
          {
            detectorId: 'c2pa',
            detectorVersion: '1.0.0',
            kind: 'provenance' as const,
            modality: 'text' as const,
            llr: 8,
            reliability: 1,
            calibrationId: 'cal-test',
            rationale: [],
            costMs: 1,
          },
        ];
      },
    };
    const registry = new DetectorRegistry()
      .register(provenance)
      .registerValidator(
        stubValidator('v', { agreement: 'disagree', action: 'abstain', reasonCode: 'VETO' }),
      );
    const v = await new Pipeline({ registry }).analyze(input());
    expect(v.band).toBe(Band.ProvenanceConfirmed);
  });

  it('un validador que lanza no altera el veredicto', async () => {
    const registry = new DetectorRegistry()
      .register(stubDetector('a', 4))
      .registerValidator(
        stubValidator('roto', { agreement: 'agree', action: 'abstain', reasonCode: 'X' }, { throws: true }),
      );
    const v = await new Pipeline({ registry }).analyze(input());
    expect(v.band).toBe(Band.StrongSignal);
    expect(v.validations).toHaveLength(0);
  });

  it('las etapas se encadenan y acumulan cautela', async () => {
    const registry = new DetectorRegistry()
      .register(stubDetector('a', 4))
      .registerValidator(
        stubValidator('v1', { agreement: 'disagree', action: 'downgrade', reasonCode: 'A' }),
      )
      .registerValidator(
        stubValidator('v2', { agreement: 'disagree', action: 'downgrade', reasonCode: 'B' }),
      );
    const v = await new Pipeline({ registry }).analyze(input());
    expect(v.band).toBe(Band.InsufficientEvidence);
    expect(v.validations).toHaveLength(2);
  });
});

describe('DetectorRegistry', () => {
  it('rechaza detectores duplicados', () => {
    const r = new DetectorRegistry().register(stubDetector('a', 1));
    expect(() => r.register(stubDetector('a', 2))).toThrow(/duplicado/);
  });

  it('planifica por tier ascendente: lo barato primero', () => {
    const r = new DetectorRegistry()
      .register(stubDetector('caro', 1, { tier: 2 }))
      .register(stubDetector('barato', 1, { tier: 0 }));
    expect(r.plan(input(), 2).map((d) => d.id)).toEqual(['barato', 'caro']);
  });

  it('filtra por idioma soportado', () => {
    const es: Detector = { ...stubDetector('es', 1), capabilities: { modalities: ['text'], tier: 0, languages: ['es'] } };
    const r = new DetectorRegistry().register(es);
    expect(r.plan(input({ lang: 'en' }), 2)).toHaveLength(0);
    expect(r.plan(input({ lang: 'es' }), 2)).toHaveLength(1);
  });

  it('filtra por modalidad', () => {
    const r = new DetectorRegistry().register(stubDetector('texto', 1));
    expect(r.plan(input({ modality: 'image' }), 2)).toHaveLength(0);
  });
});
