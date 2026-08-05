import { describe, expect, it } from 'vitest';
import {
  countTokens,
  normalizeLang,
  normalizeText,
  prepareImage,
  prepareText,
  sha256Hex,
} from '../src/content/normalize.js';
import { isWireInput, toWire } from '../src/messaging/wire.js';

describe('normalizeText', () => {
  it('colapsa la maquetación en espacios simples', () => {
    expect(normalizeText('  hola\n\n   mundo\t\totra vez  ')).toBe('hola mundo otra vez');
  });

  it('unifica la forma Unicode', () => {
    // "café" compuesto frente a "cafe" + acento combinante: se leen igual.
    const compuesto = 'caf\u00E9';
    const descompuesto = 'cafe\u0301';
    expect(compuesto).not.toBe(descompuesto);
    expect(normalizeText(compuesto)).toBe(normalizeText(descompuesto));
  });

  /**
   * Insertar caracteres invisibles entre letras es la evasión más barata que
   * existe: rompe la tokenización sin que el lector note nada.
   */
  it('elimina caracteres invisibles', () => {
    expect(normalizeText('te\u200Bxto ge\u200Dnerado')).toBe('texto generado');
    expect(normalizeText('a\uFEFFb')).toBe('ab');
    expect(normalizeText('x\u202Ey')).toBe('xy');
  });

  it('trata los espacios exóticos como espacio normal', () => {
    expect(normalizeText('a\u00A0b\u2009c\u3000d')).toBe('a b c d');
  });

  it('no toca los homoglifos, que sí cambian el significado', () => {
    // "а" cirílica. Es trabajo de un detector, no del normalizador.
    const conCirilica = 'p\u0430labra';
    expect(normalizeText(conCirilica)).toBe(conCirilica);
  });

  it('un texto vacío o solo espacios queda vacío', () => {
    expect(normalizeText('')).toBe('');
    expect(normalizeText('   \n\t  ')).toBe('');
  });
});

describe('countTokens', () => {
  it('cuenta palabras separadas por espacios', () => {
    expect(countTokens('uno dos tres')).toBe(3);
    expect(countTokens('')).toBe(0);
    expect(countTokens('solo')).toBe(1);
  });

  /** Sin esto, un párrafo entero en japonés contaría como un token. */
  it('aproxima por caracteres cuando la escritura no separa por espacios', () => {
    const japones = 'これはスペースで区切られていない長い文章の例です'.repeat(2);
    expect(countTokens(japones)).toBeGreaterThan(10);
  });
});

describe('normalizeLang', () => {
  it('reduce a ISO 639-1 en minúscula', () => {
    expect(normalizeLang('ES')).toBe('es');
    expect(normalizeLang('es-419')).toBe('es');
    expect(normalizeLang('pt_BR')).toBe('pt');
    expect(normalizeLang('  en-US ')).toBe('en');
  });

  /** El atributo lang del documento puede traer cualquier cosa. */
  it('devuelve "und" ante basura en lugar de propagarla', () => {
    expect(normalizeLang('')).toBe('und');
    expect(normalizeLang('¿?')).toBe('und');
    expect(normalizeLang('javascript:alert(1)')).toBe('und');
  });
});

describe('sha256Hex', () => {
  it('coincide con el vector conocido de la cadena vacía', async () => {
    await expect(sha256Hex('')).resolves.toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('coincide con el vector conocido de "abc"', async () => {
    await expect(sha256Hex('abc')).resolves.toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  /** Una vista sobre un búfer mayor no debe arrastrar los bytes vecinos. */
  it('hashea solo la vista, no el búfer que la contiene', async () => {
    const grande = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const vista = grande.subarray(2, 5);
    await expect(sha256Hex(vista)).resolves.toBe(await sha256Hex(new Uint8Array([3, 4, 5])));
  });

  it('acepta una implementación inyectada', async () => {
    let visto = false;
    const subtle = {
      digest: async (_a: 'SHA-256', d: BufferSource) => {
        visto = true;
        return globalThis.crypto.subtle.digest('SHA-256', d);
      },
    };
    await sha256Hex('x', subtle);
    expect(visto).toBe(true);
  });
});

describe('prepareText', () => {
  it('produce una entrada que el validador de cable acepta', async () => {
    const input = await prepareText('  Un párrafo\n  cualquiera.  ', 'es-ES');
    expect(isWireInput(toWire(input))).toBe(true);
    expect(input.text).toBe('Un párrafo cualquiera.');
    expect(input.lang).toBe('es');
    expect(input.modality).toBe('text');
  });

  /**
   * La razón de ser del hash: dos textos que se leen igual deduplican, aunque
   * lleguen con maquetación distinta o con caracteres invisibles metidos.
   */
  it('dos textos visualmente idénticos comparten hash', async () => {
    const a = await prepareText('Hola   mundo', 'es');
    const b = await prepareText('  Hola\n\nmundo  ', 'es');
    const c = await prepareText('Hola\u200B mundo', 'es');
    expect(a.hash).toBe(b.hash);
    expect(a.hash).toBe(c.hash);
  });

  it('textos distintos no colisionan', async () => {
    const a = await prepareText('Hola mundo', 'es');
    const b = await prepareText('Hola mundos', 'es');
    expect(a.hash).not.toBe(b.hash);
  });

  it('el hash es del texto normalizado, no del crudo', async () => {
    const input = await prepareText('  Hola   mundo  ', 'es');
    expect(input.hash).toBe(await sha256Hex('Hola mundo'));
  });

  it('propaga las pistas del DOM si se dan', async () => {
    const input = await prepareText('x', 'es', {
      domHints: { isArticle: true, isUserGenerated: false },
    });
    expect(input.domHints?.isArticle).toBe(true);
  });

  it('omite domHints en lugar de ponerlo a undefined', async () => {
    expect('domHints' in (await prepareText('x', 'es'))).toBe(false);
  });
});

describe('prepareImage', () => {
  it('produce una entrada de imagen válida y hashea los bytes', async () => {
    const bytes = new Uint8Array([137, 80, 78, 71]);
    const input = await prepareImage(bytes);
    expect(isWireInput(toWire(input))).toBe(true);
    expect(input.modality).toBe('image');
    expect(input.hash).toBe(await sha256Hex(bytes));
    expect(input.tokenCount).toBe(0);
  });

  it('marca el idioma como indeterminado, no como el del documento', async () => {
    expect((await prepareImage(new Uint8Array([1]))).lang).toBe('und');
  });
});
