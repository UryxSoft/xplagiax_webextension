import type { CryptoProvider } from '@xpx/provenance';

/**
 * Adaptador entre `SubtleCrypto` del navegador y el `CryptoProvider` que espera
 * el detector de procedencia.
 *
 * No es un envoltorio gratuito. `SubtleCrypto.importKey` está declarado con
 * sobrecargas cuya primera firma exige `'jwk'`, y TypeScript no acepta el
 * conjunto como asignable a la interfaz estrecha del detector. Envolverlo aquí
 * mantiene el paquete de procedencia sin dependencias del navegador (ADR-001)
 * en lugar de ensancharlo para acomodar los tipos del DOM.
 *
 * También resuelve un detalle real: las vistas `Uint8Array` pueden apuntar a un
 * búfer mayor. Se copian antes de pasarlas, para que la firma se verifique
 * sobre exactamente los bytes previstos y no sobre los vecinos.
 */
export function webCryptoProvider(subtle?: SubtleCrypto): CryptoProvider {
  const impl = subtle ?? systemSubtle();
  return {
    importKey: (format, keyData, algorithm, extractable, usages) =>
      impl.importKey(
        format,
        bytesOf(keyData),
        algorithm as unknown as AlgorithmIdentifier,
        extractable,
        usages as KeyUsage[],
      ),
    verify: (algorithm, key, signature, data) =>
      impl.verify(
        algorithm as unknown as AlgorithmIdentifier,
        key as CryptoKey,
        bytesOf(signature),
        bytesOf(data),
      ),
  };
}

/** Copia la vista a un búfer propio, sin los bytes vecinos. */
function bytesOf(view: Uint8Array): ArrayBuffer {
  const copia = new Uint8Array(view.length);
  copia.set(view);
  return copia.buffer;
}

function systemSubtle(): SubtleCrypto {
  const c = (globalThis as { crypto?: { subtle?: SubtleCrypto } }).crypto;
  if (c?.subtle === undefined) {
    throw new Error('WebCrypto no disponible en este contexto');
  }
  return c.subtle;
}
