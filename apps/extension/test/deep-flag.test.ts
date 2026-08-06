import { describe, expect, it } from 'vitest';
import { DEEP_FLAG, readDeepFlag } from '../src/shared/deep-flag.js';

/**
 * La marca cruza dos bundles que no comparten módulos en tiempo de ejecución.
 * Si se desincronizaran, el botón de análisis profundo dejaría de funcionar sin
 * un solo error: el analizador leería `undefined` y haría el análisis rápido.
 */
describe('marca de profundidad', () => {
  it('el valor es el que el popup inyecta a mano', () => {
    // Si cambias esto, cambia también el literal en popup/main.ts. La
    // comprobación de arranque del popup lo detecta, pero mejor aquí.
    expect(DEEP_FLAG).toBe('__xpxDeep');
  });

  it('solo `true` cuenta como profundo', () => {
    expect(readDeepFlag({ __xpxDeep: true })).toBe(true);
    expect(readDeepFlag({ __xpxDeep: false })).toBe(false);
    expect(readDeepFlag({})).toBe(false);
  });

  /**
   * El mundo aislado no es del todo nuestro: otra extensión puede haber dejado
   * cosas ahí. Un valor que no sea exactamente `true` no activa una descarga de
   * 253 MB.
   */
  it('un valor sospechoso no dispara Tier 2', () => {
    expect(readDeepFlag({ __xpxDeep: 'true' })).toBe(false);
    expect(readDeepFlag({ __xpxDeep: 1 })).toBe(false);
    expect(readDeepFlag({ __xpxDeep: {} })).toBe(false);
  });
});
