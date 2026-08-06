# Detector de texto IA · overlay de ficheros

**No hay parches.** Los `git am` chocaban en cada entrega porque `main` se movía
y porque `main` lleva marcas de conflicto commiteadas —en `vitest.config.ts` y
`packages/ipc/tsconfig.json`— que ningún merge automático resuelve. Este paquete
copia los ficheros ya resueltos.

## Aplicar

    tar -xzf xpx-detector.tar.gz
    ./xpx-detector/aplicar.sh
    rm -rf xpx-detector xpx-detector.tar.gz

Es idempotente: se puede repetir.

## Qué arregla de main, además de añadir el detector

- `vitest.config.ts` tenía marcas de conflicto → el fichero era JS inválido y
  **vitest no arrancaba**.
- `packages/ipc/tsconfig.json` tenía marcas anidadas → JSON inválido, y **el
  build fallaba** con "Expected double-quoted property name in JSON".
- Los scripts pasaban `--outDir` a `wxt build`, que no acepta esa opción.
- Faltaba Vite 6 (WXT 0.21 lo exige) y `playwright` (lo usa `smoke`).
- El typecheck de la extensión fallaba: faltaban `DOM.Iterable`, rutas a
  `@xpx/provenance` y `@xpx/extinction-validator`, y `PortLike.name`,
  `PortLike.sender` y `RuntimeApi.onConnect` en `extension-api.ts`.
- `portTransport` se tragaba todas las excepciones de `postMessage`, incluidas
  las de serialización.

## Qué añade

`@xpx/runtime` (fachada de wllama) y `@xpx/slop-detector` (el detector Tier 2
calibrado), registrados desde `composition.ts`. Solo inglés, solo opt-in.
