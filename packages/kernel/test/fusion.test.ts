import { describe, expect, it } from 'vitest';
import { fuse, computeDisagreement } from '../src/evidence/fusion.js';
import type { CorrelationModel } from '../src/evidence/fusion.js';
import type { Evidence } from '../src/contracts/evidence.js';

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

describe('fuse', () => {
  it('no aporta nada cuando no hay evidencia', () => {
    const r = fuse([]);
    expect(r.llrTotal).toBe(0);
    expect(r.totalWeight).toBe(0);
  });

  it('trata llr=0 como no informativo, no como "mitad y mitad"', () => {
    const r = fuse([ev({ detectorId: 'a', llr: 0, reliability: 1 })]);
    expect(r.totalWeight).toBe(0);
    expect(r.llrTotal).toBe(0);
  });

  it('excluye evidencia con fiabilidad cero, aunque su llr sea alto', () => {
    const r = fuse([ev({ detectorId: 'a', llr: 9, reliability: 0 })]);
    expect(r.llrTotal).toBe(0);
    expect(r.totalWeight).toBe(0);
  });

  it('suma los llr ponderados por fiabilidad', () => {
    const r = fuse([
      ev({ detectorId: 'a', llr: 2, reliability: 1 }),
      ev({ detectorId: 'b', llr: 1, reliability: 0.5 }),
    ]);
    expect(r.llrTotal).toBeCloseTo(2.5, 10);
  });

  it('llr negativo empuja hacia humano', () => {
    const r = fuse([
      ev({ detectorId: 'a', llr: 3, reliability: 1 }),
      ev({ detectorId: 'b', llr: -3, reliability: 1 }),
    ]);
    expect(r.llrTotal).toBeCloseTo(0, 10);
  });

  it('penaliza detectores correlacionados: dos sesgos iguales no se refuerzan', () => {
    const correlated: CorrelationModel = {
      pairwise: new Map([['a|b', 1]]),
    };
    const independent = fuse([
      ev({ detectorId: 'a', llr: 2 }),
      ev({ detectorId: 'b', llr: 2 }),
    ]);
    const dependent = fuse(
      [ev({ detectorId: 'a', llr: 2 }), ev({ detectorId: 'b', llr: 2 })],
      correlated,
    );

    expect(independent.llrTotal).toBeCloseTo(4, 10);
    // Correlación total: cada uno pesa la mitad.
    expect(dependent.llrTotal).toBeCloseTo(2, 10);
    expect(dependent.llrTotal).toBeLessThan(independent.llrTotal);
  });

  it('registra la contribución de cada detector para el modo desarrollador', () => {
    const r = fuse([
      ev({ detectorId: 'a', llr: 2, reliability: 0.5 }),
      ev({ detectorId: 'b', llr: 0 }),
    ]);
    expect(r.contributions).toHaveLength(2);
    expect(r.contributions[0]?.effective).toBeCloseTo(1, 10);
    expect(r.contributions[1]?.effective).toBe(0);
  });
});

describe('computeDisagreement', () => {
  it('es 0 con unanimidad', () => {
    expect(
      computeDisagreement([
        ev({ detectorId: 'a', llr: 2 }),
        ev({ detectorId: 'b', llr: 3 }),
      ]),
    ).toBe(0);
  });

  it('es 1 con empate perfecto', () => {
    expect(
      computeDisagreement([
        ev({ detectorId: 'a', llr: 2 }),
        ev({ detectorId: 'b', llr: -2 }),
      ]),
    ).toBeCloseTo(1, 10);
  });

  it('es 0 cuando no hay fuentes informativas', () => {
    expect(computeDisagreement([ev({ detectorId: 'a', llr: 0 })])).toBe(0);
  });
});
