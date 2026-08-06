import { describe, expect, it } from 'vitest';
import { Band } from '@xpx/kernel';
import { createPipeline, createRegistry } from '../src/core/composition.js';
import { prepareImage, prepareText } from '../src/content/normalize.js';
import { isVerdict } from '../src/messaging/wire.js';

/** Texto largo y anodino: suficiente para superar el mínimo de tokens. */
const TEXTO_LARGO = 'palabra '.repeat(300).trim();

describe('registro de detectores', () => {
  it('registra el detector de procedencia y el validador heurístico', () => {
    const r = createRegistry();
    expect(r.detectors.map((d) => d.id)).toEqual(['provenance']);
    expect(r.validators.map((v) => v.id)).toEqual(['extinction-heuristic']);
  });

  it('la procedencia se planifica para imágenes', async () => {
    const r = createRegistry();
    const imagen = await prepareImage(new Uint8Array([137, 80, 78, 71]));
    expect(r.plan(imagen, 1).map((d) => d.id)).toEqual(['provenance']);
  });

  /**
   * El estado real de la cobertura, fijado por test para que deje de serlo el
   * día que llegue el detector estilométrico (hito S4 del MVP) y no antes.
   *
   * No hay detector de texto. La consecuencia es que el kernel se abstiene, y
   * eso es la respuesta correcta: un llr sin conjunto de calibración no
   * significa nada (ADR-006), así que inventar uno sería peor que callarse.
   */
  it('todavía NO hay ningún detector de texto', async () => {
    const r = createRegistry();
    const texto = await prepareText(TEXTO_LARGO, 'es');
    expect(r.plan(texto, 1)).toHaveLength(0);
  });
});

describe('pipeline compuesto', () => {
  it('un texto sin detector se abstiene por falta de evidencia, no por error', async () => {
    const veredicto = await createPipeline().analyze(await prepareText(TEXTO_LARGO, 'es'));
    expect(isVerdict(veredicto)).toBe(true);
    expect(veredicto.band).toBe(Band.InsufficientEvidence);
    expect(veredicto.abstentionReason).toBe('NO_EVIDENCE');
    expect(veredicto.evidence).toHaveLength(0);
  });

  /**
   * La regla asimétrica de la procedencia: su ausencia no es sospechosa. La
   * mayor parte de la web legítima no lleva credenciales y las plataformas las
   * destruyen al recodificar.
   */
  it('una imagen sin credenciales no se vuelve sospechosa por no tenerlas', async () => {
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
    const veredicto = await createPipeline().analyze(await prepareImage(png));

    expect(veredicto.band).toBe(Band.InsufficientEvidence);
    expect(veredicto.llrTotal).toBe(0);
    // El detector sí corrió: aportó evidencia nula, que no es lo mismo que no
    // haber mirado.
    expect(veredicto.evidence).toHaveLength(1);
    expect(veredicto.evidence[0]?.reliability).toBe(0);
  });

  it('el veredicto conserva el hash de la entrada', async () => {
    const entrada = await prepareText(TEXTO_LARGO, 'es');
    const veredicto = await createPipeline().analyze(entrada);
    expect(veredicto.hash).toBe(entrada.hash);
  });

  it('la sensibilidad mueve los umbrales sin desactivar la abstención', async () => {
    const entrada = await prepareText(TEXTO_LARGO, 'es');
    for (const sensitivity of ['relaxed', 'balanced', 'strict'] as const) {
      const v = await createPipeline({ sensitivity }).analyze(entrada);
      // Sin detectores no hay evidencia que ningún umbral pueda rescatar.
      expect(v.band).toBe(Band.InsufficientEvidence);
    }
  });

  it('un idioma fuera de los validados se abstiene con su motivo', async () => {
    const entrada = await prepareText(TEXTO_LARGO, 'ja');
    const v = await createPipeline().analyze(entrada);
    expect(v.band).toBe(Band.InsufficientEvidence);
    expect(v.abstentionReason).toBeDefined();
  });

  it('respeta el presupuesto configurado', async () => {
    const v = await createPipeline({ budgetMs: 50 }).analyze(await prepareText(TEXTO_LARGO, 'es'));
    expect(v.elapsedMs).toBeLessThan(50);
  });

  it('produce siempre un veredicto que pasa el validador de cable', async () => {
    const pipeline = createPipeline();
    const entradas = [
      await prepareText(TEXTO_LARGO, 'es'),
      await prepareText('corto', 'en'),
      await prepareImage(new Uint8Array([255, 216, 255, 224])),
    ];
    for (const entrada of entradas) {
      expect(isVerdict(await pipeline.analyze(entrada))).toBe(true);
    }
  });
});
