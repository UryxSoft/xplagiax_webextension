/**
 * La marca con la que el popup le dice al analizador que vaya a Tier 2.
 *
 * Vive aquí porque la escriben y la leen dos bundles distintos —el popup y el
 * script inyectado— que no comparten módulos en tiempo de ejecución. Tenerla en
 * un solo fichero es lo que impide que se desincronicen en silencio, que sería
 * un botón que no hace nada sin ningún error visible.
 *
 * Ojo con el matiz que hace falta conocer para tocar esto: la función que el
 * popup inyecta con `executeScript({ func })` **se serializa**, así que no
 * puede cerrar sobre esta constante. Allí el literal se escribe a mano y una
 * comprobación de arranque verifica que coincide con este valor.
 */
export const DEEP_FLAG = '__xpxDeep';

/** Lee la marca del mundo aislado. Ante cualquier duda, análisis rápido. */
export function readDeepFlag(scope: object = globalThis): boolean {
  return (scope as Record<string, unknown>)[DEEP_FLAG] === true;
}
