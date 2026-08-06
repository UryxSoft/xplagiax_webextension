import { describe, expect, it } from 'vitest';
import { AbstentionReason, Band } from '@xpx/kernel';
import { SLOP_MODEL } from '@xpx/runtime';
import type { TextClassifier } from '@xpx/runtime';
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
   * Sin clasificador inyectado sigue sin haber detector de texto, y el kernel
   * se abstiene. Es la respuesta correcta: un llr sin conjunto de calibración
   * no significa nada (ADR-006), así que inventar uno sería peor que callarse.
   *
   * Construir wllama exige navegador, y esta raíz de composición se prueba sin
   * él; por eso el clasificador entra por parámetro y no se crea aquí.
   */
  it('sin clasificador inyectado no hay ningún detector de texto', async () => {
    const r = createRegistry();
    const texto = await prepareText(TEXTO_LARGO, 'en');
    expect(r.plan(texto, 2)).toHaveLength(0);
  });
});

describe('detector de texto Tier 2', () => {
  const clasificadorFalso: TextClassifier = {
    model: SLOP_MODEL,
    isReady: () => true,
    load: async () => {},
    classify: async () => ({
      label: 'ai_generated',
      pAiGenerated: 0.9,
      rawOutput: 'ai_generated',
      costMs: 1,
      truncated: false,
    }),
    dispose: async () => {},
  };

  const conClasificador = (): ReturnType<typeof createRegistry> =>
    createRegistry({ textClassifier: clasificadorFalso });

  it('se registra cuando se inyecta el clasificador', () => {
    expect(conClasificador().detectors.map((d) => d.id)).toEqual(['provenance', 'slop-text']);
  });

  /**
   * La garantía que hace de ADR-005 algo más que un documento: con el `maxTier`
   * por defecto, los 253 MB del modelo no se planifican siquiera. Si esto
   * dejara de cumplirse, cada párrafo de cada página dispararía una descarga.
   */
  it('NO se planifica en Tier 1, que es el valor por defecto', async () => {
    const texto = await prepareText(TEXTO_LARGO, 'en');
    expect(conClasificador().plan(texto, 1)).toHaveLength(0);
  });

  it('sí se planifica cuando se pide Tier 2 explícitamente', async () => {
    const texto = await prepareText(TEXTO_LARGO, 'en');
    expect(conClasificador().plan(texto, 2).map((d) => d.id)).toEqual(['slop-text']);
  });

  /**
   * El cambio real: antes el texto no producía evidencia ninguna y se abstenía
   * con `NO_EVIDENCE`. Ahora hay un llr calibrado que la fusión puede sumar.
   */
  it('produce evidencia real sobre texto en inglés', async () => {
    const pipeline = createPipeline({ textClassifier: clasificadorFalso, maxTier: 2 });
    const veredicto = await pipeline.analyze(await prepareText(TEXTO_LARGO, 'en'));
    expect(isVerdict(veredicto)).toBe(true);
    expect(veredicto.evidence.map((e) => e.detectorId)).toContain('slop-text');
    expect(veredicto.llrTotal).toBeGreaterThan(0);
    expect(veredicto.abstentionReason).not.toBe(AbstentionReason.NoEvidence);
  });

  /**
   * Y el matiz que importa más que el anterior: **evidencia no es acusación**.
   *
   * Con un solo detector el intervalo conforme es ancho y cruza el umbral, así
   * que el sistema se abstiene igualmente. Que un motor diga «IA» con un 0,9 no
   * basta para acusar a nadie, y ese es exactamente el comportamiento que
   * ADR-007 persigue. Salir de la abstención requiere corroboración —Tier 1,
   * procedencia— que hoy no existe.
   */
  it('un solo detector no basta para acusar: sigue abstenido', async () => {
    const pipeline = createPipeline({ textClassifier: clasificadorFalso, maxTier: 2 });
    const veredicto = await pipeline.analyze(await prepareText(TEXTO_LARGO, 'en'));
    expect(veredicto.band).toBe(Band.InsufficientEvidence);
    expect(veredicto.abstentionReason).toBe(AbstentionReason.IntervalCrossesThreshold);
  });

  /** El techo del llr, comprobado de extremo a extremo y no solo en el detector. */
  it('una certeza extrema del modelo no supera lo que su exactitud permite', async () => {
    const seguro: TextClassifier = {
      ...clasificadorFalso,
      classify: async () => ({
        label: 'ai_generated',
        pAiGenerated: 0.99999,
        rawOutput: 'ai_generated',
        costMs: 1,
        truncated: false,
      }),
    };
    const veredicto = await createPipeline({ textClassifier: seguro, maxTier: 2 }).analyze(
      await prepareText(TEXTO_LARGO, 'en'),
    );
    // ln(0,95/0,05) ≈ 2,944: lo máximo que sostiene un modelo del 95 %.
    expect(veredicto.llrTotal).toBeLessThanOrEqual(2.945);
  });

  /**
   * El modelo se entrenó en inglés y responderá con seguridad en cualquier
   * idioma. Que responda no significa que esté validado ahí.
   */
  it('en un idioma no validado se abstiene aunque el modelo opine', async () => {
    const pipeline = createPipeline({ textClassifier: clasificadorFalso, maxTier: 2 });
    const veredicto = await pipeline.analyze(await prepareText(TEXTO_LARGO, 'es'));
    expect(veredicto.llrTotal).toBe(0);
    expect(veredicto.band).toBe(Band.InsufficientEvidence);
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
