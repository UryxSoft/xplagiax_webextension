import { describe, expect, it } from 'vitest';
import {
  decideBand,
  defaultPolicy,
  applySensitivity,
  downgrade,
} from '../src/scoring/bands.js';
import { Band, AbstentionReason } from '../src/contracts/verdict.js';
import { fuse } from '../src/evidence/fusion.js';
import type { Evidence } from '../src/contracts/evidence.js';
import type { NormalizedInput } from '../src/contracts/input.js';

function ev(partial: Partial<Evidence> & { detectorId: string }): Evidence {
  return {
    detectorVersion: '1.0.0',
    kind: 'statistical',
    modality: 'text',
    llr: 0,
    reliability: 1,
    calibrationId: 'cal-test',
    rationale: [],
    costMs: 0,
    ...partial,
  };
}

function input(partial: Partial<NormalizedInput> = {}): NormalizedInput {
  return {
    hash: 'h',
    modality: 'text',
    lang: 'en',
    tokenCount: 500,
    ...partial,
  };
}

function decide(
  evidence: readonly Evidence[],
  inp: NormalizedInput = input(),
  policy = defaultPolicy,
) {
  return decideBand(inp, fuse(evidence), evidence, policy);
}

describe('decideBand — abstención', () => {
  it('se abstiene sin evidencia', () => {
    const d = decide([]);
    expect(d.band).toBe(Band.InsufficientEvidence);
    expect(d.abstentionReason).toBe(AbstentionReason.NoEvidence);
  });

  it('se abstiene con texto por debajo del mínimo de tokens', () => {
    const d = decide([ev({ detectorId: 'a', llr: 9 })], input({ tokenCount: 20 }));
    expect(d.band).toBe(Band.InsufficientEvidence);
    expect(d.abstentionReason).toBe(AbstentionReason.TooShort);
  });

  it('se abstiene en un idioma no validado, por muy fuerte que sea la señal', () => {
    const d = decide([ev({ detectorId: 'a', llr: 20 })], input({ lang: 'sw' }));
    expect(d.band).toBe(Band.InsufficientEvidence);
    expect(d.abstentionReason).toBe(AbstentionReason.UnvalidatedLanguage);
  });

  it('se abstiene cuando los detectores discrepan', () => {
    const d = decide([
      ev({ detectorId: 'a', llr: 5 }),
      ev({ detectorId: 'b', llr: -4.5 }),
    ]);
    expect(d.band).toBe(Band.InsufficientEvidence);
  });

  it('se abstiene cuando el intervalo cruza el umbral de decisión', () => {
    // llr justo en el umbral: el intervalo lo cruza por ambos lados.
    const d = decide([ev({ detectorId: 'a', llr: 2.0 })]);
    expect(d.band).toBe(Band.InsufficientEvidence);
    expect(d.abstentionReason).toBe(AbstentionReason.IntervalCrossesThreshold);
  });

  it('señal por debajo del umbral débil es ausencia de evidencia, no "humano"', () => {
    const d = decide([ev({ detectorId: 'a', llr: 0.2 })]);
    expect(d.band).toBe(Band.InsufficientEvidence);
    expect(d.abstentionReason).toBe(AbstentionReason.NoEvidence);
  });
});

describe('decideBand — bandas', () => {
  it('da STRONG_SIGNAL con señal alta y sin ambigüedad', () => {
    const d = decide([ev({ detectorId: 'a', llr: 4 })]);
    expect(d.band).toBe(Band.StrongSignal);
    expect(d.abstentionReason).toBeUndefined();
  });

  it('da WEAK_SIGNAL en la franja intermedia', () => {
    const d = decide([ev({ detectorId: 'a', llr: 1.0 })]);
    expect(d.band).toBe(Band.WeakSignal);
  });

  it('la procedencia verificada domina y no pasa por la abstención', () => {
    // Texto demasiado corto y en idioma no validado: aun así, la firma manda.
    const d = decide(
      [ev({ detectorId: 'c2pa', kind: 'provenance', llr: 8, reliability: 1 })],
      input({ tokenCount: 5, lang: 'sw' }),
    );
    expect(d.band).toBe(Band.ProvenanceConfirmed);
  });

  it('la ausencia de procedencia no es evidencia de nada', () => {
    const d = decide([
      ev({ detectorId: 'c2pa', kind: 'provenance', llr: 0, reliability: 0 }),
    ]);
    expect(d.band).toBe(Band.InsufficientEvidence);
  });
});

describe('sensibilidad', () => {
  it('estricto baja el umbral y relajado lo sube', () => {
    expect(applySensitivity(defaultPolicy, 'strict').strongThreshold).toBeLessThan(
      defaultPolicy.strongThreshold,
    );
    expect(applySensitivity(defaultPolicy, 'relaxed').strongThreshold).toBeGreaterThan(
      defaultPolicy.strongThreshold,
    );
  });

  it('ninguna sensibilidad puede desactivar la abstención por idioma', () => {
    for (const s of ['relaxed', 'balanced', 'strict'] as const) {
      const policy = applySensitivity(defaultPolicy, s);
      const d = decide([ev({ detectorId: 'a', llr: 50 })], input({ lang: 'sw' }), policy);
      expect(d.band).toBe(Band.InsufficientEvidence);
    }
  });

  it('ninguna sensibilidad puede desactivar la abstención por longitud', () => {
    for (const s of ['relaxed', 'balanced', 'strict'] as const) {
      const policy = applySensitivity(defaultPolicy, s);
      const d = decide([ev({ detectorId: 'a', llr: 50 })], input({ tokenCount: 3 }), policy);
      expect(d.band).toBe(Band.InsufficientEvidence);
    }
  });
});

describe('downgrade', () => {
  it('degrada hacia la cautela', () => {
    expect(downgrade(Band.StrongSignal)).toBe(Band.WeakSignal);
    expect(downgrade(Band.WeakSignal)).toBe(Band.InsufficientEvidence);
  });

  it('la abstención es el suelo', () => {
    expect(downgrade(Band.InsufficientEvidence)).toBe(Band.InsufficientEvidence);
  });

  it('no degrada la procedencia criptográfica', () => {
    expect(downgrade(Band.ProvenanceConfirmed)).toBe(Band.ProvenanceConfirmed);
  });
});
