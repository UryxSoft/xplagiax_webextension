import { describe, expect, it } from 'vitest';
import { webcrypto } from 'node:crypto';
import {
  MIN_CHARS,
  approximateTokenCount,
  detectLanguage,
  hashText,
  isAnalyzable,
  normalizeText,
} from '../src/content/segment.js';

describe('normalización', () => {
  it('colapsa espacios y recorta', () => {
    expect(normalizeText('  hola   \n  mundo \t ')).toBe('hola mundo');
  });

  /**
   * Las CMS sustituyen comillas y guiones de formas distintas. Si el mismo
   * párrafo produce dos hashes, se analiza dos veces y la caché no sirve.
   */
  it('unifica comillas y guiones tipográficos', () => {
    expect(normalizeText('“cita” y ‘otra’')).toBe('"cita" y \'otra\'');
    expect(normalizeText('uno – dos — tres')).toBe('uno - dos - tres');
  });

  it('el espacio duro cuenta como espacio', () => {
    expect(normalizeText('a b')).toBe('a b');
  });

  it('dos variantes del mismo texto producen el mismo hash', async () => {
    const a = normalizeText('Dijo “hola” — y se fue.');
    const b = normalizeText('Dijo "hola"  -  y se fue.');
    expect(await hashText(a, webcrypto.subtle)).toBe(await hashText(b, webcrypto.subtle));
  });
});

describe('hash', () => {
  it('es sha256 en hexadecimal', async () => {
    const h = await hashText('abc', webcrypto.subtle);
    expect(h).toHaveLength(64);
    expect(h).toMatch(/^[0-9a-f]+$/);
    // Vector conocido de SHA-256("abc").
    expect(h).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('¿merece análisis?', () => {
  const prosa = (n: number): string => 'the quick brown fox jumps over a lazy dog. '.repeat(n);

  it('descarta bloques demasiado cortos', () => {
    expect(isAnalyzable('x'.repeat(MIN_CHARS - 1))).toBe(false);
    expect(isAnalyzable(prosa(10))).toBe(true);
  });

  /** Tablas de cifras, menús y código no son prosa: no hay señal que medir. */
  it('descarta lo que no es prosa', () => {
    expect(isAnalyzable('1234 5678 9012 '.repeat(20))).toBe(false);
    expect(isAnalyzable('| 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | '.repeat(10))).toBe(false);
  });
});

describe('idioma', () => {
  const ingles =
    'The report describes the way in which the system is used and the results that were ' +
    'obtained from it, with a summary of the data that was collected for this purpose.';
  const espanol =
    'El informe describe la manera en la que se utiliza el sistema y los resultados que se ' +
    'obtuvieron de él, con un resumen de los datos recogidos para este propósito concreto.';

  it('reconoce inglés', () => {
    expect(detectLanguage(ingles)).toBe('en');
  });

  /**
   * El modelo solo está validado en inglés. Confundir español con inglés le
   * daría material fuera de su distribución y el detector opinaría igualmente.
   */
  it('no confunde español con inglés', () => {
    expect(detectLanguage(espanol)).toBe('und');
  });

  it('ante muy poco texto responde "und" en vez de adivinar', () => {
    expect(detectLanguage('the and of')).toBe('und');
    expect(detectLanguage('')).toBe('und');
  });
});

describe('recuento aproximado de tokens', () => {
  it('crece con el número de palabras', () => {
    expect(approximateTokenCount('one two three')).toBeGreaterThan(0);
    expect(approximateTokenCount('one two three four five six')).toBeGreaterThan(
      approximateTokenCount('one two three'),
    );
  });

  it('un texto vacío da cero', () => {
    expect(approximateTokenCount('')).toBe(0);
    expect(approximateTokenCount('   ')).toBe(0);
  });
});
